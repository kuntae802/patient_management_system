"""오더(orders) 스키마(Pydantic) — web 타입의 거울. 전 필드 snake_case(camelCase 변환 금지).

처방전 발행(Story 5.2) = 헤더 + 1:N 상세를 한 요청에 받는다(처방전 = 함께 발행되는 단위). 약품은
`drug_id`(약품 마스터 FK)로만 — free-text 약품명 차단의 구조적 강제(FR-050). 근거 진단
(`encounter_diagnosis_id`, FR-051)은 선택. status/ordered_at 등은 DB·서버 소유(클라 미수용).

⚠️ dose 는 DB `numeric` 의 거울 = JSON number(float). db.py 가 INSERT 직전 Decimal 로 변환한다
(asyncpg 가 numeric 컬럼에 float 바인딩을 거부 — Decimal 필수). 금액(KRW 정수)과 달리 dose 는
비-화폐라 float 표현으로 충분(DB numeric 이 store of record).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

_Stripped = Annotated[str, StringConstraints(strip_whitespace=True)]


class PrescriptionDetailWrite(BaseModel):
    """처방상세 라인(약품·용량·횟수·일수·용법). 약품만 필수, 나머지는 선택(0015 CHECK 가 null 허용).

    dose/duration_days 는 양수(DB CHECK 거울). frequency/usage_instruction 은 짧은 구조화 텍스트
    (임상 자유 서사 아님 — 감사 마스킹 불요). 빈 문자열은 None 으로 정규화.
    """

    drug_id: UUID
    dose: float | None = Field(default=None, gt=0)
    frequency: _Stripped | None = Field(default=None, max_length=50)
    duration_days: int | None = Field(default=None, gt=0)
    usage_instruction: _Stripped | None = Field(default=None, max_length=200)

    @field_validator("frequency", "usage_instruction", mode="after")
    @classmethod
    def _empty_to_none(cls, v: str | None) -> str | None:
        """빈 옵셔널을 None 으로 정규화(직접 API 호출의 "" 적재 방지, NULL=값없음 일관)."""
        return v or None


class PrescriptionCreate(BaseModel):
    """처방전 발행 요청(Story 5.2, FR-050·FR-051). 헤더(근거 진단) + 상세 라인들을 한 번에 발행.

    details 는 최소 1 라인(빈 처방전 무의미). encounter_diagnosis_id 는 같은 내원 부착 진단(선택).
    """

    encounter_diagnosis_id: UUID | None = None
    details: list[PrescriptionDetailWrite] = Field(min_length=1)


class PrescriptionDetailResponse(BaseModel):
    """처방상세 응답(0015 prescription_details + drugs 마스터 조인). snake_case 유지.

    drug_code·drug_name·ingredient_code 는 약품 마스터 조인 합성(읽기시점). ingredient_code 는 웹의
    동일 성분 중복 경고(FR-052) 비교 키(비차단·클라 측). 행 자체엔 자유텍스트 없음(drug_id=FK).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    prescription_id: UUID
    drug_id: UUID
    drug_code: str
    drug_name: str
    ingredient_code: str | None = None
    dose: float | None = None
    frequency: str | None = None
    duration_days: int | None = None
    usage_instruction: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class PrescriptionResponse(BaseModel):
    """처방전 응답(0015 prescriptions 헤더 + 상세 라인 1:N). snake_case 유지 — camelCase 변환 금지.

    status='issued'(발행). dispensed(원외 약국 발급)는 Epic 7. 처방 내용은 권한 게이트(order.read)로
    보호 — 행엔 자유텍스트 없음(diagnosis_id/drug_id=FK, 감사 마스킹 불요).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    encounter_id: UUID
    encounter_diagnosis_id: UUID | None = None
    status: str
    ordered_by: UUID
    ordered_at: datetime
    dispensed_at: datetime | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    details: list[PrescriptionDetailResponse]


class ExaminationCreate(BaseModel):
    """검사·영상 오더 생성 요청(Story 5.3, FR-060·FR-061). 단건 — 처방의 헤더/상세 1:N 아님.

    exam_type 이 워크리스트 라우팅 분류 축(lab 진단검사 → 간호 / imaging 영상검사 → 방사선, FR-061).
    검사 종류(행위)는 fee_schedule_id(EDI 행위 마스터 FK)로만 — free-text 차단(FR-060). 잘못된
    exam_type 은 Literal 이 422 선차단(DB CHECK 거울).
    """

    exam_type: Literal["lab", "imaging"]
    fee_schedule_id: UUID


class ExaminationResponse(BaseModel):
    """검사·영상 오더 응답(0015 examinations + fee_schedules 마스터 조인). snake_case 유지.

    fee_code·fee_name·fee_category·amount_krw 는 행위 마스터 조인 합성(읽기시점). status='ordered'
    (지시). 수행/판독(performed/completed)·equipment_id 는 5.7/5.8/5.9 가 세팅(본 스토리는 NULL).
    행 자체엔 자유텍스트 없음(FK·짧은 구조화 텍스트 — 감사 마스킹 불요).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    encounter_id: UUID
    exam_type: str
    fee_schedule_id: UUID
    fee_code: str
    fee_name: str
    fee_category: str | None = None
    amount_krw: int
    status: str
    ordered_by: UUID
    ordered_at: datetime
    equipment_id: UUID | None = None
    performed_by: UUID | None = None
    performed_at: datetime | None = None
    completed_by: UUID | None = None
    completed_at: datetime | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
