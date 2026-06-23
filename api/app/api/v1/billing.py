"""수납(billing) 집계·조회 라우터 — 집계 빌드 + 조회 + 워크리스트. Story 7.2 / FR-110·UX-DR14.

쓰기 권위(FastAPI/service_role): 집계 빌드(build_payment)는 이 경로(authenticated 직접 쓰기 정책
없음, 0045). 집계는 **액션 엔드포인트**(POST .../payment — 멱등 빌드/리프레시). 게이트 =
require_permission('payment.manage') → 403. 실제 집계·롤업은 build_payment DB 함수가 원자적 소유
(NFR-041·project-context "수가 로직=DB"). 조회(GET)·워크리스트는 payment.read. finalize·결제는 7.4.
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.core.security import CurrentUser, require_permission
from app.schemas.billing import BillingWorklistPage, PaymentResponse
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
