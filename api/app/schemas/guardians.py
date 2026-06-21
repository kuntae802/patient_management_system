"""보호자(guardians) 스키마(Pydantic) — web Zod 의 거울. 전 필드 snake_case.

보호자는 환자의 sub-resource(1:N). 주민번호를 수집하지 않으므로 암호화·마스킹 컬럼이 없다
(guardians 는 `_enc`/`_hash` 부재) — 연락처(phone)는 환자 phone 과 동일하게 평문 저장·반환
(reveal 게이트 미적용, '연락처 PII reveal 일관화'는 교차절단 이월). relationship 은 자유텍스트
(enum 미강제 — 실제 가족관계 다양성, glossary). schemas/patients.py 의 _Stripped 정규화 재사용.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.patients import _Stripped


class GuardianCreate(BaseModel):
    """보호자 추가 요청. name·relationship 필수, phone 옵셔널(빈 값→None 정규화)."""

    name: _Stripped = Field(min_length=1, max_length=100)
    relationship: _Stripped = Field(min_length=1, max_length=50)
    phone: _Stripped | None = Field(default=None, max_length=20)

    @field_validator("phone", mode="after")
    @classmethod
    def _empty_to_none(cls, v: str | None) -> str | None:
        """빈 옵셔널 phone 을 None 으로 정규화(직접 API 호출의 "" 저장 방지, NULL=값없음 일관)."""
        return v or None


class GuardianUpdate(GuardianCreate):
    """보호자 수정 요청(PUT 전체 교체) — 추가와 동일 필드(미전송 phone=None=값없음)."""


class GuardianResponse(BaseModel):
    """보호자 응답 — 마스킹·암호 컬럼 없음(주민번호 비수집). 연락처는 평문 반환(환자 phone 동형)."""

    id: UUID
    patient_id: UUID
    name: str
    relationship: str
    phone: str | None = None
    created_at: datetime
    updated_at: datetime
