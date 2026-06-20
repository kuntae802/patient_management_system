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
    DepartmentResponse,
    DepartmentUpdate,
    RoomCreate,
    RoomResponse,
    RoomUpdate,
)


def _to_department(row: asyncpg.Record) -> DepartmentResponse:
    return DepartmentResponse.model_validate(dict(row))


def _to_room(row: asyncpg.Record) -> RoomResponse:
    return RoomResponse.model_validate(dict(row))


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
