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

# 혈액형(ABO+Rh) — 폐쇄 어휘. DB 컬럼은 의도적 text(0009) → **앱 계층(Pydantic Literal + web Zod)이
# 강제**(검증 서버 tier 권위, DB CHECK 미도입=마이그레이션 회피). 미상=None/생략.
BloodType = Literal["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"]

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


class PatientSelfLinkRequest(BaseModel):
    """앱 자가가입 본인 연결 요청(Story 3.4, FR-003). 가입(세션 보유) 환자가 입력.

    `resident_no` 는 하이픈 유/무 허용(서비스가 정규화 후 `blind_index` 매칭). 정밀 검증(HARD/SOFT)
    은 services/rrn — 여기선 길이 가드만(원본은 응답·에러에 echo 안 함). `name` 은 사칭 방지 1차선
    (시뮬 시대 — 매칭 행과 성명 일치). 클라가 patient_id/auth_uid 를 제공하지 않는다(세션 uid 스코프
    — 연결 대상은 JWT 주체에서만 도출).
    """

    resident_no: _Stripped = Field(min_length=6, max_length=14)
    name: _Stripped = Field(min_length=1, max_length=100)


class PatientSelfSummary(BaseModel):
    """자가연결 확인 요약(Story 3.4) — 마스킹·식별 최소 필드. 본인 전체 데이터는 Epic 8 포털(RLS).

    임상·연락처·`auth_uid`·`_enc`/`_hash` 미포함(연결 확인에 불요 — PII 경계).
    `PatientListItem` 의 부분집합(생성시각 제외)."""

    id: UUID
    chart_no: str
    name: str
    birth_date: date
    sex: str
    resident_no_masked: str


class PatientClinicalProfileUpdate(BaseModel):
    """임상 프로필 갱신 요청(Story 3.2, FR-004). 5필드 옵셔널 — PUT 전체 교체(미전송=None=값없음).

    `blood_type` 은 폐쇄어휘(BloodType Literal) — 비정상 값은 422. 자유텍스트 4종은 max_length
    가드만. 임상필드는 암호화 대상 아님(평문 저장·반환). web Zod `clinicalProfileSchema` 의 거울.
    """

    blood_type: BloodType | None = None
    allergies: _Stripped | None = Field(default=None, max_length=1000)
    chronic_diseases: _Stripped | None = Field(default=None, max_length=1000)
    medications: _Stripped | None = Field(default=None, max_length=1000)
    notes: _Stripped | None = Field(default=None, max_length=2000)

    @field_validator("allergies", "chronic_diseases", "medications", "notes", mode="after")
    @classmethod
    def _empty_to_none(cls, v: str | None) -> str | None:
        """빈 옵셔널을 None 으로 정규화(직접 API 호출의 "" 저장 방지, NULL=값없음 일관)."""
        return v or None


class PatientResponse(BaseModel):
    """환자 응답(상세) — 마스킹 주민번호 + 임상 프로필(raw·암호문·blind index 미포함, PII 경계).

    임상 5필드(`blood_type`·`allergies`·`chronic_diseases`·`medications`·`notes`)는 Story 3.2 에서
    노출 — 컬럼은 0009 에 존재(전부 nullable). 생성 직후엔 NULL(등록은 임상필드를 받지 않음).
    """

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
    # 임상 프로필(Story 3.2) — 자유텍스트 4종 + 폐쇄어휘 blood_type. 전부 nullable.
    blood_type: str | None = None
    allergies: str | None = None
    chronic_diseases: str | None = None
    medications: str | None = None
    notes: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class PatientRrnReveal(BaseModel):
    """주민번호 reveal 응답(Story 4.5, FR-242) — full RRN(권한 게이트 + 감사 후). 응답 바디 전용.

    ⚠️ 이 값(raw 주민번호)은 응답 바디로만 노출 — 로그·toast·에러봉투에 echo 금지(PII 경계)."""

    resident_no: str


class PatientContactReveal(BaseModel):
    """연락처 reveal 응답(Story 4.5, UX-DR22) — full phone/address/email(권한 게이트 + 감사 후)."""

    phone: str | None = None
    address: str | None = None
    email: str | None = None


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
