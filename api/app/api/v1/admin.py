"""관리자 RBAC 명령 라우터 — 역할별 권한 grant/revoke(권한 매트릭스 체크박스 토글, FR-211).

web→FastAPI 최초의 인증 쓰기 표면. 쓰기 권위(FastAPI/service_role): authenticated 는 신원/RBAC
테이블에 SELECT 만 가지므로(0002) 토글은 반드시 이 경로로만 수행된다. 매트릭스 *읽기*는 web 이
Supabase 직접 조회(authenticated SELECT, 0003)로 처리한다.

게이트: require_permission('rbac.manage') → 403. 실제 쓰기는 db.set_role_permission 이 권한 재평가와
role_permissions INSERT/DELETE 를 동일 트랜잭션에서 수행(TOCTOU 차단)하고, 0004 감사 트리거가 변경을
자동 기록(actor = 호출 관리자). admin 역할 대상은 409(자가-락아웃 방지).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from app.core import db
from app.core.security import CurrentUser, require_permission
from app.schemas.users import EmploymentStatusUpdate, StaffCreate, StaffResponse
from app.services import users as users_service

router = APIRouter(prefix="/admin", tags=["admin"])

# 권한 의존성은 모듈 로드 시 1회 생성(요청마다 팩토리 호출 회피).
require_rbac_manage = require_permission("rbac.manage")
require_user_manage = require_permission("user.manage")


class GrantUpdate(BaseModel):
    """역할↔권한 토글 요청(snake_case). granted=true → grant, false → revoke."""

    role_code: str
    permission_code: str
    granted: bool


class GrantResult(BaseModel):
    """토글 결과. changed = 실제 INSERT/DELETE 발생 여부(멱등 재요청 시 false)."""

    role_code: str
    permission_code: str
    granted: bool
    changed: bool


@router.put("/rbac/grants", response_model=GrantResult)
async def set_rbac_grant(
    payload: GrantUpdate,
    user: CurrentUser = Depends(require_rbac_manage),
) -> GrantResult:
    """역할에 권한을 grant(granted=true)/revoke(false) 한다.

    admin 역할 대상 → 409(role_locked). 미존재 role/permission 코드 → 404. 변경은 자동 감사된다.
    """
    changed = await db.set_role_permission(
        user.sub,
        payload.role_code,
        payload.permission_code,
        granted=payload.granted,
    )
    return GrantResult(
        role_code=payload.role_code,
        permission_code=payload.permission_code,
        granted=payload.granted,
        changed=changed,
    )


# ── 직원 계정 · 재직상태 관리 (Story 1.8, FR-214·215) ─────────────────────────────
# 쓰기 권위(FastAPI/service_role): 0002 가 authenticated 에 users SELECT 만 grant + users
# 본인행 RLS(0003) → 관리자 전직원 조회·생성·상태변경은 모두 이 경로로만 가능. 게이트는
# require_permission('user.manage'). 생성은 Supabase Auth(supabase-py) + DB 2단계 오케스트레이션
# (services.users), 상태변경은 DB UPDATE(접근 권위) + GoTrue ban(로그인 차단).


@router.get("/users", response_model=list[StaffResponse])
async def list_users(
    user: CurrentUser = Depends(require_user_manage),
) -> list[StaffResponse]:
    """전 직원 목록(사번 순). 관리 조회 — RLS 우회 service_role 경유."""
    return await users_service.list_staff(user.sub)


@router.post("/users", response_model=StaffResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: StaffCreate,
    user: CurrentUser = Depends(require_user_manage),
) -> StaffResponse:
    """직원 계정 생성 — Auth 사용자 + users 프로필. 사번/이메일 중복 → 409, 비-직원 역할 → 422."""
    return await users_service.create_staff(user.sub, payload)


@router.patch("/users/{user_id}/employment-status", response_model=StaffResponse)
async def update_user_employment_status(
    user_id: UUID,
    payload: EmploymentStatusUpdate,
    user: CurrentUser = Depends(require_user_manage),
) -> StaffResponse:
    """재직상태 변경 — 휴직/퇴사=접근·로그인 차단, 재직=복원. 자가-락아웃 → 409, 미존재 → 404."""
    return await users_service.change_employment_status(user.sub, user_id, payload)
