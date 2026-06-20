"""진료과·진료실 마스터 스키마(Pydantic) — web Zod 의 거울. 전 필드 snake_case.

마스터에 PII 없음(코드·명칭만). `code` 는 식별 코드 값이라 **생성 후 불변**(Update 에 미포함).
`code` 컬럼은 데이터 값(코드 식별자)이라 영문 권장하되 엄격 정규식은 강제하지 않는다(trim·길이만).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

# 앞뒤 공백 제거 문자열 — web Zod `.trim()` 정합 + 직접 API 호출 시 공백 패딩의 unique 우회 방지.
_Stripped = Annotated[str, StringConstraints(strip_whitespace=True)]

# PG `integer`(amount_krw 컬럼) 상한. 초과 입력은 422(검증)로 차단 — 미차단 시 asyncpg 오버플로가
# _run_authed 에서 503(ServiceUnavailable)으로 오인 매핑됨(사용자 입력 오류인데 일시장애로 표시).
_AMOUNT_MAX = 2_147_483_647


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
    """활성/비활성(soft delete) 토글 — 진료과·진료실·코드 마스터 3종 공용."""

    is_active: bool


class DepartmentDependents(BaseModel):
    """진료과 비활성 전 의존성 카운트(Story 2.4 / AC4) — 운영상 살아있는 참조 수.

    rooms = 활성 진료실, staff = 재직 직원(active + on_leave — 퇴사자만 제외). 비활성 처리를
    막지 않는 **경고용** 보조 정보다(soft delete 는 참조 중에도 가능, 과거 기록 보존). 직원 수는
    users RLS(본인행) 때문에 클라가 못 세므로 service_role 엔드포인트가 센다.
    """

    rooms: int
    staff: int


# ── 코드 마스터(KCD 진단·EDI 수가·약품) — 버전·유효기간(발효/만료), Story 2.2 / FR-201 ────────
# code 는 생성 후 불변(Update 미포함, 2.1 관례). 유효기간 = effective_from(발효)·effective_to(만료).
# effective_to=null 은 무기한. "현재 유효" 필터는 소비처(2.3 피커)가 적용; 이 모듈은 검증·매핑만.


class _EffectiveRange(BaseModel):
    """발효/만료 유효기간 공용 필드 + 즉시 검증(만료 ≥ 발효). DB CHECK 가 최종선(422 조기 차단)."""

    effective_from: date
    effective_to: date | None = None

    @model_validator(mode="after")
    def _check_range(self) -> _EffectiveRange:
        if self.effective_to is not None and self.effective_to < self.effective_from:
            raise ValueError("만료일은 발효일보다 빠를 수 없습니다.")
        return self


class DiagnosisCreate(_EffectiveRange):
    """KCD 진단 생성 — code 는 생성 시에만(이후 불변)."""

    code: _Stripped = Field(min_length=1, max_length=20)
    name: _Stripped = Field(min_length=1, max_length=200)


class DiagnosisUpdate(_EffectiveRange):
    """KCD 진단 수정 — code 불변, name·유효기간 갱신."""

    name: _Stripped = Field(min_length=1, max_length=200)


class DiagnosisResponse(BaseModel):
    """KCD 진단 응답(생성·수정·비활성 공용)."""

    id: UUID
    code: str
    name: str
    effective_from: date
    effective_to: date | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class FeeScheduleCreate(_EffectiveRange):
    """EDI 수가 생성 — amount_krw 는 KRW 정수(음수 불가)."""

    code: _Stripped = Field(min_length=1, max_length=20)
    name: _Stripped = Field(min_length=1, max_length=200)
    amount_krw: int = Field(ge=0, le=_AMOUNT_MAX)
    category: _Stripped | None = Field(default=None, max_length=100)


class FeeScheduleUpdate(_EffectiveRange):
    """EDI 수가 수정 — code 불변, name·amount_krw·category·유효기간 갱신."""

    name: _Stripped = Field(min_length=1, max_length=200)
    amount_krw: int = Field(ge=0, le=_AMOUNT_MAX)
    category: _Stripped | None = Field(default=None, max_length=100)


class FeeScheduleResponse(BaseModel):
    """EDI 수가 응답(생성·수정·비활성 공용)."""

    id: UUID
    code: str
    name: str
    amount_krw: int
    category: str | None = None
    effective_from: date
    effective_to: date | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class DrugCreate(_EffectiveRange):
    """약품 생성 — ingredient_code(주성분코드)·unit(단위)은 선택."""

    code: _Stripped = Field(min_length=1, max_length=20)
    name: _Stripped = Field(min_length=1, max_length=200)
    ingredient_code: _Stripped | None = Field(default=None, max_length=20)
    unit: _Stripped | None = Field(default=None, max_length=20)


class DrugUpdate(_EffectiveRange):
    """약품 수정 — code 불변, name·주성분·단위·유효기간 갱신."""

    name: _Stripped = Field(min_length=1, max_length=200)
    ingredient_code: _Stripped | None = Field(default=None, max_length=20)
    unit: _Stripped | None = Field(default=None, max_length=20)


class DrugResponse(BaseModel):
    """약품 응답(생성·수정·비활성 공용)."""

    id: UUID
    code: str
    name: str
    ingredient_code: str | None = None
    unit: str | None = None
    effective_from: date
    effective_to: date | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
