"""수납(billing) 스키마(Pydantic) — web 타입의 거울. 전 필드 snake_case(camelCase 변환 금지).

수납 건(payments 헤더 + payment_details 라인)은 진찰·오더에서 자동발생한 수가(fee_items)를 집계한
결과다(Story 7.2). 헤더 금액은 build_payment 가 채운다(total/covered/non_covered=7.2 ·
copay/insurer=7.3 · 결제=7.4). 라인은 집계 시점 스냅샷(code·name·금액·coverage). 금액=KRW 정수.

워크리스트(정산 대상 진입점)는 BillingWorklistItem(내원 + denormalized 표시 + 예상 총액)을
{data, meta} 페이지로 반환한다(EncounterPage 미러).
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class PaymentDetailItem(BaseModel):
    """수납상세 라인(0045 payment_details). 집계 시점 스냅샷 + 본인부담 컬럼(7.3 채움).

    fee_item_id 보유 = 자동발생 집계 라인("자동" 마커 근거). nullable = 수기 라인(7.x).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    payment_id: UUID
    fee_item_id: UUID | None = None  # 집계원(자동 라인) — null=수기 라인(7.x)
    fee_schedule_id: UUID | None = None
    code: str | None = None  # EDI 코드(스냅샷)
    name: str | None = None  # 행위명(스냅샷·비-PII)
    category: str | None = None  # 분류(진찰료/검사료/…)
    quantity: int
    unit_amount_krw: int
    amount_krw: int
    coverage_type: str  # covered / non_covered
    # 본인부담 산정(7.3 이 채움 — 7.2 단계는 0/None).
    copay_rate: float | None = None
    copay_amount_krw: int = 0
    insurer_amount_krw: int = 0
    created_at: datetime
    updated_at: datetime


class PaymentResponse(BaseModel):
    """수납 건 응답(0045 payments 헤더 전 컬럼 + 상세 라인). snake_case 유지.

    금액 컬럼: total/covered/non_covered 는 7.2 집계가 채움(라인 합 롤업). copay/insurer/paid·결제
    컬럼은 7.3/7.4/7.8 소관(7.2=0/None). status draft=집계중·finalized=결제완료(7.4)·cancelled.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    encounter_id: UUID
    status: str
    billing_type: str
    total_amount_krw: int
    covered_amount_krw: int
    non_covered_amount_krw: int
    copay_amount_krw: int
    insurer_amount_krw: int
    paid_amount_krw: int
    payment_method: str | None = None
    payment_no: str | None = None
    finalized_at: datetime | None = None
    finalized_by: UUID | None = None
    cancelled_at: datetime | None = None
    cancel_reason: str | None = None
    created_at: datetime
    updated_at: datetime
    details: list[PaymentDetailItem]


class BillingWorklistItem(BaseModel):
    """수납 워크리스트 행(Story 7.2) — 정산 대상 내원 + denormalized 표시 + 예상 총액.

    estimated_total_krw = Σ fee_items.amount_krw(라이브 프리뷰 — 미영속, 상세 진입 시 build_payment
    가 영속 집계). 표시 필드(patient_name·chart_no·department_name)는 행 렌더용 조인. raw PII 없음.
    """

    model_config = ConfigDict(from_attributes=True)

    encounter_id: UUID
    encounter_no: str
    patient_name: str
    chart_no: str
    department_name: str
    status: str
    consult_started_at: datetime | None = None
    estimated_total_krw: int


class BillingPageMeta(BaseModel):
    """페이지 메타(목록 표준 봉투 {data, meta} — EncounterPageMeta 미러)."""

    page: int
    page_size: int
    total: int


class BillingWorklistPage(BaseModel):
    """수납 워크리스트 목록 응답 — 정산 대상 행 + 메타."""

    data: list[BillingWorklistItem]
    meta: BillingPageMeta
