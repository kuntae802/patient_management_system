"""DB 접근 — asyncpg pool + 인증된 트랜잭션 세션 (무ORM). 불변식은 DB가 소유.

FastAPI 는 service_role(여기선 로컬 postgres 슈퍼유저) 연결이라 RLS 를 우회하고 `auth.uid()`
가 NULL 이다. 따라서 권한 평가·감사 actor 가 동작하려면 트랜잭션마다 JWT 주체를 GUC 로 주입해야
한다(§Story1.5 D-2·D-3):

  * `request.jwt.claims` ← `{"sub": <uid>, "role": "authenticated"}`  → `auth.uid()` 해석
      → DB 함수 `has_permission()`/`auth_user_role()` 를 **그대로 재사용**(권한 로직 단일 진실).
  * `app.actor_id` ← `<uid>`  → 감사 트리거가 actor 를 정확히 기록(미설정 시 NULL).

⚠️ sub 는 반드시 검증된 UUID 만 주입한다 — 비-UUID 는 감사 트리거의 `::uuid` 캐스트를 터뜨려
   원본 트랜잭션 전체를 abort(자가-DoS, 1.3 P8). CurrentUser.sub(Pydantic UUID)로 보장.

ORM 모델 클래스 금지, Alembic 미사용(스키마 단일 소유 = Supabase 마이그레이션).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import unicodedata
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID

import asyncpg

from app.core.config import settings
from app.core.errors import (
    AppError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ServiceUnavailableError,
)

logger = logging.getLogger("app.db")

# DB 일시 장애로 간주해 503 으로 매핑할 예외(전면 500 금지, AC7). 풀 미초기화 RuntimeError 포함.
_DB_OUTAGE_ERRORS = (asyncpg.PostgresError, asyncpg.InterfaceError, OSError, asyncio.TimeoutError)

_pool: asyncpg.Pool | None = None


def _map_pg_sqlstate(exc: asyncpg.PostgresError) -> AppError | None:
    """DB SQLSTATE → 도메인 오류(Story 4.2 도입 — 내원 상태머신 RPC·전이 트리거 소비처).

    PT409/PT404 = 0010 커스텀(코어 미사용 클래스 'PT' → 충돌 없음), PT422 = 0014 커스텀
    (complete_encounter 주상병 미지정 게이트), 42501 = insufficient_privilege(RPC has_permission
    게이트 거부). 미매핑 SQLSTATE 는 None → 호출부가 일시 장애(503)로 폴백(_DB_OUTAGE_ERRORS posture
    유지). 4.4·4.7·Epic 6/7 이 동일 매핑 재사용(공유 인프라).
    """
    match getattr(exc, "sqlstate", None):
        case "PT409":  # 잘못된 상태 전이(역행·건너뛰기·종결 재전이·비정상 초기상태·소스상태 불일치)
            return ConflictError(code="invalid_transition")  # 409 "잘못된 상태 전이입니다."
        case "PT404":  # 대상 내원 없음(RPC for-update not found)
            return NotFoundError("내원을 찾을 수 없습니다.")
        case "PT422":  # 주상병 미지정 완료(complete_encounter 게이트, 4.7) — 검증 오류 422
            return AppError(
                "주상병을 1개 지정해야 합니다.",
                code="primary_diagnosis_required",
                status_code=422,
            )
        case "42501":  # insufficient_privilege — RPC has_permission 게이트 거부
            return ForbiddenError()
        case _:
            return None


async def _init_connection(conn: asyncpg.Connection) -> None:
    """새 물리 커넥션마다 jsonb 코덱 등록 — jsonb 컬럼을 raw text(str)가 아닌 dict/list 로 디코드.

    asyncpg 기본은 jsonb 를 JSON text 로 반환한다. audit_logs.before_data/after_data(Story 1.10)가
    코드베이스 최초의 jsonb 읽기 — 풀 단위로 한 번 등록해 이후 모든 jsonb 읽기가 파싱된 객체를 받게
    한다(per-query json.loads 산재 회피). 현재 jsonb 쓰기 경로는 없어 회귀 위험 없음.
    """
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def create_pool() -> asyncpg.Pool:
    """앱 시작 시 풀 생성(fail-fast — DB 도달 불가 시 부팅 실패)."""
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=settings.supabase_db_url,
            min_size=1,
            max_size=10,
            command_timeout=30,
            init=_init_connection,
        )
        logger.info("asyncpg 풀 생성 완료")
    return _pool


async def close_pool() -> None:
    """앱 종료 시 풀 정리."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("asyncpg 풀 종료")


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB 풀이 초기화되지 않음 — lifespan(create_pool) 확인")
    return _pool


@asynccontextmanager
async def authenticated_conn(sub: UUID) -> AsyncIterator[asyncpg.Connection]:
    """JWT 주체를 GUC 로 주입한 트랜잭션 커넥션을 yield 한다(모든 인증 DB 접근의 표준 토대).

    `set_config(..., is_local := true)` = 트랜잭션 로컬(=SET LOCAL). 후속 쓰기 엔드포인트가
    이 컨텍스트 안에서 명령을 실행하면 권한 평가·RLS·감사 actor 가 일관되게 동작한다.
    ⚠️ 권한평가와 쓰기는 **동일 트랜잭션**에서 수행해야 한다(별도 트랜잭션 시 평가↔쓰기 TOCTOU).
       감사 actor IP(`app.actor_ip` → `audit_logs.ip_address`)는 트리거 변경과 함께 후속 추가.
    """
    sub_text = str(UUID(str(sub)))  # 방어적 UUID 정규화(비-UUID → ValueError)
    claims = json.dumps({"sub": sub_text, "role": "authenticated"})
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("select set_config('request.jwt.claims', $1, true)", claims)
            await conn.execute("select set_config('app.actor_id', $1, true)", sub_text)
            yield conn


async def _run_authed[T](sub: UUID, op: Callable[[asyncpg.Connection], Awaitable[T]]) -> T:
    """인증 트랜잭션에서 op 를 실행하고 DB 장애를 503 으로 매핑한다(전면 500 금지, AC7)."""
    try:
        async with authenticated_conn(sub) as conn:
            return await op(conn)
    except RuntimeError as exc:  # 풀 미초기화(lifespan 미실행 등)
        logger.warning("DB 풀 미초기화: %s", exc)
        raise ServiceUnavailableError() from exc
    except asyncpg.PostgresError as exc:
        # 전이 RPC·트리거의 SQLSTATE(PT409/PT404/42501)는 도메인 오류로 매핑(4.2). 그 외 서버 오류는
        # 일시 장애(503)로 폴백(_DB_OUTAGE_ERRORS posture 유지 — PostgresError 가 그 첫 원소).
        mapped = _map_pg_sqlstate(exc)
        if mapped is not None:
            raise mapped from exc
        # 미매핑 SQLSTATE(연결 오류·미처리 제약 등)는 503 폴백 — sqlstate 를 남겨 영구 결함을 인프라
        # 장애로 오인하지 않게(메시지엔 PII 가능 → __name__·sqlstate 만, 본문 비노출).
        logger.warning("DB 접근 실패: %s (sqlstate=%s)", type(exc).__name__, exc.sqlstate)
        raise ServiceUnavailableError() from exc
    except _DB_OUTAGE_ERRORS as exc:  # 연결 끊김·풀 고갈·타임아웃(InterfaceError/OSError/Timeout)
        logger.warning("DB 접근 실패: %s", type(exc).__name__)
        raise ServiceUnavailableError() from exc


async def fetch_has_permission(sub: UUID, code: str) -> bool:
    """DB 함수 `has_permission(code)` 평가(휴직/퇴사자 필터·단일 진실 내장)."""

    async def _op(conn: asyncpg.Connection) -> bool:
        return bool(await conn.fetchval("select public.has_permission($1)", code))

    return await _run_authed(sub, _op)


async def fetch_user_role(sub: UUID) -> str | None:
    """active 직원의 역할 코드(`auth_user_role()`). 비직원/비활성 → None."""

    async def _op(conn: asyncpg.Connection) -> str | None:
        return await conn.fetchval("select public.auth_user_role()")

    return await _run_authed(sub, _op)


async def set_role_permission(
    sub: UUID, role_code: str, permission_code: str, *, granted: bool
) -> bool:
    """역할↔권한을 grant(true)/revoke(false) 한다 — 권한 재평가와 쓰기를 **동일 트랜잭션**에서 수행.

    `require_permission` 의존성이 별도 트랜잭션에서 한 번 평가하더라도, 쓰기 직전 같은 conn 에서
    `has_permission('rbac.manage')` 를 재평가해 평가↔쓰기 사이 권한/재직상태 변경(TOCTOU)을 차단한다
    (Story1.5 deferred 해소). INSERT/DELETE 는 0004 `trg_role_permissions_audit` 가 자동 감사하며
    (actor = `app.actor_id` = 호출 관리자), 앱은 감사 INSERT 를 직접 하지 않는다.

    반환 = 실제 변경 발생 여부. 멱등: 이미 있는 grant 재요청·없는 revoke → False(감사행 0).
    """

    async def _op(conn: asyncpg.Connection) -> bool:
        # 1) 권한 재평가(평가↔쓰기 원자성). 미보유 → 403.
        if not bool(await conn.fetchval("select public.has_permission('rbac.manage')")):
            raise ForbiddenError(detail={"required_permission": "rbac.manage"})

        # 2) 대상 역할 가드(id 해석 전 코드로 차단). admin = 전권 고정(자가-락아웃 방지),
        #    patient = 매트릭스 비대상(직무 RBAC 아님). UI 가 막지만 방어심층으로 서버도 거부.
        if role_code == "admin":
            raise ConflictError(
                "관리자 역할의 권한은 변경할 수 없습니다.",
                code="role_locked",
                detail={"role_code": role_code},
            )
        if role_code == "patient":
            raise AppError(
                "권한 매트릭스에서 변경할 수 없는 역할입니다.",
                code="invalid_target",
                status_code=422,
                detail={"role_code": role_code},
            )

        # 3) 코드 → id 해석(미존재 → 404).
        role_id = await conn.fetchval("select id from public.roles where code = $1", role_code)
        if role_id is None:
            raise NotFoundError(detail={"role_code": role_code})
        permission_id = await conn.fetchval(
            "select id from public.permissions where code = $1", permission_code
        )
        if permission_id is None:
            raise NotFoundError(detail={"permission_code": permission_code})

        # 4) grant=INSERT(멱등) / revoke=DELETE. 0004 트리거가 변경을 자동 감사.
        if granted:
            status = await conn.execute(
                "insert into public.role_permissions (role_id, permission_id) "
                "values ($1, $2) on conflict (role_id, permission_id) do nothing",
                role_id,
                permission_id,
            )
        else:
            status = await conn.execute(
                "delete from public.role_permissions where role_id = $1 and permission_id = $2",
                role_id,
                permission_id,
            )
        # asyncpg execute → "INSERT 0 1" / "DELETE 1" / "INSERT 0 0" 등. 마지막 토큰 = 영향 행 수.
        return int(status.split()[-1]) > 0

    return await _run_authed(sub, _op)


# 직원 프로필 컬럼(목록·생성·상태변경 공용 RETURNING/SELECT 셰이프). role_code = roles 조인.
_STAFF_COLUMNS = (
    "u.id, u.employee_no, u.name, r.code as role_code, u.employment_status, "
    "u.license_no, u.license_type, u.phone, u.hire_date, u.department_id, "
    "u.created_at, u.updated_at"
)


async def _resolve_role_id(conn: asyncpg.Connection, role_code: str) -> UUID:
    """role_code → role_id. patient = 직원 생성 비대상(422), 미존재 → 404.

    roles 는 5직원역할 + patient 만 존재하므로 patient 차단 + 404 면 staff 역할만 통과한다.
    """
    if role_code == "patient":
        raise AppError(
            "직원 계정으로 만들 수 없는 역할입니다.",
            code="invalid_target",
            status_code=422,
            detail={"role_code": role_code},
        )
    role_id = await conn.fetchval("select id from public.roles where code = $1", role_code)
    if role_id is None:
        raise NotFoundError(detail={"role_code": role_code})
    return role_id


async def insert_staff_profile(
    sub: UUID,
    *,
    uid: UUID,
    employee_no: str,
    name: str,
    role_code: str,
    license_no: str | None,
    license_type: str | None,
    phone: str | None,
    hire_date: object | None,
    department_id: UUID | None,
) -> asyncpg.Record:
    """`public.users` 프로필을 INSERT 한다 — 권한 재평가와 쓰기를 **동일 트랜잭션**에서 수행.

    `uid` 는 호출 서비스가 Supabase Auth 로 먼저 만든 사용자 id(=auth.users.id, FK). 0004
    `trg_users_audit` 가 INSERT 를 자동 감사(actor = `app.actor_id` = 호출 관리자). employee_no
    중복 → 409 `employee_no_taken`. employment_status 는 DB 기본값('active')를 따른다.
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        # 1) 권한 재평가(평가↔쓰기 원자성, TOCTOU 차단). 미보유 → 403.
        if not bool(await conn.fetchval("select public.has_permission('user.manage')")):
            raise ForbiddenError(detail={"required_permission": "user.manage"})

        # 2) role_code → id(patient 422 / 미존재 404).
        role_id = await _resolve_role_id(conn, role_code)

        # 3) INSERT(자동 감사). employee_no unique 위반 → 409.
        try:
            row = await conn.fetchrow(
                "insert into public.users "
                "(id, employee_no, name, role_id, license_no, license_type, phone, "
                " hire_date, department_id) "
                "values ($1, $2, $3, $4, $5, $6, $7, $8, $9) "
                "returning id, employee_no, name, "
                "(select code from public.roles where id = role_id) as role_code, "
                "employment_status, license_no, license_type, phone, hire_date, "
                "department_id, created_at, updated_at",
                uid,
                employee_no,
                name,
                role_id,
                license_no,
                license_type,
                phone,
                hire_date,
                department_id,
            )
        except asyncpg.UniqueViolationError as exc:
            if exc.constraint_name and "employee_no" in exc.constraint_name:
                raise ConflictError(
                    "이미 사용 중인 사번입니다.",
                    code="employee_no_taken",
                    detail={"employee_no": employee_no},
                ) from exc
            raise  # id(PK) 충돌 등 예기치 못한 위반 → 503 매핑(_run_authed)
        assert row is not None  # RETURNING 은 항상 1행
        return row

    return await _run_authed(sub, _op)


async def update_employment_status(sub: UUID, *, user_id: UUID, status: str) -> asyncpg.Record:
    """`users.employment_status` 를 갱신한다 — 권한 재평가 + 자가-락아웃 가드 + 자동 감사.

    DB 헬퍼(`has_permission`/`auth_user_role`)가 active 만 권한·역할을 인정하므로 이 UPDATE 한 번이
    접근 차단/복원의 데이터 권위다. 로그인(세션) 차단은 호출 서비스가 GoTrue ban 으로 보강한다.
    대상 미존재 → 404, 자기 자신 비활성화 → 409 `self_lockout`.
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        if not bool(await conn.fetchval("select public.has_permission('user.manage')")):
            raise ForbiddenError(detail={"required_permission": "user.manage"})

        exists = await conn.fetchval("select 1 from public.users where id = $1", user_id)
        if exists is None:
            raise NotFoundError(detail={"user_id": str(user_id)})

        # 자가-락아웃 방지: 관리자가 자신을 비활성하면 관리 경로가 끊긴다(1.7 admin-lock 동형).
        if user_id == sub and status != "active":
            raise ConflictError(
                "본인 계정은 비활성(휴직/퇴사)으로 변경할 수 없습니다.",
                code="self_lockout",
                detail={"user_id": str(user_id)},
            )

        row = await conn.fetchrow(
            "update public.users u set employment_status = $2, updated_at = now() "
            "where u.id = $1 "
            "returning u.id, u.employee_no, u.name, "
            "(select code from public.roles r where r.id = u.role_id) as role_code, "
            "u.employment_status, u.license_no, u.license_type, u.phone, u.hire_date, "
            "u.department_id, u.created_at, u.updated_at",
            user_id,
            status,
        )
        assert row is not None
        return row

    return await _run_authed(sub, _op)


async def update_user_department(
    sub: UUID, *, user_id: UUID, department_id: UUID | None
) -> asyncpg.Record:
    """`users.department_id` 배정/변경/해제 — 권한 재평가 + 진료과 배정 가능성 검증 + 자동 감사.

    대상 미존재 → 404. `department_id` 비-null 이면 `_assert_department_assignable` 로 미존재 422
    `invalid_department` · 비활성 422 `inactive_department`(insert_room/update_room 과 동일 가드 —
    단일 진실). None → 소속 해제(검증 불요). 검증·UPDATE 는 동일 트랜잭션(TOCTOU 차단). 변경은
    0004 감사 트리거가 자동 기록한다(actor = 호출 관리자).
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        if not bool(await conn.fetchval("select public.has_permission('user.manage')")):
            raise ForbiddenError(detail={"required_permission": "user.manage"})

        exists = await conn.fetchval("select 1 from public.users where id = $1", user_id)
        if exists is None:
            raise NotFoundError(detail={"user_id": str(user_id)})

        if department_id is not None:
            await _assert_department_assignable(conn, department_id)

        row = await conn.fetchrow(
            "update public.users u set department_id = $2, updated_at = now() "
            "where u.id = $1 "
            "returning u.id, u.employee_no, u.name, "
            "(select code from public.roles r where r.id = u.role_id) as role_code, "
            "u.employment_status, u.license_no, u.license_type, u.phone, u.hire_date, "
            "u.department_id, u.created_at, u.updated_at",
            user_id,
            department_id,
        )
        assert row is not None
        return row

    return await _run_authed(sub, _op)


async def fetch_staff_list(sub: UUID) -> list[asyncpg.Record]:
    """전 직원 프로필 목록(사번 순). service_role/postgres 풀이 RLS(본인행) 를 우회해 전원 반환.

    엔드포인트가 `require_permission('user.manage')` 로 이미 게이트하므로 읽기는 재평가 불요.
    """

    async def _op(conn: asyncpg.Connection) -> list[asyncpg.Record]:
        return await conn.fetch(
            f"select {_STAFF_COLUMNS} from public.users u "
            "join public.roles r on r.id = u.role_id "
            "order by u.employee_no"
        )

    return await _run_authed(sub, _op)


async def fetch_staff_identity(sub: UUID) -> dict[str, str | None]:
    """`/auth/me` 용 신원 — active 직원만 프로필 노출(퇴사/휴직자 role=None → 비노출)."""

    async def _op(conn: asyncpg.Connection) -> dict[str, str | None]:
        role = await conn.fetchval("select public.auth_user_role()")
        if role is None:
            # 비직원·비활성 → 프로필(employee_no·name) 비노출(role 과 일관, 정보 최소화).
            return {"role": None, "employee_no": None, "name": None}
        row = await conn.fetchrow("select employee_no, name from public.users where id = $1", sub)
        return {
            "role": role,
            "employee_no": row["employee_no"] if row else None,
            "name": row["name"] if row else None,
        }

    return await _run_authed(sub, _op)


# ── PII 암복호 프리미티브 래퍼(0005_crypto.sql) ───────────────────────────────
# 키는 Vault, 함수는 service_role 한정 SECURITY DEFINER(직접 클라 호출 불가). 환자 테이블·컬럼은
# Epic 3 가 만들고 이 래퍼들을 소비한다(본 스토리는 프리미티브 + 라운드트립/감사 검증까지).


async def encrypt_sensitive(sub: UUID, plaintext: str) -> bytes:
    """평문 PII → 암호문(bytea). 소비처(Epic 3)가 컬럼(`*_enc`)에 저장한다."""

    async def _op(conn: asyncpg.Connection) -> bytes:
        return await conn.fetchval("select public.encrypt_sensitive($1)", plaintext)

    return await _run_authed(sub, _op)


async def blind_index(sub: UUID, plaintext: str) -> str:
    """정규화된 PII → 결정적 HMAC 해시(중복 매칭, FR-003). 소비처가 컬럼(`*_hash`)+UNIQUE 로 저장.

    호출 전 `services.rrn.normalize_rrn` 등으로 정규화한 값을 넘긴다(같은 값 → 같은 해시 보장).
    """

    async def _op(conn: asyncpg.Connection) -> str:
        return await conn.fetchval("select public.blind_index($1)", plaintext)

    return await _run_authed(sub, _op)


async def decrypt_sensitive(
    sub: UUID, *, ciphertext: bytes, target_table: str, target_id: str
) -> str:
    """암호문 → 평문 + 복호 자가-감사('read' 이벤트, actor = `app.actor_id` = sub).

    복호 자체가 audit_logs 에 기록되므로(DB 강제) reveal 추적성이 보장된다. ⚠️ 반환 raw 값은 호출자가
    `services.rrn.mask_rrn` 으로 마스킹한 뒤에만 응답·로그에 노출한다(PII 경계). reveal 권한
    (`patient.reveal_rrn`) 게이트는 소비 엔드포인트(Epic 3/4)가 동일 트랜잭션에서 재평가한다.
    """

    async def _op(conn: asyncpg.Connection) -> str:
        return await conn.fetchval(
            "select public.decrypt_sensitive($1, $2, $3)", ciphertext, target_table, target_id
        )

    return await _run_authed(sub, _op)


# ── 감사 로그 조회(Story 1.10, FR-243) ─────────────────────────────────────────
# 읽기전용 — append-only 불변식은 0004 가 강제(이 경로는 SELECT 만 수행, 절대 INSERT/UPDATE/DELETE
# 안 함). actor 이름은 users LEFT JOIN(actor_id FK 미부착 → INNER 금지: NULL=시스템·환자 uid·삭제
# 직원은 매칭 미스로 보존). 조회는 require_permission('audit.read') 로 이미 게이트 → 재평가 불요
# (1.8 fetch_staff_list 동형). audit_logs SELECT RLS(0004)는 방어심층 2차선으로 유지된다.

# 목록 컬럼(고정). ip_address 는 ::text 캐스트(inet → 문자열, 현재 항상 NULL). actor 이름은 조인.
_AUDIT_COLUMNS = (
    "al.id, al.actor_id, u.name as actor_name, u.employee_no as actor_employee_no, "
    "al.action, al.target_table, al.target_id, al.before_data, al.after_data, "
    "al.ip_address::text as ip_address, al.created_at"
)


async def fetch_audit_logs(
    sub: UUID,
    *,
    actor_id: UUID | None = None,
    action: str | None = None,
    target_table: str | None = None,
    target_id: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[asyncpg.Record], int]:
    """감사 로그 페이지(행위자·기간·대상 필터, 최신순) + 필터 적용 전체 건수.

    반환: (행 리스트, total). idx_audit_logs_created_at 가 정렬/기간을, actor_id·target_table
    인덱스가 등호 필터를 받친다. WHERE 절은 동적 조립하되 **컬럼·연산자는 고정 리터럴**,
    값만 $n 바인딩으로 SQL injection 을 차단한다.
    """
    # (조건 SQL 조각, 값) — 전달된 필터만. 번호는 조립 시 부여. 모두 al.* 참조(count 시 무조인).
    filters: list[tuple[str, object]] = []
    if actor_id is not None:
        filters.append(("al.actor_id = ", actor_id))
    if action is not None:
        filters.append(("al.action = ", action))
    if target_table is not None:
        filters.append(("al.target_table = ", target_table))
    if target_id is not None:
        filters.append(("al.target_id = ", target_id))
    if date_from is not None:
        filters.append(("al.created_at >= ", date_from))
    if date_to is not None:
        filters.append(("al.created_at <= ", date_to))

    values: list[object] = [val for _frag, val in filters]
    where_sql = ""
    if filters:
        clauses = [f"{frag}${i}" for i, (frag, _val) in enumerate(filters, start=1)]
        where_sql = " where " + " and ".join(clauses)

    limit_pos = len(values) + 1
    offset_pos = len(values) + 2
    offset = (page - 1) * page_size

    list_sql = (
        f"select {_AUDIT_COLUMNS} from public.audit_logs al "
        "left join public.users u on u.id = al.actor_id"
        f"{where_sql} order by al.created_at desc limit ${limit_pos} offset ${offset_pos}"
    )
    count_sql = f"select count(*) from public.audit_logs al{where_sql}"

    async def _op(conn: asyncpg.Connection) -> tuple[list[asyncpg.Record], int]:
        rows = await conn.fetch(list_sql, *values, page_size, offset)
        total = int(await conn.fetchval(count_sql, *values) or 0)
        return rows, total

    return await _run_authed(sub, _op)


# ── 마스터(진료과·진료실) 쓰기(Story 2.1, FR-200·203) ───────────────────────────
# 쓰기 권위 = FastAPI(service_role). 권한 재평가+쓰기를 동일 트랜잭션에서 수행(평가↔쓰기 TOCTOU
# 차단, 1.5 이월·1.7/1.8 패턴). 0006 감사 트리거가 변경을 자동 기록(actor=app.actor_id=호출 관리자).
# 앱은 감사 INSERT 를 직접 하지 않는다. 읽기(목록)는 web 이 Supabase 직접조회(전역 참조 데이터).
# 컬럼 리스트는 고정 리터럴(사용자 입력 아님 → SQLi 무관), 값만 $n 바인딩.

_DEPT_COLUMNS = "id, code, name, description, is_active, created_at, updated_at"
_ROOM_COLUMNS = "id, code, name, department_id, is_active, created_at, updated_at"


async def _require_master_manage(conn: asyncpg.Connection) -> None:
    """쓰기 직전 동일 트랜잭션에서 master.manage 재평가(평가↔쓰기 TOCTOU 차단). 미보유 → 403."""
    if not bool(await conn.fetchval("select public.has_permission('master.manage')")):
        raise ForbiddenError(detail={"required_permission": "master.manage"})


async def insert_department(
    sub: UUID, *, code: str, name: str, description: str | None
) -> asyncpg.Record:
    """진료과 INSERT(자동 감사). code unique 위반 → 409 code_taken."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        try:
            row = await conn.fetchrow(
                f"insert into public.departments (code, name, description) "
                f"values ($1, $2, $3) returning {_DEPT_COLUMNS}",
                code,
                name,
                description,
            )
        except asyncpg.UniqueViolationError as exc:
            raise ConflictError(
                "이미 사용 중인 진료과 코드입니다.", code="code_taken", detail={"code": code}
            ) from exc
        assert row is not None  # RETURNING 은 항상 1행
        return row

    return await _run_authed(sub, _op)


async def update_department(
    sub: UUID, department_id: UUID, *, name: str, description: str | None
) -> asyncpg.Record:
    """진료과 수정(name·description). updated_at 명시 갱신. 미존재 → 404."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        row = await conn.fetchrow(
            f"update public.departments set name = $2, description = $3, updated_at = now() "
            f"where id = $1 returning {_DEPT_COLUMNS}",
            department_id,
            name,
            description,
        )
        if row is None:
            raise NotFoundError(detail={"department_id": str(department_id)})
        return row

    return await _run_authed(sub, _op)


async def set_department_active(
    sub: UUID, department_id: UUID, *, is_active: bool
) -> asyncpg.Record:
    """진료과 활성/비활성(soft delete) 토글. 물리 삭제 없이 is_active 만 갱신. 미존재 → 404."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        row = await conn.fetchrow(
            f"update public.departments set is_active = $2, updated_at = now() "
            f"where id = $1 returning {_DEPT_COLUMNS}",
            department_id,
            is_active,
        )
        if row is None:
            raise NotFoundError(detail={"department_id": str(department_id)})
        return row

    return await _run_authed(sub, _op)


async def _assert_department_assignable(conn: asyncpg.Connection, department_id: UUID) -> None:
    """신규 배정 대상 진료과가 존재 + 활성인지 동일 트랜잭션에서 검증(Story 2.4 / AC3 참조 무결성).

    미존재 → 422 invalid_department(FK 백스톱과 동일 코드). 비활성 → 422 inactive_department
    (UI 피커는 활성만 노출하나 API 권위 레벨에서 비활성 마스터로의 신규 배정을 차단 — 단일 진실).
    soft delete 만 하므로 물리 삭제는 없어 검사↔쓰기 사이 행 소멸은 불가(같은 tx 내 일관).
    """
    is_active = await conn.fetchval(
        "select is_active from public.departments where id = $1", department_id
    )
    if is_active is None:
        raise AppError(
            "존재하지 않는 진료과입니다.",
            code="invalid_department",
            status_code=422,
            detail={"department_id": str(department_id)},
        )
    if not is_active:
        raise AppError(
            "비활성된 진료과에는 새로 배정할 수 없습니다.",
            code="inactive_department",
            status_code=422,
            detail={"department_id": str(department_id)},
        )


async def count_department_dependents(sub: UUID, department_id: UUID) -> dict[str, int]:
    """진료과의 운영상 살아있는 참조 수(Story 2.4 / AC4): 활성 진료실 + 재직 직원.

    진료과 미존재 → 404. service_role 풀이 users RLS(본인행, 0003)를 우회하므로 직원 수 카운트가
    가능하다(클라 직접조회로는 불가 — 이 엔드포인트가 필요한 이유). 읽기이므로 권한 재평가는 불요
    (엔드포인트 require_master_manage 게이트로 충분 — fetch_staff_list·fetch_audit_logs 동형).

    ⚠️ 직원 = **재직(在職)**: `employment_status <> 'terminated'`(active + on_leave). 휴직 직원은
       현재 접근은 차단돼도 그 진료과에 여전히 *배정*돼 있어 복귀 시 영향받으므로 의존성에 포함한다
       (퇴사자만 제외 — 더는 소속 아님). 진료실은 활성만(비활성 진료실 ≈ 제거된 자원).
    """

    async def _op(conn: asyncpg.Connection) -> dict[str, int]:
        exists = await conn.fetchval(
            "select 1 from public.departments where id = $1", department_id
        )
        if exists is None:
            raise NotFoundError(detail={"department_id": str(department_id)})
        rooms = await conn.fetchval(
            "select count(*) from public.rooms where department_id = $1 and is_active = true",
            department_id,
        )
        staff = await conn.fetchval(
            "select count(*) from public.users "
            "where department_id = $1 and employment_status <> 'terminated'",
            department_id,
        )
        return {"rooms": int(rooms or 0), "staff": int(staff or 0)}

    return await _run_authed(sub, _op)


async def insert_room(
    sub: UUID, *, code: str, name: str, department_id: UUID | None
) -> asyncpg.Record:
    """진료실 INSERT(자동 감사). code 중복 → 409, 미존재 → 422 invalid_department,
    비활성 진료과 배정 → 422 inactive_department."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        # 신규 = 모든 비활성 배정 차단(AC3). 무소속(None)은 검사 불요.
        if department_id is not None:
            await _assert_department_assignable(conn, department_id)
        try:
            row = await conn.fetchrow(
                f"insert into public.rooms (code, name, department_id) "
                f"values ($1, $2, $3) returning {_ROOM_COLUMNS}",
                code,
                name,
                department_id,
            )
        except asyncpg.UniqueViolationError as exc:
            raise ConflictError(
                "이미 사용 중인 진료실 코드입니다.", code="code_taken", detail={"code": code}
            ) from exc
        except asyncpg.ForeignKeyViolationError as exc:  # 명시 검사 백스톱(레이스 대비)
            raise AppError(
                "존재하지 않는 진료과입니다.",
                code="invalid_department",
                status_code=422,
                detail={"department_id": str(department_id)},
            ) from exc
        assert row is not None
        return row

    return await _run_authed(sub, _op)


async def update_room(
    sub: UUID, room_id: UUID, *, name: str, department_id: UUID | None
) -> asyncpg.Record:
    """진료실 수정(name·department_id). 미존재 진료실 → 404, 미존재 진료과 → 422,
    비활성 진료과 신규 배정 → 422 inactive_department.

    AC3: 소속을 **변경**해 비활성 진료과로 새로 배정하면 거부하되, 현 소속(이미 비활성)을 그대로
    유지하는 수정은 허용한다(이탈 강요 금지 — room-form 의 '현 소속 유지' 옵션과 일치). 이를 위해
    현 소속을 먼저 읽어 변경분일 때만 활성 검사를 건다.
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        # 현 소속 + 존재 확인(없으면 404). NULL 소속과 "미존재 진료실"을 구분하려 id 도 함께 조회.
        current = await conn.fetchrow(
            "select id, department_id from public.rooms where id = $1", room_id
        )
        if current is None:
            raise NotFoundError(detail={"room_id": str(room_id)})
        # 소속을 **변경**할 때만 활성 검사(현 비활성 소속 유지는 허용).
        if department_id is not None and department_id != current["department_id"]:
            await _assert_department_assignable(conn, department_id)
        try:
            row = await conn.fetchrow(
                f"update public.rooms set name = $2, department_id = $3, updated_at = now() "
                f"where id = $1 returning {_ROOM_COLUMNS}",
                room_id,
                name,
                department_id,
            )
        except asyncpg.ForeignKeyViolationError as exc:  # 명시 검사 백스톱
            raise AppError(
                "존재하지 않는 진료과입니다.",
                code="invalid_department",
                status_code=422,
                detail={"department_id": str(department_id)},
            ) from exc
        # 선행 존재 확인 후 동일 tx UPDATE → 정상 1행. 이론적 race(행 소멸) 시 graceful 404.
        if row is None:
            raise NotFoundError(detail={"room_id": str(room_id)})
        return row

    return await _run_authed(sub, _op)


async def set_room_active(sub: UUID, room_id: UUID, *, is_active: bool) -> asyncpg.Record:
    """진료실 활성/비활성(soft delete) 토글. 미존재 → 404."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        row = await conn.fetchrow(
            f"update public.rooms set is_active = $2, updated_at = now() "
            f"where id = $1 returning {_ROOM_COLUMNS}",
            room_id,
            is_active,
        )
        if row is None:
            raise NotFoundError(detail={"room_id": str(room_id)})
        return row

    return await _run_authed(sub, _op)


# ── 코드 마스터(KCD 진단·EDI 수가·약품) — 버전·유효기간(발효/만료), Story 2.2 / FR-201 ────────
# departments(0006) 쓰기 패턴 그대로: _require_master_manage 동일 트랜잭션 재평가(TOCTOU) → DML.
# 0007 감사 트리거가 변경을 자동 기록(actor=app.actor_id). code unique 위반 → 409 code_taken.
# 유효기간 역전·금액 음수는 Pydantic 422 가 1차 차단, DB CHECK 가 최종선(정상경로 비도달).

_DIAGNOSIS_COLUMNS = (
    "id, code, name, effective_from, effective_to, is_active, created_at, updated_at"
)
_FEE_SCHEDULE_COLUMNS = (
    "id, code, name, amount_krw, category, effective_from, effective_to, "
    "is_active, created_at, updated_at"
)
_DRUG_COLUMNS = (
    "id, code, name, ingredient_code, unit, effective_from, effective_to, "
    "is_active, created_at, updated_at"
)


async def insert_diagnosis(
    sub: UUID, *, code: str, name: str, effective_from: date, effective_to: date | None
) -> asyncpg.Record:
    """KCD 진단 INSERT(자동 감사). code unique 위반 → 409 code_taken."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        try:
            row = await conn.fetchrow(
                f"insert into public.diagnoses (code, name, effective_from, effective_to) "
                f"values ($1, $2, $3, $4) returning {_DIAGNOSIS_COLUMNS}",
                code,
                name,
                effective_from,
                effective_to,
            )
        except asyncpg.UniqueViolationError as exc:
            raise ConflictError(
                "이미 사용 중인 진단 코드입니다.", code="code_taken", detail={"code": code}
            ) from exc
        assert row is not None
        return row

    return await _run_authed(sub, _op)


async def update_diagnosis(
    sub: UUID,
    diagnosis_id: UUID,
    *,
    name: str,
    effective_from: date,
    effective_to: date | None,
) -> asyncpg.Record:
    """KCD 진단 수정(name·유효기간). updated_at 명시 갱신. 미존재 → 404."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        row = await conn.fetchrow(
            f"update public.diagnoses set name = $2, effective_from = $3, effective_to = $4, "
            f"updated_at = now() where id = $1 returning {_DIAGNOSIS_COLUMNS}",
            diagnosis_id,
            name,
            effective_from,
            effective_to,
        )
        if row is None:
            raise NotFoundError(detail={"diagnosis_id": str(diagnosis_id)})
        return row

    return await _run_authed(sub, _op)


async def set_diagnosis_active(sub: UUID, diagnosis_id: UUID, *, is_active: bool) -> asyncpg.Record:
    """KCD 진단 활성/비활성(soft delete) 토글. 미존재 → 404."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        row = await conn.fetchrow(
            f"update public.diagnoses set is_active = $2, updated_at = now() "
            f"where id = $1 returning {_DIAGNOSIS_COLUMNS}",
            diagnosis_id,
            is_active,
        )
        if row is None:
            raise NotFoundError(detail={"diagnosis_id": str(diagnosis_id)})
        return row

    return await _run_authed(sub, _op)


async def insert_fee_schedule(
    sub: UUID,
    *,
    code: str,
    name: str,
    amount_krw: int,
    category: str | None,
    effective_from: date,
    effective_to: date | None,
) -> asyncpg.Record:
    """EDI 수가 INSERT(자동 감사). code unique 위반 → 409 code_taken."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        try:
            row = await conn.fetchrow(
                f"insert into public.fee_schedules "
                f"(code, name, amount_krw, category, effective_from, effective_to) "
                f"values ($1, $2, $3, $4, $5, $6) returning {_FEE_SCHEDULE_COLUMNS}",
                code,
                name,
                amount_krw,
                category,
                effective_from,
                effective_to,
            )
        except asyncpg.UniqueViolationError as exc:
            raise ConflictError(
                "이미 사용 중인 수가 코드입니다.", code="code_taken", detail={"code": code}
            ) from exc
        assert row is not None
        return row

    return await _run_authed(sub, _op)


async def update_fee_schedule(
    sub: UUID,
    fee_schedule_id: UUID,
    *,
    name: str,
    amount_krw: int,
    category: str | None,
    effective_from: date,
    effective_to: date | None,
) -> asyncpg.Record:
    """EDI 수가 수정(name·amount_krw·category·유효기간). 미존재 → 404."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        row = await conn.fetchrow(
            f"update public.fee_schedules set name = $2, amount_krw = $3, category = $4, "
            f"effective_from = $5, effective_to = $6, updated_at = now() "
            f"where id = $1 returning {_FEE_SCHEDULE_COLUMNS}",
            fee_schedule_id,
            name,
            amount_krw,
            category,
            effective_from,
            effective_to,
        )
        if row is None:
            raise NotFoundError(detail={"fee_schedule_id": str(fee_schedule_id)})
        return row

    return await _run_authed(sub, _op)


async def set_fee_schedule_active(
    sub: UUID, fee_schedule_id: UUID, *, is_active: bool
) -> asyncpg.Record:
    """EDI 수가 활성/비활성(soft delete) 토글. 미존재 → 404."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        row = await conn.fetchrow(
            f"update public.fee_schedules set is_active = $2, updated_at = now() "
            f"where id = $1 returning {_FEE_SCHEDULE_COLUMNS}",
            fee_schedule_id,
            is_active,
        )
        if row is None:
            raise NotFoundError(detail={"fee_schedule_id": str(fee_schedule_id)})
        return row

    return await _run_authed(sub, _op)


async def insert_drug(
    sub: UUID,
    *,
    code: str,
    name: str,
    ingredient_code: str | None,
    unit: str | None,
    effective_from: date,
    effective_to: date | None,
) -> asyncpg.Record:
    """약품 INSERT(자동 감사). code unique 위반 → 409 code_taken."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        try:
            row = await conn.fetchrow(
                f"insert into public.drugs "
                f"(code, name, ingredient_code, unit, effective_from, effective_to) "
                f"values ($1, $2, $3, $4, $5, $6) returning {_DRUG_COLUMNS}",
                code,
                name,
                ingredient_code,
                unit,
                effective_from,
                effective_to,
            )
        except asyncpg.UniqueViolationError as exc:
            raise ConflictError(
                "이미 사용 중인 약품 코드입니다.", code="code_taken", detail={"code": code}
            ) from exc
        assert row is not None
        return row

    return await _run_authed(sub, _op)


async def update_drug(
    sub: UUID,
    drug_id: UUID,
    *,
    name: str,
    ingredient_code: str | None,
    unit: str | None,
    effective_from: date,
    effective_to: date | None,
) -> asyncpg.Record:
    """약품 수정(name·주성분·단위·유효기간). 미존재 → 404."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        row = await conn.fetchrow(
            f"update public.drugs set name = $2, ingredient_code = $3, unit = $4, "
            f"effective_from = $5, effective_to = $6, updated_at = now() "
            f"where id = $1 returning {_DRUG_COLUMNS}",
            drug_id,
            name,
            ingredient_code,
            unit,
            effective_from,
            effective_to,
        )
        if row is None:
            raise NotFoundError(detail={"drug_id": str(drug_id)})
        return row

    return await _run_authed(sub, _op)


async def set_drug_active(sub: UUID, drug_id: UUID, *, is_active: bool) -> asyncpg.Record:
    """약품 활성/비활성(soft delete) 토글. 미존재 → 404."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        row = await conn.fetchrow(
            f"update public.drugs set is_active = $2, updated_at = now() "
            f"where id = $1 returning {_DRUG_COLUMNS}",
            drug_id,
            is_active,
        )
        if row is None:
            raise NotFoundError(detail={"drug_id": str(drug_id)})
        return row

    return await _run_authed(sub, _op)


# ── 환자(patients) 쓰기·읽기(Story 3.1, FR-002·003·240) ─────────────────────────
# 쓰기 권위 = FastAPI(service_role). 권한 재평가+암호화+INSERT 를 **동일 트랜잭션**에서(평가↔쓰기
# TOCTOU 차단, 1.5 이월). 주민번호는 0005 프리미티브로 enc/hash 산출 — raw 평문은 컬럼에 저장하지
# 않는다(_enc=암호문·_hash=blind index·_masked=표시값). 읽기는 마스킹 컬럼만 투영(_enc/_hash 제외 —
# RLS 행 + 컬럼 GRANT(0009)에 더한 응답 투영 방어심층). 0009 감사 트리거가 변경을 자동 기록.
# 컬럼 리스트는 고정 리터럴(사용자 입력 아님), 값만 $n 바인딩.

# 응답·RETURNING 투영(절대 resident_no_enc/_hash 미포함 — PII 경계). 임상 5필드 포함(Story 3.2).
_PATIENT_COLUMNS = (
    "id, chart_no, name, birth_date, sex, resident_no_masked, "
    "phone, address, email, insurance_type, insurance_no, "
    "blood_type, allergies, chronic_diseases, medications, notes, "
    "is_active, created_at, updated_at"
)
_PATIENT_LIST_COLUMNS = (
    "id, chart_no, name, birth_date, sex, resident_no_masked, phone, is_active, created_at"
)
# 자가연결 확인 요약(Story 3.4) — 마스킹·식별 최소 컬럼(_enc/_hash/auth_uid 미투영, PII 경계).
_SELF_SUMMARY_COLUMNS = "id, chart_no, name, birth_date, sex, resident_no_masked"


def _norm_name(name: str) -> str:
    """성명 일치 비교용 정규화 — 유니코드 NFC + 앞뒤 공백 제거 + 내부 연속 공백 1개로 축약.

    NFC 정규화: iOS/macOS 가 분해형(NFD) 한글을 보내고 저장값이 조합형(NFC)이면 바이트가 달라
    오거부(identity_mismatch)된다 → 양쪽을 NFC 로 모아 비교. 한국어 성명은 대소문자 무관이라
    소문자화 불요. self-link 의 사칭 방지 1차선(시뮬 시대)에서 같은 canonical 형태로 비교한다."""
    return unicodedata.normalize("NFC", " ".join(name.split()))


async def _require_patient_create(conn: asyncpg.Connection) -> None:
    """쓰기 직전 동일 트랜잭션에서 patient.create 재평가(평가↔쓰기 TOCTOU 차단). 미보유 → 403."""
    if not bool(await conn.fetchval("select public.has_permission('patient.create')")):
        raise ForbiddenError(detail={"required_permission": "patient.create"})


async def _require_patient_update(conn: asyncpg.Connection) -> None:
    """쓰기 직전 동일 트랜잭션에서 patient.update 재평가(평가↔쓰기 TOCTOU 차단). 미보유 → 403."""
    if not bool(await conn.fetchval("select public.has_permission('patient.update')")):
        raise ForbiddenError(detail={"required_permission": "patient.update"})


async def insert_patient(
    sub: UUID,
    *,
    normalized_rrn: str,
    masked_rrn: str,
    birth_date: date,
    sex: str,
    name: str,
    phone: str | None,
    address: str | None,
    email: str | None,
    insurance_type: str,
    insurance_no: str | None,
) -> asyncpg.Record:
    """환자 INSERT(자동 감사). 주민번호 중복(resident_no_hash UNIQUE) → 409 patient_exists.

    enc/hash 는 정규화된 주민번호(normalized_rrn)에서 산출 — 두 값이 같은 canonical 입력을 쓰도록
    보장(정규화 누락 시 중복 매칭·UNIQUE 붕괴 방지, A-1 이월). chart_no/auth_uid(NULL)/임상 프로필은
    기본값/NULL. 중복 시 SAVEPOINT(중첩 트랜잭션) 롤백 후 기존 chart_no 를 조회해 detail 에 담는다
    (원무가 기존 환자로 이동하도록 — chart_no 는 PII 아님).
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_patient_create(conn)
        # 0005 프리미티브로 암호문·blind index 산출(같은 정규화 입력). 부작용 없음(테이블 미기록).
        enc = await conn.fetchval("select public.encrypt_sensitive($1)", normalized_rrn)
        hashed = await conn.fetchval("select public.blind_index($1)", normalized_rrn)
        try:
            # 중첩 트랜잭션 = SAVEPOINT: UNIQUE 위반 시 여기만 롤백되고 바깥 트랜잭션은 살아남아
            # 기존 chart_no 를 조회할 수 있다(바깥에서 잡으면 트랜잭션 abort 로 후속 조회 불가).
            async with conn.transaction():
                row = await conn.fetchrow(
                    f"insert into public.patients "
                    f"(name, birth_date, sex, resident_no_enc, resident_no_hash, "
                    f"resident_no_masked, phone, address, email, insurance_type, insurance_no) "
                    f"values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) "
                    f"returning {_PATIENT_COLUMNS}",
                    name,
                    birth_date,
                    sex,
                    enc,
                    hashed,
                    masked_rrn,
                    phone,
                    address,
                    email,
                    insurance_type,
                    insurance_no,
                )
        except asyncpg.UniqueViolationError as exc:
            existing_chart_no = await conn.fetchval(
                "select chart_no from public.patients where resident_no_hash = $1", hashed
            )
            raise ConflictError(
                "이미 등록된 주민번호입니다.",
                code="patient_exists",
                detail={"chart_no": existing_chart_no},
            ) from exc
        assert row is not None  # RETURNING 은 항상 1행
        return row

    return await _run_authed(sub, _op)


async def fetch_patients(
    sub: UUID, *, q: str | None = None, page: int = 1, page_size: int = 50
) -> tuple[list[asyncpg.Record], int]:
    """환자 목록 페이지(최신순, 마스킹 컬럼만) + 전체 건수. 게이트(patient.read)는 라우터가 강제.

    q(검색어, Story 3.5)가 주어지면 이름(부분일치)·차트번호(부분일치)·연락처(자릿수 부분일치)로
    필터한다 — q 가 None/공백이면 전체 목록(최신순). phone 은 자유 형식(하이픈 등) 저장이라 비숫자를
    제거한 자릿수끼리 비교한다(입력도 동일 정규화 → 010-1234 == 0101234). q 는 PII(이름·연락처)라
    로그에 남기지 않는다(파라미터 바인딩 = 인젝션 안전 + LIKE 메타문자(%·_)는 리터럴 이스케이프 —
    `q="%"` 같은 와일드카드로 공백-차단을 우회해 전체 행을 끌어오지 못하게).

    service_role 경로라 RLS 우회 — 직원 목록 접근 권위는 라우터 require_permission('patient.read')
    (읽기 TOCTOU 저위험 → 재평가 불요, fetch_audit_logs 동형). 마스킹 컬럼만 투영(_enc/_hash 제외).
    검색 인덱스: 이름=idx_patients_name·차트번호=UNIQUE(0009). phone 은 인덱스 없음(MVP ILIKE 수용 —
    성능 인덱스는 하드닝 이월, 다음 마이그레이션 0010 은 Epic 4 예약이라 본 경로는 DDL 무변경).
    """
    offset = (page - 1) * page_size
    term = (q or "").strip()
    digits = re.sub(r"\D", "", term)
    # LIKE 메타문자 리터럴화(기본 escape '\') — 사용자 입력 %·_ 가 와일드카드로 해석되지 않게.
    like_term = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    async def _op(conn: asyncpg.Connection) -> tuple[list[asyncpg.Record], int]:
        if not term:
            rows = await conn.fetch(
                f"select {_PATIENT_LIST_COLUMNS} from public.patients "
                f"order by created_at desc limit $1 offset $2",
                page_size,
                offset,
            )
            total = int(await conn.fetchval("select count(*) from public.patients") or 0)
            return rows, total

        # 이름·차트번호 부분일치(이스케이프 term) + (자릿수면) 연락처 자릿수 부분일치. OR 결합.
        conds = ["name ilike '%'||$1||'%'", "chart_no ilike '%'||$1||'%'"]
        params: list[object] = [like_term]
        if digits:
            params.append(digits)
            conds.append(
                f"regexp_replace(coalesce(phone,''),'[^0-9]','','g') like '%'||${len(params)}||'%'"
            )
        where = " or ".join(conds)
        limit_idx, offset_idx = len(params) + 1, len(params) + 2
        rows = await conn.fetch(
            f"select {_PATIENT_LIST_COLUMNS} from public.patients where {where} "
            f"order by name asc, created_at desc limit ${limit_idx} offset ${offset_idx}",
            *params,
            page_size,
            offset,
        )
        total = int(
            await conn.fetchval(f"select count(*) from public.patients where {where}", *params) or 0
        )
        return rows, total

    return await _run_authed(sub, _op)


async def fetch_patient(sub: UUID, patient_id: UUID) -> asyncpg.Record | None:
    """환자 상세(마스킹 + 임상 프로필 컬럼). 미존재 → None(서비스가 404 매핑)."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record | None:
        return await conn.fetchrow(
            f"select {_PATIENT_COLUMNS} from public.patients where id = $1", patient_id
        )

    return await _run_authed(sub, _op)


async def update_patient_clinical_profile(
    sub: UUID,
    patient_id: UUID,
    *,
    blood_type: str | None,
    allergies: str | None,
    chronic_diseases: str | None,
    medications: str | None,
    notes: str | None,
) -> asyncpg.Record | None:
    """임상 프로필 갱신(Story 3.2, FR-004). 5필드 전체 교체(PUT 의미) + updated_at 명시 갱신.

    쓰기 권위 = service_role(authenticated 는 patients UPDATE 권한 없음, 0009). 게이트(라우터
    require_permission)는 방어심층, **진짜 권위는 _op 안 _require_patient_update 동일 트랜잭션
    재평가(TOCTOU 차단, insert_patient 동형)**. 미존재 → None(서비스가 404). 갱신은 0009 감사
    트리거가 자동 기록(actor=GUC sub). 임상필드는 암호화 대상 아님(평문 저장).
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record | None:
        await _require_patient_update(conn)
        return await conn.fetchrow(
            f"update public.patients set "
            f"blood_type = $2, allergies = $3, chronic_diseases = $4, "
            f"medications = $5, notes = $6, updated_at = now() "
            f"where id = $1 returning {_PATIENT_COLUMNS}",
            patient_id,
            blood_type,
            allergies,
            chronic_diseases,
            medications,
            notes,
        )

    return await _run_authed(sub, _op)


# ── 민감정보 reveal(Story 4.5, FR-241·242 / UX-DR9·22) ───────────────────────────
# 진료 허브 배너의 주민번호·연락처 열람 = 권한 게이트 + 감사. 메커니즘 = 0012 SECURITY DEFINER RPC:
# RPC 안에서 has_permission 동일-txn 재평가(42501)·미존재(PT404)·감사(RRN=decrypt_sensitive 자동·
# 연락처=수동 'read' insert) → _map_pg_sqlstate 가 403/404 자동 변환(여기 try/except·신규 매핑 불요,
# call_start_consult 동형). resident_no_enc 는 authenticated GRANT 제외라 RPC(definer)만 복호 가능.


async def reveal_rrn(sub: UUID, patient_id: UUID) -> str:
    """주민번호 복호(full RRN) + 'read' 자가-감사. 게이트=patient.reveal_rrn(RPC 내부 재평가).

    ⚠️ 반환 raw RRN 은 호출 서비스가 응답 바디로만 노출 — 로그·toast·에러봉투 echo 금지(PII 경계).
    권한 미보유 → 42501(→403), 미존재 → PT404(→404). 복호=감사는 0012/0005 가 DB 강제(우회 불가)."""

    async def _op(conn: asyncpg.Connection) -> str:
        return await conn.fetchval("select public.reveal_rrn($1)", patient_id)

    return await _run_authed(sub, _op)


async def reveal_contact(sub: UUID, patient_id: UUID) -> asyncpg.Record:
    """연락처(phone·address·email) full 조회 + 'read' 자가-감사. 게이트=patient.reveal_contact.

    table-returning RPC → 단일 행. RPC 가 미존재 시 PT404 raise 하므로 row 는 항상 non-None
    (call_start_consult 의 assert 동형). 권한 미보유 → 42501(→403)."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        row = await conn.fetchrow("select * from public.reveal_contact($1)", patient_id)
        assert row is not None  # RPC 가 not-found 를 PT404 로 raise → 도달 시 항상 1행
        return row

    return await _run_authed(sub, _op)


# ── 앱 자가가입 본인 연결(Story 3.4, FR-001·FR-003) ──────────────────────────────
# 가입(세션)한 환자가 `blind_index(normalize_rrn)` 로 기존 레코드를 찾아 `auth_uid` 를 본인 JWT 주체
# (sub)로 설정한다. service_role 연결(RLS 우회)이라 cross-patient hash 조회 가능(본인행 RLS 로
# 막히지 않음 — self-link 를 FastAPI 경유로 두는 이유). 쓰기 권위 = service_role(authenticated 는
# patients UPDATE 권한 없음). 연결 대상 auth_uid 는 **인자 sub 에서만** 도출(클라 미수용).


async def link_self_patient(
    sub: UUID, *, normalized_rrn: str, name: str
) -> tuple[str, asyncpg.Record | None]:
    """자가연결 — `blind_index` 매칭 → 안전 분기. (outcome, row|None) 반환(서비스가 HTTP 매핑).

    outcome: `linked`(신규 연결)·`already_linked`(본인 멱등)·`account_already_linked`(이 계정이 이미
    다른 환자에 연결)·`no_patient_record`(0건)·`identity_mismatch`(성명 불일치, 연결 안 함)·
    `already_linked_other`(다른 계정 선점). 연결 UPDATE = 0009 감사 트리거 기록(actor=sub)."""

    async def _op(conn: asyncpg.Connection) -> tuple[str, asyncpg.Record | None]:
        # 같은 계정(sub) self-link 직렬화 — 동시 2-RRN 연결 레이스 차단(1 계정 = 1 환자).
        # auth_uid 에 DB UNIQUE 가 없어(0009 비유니크 인덱스) 아래 check-then-act(선점 SELECT ↔
        # 조건부 UPDATE)가 비원자 → 트랜잭션 advisory lock 으로 같은 sub 동시 호출을 직렬화한다
        # (마이그레이션 불요 — partial unique index 는 Epic 4 0010 에서 방어심층으로 검토).
        await conn.execute(
            "select pg_advisory_xact_lock(hashtext('patient_self_link'), hashtext($1))",
            str(sub),
        )
        hashed = await conn.fetchval("select public.blind_index($1)", normalized_rrn)

        # 1) 계정 선점 검사(1 계정 = 1 환자 불변식) — 이 sub 가 이미 환자에 연결돼 있나?
        own = await conn.fetchrow(
            f"select resident_no_hash, {_SELF_SUMMARY_COLUMNS} "
            f"from public.patients where auth_uid = $1",
            sub,
        )
        if own is not None:
            # 같은 주민번호면 멱등 성공(재시도·중복 제출 안전), 다른 환자면 계정 중복 연결 차단.
            if own["resident_no_hash"] == hashed:
                return "already_linked", own
            return "account_already_linked", None

        # 2) 대상 조회(resident_no_hash UNIQUE → 최대 1행).
        target = await conn.fetchrow(
            f"select auth_uid, name, {_SELF_SUMMARY_COLUMNS} "
            f"from public.patients where resident_no_hash = $1",
            hashed,
        )
        if target is None:
            return "no_patient_record", None
        if target["auth_uid"] is not None:
            # 이미 연결됨 — 본인이면 멱등, 타 계정이면 탈취 차단.
            if target["auth_uid"] == sub:
                return "already_linked", target
            return "already_linked_other", None

        # 3) 미연결 행 — 사칭 방지 1차선: 성명 일치(시뮬 시대; 실 PASS 가 RRN 소유 증명 시 대체).
        if _norm_name(target["name"]) != _norm_name(name):
            return "identity_mismatch", None

        # 4) 조건부 연결(동시성: auth_uid IS NULL 술어로 1명만 통과).
        row = await conn.fetchrow(
            f"update public.patients set auth_uid = $1, updated_at = now() "
            f"where id = $2 and auth_uid is null returning {_SELF_SUMMARY_COLUMNS}",
            sub,
            target["id"],
        )
        if row is None:
            # 0행 = 동시 연결 레이스. 누가 선점했는지 재조회(같은 계정 더블서밋=멱등 vs 타 계정).
            winner = await conn.fetchrow(
                f"select auth_uid, {_SELF_SUMMARY_COLUMNS} from public.patients where id = $1",
                target["id"],
            )
            if winner is not None and winner["auth_uid"] == sub:
                return "already_linked", winner
            return "already_linked_other", None
        return "linked", row

    return await _run_authed(sub, _op)


async def fetch_self_patient(sub: UUID) -> asyncpg.Record | None:
    """본인(JWT sub)에 연결된 환자 요약 — 미연결 → None(자가연결 진입 UX·멱등 분기용)."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record | None:
        return await conn.fetchrow(
            f"select {_SELF_SUMMARY_COLUMNS} from public.patients where auth_uid = $1", sub
        )

    return await _run_authed(sub, _op)


# 환자 포털 "내 기록" 카드(Story 8.1) — 내원 메타 + denormalized 표시(진료과·담당의) + 예약 시각
# + 활성 주상병(0014) 1건 + 쉬운 말 부연(0054). 컬럼/별칭은 고정 리터럴(사용자 입력 아님 → SQLi
# 무관), 값만 $n 바인딩. ⚠️ raw RRN/연락처/patient_id 미투영(비-PII, 세션 uid 스코프).
_SELF_ENCOUNTER_CARD_COLUMNS = (
    "e.id, e.encounter_no, e.status, e.visit_type, e.registered_at, e.consult_started_at, "
    "e.completed_at, e.cancelled_at, e.created_at, e.cancel_reason, "
    "d.name as department_name, doc.name as doctor_name, a.scheduled_start as scheduled_start, "
    "pdx.diagnosis_name as primary_diagnosis_name, "
    "pdx.patient_friendly_note as primary_diagnosis_friendly_note"
)


async def fetch_self_encounters(sub: UUID) -> list[asyncpg.Record]:
    """본인(JWT sub) 내원 이력 카드 목록(환자 포털 '내 기록', Story 8.1 / FR-120). 최근순.

    ⚠️ service_role 경로라 RLS 우회 — 본인 스코프는 **where p.auth_uid = $1(=sub)** 가 경계선이다
    (RLS encounters_select_self/encounter_diagnoses_select_self(0010·0014)는 직접조회용 심층방어).
    patient_id 인자 없음(세션 uid 스코프 — 클라 미수용). 미연결(auth_uid 0행)이면 빈 목록(프런트는
    GET /patients/self 404 로 온보딩 유도). 게이트=라우터 get_current_patient(직원 403).

    조인: departments(진료과명)·users(담당의명)·appointments(예약 시각) + LATERAL 활성 주상병
    1건(0014 is_primary + diagnoses 0054 friendly_note). 한 환자 내원 수는 적어 안전 상한 limit
    100(초과 tail 절단). 정렬키 = coalesce(진찰시작·접수·예약시각·생성) 최근순(상태 무관 일관)."""

    async def _op(conn: asyncpg.Connection) -> list[asyncpg.Record]:
        return await conn.fetch(
            f"select {_SELF_ENCOUNTER_CARD_COLUMNS} from public.encounters e "
            "join public.patients p on p.id = e.patient_id "
            "join public.departments d on d.id = e.department_id "
            "left join public.users doc on doc.id = e.doctor_id "
            "left join public.appointments a on a.id = e.reservation_id "
            "left join lateral ("
            "  select dg.name as diagnosis_name, dg.patient_friendly_note "
            "  from public.encounter_diagnoses ed "
            "  join public.diagnoses dg on dg.id = ed.diagnosis_id "
            "  where ed.encounter_id = e.id and ed.is_active = true and ed.is_primary = true "
            "  order by ed.created_at asc limit 1"
            ") pdx on true "
            "where p.auth_uid = $1 and e.is_active = true "
            "order by coalesce(e.consult_started_at, e.registered_at, a.scheduled_start, "
            "e.created_at) desc "
            "limit 100",
            sub,
        )

    return await _run_authed(sub, _op)


# ── 보호자(guardians) 쓰기·읽기(Story 3.3, FR-006) ──────────────────────────────
# 보호자 = 환자의 sub-resource(1:N). 쓰기 권위 = FastAPI(service_role) — authenticated 는
# guardians 쓰기 권한 없음(0009 GRANT·RLS 쓰기정책 부재). 추가·수정·삭제는 모두 "환자 정보
# 수정" → patient.update 게이트(라우터) + in-txn 재평가(TOCTOU, A-2 연속). 수정·삭제는
# patient_id 스코프(타 환자 보호자 교차수정 IDOR 차단). guardians 는 암호 컬럼·is_active 없음
# → 삭제=hard DELETE(0009 감사 트리거가 추적). trg_guardians_audit 가 insert/update/delete 를
# 자동 기록(actor=GUC sub). 컬럼=고정 리터럴.

_GUARDIAN_COLUMNS = "id, patient_id, name, relationship, phone, created_at, updated_at"


async def fetch_guardians(sub: UUID, patient_id: UUID) -> list[asyncpg.Record]:
    """환자의 보호자 목록(등록순). 읽기 게이트(patient.read)는 라우터가 강제(읽기 TOCTOU 저위험 →
    재평가 불요, fetch_patients 동형). 환자 미존재여도 빈 목록(존재 보장은 상세 GET 이 담당)."""

    async def _op(conn: asyncpg.Connection) -> list[asyncpg.Record]:
        return await conn.fetch(
            f"select {_GUARDIAN_COLUMNS} from public.guardians "
            f"where patient_id = $1 order by created_at",
            patient_id,
        )

    return await _run_authed(sub, _op)


async def insert_guardian(
    sub: UUID,
    patient_id: UUID,
    *,
    name: str,
    relationship: str,
    phone: str | None,
) -> asyncpg.Record:
    """보호자 추가(자동 감사). 환자 미존재 → FK 위반 → NotFoundError(404).

    SAVEPOINT 불요(후속 조회 없음 — insert_patient 와 달리). 게이트(라우터 require_permission)는
    방어심층, 진짜 권위는 _op 안 _require_patient_update 동일 트랜잭션 재평가(TOCTOU 차단).
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_patient_update(conn)
        try:
            row = await conn.fetchrow(
                f"insert into public.guardians (patient_id, name, relationship, phone) "
                f"values ($1, $2, $3, $4) returning {_GUARDIAN_COLUMNS}",
                patient_id,
                name,
                relationship,
                phone,
            )
        except asyncpg.ForeignKeyViolationError as exc:
            # patient_id 미존재 → 미존재·권한밖을 동일 404(존재 누설 회피, fetch_patient 동형).
            raise NotFoundError("환자를 찾을 수 없습니다.") from exc
        assert row is not None  # RETURNING 은 항상 1행
        return row

    return await _run_authed(sub, _op)


async def update_guardian(
    sub: UUID,
    patient_id: UUID,
    guardian_id: UUID,
    *,
    name: str,
    relationship: str,
    phone: str | None,
) -> asyncpg.Record | None:
    """보호자 수정(PUT 전체 교체) + updated_at 갱신. patient_id 스코프(IDOR 차단). 0행 → None(404).

    쓰기 권위 = service_role. 게이트(라우터)는 방어심층, 진짜 권위는 _op 안 _require_patient_update
    동일 트랜잭션 재평가(TOCTOU, update_patient_clinical_profile 동형). 갱신=0009 감사 트리거 기록.
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record | None:
        await _require_patient_update(conn)
        return await conn.fetchrow(
            f"update public.guardians set "
            f"name = $3, relationship = $4, phone = $5, updated_at = now() "
            f"where id = $1 and patient_id = $2 returning {_GUARDIAN_COLUMNS}",
            guardian_id,
            patient_id,
            name,
            relationship,
            phone,
        )

    return await _run_authed(sub, _op)


async def delete_guardian(sub: UUID, patient_id: UUID, guardian_id: UUID) -> UUID | None:
    """보호자 hard delete(guardians 무 is_active). patient_id 스코프(IDOR 차단). 0행 → None(404).

    삭제는 0009 trg_guardians_audit(after delete)가 before_data 스냅샷으로 추적성 보장. 게이트
    (라우터)는 방어심층, 진짜 권위는 _op 안 _require_patient_update 동일 트랜잭션 재평가(TOCTOU).
    """

    async def _op(conn: asyncpg.Connection) -> UUID | None:
        await _require_patient_update(conn)
        return await conn.fetchval(
            "delete from public.guardians where id = $1 and patient_id = $2 returning id",
            guardian_id,
            patient_id,
        )

    return await _run_authed(sub, _op)


# ── 내원(encounters) — walk-in 접수 생성 + 전이 RPC 소비(Story 4.2). 상태머신·감사는 DB(0010). ──
# 쓰기 권위 = FastAPI(service_role). walk-in 은 register_encounter RPC 미경유 직접 INSERT(초기상태
# 가드가 registered 허용) — registered_at·created_by 를 INSERT 시 충전(4.1 handoff: RPC 미경유라
# 그대로면 NULL). 예약(reserved) 접수는 register_encounter RPC(scheduled→registered). 전이 트리거·
# 감사 트리거(0010)가 상태머신·append-only 감사를 강제하므로 앱은 오케스트레이션만(재구현 금지).
# encounters 는 비-PII(patient_id=FK·encounter_no=사람용 번호) → 컬럼 투영 자유(마스킹 불요).
_ENCOUNTER_COLUMNS = (
    "id, encounter_no, patient_id, department_id, room_id, doctor_id, "
    "visit_type, status, cancel_reason, registered_at, consult_started_at, "
    "completed_at, cancelled_at, no_show_at, called_at, call_count, last_called_by, "
    "created_by, is_active, created_at, updated_at"
)

# 대기 현황판 목록(Story 4.3) — 내원 + 호출 상태 + denormalized 표시 필드(조인). 컬럼/별칭은 고정
# 리터럴(사용자 입력 아님 → SQLi 무관), 값만 $n 바인딩. raw RRN/연락처 미투영(비-PII, UX-DR22).
_ENCOUNTER_LIST_COLUMNS = (
    "e.id, e.encounter_no, e.patient_id, e.department_id, e.room_id, e.doctor_id, "
    "e.visit_type, e.status, e.registered_at, e.consult_started_at, e.called_at, "
    "e.call_count, e.is_active, e.created_at, "
    "p.name as patient_name, p.chart_no, d.name as department_name, "
    "rm.name as room_name, doc.name as doctor_name"
)

# 활성도 순 그룹 정렬키(대기판 UX-DR7). 6값을 0~5 로 매핑:
# in_progress→registered→scheduled→completed→cancelled→no_show.
_ENCOUNTER_ACTIVITY_ORDER = (
    "case e.status when 'in_progress' then 0 when 'registered' then 1 "
    "when 'scheduled' then 2 when 'completed' then 3 when 'cancelled' then 4 else 5 end"
)


async def _require_encounter_register(conn: asyncpg.Connection) -> None:
    """쓰기 직전 동일 트랜잭션에서 encounter.register 재평가(평가↔쓰기 TOCTOU 차단). 미보유 → 403.

    라우터 require_permission 게이트는 방어심층 — 진짜 권위는 이 동일 트랜잭션 재평가(권한 변경과
    쓰기 사이 레이스 차단, insert_patient 선례). 예약 접수(register_encounter RPC)는 RPC 내부
    has_permission 이 동일 역할을 하므로 본 헬퍼는 walk-in 직접 INSERT 전용.
    """
    if not bool(await conn.fetchval("select public.has_permission('encounter.register')")):
        raise ForbiddenError(detail={"required_permission": "encounter.register"})


async def insert_walk_in_encounter(
    sub: UUID,
    *,
    patient_id: UUID,
    department_id: UUID,
    created_by: UUID,
    room_id: UUID | None = None,
) -> asyncpg.Record:
    """walk-in 내원 INSERT(status='registered'·visit_type='walk_in', 자동 감사·대기열 진입).

    INSERT 자체가 대기열 등록(department_id + status='registered' 행 = 그 진료과 대기열, 4.3 소비).
    registered_at=now()·created_by 충전(4.1 handoff). 환자·진료과는 존재+활성을 동일 트랜잭션에서
    선검사(FK 위반 전에 명시 오류) — 미존재 404, 비활성(soft-deleted/폐과) 422. 권한은 INSERT 직전
    재평가(TOCTOU). 비정상 초기상태 등은 0010 전이 트리거가 PT409(→409) 최종 차단(방어심층).
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_encounter_register(conn)
        # 환자 존재+활성(비활성=soft-deleted 환자 접수 차단). is_active 이월의 생성 경로분 청산.
        patient_active = await conn.fetchval(
            "select is_active from public.patients where id = $1", patient_id
        )
        if patient_active is None:
            raise NotFoundError("환자를 찾을 수 없습니다.", detail={"patient_id": str(patient_id)})
        if not patient_active:
            raise AppError(
                "비활성 환자는 접수할 수 없습니다.",
                code="patient_inactive",
                status_code=422,
                detail={"patient_id": str(patient_id)},
            )
        # 진료과 존재+활성(폐과 대기열 진입 차단).
        dept_active = await conn.fetchval(
            "select is_active from public.departments where id = $1", department_id
        )
        if dept_active is None:
            raise NotFoundError(
                "진료과를 찾을 수 없습니다.", detail={"department_id": str(department_id)}
            )
        if not dept_active:
            raise AppError(
                "비활성 진료과로는 접수할 수 없습니다.",
                code="department_inactive",
                status_code=422,
                detail={"department_id": str(department_id)},
            )
        try:
            row = await conn.fetchrow(
                f"insert into public.encounters "
                f"(patient_id, department_id, room_id, visit_type, status, "
                f"registered_at, created_by) "
                f"values ($1, $2, $3, 'walk_in', 'registered', now(), $4) "
                f"returning {_ENCOUNTER_COLUMNS}",
                patient_id,
                department_id,
                room_id,
                created_by,
            )
        except asyncpg.ForeignKeyViolationError as exc:
            # 명시 백스톱(insert_room 패턴) — room_id 미선검사(미배정 허용·4.4 배정): 미존재 진료실
            # 지정 시 FK 위반(23503). patient/dept 는 선검사하나 동시 삭제 레이스 시 여기로.
            # 23503 은 _map_pg_sqlstate 미매핑 → 백스톱 없으면 503 오분류(입력 오류는 422).
            raise AppError(
                "참조 대상이 올바르지 않습니다(진료실 등).",
                code="invalid_reference",
                status_code=422,
            ) from exc
        assert row is not None  # RETURNING 은 항상 1행
        return row

    return await _run_authed(sub, _op)


async def call_register_encounter(sub: UUID, encounter_id: UUID) -> asyncpg.Record:
    """register_encounter RPC 호출(scheduled→registered, 예약 환자 도착 접수).

    RPC 내부 has_permission(42501)·소스상태/종결 재전이(PT409)·not-found(PT404)를 raise →
    _run_authed 의 _map_pg_sqlstate 가 Forbidden/Conflict/NotFound 로 변환(여기 try/except 불요).
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        row = await conn.fetchrow("select * from public.register_encounter($1)", encounter_id)
        assert row is not None  # RPC 성공 시 returns encounters → 항상 1행
        return row

    return await _run_authed(sub, _op)


async def fetch_encounter(sub: UUID, encounter_id: UUID) -> asyncpg.Record | None:
    """내원 단건 조회(접수 결과·상세 확인). 0행 → None(서비스가 404). 목록·대기 현황판은 4.3.

    service_role 경로라 RLS 우회 — 조회 권위는 라우터 require_permission('encounter.read')
    (읽기 TOCTOU 저위험 → 재평가 불요, fetch_patient 동형). RLS 는 web 직접조회 방어심층(0010).
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record | None:
        return await conn.fetchrow(
            f"select {_ENCOUNTER_COLUMNS} from public.encounters where id = $1", encounter_id
        )

    return await _run_authed(sub, _op)


async def fetch_encounters(
    sub: UUID,
    *,
    department_id: UUID,
    statuses: list[str] | None = None,
    on_date: date,
    page: int = 1,
    page_size: int = 200,
) -> tuple[list[asyncpg.Record], int]:
    """대기 현황판 목록(진료과 × 일자 × 상태, 활성도 순) + 필터 적용 전체 건수(Story 4.3).

    반환: (행 리스트, total). idx_encounters_dept_status(0010)가 진료과×상태 조회를 받친다. WHERE 는
    동적 조립하되 **컬럼·연산자는 고정 리터럴**, 값만 $n 바인딩(SQLi 차단, fetch_audit_logs 패턴).
    일자는 created_at 의 KST 날짜(walk-in 은 created_at≈registered_at). 표시 필드는 조인이지만
    필터·count 는 e.* 만 참조(무조인 count). 게이트=라우터 encounter.read(읽기 TOCTOU 저위험).
    """
    clauses: list[str] = []
    values: list[object] = []

    def _add(frag_left: str, val: object, frag_right: str = "") -> None:
        values.append(val)
        clauses.append(f"{frag_left}${len(values)}{frag_right}")

    _add("e.department_id = ", department_id)
    _add("(e.created_at at time zone 'Asia/Seoul')::date = ", on_date)
    _add("e.is_active = ", True)
    if statuses:
        _add("e.status = any(", statuses, "::text[])")  # 상태 필터(미지정 시 전체 6값)

    where_sql = " where " + " and ".join(clauses)
    limit_pos = len(values) + 1
    offset_pos = len(values) + 2
    offset = (page - 1) * page_size

    list_sql = (
        f"select {_ENCOUNTER_LIST_COLUMNS} from public.encounters e "
        "join public.patients p on p.id = e.patient_id "
        "join public.departments d on d.id = e.department_id "
        "left join public.rooms rm on rm.id = e.room_id "
        "left join public.users doc on doc.id = e.doctor_id"
        f"{where_sql} order by {_ENCOUNTER_ACTIVITY_ORDER}, "
        f"e.registered_at asc nulls last, e.encounter_no asc "
        f"limit ${limit_pos} offset ${offset_pos}"
    )
    count_sql = f"select count(*) from public.encounters e{where_sql}"

    async def _op(conn: asyncpg.Connection) -> tuple[list[asyncpg.Record], int]:
        rows = await conn.fetch(list_sql, *values, page_size, offset)
        total = int(await conn.fetchval(count_sql, *values) or 0)
        return rows, total

    return await _run_authed(sub, _op)


async def fetch_patient_encounters(sub: UUID, patient_id: UUID) -> list[asyncpg.Record]:
    """한 환자의 과거 내원 이력(진료 허브 좌 컨텍스트, Story 4.5 / FR-031). 진료과 무관·최근순.

    대기 현황판의 denormalized 조인(`_ENCOUNTER_LIST_COLUMNS` — 진료과·담당의)을 재사용하되 WHERE 는
    `patient_id`(이 환자 전체 내원), ORDER 는 최근순(registered_at desc → created_at). 비-PII 투영
    (raw RRN/연락처 제외, EncounterListItem). 게이트=라우터 encounter.read(읽기 TOCTOU 저위험,
    fetch_encounters 동형). 한 환자 내원 수는 적어 페이지네이션 불요(안전 상한 limit 100)."""

    async def _op(conn: asyncpg.Connection) -> list[asyncpg.Record]:
        return await conn.fetch(
            f"select {_ENCOUNTER_LIST_COLUMNS} from public.encounters e "
            "join public.patients p on p.id = e.patient_id "
            "join public.departments d on d.id = e.department_id "
            "left join public.rooms rm on rm.id = e.room_id "
            "left join public.users doc on doc.id = e.doctor_id "
            "where e.patient_id = $1 and e.is_active = true "
            "order by e.registered_at desc nulls last, e.created_at desc "
            "limit 100",
            patient_id,
        )

    return await _run_authed(sub, _op)


async def call_encounter(sub: UUID, encounter_id: UUID) -> asyncpg.Record:
    """record_encounter_call RPC 호출(호출 상태 기록 — registered 행에 called_at/count 갱신).

    호출은 상태 전이가 아님(status 불변) — RPC 가 has_permission(42501)·소스상태(PT409)·not-found
    (PT404)를 raise → _map_pg_sqlstate 가 Forbidden/Conflict/NotFound 로 변환(여기 try/except 불요,
    call_register_encounter 동형). returns public.encounters → 호출 컬럼 포함 전체 행 반환.
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        row = await conn.fetchrow("select * from public.record_encounter_call($1)", encounter_id)
        assert row is not None  # RPC 성공 시 returns encounters → 항상 1행
        return row

    return await _run_authed(sub, _op)


async def call_start_consult(sub: UUID, encounter_id: UUID) -> asyncpg.Record:
    """start_consult RPC 호출(registered→in_progress, 의사 진찰 시작; 담당의=호출자).

    RPC 내부 has_permission('encounter.start')(42501)·소스상태 precondition status<>'registered'
    (PT409 — 미접수/종결/이미 진행중 차단, NFR-040 재수행·진료 탈취 방지)·not-found(PT404)를 raise →
    _run_authed 의 _map_pg_sqlstate 가 Forbidden/Conflict/NotFound 로 변환(여기 try/except 불요,
    call_encounter/call_register_encounter 동형). returns public.encounters → 전체 행 반환
    (consult_started_at·doctor_id=auth.uid() 세팅 반영).
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        row = await conn.fetchrow("select * from public.start_consult($1)", encounter_id)
        assert row is not None  # RPC 성공 시 returns encounters → 항상 1행
        return row

    return await _run_authed(sub, _op)


# ── SOAP 진료기록(medical_records, Story 4.6) — 0013 테이블 직접 INSERT/UPDATE/SELECT ──
# 쓰기는 service_role 직접 쓰기(전이 RPC 아님 — SOAP 는 상태머신/불변식 없는 자유텍스트). 권한은
# INSERT/UPDATE 직전 동일 트랜잭션 재평가(TOCTOU, insert_walk_in_encounter 선례). 감사=0013 트리거.
_MEDICAL_RECORD_COLUMNS = (
    "id, encounter_id, author_id, subjective, objective, assessment, plan, "
    "is_active, created_at, updated_at"
)


async def _require_medical_record_write(conn: asyncpg.Connection) -> None:
    """쓰기 직전 동일 트랜잭션에서 medical_record.write 재평가(평가↔쓰기 TOCTOU 차단). 미보유 → 403.

    라우터 require_permission 게이트는 방어심층 — 진짜 권위는 이 동일 트랜잭션 재평가
    (_require_encounter_register 선례).
    """
    if not bool(await conn.fetchval("select public.has_permission('medical_record.write')")):
        raise ForbiddenError(detail={"required_permission": "medical_record.write"})


async def insert_medical_record(
    sub: UUID,
    *,
    encounter_id: UUID,
    author_id: UUID,
    subjective: str | None,
    objective: str | None,
    assessment: str | None,
    plan: str | None,
) -> asyncpg.Record:
    """SOAP 진료기록 INSERT(한 내원 1:N, 자동 감사). author_id=작성 의사(jwt sub).

    내원 존재를 동일 트랜잭션에서 선검사(미존재 404 — FK 위반 전 명시 오류). status 하드 게이트는
    두지 않는다(§결정 4 — 작성 윈도우 잠금은 deferred; 웹이 in_progress 에서만 노출). 권한은 INSERT
    직전 재평가(TOCTOU). 동시 삭제 레이스 등 FK 위반(23503)은 422 백스톱(insert_walk_in 선례).
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_medical_record_write(conn)
        exists = await conn.fetchval(
            "select true from public.encounters where id = $1", encounter_id
        )
        if exists is None:
            raise NotFoundError(
                "내원을 찾을 수 없습니다.", detail={"encounter_id": str(encounter_id)}
            )
        try:
            row = await conn.fetchrow(
                f"insert into public.medical_records "
                f"(encounter_id, author_id, subjective, objective, assessment, plan) "
                f"values ($1, $2, $3, $4, $5, $6) "
                f"returning {_MEDICAL_RECORD_COLUMNS}",
                encounter_id,
                author_id,
                subjective,
                objective,
                assessment,
                plan,
            )
        except asyncpg.ForeignKeyViolationError as exc:
            # 선검사 후 동시 삭제 레이스 등 23503 → 입력 오류 422(미매핑 시 503 오분류).
            raise AppError(
                "참조 대상이 올바르지 않습니다(내원 등).",
                code="invalid_reference",
                status_code=422,
            ) from exc
        assert row is not None  # RETURNING 은 항상 1행
        return row

    return await _run_authed(sub, _op)


async def update_medical_record(
    sub: UUID,
    *,
    encounter_id: UUID,
    record_id: UUID,
    subjective: str | None,
    objective: str | None,
    assessment: str | None,
    plan: str | None,
) -> asyncpg.Record:
    """SOAP 진료기록 UPDATE(autosave 전체 교체 — 4 파트 전부 세팅, clinical-profile PUT 선례).

    `where id=record_id and encounter_id=encounter_id`(경로 일관·교차 내원 갱신 차단). 미존재/불일치
    → 404. author 강제는 미적용(같은 내원 권한 보유 의사면 갱신 허용 — 작성자 스코프는 웹 UX 가 활성
    기록 선택으로 보장; 서버 author 강제는 over-restrictive). updated_at=감사 'update' 행.
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_medical_record_write(conn)
        row = await conn.fetchrow(
            f"update public.medical_records "
            f"set subjective = $1, objective = $2, assessment = $3, plan = $4, updated_at = now() "
            f"where id = $5 and encounter_id = $6 "
            f"returning {_MEDICAL_RECORD_COLUMNS}",
            subjective,
            objective,
            assessment,
            plan,
            record_id,
            encounter_id,
        )
        if row is None:
            raise NotFoundError(
                "진료기록을 찾을 수 없습니다.", detail={"record_id": str(record_id)}
            )
        return row

    return await _run_authed(sub, _op)


async def fetch_medical_records(sub: UUID, encounter_id: UUID) -> list[asyncpg.Record]:
    """한 내원의 SOAP 진료기록 목록(최근순·활성만, 안전 상한 200).

    service_role 경로라 RLS 우회 — 조회 권위는 라우터 require_permission('medical_record.read')
    (읽기 TOCTOU 저위험 → 재평가 불요, fetch_encounter 동형). 한 내원 기록 수가 적어 페이지네이션 X.
    """

    async def _op(conn: asyncpg.Connection) -> list[asyncpg.Record]:
        return await conn.fetch(
            f"select {_MEDICAL_RECORD_COLUMNS} from public.medical_records "
            f"where encounter_id = $1 and is_active = true "
            f"order by created_at desc, id desc "  # id 타이브레이커(동일 타임스탬프 결정적 정렬)
            f"limit 200",
            encounter_id,
        )

    return await _run_authed(sub, _op)


# ── 내원진단(encounter_diagnoses, Story 4.7) — 0014 테이블 직접 INSERT/UPDATE + complete RPC ──
# 부착/토글/제거는 service_role 직접 쓰기(전이 RPC 아님 — 진단 부착은 자유 CRUD). 권한은 쓰기 직전
# 동일 트랜잭션 재평가(TOCTOU, medical_records 선례). 주상병 강등은 부착·토글과 같은 트랜잭션(부분
# unique uq_encounter_diagnoses_primary 가 최종선). 완료는 0010/0014 complete_encounter RPC(전이).
# 응답 = diagnoses 마스터 조인(code·name 합성). 감사=0014 트리거(diagnosis_id=FK → 마스킹 불요).
_ENCOUNTER_DIAGNOSIS_COLUMNS = (
    "ed.id, ed.encounter_id, ed.diagnosis_id, d.code as diagnosis_code, d.name as diagnosis_name, "
    "ed.is_primary, ed.recorded_by, ed.is_active, ed.created_at, ed.updated_at"
)
_ENCOUNTER_DIAGNOSIS_FROM = (
    "from public.encounter_diagnoses ed join public.diagnoses d on d.id = ed.diagnosis_id"
)


async def _require_diagnosis_attach(conn: asyncpg.Connection) -> None:
    """쓰기 직전 동일 트랜잭션에서 diagnosis.attach 재평가(평가↔쓰기 TOCTOU 차단). 미보유 → 403."""
    if not bool(await conn.fetchval("select public.has_permission('diagnosis.attach')")):
        raise ForbiddenError(detail={"required_permission": "diagnosis.attach"})


async def _fetch_encounter_diagnosis_by_id(
    conn: asyncpg.Connection, ed_id: UUID
) -> asyncpg.Record | None:
    """부착 진단 단건(마스터 조인) — 쓰기 후 응답용(INSERT/UPDATE RETURNING 은 조인 불가)."""
    return await conn.fetchrow(
        f"select {_ENCOUNTER_DIAGNOSIS_COLUMNS} {_ENCOUNTER_DIAGNOSIS_FROM} where ed.id = $1",
        ed_id,
    )


async def attach_diagnosis(
    sub: UUID, *, encounter_id: UUID, diagnosis_id: UUID, is_primary: bool, recorded_by: UUID
) -> asyncpg.Record:
    """내원에 KCD 진단 부착(자동 감사). recorded_by=부착 의사(jwt sub).

    내원 존재를 동일 트랜잭션에서 선검사(미존재 404). is_primary=true 면 기존 활성 주상병을 먼저
    강등(같은 txn — 주상병 ≤1 수렴, 부분 unique 가 최종선). 같은 코드 활성 중복(uq_dup) → 409,
    잘못된 diagnosis_id/encounter_id(23503) → 422 백스톱(insert_medical_record 선례). 권한 재평가.
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_diagnosis_attach(conn)
        exists = await conn.fetchval(
            "select true from public.encounters where id = $1", encounter_id
        )
        if exists is None:
            raise NotFoundError(
                "내원을 찾을 수 없습니다.", detail={"encounter_id": str(encounter_id)}
            )
        if is_primary:
            # 기존 활성 주상병 강등(같은 txn) — 부분 unique uq_..._primary 충돌 회피.
            await conn.execute(
                "update public.encounter_diagnoses set is_primary = false, updated_at = now() "
                "where encounter_id = $1 and is_primary = true and is_active = true",
                encounter_id,
            )
        try:
            row = await conn.fetchrow(
                "insert into public.encounter_diagnoses "
                "(encounter_id, diagnosis_id, is_primary, recorded_by) "
                "values ($1, $2, $3, $4) returning id",
                encounter_id,
                diagnosis_id,
                is_primary,
                recorded_by,
            )
        except asyncpg.UniqueViolationError as exc:
            # uq_encounter_diagnoses_dup(같은 내원 같은 코드 활성 중복).
            raise ConflictError(
                "이미 부착된 진단입니다.",
                code="diagnosis_already_attached",
                detail={"diagnosis_id": str(diagnosis_id)},
            ) from exc
        except asyncpg.ForeignKeyViolationError as exc:
            # 잘못된 diagnosis_id(또는 동시 삭제 레이스의 encounter_id) 23503 → 입력 오류 422.
            raise AppError(
                "참조 대상이 올바르지 않습니다(진단·내원).",
                code="invalid_reference",
                status_code=422,
            ) from exc
        assert row is not None
        joined = await _fetch_encounter_diagnosis_by_id(conn, row["id"])
        assert joined is not None
        return joined

    return await _run_authed(sub, _op)


async def set_diagnosis_primary(
    sub: UUID, *, encounter_id: UUID, ed_id: UUID, is_primary: bool
) -> asyncpg.Record:
    """부착 진단의 주/부상병 토글(자동 감사). is_primary=true 면 기존 주상병 강등(같은 txn).

    `where id=ed_id and encounter_id=encounter_id`(경로 일관·교차 내원 갱신 차단). 미존재 → 404.
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_diagnosis_attach(conn)
        if is_primary:
            await conn.execute(
                "update public.encounter_diagnoses set is_primary = false, updated_at = now() "
                "where encounter_id = $1 and is_primary = true and is_active = true and id <> $2",
                encounter_id,
                ed_id,
            )
        updated = await conn.fetchrow(
            "update public.encounter_diagnoses set is_primary = $1, updated_at = now() "
            "where id = $2 and encounter_id = $3 and is_active = true returning id",
            is_primary,
            ed_id,
            encounter_id,
        )
        if updated is None:
            raise NotFoundError(
                "내원진단을 찾을 수 없습니다.", detail={"diagnosis_attachment_id": str(ed_id)}
            )
        joined = await _fetch_encounter_diagnosis_by_id(conn, ed_id)
        assert joined is not None
        return joined

    return await _run_authed(sub, _op)


async def remove_diagnosis(sub: UUID, *, encounter_id: UUID, ed_id: UUID) -> None:
    """부착 진단 제거(soft delete — is_active=false, 자동 감사). 미존재/불일치 → 404.

    제거 후 같은 코드 재부착 허용(부분 unique 가 where is_active 라 비활성 행 무시).
    """

    async def _op(conn: asyncpg.Connection) -> None:
        await _require_diagnosis_attach(conn)
        removed = await conn.fetchrow(
            "update public.encounter_diagnoses set is_active = false, updated_at = now() "
            "where id = $1 and encounter_id = $2 and is_active = true returning id",
            ed_id,
            encounter_id,
        )
        if removed is None:
            raise NotFoundError(
                "내원진단을 찾을 수 없습니다.", detail={"diagnosis_attachment_id": str(ed_id)}
            )

    await _run_authed(sub, _op)


async def fetch_encounter_diagnoses(sub: UUID, encounter_id: UUID) -> list[asyncpg.Record]:
    """한 내원의 부착 진단 목록(주상병 우선·부착순, 활성만). 게이트=라우터(diagnosis.read).

    service_role 경로라 RLS 우회 — 조회 권위는 라우터 require_permission(읽기 TOCTOU 저위험).
    """

    async def _op(conn: asyncpg.Connection) -> list[asyncpg.Record]:
        return await conn.fetch(
            f"select {_ENCOUNTER_DIAGNOSIS_COLUMNS} {_ENCOUNTER_DIAGNOSIS_FROM} "
            f"where ed.encounter_id = $1 and ed.is_active = true "
            f"order by ed.is_primary desc, ed.created_at asc, ed.id asc",
            encounter_id,
        )

    return await _run_authed(sub, _op)


async def call_complete_encounter(sub: UUID, encounter_id: UUID) -> asyncpg.Record:
    """complete_encounter RPC 호출(in_progress→completed, 주상병 게이트; FR-042·UX-DR18).

    RPC 내부 has_permission('encounter.complete')(42501)·소스상태 status<>'in_progress'(PT409)·
    not-found(PT404)·**주상병 미지정(PT422 — is_primary 활성 진단 0)** 을 raise → _run_authed 의
    _map_pg_sqlstate 가 403/409/404/422 로 변환(여기 try/except 불요, call_start_consult 동형).
    returns public.encounters → 전체 행(completed_at 세팅 반영).
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        row = await conn.fetchrow("select * from public.complete_encounter($1)", encounter_id)
        assert row is not None  # RPC 성공 시 returns encounters → 항상 1행
        return row

    return await _run_authed(sub, _op)


# ══════════════════════════════════════════════════════════════════════════════
# 근무표 · 휴진 (Story 6.1 — 0030_doctor_schedules) — 관리자 관리 config(masters 미러)
# 쓰기 = service_role + master.manage(_require_master_manage 동일-txn 재평가). 읽기(목록)는 web 이
# Supabase 직접조회(전역 참조). 겹침 = DB EXCLUDE(23P01) → 409 schedule_overlap(code_taken 동형).
# ══════════════════════════════════════════════════════════════════════════════

_DOCTOR_SCHEDULE_COLUMNS = (
    "id, doctor_id, department_id, room_id, weekday, start_time, end_time, "
    "is_active, created_at, updated_at"
)
_DOCTOR_TIME_OFF_COLUMNS = (
    "id, doctor_id, start_at, end_at, reason, is_active, created_at, updated_at"
)


async def _assert_doctor_assignable(conn: asyncpg.Connection, doctor_id: UUID) -> None:
    """배정 대상이 존재 + 의사(role=doctor) + 재직(active)인지 동일 트랜잭션에서 검증.

    미존재/비-의사 → 422 invalid_doctor, 휴직/퇴사 → 422 inactive_doctor(department 헬퍼의
    invalid/inactive 2코드 패턴 동형). doctor_id FK 는 users 전체를 가리키므로 역할까지 좁혀야
    한다(원무·간호를 의사 슬롯에 배정 차단).
    """
    row = await conn.fetchrow(
        "select u.employment_status, r.code as role_code "
        "from public.users u join public.roles r on r.id = u.role_id where u.id = $1",
        doctor_id,
    )
    if row is None or row["role_code"] != "doctor":
        raise AppError(
            "존재하지 않거나 의사가 아닌 직원입니다.",
            code="invalid_doctor",
            status_code=422,
            detail={"doctor_id": str(doctor_id)},
        )
    if row["employment_status"] != "active":
        raise AppError(
            "재직 중이 아닌 의사에게는 근무표를 배정할 수 없습니다.",
            code="inactive_doctor",
            status_code=422,
            detail={"doctor_id": str(doctor_id)},
        )


async def _assert_room_assignable(conn: asyncpg.Connection, room_id: UUID) -> None:
    """배정 대상 진료실이 존재 + 활성인지 검증(_assert_department_assignable 동형). 미존재 → 422
    invalid_room, 비활성 → 422 inactive_room."""
    is_active = await conn.fetchval("select is_active from public.rooms where id = $1", room_id)
    if is_active is None:
        raise AppError(
            "존재하지 않는 진료실입니다.",
            code="invalid_room",
            status_code=422,
            detail={"room_id": str(room_id)},
        )
    if not is_active:
        raise AppError(
            "비활성된 진료실에는 새로 배정할 수 없습니다.",
            code="inactive_room",
            status_code=422,
            detail={"room_id": str(room_id)},
        )


def _schedule_overlap_error() -> ConflictError:
    """근무표 겹침 EXCLUDE(23P01) → 409 schedule_overlap(masters code_taken 패턴)."""
    return ConflictError(
        "같은 의사·요일에 시간이 겹치는 근무표가 있습니다.", code="schedule_overlap"
    )


async def insert_doctor_schedule(
    sub: UUID,
    *,
    doctor_id: UUID,
    department_id: UUID,
    room_id: UUID | None,
    weekday: int,
    start_time: time,
    end_time: time,
) -> asyncpg.Record:
    """근무표 INSERT(자동 감사). 겹침 → 409, 비활성/미존재 의사·진료과·진료실 → 422."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        await _assert_doctor_assignable(conn, doctor_id)
        await _assert_department_assignable(conn, department_id)
        if room_id is not None:
            await _assert_room_assignable(conn, room_id)
        try:
            row = await conn.fetchrow(
                f"insert into public.doctor_schedules "
                f"(doctor_id, department_id, room_id, weekday, start_time, end_time) "
                f"values ($1, $2, $3, $4, $5, $6) returning {_DOCTOR_SCHEDULE_COLUMNS}",
                doctor_id,
                department_id,
                room_id,
                weekday,
                start_time,
                end_time,
            )
        except asyncpg.ExclusionViolationError as exc:
            raise _schedule_overlap_error() from exc
        except asyncpg.ForeignKeyViolationError as exc:  # 명시 검사 백스톱(레이스 대비)
            raise AppError(
                "존재하지 않는 참조입니다.", code="invalid_reference", status_code=422
            ) from exc
        assert row is not None
        return row

    return await _run_authed(sub, _op)


async def update_doctor_schedule(
    sub: UUID,
    schedule_id: UUID,
    *,
    doctor_id: UUID,
    department_id: UUID,
    room_id: UUID | None,
    weekday: int,
    start_time: time,
    end_time: time,
) -> asyncpg.Record:
    """근무표 수정(전 필드 교체). 미존재 → 404, 겹침 → 409, 변경된 FK 비활성/미존재 → 422.

    FK 활성 검사는 **변경분만**(현 값 유지는 허용 — update_room AC3 패턴). soft delete 만 하므로
    현 row 읽기↔UPDATE 사이 행 소멸은 불가(같은 tx).
    """

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        current = await conn.fetchrow(
            "select doctor_id, department_id, room_id from public.doctor_schedules where id = $1",
            schedule_id,
        )
        if current is None:
            raise NotFoundError(detail={"schedule_id": str(schedule_id)})
        if doctor_id != current["doctor_id"]:
            await _assert_doctor_assignable(conn, doctor_id)
        if department_id != current["department_id"]:
            await _assert_department_assignable(conn, department_id)
        if room_id is not None and room_id != current["room_id"]:
            await _assert_room_assignable(conn, room_id)
        try:
            row = await conn.fetchrow(
                f"update public.doctor_schedules set doctor_id = $2, department_id = $3, "
                f"room_id = $4, weekday = $5, start_time = $6, end_time = $7, updated_at = now() "
                f"where id = $1 returning {_DOCTOR_SCHEDULE_COLUMNS}",
                schedule_id,
                doctor_id,
                department_id,
                room_id,
                weekday,
                start_time,
                end_time,
            )
        except asyncpg.ExclusionViolationError as exc:
            raise _schedule_overlap_error() from exc
        except asyncpg.ForeignKeyViolationError as exc:  # 명시 검사 백스톱
            raise AppError(
                "존재하지 않는 참조입니다.", code="invalid_reference", status_code=422
            ) from exc
        if row is None:
            raise NotFoundError(detail={"schedule_id": str(schedule_id)})
        return row

    return await _run_authed(sub, _op)


async def set_doctor_schedule_active(
    sub: UUID, schedule_id: UUID, *, is_active: bool
) -> asyncpg.Record:
    """근무표 활성/비활성(soft delete) 토글. 미존재 → 404, 재활성 시 겹침 → 409 schedule_overlap
    (부분 EXCLUDE where(is_active) 가 false→true 전이에서 발화)."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        try:
            row = await conn.fetchrow(
                f"update public.doctor_schedules set is_active = $2, updated_at = now() "
                f"where id = $1 returning {_DOCTOR_SCHEDULE_COLUMNS}",
                schedule_id,
                is_active,
            )
        except asyncpg.ExclusionViolationError as exc:  # 재활성이 활성 겹침 유발
            raise _schedule_overlap_error() from exc
        if row is None:
            raise NotFoundError(detail={"schedule_id": str(schedule_id)})
        return row

    return await _run_authed(sub, _op)


async def insert_doctor_time_off(
    sub: UUID, *, doctor_id: UUID, start_at: datetime, end_at: datetime, reason: str | None
) -> asyncpg.Record:
    """휴진·예외 INSERT(자동 감사). 미존재/비활성 의사 → 422(겹침 제약 없음 — 중첩 휴진 무해)."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        await _assert_doctor_assignable(conn, doctor_id)
        try:
            row = await conn.fetchrow(
                f"insert into public.doctor_time_offs (doctor_id, start_at, end_at, reason) "
                f"values ($1, $2, $3, $4) returning {_DOCTOR_TIME_OFF_COLUMNS}",
                doctor_id,
                start_at,
                end_at,
                reason,
            )
        except asyncpg.ForeignKeyViolationError as exc:  # 명시 검사 백스톱
            raise AppError(
                "존재하지 않는 의사입니다.", code="invalid_doctor", status_code=422
            ) from exc
        assert row is not None
        return row

    return await _run_authed(sub, _op)


async def update_doctor_time_off(
    sub: UUID, time_off_id: UUID, *, start_at: datetime, end_at: datetime, reason: str | None
) -> asyncpg.Record:
    """휴진·예외 수정(기간·사유). doctor 불변. 미존재 → 404."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        row = await conn.fetchrow(
            f"update public.doctor_time_offs set start_at = $2, end_at = $3, reason = $4, "
            f"updated_at = now() where id = $1 returning {_DOCTOR_TIME_OFF_COLUMNS}",
            time_off_id,
            start_at,
            end_at,
            reason,
        )
        if row is None:
            raise NotFoundError(detail={"time_off_id": str(time_off_id)})
        return row

    return await _run_authed(sub, _op)


async def set_doctor_time_off_active(
    sub: UUID, time_off_id: UUID, *, is_active: bool
) -> asyncpg.Record:
    """휴진·예외 활성/비활성(soft delete) 토글. 미존재 → 404."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_master_manage(conn)
        row = await conn.fetchrow(
            f"update public.doctor_time_offs set is_active = $2, updated_at = now() "
            f"where id = $1 returning {_DOCTOR_TIME_OFF_COLUMNS}",
            time_off_id,
            is_active,
        )
        if row is None:
            raise NotFoundError(detail={"time_off_id": str(time_off_id)})
        return row

    return await _run_authed(sub, _op)


async def fetch_active_doctors(sub: UUID) -> list[asyncpg.Record]:
    """재직 의사 목록(근무표 폼 피커용 — id·name·department_id). users RLS(본인행, 0003)를
    service_role 풀이 우회하므로 전체 의사 조회 가능(클라 직접조회로는 불가 — 이 엔드포인트가 필요한
    이유, count_department_dependents 동형). 조회는 엔드포인트 require_master_manage 게이트로 충분 →
    권한 재평가 불요."""

    async def _op(conn: asyncpg.Connection) -> list[asyncpg.Record]:
        return await conn.fetch(
            "select u.id, u.name, u.department_id from public.users u "
            "join public.roles r on r.id = u.role_id "
            "where r.code = 'doctor' and u.employment_status = 'active' "
            "order by u.name"
        )

    return await _run_authed(sub, _op)


# ══════════════════════════════════════════════════════════════════════════════
# 예약 슬롯 계산 읽기 (Story 6.2 — 0031_appointments) — 근무−휴진−booked예약
# 전부 service_role(_run_authed) 읽기 — RLS 우회(fetch_active_doctors 패턴). active 의사 조인이
# users RLS(본인행) 를 넘고, appointments RLS(환자 본인행) 를 넘어 전체 예약 가용성을 본다(가용성만
# 반환·환자 PII 미반환). 조회는 엔드포인트 require_permission('appointment.read') 게이트로 충분 →
# 권한 재평가 불요(읽기). 슬롯 status 산출은 services.scheduling 의 순수 함수가 담당.
# ══════════════════════════════════════════════════════════════════════════════


async def fetch_doctor_schedules_for_weekday(
    sub: UUID, doctor_id: UUID, weekday: int
) -> list[asyncpg.Record]:
    """슬롯 계산용 — 재직 의사의 해당 요일 활성 근무 블록(start_time/end_time, KST 로컬 time).

    ⚠️ active 의사 조인 필터(`employment_status='active'`·`role='doctor'`): 6.1 이월("스케줄
    employment 재검증")을 흡수 — 퇴사·휴직 의사의 잔존 활성 근무표는 슬롯을 만들지 않는다.
    """

    async def _op(conn: asyncpg.Connection) -> list[asyncpg.Record]:
        return await conn.fetch(
            "select ds.start_time, ds.end_time from public.doctor_schedules ds "
            "join public.users u on u.id = ds.doctor_id "
            "join public.roles r on r.id = u.role_id "
            "where ds.doctor_id = $1 and ds.weekday = $2 and ds.is_active "
            "  and r.code = 'doctor' and u.employment_status = 'active' "
            "order by ds.start_time",
            doctor_id,
            weekday,
        )

    return await _run_authed(sub, _op)


async def fetch_doctor_time_offs_in_range(
    sub: UUID, doctor_id: UUID, range_start: datetime, range_end: datetime
) -> list[asyncpg.Record]:
    """슬롯 계산용 — 의사의 활성 휴진 구간 중 [range_start, range_end) 와 겹치는 것."""

    async def _op(conn: asyncpg.Connection) -> list[asyncpg.Record]:
        return await conn.fetch(
            "select start_at, end_at from public.doctor_time_offs "
            "where doctor_id = $1 and is_active and start_at < $3 and end_at > $2 "
            "order by start_at",
            doctor_id,
            range_start,
            range_end,
        )

    return await _run_authed(sub, _op)


async def fetch_booked_appointments_in_range(
    sub: UUID, doctor_id: UUID, range_start: datetime, range_end: datetime
) -> list[asyncpg.Record]:
    """슬롯 계산용 — 의사의 활성(status='booked') 예약 중 구간과 겹치는 시각만.

    ⚠️ 가용성만 — patient_id 등 환자 PII 미반환(슬롯 응답에 누설 금지). EXCLUDE 부분 술어
    (`where status='booked'`)와 동일 술어로 정렬(취소·노쇼·완료는 슬롯 미차단·재예약 가능).
    """

    async def _op(conn: asyncpg.Connection) -> list[asyncpg.Record]:
        return await conn.fetch(
            "select scheduled_start, scheduled_end from public.appointments "
            "where doctor_id = $1 and status = 'booked' "
            "  and scheduled_start < $3 and scheduled_end > $2 "
            "order by scheduled_start",
            doctor_id,
            range_start,
            range_end,
        )

    return await _run_authed(sub, _op)


async def fetch_bookable_doctors(sub: UUID, department_id: UUID | None) -> list[asyncpg.Record]:
    """예약 피커용 재직 의사(id·name·department_id) — 진료과 필터 옵션. fetch_active_doctors
    미러이나 게이트가 appointment.read(원무·환자 예약 흐름; /doctors 는 master.manage admin 전용).
    users RLS(본인행) 를 service_role 풀이 우회."""

    async def _op(conn: asyncpg.Connection) -> list[asyncpg.Record]:
        return await conn.fetch(
            "select u.id, u.name, u.department_id from public.users u "
            "join public.roles r on r.id = u.role_id "
            "where r.code = 'doctor' and u.employment_status = 'active' "
            "  and ($1::uuid is null or u.department_id = $1) "
            "order by u.name",
            department_id,
        )

    return await _run_authed(sub, _op)


# ── 오더(orders, Story 5.2~) — 처방 발행·조회 (service_role 직접 INSERT, 0015) ────────────
# 처방전 = 헤더(prescriptions) + 1:N 상세(prescription_details). 발행 = service_role 직접 INSERT
# (전이 RPC 아님 — 자유 CRUD, medical_records/diagnoses 선례). 권한은 쓰기 직전 동일 txn 재평가.
# 0015 전이 트리거가 INSERT status='issued' 강제(5.2 는 전이 미발생 — dispense=Epic 7). 응답 =
# drugs 조인(drug_code·drug_name·ingredient_code — ingredient_code 는 FR-052 중복 비교 키 +
# coverage_type 5.5 pay-chip) + users 조인(ordered_by_name 추적 라인, 5.5). 감사 = 0015 트리거 자동.
# ⚠️ 5.5: allergy_override_reason(자유텍스트) 은 _SENSITIVE_KEY 마스킹 대상(audit.py/audit.ts) — 단
#    응답엔 미노출(쓰기·감사 전용, PII 표면 최소). diagnosis_id/drug_id = FK → 무변경.


def _allergy_conflicts(allergies_text: str | None, drugs_by_id: dict[str, str]) -> dict[str, str]:
    """알레르기↔약품 교차검증(UX-DR21②) — 환자 기록 알레르기(자유텍스트) ↔ 약품명 토큰 부분일치.

    allergies 는 자유텍스트(구조화 알레르겐·중증도 없음, 0009) → 구분자(`,`·`、`·`·`·`/`·`;`·공백)로
    토큰화 후 길이 ≥2 토큰이 약품명 정규화 문자열에 부분 포함되면 conflict. ⚠️ 클래스 매칭 불가
    (페니실린 ⊄ 아목시실린) — 직접 토큰 일치만(정직한 한계, 구조화 알레르겐 부재). 실제 약물상호작용
    DB 없음(동일성분 = FR-052 클라 경고 별도). 인자·반환 키 = drug_id 문자열. 반환 = {drug_id:토큰}.
    """
    if not allergies_text or not allergies_text.strip():
        return {}
    tokens = {
        t.strip().lower() for t in re.split(r"[,、·/;\s]+", allergies_text) if len(t.strip()) >= 2
    }
    conflicts: dict[str, str] = {}
    for drug_id, name in drugs_by_id.items():
        name_norm = (name or "").lower()
        for tok in tokens:
            if tok and tok in name_norm:
                conflicts[drug_id] = tok
                break
    return conflicts


_PRESCRIPTION_COLUMNS = (
    "pr.id, pr.encounter_id, pr.encounter_diagnosis_id, pr.status, pr.ordered_by, "
    "ub.name as ordered_by_name, "
    "pr.ordered_at, pr.dispensed_at, pr.is_active, pr.created_at, pr.updated_at"
)
_PRESCRIPTION_FROM = (
    "from public.prescriptions pr left join public.users ub on ub.id = pr.ordered_by"
)
_PRESCRIPTION_DETAIL_COLUMNS = (
    "pd.id, pd.prescription_id, pd.drug_id, dr.code as drug_code, dr.name as drug_name, "
    "dr.ingredient_code, dr.coverage_type, pd.dose, pd.frequency, pd.duration_days, "
    "pd.usage_instruction, pd.is_active, pd.created_at, pd.updated_at"
)
_PRESCRIPTION_DETAIL_FROM = (
    "from public.prescription_details pd join public.drugs dr on dr.id = pd.drug_id"
)


async def _require_prescription_create(conn: asyncpg.Connection) -> None:
    """쓰기 직전 동일 txn 에서 prescription.create 재평가(평가↔쓰기 TOCTOU). 미보유 → 403."""
    if not bool(await conn.fetchval("select public.has_permission('prescription.create')")):
        raise ForbiddenError(detail={"required_permission": "prescription.create"})


async def _fetch_prescription_details(
    conn: asyncpg.Connection, prescription_id: UUID
) -> list[asyncpg.Record]:
    """한 처방전의 상세 라인(drugs 조인·활성만·부착순) — 쓰기 후 응답·조회 공용."""
    return await conn.fetch(
        f"select {_PRESCRIPTION_DETAIL_COLUMNS} {_PRESCRIPTION_DETAIL_FROM} "
        f"where pd.prescription_id = $1 and pd.is_active = true "
        f"order by pd.created_at asc, pd.id asc",
        prescription_id,
    )


async def insert_prescription(
    sub: UUID,
    *,
    encounter_id: UUID,
    ordered_by: UUID,
    encounter_diagnosis_id: UUID | None,
    details: list[dict[str, object]],
) -> dict[str, object]:
    """처방전 발행 — 헤더 1 + 상세 N 을 단일 txn 에 INSERT(자동 감사). ordered_by=발행 의사.

    내원 존재 선검사(미존재 404). encounter_diagnosis_id 제공 시 그 내원 소속·활성 검증(타 내원/
    비활성 진단 연결 차단 → 422 — FK 만으론 소속 미보증, FR-051). 헤더 status 는 DB 기본값 'issued'
    (0015 전이 트리거 강제). 상세 drug_id 는 마스터 FK — 잘못된 drug_id(23503) → 422 백스톱
    (attach_diagnosis 선례). dose 는 numeric → Decimal 변환(asyncpg 가 float 거부). 권한은 INSERT
    직전 재평가(TOCTOU). 반환 = {헤더..., "details": [상세 조인 dict...]} (서비스가 매핑).
    """

    async def _op(conn: asyncpg.Connection) -> dict[str, object]:
        await _require_prescription_create(conn)
        exists = await conn.fetchval(
            "select true from public.encounters where id = $1", encounter_id
        )
        if exists is None:
            raise NotFoundError(
                "내원을 찾을 수 없습니다.", detail={"encounter_id": str(encounter_id)}
            )
        if encounter_diagnosis_id is not None:
            # 근거 진단은 같은 내원의 활성 부착 진단이어야 한다(FR-051). FK 는 존재만 보증.
            belongs = await conn.fetchval(
                "select true from public.encounter_diagnoses "
                "where id = $1 and encounter_id = $2 and is_active = true",
                encounter_diagnosis_id,
                encounter_id,
            )
            if belongs is None:
                raise AppError(
                    "이 내원의 진단이 아닙니다(처방 근거).",
                    code="invalid_diagnosis_reference",
                    status_code=422,
                    detail={"encounter_diagnosis_id": str(encounter_diagnosis_id)},
                )
        # 알레르기 교차검증(UX-DR21②, 5.5) — 환자 기록 알레르기 ↔ 약품명 토큰 대조(서버 권위).
        # 매칭 라인에 오버라이드 사유 없으면 409 차단; 사유 있으면 통과(사유는 상세 기록 → 감사).
        # 잘못된 drug_id 는 drugs_by_id 미포함 → conflict 없음(아래 INSERT FK 위반 422, 순서 무해).
        drug_ids = [UUID(str(line["drug_id"])) for line in details]
        drug_rows = await conn.fetch(
            "select id, name from public.drugs where id = any($1::uuid[])", drug_ids
        )
        drugs_by_id = {str(r["id"]): r["name"] for r in drug_rows}
        allergies_text = await conn.fetchval(
            "select p.allergies from public.patients p "
            "join public.encounters e on e.patient_id = p.id where e.id = $1",
            encounter_id,
        )
        conflicts = _allergy_conflicts(allergies_text, drugs_by_id)
        if conflicts:
            unresolved = [
                {
                    "drug_id": str(line["drug_id"]),
                    "drug_name": drugs_by_id.get(str(line["drug_id"]), ""),
                    "allergen": conflicts[str(line["drug_id"])],
                }
                for line in details
                if str(line["drug_id"]) in conflicts
                and not str(line.get("allergy_override_reason") or "").strip()
            ]
            if unresolved:
                raise AppError(
                    "환자 알레르기 약품입니다. 발행 사유를 입력하세요.",
                    code="allergy_conflict",
                    status_code=409,
                    detail={"conflicts": unresolved},
                )
        try:
            header = await conn.fetchrow(
                "insert into public.prescriptions "
                "(encounter_id, encounter_diagnosis_id, ordered_by) "
                "values ($1, $2, $3) returning id",
                encounter_id,
                encounter_diagnosis_id,
                ordered_by,
            )
            assert header is not None  # RETURNING 은 항상 1행
            prescription_id = header["id"]
            for line in details:
                dose = line.get("dose")
                # 오버라이드 사유는 conflict 라인만 저장(비-conflict 는 NULL — 데이터 정합).
                override = (
                    line.get("allergy_override_reason")
                    if str(line["drug_id"]) in conflicts
                    else None
                )
                await conn.execute(
                    "insert into public.prescription_details "
                    "(prescription_id, drug_id, dose, frequency, duration_days, "
                    "usage_instruction, allergy_override_reason) "
                    "values ($1, $2, $3, $4, $5, $6, $7)",
                    prescription_id,
                    line["drug_id"],
                    Decimal(str(dose)) if dose is not None else None,  # numeric=Decimal 필수
                    line.get("frequency"),
                    line.get("duration_days"),
                    line.get("usage_instruction"),
                    override,
                )
        except asyncpg.ForeignKeyViolationError as exc:
            # 잘못된 drug_id(또는 동시 삭제 레이스의 진단) 23503 → 입력 오류 422(미매핑 시 503).
            raise AppError(
                "참조 대상이 올바르지 않습니다(약품·진단).",
                code="invalid_reference",
                status_code=422,
            ) from exc
        header_full = await conn.fetchrow(
            f"select {_PRESCRIPTION_COLUMNS} {_PRESCRIPTION_FROM} where pr.id = $1",
            prescription_id,
        )
        assert header_full is not None
        detail_rows = await _fetch_prescription_details(conn, prescription_id)
        return {**dict(header_full), "details": [dict(r) for r in detail_rows]}

    return await _run_authed(sub, _op)


async def fetch_prescriptions(sub: UUID, encounter_id: UUID) -> list[dict[str, object]]:
    """한 내원의 발행 처방전 목록(헤더 최신순 + 상세 drugs 조인, 활성만). 게이트=라우터(order.read).

    service_role 경로라 RLS 우회 — 조회 권위는 라우터 require_permission(읽기 TOCTOU 저위험,
    fetch_encounter_diagnoses 동형). 반환 = [{헤더..., "details":[...]}] (서비스가 매핑).
    """

    async def _op(conn: asyncpg.Connection) -> list[dict[str, object]]:
        headers = await conn.fetch(
            f"select {_PRESCRIPTION_COLUMNS} {_PRESCRIPTION_FROM} "
            f"where pr.encounter_id = $1 and pr.is_active = true "
            f"order by pr.created_at desc, pr.id desc",
            encounter_id,
        )
        if not headers:
            return []
        # 상세는 헤더 전체를 한 번에 조회(N+1 회피) 후 prescription_id 로 그룹핑.
        detail_rows = await conn.fetch(
            f"select {_PRESCRIPTION_DETAIL_COLUMNS} {_PRESCRIPTION_DETAIL_FROM} "
            f"where pd.prescription_id = any($1::uuid[]) and pd.is_active = true "
            f"order by pd.created_at asc, pd.id asc",
            [h["id"] for h in headers],
        )
        grouped: dict[object, list[dict[str, object]]] = {}
        for r in detail_rows:
            grouped.setdefault(r["prescription_id"], []).append(dict(r))
        return [{**dict(h), "details": grouped.get(h["id"], [])} for h in headers]

    return await _run_authed(sub, _op)


# ── 원외처방전 문서 조립·발급·내보내기 감사 (Story 7.7 — 0050 dispense_prescription·
#    log_prescription_document_export 소비) ──────────────────────────────────────────────
# 처방전은 payment 스코프가 아니라 prescription 스코프(7.5/7.6 영수증·세부내역서와 근본 차이) —
# finalize 무관(발행 처방이면 출력·발급). 문서 데이터 = clinic_profile(재사용) + 환자(masked RRN·
# 생년월일·성별) + 진료과/담당의 + 처방 1:N(발행의 면허·근거 진단 KCD·약품 라인). 발급 =
# dispense_prescription RPC(0050). 내보내기 감사 = log_prescription_document_export RPC.

# 환자(masked RRN·생년월일·성별) + 진료과/담당의 — encounter 기준 1행. raw RRN 미투영(PII 경계).
_PRESCRIPTION_DOC_HEADER_SELECT = (
    "select pat.name as patient_name, pat.chart_no, pat.resident_no_masked, pat.insurance_type, "
    "pat.birth_date, pat.sex, "
    "dept.name as department_name, doc.name as doctor_name "
    "from public.encounters e "
    "join public.patients pat on pat.id = e.patient_id "
    "join public.departments dept on dept.id = e.department_id "
    "left join public.users doc on doc.id = e.doctor_id "
    "where e.id = $1"
)

# 처방 헤더(발행의 면허·근거 진단 KCD 조인) — 발행/발급 상태만·발행순(ordered_at).
_PRESCRIPTION_DOC_RX_SELECT = (
    "select pr.id, pr.status, pr.ordered_at, pr.dispensed_at, "
    "ub.name as prescriber_name, ub.license_type, ub.license_no, "
    "dg.code as diagnosis_code, dg.name as diagnosis_name "
    "from public.prescriptions pr "
    "left join public.users ub on ub.id = pr.ordered_by "
    "left join public.encounter_diagnoses ed on ed.id = pr.encounter_diagnosis_id "
    "left join public.diagnoses dg on dg.id = ed.diagnosis_id "
    "where pr.encounter_id = $1 and pr.is_active = true "
    "and pr.status in ('issued', 'dispensed') "
    "order by pr.ordered_at asc, pr.id asc"
)

# 처방 약품 라인(drugs 조인·unit 포함 = 1회 투약량 단위). 여러 처방을 한 번에(N+1 회피)·부착순.
_PRESCRIPTION_DOC_DRUG_SELECT = (
    "select pd.prescription_id, dr.code as drug_code, dr.name as drug_name, dr.unit as drug_unit, "
    "pd.dose, pd.frequency, pd.duration_days, pd.usage_instruction "
    "from public.prescription_details pd join public.drugs dr on dr.id = pd.drug_id "
    "where pd.prescription_id = any($1::uuid[]) and pd.is_active = true "
    "order by pd.prescription_id, pd.created_at asc, pd.id asc"
)


async def fetch_prescription_document(sub: UUID, encounter_id: UUID) -> dict[str, object]:
    """원외처방전 문서 데이터 조립(Story 7.7·FR-115). 게이트=라우터 prescription.dispense.

    요양기관(clinic_profile) + 환자(masked RRN·생년월일·성별) + 진료(진료과/담당의) + 처방 1:N
    (면허·근거 진단 KCD·약품 라인)을 한 트랜잭션 조립. payment 무관. 미존재 내원 → 404. 처방
    0건 → 빈 배열. masked RRN 만(PII 경계).
    """

    async def _op(conn: asyncpg.Connection) -> dict[str, object]:
        header = await conn.fetchrow(_PRESCRIPTION_DOC_HEADER_SELECT, encounter_id)
        if header is None:
            raise NotFoundError(
                "내원을 찾을 수 없습니다.", detail={"encounter_id": str(encounter_id)}
            )
        clinic = await conn.fetchrow(
            "select name, biz_no, hira_no, address, ceo_name, phone "
            "from public.clinic_profile where id = 1"
        )
        if clinic is None:  # seed 보장(7.5 도입) — 미설정은 운영 결함(fail-loud)
            raise AppError(
                "요양기관 정보가 설정되지 않았습니다.",
                code="clinic_profile_missing",
                status_code=500,
            )
        rx_rows = await conn.fetch(_PRESCRIPTION_DOC_RX_SELECT, encounter_id)
        drugs_by_rx: dict[object, list[dict[str, object]]] = {}
        if rx_rows:
            drug_rows = await conn.fetch(_PRESCRIPTION_DOC_DRUG_SELECT, [r["id"] for r in rx_rows])
            for d in drug_rows:
                drugs_by_rx.setdefault(d["prescription_id"], []).append(
                    {
                        "drug_code": d["drug_code"],
                        "drug_name": d["drug_name"],
                        "drug_unit": d["drug_unit"],
                        "dose": d["dose"],
                        "frequency": d["frequency"],
                        "duration_days": d["duration_days"],
                        "usage_instruction": d["usage_instruction"],
                    }
                )
        prescriptions = [
            {
                "id": r["id"],
                "status": r["status"],
                "ordered_at": r["ordered_at"],
                "dispensed_at": r["dispensed_at"],
                "prescriber": {
                    "name": r["prescriber_name"],
                    "license_type": r["license_type"],
                    "license_no": r["license_no"],
                },
                "diagnosis": (
                    {"code": r["diagnosis_code"], "name": r["diagnosis_name"]}
                    if r["diagnosis_code"] is not None
                    else None
                ),
                "drugs": drugs_by_rx.get(r["id"], []),
            }
            for r in rx_rows
        ]
        return {
            "clinic": dict(clinic),
            "patient": {
                "name": header["patient_name"],
                "chart_no": header["chart_no"],
                "resident_no_masked": header["resident_no_masked"],
                "insurance_type": header["insurance_type"],
                "birth_date": header["birth_date"],
                "sex": header["sex"],
            },
            "encounter": {
                "department_name": header["department_name"],
                "doctor_name": header["doctor_name"],
            },
            "prescriptions": prescriptions,
        }

    return await _run_authed(sub, _op)


async def _require_prescription_owned(
    conn: asyncpg.Connection, encounter_id: UUID, prescription_id: UUID
) -> None:
    """경로 정합 선검사 — prescription_id 가 encounter_id 소속이어야 함(타 내원 발급/출력 → 404)."""
    owner = await conn.fetchval(
        "select encounter_id from public.prescriptions where id = $1", prescription_id
    )
    if owner is None or owner != encounter_id:
        raise NotFoundError(
            "처방을 찾을 수 없습니다.", detail={"prescription_id": str(prescription_id)}
        )


async def dispense_prescription(
    sub: UUID, encounter_id: UUID, prescription_id: UUID
) -> dict[str, object]:
    """원외처방전 발급(issued→dispensed·Story 7.7·FR-115). 게이트=라우터 prescription.dispense.

    dispense_prescription RPC(0050)가 has_permission 재평가 + 상태 전이를 동일 txn 소유
    (감사=trg_prescriptions_audit 자동). 경로 정합 선검사(소속 아니면 404). 비-issued 재발급 → 409
    (PT409), 미존재 → 404(PT404), 권한 미보유 → 403(42501). 반환 = 갱신 처방.
    """

    async def _op(conn: asyncpg.Connection) -> dict[str, object]:
        await _require_prescription_owned(conn, encounter_id, prescription_id)
        await conn.execute("select public.dispense_prescription($1)", prescription_id)
        header = await conn.fetchrow(
            f"select {_PRESCRIPTION_COLUMNS} {_PRESCRIPTION_FROM} where pr.id = $1",
            prescription_id,
        )
        details = await _fetch_prescription_details(conn, prescription_id)
        return {**dict(header), "details": [dict(r) for r in details]}

    return await _run_authed(sub, _op)


async def log_prescription_document_export(
    sub: UUID, encounter_id: UUID, prescription_id: UUID, document_type: str
) -> None:
    """처방전 인쇄/내보내기 = 'read' 감사 기록(Story 7.7·UX-DR22). 게이트=prescription.dispense.

    경로 정합 선검사(소속 아니면 404). log_prescription_document_export RPC(0050·SECURITY DEFINER)가
    has_permission 재평가 + audit_logs INSERT(target=prescriptions) 소유. finalized 게이트 없음 —
    발행 처방이면 출력(payment 무관). 권한 미보유 → 403.
    """

    async def _op(conn: asyncpg.Connection) -> None:
        await _require_prescription_owned(conn, encounter_id, prescription_id)
        await conn.execute(
            "select public.log_prescription_document_export($1, $2)",
            prescription_id,
            document_type,
        )

    return await _run_authed(sub, _op)


# ── 검사·영상 오더 생성·조회 (Story 5.3 — 0015 examinations 소비, service_role 직접 INSERT) ──────
# examinations = 단건 평면 행(처방의 헤더/상세 1:N 아님). 오더 생성 = service_role 직접 INSERT
# (전이 RPC 아님 — 자유 CRUD, insert_prescription 미러). exam_type(lab/imaging) = 워크리스트 라우팅
# 분류 축(FR-061). 0015 전이 트리거가 INSERT status='ordered' 강제(5.3 은 전이 미발생 — perform/
# complete = 5.7/5.8/5.9). 응답 = fee_schedules 조인(fee_code·fee_name·category·amount_krw).
# 권한은 쓰기 직전 동일 txn 재평가. 감사 = 0015 트리거 자동. exam_type/fee_schedule_id = FK·
# 짧은 텍스트 → _SENSITIVE_KEY 무변경.
_EXAMINATION_COLUMNS = (
    "ex.id, ex.encounter_id, ex.exam_type, ex.fee_schedule_id, "
    "fs.code as fee_code, fs.name as fee_name, fs.category as fee_category, fs.amount_krw, "
    "fs.coverage_type, "
    "ex.status, ex.ordered_by, ub.name as ordered_by_name, ex.ordered_at, ex.equipment_id, "
    "ex.performed_by, up.name as performed_by_name, ex.performed_at, "
    "ex.completed_by, ex.completed_at, ex.findings, ex.reading_conclusion, "
    "ex.is_active, ex.created_at, ex.updated_at"
)
_EXAMINATION_FROM = (
    "from public.examinations ex join public.fee_schedules fs on fs.id = ex.fee_schedule_id "
    "left join public.users ub on ub.id = ex.ordered_by "
    "left join public.users up on up.id = ex.performed_by"
)


async def _require_examination_order(conn: asyncpg.Connection) -> None:
    """쓰기 직전 동일 txn 에서 examination.order 재평가(평가↔쓰기 TOCTOU). 미보유 → 403."""
    if not bool(await conn.fetchval("select public.has_permission('examination.order')")):
        raise ForbiddenError(detail={"required_permission": "examination.order"})


async def insert_examination(
    sub: UUID,
    *,
    encounter_id: UUID,
    exam_type: str,
    fee_schedule_id: UUID,
    ordered_by: UUID,
) -> dict[str, object]:
    """검사·영상 오더 생성 — examinations 단건 INSERT(자동 감사). ordered_by=지시 의사.

    내원 존재 선검사(미존재 404). exam_type(lab/imaging)·fee_schedule_id(EDI 행위 마스터 FK)만
    입력 — status 는 DB 기본값 'ordered'(0015 전이 트리거 강제). 잘못된 fee_schedule_id(23503) →
    422 백스톱(insert_prescription 선례). 권한은 INSERT 직전 재평가(TOCTOU). 반환 = fee 조인 dict.
    """

    async def _op(conn: asyncpg.Connection) -> dict[str, object]:
        await _require_examination_order(conn)
        exists = await conn.fetchval(
            "select true from public.encounters where id = $1", encounter_id
        )
        if exists is None:
            raise NotFoundError(
                "내원을 찾을 수 없습니다.", detail={"encounter_id": str(encounter_id)}
            )
        try:
            row = await conn.fetchrow(
                "insert into public.examinations "
                "(encounter_id, exam_type, fee_schedule_id, ordered_by) "
                "values ($1, $2, $3, $4) returning id",
                encounter_id,
                exam_type,
                fee_schedule_id,
                ordered_by,
            )
        except asyncpg.ForeignKeyViolationError as exc:
            # 잘못된 fee_schedule_id(또는 동시삭제 레이스) 23503 → 입력 오류 422(미매핑 시 503).
            raise AppError(
                "참조 대상이 올바르지 않습니다(검사 행위).",
                code="invalid_reference",
                status_code=422,
            ) from exc
        assert row is not None  # RETURNING 은 항상 1행
        full = await conn.fetchrow(
            f"select {_EXAMINATION_COLUMNS} {_EXAMINATION_FROM} where ex.id = $1",
            row["id"],
        )
        assert full is not None
        return dict(full)

    return await _run_authed(sub, _op)


async def fetch_examinations(sub: UUID, encounter_id: UUID) -> list[dict[str, object]]:
    """한 내원의 검사·영상 오더 목록(최신순, fee_schedules 조인, 활성만). 게이트=라우터(order.read).

    service_role 경로라 RLS 우회 — 조회 권위는 라우터 require_permission(읽기 TOCTOU 저위험,
    fetch_prescriptions 동형). 반환 = [fee 조인 dict] (서비스가 매핑).
    """

    async def _op(conn: asyncpg.Connection) -> list[dict[str, object]]:
        rows = await conn.fetch(
            f"select {_EXAMINATION_COLUMNS} {_EXAMINATION_FROM} "
            f"where ex.encounter_id = $1 and ex.is_active = true "
            f"order by ex.created_at desc, ex.id desc",
            encounter_id,
        )
        return [dict(r) for r in rows]

    return await _run_authed(sub, _op)


# ── 처치 오더(treatment_orders, Story 5.4 / FR-070) — 검사 미러, 단 더 단순 ──────────
# 처치는 간호 단일 라우팅(검사의 exam_type 분류 축 없음)·equipment_id/completed_* 컬럼 없음.
# ⚠️ SQL 별칭 = tr (to 는 Postgres 예약어). fee_schedules 조인으로 행위명·금액 합성.
_TREATMENT_ORDER_COLUMNS = (
    "tr.id, tr.encounter_id, tr.fee_schedule_id, "
    "fs.code as fee_code, fs.name as fee_name, fs.category as fee_category, fs.amount_krw, "
    "fs.coverage_type, "
    "tr.status, tr.ordered_by, ub.name as ordered_by_name, tr.ordered_at, "
    "tr.performed_by, up.name as performed_by_name, tr.performed_at, "
    "tr.is_active, tr.created_at, tr.updated_at"
)
_TREATMENT_ORDER_FROM = (
    "from public.treatment_orders tr join public.fee_schedules fs on fs.id = tr.fee_schedule_id "
    "left join public.users ub on ub.id = tr.ordered_by "
    "left join public.users up on up.id = tr.performed_by"
)


async def _require_treatment_order(conn: asyncpg.Connection) -> None:
    """쓰기 직전 동일 txn 에서 treatment.order 재평가(평가↔쓰기 TOCTOU). 미보유 → 403."""
    if not bool(await conn.fetchval("select public.has_permission('treatment.order')")):
        raise ForbiddenError(detail={"required_permission": "treatment.order"})


async def insert_treatment_order(
    sub: UUID,
    *,
    encounter_id: UUID,
    fee_schedule_id: UUID,
    ordered_by: UUID,
) -> dict[str, object]:
    """처치 오더 생성 — treatment_orders 단건 INSERT(자동 감사). ordered_by=지시 의사.

    내원 존재 선검사(미존재 404). fee_schedule_id(EDI 처치 행위 마스터 FK)만 입력 — status 는
    DB 기본값 'ordered'(0015 전이 트리거 강제). 잘못된 fee_schedule_id(23503) → 422 백스톱
    (insert_examination 선례). 권한은 INSERT 직전 재평가(TOCTOU). 반환 = fee 조인 dict.
    ⚠️ 검사와 달리 exam_type·equipment_id·completed_* 없음(처치=간호 단일 라우팅).
    """

    async def _op(conn: asyncpg.Connection) -> dict[str, object]:
        await _require_treatment_order(conn)
        exists = await conn.fetchval(
            "select true from public.encounters where id = $1", encounter_id
        )
        if exists is None:
            raise NotFoundError(
                "내원을 찾을 수 없습니다.", detail={"encounter_id": str(encounter_id)}
            )
        try:
            row = await conn.fetchrow(
                "insert into public.treatment_orders "
                "(encounter_id, fee_schedule_id, ordered_by) "
                "values ($1, $2, $3) returning id",
                encounter_id,
                fee_schedule_id,
                ordered_by,
            )
        except asyncpg.ForeignKeyViolationError as exc:
            # 잘못된 fee_schedule_id(또는 동시삭제 레이스) 23503 → 입력 오류 422(미매핑 시 503).
            raise AppError(
                "참조 대상이 올바르지 않습니다(처치 행위).",
                code="invalid_reference",
                status_code=422,
            ) from exc
        assert row is not None  # RETURNING 은 항상 1행
        full = await conn.fetchrow(
            f"select {_TREATMENT_ORDER_COLUMNS} {_TREATMENT_ORDER_FROM} where tr.id = $1",
            row["id"],
        )
        assert full is not None
        return dict(full)

    return await _run_authed(sub, _op)


async def fetch_treatment_orders(sub: UUID, encounter_id: UUID) -> list[dict[str, object]]:
    """한 내원의 처치 오더 목록(최신순, fee_schedules 조인, 활성만). 게이트=라우터(order.read).

    service_role 경로라 RLS 우회 — 조회 권위는 라우터 require_permission(읽기 TOCTOU 저위험,
    fetch_examinations 동형). 반환 = [fee 조인 dict] (서비스가 매핑).
    """

    async def _op(conn: asyncpg.Connection) -> list[dict[str, object]]:
        rows = await conn.fetch(
            f"select {_TREATMENT_ORDER_COLUMNS} {_TREATMENT_ORDER_FROM} "
            f"where tr.encounter_id = $1 and tr.is_active = true "
            f"order by tr.created_at desc, tr.id desc",
            encounter_id,
        )
        return [dict(r) for r in rows]

    return await _run_authed(sub, _op)


# ── 간호 활력징후(vital_signs, Story 5.6 / FR-091·FR-032) — 0017 테이블 직접 INSERT/SELECT ──
# 활력은 상태머신/불변식 없는 구조화 수치(SOAP·처치 오더와 별개) → service_role 직접 쓰기(전이 RPC
# 아님, insert_medical_record 자세). 매 측정 = 새 행 append(수정/삭제 미구현 — §스코프). users 조인
# 으로 측정자명(recorded_by_name) 합성. ⚠️ body_temp numeric(4,1) → INSERT 직전 Decimal 변환.
_VITAL_SIGNS_COLUMNS = (
    "vs.id, vs.encounter_id, vs.systolic, vs.diastolic, vs.pulse, vs.body_temp, "
    "vs.respiratory_rate, vs.spo2, vs.notes, "
    "vs.recorded_by, ur.name as recorded_by_name, vs.recorded_at, "
    "vs.is_active, vs.created_at, vs.updated_at"
)
_VITAL_SIGNS_FROM = "from public.vital_signs vs left join public.users ur on ur.id = vs.recorded_by"


async def _require_vital_record(conn: asyncpg.Connection) -> None:
    """쓰기 직전 동일 txn 에서 vital.record 재평가(평가↔쓰기 TOCTOU). 미보유 → 403.

    라우터 게이트는 방어심층 — 진짜 권위는 이 동일 txn 재평가(_require_treatment_order 선례).
    """
    if not bool(await conn.fetchval("select public.has_permission('vital.record')")):
        raise ForbiddenError(detail={"required_permission": "vital.record"})


async def insert_vital_signs(
    sub: UUID,
    *,
    encounter_id: UUID,
    recorded_by: UUID,
    systolic: int | None,
    diastolic: int | None,
    pulse: int | None,
    body_temp: float | None,
    respiratory_rate: int | None,
    spo2: int | None,
    notes: str | None,
) -> dict[str, object]:
    """활력징후 기록 — vital_signs 단건 INSERT(자동 감사). recorded_by=기록 간호사(jwt sub).

    내원 존재 선검사(미존재 404 — FK 위반 전 명시 오류, insert_treatment_order 선례). 최소-1개·범위
    는 DB CHECK 최종선(서버 Pydantic 2차선·클라 1차선). 권한은 INSERT 직전 재평가(TOCTOU). 잘못된
    encounter_id(23503) 또는 빈 활력/범위 위반(CHECK 23514) → 422 백스톱. body_temp 는 Decimal 변환
    (asyncpg numeric 바인딩). status 게이트 없음(orders 동형 — 웹이 active 만 노출, 직접 API 이월).
    반환 = users 조인 dict.
    """

    async def _op(conn: asyncpg.Connection) -> dict[str, object]:
        await _require_vital_record(conn)
        exists = await conn.fetchval(
            "select true from public.encounters where id = $1", encounter_id
        )
        if exists is None:
            raise NotFoundError(
                "내원을 찾을 수 없습니다.", detail={"encounter_id": str(encounter_id)}
            )
        temp = Decimal(str(body_temp)) if body_temp is not None else None
        try:
            row = await conn.fetchrow(
                "insert into public.vital_signs "
                "(encounter_id, systolic, diastolic, pulse, body_temp, respiratory_rate, spo2, "
                "notes, recorded_by) "
                "values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id",
                encounter_id,
                systolic,
                diastolic,
                pulse,
                temp,
                respiratory_rate,
                spo2,
                notes,
                recorded_by,
            )
        except asyncpg.ForeignKeyViolationError as exc:
            # 동시 삭제 레이스 등 23503 → 입력 오류 422(미매핑 시 503 오분류).
            raise AppError(
                "참조 대상이 올바르지 않습니다(내원).",
                code="invalid_reference",
                status_code=422,
            ) from exc
        except asyncpg.CheckViolationError as exc:
            # 최소-1개/범위 CHECK(직접 API 우회) → 422(서버 Pydantic 1차 차단, DB 최종선).
            raise AppError(
                "활력징후 값이 올바르지 않습니다.",
                code="invalid_vital_signs",
                status_code=422,
            ) from exc
        assert row is not None  # RETURNING 은 항상 1행
        full = await conn.fetchrow(
            f"select {_VITAL_SIGNS_COLUMNS} {_VITAL_SIGNS_FROM} where vs.id = $1", row["id"]
        )
        assert full is not None
        return dict(full)

    return await _run_authed(sub, _op)


async def fetch_vital_signs(sub: UUID, encounter_id: UUID) -> list[dict[str, object]]:
    """한 내원의 활력징후 목록(최신순·활성만, users 조인). 게이트=라우터(read∨record).

    service_role 경로라 RLS 우회 — 조회 권위는 라우터 require_any_permission(읽기 TOCTOU 저위험,
    fetch_treatment_orders 동형). 반환 = [users 조인 dict] (서비스가 매핑).
    """

    async def _op(conn: asyncpg.Connection) -> list[dict[str, object]]:
        rows = await conn.fetch(
            f"select {_VITAL_SIGNS_COLUMNS} {_VITAL_SIGNS_FROM} "
            f"where vs.encounter_id = $1 and vs.is_active = true "
            f"order by vs.recorded_at desc, vs.id desc",
            encounter_id,
        )
        return [dict(r) for r in rows]

    return await _run_authed(sub, _op)


async def fetch_vitals_worklist(sub: UUID, on_date: date) -> list[dict[str, object]]:
    """활력 워크리스트(Story 5.6 AC3) — 오늘(KST) 활성 내원(registered·in_progress) + 최근 활력.

    게이트=라우터(vital.record). service_role 경로라 RLS 우회(권위=라우터, encounter.read 0 무관).
    patients·departments 조인은 비-PII 투영(resident_no 제외, fetch_encounters 자세). latest_vital_
    recorded_at = 상관 서브쿼리(없으면 NULL=미측정). 일자=created_at KST(walk-in≈registered).
    """

    async def _op(conn: asyncpg.Connection) -> list[dict[str, object]]:
        rows = await conn.fetch(
            "select e.id as encounter_id, p.chart_no, p.name as patient_name, "
            "d.name as department_name, e.status, e.created_at, "
            "(select max(v.recorded_at) from public.vital_signs v "
            " where v.encounter_id = e.id and v.is_active = true) as latest_vital_recorded_at "
            "from public.encounters e "
            "join public.patients p on p.id = e.patient_id "
            "join public.departments d on d.id = e.department_id "
            "where e.is_active = true and e.status in ('registered', 'in_progress') "
            "and (e.created_at at time zone 'Asia/Seoul')::date = $1 "
            "order by e.created_at asc",
            on_date,
        )
        return [dict(r) for r in rows]

    return await _run_authed(sub, _op)


# ── 간호 처치 수행·일상 간호기록(Story 5.7 / FR-090·FR-092·FR-093·FR-094) — 0018 nursing_record ──
# 처치 수행 = perform_treatment_order RPC(0015 — ordered→performed·소스상태 precondition=재수행 차단
# FR-093·performed_by/at 세팅·자가 게이트). 래퍼=call_start_consult 동형(RPC SQLSTATE →
# _map_pg_sqlstate 자동 매핑·try/except 불요). 간호기록 = service_role 직접 INSERT(자유텍스트·
# insert_vital_signs 자세). content=자유 임상 서사(감사 마스킹). users 조인=기록자명.
_NURSING_RECORD_COLUMNS = (
    "nr.id, nr.encounter_id, nr.treatment_order_id, nr.content, "
    "nr.recorded_by, ur.name as recorded_by_name, nr.recorded_at, "
    "nr.is_active, nr.created_at, nr.updated_at"
)
_NURSING_RECORD_FROM = (
    "from public.nursing_record nr left join public.users ur on ur.id = nr.recorded_by"
)


async def _require_nursing_record(conn: asyncpg.Connection) -> None:
    """쓰기 직전 동일 txn 에서 nursing.record 재평가(평가↔쓰기 TOCTOU). 미보유 → 403.

    라우터 게이트는 방어심층 — 진짜 권위는 이 동일 txn 재평가(_require_vital_record 선례).
    """
    if not bool(await conn.fetchval("select public.has_permission('nursing.record')")):
        raise ForbiddenError(detail={"required_permission": "nursing.record"})


async def call_perform_treatment_order(
    sub: UUID, *, encounter_id: UUID, order_id: UUID, content: str | None
) -> dict[str, object]:
    """처치 오더 수행(FR-090·FR-092·FR-093) — perform_treatment_order RPC(ordered→performed).

    경로 정합 선검사(order 가 해당 내원·활성 — 미존재/불일치 404, RPC PT404 보다 친절). RPC 가 권한
    (42501→403)·재수행 차단(PT409→409 invalid_transition) raise → _map_pg_sqlstate 자동 매핑
    (call_start_consult 동형). content 입력 시 같은 txn 에서 연결 nursing_record 생성
    (treatment_order_id 부착·recorded_by=수행 간호사). 반환 = fee/users 조인 dict.
    """

    async def _op(conn: asyncpg.Connection) -> dict[str, object]:
        belongs = await conn.fetchval(
            "select true from public.treatment_orders "
            "where id = $1 and encounter_id = $2 and is_active = true",
            order_id,
            encounter_id,
        )
        if belongs is None:
            raise NotFoundError("처치 오더를 찾을 수 없습니다.", detail={"order_id": str(order_id)})
        # 전이 RPC(SECURITY DEFINER·재수행 차단). SQLSTATE → _run_authed 매핑(여기 try/except 불요).
        await conn.fetchrow("select * from public.perform_treatment_order($1)", order_id)
        if content is not None:
            # 처치기록 내용(선택) → 연결 nursing_record(동일 txn). content=Pydantic 비-blank 보장.
            # 선검사로 입력 유효(encounter/order 존재·content 비-blank)라 도달 불가하나,
            # insert_nursing_record 와 동일 422 계약 유지(방어심층 — FK/CHECK 미매핑 500 회피).
            try:
                await conn.execute(
                    "insert into public.nursing_record "
                    "(encounter_id, treatment_order_id, content, recorded_by) "
                    "values ($1, $2, $3, $4)",
                    encounter_id,
                    order_id,
                    content,
                    sub,
                )
            except asyncpg.ForeignKeyViolationError as exc:
                raise AppError(
                    "참조 대상이 올바르지 않습니다(내원/처치 오더).",
                    code="invalid_reference",
                    status_code=422,
                ) from exc
            except asyncpg.CheckViolationError as exc:
                raise AppError(
                    "간호기록 내용이 올바르지 않습니다.",
                    code="invalid_nursing_record",
                    status_code=422,
                ) from exc
        full = await conn.fetchrow(
            f"select {_TREATMENT_ORDER_COLUMNS} {_TREATMENT_ORDER_FROM} where tr.id = $1",
            order_id,
        )
        assert full is not None  # 선검사로 행 존재 확정
        return dict(full)

    return await _run_authed(sub, _op)


async def insert_nursing_record(
    sub: UUID,
    *,
    encounter_id: UUID,
    treatment_order_id: UUID | None,
    content: str,
    recorded_by: UUID,
) -> dict[str, object]:
    """일상 간호기록 생성(FR-094) — nursing_record 단건 INSERT(자동 감사). recorded_by=기록 간호사.

    내원 존재 선검사(미존재 404). 권한은 INSERT 직전 nursing.record 재평가(TOCTOU). 잘못된 FK(23503)
    → 422, 빈/공백 content(CHECK 23514·직접 API) → 422 백스톱(Pydantic 1차·DB 최종선). 일상 기록은
    treatment_order_id=None(오더 연결은 처치 수행 액션 소유). 반환 = users 조인 dict.
    """

    async def _op(conn: asyncpg.Connection) -> dict[str, object]:
        await _require_nursing_record(conn)
        exists = await conn.fetchval(
            "select true from public.encounters where id = $1", encounter_id
        )
        if exists is None:
            raise NotFoundError(
                "내원을 찾을 수 없습니다.", detail={"encounter_id": str(encounter_id)}
            )
        try:
            row = await conn.fetchrow(
                "insert into public.nursing_record "
                "(encounter_id, treatment_order_id, content, recorded_by) "
                "values ($1, $2, $3, $4) returning id",
                encounter_id,
                treatment_order_id,
                content,
                recorded_by,
            )
        except asyncpg.ForeignKeyViolationError as exc:
            # 잘못된 내원/처치 오더 FK(또는 동시삭제 레이스) 23503 → 입력 오류 422.
            raise AppError(
                "참조 대상이 올바르지 않습니다(내원/처치 오더).",
                code="invalid_reference",
                status_code=422,
            ) from exc
        except asyncpg.CheckViolationError as exc:
            # 빈/공백 content CHECK(직접 API 우회) → 422(서버 Pydantic 1차 차단·DB 최종선).
            raise AppError(
                "간호기록 내용이 올바르지 않습니다.",
                code="invalid_nursing_record",
                status_code=422,
            ) from exc
        assert row is not None  # RETURNING 은 항상 1행
        full = await conn.fetchrow(
            f"select {_NURSING_RECORD_COLUMNS} {_NURSING_RECORD_FROM} where nr.id = $1", row["id"]
        )
        assert full is not None
        return dict(full)

    return await _run_authed(sub, _op)


async def fetch_nursing_records(sub: UUID, encounter_id: UUID) -> list[dict[str, object]]:
    """한 내원의 간호기록 목록(최신순·활성만, users 조인). 게이트=order.read ∨ nursing.record.

    service_role 경로라 RLS 우회 — 권위는 라우터 require_any_permission(읽기 TOCTOU 저위험,
    fetch_vital_signs 동형). 처치 수행 연결(treatment_order_id) + 일상 기록(None) 포함.
    """

    async def _op(conn: asyncpg.Connection) -> list[dict[str, object]]:
        rows = await conn.fetch(
            f"select {_NURSING_RECORD_COLUMNS} {_NURSING_RECORD_FROM} "
            f"where nr.encounter_id = $1 and nr.is_active = true "
            f"order by nr.recorded_at desc, nr.id desc",
            encounter_id,
        )
        return [dict(r) for r in rows]

    return await _run_authed(sub, _op)


async def fetch_nursing_worklist(sub: UUID, on_date: date) -> list[dict[str, object]]:
    """간호 워크리스트(Story 5.7) — 오늘(KST) 활성 내원 + 처치·간호기록 건수.

    게이트=라우터(require_any treatment.perform ∨ nursing.record). service_role 경로라 RLS 우회.
    patients·departments 조인=비-PII 투영(fetch_vitals_worklist 자세). pending_treatment_count=
    'ordered' 처치(수행 대상)·nursing_record_count=기록 누적(상관 서브쿼리). pending>0=처치 우선.
    """

    async def _op(conn: asyncpg.Connection) -> list[dict[str, object]]:
        rows = await conn.fetch(
            "select e.id as encounter_id, p.chart_no, p.name as patient_name, "
            "d.name as department_name, e.status, e.created_at, "
            "(select count(*) from public.treatment_orders tr "
            " where tr.encounter_id = e.id and tr.status = 'ordered' and tr.is_active = true) "
            " as pending_treatment_count, "
            "(select min(tr.ordered_at) from public.treatment_orders tr "
            " where tr.encounter_id = e.id and tr.status = 'ordered' and tr.is_active = true) "
            " as oldest_pending_ordered_at, "
            "(select count(*) from public.nursing_record nr "
            " where nr.encounter_id = e.id and nr.is_active = true) as nursing_record_count "
            "from public.encounters e "
            "join public.patients p on p.id = e.patient_id "
            "join public.departments d on d.id = e.department_id "
            "where e.is_active = true and e.status in ('registered', 'in_progress') "
            "and (e.created_at at time zone 'Asia/Seoul')::date = $1 "
            "order by e.created_at asc",
            on_date,
        )
        return [dict(r) for r in rows]

    return await _run_authed(sub, _op)


# ══════════════════════════════════════════════════════════════════════════════
# 예약 생성 · 캘린더 (Story 6.3 — 0032) — service_role 직접 INSERT(walk-in 패턴)
# 더블부킹 EXCLUDE(0031, 23P01) → 409 double_booking(서비스 catch, schedule_overlap 동형).
# 전이/변경/취소·reservation_id 배선 = 6.4(본 스토리는 생성=초기상태 booked 만).
# ══════════════════════════════════════════════════════════════════════════════

_APPOINTMENT_COLUMNS = (
    "id, patient_id, doctor_id, department_id, room_id, scheduled_start, scheduled_end, "
    "status, note, sms_opt_in, cancel_reason, cancelled_at, no_show_at, completed_at, "
    "created_by, created_at, updated_at"
)


async def _require_appointment_create(conn: asyncpg.Connection) -> None:
    """쓰기 직전 동일 트랜잭션에서 appointment.create 재평가(TOCTOU 차단). 미보유 → 403."""
    if not bool(await conn.fetchval("select public.has_permission('appointment.create')")):
        raise ForbiddenError(detail={"required_permission": "appointment.create"})


def _double_booking_error() -> ConflictError:
    """더블부킹 EXCLUDE(23P01) → 409 double_booking(0030 _schedule_overlap_error 패턴)."""
    return ConflictError("같은 의사·시간대에 이미 예약이 있습니다.", code="double_booking")


# 노쇼 임계치(기본 2회·Story 6.7/FR-015) — "초과"(엄격 `>`) 시 신규 예약 제한. DB(0036 함수)는
# 카운트만 소유하고 임계 판정은 앱이 한다(클리닉 설정 테이블 미생성·튜너블 의도는 본 상수). 가드가
# 트랜잭션 내부에서 에러 detail 을 만들므로 상수도 여기 소유(SLOT_MINUTES 가 service 소유와 정합).
NO_SHOW_THRESHOLD = 2


async def _assert_no_show_under_threshold(conn: asyncpg.Connection, patient_id: UUID) -> None:
    """신규 예약 직전 동일 txn 에서 노쇼 카운트 검사(TOCTOU 안전·_require_appointment_create 사상).
    count > NO_SHOW_THRESHOLD(기본 2 → 3회째 차단) → 409 no_show_threshold_exceeded(FR-015·상습
    노쇼 슬롯 낭비 차단). 카운트 = 단일 진실 함수 patient_no_show_count(status='no_show' 집계).
    ⚠️ 신규 생성(insert_appointment·insert_self_appointment)에만 — reschedule/check-in 비대상."""
    count = await conn.fetchval("select public.patient_no_show_count($1)", patient_id)
    if count > NO_SHOW_THRESHOLD:
        raise AppError(
            "미방문(노쇼)이 누적되어 신규 예약이 제한됩니다.",
            code="no_show_threshold_exceeded",
            status_code=409,
            detail={
                "patient_id": str(patient_id),
                "no_show_count": count,
                "threshold": NO_SHOW_THRESHOLD,
            },
        )


async def insert_appointment(
    sub: UUID,
    *,
    patient_id: UUID,
    doctor_id: UUID,
    department_id: UUID,
    room_id: UUID | None,
    scheduled_start: datetime,
    scheduled_end: datetime,
    note: str | None,
    sms_opt_in: bool,
    created_by: UUID,
) -> asyncpg.Record:
    """예약 INSERT(status='booked'·자동 감사). service_role 직접(insert_walk_in_encounter 패턴):
    권한·환자/의사/진료과 active 동일-txn 선검사 → INSERT. 더블부킹 EXCLUDE(0031, 23P01) → 409
    double_booking·FK(23503) → 422 백스톱·미존재 환자 404·비활성 422·노쇼 임계 초과 409
    no_show_threshold_exceeded(6.7)."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_appointment_create(conn)
        # 환자 존재+활성(비활성 환자 예약 차단).
        patient_active = await conn.fetchval(
            "select is_active from public.patients where id = $1", patient_id
        )
        if patient_active is None:
            raise NotFoundError("환자를 찾을 수 없습니다.", detail={"patient_id": str(patient_id)})
        if not patient_active:
            raise AppError(
                "비활성 환자는 예약할 수 없습니다.",
                code="patient_inactive",
                status_code=422,
                detail={"patient_id": str(patient_id)},
            )
        # 노쇼 임계 초과 차단(6.7/FR-015) — 환자 확정 후·INSERT 전(동일 txn TOCTOU).
        await _assert_no_show_under_threshold(conn, patient_id)
        # 의사(role=doctor·active)·진료과·진료실 배정 가능 검증(6.1 헬퍼 재사용).
        await _assert_doctor_assignable(conn, doctor_id)
        await _assert_department_assignable(conn, department_id)
        if room_id is not None:
            await _assert_room_assignable(conn, room_id)
        try:
            row = await conn.fetchrow(
                f"insert into public.appointments "
                f"(patient_id, doctor_id, department_id, room_id, scheduled_start, "
                f"scheduled_end, note, sms_opt_in, created_by) "
                f"values ($1, $2, $3, $4, $5, $6, $7, $8, $9) "
                f"returning {_APPOINTMENT_COLUMNS}",
                patient_id,
                doctor_id,
                department_id,
                room_id,
                scheduled_start,
                scheduled_end,
                note,
                sms_opt_in,
                created_by,
            )
        except asyncpg.ExclusionViolationError as exc:
            raise _double_booking_error() from exc
        except asyncpg.ForeignKeyViolationError as exc:  # room 등 동시삭제 레이스 백스톱
            raise AppError(
                "참조 대상이 올바르지 않습니다(진료실 등).",
                code="invalid_reference",
                status_code=422,
            ) from exc
        assert row is not None
        return row

    return await _run_authed(sub, _op)


async def insert_self_appointment(
    sub: UUID,
    *,
    doctor_id: UUID,
    department_id: UUID,
    scheduled_start: datetime,
    scheduled_end: datetime,
    sms_opt_in: bool,
) -> asyncpg.Record:
    """환자 본인 예약 INSERT(Story 6.5·status='booked'·자동 감사). insert_appointment 미러하되:

    (1) **권한검사 없음**(환자 RBAC 권한 0 — 권위 = self-scope·get_current_patient 가 직원 차단),
    (2) **patient_id 를 인자로 받지 않고** 동일 txn 에서 `auth_uid = sub` 로 도출(클라 미수용·교차
        환자 예약 구조적 차단 — IDOR), (3) `created_by = sub`(환자 auth uid·0034 가 users FK 제거),
    (4) note 없음. 미연결(환자 레코드 없음) → 409 no_self_patient(온보딩 유도)·비활성 환자 → 422·
    더블부킹 EXCLUDE → 409·노쇼 임계 초과 → 409 no_show_threshold_exceeded(6.7·본인 예약도 제한)·
    FK(23503) → 422·의사/진료과 active 선검사(insert_appointment 재사용)."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        # 본인 환자 레코드(auth_uid=sub) 도출 — patient_id 는 클라 입력이 아니다(세션 uid 스코프).
        patient = await conn.fetchrow(
            "select id, is_active from public.patients where auth_uid = $1", sub
        )
        if patient is None:
            raise AppError(
                "연결된 환자 기록이 없습니다. 본인 진료기록을 먼저 연결해 주세요.",
                code="no_self_patient",
                status_code=409,
            )
        if not patient["is_active"]:
            raise AppError(
                "비활성 환자는 예약할 수 없습니다.",
                code="patient_inactive",
                status_code=422,
            )
        patient_id = patient["id"]
        # 노쇼 임계 초과 차단(6.7/FR-015) — 본인 예약도 제한 대상(원무 대리와 동일 정책).
        await _assert_no_show_under_threshold(conn, patient_id)
        # 의사(role=doctor·active)·진료과 배정 가능 검증(6.1 헬퍼 재사용·room 없음).
        await _assert_doctor_assignable(conn, doctor_id)
        await _assert_department_assignable(conn, department_id)
        try:
            row = await conn.fetchrow(
                f"insert into public.appointments "
                f"(patient_id, doctor_id, department_id, room_id, scheduled_start, "
                f"scheduled_end, note, sms_opt_in, created_by) "
                f"values ($1, $2, $3, $4, $5, $6, $7, $8, $9) "
                f"returning {_APPOINTMENT_COLUMNS}",
                patient_id,
                doctor_id,
                department_id,
                None,  # 진료실 동적 배정 이월(insert_appointment 동일)
                scheduled_start,
                scheduled_end,
                None,  # note 없음(환자 자유텍스트=임상/PII 리스크 제외)
                sms_opt_in,
                sub,  # created_by = 환자 auth uid(비정규화·0034 FK 제거)
            )
        except asyncpg.ExclusionViolationError as exc:
            raise _double_booking_error() from exc
        except asyncpg.ForeignKeyViolationError as exc:  # 진료과·의사 동시삭제 레이스 백스톱
            raise AppError(
                "참조 대상이 올바르지 않습니다(진료과·의사 등).",
                code="invalid_reference",
                status_code=422,
            ) from exc
        assert row is not None
        return row

    return await _run_authed(sub, _op)


async def fetch_patient_no_show_count(sub: UUID, patient_id: UUID) -> int:
    """환자 노쇼 횟수 조회(6.7·read 엔드포인트용) — 단일 진실 함수 patient_no_show_count(0036) 호출.
    권한 게이트는 라우터(appointment.read). service_role 읽기(존재하지 않는 환자도 0·404 불요).
    쓰기 가드(_assert_no_show_under_threshold)와 같은 함수 공유(카운트 정의 단일 진실)."""

    async def _op(conn: asyncpg.Connection) -> int:
        count = await conn.fetchval("select public.patient_no_show_count($1)", patient_id)
        return int(count)

    return await _run_authed(sub, _op)


async def fetch_appointments_for_date(
    sub: UUID, doctor_ids: list[UUID], range_start: datetime, range_end: datetime
) -> list[asyncpg.Record]:
    """캘린더 overlay 용 — 의사들의 해당 날짜(UTC 범위) 예약 + 환자명. staff 캘린더
    (appointment.read)라 환자명 반환 OK(대기 현황판 4.3 선례). booked·cancelled·no_show·
    completed 전부(상태별 렌더). service_role(RLS 우회)."""

    async def _op(conn: asyncpg.Connection) -> list[asyncpg.Record]:
        return await conn.fetch(
            "select a.id, a.doctor_id, a.scheduled_start, a.scheduled_end, a.status, "
            "  p.name as patient_name "
            "from public.appointments a "
            "join public.patients p on p.id = a.patient_id "
            "where a.doctor_id = any($1::uuid[]) "
            "  and a.scheduled_start < $3 and a.scheduled_end > $2 "
            "order by a.scheduled_start",
            doctor_ids,
            range_start,
            range_end,
        )

    return await _run_authed(sub, _op)


async def fetch_affected_appointments(
    sub: UUID, doctor_id: UUID, range_start: datetime, range_end: datetime
) -> list[asyncpg.Record]:
    """휴진 영향 예약 조회(6.8·FR-016) — 그 의사의 `status='booked'` 예약 중 휴진 기간
    [range_start, range_end) 와 **반열림 겹침**하는 것 + 환자명. cancelled·no_show·completed 는
    슬롯 미점유/종결 → 제외. staff(appointment.read·라우터 게이트)라 환자명 반환 OK(대기 현황판 4.3·
    캘린더 6.3 선례)·주민번호/연락처 미반환. service_role(RLS 우회·fetch_appointments_for_date
    패턴)."""

    async def _op(conn: asyncpg.Connection) -> list[asyncpg.Record]:
        return await conn.fetch(
            "select a.id, a.patient_id, a.doctor_id, a.department_id, a.scheduled_start, "
            "  a.scheduled_end, a.status, p.name as patient_name "
            "from public.appointments a "
            "join public.patients p on p.id = a.patient_id "
            "where a.doctor_id = $1 and a.status = 'booked' "
            "  and a.scheduled_start < $3 and a.scheduled_end > $2 "
            "order by a.scheduled_start",
            doctor_id,
            range_start,
            range_end,
        )

    return await _run_authed(sub, _op)


# ══════════════════════════════════════════════════════════════════════════════
# 예약 전이·변경·도착 접수 (Story 6.4 — 0033) — service_role 직접 UPDATE(전이 트리거 백스톱)
# 전이 매트릭스 = enforce_appointment_transition(0033·booked→cancelled/no_show/completed·PT409).
# 각 함수는 소스상태 precondition 선검사(트리거 same-status 통과 사각 차단 — 재취소·재완료 방지).
# ══════════════════════════════════════════════════════════════════════════════


async def _require_appointment_update(conn: asyncpg.Connection) -> None:
    """쓰기 직전 동일 트랜잭션에서 appointment.update 재평가(TOCTOU 차단). 미보유 → 403."""
    if not bool(await conn.fetchval("select public.has_permission('appointment.update')")):
        raise ForbiddenError(detail={"required_permission": "appointment.update"})


async def _fetch_appointment_for_update(
    conn: asyncpg.Connection, appointment_id: UUID
) -> asyncpg.Record:
    """전이 대상 예약 for-update 선조회(미존재 404)."""
    row = await conn.fetchrow(
        f"select {_APPOINTMENT_COLUMNS} from public.appointments where id = $1 for update",
        appointment_id,
    )
    if row is None:
        raise NotFoundError(
            "예약을 찾을 수 없습니다.", detail={"appointment_id": str(appointment_id)}
        )
    return row


def _appointment_transition_error() -> ConflictError:
    """소스상태 precondition 위반 → 409 invalid_transition(트리거 PT409 동일 코드·매핑 정합)."""
    return ConflictError("해당 상태의 예약은 그 전이를 할 수 없습니다.", code="invalid_transition")


async def cancel_appointment(
    sub: UUID, appointment_id: UUID, *, reason: str | None
) -> asyncpg.Record:
    """예약 취소(booked→cancelled·cancelled_at). 소스 booked 아니면 409(재취소 차단)."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_appointment_update(conn)
        row = await _fetch_appointment_for_update(conn, appointment_id)
        if row["status"] != "booked":
            raise _appointment_transition_error()
        updated = await conn.fetchrow(
            f"update public.appointments set status = 'cancelled', cancelled_at = now(), "
            f"cancel_reason = $2, updated_at = now() where id = $1 "
            f"returning {_APPOINTMENT_COLUMNS}",
            appointment_id,
            reason,
        )
        assert updated is not None
        return updated

    return await _run_authed(sub, _op)


async def mark_appointment_no_show(
    sub: UUID, appointment_id: UUID, *, reason: str | None
) -> asyncpg.Record:
    """예약 노쇼(booked→no_show·no_show_at). 소스 booked 아니면 409. 6.7 노쇼 카운트 근거."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_appointment_update(conn)
        row = await _fetch_appointment_for_update(conn, appointment_id)
        if row["status"] != "booked":
            raise _appointment_transition_error()
        updated = await conn.fetchrow(
            f"update public.appointments set status = 'no_show', no_show_at = now(), "
            f"cancel_reason = $2, updated_at = now() where id = $1 "
            f"returning {_APPOINTMENT_COLUMNS}",
            appointment_id,
            reason,
        )
        assert updated is not None
        return updated

    return await _run_authed(sub, _op)


async def reschedule_appointment(
    sub: UUID,
    appointment_id: UUID,
    *,
    doctor_id: UUID,
    scheduled_start: datetime,
    scheduled_end: datetime,
) -> asyncpg.Record:
    """예약 변경(시각·의사 재배치·status 불변 booked → 트리거 same-status 통과). 소스 booked 아니면
    409·비-의사/비활성 → 422·더블부킹 EXCLUDE(23P01) → 409. 슬롯-윈도우 검증은 서비스.

    ⚠️ 의사 변경(휴진 재배정·6.8) 시 department_id 를 새 의사의 home 진료과로 동기화 — 부서-스코프
    캘린더(fetch_bookable_doctors)에서 고아 방지(deferred 'reschedule department_id 미동기화' 청산).
    **같은 의사면 department_id 불변**(다중 진료과 의사가 시각만 옮길 때 home-dept 로 덮어쓰는 회귀
    차단). 새 의사 진료과 멤버십(doctor_schedules) 검증은 UI 가 같은 진료과 피커로 제한해 미도달 —
    서버 백스톱은 별개 이월."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_appointment_update(conn)
        row = await _fetch_appointment_for_update(conn, appointment_id)
        if row["status"] != "booked":
            raise _appointment_transition_error()
        await _assert_doctor_assignable(conn, doctor_id)
        new_department_id = row["department_id"]
        if doctor_id != row["doctor_id"]:
            doctor_dept = await conn.fetchval(
                "select department_id from public.users where id = $1", doctor_id
            )
            new_department_id = doctor_dept or row["department_id"]  # NULL home → 기존 유지
        try:
            updated = await conn.fetchrow(
                f"update public.appointments set doctor_id = $2, department_id = $5, "
                f"scheduled_start = $3, scheduled_end = $4, updated_at = now() where id = $1 "
                f"returning {_APPOINTMENT_COLUMNS}",
                appointment_id,
                doctor_id,
                scheduled_start,
                scheduled_end,
                new_department_id,
            )
        except asyncpg.ExclusionViolationError as exc:
            raise _double_booking_error() from exc
        assert updated is not None
        return updated

    return await _run_authed(sub, _op)


async def check_in_reservation(sub: UUID, appointment_id: UUID) -> asyncpg.Record:
    """예약 환자 도착 접수 — 단일 txn: reserved registered 내원 생성 + 예약→completed.

    예약 booked 선검사(아니면 409). 내원 INSERT 는 walk-in 패턴 미러(visit_type='reserved'·
    status='registered'·patient/department=예약값) → 대기 현황판(4.3) 진입. appointment.update +
    encounter.register 양쪽 TOCTOU(원무 보유). 반환 = 생성된 내원(EncounterResponse)."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record:
        await _require_appointment_update(conn)
        await _require_encounter_register(conn)
        appt = await _fetch_appointment_for_update(conn, appointment_id)
        if appt["status"] != "booked":
            raise _appointment_transition_error()
        # 환자/진료과 활성 재검사(insert_walk_in_encounter 미러 — 예약 후 soft-delete/폐과 시 대기판
        # 진입 차단). 예약 시 유효했어도 도착 시점 비활성이면 422(접수 거부·예약 취소 유도).
        patient_active = await conn.fetchval(
            "select is_active from public.patients where id = $1", appt["patient_id"]
        )
        if not patient_active:
            raise AppError(
                "비활성 환자는 접수할 수 없습니다.",
                code="patient_inactive",
                status_code=422,
                detail={"patient_id": str(appt["patient_id"])},
            )
        dept_active = await conn.fetchval(
            "select is_active from public.departments where id = $1", appt["department_id"]
        )
        if not dept_active:
            raise AppError(
                "비활성 진료과로는 접수할 수 없습니다.",
                code="department_inactive",
                status_code=422,
                detail={"department_id": str(appt["department_id"])},
            )
        enc = await conn.fetchrow(
            f"insert into public.encounters "
            f"(patient_id, department_id, visit_type, status, registered_at, "
            f"created_by, reservation_id) "
            f"values ($1, $2, 'reserved', 'registered', now(), $3, $4) "
            f"returning {_ENCOUNTER_COLUMNS}",
            appt["patient_id"],
            appt["department_id"],
            sub,
            appointment_id,
        )
        assert enc is not None
        await conn.execute(
            "update public.appointments set status = 'completed', completed_at = now(), "
            "updated_at = now() where id = $1",
            appointment_id,
        )
        return enc

    return await _run_authed(sub, _op)


# ══════════════════════════════════════════════════════════════════════════════
# SMS 리마인더 · 알림 로그 (Story 6.6 — 0035) — service_role 직접 INSERT(시뮬 이음매)
# 디스패치 = booked∩sms_opt_in∩{D-3,D-1} 스캔 → 시뮬 발송 → notification_logs(멱등 ON CONFLICT).
# 읽기(due 예약·로그)는 service_role(RLS 우회·fetch_appointments_for_date 패턴). 발송 권한은 쓰기
# 직전 동일 txn 재평가(_require_appointment_create 미러). PII: phone 은 마스킹용 내부 — 응답 미반환.
# ══════════════════════════════════════════════════════════════════════════════

_NOTIFICATION_COLUMNS = (
    "id, appointment_id, patient_id, channel, reminder_kind, recipient_masked, body, "
    "status, skip_reason, appointment_start, sent_at, created_at"
)


async def _require_notification_send(conn: asyncpg.Connection) -> None:
    """쓰기 직전 동일 트랜잭션에서 notification.send 재평가(TOCTOU 차단). 미보유 → 403."""
    if not bool(await conn.fetchval("select public.has_permission('notification.send')")):
        raise ForbiddenError(detail={"required_permission": "notification.send"})


async def fetch_reminder_due_appointments(
    sub: UUID,
    *,
    d3_start: datetime,
    d3_end: datetime,
    d1_start: datetime,
    d1_end: datetime,
) -> list[asyncpg.Record]:
    """리마인더 디스패치용 — `status='booked'` ∩ `sms_opt_in` ∩ scheduled_start 가 D-3 또는 D-1
    KST 일자(서비스가 UTC [start,end) 범위로 전달)인 예약 + 환자 phone + 진료과명.

    ⚠️ phone·department_name 은 **마스킹·body 생성용 내부값** — 서비스가 마스킹/비-식별 처리 후
    notification_logs 에 저장하며, 엔드포인트 응답에는 원시 phone 이 절대 반환되지 않는다(AC4).
    service_role(RLS 우회·`fetch_appointments_for_date` 패턴). 취소·노쇼·완료·미동의는 대상 외.
    """

    async def _op(conn: asyncpg.Connection) -> list[asyncpg.Record]:
        return await conn.fetch(
            "select a.id, a.patient_id, a.scheduled_start, p.phone, d.name as department_name "
            "from public.appointments a "
            "join public.patients p on p.id = a.patient_id "
            "join public.departments d on d.id = a.department_id "
            "where a.status = 'booked' and a.sms_opt_in "
            "  and ((a.scheduled_start >= $1 and a.scheduled_start < $2) "
            "    or (a.scheduled_start >= $3 and a.scheduled_start < $4)) "
            "order by a.scheduled_start",
            d3_start,
            d3_end,
            d1_start,
            d1_end,
        )

    return await _run_authed(sub, _op)


async def fetch_appointment_notice_context(
    sub: UUID, appointment_id: UUID
) -> asyncpg.Record | None:
    """변경 통지(6.8 reschedule_notice/cancellation_notice) 생성용 — 예약의 현재 시각·환자·진료과명.
    환자 phone. ⚠️ phone 은 **마스킹용 내부값**(fetch_reminder_due_appointments posture — 서비스가
    mask_phone 후 저장·응답에 원시 phone 절대 미반환). status 무관 조회(취소된 예약도 통지 대상).
    미존재 → None(서비스가 404). service_role(RLS 우회)."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record | None:
        return await conn.fetchrow(
            "select a.patient_id, a.scheduled_start, p.phone, d.name as department_name "
            "from public.appointments a "
            "join public.patients p on p.id = a.patient_id "
            "join public.departments d on d.id = a.department_id "
            "where a.id = $1",
            appointment_id,
        )

    return await _run_authed(sub, _op)


async def insert_notification_log(
    sub: UUID,
    *,
    appointment_id: UUID,
    patient_id: UUID,
    reminder_kind: str,
    recipient_masked: str | None,
    body: str,
    status: str,
    skip_reason: str | None,
    appointment_start: datetime,
    sent_at: datetime | None,
) -> asyncpg.Record | None:
    """리마인더 발송 로그 INSERT(시뮬·자동 감사). 멱등: `on conflict (appointment_id, reminder_kind)
    do nothing` → 충돌(이미 발송됨) 시 **None** 반환(재실행 중복 0·AC2). 발송 권한은 쓰기 직전
    동일 txn 재평가(TOCTOU). ⚠️ recipient_masked 는 마스킹 완료값·body 는 비-식별(AC4)."""

    async def _op(conn: asyncpg.Connection) -> asyncpg.Record | None:
        await _require_notification_send(conn)
        return await conn.fetchrow(
            f"insert into public.notification_logs "
            f"(appointment_id, patient_id, reminder_kind, recipient_masked, body, status, "
            f"skip_reason, appointment_start, sent_at) "
            f"values ($1, $2, $3, $4, $5, $6, $7, $8, $9) "
            f"on conflict (appointment_id, reminder_kind) do nothing "
            f"returning {_NOTIFICATION_COLUMNS}",
            appointment_id,
            patient_id,
            reminder_kind,
            recipient_masked,
            body,
            status,
            skip_reason,
            appointment_start,
            sent_at,
        )

    return await _run_authed(sub, _op)


async def fetch_notification_logs(sub: UUID, *, limit: int) -> list[asyncpg.Record]:
    """알림 로그 조회(최근 발송 이력·created_at 내림차순). 엔드포인트 notification.read 게이트로
    충분(읽기 재평가 불요·슬롯 선례). service_role(RLS 우회). 원시 phone 미조회(컬럼 없음)."""

    async def _op(conn: asyncpg.Connection) -> list[asyncpg.Record]:
        return await conn.fetch(
            f"select {_NOTIFICATION_COLUMNS} from public.notification_logs "
            f"order by created_at desc limit $1",
            limit,
        )

    return await _run_authed(sub, _op)


# ══════════════════════════════════════════════════════════════════════════════
# 방사선 촬영·영상 업로드·장비(Story 5.8 / FR-100·FR-101·FR-103) — examinations 수행 측(imaging)
# ══════════════════════════════════════════════════════════════════════════════
# 촬영 수행 엔진(perform_examination RPC·전이 트리거·권한)은 0015 완비.
# 본 섹션 = 워크리스트·장비 조회·영상(examination_images) 연결/조회·수행 wrapper(영상≥1·장비 배정).

_EXAMINATION_IMAGE_COLUMNS = (
    "ei.id, ei.examination_id, ei.content_type, ei.file_size, "
    "ei.uploaded_by, uu.name as uploaded_by_name, ei.uploaded_at, ei.storage_path"
)
_EXAMINATION_IMAGE_FROM = (
    "from public.examination_images ei left join public.users uu on uu.id = ei.uploaded_by"
)


async def fetch_radiology_worklist(sub: UUID, on_date: date) -> list[dict[str, object]]:
    """촬영 워크리스트(FR-100) — 오늘(KST) 활성 내원의 미수행 영상검사 오더(imaging·ordered).

    게이트=라우터(examination.perform). service_role(RLS 우회). patients·departments·fee_schedules
    조인 = 비-PII 투영(fetch_nursing_worklist 자세). image_count=업로드 누적(상관 서브쿼리). 지시
    오래된 순(FIFO·ordered_at asc).
    """

    async def _op(conn: asyncpg.Connection) -> list[dict[str, object]]:
        rows = await conn.fetch(
            "select ex.id as examination_id, ex.encounter_id, p.chart_no, "
            "p.name as patient_name, d.name as department_name, fs.name as fee_name, "
            "ex.status, ub.name as ordered_by_name, ex.ordered_at, "
            "(select count(*) from public.examination_images ei "
            " where ei.examination_id = ex.id and ei.is_active = true) as image_count "
            "from public.examinations ex "
            "join public.encounters e on e.id = ex.encounter_id "
            "join public.patients p on p.id = e.patient_id "
            "join public.departments d on d.id = e.department_id "
            "join public.fee_schedules fs on fs.id = ex.fee_schedule_id "
            "left join public.users ub on ub.id = ex.ordered_by "
            "where ex.exam_type = 'imaging' and ex.status = 'ordered' and ex.is_active = true "
            "and e.is_active = true and e.status in ('registered', 'in_progress') "
            "and (e.created_at at time zone 'Asia/Seoul')::date = $1 "
            "order by ex.ordered_at asc",
            on_date,
        )
        return [dict(r) for r in rows]

    return await _run_authed(sub, _op)


async def fetch_equipment(sub: UUID) -> list[dict[str, object]]:
    """장비 목록·상태(FR-103) — 활성 장비(코드순). 게이트=라우터(order.read). 비민감 전역 참조.

    service_role(RLS 우회·equipment 는 authenticated 전체 SELECT). 촬영 배정·가용성 확인용 읽기.
    """

    async def _op(conn: asyncpg.Connection) -> list[dict[str, object]]:
        rows = await conn.fetch(
            "select id, code, name, modality, status, is_active "
            "from public.equipment where is_active = true order by code"
        )
        return [dict(r) for r in rows]

    return await _run_authed(sub, _op)


async def insert_examination_image(
    sub: UUID,
    *,
    examination_id: UUID,
    storage_path: str,
    content_type: str,
    file_size: int | None,
    uploaded_by: UUID,
) -> dict[str, object]:
    """촬영 영상 1건 연결(FR-101) — examination_images INSERT(자동 감사). Storage 업로드 후 호출.

    검사 존재·imaging·ordered 선검사(미존재 404·lab 422 not_imaging·비-ordered 409 locked
    = 이미 촬영 수행된 검사엔 추가 금지). DB 엔 storage_path(경로)만. 잘못된 FK(23503) → 422. 반환 =
    users 조인 dict(서비스가 서명 URL 합성).
    """

    async def _op(conn: asyncpg.Connection) -> dict[str, object]:
        meta = await conn.fetchrow(
            "select exam_type, status from public.examinations where id = $1 and is_active = true",
            examination_id,
        )
        if meta is None:
            raise NotFoundError(
                "검사 오더를 찾을 수 없습니다.", detail={"examination_id": str(examination_id)}
            )
        if meta["exam_type"] != "imaging":
            raise AppError("영상검사 오더가 아닙니다.", code="not_imaging", status_code=422)
        if meta["status"] != "ordered":
            raise ConflictError("이미 촬영 수행된 검사입니다.", code="examination_locked")
        try:
            row = await conn.fetchrow(
                "insert into public.examination_images "
                "(examination_id, storage_path, content_type, file_size, uploaded_by) "
                "values ($1, $2, $3, $4, $5) returning id",
                examination_id,
                storage_path,
                content_type,
                file_size,
                uploaded_by,
            )
        except asyncpg.ForeignKeyViolationError as exc:
            raise AppError(
                "참조 대상이 올바르지 않습니다(검사 오더).",
                code="invalid_reference",
                status_code=422,
            ) from exc
        assert row is not None  # RETURNING 은 항상 1행
        full = await conn.fetchrow(
            f"select {_EXAMINATION_IMAGE_COLUMNS} {_EXAMINATION_IMAGE_FROM} where ei.id = $1",
            row["id"],
        )
        assert full is not None
        return dict(full)

    return await _run_authed(sub, _op)


async def fetch_examination_images(sub: UUID, examination_id: UUID) -> list[dict[str, object]]:
    """한 검사의 촬영 영상 목록(업로드순·활성만, users 조인). 게이트=라우터(order.read).

    service_role(RLS 우회). 서명 URL 은 서비스가 storage_path 로 매 조회 생성(db 는 경로만 반환 —
    5.9 판독의도 이 경로로 재사용). 검사 미존재 시 빈 목록(404 아님 — 조회 관용).
    """

    async def _op(conn: asyncpg.Connection) -> list[dict[str, object]]:
        rows = await conn.fetch(
            f"select {_EXAMINATION_IMAGE_COLUMNS} {_EXAMINATION_IMAGE_FROM} "
            f"where ei.examination_id = $1 and ei.is_active = true "
            f"order by ei.uploaded_at asc, ei.id asc",
            examination_id,
        )
        return [dict(r) for r in rows]

    return await _run_authed(sub, _op)


async def call_perform_examination(
    sub: UUID, *, examination_id: UUID, equipment_id: UUID | None
) -> dict[str, object]:
    """촬영 수행(FR-101·FR-093) — perform_examination RPC(ordered→performed). 영상≥1·장비 배정.

    선검사: 검사 존재(404)·imaging(422 not_imaging)·ordered(아니면 409 invalid_transition = 재수행
    차단 친절선, RPC PT409 백스톱). 활성 영상 0장 → 422 image_required. equipment_id 제공 시 활성
    장비 검증(422 invalid_equipment) 후 same-status UPDATE 로 배정(0015 전이 트리거 통과).
    이후 perform_examination RPC(SECURITY DEFINER·performed_by=auth.uid·performed_at, PT404/PT409
    자동 매핑). 반환 = fee/users 조인 dict(_EXAMINATION_COLUMNS).
    """

    async def _op(conn: asyncpg.Connection) -> dict[str, object]:
        meta = await conn.fetchrow(
            "select exam_type, status from public.examinations where id = $1 and is_active = true",
            examination_id,
        )
        if meta is None:
            raise NotFoundError(
                "검사 오더를 찾을 수 없습니다.", detail={"examination_id": str(examination_id)}
            )
        if meta["exam_type"] != "imaging":
            raise AppError("영상검사 오더가 아닙니다.", code="not_imaging", status_code=422)
        if meta["status"] != "ordered":
            # 이미 performed/completed = 재수행 차단(FR-093). RPC PT409 도 동일하나 친절한 선검사.
            raise ConflictError(code="invalid_transition")
        image_count = await conn.fetchval(
            "select count(*) from public.examination_images "
            "where examination_id = $1 and is_active = true",
            examination_id,
        )
        if not image_count:
            raise AppError(
                "촬영 영상을 1장 이상 업로드해야 수행할 수 있습니다.",
                code="image_required",
                status_code=422,
            )
        if equipment_id is not None:
            active = await conn.fetchval(
                "select is_active from public.equipment where id = $1", equipment_id
            )
            if not active:  # None(미존재) 또는 False(비활성)
                raise AppError(
                    "장비가 올바르지 않습니다.", code="invalid_equipment", status_code=422
                )
            # same-status UPDATE(status='ordered' 유지) → 전이 트리거 통과(0015:159) → 장비 배정.
            await conn.execute(
                "update public.examinations set equipment_id = $1, updated_at = now() "
                "where id = $2",
                equipment_id,
                examination_id,
            )
        # 전이 RPC(SECURITY DEFINER·재수행 차단). SQLSTATE → _run_authed 매핑(여기 try/except 불요).
        await conn.fetchrow("select * from public.perform_examination($1)", examination_id)
        full = await conn.fetchrow(
            f"select {_EXAMINATION_COLUMNS} {_EXAMINATION_FROM} where ex.id = $1",
            examination_id,
        )
        assert full is not None
        return dict(full)

    return await _run_authed(sub, _op)


# ══════════════════════════════════════════════════════════════════════════════
# 영상 판독·검사 오더 완료(Story 5.9 / FR-102) — examinations 판독 측(imaging·진료의 겸임)
# ══════════════════════════════════════════════════════════════════════════════
# 판독·완료 엔진(complete_examination RPC·전이 트리거·examination.complete 권한)은 0015 완비.
# 본 섹션 = 판독 워크리스트 조회 + 완료 wrapper(소견·결론 same-status UPDATE → 완료 전이).


async def fetch_reading_worklist(sub: UUID, on_date: date) -> list[dict[str, object]]:
    """판독 워크리스트(FR-102) — 오늘(KST) 활성 내원의 미판독 영상검사(imaging·performed).

    게이트=라우터(examination.complete). service_role. fetch_radiology_worklist 미러 — 상태 축만
    ordered→performed, performed_by(up) 조인·performed_at 추가. 비-PII. FIFO(performed_at).
    """

    async def _op(conn: asyncpg.Connection) -> list[dict[str, object]]:
        rows = await conn.fetch(
            "select ex.id as examination_id, ex.encounter_id, p.chart_no, "
            "p.name as patient_name, d.name as department_name, fs.name as fee_name, "
            "ex.status, ub.name as ordered_by_name, ex.ordered_at, "
            "up.name as performed_by_name, ex.performed_at, "
            "(select count(*) from public.examination_images ei "
            " where ei.examination_id = ex.id and ei.is_active = true) as image_count "
            "from public.examinations ex "
            "join public.encounters e on e.id = ex.encounter_id "
            "join public.patients p on p.id = e.patient_id "
            "join public.departments d on d.id = e.department_id "
            "join public.fee_schedules fs on fs.id = ex.fee_schedule_id "
            "left join public.users ub on ub.id = ex.ordered_by "
            "left join public.users up on up.id = ex.performed_by "
            "where ex.exam_type = 'imaging' and ex.status = 'performed' and ex.is_active = true "
            "and e.is_active = true and e.status in ('registered', 'in_progress') "
            "and (e.created_at at time zone 'Asia/Seoul')::date = $1 "
            "order by ex.performed_at asc",
            on_date,
        )
        return [dict(r) for r in rows]

    return await _run_authed(sub, _op)


async def call_complete_examination(
    sub: UUID, *, examination_id: UUID, findings: str, reading_conclusion: str | None
) -> dict[str, object]:
    """판독 완료(FR-102·FR-093) — complete_examination RPC(performed→completed). 소견·결론 기록.

    선검사: 존재(404)·imaging(422 not_imaging)·performed(아니면 409 invalid_transition = 미수행/
    재완료 차단·RPC PT409 백스톱). 소견·결론 same-status UPDATE(status='performed' 유지·트리거 통과)
    후 complete_examination RPC(completed_by/at·PT404/PT409 자동). UPDATE↔RPC = 동일 txn 원자
    (전이 거부 시 소견 롤백). 반환 = _EXAMINATION_COLUMNS dict(findings 포함).
    """

    async def _op(conn: asyncpg.Connection) -> dict[str, object]:
        meta = await conn.fetchrow(
            "select exam_type, status from public.examinations where id = $1 and is_active = true",
            examination_id,
        )
        if meta is None:
            raise NotFoundError(
                "검사 오더를 찾을 수 없습니다.", detail={"examination_id": str(examination_id)}
            )
        if meta["exam_type"] != "imaging":
            raise AppError("영상검사 오더가 아닙니다.", code="not_imaging", status_code=422)
        if meta["status"] != "performed":
            # 미수행/이미 판독 = 전이 불가(FR-093). 친절 선검사·RPC PT409 백스톱.
            raise ConflictError(code="invalid_transition")
        # same-status UPDATE(status='performed' 유지) → 전이 트리거 통과(0015:159) → 소견·결론 기록.
        await conn.execute(
            "update public.examinations set findings = $1, reading_conclusion = $2, "
            "updated_at = now() where id = $3",
            findings,
            reading_conclusion,
            examination_id,
        )
        # 전이 RPC(SECURITY DEFINER·재완료 차단). SQLSTATE → _run_authed 매핑(여기 try/except 불요).
        await conn.fetchrow("select * from public.complete_examination($1)", examination_id)
        full = await conn.fetchrow(
            f"select {_EXAMINATION_COLUMNS} {_EXAMINATION_FROM} where ex.id = $1",
            examination_id,
        )
        assert full is not None
        return dict(full)

    return await _run_authed(sub, _op)


# ── 수납(billing) 집계·조회 — Story 7.2 / FR-110 ──────────────────────────────
# 집계 로직(fee_items → payment_details + 헤더 롤업)은 build_payment DB 함수가 소유(project-context
# "수가/정산 로직=DB"). 여기 db 계층은 호출·조회·권한 재평가만. 쓰기=payment.manage·조회=read.
# (라우터 게이트 + 쓰기는 동일 txn 재평가 TOCTOU). 금액=KRW 정수. 컬럼은 고정 리터럴(SQLi 무관).
_PAYMENT_COLUMNS = (
    "id, encounter_id, status, billing_type, total_amount_krw, covered_amount_krw, "
    "non_covered_amount_krw, copay_amount_krw, insurer_amount_krw, paid_amount_krw, "
    "refunded_amount_krw, "
    "payment_method, payment_no, finalized_at, finalized_by, cancelled_at, cancel_reason, "
    "created_at, updated_at"
)
_PAYMENT_DETAIL_COLUMNS = (
    "id, payment_id, fee_item_id, fee_schedule_id, code, name, category, quantity, "
    "unit_amount_krw, amount_krw, coverage_type, copay_rate, copay_amount_krw, "
    "insurer_amount_krw, created_at, updated_at"
)
# 헤더 조회 = payments 전 컬럼 + 환자 보험유형(산정 근거·7.3) + 신원(이름·차트번호 — 재진술
#   confirm·상시 배너·7.4). 환자 컬럼은 상관 서브쿼리로 부착(JOIN 시 컬럼명 충돌 회피). 보험유형=
#   비-PII enum, 이름·차트번호=denormalized 표시(워크리스트 posture 계승·라우트/로그 미유입).
#   build_payment(by payment id)·fetch_payment(by encounter id) 공통 — WHERE 만 다르게 이어 붙임.
_PAYMENT_HEADER_SELECT = (
    f"select {_PAYMENT_COLUMNS}, "
    "(select pat.insurance_type from public.encounters e "
    " join public.patients pat on pat.id = e.patient_id "
    " where e.id = payments.encounter_id) as insurance_type, "
    "(select pat.name from public.encounters e "
    " join public.patients pat on pat.id = e.patient_id "
    " where e.id = payments.encounter_id) as patient_name, "
    "(select pat.chart_no from public.encounters e "
    " join public.patients pat on pat.id = e.patient_id "
    " where e.id = payments.encounter_id) as chart_no, "
    # 미수행 오더 카운트(부분수행 가시성·7.10·청구 제외=fee 0).
    #   payment.read 경로. prescriptions 제외(fee 0·수행 개념 없음).
    "((select count(*) from public.examinations ex "
    "  where ex.encounter_id = payments.encounter_id "
    "    and ex.status = 'ordered' and ex.is_active) "
    " + (select count(*) from public.treatment_orders tr "
    "    where tr.encounter_id = payments.encounter_id "
    "      and tr.status = 'ordered' and tr.is_active)) "
    "as pending_orders_count "
    "from public.payments"
)
# 워크리스트(정산 대상) — 내원 + denormalized 표시 + 예상 총액(Σ fee_items 라이브). raw PII 제외.
_BILLING_WORKLIST_COLUMNS = (
    "e.id as encounter_id, e.encounter_no, e.consult_started_at, e.status, "
    "p.name as patient_name, p.chart_no, d.name as department_name, "
    "coalesce((select sum(fi.amount_krw) from public.fee_items fi "
    "where fi.encounter_id = e.id), 0) as estimated_total_krw"
)


async def _require_payment_manage(conn: asyncpg.Connection) -> None:
    """쓰기 직전 동일 txn 에서 payment.manage 재평가(평가↔쓰기 TOCTOU 차단). 미보유 → 403.

    라우터 require_permission 게이트는 방어심층 — 진짜 권위는 이 동일 트랜잭션 재평가(insert_patient
    선례). 집계 빌드(build_payment)는 SECURITY DEFINER 함수라 RLS 우회 → 권한은 여기서 강제.
    """
    if not bool(await conn.fetchval("select public.has_permission('payment.manage')")):
        raise ForbiddenError(detail={"required_permission": "payment.manage"})


async def _fetch_payment_details(
    conn: asyncpg.Connection, payment_id: UUID
) -> list[asyncpg.Record]:
    """한 수납 건의 상세 라인(집계순=적재순) — 쓰기 후 응답·조회 공용. 진찰료가 먼저(적재 순)."""
    return await conn.fetch(
        f"select {_PAYMENT_DETAIL_COLUMNS} from public.payment_details "
        f"where payment_id = $1 order by created_at asc, id asc",
        payment_id,
    )


async def build_payment(sub: UUID, encounter_id: UUID) -> dict[str, object]:
    """수납 건 집계 + 본인부담 산정(진입 시 자동·멱등) — build_payment→price_payment 호출.

    집계(fee_items → payment_details 적재 + total/covered/non_covered 롤업·7.2)에 이어 본인부담
    산정(라인 copay/insurer + 헤더 copay/insurer 롤업·7.3)을 동일 트랜잭션에서 수행(NFR-041). 두 RPC
    모두 멱등(재호출 시 신규 수가만 집계 + 전 라인 재산정·미변경 no-op). 미존재 내원 → 404, 권한
    (payment.manage) 미보유 → 403(INSERT 직전 재평가 TOCTOU·산정도 쓰기라 동일 게이트).
    """

    async def _op(conn: asyncpg.Connection) -> dict[str, object]:
        await _require_payment_manage(conn)
        exists = await conn.fetchval(
            "select true from public.encounters where id = $1", encounter_id
        )
        if exists is None:
            raise NotFoundError(
                "내원을 찾을 수 없습니다.", detail={"encounter_id": str(encounter_id)}
            )
        payment_id = await conn.fetchval("select public.build_payment($1)", encounter_id)
        assert payment_id is not None  # build_payment 는 항상 payment_id 반환(헤더 upsert)
        # 집계에 이어 본인부담 산정(동일 txn — Story 7.3). draft 외/헤더 없음은 함수가 no-op 처리.
        await conn.fetchval("select public.price_payment($1)", encounter_id)
        header = await conn.fetchrow(f"{_PAYMENT_HEADER_SELECT} where id = $1", payment_id)
        assert header is not None
        details = await _fetch_payment_details(conn, payment_id)
        return {**dict(header), "details": [dict(r) for r in details]}

    return await _run_authed(sub, _op)


async def finalize_payment(sub: UUID, encounter_id: UUID, payment_method: str) -> dict[str, object]:
    """수납 finalize(결제 기록 + 내원 완료) — build→price→finalize→complete 원자(Story 7.4·NFR-041).

    한 트랜잭션에서: 권한 재평가(payment.manage) → 내원 존재검사(404) → build_payment(집계 신선화)
    → price_payment(산정 — finalize 전 선행 보장·L385) → finalize_payment(결제 컬럼 +
    complete_encounter 완료). 모든 RPC 동일 txn = 원자(중간 실패 롤백). finalize_payment 의
    complete_encounter 의 주상병 미지정 → PT422, 비-in_progress → PT409 가 raise → _map_pg_sqlstate
    가 422/409 로 변환(여기 try/except 불요·build_payment 동형). 비-draft 재finalize → PT409.
    """

    async def _op(conn: asyncpg.Connection) -> dict[str, object]:
        await _require_payment_manage(conn)
        exists = await conn.fetchval(
            "select true from public.encounters where id = $1", encounter_id
        )
        if exists is None:
            raise NotFoundError(
                "내원을 찾을 수 없습니다.", detail={"encounter_id": str(encounter_id)}
            )
        # finalize 직전 build→price 재실행(신선 집계·산정·price 선행 보장). draft 라 함수 동작.
        await conn.fetchval("select public.build_payment($1)", encounter_id)
        await conn.fetchval("select public.price_payment($1)", encounter_id)
        payment_id = await conn.fetchval(
            "select public.finalize_payment($1, $2)", encounter_id, payment_method
        )
        assert payment_id is not None  # finalize_payment 는 성공 시 payment_id 반환(실패는 raise)
        header = await conn.fetchrow(f"{_PAYMENT_HEADER_SELECT} where id = $1", payment_id)
        assert header is not None
        details = await _fetch_payment_details(conn, payment_id)
        return {**dict(header), "details": [dict(r) for r in details]}

    return await _run_authed(sub, _op)


async def prepay_payment(
    sub: UUID, encounter_id: UUID, amount_krw: int, payment_method: str
) -> dict[str, object]:
    """선결제(선수납) — 선결제액 누적 + billing_type prepaid 전환(Story 7.8·FR-117·NFR-041).

    한 트랜잭션에서: 권한 재평가(payment.manage) → 내원 존재검사(404) → build_payment(신선 집계·
    registered 수가 0 no-op) → price_payment(no-op) → prepay_payment(paid 누적 +
    billing_type='prepaid'·draft 유지). 모든 RPC 동일 txn = 원자(롤백). 선결제는 내원 상태 전이
    없음(완료는 finalize). 이미 finalized/cancelled → PT409, 금액≤0 → PT409(Pydantic 1차),
    권한 미보유 → 403(_require_payment_manage 동일-txn 재평가·build_payment 동형).
    """

    async def _op(conn: asyncpg.Connection) -> dict[str, object]:
        await _require_payment_manage(conn)
        exists = await conn.fetchval(
            "select true from public.encounters where id = $1", encounter_id
        )
        if exists is None:
            raise NotFoundError(
                "내원을 찾을 수 없습니다.", detail={"encounter_id": str(encounter_id)}
            )
        # 선결제 직전 build→price 재실행(신선 집계·산정). registered 에선 수가 0 → 헤더만(no-op).
        await conn.fetchval("select public.build_payment($1)", encounter_id)
        await conn.fetchval("select public.price_payment($1)", encounter_id)
        payment_id = await conn.fetchval(
            "select public.prepay_payment($1, $2, $3)", encounter_id, amount_krw, payment_method
        )
        assert payment_id is not None  # prepay_payment 는 성공 시 payment_id 반환(실패는 raise)
        header = await conn.fetchrow(f"{_PAYMENT_HEADER_SELECT} where id = $1", payment_id)
        assert header is not None
        details = await _fetch_payment_details(conn, payment_id)
        return {**dict(header), "details": [dict(r) for r in details]}

    return await _run_authed(sub, _op)


async def settle_cancelled_visit(
    sub: UUID, encounter_id: UUID, reason: str | None
) -> dict[str, object]:
    """취소·노쇼 정산(수가 미발생·선납 환급) — build→settle 원자(Story 7.9·FR-118·NFR-041).

    한 트랜잭션: 권한 재평가(payment.manage) → 내원 존재검사(404) → build_payment(draft 헤더 보장·
    encounter 아직 registered·finalize/prepay 선행 동형) → settle_cancelled_visit(cancel_encounter
    registered→cancelled + draft void + 선납 전액 환급). 동일 txn = 원자(롤백). settle 내부
    cancel_encounter 의 encounter.cancel 미보유 → 42501→403, 비-registered → PT409, 미존재 → PT404
    raise → _map_pg_sqlstate 가 변환(try/except 불요·prepay 동형).
    """

    async def _op(conn: asyncpg.Connection) -> dict[str, object]:
        await _require_payment_manage(conn)
        exists = await conn.fetchval(
            "select true from public.encounters where id = $1", encounter_id
        )
        if exists is None:
            raise NotFoundError(
                "내원을 찾을 수 없습니다.", detail={"encounter_id": str(encounter_id)}
            )
        # settle 직전 build_payment 선행(draft 헤더 보장·encounter 아직 registered → 0라인 헤더).
        #   settle RPC 가 cancel_encounter 로 전이하므로 build 는 그 전(registered)에 완료돼야 함.
        await conn.fetchval("select public.build_payment($1)", encounter_id)
        payment_id = await conn.fetchval(
            "select public.settle_cancelled_visit($1, $2)", encounter_id, reason
        )
        assert payment_id is not None  # settle 는 성공 시 payment_id 반환(실패는 raise)
        header = await conn.fetchrow(f"{_PAYMENT_HEADER_SELECT} where id = $1", payment_id)
        assert header is not None
        details = await _fetch_payment_details(conn, payment_id)
        return {**dict(header), "details": [dict(r) for r in details]}

    return await _run_authed(sub, _op)


async def fetch_payment(sub: UUID, encounter_id: UUID) -> dict[str, object]:
    """한 내원의 수납 건 조회(헤더 + 라인). 빌드 전(헤더 없음) → 404. 게이트=라우터 payment.read.

    service_role 경로라 RLS 우회 — 조회 권위는 라우터 require_permission('payment.read')
    (읽기 TOCTOU 저위험 → 재평가 불요, fetch_encounter 동형). RLS 는 web 직접조회 방어심층(0045).
    """

    async def _op(conn: asyncpg.Connection) -> dict[str, object]:
        header = await conn.fetchrow(
            f"{_PAYMENT_HEADER_SELECT} where encounter_id = $1",
            encounter_id,
        )
        if header is None:
            raise NotFoundError(
                "수납 건을 찾을 수 없습니다.", detail={"encounter_id": str(encounter_id)}
            )
        details = await _fetch_payment_details(conn, header["id"])
        return {**dict(header), "details": [dict(r) for r in details]}

    return await _run_authed(sub, _op)


# 영수증 문서 조립(Story 7.5) — payments 금액 + 환자(masked RRN·비-_enc/_hash) + 진료과·담당의·
#   진료기간 + 발급담당(finalized_by→users.name). 한 SELECT 로 조립(복잡 read=FastAPI·문서). raw RRN
#   미투영(resident_no_masked 만·PII 경계). 진료기간=consult_started~completed 의 KST date.
_RECEIPT_HEADER_SELECT = (
    "select p.status, p.payment_method, p.payment_no, p.finalized_at, "
    "p.total_amount_krw, p.covered_amount_krw, p.non_covered_amount_krw, "
    "p.copay_amount_krw, p.insurer_amount_krw, p.paid_amount_krw, p.id as payment_id, "
    "pat.name as patient_name, pat.chart_no, pat.resident_no_masked, pat.insurance_type, "
    "dept.name as department_name, doc.name as doctor_name, iss.name as issued_by_name, "
    "(coalesce(e.consult_started_at, e.registered_at, e.created_at) "
    " at time zone 'Asia/Seoul')::date as treatment_started_on, "
    "(coalesce(e.completed_at, e.consult_started_at, e.registered_at, e.created_at) "
    " at time zone 'Asia/Seoul')::date as treatment_ended_on "
    "from public.payments p "
    "join public.encounters e on e.id = p.encounter_id "
    "join public.patients pat on pat.id = e.patient_id "
    "join public.departments dept on dept.id = e.department_id "
    "left join public.users doc on doc.id = e.doctor_id "
    "left join public.users iss on iss.id = p.finalized_by "
    "where p.encounter_id = $1"
)


async def fetch_receipt(sub: UUID, encounter_id: UUID) -> dict[str, object]:
    """진료비 계산서·영수증 문서 데이터 조립(Story 7.5) — finalized 수납 건만(FR-113).

    요양기관(clinic_profile) + 환자(masked RRN) + 진료(진료과/담당의/진료기간) + 결제·발급 + 상세
    라인을 한 트랜잭션에서 조립. 게이트=라우터 payment.read(읽기 TOCTOU 저위험·fetch_payment 동형).
    비-finalized → 409(invalid_transition·"정산된 수납 건"), 헤더 없음 → 404. 금액·산정값은 전부 DB.
    """

    async def _op(conn: asyncpg.Connection) -> dict[str, object]:
        header = await conn.fetchrow(_RECEIPT_HEADER_SELECT, encounter_id)
        if header is None:
            raise NotFoundError(
                "수납 건을 찾을 수 없습니다.", detail={"encounter_id": str(encounter_id)}
            )
        if header["status"] != "finalized":
            # "정산된 수납 건만" — draft/cancelled 영수증 없음(UI 는 finalized 패널 진입·방어).
            raise ConflictError(
                "정산 완료된 수납 건만 영수증을 출력할 수 있습니다.",
                code="invalid_transition",
                detail={"status": header["status"]},
            )
        clinic = await conn.fetchrow(
            "select name, biz_no, hira_no, address, ceo_name, phone "
            "from public.clinic_profile where id = 1"
        )
        if clinic is None:  # seed 보장(AC9) — 미설정은 운영 결함(fail-loud)
            raise AppError(
                "요양기관 정보가 설정되지 않았습니다.",
                code="clinic_profile_missing",
                status_code=500,
            )
        details = await _fetch_payment_details(conn, header["payment_id"])
        copay = int(header["copay_amount_krw"])
        paid = int(header["paid_amount_krw"])
        return {
            "clinic": dict(clinic),
            "patient": {
                "name": header["patient_name"],
                "chart_no": header["chart_no"],
                "resident_no_masked": header["resident_no_masked"],
                "insurance_type": header["insurance_type"],
            },
            "encounter": {
                "department_name": header["department_name"],
                "doctor_name": header["doctor_name"],
                "treatment_started_on": header["treatment_started_on"],
                "treatment_ended_on": header["treatment_ended_on"],
            },
            "status": header["status"],
            "payment_no": header["payment_no"],
            "payment_method": header["payment_method"],
            "finalized_at": header["finalized_at"],
            "issued_by_name": header["issued_by_name"],
            "total_amount_krw": int(header["total_amount_krw"]),
            "covered_amount_krw": int(header["covered_amount_krw"]),
            "non_covered_amount_krw": int(header["non_covered_amount_krw"]),
            "copay_amount_krw": copay,
            "insurer_amount_krw": int(header["insurer_amount_krw"]),
            "paid_amount_krw": paid,
            "due_amount_krw": copay - paid,  # 납부할 금액(표시값 — pricing 아님)
            "details": [dict(r) for r in details],
        }

    return await _run_authed(sub, _op)


async def log_document_export(sub: UUID, encounter_id: UUID, document_type: str) -> None:
    """문서 인쇄/내보내기 = 'read' 감사 기록(Story 7.5·UX-DR22). 게이트=라우터 payment.read.

    log_payment_document_export(SECURITY DEFINER) 가 has_permission('payment.read') 재평가 +
    audit_logs INSERT 를 소유(우회 불가). payment 미존재 → PT404→404, 권한 미보유 → 42501→403.
    """

    async def _op(conn: asyncpg.Connection) -> None:
        await conn.execute(
            "select public.log_payment_document_export($1, $2)", encounter_id, document_type
        )

    await _run_authed(sub, _op)


async def fetch_billing_worklist(
    sub: UUID,
    *,
    on_date: date,
    page: int = 1,
    page_size: int = 200,
) -> tuple[list[asyncpg.Record], int]:
    """수납 워크리스트(정산 대상 — registered/in_progress·오늘·진료과 무관) + 전체 건수(7.2/7.8).

    원무는 병원 단위 정산 → 진료과 미스코프(대기 현황판과 달리 department_id 필터 없음). 일자는
    created_at 의 KST 날짜(fetch_encounters 미러). estimated_total = Σ fee_items(라이브·registered
    는 0). 7.8: registered(선수납 가능)도 포함(상태 칩 구분). 정렬 = 진찰순(registered 는 nulls
    last). 게이트=라우터 payment.read(읽기 TOCTOU 저위험). 반환 (행, total).
    """
    # 선수납(7.8): registered(접수 후·진찰 전)도 정산 대상 포함 — 선결제 진입점(상태 칩으로 구분).
    #   registered 는 consult_started_at NULL → nulls last 로 진찰 시작순 뒤에 자연 정렬.
    list_sql = (
        f"select {_BILLING_WORKLIST_COLUMNS} from public.encounters e "
        "join public.patients p on p.id = e.patient_id "
        "join public.departments d on d.id = e.department_id "
        "where e.status in ('registered', 'in_progress') and e.is_active = true "
        "and (e.created_at at time zone 'Asia/Seoul')::date = $1 "
        "order by e.consult_started_at asc nulls last, e.encounter_no asc "
        "limit $2 offset $3"
    )
    count_sql = (
        "select count(*) from public.encounters e "
        "where e.status in ('registered', 'in_progress') and e.is_active = true "
        "and (e.created_at at time zone 'Asia/Seoul')::date = $1"
    )
    offset = (page - 1) * page_size

    async def _op(conn: asyncpg.Connection) -> tuple[list[asyncpg.Record], int]:
        rows = await conn.fetch(list_sql, on_date, page_size, offset)
        total = int(await conn.fetchval(count_sql, on_date) or 0)
        return rows, total

    return await _run_authed(sub, _op)
