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
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
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


async def create_pool() -> asyncpg.Pool:
    """앱 시작 시 풀 생성(fail-fast — DB 도달 불가 시 부팅 실패)."""
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=settings.supabase_db_url,
            min_size=1,
            max_size=10,
            command_timeout=30,
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
    except _DB_OUTAGE_ERRORS as exc:  # 연결 끊김·풀 고갈·타임아웃
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


async def update_employment_status(
    sub: UUID, *, user_id: UUID, status: str
) -> asyncpg.Record:
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
