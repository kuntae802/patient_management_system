"""오더(orders) 스키마(Pydantic) — web 타입의 거울. 전 필드 snake_case(camelCase 변환 금지).

처방전 발행(Story 5.2) = 헤더 + 1:N 상세를 한 요청에 받는다(처방전 = 함께 발행되는 단위). 약품은
`drug_id`(약품 마스터 FK)로만 — free-text 약품명 차단의 구조적 강제(FR-050). 근거 진단
(`encounter_diagnosis_id`, FR-051)은 선택. status/ordered_at 등은 DB·서버 소유(클라 미수용).

⚠️ dose 는 DB `numeric` 의 거울 = JSON number(float). db.py 가 INSERT 직전 Decimal 로 변환한다
(asyncpg 가 numeric 컬럼에 float 바인딩을 거부 — Decimal 필수). 금액(KRW 정수)과 달리 dose 는
비-화폐라 float 표현으로 충분(DB numeric 이 store of record).
"""

from __future__ import annotations

from datetime import date, datetime
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
    # 알레르기 오버라이드 사유(UX-DR21②, 5.5) — conflict 라인에만 적용. 자유텍스트(감사 마스킹).
    allergy_override_reason: _Stripped | None = Field(default=None, max_length=500)

    @field_validator("frequency", "usage_instruction", "allergy_override_reason", mode="after")
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
    동일 성분 중복 경고(FR-052) 비교 키(비차단·클라 측). coverage_type(급여/비급여, 5.5) = pay-chip.
    행 자체엔 자유텍스트 없음(drug_id=FK). ⚠️ allergy_override_reason 은 응답 미노출(쓰기·감사 전용).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    prescription_id: UUID
    drug_id: UUID
    drug_code: str
    drug_name: str
    ingredient_code: str | None = None
    coverage_type: str
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
    ordered_by_name: str | None = None  # users 조인(추적 라인 지시자, 5.5)
    ordered_at: datetime
    dispensed_at: datetime | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    details: list[PrescriptionDetailResponse]


# ── 원외처방전 문서(Story 7.7·FR-115) — 발급·출력용 조립 데이터(전 필드 snake_case) ─────────
# 처방전은 payment 스코프가 아니라 prescription 스코프(영수증 7.5/세부내역서 7.6 와 근본 차이).
# 요양기관·환자(masked RRN)·진료과/담당의 + 처방 1:N(면허·근거 진단 KCD·약품 라인). 약가 없음.


class PrescriptionDocumentClinic(BaseModel):
    """원외처방전 요양기관 정보(0049 clinic_profile 거울 — 7.5 영수증과 동일 shape·재사용)."""

    name: str
    biz_no: str
    hira_no: str  # 요양기관기호
    address: str
    ceo_name: str
    phone: str


class PrescriptionDocumentPatient(BaseModel):
    """원외처방전 환자 정보 — 주민번호 masked 만(full reveal 이월). 생년월일·성별=통상 표기."""

    name: str
    chart_no: str
    resident_no_masked: str
    insurance_type: str
    birth_date: date | None = None
    sex: str | None = None


class PrescriptionDocumentEncounter(BaseModel):
    """원외처방전 진료 정보 — 진료과·담당의(내원 doctor_id·미배정 시 None)."""

    department_name: str
    doctor_name: str | None = None


class PrescriptionDocumentPrescriber(BaseModel):
    """처방 의료인 — 성명·면허종류·면허번호(0002 users.license_type/license_no·법정 서식 필수)."""

    name: str | None = None
    license_type: str | None = None
    license_no: str | None = None


class PrescriptionDocumentDiagnosis(BaseModel):
    """근거 진단(질병분류기호·FR-051) — KCD code/name. 근거 진단 없으면 항목 None."""

    code: str
    name: str


class PrescriptionDocumentDrug(BaseModel):
    """처방 의약품 라인 — 약품명·코드·단위(drugs 조인) + 용량·횟수·일수·용법(FR-050). 약가 없음."""

    drug_code: str
    drug_name: str
    drug_unit: str | None = None  # 1회 투약량 단위(예 정·mg)
    dose: float | None = None  # 1회 투약량(numeric → float)
    frequency: str | None = None  # 1일 투여횟수(예 'TID')
    duration_days: int | None = None  # 총 투여일수
    usage_instruction: str | None = None  # 용법(식후/식전 등)


class PrescriptionDocumentItem(BaseModel):
    """원외처방전 1매(처방 1건) — 발행/발급 상태·발행일/발급일·발행의·근거 진단·의약품 라인."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    status: str  # issued(발행) / dispensed(발급)
    ordered_at: datetime  # 발행일
    dispensed_at: datetime | None = None  # 발급일(미발급 시 None)
    prescriber: PrescriptionDocumentPrescriber
    diagnosis: PrescriptionDocumentDiagnosis | None = None
    drugs: list[PrescriptionDocumentDrug]


class PrescriptionDocumentResponse(BaseModel):
    """원외처방전 문서 데이터(Story 7.7·FR-115) — 한 내원의 발행/발급 처방 전체를 법정 서식 조립.

    payment 무관(finalize 게이트 없음 — 발행 처방이면 출력). 약가 없음(원외처방전 = 약품 목록만).
    PII = masked RRN 만. 처방 0건이면 prescriptions=[](404 아님).
    """

    model_config = ConfigDict(from_attributes=True)

    clinic: PrescriptionDocumentClinic
    patient: PrescriptionDocumentPatient
    encounter: PrescriptionDocumentEncounter
    prescriptions: list[PrescriptionDocumentItem]


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

    fee_code·fee_name·fee_category·amount_krw·coverage_type 는 행위 마스터 조인 합성(읽기시점·5.5
    coverage_type pay-chip). ordered_by_name·performed_by_name 은 users 조인(추적 라인, 5.5).
    status='ordered'(지시). 수행/판독(performed/completed)·equipment_id 는 5.7/5.8/5.9 가 세팅.
    findings·reading_conclusion = 판독 소견·결론(5.9·완료 시 채워짐, 그 전엔 null·자유텍스트 →
    감사 스냅샷 마스킹 대상). 응답 본문 노출은 order.read/examination.complete 게이트 안에서만.
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
    coverage_type: str
    status: str
    ordered_by: UUID
    ordered_by_name: str | None = None
    ordered_at: datetime
    equipment_id: UUID | None = None
    performed_by: UUID | None = None
    performed_by_name: str | None = None
    performed_at: datetime | None = None
    completed_by: UUID | None = None
    completed_at: datetime | None = None
    findings: str | None = None
    reading_conclusion: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class TreatmentOrderCreate(BaseModel):
    """처치 오더 생성 요청(Story 5.4, FR-070). 단건 — exam_type 분류 축 없음(간호 단일 라우팅).

    처치 행위는 fee_schedule_id(EDI 처치 행위 마스터 FK)로만 — free-text 차단. 1 POST = 1 처치 오더.
    """

    fee_schedule_id: UUID


class TreatmentOrderResponse(BaseModel):
    """처치 오더 응답(0015 treatment_orders + fee_schedules 마스터 조인). snake_case 유지.

    fee_code·fee_name·fee_category·amount_krw·coverage_type 는 행위 마스터 조인 합성(5.5 pay-chip).
    ordered_by_name·performed_by_name 은 users 조인(추적 라인, 5.5). status='ordered'(지시). 수행
    (performed)은 5.7 이 세팅(본 스토리는 NULL). ⚠️ 검사와 달리 exam_type·equipment_id·completed_*
    없음(treatment_orders 미보유). 행 자체엔 자유텍스트 없음(감사 마스킹 불요).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    encounter_id: UUID
    fee_schedule_id: UUID
    fee_code: str
    fee_name: str
    fee_category: str | None = None
    amount_krw: int
    coverage_type: str
    status: str
    ordered_by: UUID
    ordered_by_name: str | None = None
    ordered_at: datetime
    performed_by: UUID | None = None
    performed_by_name: str | None = None
    performed_at: datetime | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
