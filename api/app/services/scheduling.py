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
from app.schemas.scheduling import (
    DoctorScheduleCreate,
    DoctorScheduleResponse,
    DoctorScheduleUpdate,
    DoctorTimeOffCreate,
    DoctorTimeOffResponse,
    DoctorTimeOffUpdate,
    SchedulingDoctor,
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
