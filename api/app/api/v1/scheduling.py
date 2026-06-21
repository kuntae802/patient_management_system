"""근무표·휴진 명령 라우터 — 생성·수정·비활성(soft delete) + 의사 피커. Story 6.1 / FR-220·221.

쓰기 권위(FastAPI/service_role): authenticated 는 근무표·휴진에 SELECT 만 가지므로(0030) 생성·수정·
비활성은 이 경로로만 수행된다. **목록 읽기는 web 이 Supabase 직접조회**(전역 참조 데이터 — RLS
authenticated SELECT). 게이트: require_permission('master.manage') → 403(masters 동일 — 근무표·
휴진은 관리자 관리 config). db.* 가 권한을 동일 트랜잭션에서 재평가(TOCTOU 차단)하고 0030 감사
트리거가 변경을 자동 기록(actor=호출 관리자). 겹침은 DB EXCLUDE → 409 schedule_overlap.

의사 피커(GET /doctors)는 users RLS(본인행, 0003)를 넘어야 해 예외적으로 API(service_role)로 읽는다
(나머지 목록은 web 이 Supabase 직접조회). masters 의 /departments/{id}/dependents 와 동형.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, status

from app.core.security import CurrentUser, require_permission
from app.schemas.masters import ActiveUpdate
from app.schemas.scheduling import (
    DoctorScheduleCreate,
    DoctorScheduleResponse,
    DoctorScheduleUpdate,
    DoctorTimeOffCreate,
    DoctorTimeOffResponse,
    DoctorTimeOffUpdate,
    SchedulingDoctor,
)
from app.services import scheduling as scheduling_service

router = APIRouter(prefix="/scheduling", tags=["scheduling"])

# 권한 의존성은 모듈 로드 시 1회 생성(요청마다 팩토리 호출 회피). 근무표·휴진 = 관리자 관리 config.
require_master_manage = require_permission("master.manage")


# ── 근무표(doctor_schedules) ──────────────────────────────────────────────────


@router.post(
    "/doctor-schedules", response_model=DoctorScheduleResponse, status_code=status.HTTP_201_CREATED
)
async def create_doctor_schedule(
    payload: DoctorScheduleCreate,
    user: CurrentUser = Depends(require_master_manage),
) -> DoctorScheduleResponse:
    """근무표 생성. 겹침 → 409 schedule_overlap, 비활성/미존재 의사·진료과·진료실 → 422."""
    return await scheduling_service.create_doctor_schedule(user.sub, payload)


@router.patch("/doctor-schedules/{schedule_id}", response_model=DoctorScheduleResponse)
async def update_doctor_schedule(
    schedule_id: UUID,
    payload: DoctorScheduleUpdate,
    user: CurrentUser = Depends(require_master_manage),
) -> DoctorScheduleResponse:
    """근무표 수정(전 필드 교체). 미존재 → 404, 겹침 → 409, 변경 FK 비활성/미존재 → 422."""
    return await scheduling_service.update_doctor_schedule(user.sub, schedule_id, payload)


@router.patch("/doctor-schedules/{schedule_id}/active", response_model=DoctorScheduleResponse)
async def set_doctor_schedule_active(
    schedule_id: UUID,
    payload: ActiveUpdate,
    user: CurrentUser = Depends(require_master_manage),
) -> DoctorScheduleResponse:
    """근무표 활성/비활성(soft delete). 미존재 → 404, 재활성 겹침 → 409."""
    return await scheduling_service.set_doctor_schedule_active(
        user.sub, schedule_id, is_active=payload.is_active
    )


# ── 휴진·예외(doctor_time_offs) ───────────────────────────────────────────────


@router.post(
    "/doctor-time-offs", response_model=DoctorTimeOffResponse, status_code=status.HTTP_201_CREATED
)
async def create_doctor_time_off(
    payload: DoctorTimeOffCreate,
    user: CurrentUser = Depends(require_master_manage),
) -> DoctorTimeOffResponse:
    """휴진·예외 생성. 비활성/미존재 의사 → 422."""
    return await scheduling_service.create_doctor_time_off(user.sub, payload)


@router.patch("/doctor-time-offs/{time_off_id}", response_model=DoctorTimeOffResponse)
async def update_doctor_time_off(
    time_off_id: UUID,
    payload: DoctorTimeOffUpdate,
    user: CurrentUser = Depends(require_master_manage),
) -> DoctorTimeOffResponse:
    """휴진·예외 수정(기간·사유). 미존재 → 404."""
    return await scheduling_service.update_doctor_time_off(user.sub, time_off_id, payload)


@router.patch("/doctor-time-offs/{time_off_id}/active", response_model=DoctorTimeOffResponse)
async def set_doctor_time_off_active(
    time_off_id: UUID,
    payload: ActiveUpdate,
    user: CurrentUser = Depends(require_master_manage),
) -> DoctorTimeOffResponse:
    """휴진·예외 활성/비활성(soft delete). 미존재 → 404."""
    return await scheduling_service.set_doctor_time_off_active(
        user.sub, time_off_id, is_active=payload.is_active
    )


# ── 의사 피커 ─────────────────────────────────────────────────────────────────


@router.get("/doctors", response_model=list[SchedulingDoctor])
async def list_scheduling_doctors(
    user: CurrentUser = Depends(require_master_manage),
) -> list[SchedulingDoctor]:
    """근무표 폼 의사 피커용 재직 의사 목록(id·name·department_id). users RLS(본인행)를 넘어야 해
    service_role 로 읽는다(나머지 목록은 web 직접조회)."""
    return await scheduling_service.list_scheduling_doctors(user.sub)
