"""근무표·휴진 오케스트레이션(services 계층). db 쓰기 → 응답 모델 매핑.

읽기(목록)는 web 이 Supabase 직접조회(전역 참조 데이터)하므로 여기엔 **쓰기(생성·수정·비활성) +
의사 피커 목록**만 둔다. 단일 DML 이라 보상 로직 없이 매핑만 조립한다. 불변식·감사는 DB 가 소유
(0030 EXCLUDE·CHECK·트리거). services/masters.py 미러.
"""

from __future__ import annotations

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
)


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


async def create_doctor_time_off(
    sub: UUID, payload: DoctorTimeOffCreate
) -> DoctorTimeOffResponse:
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
