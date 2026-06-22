"""근무표·휴진 오케스트레이션(services 계층). db 쓰기 → 응답 모델 매핑.

읽기(목록)는 web 이 Supabase 직접조회(전역 참조 데이터)하므로 여기엔 **쓰기(생성·수정·비활성) +
의사 피커 목록**만 둔다. 단일 DML 이라 보상 로직 없이 매핑만 조립한다. 불변식·감사는 DB 가 소유
(0030 EXCLUDE·CHECK·트리거). services/masters.py 미러.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta, timezone
from uuid import UUID

import asyncpg

from app.core import db
from app.core.errors import AppError
from app.schemas.encounters import EncounterResponse
from app.schemas.scheduling import (
    AffectedAppointment,
    AppointmentCancel,
    AppointmentCreate,
    AppointmentReschedule,
    AppointmentResponse,
    CalendarResponse,
    CalendarSlot,
    CalendarSlotStatus,
    DoctorColumn,
    DoctorScheduleCreate,
    DoctorScheduleResponse,
    DoctorScheduleUpdate,
    DoctorTimeOffCreate,
    DoctorTimeOffResponse,
    DoctorTimeOffUpdate,
    NoShowStatus,
    SchedulingDoctor,
    SelfAppointmentCreate,
    Slot,
    SlotGridResponse,
    SlotStatus,
)

# 슬롯 단위 = 클리닉 공통 30분(의사/진료실별 가변·점심 명시 슬롯은 이월). KST = 무 DST → 고정 +9
# 오프셋(zoneinfo/tzdata 의존 회피). 근무표 time 컬럼은 KST 로컬, 휴진·예약 timestamptz 는 UTC.
SLOT_MINUTES = 30
_KST = timezone(timedelta(hours=9))
_Range = tuple[datetime, datetime]


def _to_schedule(row: asyncpg.Record) -> DoctorScheduleResponse:
    return DoctorScheduleResponse.model_validate(dict(row))


def _to_time_off(row: asyncpg.Record) -> DoctorTimeOffResponse:
    return DoctorTimeOffResponse.model_validate(dict(row))


# ── 근무표(doctor_schedules) ──────────────────────────────────────────────────


async def create_doctor_schedule(
    sub: UUID, payload: DoctorScheduleCreate
) -> DoctorScheduleResponse:
    row = await db.insert_doctor_schedule(
        sub,
        doctor_id=payload.doctor_id,
        department_id=payload.department_id,
        room_id=payload.room_id,
        weekday=payload.weekday,
        start_time=payload.start_time,
        end_time=payload.end_time,
    )
    return _to_schedule(row)


async def update_doctor_schedule(
    sub: UUID, schedule_id: UUID, payload: DoctorScheduleUpdate
) -> DoctorScheduleResponse:
    row = await db.update_doctor_schedule(
        sub,
        schedule_id,
        doctor_id=payload.doctor_id,
        department_id=payload.department_id,
        room_id=payload.room_id,
        weekday=payload.weekday,
        start_time=payload.start_time,
        end_time=payload.end_time,
    )
    return _to_schedule(row)


async def set_doctor_schedule_active(
    sub: UUID, schedule_id: UUID, *, is_active: bool
) -> DoctorScheduleResponse:
    row = await db.set_doctor_schedule_active(sub, schedule_id, is_active=is_active)
    return _to_schedule(row)


# ── 휴진·예외(doctor_time_offs) ───────────────────────────────────────────────


async def create_doctor_time_off(sub: UUID, payload: DoctorTimeOffCreate) -> DoctorTimeOffResponse:
    row = await db.insert_doctor_time_off(
        sub,
        doctor_id=payload.doctor_id,
        start_at=payload.start_at,
        end_at=payload.end_at,
        reason=payload.reason,
    )
    return _to_time_off(row)


async def update_doctor_time_off(
    sub: UUID, time_off_id: UUID, payload: DoctorTimeOffUpdate
) -> DoctorTimeOffResponse:
    row = await db.update_doctor_time_off(
        sub,
        time_off_id,
        start_at=payload.start_at,
        end_at=payload.end_at,
        reason=payload.reason,
    )
    return _to_time_off(row)


async def set_doctor_time_off_active(
    sub: UUID, time_off_id: UUID, *, is_active: bool
) -> DoctorTimeOffResponse:
    row = await db.set_doctor_time_off_active(sub, time_off_id, is_active=is_active)
    return _to_time_off(row)


# ── 의사 피커 목록 ────────────────────────────────────────────────────────────


async def list_scheduling_doctors(sub: UUID) -> list[SchedulingDoctor]:
    rows = await db.fetch_active_doctors(sub)
    return [SchedulingDoctor.model_validate(dict(r)) for r in rows]


async def list_bookable_doctors(sub: UUID, department_id: UUID | None) -> list[SchedulingDoctor]:
    """예약 슬롯 조회용 재직 의사 목록(진료과 필터 옵션). 게이트 appointment.read."""
    rows = await db.fetch_bookable_doctors(sub, department_id)
    return [SchedulingDoctor.model_validate(dict(r)) for r in rows]


# ── 동적 가용 슬롯 계산 (Story 6.2 / FR-012) ───────────────────────────────────


def _overlaps(slot_start: datetime, slot_end: datetime, ranges: list[_Range]) -> bool:
    """반열림 [start, end) 겹침 — 어떤 차단 구간과도 겹치면 True."""
    return any(r_start < slot_end and r_end > slot_start for r_start, r_end in ranges)


def _slot_status(
    slot_start: datetime,
    slot_end: datetime,
    time_offs: list[_Range],
    booked: list[_Range],
    now: datetime,
) -> SlotStatus:
    """슬롯 상태 우선순위: past > time_off > booked > available(모두 UTC aware 비교)."""
    if slot_start < now:
        return "past"
    if _overlaps(slot_start, slot_end, time_offs):
        return "time_off"
    if _overlaps(slot_start, slot_end, booked):
        return "booked"
    return "available"


def _build_slots(
    target_date: date,
    blocks: list[tuple[time, time]],
    time_offs: list[_Range],
    booked: list[_Range],
    now: datetime,
    slot_minutes: int = SLOT_MINUTES,
) -> list[Slot]:
    """순수 슬롯 계산(DB 무관 — 단위 테스트 대상). 근무 블록(KST 로컬 time)을 slot_minutes 단위로
    전개하고 각 슬롯에 status 부여. 블록을 넘는 자투리(< slot_minutes)는 슬롯 미생성. 슬롯 시각은
    KST 벽시계 → UTC 변환 후 휴진·예약(UTC)과 비교. 결과는 시작 시각 오름차순(블록 정렬 무관)."""
    slots: list[Slot] = []
    step = timedelta(minutes=slot_minutes)
    for start_t, end_t in blocks:
        block_start = datetime.combine(target_date, start_t, tzinfo=_KST)
        block_end = datetime.combine(target_date, end_t, tzinfo=_KST)
        cursor = block_start
        while cursor + step <= block_end:
            slot_end = cursor + step
            start_utc = cursor.astimezone(UTC)
            end_utc = slot_end.astimezone(UTC)
            status = _slot_status(start_utc, end_utc, time_offs, booked, now)
            slots.append(Slot(start=start_utc, end=end_utc, status=status))
            cursor = slot_end
    slots.sort(key=lambda s: s.start)
    return slots


async def compute_available_slots(
    sub: UUID, doctor_id: UUID, target_date: date
) -> SlotGridResponse:
    """의사·날짜(KST)의 가용 슬롯 그리드 = 근무 − 휴진 − booked예약(FR-012).

    비활성/미존재/비-의사 → 근무 블록 0 → 빈 슬롯(404 아님 — 정상 빈 결과, AC3). 읽기는 전부
    service_role(엔드포인트 appointment.read 게이트로 충분)."""
    # weekday = PG dow(0=일 .. 6=토) 정합 — isoweekday()(월=1..일=7) % 7.
    pg_dow = target_date.isoweekday() % 7
    day_start = datetime.combine(target_date, time.min, tzinfo=_KST).astimezone(UTC)
    day_end = day_start + timedelta(days=1)

    sched_rows = await db.fetch_doctor_schedules_for_weekday(sub, doctor_id, pg_dow)
    blocks = [(r["start_time"], r["end_time"]) for r in sched_rows]
    off_rows = await db.fetch_doctor_time_offs_in_range(sub, doctor_id, day_start, day_end)
    time_offs: list[_Range] = [(r["start_at"], r["end_at"]) for r in off_rows]
    booked_rows = await db.fetch_booked_appointments_in_range(sub, doctor_id, day_start, day_end)
    booked: list[_Range] = [(r["scheduled_start"], r["scheduled_end"]) for r in booked_rows]

    now = datetime.now(UTC)
    slots = _build_slots(target_date, blocks, time_offs, booked, now)
    return SlotGridResponse(
        doctor_id=doctor_id, date=target_date, slot_minutes=SLOT_MINUTES, slots=slots
    )


# ── 예약 생성 · 캘린더 (Story 6.3) ─────────────────────────────────────────────


def _normalize_utc(value: datetime) -> datetime:
    """naive → UTC 간주(스키마는 timestamptz 기대). aware 는 그대로."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


async def _assert_slot_bookable(sub: UUID, doctor_id: UUID, scheduled_start: datetime) -> None:
    """슬롯-윈도우 검증(6.3 이월 청산) — scheduled_start 가 의사의 **available 슬롯**인지(과거 아님·
    근무블록 내·30분 정렬·휴진 아님) `compute_available_slots` 재사용으로 확인. 아니면 422
    slot_unavailable. available-vs-booked 최종선은 EXCLUDE(생성·변경 시 catch→409)."""
    # 슬롯이 **실재 근무 슬롯**인지만 검증(available 또는 booked) — 휴진·지난·근무외·비정렬은 거부.
    # 이미 예약됨(booked)은 여기서 안 막음: 더블부킹은 DB EXCLUDE 가 409 double_booking 처리
    # (슬롯-윈도우가 booked 를 422 로 가로채면 더블부킹 409 경로가 사라짐 — 6.3 AC3 보존).
    target_date = scheduled_start.astimezone(_KST).date()
    grid = await compute_available_slots(sub, doctor_id, target_date)
    if not any(
        s.status in ("available", "booked") and s.start == scheduled_start for s in grid.slots
    ):
        raise AppError(
            "선택한 시간은 예약할 수 없는 슬롯입니다(근무 외·휴진·지난 시각).",
            code="slot_unavailable",
            status_code=422,
            detail={"doctor_id": str(doctor_id), "scheduled_start": scheduled_start.isoformat()},
        )


async def create_appointment(sub: UUID, payload: AppointmentCreate) -> AppointmentResponse:
    """예약 생성(booked). scheduled_end = start + SLOT_MINUTES(서버 계산). 더블부킹 → 409.

    과거 시각 → 422 appointment_in_past(빠른 구체 사유). 슬롯-윈도우 → 422 slot_unavailable
    (6.3 이월 청산·근무블록/정렬/휴진/available)."""
    start = _normalize_utc(payload.scheduled_start)
    if start <= datetime.now(UTC):
        raise AppError(
            "과거 시각으로는 예약할 수 없습니다.",
            code="appointment_in_past",
            status_code=422,
        )
    await _assert_slot_bookable(sub, payload.doctor_id, start)
    scheduled_end = start + timedelta(minutes=SLOT_MINUTES)
    row = await db.insert_appointment(
        sub,
        patient_id=payload.patient_id,
        doctor_id=payload.doctor_id,
        department_id=payload.department_id,
        room_id=None,  # 진료실 동적 배정은 이월(6.1/4.4 posture)
        scheduled_start=start,
        scheduled_end=scheduled_end,
        note=payload.note,
        sms_opt_in=payload.sms_opt_in,
        created_by=sub,
    )
    return AppointmentResponse.model_validate(dict(row))


# ── 환자 본인 예약 생성 (Story 6.5 / FR-010) ──────────────────────────────────


async def create_self_appointment(sub: UUID, payload: SelfAppointmentCreate) -> AppointmentResponse:
    """환자 본인 예약 생성(booked). `create_appointment` 미러하되 patient_id 는 서버가 도출(세션 uid
    스코프·클라 미수용)·권한검사 없음(권위=self-scope). 과거 시각 → 422 appointment_in_past·슬롯-
    윈도우 → 422 slot_unavailable·미연결 → 409 no_self_patient·더블부킹 → 409 double_booking."""
    start = _normalize_utc(payload.scheduled_start)
    if start <= datetime.now(UTC):
        raise AppError(
            "과거 시각으로는 예약할 수 없습니다.",
            code="appointment_in_past",
            status_code=422,
        )
    await _assert_slot_bookable(sub, payload.doctor_id, start)
    scheduled_end = start + timedelta(minutes=SLOT_MINUTES)
    row = await db.insert_self_appointment(
        sub,
        doctor_id=payload.doctor_id,
        department_id=payload.department_id,
        scheduled_start=start,
        scheduled_end=scheduled_end,
        sms_opt_in=payload.sms_opt_in,
    )
    return AppointmentResponse.model_validate(dict(row))


# ── 예약 전이·변경·도착 접수 (Story 6.4) ──────────────────────────────────────


async def cancel_appointment(
    sub: UUID, appointment_id: UUID, payload: AppointmentCancel
) -> AppointmentResponse:
    """예약 취소(booked→cancelled). 소스 booked 아니면 409 invalid_transition."""
    row = await db.cancel_appointment(sub, appointment_id, reason=payload.reason)
    return AppointmentResponse.model_validate(dict(row))


async def mark_appointment_no_show(
    sub: UUID, appointment_id: UUID, payload: AppointmentCancel
) -> AppointmentResponse:
    """예약 노쇼(booked→no_show). 6.7 노쇼 카운트 근거."""
    row = await db.mark_appointment_no_show(sub, appointment_id, reason=payload.reason)
    return AppointmentResponse.model_validate(dict(row))


# ── 노쇼 카운트·임계치 (Story 6.7 / FR-015) ────────────────────────────────────


async def get_patient_no_show_status(sub: UUID, patient_id: UUID) -> NoShowStatus:
    """환자 노쇼 상태(횟수·임계치·차단 여부) — booking-peek 프로액티브 배지용. count = 단일 진실
    함수(db.fetch_patient_no_show_count)·threshold = 앱 상수(db.NO_SHOW_THRESHOLD)·blocked = 임계
    초과(생성 가드와 동일 판정). 게이트는 라우터(appointment.read)."""
    count = await db.fetch_patient_no_show_count(sub, patient_id)
    return NoShowStatus(
        patient_id=patient_id,
        no_show_count=count,
        threshold=db.NO_SHOW_THRESHOLD,
        blocked=count > db.NO_SHOW_THRESHOLD,
    )


async def reschedule_appointment(
    sub: UUID, appointment_id: UUID, payload: AppointmentReschedule
) -> AppointmentResponse:
    """예약 변경(시각·의사 재배치). 새 슬롯 슬롯-윈도우 검증 → db UPDATE(더블부킹→409)."""
    start = _normalize_utc(payload.scheduled_start)
    if start <= datetime.now(UTC):
        raise AppError(
            "과거 시각으로는 예약할 수 없습니다.", code="appointment_in_past", status_code=422
        )
    await _assert_slot_bookable(sub, payload.doctor_id, start)
    scheduled_end = start + timedelta(minutes=SLOT_MINUTES)
    row = await db.reschedule_appointment(
        sub,
        appointment_id,
        doctor_id=payload.doctor_id,
        scheduled_start=start,
        scheduled_end=scheduled_end,
    )
    return AppointmentResponse.model_validate(dict(row))


async def check_in_reservation(sub: UUID, appointment_id: UUID) -> EncounterResponse:
    """예약 환자 도착 접수 → reserved registered 내원 생성(대기 현황판 진입) + 예약 completed."""
    row = await db.check_in_reservation(sub, appointment_id)
    return EncounterResponse.model_validate(dict(row))


# ── 휴진 영향 예약 조회 (Story 6.8 / FR-016) ──────────────────────────────────


async def list_affected_appointments(
    sub: UUID, doctor_id: UUID, start_at: datetime, end_at: datetime
) -> list[AffectedAppointment]:
    """휴진 기간에 걸린 영향 예약(그 의사·booked·윈도우 겹침) — 재배정/취소·안내 대상(AC1). 게이트는
    라우터(appointment.read). naive datetime → UTC 간주(슬롯 함수 선례·_normalize_utc)."""
    rows = await db.fetch_affected_appointments(
        sub, doctor_id, _normalize_utc(start_at), _normalize_utc(end_at)
    )
    return [AffectedAppointment.model_validate(dict(r)) for r in rows]


# 슬롯을 **점유하는** 예약 status → 캘린더 슬롯 status. ⚠️ cancelled·no_show 는 제외(6.4 AC2:
# "취소·노쇼된 슬롯은 다시 가용으로") — 점유 안 함 → base(available/past) 복귀·재예약 가능.
# 한 슬롯에 여러 점유 예약(취소 후 재예약 등) 시 우선순위로 활성(confirmed) 우선.
_APPT_CAL_STATUS: dict[str, CalendarSlotStatus] = {
    "booked": "confirmed",
    "completed": "completed",
}
_CAL_PRIORITY: dict[CalendarSlotStatus, int] = {
    "confirmed": 4,
    "completed": 3,
}


def _build_doctor_column(
    doctor_id: UUID,
    doctor_name: str,
    target_date: date,
    blocks: list[tuple[time, time]],
    time_offs: list[_Range],
    appointments: list[dict],
    now: datetime,
    slot_minutes: int = SLOT_MINUTES,
) -> DoctorColumn:
    """의사 1명의 캘린더 열 — 근무 슬롯(가용/휴진/지남) 위에 **점유 예약** overlay(확정/완료).

    base = `_build_slots`(booked=[] → available/time_off/past). 점유 예약(booked→confirmed·
    completed)만 overlay(confirmed > completed). cancelled·no_show 는 점유 안 함 → 가용 복귀(AC2).
    예약 없으면 base 상태 유지."""
    base = _build_slots(target_date, blocks, time_offs, [], now, slot_minutes)
    cal_slots: list[CalendarSlot] = []
    for s in base:
        best: dict | None = None
        best_pri = 0
        for appt in appointments:
            cal_status = _APPT_CAL_STATUS.get(appt["status"])  # cancelled/no_show → None(미점유)
            if cal_status is None:
                continue
            if appt["scheduled_start"] < s.end and appt["scheduled_end"] > s.start:
                pri = _CAL_PRIORITY[cal_status]
                if pri > best_pri:
                    best_pri = pri
                    best = appt
        if best is not None:
            cal_slots.append(
                CalendarSlot(
                    start=s.start,
                    end=s.end,
                    status=_APPT_CAL_STATUS[best["status"]],
                    patient_name=best["patient_name"],
                    appointment_id=best["id"],
                )
            )
        else:
            # base 상태(available/time_off/past)는 CalendarSlotStatus 의 부분집합 → 직접 사용.
            cal_slots.append(CalendarSlot(start=s.start, end=s.end, status=s.status))
    return DoctorColumn(doctor_id=doctor_id, doctor_name=doctor_name, slots=cal_slots)


def _build_calendar(
    target_date: date,
    columns_input: list[tuple[UUID, str, list[tuple[time, time]], list[_Range], list[dict]]],
    now: datetime,
    slot_minutes: int = SLOT_MINUTES,
) -> CalendarResponse:
    """순수 캘린더 합성(DB 무관 — 단위 테스트). 의사별 열 = `_build_doctor_column`."""
    doctors = [
        _build_doctor_column(d_id, d_name, target_date, blocks, offs, appts, now, slot_minutes)
        for (d_id, d_name, blocks, offs, appts) in columns_input
    ]
    return CalendarResponse(date=target_date, slot_minutes=slot_minutes, doctors=doctors)


async def get_day_calendar(sub: UUID, department_id: UUID, target_date: date) -> CalendarResponse:
    """진료과·날짜(KST)의 예약 캘린더 = 재직 의사 열 × 시간 슬롯(가용+예약 overlay). 게이트
    appointment.read. 의사별 근무·휴진은 6.2 헬퍼 재사용, 예약은 1회 배치 조회 후 의사별 그룹핑."""
    pg_dow = target_date.isoweekday() % 7
    day_start = datetime.combine(target_date, time.min, tzinfo=_KST).astimezone(UTC)
    day_end = day_start + timedelta(days=1)

    doctors = await db.fetch_bookable_doctors(sub, department_id)
    now = datetime.now(UTC)
    if not doctors:
        return CalendarResponse(date=target_date, slot_minutes=SLOT_MINUTES, doctors=[])

    appt_rows = await db.fetch_appointments_for_date(
        sub, [d["id"] for d in doctors], day_start, day_end
    )
    appts_by_doctor: dict[UUID, list[dict]] = {}
    for row in appt_rows:
        appts_by_doctor.setdefault(row["doctor_id"], []).append(dict(row))

    columns_input: list[tuple[UUID, str, list[tuple[time, time]], list[_Range], list[dict]]] = []
    for d in doctors:
        sched_rows = await db.fetch_doctor_schedules_for_weekday(sub, d["id"], pg_dow)
        blocks = [(r["start_time"], r["end_time"]) for r in sched_rows]
        off_rows = await db.fetch_doctor_time_offs_in_range(sub, d["id"], day_start, day_end)
        time_offs: list[_Range] = [(r["start_at"], r["end_at"]) for r in off_rows]
        columns_input.append(
            (d["id"], d["name"], blocks, time_offs, appts_by_doctor.get(d["id"], []))
        )
    return _build_calendar(target_date, columns_input, now)
