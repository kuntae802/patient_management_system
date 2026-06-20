"""진료과·진료실 마스터 스키마(Pydantic) — web Zod 의 거울. 전 필드 snake_case.

마스터에 PII 없음(코드·명칭만). `code` 는 식별 코드 값이라 **생성 후 불변**(Update 에 미포함).
`code` 컬럼은 데이터 값(코드 식별자)이라 영문 권장하되 엄격 정규식은 강제하지 않는다(trim·길이만).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

# 앞뒤 공백 제거 문자열 — web Zod `.trim()` 정합 + 직접 API 호출 시 공백 패딩의 unique 우회 방지.
_Stripped = Annotated[str, StringConstraints(strip_whitespace=True)]


class DepartmentCreate(BaseModel):
    """진료과 생성 요청. code 는 생성 시에만 지정(이후 불변)."""

    code: _Stripped = Field(min_length=1, max_length=50)
    name: _Stripped = Field(min_length=1, max_length=100)
    description: _Stripped | None = Field(default=None, max_length=500)


class DepartmentUpdate(BaseModel):
    """진료과 수정 — code 불변(식별 코드), name·description 만 갱신."""

    name: _Stripped = Field(min_length=1, max_length=100)
    description: _Stripped | None = Field(default=None, max_length=500)


class DepartmentResponse(BaseModel):
    """진료과 응답(생성·수정·비활성 공용)."""

    id: UUID
    code: str
    name: str
    description: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class RoomCreate(BaseModel):
    """진료실 생성 요청. department_id 는 선택(특정 진료과 소속)."""

    code: _Stripped = Field(min_length=1, max_length=50)
    name: _Stripped = Field(min_length=1, max_length=100)
    department_id: UUID | None = None


class RoomUpdate(BaseModel):
    """진료실 수정 — code 불변. name·department_id 갱신(department_id=null → 소속 해제)."""

    name: _Stripped = Field(min_length=1, max_length=100)
    department_id: UUID | None = None


class RoomResponse(BaseModel):
    """진료실 응답(생성·수정·비활성 공용)."""

    id: UUID
    code: str
    name: str
    department_id: UUID | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ActiveUpdate(BaseModel):
    """활성/비활성(soft delete) 토글 — 진료과·진료실 공용."""

    is_active: bool
