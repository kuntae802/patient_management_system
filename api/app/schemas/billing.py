"""수납(billing) 스키마(Pydantic) — web 타입의 거울. 전 필드 snake_case(camelCase 변환 금지).

수납 건(payments 헤더 + payment_details 라인)은 진찰·오더에서 자동발생한 수가(fee_items)를 집계한
결과다(Story 7.2). 헤더 금액은 build_payment 가 채운다(total/covered/non_covered=7.2 ·
copay/insurer=7.3 · 결제=7.4). 라인은 집계 시점 스냅샷(code·name·금액·coverage). 금액=KRW 정수.

워크리스트(정산 대상 진입점)는 BillingWorklistItem(내원 + denormalized 표시 + 예상 총액)을
{data, meta} 페이지로 반환한다(EncounterPage 미러).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


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
    insurance_type: str  # 환자 보험유형(본인부담 산정 근거 표시·7.3·비-PII 분류 enum)
    patient_name: str  # 신원 재진술 confirm·상시 배너 표시(7.4·워크리스트 노출 posture 계승·비-RRN)
    chart_no: str  # 차트번호(불투명 식별자 — 신원 재진술용)
    pending_orders_count: int = 0  # 미수행(ordered) 검사·처치 수 — 부분수행 가시성(7.10·청구 제외)
    total_amount_krw: int
    covered_amount_krw: int
    non_covered_amount_krw: int
    copay_amount_krw: int
    insurer_amount_krw: int
    paid_amount_krw: int
    refunded_amount_krw: int = 0  # 선납 환급액(취소·노쇼 7.9·순납부=paid-refunded)
    payment_method: str | None = None
    payment_no: str | None = None
    finalized_at: datetime | None = None
    finalized_by: UUID | None = None
    cancelled_at: datetime | None = None
    cancel_reason: str | None = None
    created_at: datetime
    updated_at: datetime
    details: list[PaymentDetailItem]


class PaymentFinalizeRequest(BaseModel):
    """수납 finalize 요청(Story 7.4) — 결제 수단만(전액 정산·금액 입력 없음·설계 결정 ③).

    payment_method = 카드/현금/계좌이체(Literal 1차 검증 422·DB 컬럼 CHECK 최종선). 결제 금액은
    본인부담금(copay_amount_krw) 전액 자동(paid_amount_krw) — 선/부분수납은 7.8 소관.
    """

    payment_method: Literal["card", "cash", "transfer"]


class PaymentPrepayRequest(BaseModel):
    """선결제(선수납) 요청(Story 7.8) — 선결제 금액 + 결제 수단.

    후수납(기본)과 달리 진료 전(registered)·진료 중(in_progress)에 본인부담 추정액을 미리 받는다.
    amount_krw = 선결제액(KRW 정수·gt=0 1차 검증 422·DB 최종선). 누적은 단일 누계 paid_amount_krw
    (별도 행 아님·7.1 의도). 진료 후 차액(copay-paid)은 finalize 가 정산. billing_type→prepaid 전환.
    """

    # 선결제액(>0·상한 1억원). 상한 = int4 overflow(paid 누적) + fat-finger 방어 → 초과 시
    #   클린 422(미상한 시 거대 금액 DB int4 초과 → 22003 unmapped → 503). 10원 단위 강제 미적용.
    amount_krw: int = Field(gt=0, le=100_000_000)
    payment_method: Literal["card", "cash", "transfer"]


class PaymentCancelRequest(BaseModel):
    """내원 취소·정산 요청(Story 7.9·FR-118) — 취소 사유만(선택).

    취소·노쇼 = 수가 미발생(구조적·진찰 전) + draft 수납 void + 선납 전액 환급
    (refunded_amount_krw = paid_amount_krw·환급수단=원 선결제수단). settle_cancelled_visit RPC 가
    cancel_encounter + void + refund 를 한 트랜잭션 처리. reason = 저민감 운영 사유(임상/PII 자유
    텍스트 금지·encounters.cancel_reason 정합·nullable). 신원 confirm 은 웹(클라 가드).
    """

    reason: str | None = Field(default=None, max_length=200)


class ReceiptClinic(BaseModel):
    """영수증 헤더의 요양기관 정보(0049 clinic_profile 거울 — 비민감 공개 병원 정보)."""

    model_config = ConfigDict(from_attributes=True)

    name: str
    biz_no: str
    hira_no: str
    address: str
    ceo_name: str
    phone: str


class ReceiptPatient(BaseModel):
    """영수증의 환자 정보 — 주민번호는 masked 만(설계 결정 ④·full reveal 이월·PII 경계)."""

    model_config = ConfigDict(from_attributes=True)

    name: str
    chart_no: str
    resident_no_masked: str  # 710314-2****** — masked only(full RRN 미렌더)
    insurance_type: str  # 환자구분 표시 근거(비-PII enum·insuranceLabel 한글화는 web)


class ReceiptEncounter(BaseModel):
    """영수증의 진료 정보 — 진료과·담당의·진료기간(KST date)."""

    model_config = ConfigDict(from_attributes=True)

    department_name: str
    doctor_name: str | None = None  # 담당의(start_consult 세팅·미배정 시 None)
    treatment_started_on: date
    treatment_ended_on: date


class ReceiptResponse(BaseModel):
    """진료비 계산서·영수증 문서 데이터(Story 7.5·FR-113) — 한 번에 조립한 법정 서식 소스.

    finalized 수납 건에 대해 요양기관·환자(masked RRN)·진료(진료과/담당의/진료기간)·결제·발급 정보 +
    상세 라인(항목별 금액표는 web 이 category 집계)을 묶는다. 금액=KRW 정수. 본문 외 PII 미유입.
    """

    model_config = ConfigDict(from_attributes=True)

    clinic: ReceiptClinic
    patient: ReceiptPatient
    encounter: ReceiptEncounter
    status: str  # finalized(영수증) — 비-finalized 는 엔드포인트가 409 차단
    payment_no: str | None = None
    payment_method: str | None = None
    finalized_at: datetime | None = None
    issued_by_name: str | None = None  # 발급담당(payments.finalized_by → users.name)
    total_amount_krw: int
    covered_amount_krw: int
    non_covered_amount_krw: int
    copay_amount_krw: int  # 본인부담 총액(납부할 금액 — 3행 합계)
    insurer_amount_krw: int
    paid_amount_krw: int  # 기납부액(3행 합계)
    due_amount_krw: int  # 납부할 금액 = copay - paid(3행 합계·표시값)
    details: list[PaymentDetailItem]


class DocumentExportRequest(BaseModel):
    """문서 내보내기 감사 요청(Story 7.5/7.6) — document_type 만.

    receipt=진료비 계산서·영수증·statement=세부산정내역서. 기본값 receipt(7.5 호환), 7.6 에서
    statement 추가. log_payment_document_export(0049·제네릭 text 파라미터)가 동일 RPC 로 수용(DDL
    변경 0) — document_type 은 audit_logs.after_data 로 구분 기록.
    """

    document_type: Literal["receipt", "statement"] = "receipt"


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
