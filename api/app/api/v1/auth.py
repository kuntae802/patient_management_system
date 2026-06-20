"""인증·권한 증명 라우터 — JWKS 검증과 RBAC 의존성을 실제 엔드포인트로 노출.

실제 도메인 명령(patients·encounters…)은 Epic 3+ 가 등록한다. 여기서는 1.5 의 인증/권한
토대가 동작함을 증명하는 최소 엔드포인트만 둔다(OpenAPI·통합 테스트 표면).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core import db
from app.core.security import (
    STAFF_ROLES,
    CurrentUser,
    get_current_user,
    require_permission,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# 권한 의존성은 모듈 로드 시 1회 생성(요청마다 팩토리 호출 회피).
require_rbac_manage = require_permission("rbac.manage")


class MeResponse(BaseModel):
    """현재 토큰 주체의 신원(snake_case). 환자/타인 PII 는 담지 않는다(본인 직원 프로필만)."""

    sub: UUID
    role: str | None
    is_staff: bool
    employee_no: str | None = None
    name: str | None = None


class PermissionCheckResponse(BaseModel):
    permission: str
    allowed: bool


@router.get("/me", response_model=MeResponse)
async def read_me(user: CurrentUser = Depends(get_current_user)) -> MeResponse:
    """검증된 토큰으로 현재 신원을 반환(인증 필요). 토큰 부재/무효 → 401."""
    identity = await db.fetch_staff_identity(user.sub)
    role = identity["role"]
    return MeResponse(
        sub=user.sub,
        role=role,
        is_staff=role in STAFF_ROLES,
        employee_no=identity["employee_no"],
        name=identity["name"],
    )


@router.get("/check", response_model=PermissionCheckResponse)
async def permission_check(
    _: CurrentUser = Depends(require_rbac_manage),
) -> PermissionCheckResponse:
    """require_permission 강제 시연 — `rbac.manage` 보유자(admin)만 통과, 그 외 403."""
    return PermissionCheckResponse(permission="rbac.manage", allowed=True)
