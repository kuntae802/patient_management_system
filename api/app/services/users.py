"""직원 계정 프로비저닝·재직상태 오케스트레이션(services 계층 첫 사용).

아키텍처의 `api/v1`(transport) → `services`(도메인 오케스트레이션) → `db`(영속) 3계층 중
오케스트레이션 레이어. 단일 DML(1.7)과 달리 **두 시스템(Supabase Auth ↔ Postgres)에 걸친
다단계 명령**이라 여기서 순서·보상·enforcement 를 조립한다. 불변식·감사는 DB 가 소유.
"""

from __future__ import annotations

import logging
from uuid import UUID

import asyncpg

from app.core import db, supabase_admin
from app.core.errors import AppError
from app.core.security import STAFF_ROLES
from app.schemas.users import EmploymentStatusUpdate, StaffCreate, StaffResponse

logger = logging.getLogger("app.services.users")


def _to_response(row: asyncpg.Record) -> StaffResponse:
    """DB Record(RETURNING/SELECT 공용 셰이프) → 응답 모델. email/비밀번호는 애초에 없다."""
    return StaffResponse.model_validate(dict(row))


async def create_staff(sub: UUID, payload: StaffCreate) -> StaffResponse:
    """직원 생성 — Auth 사용자(HTTP) → 프로필 INSERT(DB·자동감사), 실패 시 보상으로 고아 방지.

    두 단계는 한 트랜잭션이 아니다(서로 다른 시스템). 순서가 강제됨: users.id 가 auth.users.id 를
    FK 참조하므로 Auth 먼저 → uid → INSERT. INSERT 실패(중복 사번/권한 변동 등) 시 방금 만든 Auth
    사용자를 삭제(보상)해 고아 계정을 막는다(users 부분행은 FK CASCADE 로 함께 정리).
    """
    # 사전검증(Auth 생성 전): 직원 5역할만 허용. patient·미지 역할 → Auth 미생성 + 즉시 422.
    if payload.role_code not in STAFF_ROLES:
        raise AppError(
            "직원 계정으로 만들 수 없는 역할입니다.",
            code="invalid_target",
            status_code=422,
            detail={"role_code": payload.role_code},
        )
    uid = await supabase_admin.admin_create_user(payload.email, payload.password)
    try:
        row = await db.insert_staff_profile(
            sub,
            uid=uid,
            employee_no=payload.employee_no,
            name=payload.name,
            role_code=payload.role_code,
            license_no=payload.license_no,
            license_type=payload.license_type,
            phone=payload.phone,
            hire_date=payload.hire_date,
            department_id=payload.department_id,
        )
    except Exception:  # noqa: BLE001 — 어떤 실패든 보상 후 원 오류를 그대로 전파
        await supabase_admin.admin_delete_user(uid)
        raise
    return _to_response(row)


async def change_employment_status(
    sub: UUID, user_id: UUID, payload: EmploymentStatusUpdate
) -> StaffResponse:
    """재직상태 전환 — DB(접근 권위·감사) 먼저, GoTrue ban(로그인·세션) 보강.

    DB-우선 = 차단 방향 fail-safe: ban 전에 죽어도 DB 헬퍼가 이미 접근을 차단/복원한다. ban 실패는
    소프트 처리(접근 권위는 DB) + 로깅, 멱등 재시도 가능.
    """
    row = await db.update_employment_status(
        sub, user_id=user_id, status=payload.employment_status
    )
    try:
        await supabase_admin.admin_set_ban(
            user_id, banned=(payload.employment_status != "active")
        )
    except Exception as exc:  # noqa: BLE001 — ban 동기화 실패는 접근 차단을 막지 않는다
        logger.warning(
            "GoTrue ban 동기화 실패(접근은 DB 가 차단/복원, 재시도 가능): user=%s %s",
            user_id,
            type(exc).__name__,
        )
    return _to_response(row)


async def list_staff(sub: UUID) -> list[StaffResponse]:
    """전 직원 목록(관리 조회 — RLS 우회 service_role 경유)."""
    rows = await db.fetch_staff_list(sub)
    return [_to_response(row) for row in rows]
