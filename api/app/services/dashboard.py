"""운영 대시보드(dashboard) 오케스트레이션(services 계층) — 집계 호출 → 응답 매핑. Story 8.5.

복잡 집계(다중 테이블·KST 일자 그룹·파생 비율)는 db 계층 SQL 이 소유(architecture L193). 본 계층은
db 호출 + Pydantic 매핑 + 일자 기본값(KST 오늘) 결정만. 게이트=라우터(dashboard.read·read-only).
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from app.core import db
from app.schemas.dashboard import DashboardOperationsResponse

_KST = ZoneInfo("Asia/Seoul")  # 일자 기본값 = KST 오늘(billing_service 일관)


async def get_operations(
    sub: UUID, *, on_date: date | None = None, days: int = 14
) -> DashboardOperationsResponse:
    """운영 대시보드 집계(당일 스냅샷 + 최근 days 일 추세). 게이트=라우터(dashboard.read).

    on_date 미지정 → KST 오늘(클라 제공 일자 신뢰 안 함). 빈 데이터 = 전부 0(안전).
    days 는 1~90 으로 정규화(라우터 Query 가드의 방어심층 — 라우터 외 직접 호출 시에도 빈/역방향
    윈도우를 막는다).
    """
    target = on_date if on_date is not None else datetime.now(_KST).date()
    days = max(1, min(days, 90))
    payload = await db.fetch_dashboard_operations(sub, on_date=target, days=days)
    return DashboardOperationsResponse.model_validate(payload)
