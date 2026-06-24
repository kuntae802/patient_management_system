"""운영 대시보드(dashboard) 라우터 — 관리자 운영 통계 조회. Story 8.5 · FR-230.

GET /dashboard/operations: 당일 운영 KPI(내원·대기·진료중·완료·순수납액·노쇼율) + 최근 days 일 추세.
복잡 집계는 FastAPI(db 계층 SQL)가 담당(architecture L193). 게이트 = dashboard.read(0002 시드·admin)
— read-only(쓰기/상태전이 없음). 미인증 401 / 무권한 403. 일자 미지정 → 서비스가 KST 오늘로 결정
(클라 제공 일자 신뢰 안 함). 집계는 clinic-wide(service_role·RLS 우회·관리자 범위) · PII 미포함.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query

from app.core.security import CurrentUser, require_permission
from app.schemas.dashboard import DashboardOperationsResponse
from app.services import dashboard as dashboard_service

router = APIRouter(tags=["dashboard"])

# 권한 의존성은 모듈 로드 시 1회 생성(요청마다 팩토리 호출 회피, billing.py 선례). dashboard.read.
require_dashboard_read = require_permission("dashboard.read")


@router.get("/dashboard/operations", response_model=DashboardOperationsResponse)
async def get_operations(
    on_date: date | None = Query(default=None, alias="date"),
    days: int = Query(default=14, ge=1, le=90),
    user: CurrentUser = Depends(require_dashboard_read),
) -> DashboardOperationsResponse:
    """운영 대시보드 통계(FR-230). 게이트 dashboard.read.

    일자 미지정 → KST 오늘(서비스 기본). days = 추세 윈도우(1~90·기본 14). 당일 스냅샷 + 일별
    내원·순수납액·노쇼율 시리즈 반환. 권한 미보유 → 403, 미인증 → 401."""
    return await dashboard_service.get_operations(user.sub, on_date=on_date, days=days)
