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
from datetime import date, datetime
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

    PT409/PT404 = 0010 커스텀(코어 미사용 클래스 'PT' → 충돌 없음), 42501 = insufficient_privilege
    (RPC has_permission 게이트 거부). 미매핑 SQLSTATE 는 None → 호출부가 일시 장애(503)로 폴백
    (_DB_OUTAGE_ERRORS posture 유지). 4.4·Epic 6/7 이 동일 매핑 재사용(공유 인프라).
    """
    match getattr(exc, "sqlstate", None):
        case "PT409":  # 잘못된 상태 전이(역행·건너뛰기·종결 재전이·비정상 초기상태·소스상태 불일치)
            return ConflictError(code="invalid_transition")  # 409 "잘못된 상태 전이입니다."
        case "PT404":  # 대상 내원 없음(RPC for-update not found)
            return NotFoundError("내원을 찾을 수 없습니다.")
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
    "completed_at, cancelled_at, no_show_at, created_by, is_active, created_at, updated_at"
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
