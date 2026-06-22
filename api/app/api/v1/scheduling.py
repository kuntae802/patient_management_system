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

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, status

from app.core.security import CurrentUser, get_current_patient, require_permission
from app.schemas.encounters import EncounterResponse
from app.schemas.masters import ActiveUpdate
from app.schemas.scheduling import (
    AppointmentCancel,
    AppointmentCreate,
    AppointmentReschedule,
    AppointmentResponse,
    CalendarResponse,
    DoctorScheduleCreate,
    DoctorScheduleResponse,
    DoctorScheduleUpdate,
    DoctorTimeOffCreate,
    DoctorTimeOffResponse,
    DoctorTimeOffUpdate,
    SchedulingDoctor,
    SelfAppointmentCreate,
    SlotGridResponse,
)
from app.services import scheduling as scheduling_service

router = APIRouter(prefix="/scheduling", tags=["scheduling"])

# 권한 의존성은 모듈 로드 시 1회 생성(요청마다 팩토리 호출 회피). 근무표·휴진 = 관리자 관리 config.
require_master_manage = require_permission("master.manage")
# 슬롯·예약 조회(원무·관리자 — 의사·환자는 6.4/6.5 grant). 비-PII 가용성이나 관례대로 게이트.
require_appointment_read = require_permission("appointment.read")
# 예약 생성(booking-peek 저장 — 원무). appointment.read 와 별개 최소권한(조회만 vs 생성).
require_appointment_create = require_permission("appointment.create")
# 예약 변경·취소·노쇼·도착접수(기존 예약 상태 변경 — 원무). create 와 별개 최소권한.
require_appointment_update = require_permission("appointment.update")


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


# ── 동적 가용 슬롯 · 예약 피커 (Story 6.2) ─────────────────────────────────────


@router.get("/slots", response_model=SlotGridResponse)
async def get_available_slots(
    doctor_id: UUID,
    date: date,
    user: CurrentUser = Depends(require_appointment_read),
) -> SlotGridResponse:
    """의사·날짜(KST)의 가용 슬롯 그리드 = 근무 − 휴진 − booked예약(FR-012). 게이트
    appointment.read → 403. 비활성/미존재 의사 → 빈 슬롯(404 아님). date 파싱 실패 → 422."""
    return await scheduling_service.compute_available_slots(user.sub, doctor_id, date)


@router.get("/bookable-doctors", response_model=list[SchedulingDoctor])
async def list_bookable_doctors(
    department_id: UUID | None = None,
    user: CurrentUser = Depends(require_appointment_read),
) -> list[SchedulingDoctor]:
    """예약 슬롯 조회용 재직 의사 목록(진료과 필터 옵션). 게이트 appointment.read. 기존
    /doctors 는 master.manage(admin) 전용이라 원무·예약 흐름엔 본 엔드포인트를 쓴다."""
    return await scheduling_service.list_bookable_doctors(user.sub, department_id)


# ── 예약 생성 · 캘린더 (Story 6.3) ─────────────────────────────────────────────


@router.post(
    "/appointments", response_model=AppointmentResponse, status_code=status.HTTP_201_CREATED
)
async def create_appointment(
    payload: AppointmentCreate,
    user: CurrentUser = Depends(require_appointment_create),
) -> AppointmentResponse:
    """예약 생성(booking-peek). 게이트 appointment.create. 더블부킹 → 409 double_booking·미존재
    환자 404·비활성 환자/의사·비-의사 → 422·미존재 진료실 등 FK → 422."""
    return await scheduling_service.create_appointment(user.sub, payload)


@router.get("/calendar", response_model=CalendarResponse)
async def get_day_calendar(
    department_id: UUID,
    date: date,
    user: CurrentUser = Depends(require_appointment_read),
) -> CalendarResponse:
    """진료과·날짜(KST)의 예약 캘린더(시간레일 × 의사 열·일 보기) = 가용 슬롯 + 예약 overlay
    (확정/완료/노쇼/취소+환자명). 게이트 appointment.read. date 파싱 실패 → 422."""
    return await scheduling_service.get_day_calendar(user.sub, department_id, date)


# ── 예약 전이·변경·도착 접수 (Story 6.4·액션 엔드포인트·status PATCH 아님) ──────────────────


@router.post("/appointments/{appointment_id}/cancel", response_model=AppointmentResponse)
async def cancel_appointment(
    appointment_id: UUID,
    payload: AppointmentCancel,
    user: CurrentUser = Depends(require_appointment_update),
) -> AppointmentResponse:
    """예약 취소(booked→cancelled). 게이트 appointment.update. 미존재 404·잘못된 전이 409."""
    return await scheduling_service.cancel_appointment(user.sub, appointment_id, payload)


@router.post("/appointments/{appointment_id}/no-show", response_model=AppointmentResponse)
async def mark_appointment_no_show(
    appointment_id: UUID,
    payload: AppointmentCancel,
    user: CurrentUser = Depends(require_appointment_update),
) -> AppointmentResponse:
    """예약 노쇼(booked→no_show). 게이트 appointment.update. 6.7 노쇼 카운트 근거."""
    return await scheduling_service.mark_appointment_no_show(user.sub, appointment_id, payload)


@router.post("/appointments/{appointment_id}/reschedule", response_model=AppointmentResponse)
async def reschedule_appointment(
    appointment_id: UUID,
    payload: AppointmentReschedule,
    user: CurrentUser = Depends(require_appointment_update),
) -> AppointmentResponse:
    """예약 변경(새 의사·시각). 게이트 appointment.update. 슬롯 불가 422·더블부킹 409·전이 409."""
    return await scheduling_service.reschedule_appointment(user.sub, appointment_id, payload)


@router.post(
    "/appointments/{appointment_id}/check-in",
    response_model=EncounterResponse,
    status_code=status.HTTP_201_CREATED,
)
async def check_in_reservation(
    appointment_id: UUID,
    user: CurrentUser = Depends(require_appointment_update),
) -> EncounterResponse:
    """예약 환자 도착 접수 → reserved registered 내원 생성(대기 현황판 진입) + 예약 completed.
    게이트 appointment.update(+ 내원 생성 encounter.register TOCTOU). 미존재 404·잘못된 전이 409."""
    return await scheduling_service.check_in_reservation(user.sub, appointment_id)


# ── 환자 본인 예약 (Story 6.5·세션 uid 스코프) ────────────────────────────────────────────
# 게이트 = get_current_patient(권한 의존성 아님 — 직원 5역할 → 403·환자 권한 0). 권위 = "본인
# patient_id 만 서버 도출"(클라 미수용·교차환자 차단). 읽기(슬롯·의사)는 비-PII 가용성이라 기존
# 서비스를 환자 sub 로 재사용(직원 /scheduling/bookable-doctors·/slots[appointment.read]와 병존).
# ⚠️ 정적 세그먼트 'me' — /appointments/{appointment_id} 동적 라우트와 충돌 없음.


@router.get("/me/bookable-doctors", response_model=list[SchedulingDoctor])
async def list_self_bookable_doctors(
    department_id: UUID | None = None,
    user: CurrentUser = Depends(get_current_patient),
) -> list[SchedulingDoctor]:
    """환자 예약용 재직 의사 목록(진료과 필터 옵션). 게이트 get_current_patient(직원 403)."""
    return await scheduling_service.list_bookable_doctors(user.sub, department_id)


@router.get("/me/slots", response_model=SlotGridResponse)
async def get_self_available_slots(
    doctor_id: UUID,
    date: date,
    user: CurrentUser = Depends(get_current_patient),
) -> SlotGridResponse:
    """환자 본인 예약용 가용 슬롯 그리드(근무−휴진−booked예약·FR-010). 게이트 get_current_patient.
    비활성/미존재 의사 → 빈 슬롯(404 아님). date 파싱 실패 → 422."""
    return await scheduling_service.compute_available_slots(user.sub, doctor_id, date)


@router.post(
    "/me/appointments", response_model=AppointmentResponse, status_code=status.HTTP_201_CREATED
)
async def create_self_appointment(
    payload: SelfAppointmentCreate,
    user: CurrentUser = Depends(get_current_patient),
) -> AppointmentResponse:
    """환자 본인 예약 생성. 게이트 get_current_patient. patient_id 는 서버가 auth_uid=sub 로 도출
    (클라 미수용). 미연결 409 no_self_patient·더블부킹 409·과거 422·슬롯 불가 422·비활성 422."""
    return await scheduling_service.create_self_appointment(user.sub, payload)
