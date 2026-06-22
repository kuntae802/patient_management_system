"""간호(nursing) 라우터 — 활력징후 기록·조회·워크리스트. Story 5.6 / FR-091·FR-032.

활력 기록·조회는 내원 sub-resource(`/encounters/{id}/vitals`, orders 경로 미러)지만 워크리스트는
간호 도메인 컬렉션(`/nursing/vitals-worklist`)으로 분리. ⚠️ encounters.py 에 `GET /encounters/
{encounter_id}` 단건 라우트가 존재(encounters.py:125·먼저 등록)하므로 `/encounters/vitals-worklist`
는 그 param 라우트에 흡수되어 422(uuid_parsing) — 워크리스트를 `/encounters/*` 밖(`/nursing/*`)에
둔다. prefix 없이 라우트별 전체 경로 명시(혼합 네임스페이스). 처치 수행·간호기록(5.7)도 한 모듈에.

쓰기 권위(FastAPI/service_role): 활력 기록 = 액션이 아닌 자유 CRUD(POST). 게이트 = vital.record(0002
기존, 간호) → 403. 조회 = encounter.read(의사 허브) ∨ vital.record(간호 read-back). 워크리스트 =
vital.record(간호 진입). 실제 쓰기는 db 가 권한을 동일 txn 에서 재평가(TOCTOU) + 0017 CHECK·감사가
불변식 강제.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, status

from app.core.security import CurrentUser, require_any_permission, require_permission
from app.schemas.nursing import (
    NursingRecordCreate,
    NursingRecordResponse,
    NursingWorklistItem,
    TreatmentPerformBody,
    VitalSignsCreate,
    VitalSignsResponse,
    VitalsWorklistItem,
)
from app.schemas.orders import TreatmentOrderResponse
from app.services import nursing as nursing_service

# prefix 없음 — 기록·조회는 /encounters/*, 워크리스트는 /nursing/*(헤더 ⚠️ 라우트 충돌 회피).
router = APIRouter(tags=["nursing"])

# 권한 의존성은 모듈 로드 시 1회 생성(요청마다 팩토리 호출 회피, orders.py 선례).
# 기록=vital.record(0002·간호, 5.6 nurse grant)·조회=encounter.read(의사) ∨ vital.record(간호).
require_vital_record = require_permission("vital.record")
require_vital_read = require_any_permission("encounter.read", "vital.record")
# 처치 수행=treatment.perform(0002·간호, 5.1)·일상 간호기록=nursing.record(0018 신규·간호, 5.7).
# 간호기록 조회=order.read ∨ nursing.record · 워크리스트=treatment.perform ∨ nursing.record.
require_treatment_perform = require_permission("treatment.perform")
require_nursing_record = require_permission("nursing.record")
require_nursing_read = require_any_permission("order.read", "nursing.record")
require_nursing_worklist = require_any_permission("treatment.perform", "nursing.record")


@router.get(
    "/nursing/vitals-worklist",
    response_model=list[VitalsWorklistItem],
)
async def list_vitals_worklist(
    user: CurrentUser = Depends(require_vital_record),
) -> list[VitalsWorklistItem]:
    """활력 워크리스트 — 오늘(KST) 활성 내원(registered·in_progress) + 최근 활력 시각(AC3).

    게이트 vital.record(간호 진입). 직접 배열(`{data,meta}` 봉투 아님 — 한 클리닉 당일 목록은 적음).
    """
    return await nursing_service.list_vitals_worklist(user.sub)


@router.post(
    "/encounters/{encounter_id}/vitals",
    response_model=VitalSignsResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_vital_signs(
    encounter_id: UUID,
    payload: VitalSignsCreate,
    user: CurrentUser = Depends(require_vital_record),
) -> VitalSignsResponse:
    """활력징후 기록(FR-091) — 게이트 vital.record(간호). 미존재 내원 404·빈 활력/범위 422·권한 403.

    recorded_by=토큰 주체(간호사), recorded_at=now(). 6 항목 선택·최소 1개 강제(Pydantic·DB CHECK).
    """
    return await nursing_service.create_vital_signs(user.sub, encounter_id, payload)


@router.get(
    "/encounters/{encounter_id}/vitals",
    response_model=list[VitalSignsResponse],
)
async def list_vital_signs(
    encounter_id: UUID,
    user: CurrentUser = Depends(require_vital_read),
) -> list[VitalSignsResponse]:
    """한 내원의 활력징후 목록(최신순, FR-032 진료 허브 좌 패널). 게이트 read∨record.

    직접 배열. 의사(encounter.read)·간호(vital.record) 양쪽 조회 — 둘 중 무권한이면 403.
    """
    return await nursing_service.list_vital_signs(user.sub, encounter_id)


# ── 처치 수행·일상 간호기록(Story 5.7 / FR-090·FR-092·FR-093·FR-094) ──────────────────


@router.get(
    "/nursing/worklist",
    response_model=list[NursingWorklistItem],
)
async def list_nursing_worklist(
    user: CurrentUser = Depends(require_nursing_worklist),
) -> list[NursingWorklistItem]:
    """간호 워크리스트(FR-090) — 오늘(KST) 활성 내원 + 미수행 처치·간호기록 건수.

    게이트 treatment.perform ∨ nursing.record(간호 진입). 처치 워크리스트·간호기록 두 화면 공유.
    ⚠️ /nursing/* 네임스페이스(/encounters/{id} 흡수 회피·5.6 교훈). 직접 배열.
    """
    return await nursing_service.list_nursing_worklist(user.sub)


@router.post(
    "/encounters/{encounter_id}/treatment-orders/{order_id}/perform",
    response_model=TreatmentOrderResponse,
)
async def perform_treatment_order(
    encounter_id: UUID,
    order_id: UUID,
    payload: TreatmentPerformBody,
    user: CurrentUser = Depends(require_treatment_perform),
) -> TreatmentOrderResponse:
    """처치 오더 수행(FR-090·FR-092) — ordered→performed. 게이트 treatment.perform(간호).

    재수행(이미 performed) → 409 invalid_transition(FR-093 최종선), 미존재 404, 권한 403. content
    입력 시 연결 간호기록 생성(수행자·시각은 RPC 가 항상 기록). 응답 = 갱신된 처치 오더.
    """
    return await nursing_service.perform_treatment_order(user.sub, encounter_id, order_id, payload)


@router.post(
    "/encounters/{encounter_id}/nursing-records",
    response_model=NursingRecordResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_nursing_record(
    encounter_id: UUID,
    payload: NursingRecordCreate,
    user: CurrentUser = Depends(require_nursing_record),
) -> NursingRecordResponse:
    """일상 간호기록 생성(FR-094) — 오더 없음(treatment_order_id=None). 게이트 nursing.record(간호).

    미존재 내원 404·빈/공백 content 422·권한 403. recorded_by=토큰 주체, recorded_at=now().
    """
    return await nursing_service.create_nursing_record(user.sub, encounter_id, payload)


@router.get(
    "/encounters/{encounter_id}/nursing-records",
    response_model=list[NursingRecordResponse],
)
async def list_nursing_records(
    encounter_id: UUID,
    user: CurrentUser = Depends(require_nursing_read),
) -> list[NursingRecordResponse]:
    """한 내원의 간호기록 목록(최신순). 게이트 order.read ∨ nursing.record.

    직접 배열. 처치 수행 연결(treatment_order_id) + 일상 기록(None) 모두 포함.
    """
    return await nursing_service.list_nursing_records(user.sub, encounter_id)
