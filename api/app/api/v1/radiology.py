"""방사선(radiology) 라우터 — 촬영 워크리스트·장비·영상 업로드/조회·촬영 수행(Story 5.8).

FR-100(워크리스트)·FR-101(촬영 수행·영상 업로드)·FR-103(장비 목록).

⚠️ prefix 없음 — 워크리스트는 /radiology/*, 검사 액션은 /examinations/{id}/*(신규 최상위).
/encounters/* 밑에 두지 않는다(GET /encounters/{id} UUID 라우트 흡수 → 422, 5.6/5.7 교훈).

게이트(쓰기 권위 FastAPI/service_role):
  · 워크리스트·업로드·수행 = examination.perform(방사선사)
  · 영상 조회·장비 조회 = order.read — 의사 판독(5.9, perform 미보유)이 영상 조회를 재사용.
실제 쓰기는 db 가 동일 txn 권한 재평가 + 0015 전이 트리거·감사가 불변식 강제.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, UploadFile, status

from app.core.security import CurrentUser, require_permission
from app.schemas.orders import ExaminationResponse
from app.schemas.radiology import (
    CompleteExaminationBody,
    EquipmentResponse,
    ExaminationImageResponse,
    PerformExaminationBody,
    RadiologyWorklistItem,
    ReadingWorklistItem,
)
from app.services import radiology as radiology_service

# prefix 없음 — 라우트별 전체 경로 명시(/radiology/* · /equipment · /examinations/*).
router = APIRouter(tags=["radiology"])

# 권한 의존성은 모듈 로드 시 1회 생성(orders.py 선례).
# perform = examination.perform(방사선/간호) · read = order.read(의사·간호·방사선) · complete =
# examination.complete(의사 판독의 겸임). 모두 0015.
require_examination_perform = require_permission("examination.perform")
require_order_read = require_permission("order.read")
require_examination_complete = require_permission("examination.complete")


@router.get("/radiology/worklist", response_model=list[RadiologyWorklistItem])
async def list_radiology_worklist(
    user: CurrentUser = Depends(require_examination_perform),
) -> list[RadiologyWorklistItem]:
    """촬영 워크리스트(FR-100) — 오늘(KST) 미수행 영상검사(imaging·ordered).

    게이트 examination.perform. /radiology/* 네임스페이스. 직접 배열. FIFO(지시 오래된 순).
    """
    return await radiology_service.list_radiology_worklist(user.sub)


@router.get("/equipment", response_model=list[EquipmentResponse])
async def list_equipment(
    user: CurrentUser = Depends(require_order_read),
) -> list[EquipmentResponse]:
    """장비 목록·상태(FR-103) — 활성 장비(코드순). 게이트 order.read. 읽기 전용·촬영 배정 참조."""
    return await radiology_service.list_equipment(user.sub)


@router.post(
    "/examinations/{examination_id}/images",
    response_model=ExaminationImageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_examination_image(
    examination_id: UUID,
    file: UploadFile,
    user: CurrentUser = Depends(require_examination_perform),
) -> ExaminationImageResponse:
    """촬영 영상 업로드(FR-101) — 비공개 버킷 저장 + DB 경로 연결. 게이트 examination.perform.

    잘못된 형식/용량 422, lab 오더 422, 이미 수행된 검사 409, 미존재 404. 응답 = 메타 + 서명 URL.
    """
    return await radiology_service.upload_examination_image(user.sub, examination_id, file)


@router.get(
    "/examinations/{examination_id}/images",
    response_model=list[ExaminationImageResponse],
)
async def list_examination_images(
    examination_id: UUID,
    user: CurrentUser = Depends(require_order_read),
) -> list[ExaminationImageResponse]:
    """한 검사의 촬영 영상 목록 + 서명 URL(FR-101). 게이트 order.read(5.9 판독의 재사용).

    직접 배열. 서명 URL 은 조회 시점 재생성(DB 경로만 저장).
    """
    return await radiology_service.list_examination_images(user.sub, examination_id)


@router.post(
    "/examinations/{examination_id}/perform",
    response_model=ExaminationResponse,
)
async def perform_examination(
    examination_id: UUID,
    payload: PerformExaminationBody,
    user: CurrentUser = Depends(require_examination_perform),
) -> ExaminationResponse:
    """촬영 수행(FR-101·FR-093) — ordered→performed. 게이트 examination.perform(방사선사).

    영상 ≥1 필수(없으면 422 image_required), 재수행 → 409 invalid_transition, 미존재 404,
    잘못된 장비 422. equipment_id(선택) 배정. 응답 = 갱신된 검사 오더.
    """
    return await radiology_service.perform_examination(user.sub, examination_id, payload)


@router.get("/radiology/reading-worklist", response_model=list[ReadingWorklistItem])
async def list_reading_worklist(
    user: CurrentUser = Depends(require_examination_complete),
) -> list[ReadingWorklistItem]:
    """판독 워크리스트(FR-102) — 오늘(KST) 촬영 수행됐으나 미판독 영상검사(imaging·performed).

    게이트 examination.complete(의사 판독의 겸임). /radiology/* 네임스페이스. FIFO(수행 오래된 순).
    """
    return await radiology_service.list_reading_worklist(user.sub)


@router.post(
    "/examinations/{examination_id}/complete",
    response_model=ExaminationResponse,
)
async def complete_examination(
    examination_id: UUID,
    payload: CompleteExaminationBody,
    user: CurrentUser = Depends(require_examination_complete),
) -> ExaminationResponse:
    """판독 완료(FR-102·FR-093) — performed→completed. 게이트 examination.complete(판독의 겸임).

    소견 기록 → 오더 완료. 빈 소견 422 findings_required, 미수행/재완료 409 invalid_transition,
    lab 422 not_imaging, 미존재 404. 응답 = 완료된 검사 오더(소견·완료자 포함).
    """
    return await radiology_service.complete_examination(user.sub, examination_id, payload)
