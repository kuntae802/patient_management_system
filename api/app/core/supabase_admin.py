"""Supabase Auth Admin 래퍼 — GoTrue 사용자 프로비저닝(supabase-py service_role).

이 모듈이 시스템에서 **supabase-py 의 최초 사용처**다. 직원 계정 생성/재직상태(로그인) 차단은
GoTrue Admin API(auth.users + auth.identities + 토큰 컬럼을 정확히 처리)로만 수행한다 — raw SQL
insert(seed.sql 의 DEV-ONLY 경로)는 토큰 컬럼 함정이 있어 프로덕션 금지.

⚠️ supabase-py v2.31 의 admin 클라이언트는 **동기**다. asyncpg 이벤트 루프 블로킹을 막기 위해
   모든 호출을 `anyio.to_thread.run_sync` 로 스레드 오프로드한다(security.py JWKS 오프로드 선례).
🚫 secret 키·raw 비밀번호는 로그·응답·예외 메시지에 절대 노출하지 않는다.
"""

from __future__ import annotations

import logging
from functools import partial
from uuid import UUID

import anyio
from supabase import Client, create_client
from supabase_auth.errors import AuthApiError, AuthError, AuthWeakPasswordError

from app.core.config import settings
from app.core.errors import AppError, ConflictError, ServiceUnavailableError

logger = logging.getLogger("app.supabase_admin")

# 사실상 영구 ban(GoTrue duration 문자열). 휴직/퇴사 시 적용, 복귀 시 'none' 으로 해제.
_BAN_DURATION = "876000h"  # ≈ 100년
_UNBAN_DURATION = "none"

# GoTrue 이메일 중복 코드(버전별 표기 차이 흡수).
_EMAIL_EXISTS_CODES = frozenset({"email_exists", "user_already_exists"})

_admin_client: Client | None = None


def _get_admin_client() -> Client:
    """service_role(secret) 키 기반 admin 클라이언트 싱글톤. 미설정/생성 실패 → 503.

    GoTrue 클라이언트는 lazy(생성 시 네트워크 없음)이므로 동기 생성해도 루프를 막지 않는다.
    """
    global _admin_client
    if _admin_client is None:
        if not settings.supabase_secret_key:
            # 직원 프로비저닝 미구성 — 부팅은 통과시키되 호출 시점에 명확히 실패(config 정책).
            logger.warning("SUPABASE_SECRET_KEY 미설정 — admin 프로비저닝 불가(503).")
            raise ServiceUnavailableError("직원 프로비저닝이 구성되지 않았습니다.")
        try:
            _admin_client = create_client(settings.supabase_url, settings.supabase_secret_key)
        except Exception as exc:  # noqa: BLE001 — 어떤 생성 실패도 503 으로(키/URL 노출 금지)
            logger.warning("admin 클라이언트 생성 실패: %s", type(exc).__name__)
            raise ServiceUnavailableError() from exc
    return _admin_client


async def admin_create_user(email: str, password: str) -> UUID:
    """GoTrue 사용자를 생성하고 uid 를 반환. `email_confirm=True`(관리자 프로비저닝).

    이메일 중복 → 409 `email_taken`, 약한 비밀번호 → 422 `weak_password`, 그 외 GoTrue/네트워크
    실패 → 503. raw 비밀번호는 인자로만 흐르고 로깅하지 않는다.
    """
    client = _get_admin_client()
    attributes = {"email": email, "password": password, "email_confirm": True}
    try:
        resp = await anyio.to_thread.run_sync(
            partial(client.auth.admin.create_user, attributes)
        )
    except AuthWeakPasswordError as exc:
        raise AppError(
            "비밀번호가 보안 정책을 충족하지 않습니다.",
            code="weak_password",
            status_code=422,
        ) from exc
    except AuthApiError as exc:
        if exc.code in _EMAIL_EXISTS_CODES or "registered" in (exc.message or "").lower():
            raise ConflictError(
                "이미 사용 중인 이메일입니다.", code="email_taken"
            ) from exc
        if exc.status == 422:  # 기타 검증성 실패(약한 비밀번호 등 코드 미세분류 폴백)
            raise AppError(
                "계정 생성 입력값이 올바르지 않습니다.",
                code="auth_invalid",
                status_code=422,
            ) from exc
        logger.warning("GoTrue create_user 실패: status=%s code=%s", exc.status, exc.code)
        raise ServiceUnavailableError() from exc
    except AuthError as exc:
        logger.warning("GoTrue create_user 오류: %s", type(exc).__name__)
        raise ServiceUnavailableError() from exc

    if resp.user is None or resp.user.id is None:  # 방어적 — 정상 경로에선 항상 채워짐
        raise ServiceUnavailableError()
    return UUID(str(resp.user.id))


async def admin_delete_user(uid: UUID) -> None:
    """GoTrue 사용자를 삭제(보상용). best-effort — 실패해도 원래 오류를 가리지 않도록 삼킨다.

    users.id FK(on delete cascade)로 public.users 부분행도 함께 정리된다.
    """
    try:
        client = _get_admin_client()
        await anyio.to_thread.run_sync(partial(client.auth.admin.delete_user, str(uid)))
    except Exception as exc:  # noqa: BLE001 — 보상은 어떤 실패에도 원 오류를 가리지 않는다
        # 보상 실패는 로깅만(고아 가능성 경고) — 호출부의 원 오류 전파를 막지 않는다.
        logger.warning("보상 삭제 실패(고아 Auth 사용자 가능): uid=%s %s", uid, type(exc).__name__)


async def admin_set_ban(uid: UUID, *, banned: bool) -> None:
    """GoTrue ban 적용/해제 — 로그인 차단·세션 revoke(banned=True) 또는 복원(False).

    실패 → 503(호출 서비스가 소프트 처리). DB 재직상태가 접근 권위이므로 ban 실패는 안전한 방향
    (접근은 이미 DB 헬퍼가 차단/복원). 멱등 — 같은 상태 재적용 무해.
    """
    client = _get_admin_client()
    duration = _BAN_DURATION if banned else _UNBAN_DURATION
    try:
        await anyio.to_thread.run_sync(
            partial(client.auth.admin.update_user_by_id, str(uid), {"ban_duration": duration})
        )
    except AuthError as exc:
        logger.warning("GoTrue ban 적용 실패: uid=%s banned=%s %s", uid, banned, type(exc).__name__)
        raise ServiceUnavailableError() from exc
