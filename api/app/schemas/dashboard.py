"""운영 대시보드(dashboard) 응답 스키마 — 당일 스냅샷 + 일별 추세. Story 8.5 · FR-230.

집계는 FastAPI 가 담당(architecture L193·복잡 집계→FastAPI). 금액=KRW 정수(소수 없음), 비율=0~1
float(분모 0 → 0), 날짜=date(ISO 직렬화). 전 필드 snake_case(JSON 전 경로 일관 — TS 거울도 동일).
대시보드는 read-only(집계 수치만 — 환자명·차트번호 등 PII 미포함).
"""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel


class DashboardDailyPoint(BaseModel):
    """추세의 하루 점 — 일별 내원·순수납액·노쇼(count+rate). 정렬(오래된→최신)은 컨테이너가 보장."""

    date: date
    visits: int
    revenue_net_krw: int
    no_show_count: int
    no_show_rate: float


class DashboardTodaySnapshot(BaseModel):
    """당일 운영 KPI 스냅샷 — 내원·대기·진료중·완료·순수납액·노쇼율(+분자/분모).

    visits = 실내원(registered/in_progress/completed · registered_at 당일). waiting/in_progress =
    당일 코호트의 현재 상태. revenue_net_krw = Σ(paid − refunded · finalized 당일). no_show_rate =
    no_show_count / appointment_total(분모=슬롯 도래분, 0 → 0.0).
    """

    visits: int
    waiting: int
    in_progress: int
    completed: int
    revenue_net_krw: int
    no_show_count: int
    appointment_total: int
    no_show_rate: float


class DashboardOperationsResponse(BaseModel):
    """운영 대시보드 단일 리소스 응답(목록 아님 → {data,meta} 봉투 미사용)."""

    as_of_date: date
    today: DashboardTodaySnapshot
    daily_series: list[DashboardDailyPoint]
