"""오더(orders) 라우터 — 처방 발행·조회. Story 5.2 / FR-050·FR-051·FR-052.

처방은 내원 sub-resource(`/encounters/{id}/prescriptions`) — encounters 라우터의 medical-records/
diagnoses 경로 패턴 미러(세그먼트가 달라 충돌 없음). 별도 오더 도메인 라우터로 분리(router.py 가
선언한 orders 도메인)해 후속 검사·처치 오더(5.3/5.4)를 한 모듈에 앵커링한다.

쓰기 권위(FastAPI/service_role): 처방 발행 = 액션이 아닌 자유 CRUD(POST). 게이트 = prescription
.create(0002 기존, 의사) → 403. 조회 = order.read(0015, 의사·간호·방사선). 실제 쓰기는 db 가 권한을
동일 트랜잭션에서 재평가(TOCTOU) + 0015 전이 트리거(INSERT status='issued')·감사가 불변식 강제.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, status

from app.core.security import CurrentUser, require_permission
from app.schemas.orders import (
    ExaminationCreate,
    ExaminationResponse,
    PrescriptionCreate,
    PrescriptionResponse,
    TreatmentOrderCreate,
    TreatmentOrderResponse,
)
from app.services import orders as orders_service

router = APIRouter(prefix="/encounters", tags=["orders"])

# 권한 의존성은 모듈 로드 시 1회 생성(요청마다 팩토리 호출 회피, encounters.py 선례).
# 발행=prescription.create(0002 기존·의사 직무)·조회=order.read(0015·의사 5.1 기보유, 원무 제외).
# 검사·영상 오더=examination.order(0002 기존·의사 5.3 시드 grant).
# 처치 오더=treatment.order(0002 기존·의사 5.4 시드 grant).
require_prescription_create = require_permission("prescription.create")
require_examination_order = require_permission("examination.order")
require_treatment_order = require_permission("treatment.order")
require_order_read = require_permission("order.read")


@router.post(
    "/{encounter_id}/prescriptions",
    response_model=PrescriptionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_prescription(
    encounter_id: UUID,
    payload: PrescriptionCreate,
    user: CurrentUser = Depends(require_prescription_create),
) -> PrescriptionResponse:
    """처방전 발행(FR-050·FR-051). 게이트 prescription.create. ordered_by=발행 의사(sub).

    약품 마스터 검색(drug_id FK)으로만 — free-text 차단. 헤더 + 상세 라인 원자적 생성. 진단 근거
    연결 선택(같은 내원). 미존재 내원 → 404, 타 내원/잘못된 진단·약품 → 422, 권한 미보유 → 403.
    ⚠️ 동일 성분 중복 경고(FR-052)는 클라 측 비차단 인라인(하드 블록=알레르기 5.5)."""
    return await orders_service.create_prescription(user.sub, encounter_id, payload)


@router.get(
    "/{encounter_id}/prescriptions",
    response_model=list[PrescriptionResponse],
)
async def list_prescriptions(
    encounter_id: UUID,
    user: CurrentUser = Depends(require_order_read),
) -> list[PrescriptionResponse]:
    """한 내원의 발행 처방전 목록(헤더 최신순 + 상세 1:N, FR-050). 게이트 order.read.

    ★ 읽기 게이트 = order.read(의사·간호·방사선만 — 원무 미열람, 최소권한). 작은 sub-collection →
    직접 배열(medical-records GET 선례, {data,meta} 봉투 아님)."""
    return await orders_service.list_prescriptions(user.sub, encounter_id)


@router.post(
    "/{encounter_id}/examinations",
    response_model=ExaminationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_examination(
    encounter_id: UUID,
    payload: ExaminationCreate,
    user: CurrentUser = Depends(require_examination_order),
) -> ExaminationResponse:
    """검사·영상 오더 생성(FR-060·FR-061). 게이트 examination.order. ordered_by=지시 의사(sub).

    exam_type(lab/imaging)이 워크리스트 라우팅 분류 축(영상→방사선·검체→간호). 검사 행위=
    fee_schedule_id 마스터 FK(free-text 차단). status='ordered'(지시) DB 강제. 미존재 내원 → 404,
    잘못된 검사 행위 → 422, 권한 미보유 → 403. ⚠️ 수행/판독·장비 배정·워크리스트 = 5.7/5.8/5.9."""
    return await orders_service.create_examination(user.sub, encounter_id, payload)


@router.get(
    "/{encounter_id}/examinations",
    response_model=list[ExaminationResponse],
)
async def list_examinations(
    encounter_id: UUID,
    user: CurrentUser = Depends(require_order_read),
) -> list[ExaminationResponse]:
    """한 내원의 검사·영상 오더 목록(최신순 + fee 조인, FR-060). 게이트 order.read.

    직접 배열(prescriptions GET 선례, {data,meta} 봉투 아님)."""
    return await orders_service.list_examinations(user.sub, encounter_id)


@router.post(
    "/{encounter_id}/treatment-orders",
    response_model=TreatmentOrderResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_treatment_order(
    encounter_id: UUID,
    payload: TreatmentOrderCreate,
    user: CurrentUser = Depends(require_treatment_order),
) -> TreatmentOrderResponse:
    """처치 오더 생성(FR-070). 게이트 treatment.order. ordered_by=지시 의사(sub).

    처치 행위=fee_schedule_id 마스터 FK(free-text 차단). 간호 워크리스트로 전달(단일 라우팅 —
    검사의 exam_type 분기 없음). status='ordered'(지시) DB 강제. 미존재 내원 → 404, 잘못된 처치
    행위 → 422, 권한 미보유 → 403. ⚠️ 수행(perform)·재수행 차단·간호기록 = 5.7."""
    return await orders_service.create_treatment_order(user.sub, encounter_id, payload)


@router.get(
    "/{encounter_id}/treatment-orders",
    response_model=list[TreatmentOrderResponse],
)
async def list_treatment_orders(
    encounter_id: UUID,
    user: CurrentUser = Depends(require_order_read),
) -> list[TreatmentOrderResponse]:
    """한 내원의 처치 오더 목록(최신순 + fee 조인, FR-070). 게이트 order.read.

    직접 배열(prescriptions/examinations GET 선례, {data,meta} 봉투 아님)."""
    return await orders_service.list_treatment_orders(user.sub, encounter_id)
