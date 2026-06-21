"""환자(patients) 스키마(Pydantic) — web Zod 의 거울. 전 필드 snake_case.

⚠️ PII 경계: 응답 모델은 **`resident_no_masked`(마스킹)만** 담는다 —
`resident_no_enc`(암호문)·`resident_no_hash`(blind index)는 직렬화하지 않는다(클라 노출 금지).
생성 요청은 raw `resident_no` 를 받되 `birth_date`/`sex`는 서버가 검증된 RRN 에서 파생한다
(입력 불일치 제거). 정밀 검증(HARD/SOFT)은 services/rrn — 본 모듈은 형태·길이 + 보험유형 enum 만.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, field_validator

# 앞뒤 공백 제거 문자열 — web Zod `.trim()` 정합 + 직접 API 호출 시 공백 패딩 우회 방지.
_Stripped = Annotated[str, StringConstraints(strip_whitespace=True)]

# 보험유형 — DB CHECK(0009)와 동일 집합. 한국어 표시는 UI 라벨(web).
InsuranceType = Literal["health_insurance", "medical_aid", "auto_insurance", "self_pay"]

# 이메일 형식(dep-free — EmailStr 미도입). web Zod refine 의 거울(빈 값=옵셔널 허용).
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class PatientCreate(BaseModel):
    """환자 생성 요청(원무 직접 등록). resident_no 필수 — birth_date·sex 는 서버가 RRN 에서 파생.

    resident_no 는 하이픈 유/무 모두 허용(서비스가 정규화). 정밀 검증(HARD/SOFT)은 services/rrn 이
    수행하고 실패 시 422(invalid_rrn) — 여기선 길이 가드만(원본 값은 응답·에러에 echo 하지 않는다).
    """

    resident_no: _Stripped = Field(min_length=6, max_length=14)
    name: _Stripped = Field(min_length=1, max_length=100)
    phone: _Stripped | None = Field(default=None, max_length=20)
    address: _Stripped | None = Field(default=None, max_length=300)
    email: _Stripped | None = Field(default=None, max_length=200)
    insurance_type: InsuranceType
    insurance_no: _Stripped | None = Field(default=None, max_length=50)

    @field_validator("phone", "address", "email", "insurance_no", mode="after")
    @classmethod
    def _empty_to_none(cls, v: str | None) -> str | None:
        """빈 옵셔널을 None 으로 정규화 — 직접 API 호출의 ""(빈문자열) 저장 방지(NULL=값없음 일관).

        web 폼은 빈 옵셔널을 제거(toPatientCreatePayload)하나, 서버가 클라에 의존 않도록 방어심층.
        """
        return v or None

    @field_validator("email", mode="after")
    @classmethod
    def _check_email(cls, v: str | None) -> str | None:
        """비어있지 않은 이메일은 형식 검증(빈 값은 옵셔널 허용). 실패 → 422(검증 경계)."""
        if v and not _EMAIL_RE.match(v):
            raise ValueError("이메일 형식이 올바르지 않습니다")
        return v


class PatientResponse(BaseModel):
    """환자 응답 — 마스킹된 주민번호만(raw·암호문·blind index 미포함, PII 경계)."""

    id: UUID
    chart_no: str
    name: str
    birth_date: date
    sex: str
    resident_no_masked: str
    phone: str | None = None
    address: str | None = None
    email: str | None = None
    insurance_type: str
    insurance_no: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class PatientListItem(BaseModel):
    """환자 목록 경량 항목 — 마스킹·식별 최소 필드(검색·확인용, 민감정보 없음)."""

    id: UUID
    chart_no: str
    name: str
    birth_date: date
    sex: str
    resident_no_masked: str
    phone: str | None = None
    is_active: bool
    created_at: datetime


class PatientPageMeta(BaseModel):
    """페이지네이션 메타(아키텍처 §Format Patterns: 목록 = {data, meta:{page,page_size,total}})."""

    page: int
    page_size: int
    total: int


class PatientPage(BaseModel):
    """환자 목록 페이지 봉투."""

    data: list[PatientListItem]
    meta: PatientPageMeta
