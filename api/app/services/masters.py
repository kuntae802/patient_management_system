"""진료과·진료실 마스터 오케스트레이션(services 계층). db 쓰기 → 응답 모델 매핑.

읽기(목록)는 web 이 Supabase 직접조회(전역 참조 데이터)하므로 여기엔 **쓰기(생성·수정·비활성)만**
둔다. 단일 DML 이라 1.8(두 시스템 오케스트레이션)과 달리 보상 로직은 없고 매핑만 조립한다.
불변식·감사는 DB 가 소유(0006 트리거).
"""

from __future__ import annotations

from uuid import UUID

import asyncpg

from app.core import db
from app.schemas.masters import (
    DepartmentCreate,
    DepartmentDependents,
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


def _to_department(row: asyncpg.Record) -> DepartmentResponse:
    return DepartmentResponse.model_validate(dict(row))


def _to_room(row: asyncpg.Record) -> RoomResponse:
    return RoomResponse.model_validate(dict(row))


def _to_diagnosis(row: asyncpg.Record) -> DiagnosisResponse:
    return DiagnosisResponse.model_validate(dict(row))


def _to_fee_schedule(row: asyncpg.Record) -> FeeScheduleResponse:
    return FeeScheduleResponse.model_validate(dict(row))


def _to_drug(row: asyncpg.Record) -> DrugResponse:
    return DrugResponse.model_validate(dict(row))


async def create_department(sub: UUID, payload: DepartmentCreate) -> DepartmentResponse:
    row = await db.insert_department(
        sub, code=payload.code, name=payload.name, description=payload.description
    )
    return _to_department(row)


async def update_department(
    sub: UUID, department_id: UUID, payload: DepartmentUpdate
) -> DepartmentResponse:
    row = await db.update_department(
        sub, department_id, name=payload.name, description=payload.description
    )
    return _to_department(row)


async def set_department_active(
    sub: UUID, department_id: UUID, *, is_active: bool
) -> DepartmentResponse:
    row = await db.set_department_active(sub, department_id, is_active=is_active)
    return _to_department(row)


async def count_department_dependents(
    sub: UUID, department_id: UUID
) -> DepartmentDependents:
    """진료과 의존성 카운트(AC4) — 비활성 경고용 활성 진료실·재직 직원 수."""
    counts = await db.count_department_dependents(sub, department_id)
    return DepartmentDependents(rooms=counts["rooms"], staff=counts["staff"])


async def create_room(sub: UUID, payload: RoomCreate) -> RoomResponse:
    row = await db.insert_room(
        sub, code=payload.code, name=payload.name, department_id=payload.department_id
    )
    return _to_room(row)


async def update_room(sub: UUID, room_id: UUID, payload: RoomUpdate) -> RoomResponse:
    row = await db.update_room(
        sub, room_id, name=payload.name, department_id=payload.department_id
    )
    return _to_room(row)


async def set_room_active(sub: UUID, room_id: UUID, *, is_active: bool) -> RoomResponse:
    row = await db.set_room_active(sub, room_id, is_active=is_active)
    return _to_room(row)


# ── 코드 마스터(KCD 진단·EDI 수가·약품) — Story 2.2 ──────────────────────────────


async def create_diagnosis(sub: UUID, payload: DiagnosisCreate) -> DiagnosisResponse:
    row = await db.insert_diagnosis(
        sub,
        code=payload.code,
        name=payload.name,
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
    )
    return _to_diagnosis(row)


async def update_diagnosis(
    sub: UUID, diagnosis_id: UUID, payload: DiagnosisUpdate
) -> DiagnosisResponse:
    row = await db.update_diagnosis(
        sub,
        diagnosis_id,
        name=payload.name,
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
    )
    return _to_diagnosis(row)


async def set_diagnosis_active(
    sub: UUID, diagnosis_id: UUID, *, is_active: bool
) -> DiagnosisResponse:
    row = await db.set_diagnosis_active(sub, diagnosis_id, is_active=is_active)
    return _to_diagnosis(row)


async def create_fee_schedule(sub: UUID, payload: FeeScheduleCreate) -> FeeScheduleResponse:
    row = await db.insert_fee_schedule(
        sub,
        code=payload.code,
        name=payload.name,
        amount_krw=payload.amount_krw,
        category=payload.category,
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
    )
    return _to_fee_schedule(row)


async def update_fee_schedule(
    sub: UUID, fee_schedule_id: UUID, payload: FeeScheduleUpdate
) -> FeeScheduleResponse:
    row = await db.update_fee_schedule(
        sub,
        fee_schedule_id,
        name=payload.name,
        amount_krw=payload.amount_krw,
        category=payload.category,
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
    )
    return _to_fee_schedule(row)


async def set_fee_schedule_active(
    sub: UUID, fee_schedule_id: UUID, *, is_active: bool
) -> FeeScheduleResponse:
    row = await db.set_fee_schedule_active(sub, fee_schedule_id, is_active=is_active)
    return _to_fee_schedule(row)


async def create_drug(sub: UUID, payload: DrugCreate) -> DrugResponse:
    row = await db.insert_drug(
        sub,
        code=payload.code,
        name=payload.name,
        ingredient_code=payload.ingredient_code,
        unit=payload.unit,
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
    )
    return _to_drug(row)


async def update_drug(sub: UUID, drug_id: UUID, payload: DrugUpdate) -> DrugResponse:
    row = await db.update_drug(
        sub,
        drug_id,
        name=payload.name,
        ingredient_code=payload.ingredient_code,
        unit=payload.unit,
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
    )
    return _to_drug(row)


async def set_drug_active(sub: UUID, drug_id: UUID, *, is_active: bool) -> DrugResponse:
    row = await db.set_drug_active(sub, drug_id, is_active=is_active)
    return _to_drug(row)
