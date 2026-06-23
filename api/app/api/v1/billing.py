"""수납(billing) 라우터 — 집계 빌드·조회·워크리스트·결제(finalize)·문서 출력. Story 7.2/7.4/7.5.

쓰기 권위(FastAPI/service_role): 집계 빌드(build_payment)·finalize(finalize_payment)는 이 경로
(authenticated 직접 쓰기 정책 없음, 0045). 둘 다 액션 엔드포인트(POST .../payment 멱등 빌드 ·
POST .../payment/finalize 결제·완료). 게이트 = payment.manage → 403. 집계·산정·결제·완료 전이는
DB 함수가 원자 소유(NFR-041·"수가/정산 로직=DB"). 조회·워크리스트·문서는 payment.read. finalize 는
build→price→finalize→complete_encounter 를 한 트랜잭션으로 호출.

문서 출력(7.5): GET .../payment/receipt(finalized 영수증 데이터) + POST .../payment/receipt/export
('read' 감사·UX-DR22). 세부산정내역서=7.6·원외처방전=7.7. 인쇄/PDF=브라우저(web).
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.core.security import CurrentUser, require_permission
from app.schemas.billing import (
    BillingWorklistPage,
    DocumentExportRequest,
    PaymentFinalizeRequest,
    PaymentResponse,
    ReceiptResponse,
)
from app.services import billing as billing_service

router = APIRouter(tags=["billing"])

# 권한 의존성은 모듈 로드 시 1회 생성(요청마다 팩토리 호출 회피, encounters.py 선례).
# 쓰기(집계 빌드/finalize)=payment.manage(0046 신규·reception)·조회=payment.read(0045·doctor·원무).
require_payment_manage = require_permission("payment.manage")
require_payment_read = require_permission("payment.read")


@router.get("/billing/worklist", response_model=BillingWorklistPage)
async def list_billing_worklist(
    on_date: date | None = Query(default=None, alias="date"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=200, ge=1, le=500),
    user: CurrentUser = Depends(require_payment_read),
) -> BillingWorklistPage:
    """수납 워크리스트(정산 대상 내원 — in_progress·일자별, FR-110). 게이트 payment.read.

    원무 병원 단위(진료과 무관). 일자 미지정 → KST 오늘(서비스 기본). 각 행 = 환자·차트번호·진료과·
    진찰시작·예상 총액(Σ fee_items 라이브). 상세 진입 시 build_payment 가 영속 집계."""
    return await billing_service.list_billing_worklist(
        user.sub, on_date=on_date, page=page, page_size=page_size
    )


@router.post("/encounters/{encounter_id}/payment", response_model=PaymentResponse)
async def build_payment(
    encounter_id: UUID,
    user: CurrentUser = Depends(require_payment_manage),
) -> PaymentResponse:
    """수납 건 집계 빌드(진입 시 자동 집계, 멱등 — FR-110·UX-DR14). 게이트 payment.manage.

    자동발생 수가(fee_items)를 draft 수납 건(헤더 + 라인)으로 영속 집계 후 반환. 액션 엔드포인트
    (status PATCH 아님). 재호출 = 신규 수가만 추가(멱등). 미존재 내원 → 404, 권한 미보유 → 403."""
    return await billing_service.build_payment(user.sub, encounter_id)


@router.get("/encounters/{encounter_id}/payment", response_model=PaymentResponse)
async def get_payment(
    encounter_id: UUID,
    user: CurrentUser = Depends(require_payment_read),
) -> PaymentResponse:
    """한 내원의 수납 건 조회(헤더 + 라인). 게이트 payment.read. 빌드 전(미집계) → 404."""
    return await billing_service.get_payment(user.sub, encounter_id)


@router.post("/encounters/{encounter_id}/payment/finalize", response_model=PaymentResponse)
async def finalize_payment(
    encounter_id: UUID,
    body: PaymentFinalizeRequest,
    user: CurrentUser = Depends(require_payment_manage),
) -> PaymentResponse:
    """수납 finalize(결제 기록 + 내원 완료 — FR-112·UX-DR21·NFR-041). 게이트 payment.manage.

    결제 수단(카드/현금/계좌이체)을 기록해 draft 수납을 finalized 로 전이하고, 같은 트랜잭션에서
    complete_encounter 로 내원 완료(in_progress→completed·build→price→finalize→complete 원자).
    액션 엔드포인트(status PATCH 아님). 주상병 미지정 → 422, 이미 결제/취소 또는 정산 대상 0 → 409,
    미존재 내원 → 404, 권한 미보유 → 403. 신원 재진술 confirm 은 웹(클라 가드)."""
    return await billing_service.finalize_payment(user.sub, encounter_id, body.payment_method)


@router.get("/encounters/{encounter_id}/payment/receipt", response_model=ReceiptResponse)
async def get_receipt(
    encounter_id: UUID,
    user: CurrentUser = Depends(require_payment_read),
) -> ReceiptResponse:
    """진료비 계산서·영수증 문서 데이터(Story 7.5·FR-113). 게이트 payment.read.

    정산 완료(finalized) 수납 건의 요양기관·환자(masked RRN)·진료(진료과/담당의/진료기간)·결제·발급
    정보 + 상세 라인을 조립해 반환(항목별 금액표 집계·Batang serif·인쇄는 web). 비-finalized → 409,
    미존재(빌드 전) → 404, 권한 미보유 → 403. 주민번호는 masked 만(full reveal 이월·PII 경계)."""
    return await billing_service.get_receipt(user.sub, encounter_id)


@router.post("/encounters/{encounter_id}/payment/receipt/export", status_code=204)
async def export_receipt(
    encounter_id: UUID,
    body: DocumentExportRequest,
    user: CurrentUser = Depends(require_payment_read),
) -> Response:
    """문서 인쇄/내보내기 = 'read' 감사 이벤트 기록(Story 7.5·UX-DR22). 게이트 payment.read.

    인쇄(Ctrl P)/PDF 저장 직전 web 이 호출 → log_payment_document_export 가 audit_logs 'read' 기록
    (document_type·우회 불가·DB 소유). 부수효과=감사 → POST(액션 엔드포인트·reveal POST 선례). 반환
    204. payment 미존재 → 404, 권한 미보유 → 403. 7.5=receipt, 세부산정내역서('statement')=7.6."""
    await billing_service.export_document(user.sub, encounter_id, body.document_type)
    return Response(status_code=204)
