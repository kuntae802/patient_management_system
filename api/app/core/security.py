"""인증·인가 의존성 — Supabase JWT(JWKS·ES256) 검증 + has_permission 기반 RBAC.

RBAC 3계층 중 '쓰기 권위(FastAPI)' 레이어. RLS(행 권위)·UI 게이트(학습 레이어)와 상보.

검증 흐름(§Story1.5 AC1·AC2):
  1. Authorization: Bearer <token> 추출
  2. JWKS(공개키, ES256)로 서명·aud=authenticated·exp·iss 검증 → sub(UUID) 획득
     ⚠️ 토큰엔 RBAC 역할/권한이 없다(커스텀 hook 미설치) → role/permission 은 항상 DB 룩업.
        토큰 `role` 클레임은 Postgres 역할(`authenticated`)이지 RBAC 역할이 아니다(D-1).
  3. require_permission(code): DB `has_permission(code)` 로 평가 → 미충족 시 403.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID

import anyio
import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError
from pydantic import BaseModel, ValidationError

from app.core import db
from app.core.config import settings
from app.core.errors import AuthError, ForbiddenError, ServiceUnavailableError

logger = logging.getLogger("app.security")

# 직원 5역할(환자 제외). auth_user_role() 이 이 집합 밖이면 비직원(D-4).
STAFF_ROLES: frozenset[str] = frozenset({"reception", "doctor", "nurse", "radiologist", "admin"})

# OpenAPI 에 'Authorize' 버튼 노출. auto_error=False → 누락 시 우리 봉투(401)로 처리.
_bearer_scheme = HTTPBearer(auto_error=False, description="Supabase access token (Bearer)")

_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    """JWKS 클라이언트 싱글턴. JWKS set 을 캐싱(lifespan 초)해 매 요청 fetch 를 방지(AC7)."""
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(
            settings.supabase_jwks_url,
            cache_jwk_set=True,
            lifespan=300,
            timeout=5,  # JWKS 호스트 정지 시 요청 행·스레드풀 고갈 방지
        )
    return _jwks_client


class CurrentUser(BaseModel):
    """검증된 토큰 주체. 민감정보(원문 토큰)는 담지 않는다."""

    sub: UUID
    aud: str
    role: str | None = None  # Postgres 역할(authenticated). RBAC 역할 아님.
    email: str | None = None
    exp: int


def _decode_token(token: str, signing_key: Any) -> dict[str, Any]:
    """서명·aud·exp·iss 검증 후 클레임 반환. 검증 실패는 모두 401(AuthError)로 통일."""
    try:
        return jwt.decode(
            token,
            signing_key,
            algorithms=["ES256"],
            audience=settings.supabase_jwt_aud,
            issuer=settings.jwt_issuer,  # None 이면 iss 미검증
            options={"require": ["exp", "sub", "aud"], "verify_aud": True},
        )
    except jwt.PyJWTError as exc:
        # 어떤 검증이 실패했는지 응답에 노출하지 않는다(계정 열거·정보 누출 방지).
        logger.info("JWT 검증 실패: %s", type(exc).__name__)
        raise AuthError() from exc


async def _resolve_signing_key(token: str) -> Any:
    """JWKS 에서 토큰 kid 에 맞는 공개키 해석. blocking 호출이라 threadpool 로 오프로드."""
    client = _get_jwks_client()
    try:
        signing_key = await anyio.to_thread.run_sync(client.get_signing_key_from_jwt, token)
    except PyJWKClientConnectionError as exc:
        # JWKS 엔드포인트 도달 불가 → 일시 장애(503). 전면 500 금지(AC7).
        # ⚠️ PyJWKClientConnectionError ⊂ PyJWKClientError ⊂ PyJWTError → 반드시 먼저 잡는다.
        logger.warning("JWKS 도달 불가: %s", type(exc).__name__)
        raise ServiceUnavailableError() from exc
    except jwt.PyJWTError as exc:
        # 매칭 키 없음(PyJWKClientError)·헤더/페이로드 파싱 실패(DecodeError) 등 모든 토큰
        # 결함 → 인증 실패(401). PyJWKClientError 도 PyJWTError 의 하위라 함께 포착된다.
        logger.info("JWKS 서명키 해석 실패: %s", type(exc).__name__)
        raise AuthError() from exc
    return signing_key.key


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> CurrentUser:
    """Bearer 토큰을 JWKS 로 검증하고 주체를 반환. 누락/무효/만료 → 401."""
    if creds is None or not creds.credentials:
        raise AuthError()
    token = creds.credentials
    key = await _resolve_signing_key(token)
    claims = _decode_token(token, key)
    try:
        aud = claims["aud"]
        return CurrentUser(
            sub=claims["sub"],
            aud=aud[0] if isinstance(aud, list) and aud else aud,
            role=claims.get("role"),
            email=claims.get("email"),
            exp=claims["exp"],
        )
    except (ValidationError, KeyError, IndexError, TypeError) as exc:
        # 서명은 유효하나 클레임이 비정상(non-UUID sub·빈 aud·필수 누락) → 401(500 금지).
        logger.info("토큰 클레임 비정상: %s", type(exc).__name__)
        raise AuthError() from exc


def require_permission(code: str) -> Callable[..., Awaitable[CurrentUser]]:
    """주어진 권한 코드를 강제하는 의존성 팩토리. DB has_permission 평가 → 미충족 403."""

    async def _dependency(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        allowed = await db.fetch_has_permission(user.sub, code)
        if not allowed:
            raise ForbiddenError(detail={"required_permission": code})
        return user

    return _dependency


async def get_current_staff(
    user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """직원 전용 게이트 — active 직원 5역할만 통과(비직원/비활성 → 403)."""
    role = await db.fetch_user_role(user.sub)
    if role not in STAFF_ROLES:
        raise ForbiddenError()
    return user
