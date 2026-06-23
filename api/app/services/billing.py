"""수납(billing) 오케스트레이션(services 계층) — 집계 빌드·조회 → 응답 매핑. Story 7.2.

집계 빌드(build_payment): fee_items → payment_details 적재 + 헤더 롤업은 DB 함수가 원자적으로 소유
(project-context "수가/정산 로직=DB"). 본 계층은 db 호출 + Pydantic 매핑만. 권한 재평가·내원 검증·
감사는 db/DB 가 동일 트랜잭션 소유. 에러(404·403)는 core/db 가 raise(AppError). finalize·결제는 7.4.
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from app.core import db
from app.schemas.billing import (
    BillingPageMeta,
    BillingWorklistItem,
    BillingWorklistPage,
    PaymentResponse,
    ReceiptResponse,
)

_KST = ZoneInfo("Asia/Seoul")  # 워크리스트 기본 일자 = KST 오늘(encounters_service 일관)


def _to_payment(row: dict[str, object]) -> PaymentResponse:
    """db 의 dict 트리({헤더..., "details":[라인 dict...]}) → PaymentResponse(중첩 검증)."""
    return PaymentResponse.model_validate(row)


async def build_payment(sub: UUID, encounter_id: UUID) -> PaymentResponse:
    """수납 건 집계 빌드(진입 시 자동 집계, 멱등) — 자동발생 수가를 draft 수납 건으로 집계(FR-110).

    미존재 내원 → 404, 권한(payment.manage) 미보유 → 403(db 가 동일 트랜잭션 검증·raise)."""
    row = await db.build_payment(sub, encounter_id)
    return _to_payment(row)


async def get_payment(sub: UUID, encounter_id: UUID) -> PaymentResponse:
    """한 내원의 수납 건 조회(헤더 + 라인). 빌드 전 → 404. 게이트=라우터(payment.read)."""
    row = await db.fetch_payment(sub, encounter_id)
    return _to_payment(row)


async def prepay_payment(
    sub: UUID, encounter_id: UUID, amount_krw: int, payment_method: str
) -> PaymentResponse:
    """선결제(선수납) — 선결제액 누적 + billing_type prepaid 전환(Story 7.8·FR-117).

    build→price→prepay 원자(NFR-041). 미존재 내원 → 404, 권한(payment.manage) 미보유 → 403, 이미
    finalized/cancelled 또는 금액≤0 → 409(db/DB 가 검증·raise). 진료 후 차액은 finalize."""
    row = await db.prepay_payment(sub, encounter_id, amount_krw, payment_method)
    return _to_payment(row)


async def settle_cancelled_visit(
    sub: UUID, encounter_id: UUID, reason: str | None
) -> PaymentResponse:
    """취소·노쇼 정산(수가 미발생·선납 환급) — Story 7.9·FR-118.

    build→settle 원자(NFR-041). 내원 취소(registered→cancelled) + draft 수납 void + 선납 전액 환급
    (refunded=paid). 미존재 → 404, 권한(payment.manage·encounter.cancel) 미보유 → 403,
    비-registered/scheduled·비-draft → 409(db/DB 가 검증·raise)."""
    row = await db.settle_cancelled_visit(sub, encounter_id, reason)
    return _to_payment(row)


async def finalize_payment(sub: UUID, encounter_id: UUID, payment_method: str) -> PaymentResponse:
    """수납 finalize(결제 기록 + 내원 완료) — build→price→finalize→complete 원자(FR-112·NFR-041).

    미존재 내원 → 404, 권한 미보유 → 403, 주상병 미지정 → 422, 이미 결제/취소(비-draft) 또는 정산
    대상 0 → 409(전부 db/DB 가 동일 트랜잭션 검증·raise). 결제 컬럼·내원 완료 반영 행 반환."""
    row = await db.finalize_payment(sub, encounter_id, payment_method)
    return _to_payment(row)


async def get_receipt(sub: UUID, encounter_id: UUID) -> ReceiptResponse:
    """진료비 계산서·영수증 문서 데이터(Story 7.5·FR-113). 게이트=라우터(payment.read).

    finalized 수납 건만 → 비-finalized 409, 미존재 404(db/DB 가 검증·raise). 요양기관·환자(masked
    RRN)·진료·결제·발급 + 상세 라인을 묶은 ReceiptResponse 반환(항목별 금액표 집계는 web)."""
    row = await db.fetch_receipt(sub, encounter_id)
    return ReceiptResponse.model_validate(row)


async def export_document(sub: UUID, encounter_id: UUID, document_type: str) -> None:
    """문서 인쇄/내보내기 = 감사 이벤트 기록(Story 7.5·UX-DR22). 게이트=라우터(payment.read).

    payment 미존재 → 404, 권한 미보유 → 403(db/RPC 가 검증·raise). 감사는 DB 가 소유(우회 불가)."""
    await db.log_document_export(sub, encounter_id, document_type)


async def list_billing_worklist(
    sub: UUID,
    *,
    on_date: date | None = None,
    page: int = 1,
    page_size: int = 200,
) -> BillingWorklistPage:
    """수납 워크리스트(정산 대상 내원 — in_progress·일자별) 목록. 게이트=라우터(payment.read).

    일자 미지정 시 오늘(KST) — encounters_service.list_encounters 동형."""
    target_date = on_date or datetime.now(_KST).date()
    rows, total = await db.fetch_billing_worklist(
        sub, on_date=target_date, page=page, page_size=page_size
    )
    return BillingWorklistPage(
        data=[BillingWorklistItem.model_validate(dict(r)) for r in rows],
        meta=BillingPageMeta(page=page, page_size=page_size, total=total),
    )
