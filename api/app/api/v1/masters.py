"""마스터(진료과·진료실) 명령 라우터 — 생성·수정·비활성(soft delete). Story 2.1 / FR-200·203.

쓰기 권위(FastAPI/service_role): authenticated 는 마스터에 SELECT 만 가지므로(0006) 생성·수정·비활성
은 이 경로로만 수행된다. **목록 읽기는 web 이 Supabase 직접조회**(전역 참조 데이터 — RLS
authenticated SELECT). 게이트: require_permission('master.manage') → 403. 실제 쓰기는 db.* 가
권한을 동일 트랜잭션에서 재평가(TOCTOU 차단)하고, 0006 감사 트리거가 변경을 자동 기록(actor=호출
관리자). 비활성은 행을 보존하는 soft delete(물리 삭제 없음 — 과거 기록 참조 보존, FR-203).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, status

from app.core.security import CurrentUser, require_permission
from app.schemas.masters import (
    ActiveUpdate,
    DepartmentCreate,
    DepartmentResponse,
    DepartmentUpdate,
    DiagnosisCreate,
    DiagnosisResponse,
    DiagnosisUpdate,
    DrugCreate,
    DrugResponse,
    DrugUpdate,
    FeeScheduleCreate,
    FeeScheduleResponse,
    FeeScheduleUpdate,
    RoomCreate,
    RoomResponse,
    RoomUpdate,
)
from app.services import masters as masters_service

router = APIRouter(prefix="/masters", tags=["masters"])

# 권한 의존성은 모듈 로드 시 1회 생성(요청마다 팩토리 호출 회피).
require_master_manage = require_permission("master.manage")


# ── 진료과(departments) ───────────────────────────────────────────────────────


@router.post(
    "/departments", response_model=DepartmentResponse, status_code=status.HTTP_201_CREATED
)
async def create_department(
    payload: DepartmentCreate,
    user: CurrentUser = Depends(require_master_manage),
) -> DepartmentResponse:
    """진료과 생성. 코드 중복 → 409 code_taken."""
    return await masters_service.create_department(user.sub, payload)


@router.patch("/departments/{department_id}", response_model=DepartmentResponse)
async def update_department(
    department_id: UUID,
    payload: DepartmentUpdate,
    user: CurrentUser = Depends(require_master_manage),
) -> DepartmentResponse:
    """진료과 수정(name·description). 미존재 → 404."""
    return await masters_service.update_department(user.sub, department_id, payload)


@router.patch("/departments/{department_id}/active", response_model=DepartmentResponse)
async def set_department_active(
    department_id: UUID,
    payload: ActiveUpdate,
    user: CurrentUser = Depends(require_master_manage),
) -> DepartmentResponse:
    """진료과 활성/비활성(soft delete) — 물리 삭제 없이 신규 선택만 제외. 미존재 → 404."""
    return await masters_service.set_department_active(
        user.sub, department_id, is_active=payload.is_active
    )


# ── 진료실(rooms) ─────────────────────────────────────────────────────────────


@router.post("/rooms", response_model=RoomResponse, status_code=status.HTTP_201_CREATED)
async def create_room(
    payload: RoomCreate,
    user: CurrentUser = Depends(require_master_manage),
) -> RoomResponse:
    """진료실 생성. 코드 중복 → 409, 미존재 진료과 배정 → 422 invalid_department."""
    return await masters_service.create_room(user.sub, payload)


@router.patch("/rooms/{room_id}", response_model=RoomResponse)
async def update_room(
    room_id: UUID,
    payload: RoomUpdate,
    user: CurrentUser = Depends(require_master_manage),
) -> RoomResponse:
    """진료실 수정(name·department_id). 미존재 진료과 → 422, 미존재 진료실 → 404."""
    return await masters_service.update_room(user.sub, room_id, payload)


@router.patch("/rooms/{room_id}/active", response_model=RoomResponse)
async def set_room_active(
    room_id: UUID,
    payload: ActiveUpdate,
    user: CurrentUser = Depends(require_master_manage),
) -> RoomResponse:
    """진료실 활성/비활성(soft delete). 미존재 → 404."""
    return await masters_service.set_room_active(user.sub, room_id, is_active=payload.is_active)


# ── 진단(diagnoses, KCD) — Story 2.2 ──────────────────────────────────────────


@router.post(
    "/diagnoses", response_model=DiagnosisResponse, status_code=status.HTTP_201_CREATED
)
async def create_diagnosis(
    payload: DiagnosisCreate,
    user: CurrentUser = Depends(require_master_manage),
) -> DiagnosisResponse:
    """KCD 진단 생성. 코드 중복 → 409 code_taken, 만료<발효 → 422."""
    return await masters_service.create_diagnosis(user.sub, payload)


@router.patch("/diagnoses/{diagnosis_id}", response_model=DiagnosisResponse)
async def update_diagnosis(
    diagnosis_id: UUID,
    payload: DiagnosisUpdate,
    user: CurrentUser = Depends(require_master_manage),
) -> DiagnosisResponse:
    """KCD 진단 수정(name·유효기간). 미존재 → 404."""
    return await masters_service.update_diagnosis(user.sub, diagnosis_id, payload)


@router.patch("/diagnoses/{diagnosis_id}/active", response_model=DiagnosisResponse)
async def set_diagnosis_active(
    diagnosis_id: UUID,
    payload: ActiveUpdate,
    user: CurrentUser = Depends(require_master_manage),
) -> DiagnosisResponse:
    """KCD 진단 활성/비활성(soft delete) — 물리 삭제 없이 신규 선택만 제외. 미존재 → 404."""
    return await masters_service.set_diagnosis_active(
        user.sub, diagnosis_id, is_active=payload.is_active
    )


# ── 수가(fee_schedules, EDI) — Story 2.2 ──────────────────────────────────────


@router.post(
    "/fee-schedules", response_model=FeeScheduleResponse, status_code=status.HTTP_201_CREATED
)
async def create_fee_schedule(
    payload: FeeScheduleCreate,
    user: CurrentUser = Depends(require_master_manage),
) -> FeeScheduleResponse:
    """EDI 수가 생성. 코드 중복 → 409, 금액 음수·만료<발효 → 422."""
    return await masters_service.create_fee_schedule(user.sub, payload)


@router.patch("/fee-schedules/{fee_schedule_id}", response_model=FeeScheduleResponse)
async def update_fee_schedule(
    fee_schedule_id: UUID,
    payload: FeeScheduleUpdate,
    user: CurrentUser = Depends(require_master_manage),
) -> FeeScheduleResponse:
    """EDI 수가 수정(name·amount_krw·category·유효기간). 미존재 → 404."""
    return await masters_service.update_fee_schedule(user.sub, fee_schedule_id, payload)


@router.patch("/fee-schedules/{fee_schedule_id}/active", response_model=FeeScheduleResponse)
async def set_fee_schedule_active(
    fee_schedule_id: UUID,
    payload: ActiveUpdate,
    user: CurrentUser = Depends(require_master_manage),
) -> FeeScheduleResponse:
    """EDI 수가 활성/비활성(soft delete). 미존재 → 404."""
    return await masters_service.set_fee_schedule_active(
        user.sub, fee_schedule_id, is_active=payload.is_active
    )


# ── 약품(drugs) — Story 2.2 ───────────────────────────────────────────────────


@router.post("/drugs", response_model=DrugResponse, status_code=status.HTTP_201_CREATED)
async def create_drug(
    payload: DrugCreate,
    user: CurrentUser = Depends(require_master_manage),
) -> DrugResponse:
    """약품 생성. 코드 중복 → 409, 만료<발효 → 422."""
    return await masters_service.create_drug(user.sub, payload)


@router.patch("/drugs/{drug_id}", response_model=DrugResponse)
async def update_drug(
    drug_id: UUID,
    payload: DrugUpdate,
    user: CurrentUser = Depends(require_master_manage),
) -> DrugResponse:
    """약품 수정(name·주성분·단위·유효기간). 미존재 → 404."""
    return await masters_service.update_drug(user.sub, drug_id, payload)


@router.patch("/drugs/{drug_id}/active", response_model=DrugResponse)
async def set_drug_active(
    drug_id: UUID,
    payload: ActiveUpdate,
    user: CurrentUser = Depends(require_master_manage),
) -> DrugResponse:
    """약품 활성/비활성(soft delete). 미존재 → 404."""
    return await masters_service.set_drug_active(user.sub, drug_id, is_active=payload.is_active)
