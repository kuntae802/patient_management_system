"""직원 계정 프로비저닝·재직상태 스키마(Pydantic) — web Zod 의 거울. 전 필드 snake_case.

⚠️ 응답에 email/비밀번호를 절대 담지 않는다 — email 은 auth.users 단일소유(이중소유 금지),
   비밀번호는 GoTrue 가 해시 보관(평문 비노출). public.users 에는 두 컬럼 모두 없다.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints

# 면허종류 — 0002 users.license_type CHECK 거울.
LicenseType = Literal["doctor", "radiologist"]
# 재직상태 — 0002 users.employment_status CHECK 거울.
EmploymentStatus = Literal["active", "on_leave", "terminated"]

# 비밀번호 최소 길이 — supabase config.toml `minimum_password_length` 와 정합(이중표준 회피).
_PASSWORD_MIN_LEN = 8
# 이메일 형식 — 가벼운 shape 체크만(조기 UX). 권위는 GoTrue(중복·정밀 검증 → 409/422 봉투).
# EmailStr 미사용: email-validator 가 `.local`(내부망·부트스트랩 도메인)을 special-use 로 거부함.
_EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"

# 앞뒤 공백 제거 문자열 — web Zod `.trim()` 정합 + 직접 API 호출 시 공백 패딩의 unique 우회 방지.
_Stripped = Annotated[str, StringConstraints(strip_whitespace=True)]


class StaffCreate(BaseModel):
    """신규 직원 생성 요청. role_code 는 service 가 staff 5역할로 검증(patient 거부).

    식별자는 `_Stripped`(앞뒤 공백 제거). 비밀번호는 strip 제외 — 로그인 폼이 비-trim 이라 절단 시
    로그인 불일치를 막기 위함.
    """

    employee_no: _Stripped = Field(min_length=1, max_length=50)
    name: _Stripped = Field(min_length=1, max_length=100)
    email: _Stripped = Field(min_length=3, max_length=254, pattern=_EMAIL_PATTERN)
    password: str = Field(min_length=_PASSWORD_MIN_LEN, max_length=72)  # bcrypt 72바이트 상한
    role_code: str = Field(min_length=1)
    license_no: _Stripped | None = Field(default=None, max_length=50)
    license_type: LicenseType | None = None
    phone: _Stripped | None = Field(default=None, max_length=30)
    hire_date: date | None = None
    # 소속 진료과 — 진료과 master(Epic 2) 이전이라 UI 피커 없음. 옵셔널 수용(구조적 충족).
    department_id: UUID | None = None


class EmploymentStatusUpdate(BaseModel):
    """재직상태 전환 요청. active=복귀, on_leave/terminated=접근·로그인 차단."""

    employment_status: EmploymentStatus


class DepartmentAssign(BaseModel):
    """직원 소속 진료과 배정/변경/해제 요청. None = 소속 해제(무소속)."""

    department_id: UUID | None = None


class StaffResponse(BaseModel):
    """직원 프로필 응답(목록·생성 공용). email/비밀번호 미포함."""

    id: UUID
    employee_no: str
    name: str
    role_code: str
    employment_status: EmploymentStatus
    license_no: str | None = None
    license_type: LicenseType | None = None
    phone: str | None = None
    hire_date: date | None = None
    department_id: UUID | None = None
    created_at: datetime
    updated_at: datetime
