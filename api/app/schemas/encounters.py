"""내원(encounters) 스키마(Pydantic) — web 타입의 거울. 전 필드 snake_case(camelCase 변환 금지).

생성 요청(walk-in)은 patient_id·department_id(+선택 room_id)만 받는다 — encounter_no·status·
visit_type·전이 타임스탬프는 **DB·서버 소유**(클라 입력 금지). walk-in 생성이라 visit_type 은 서버가
'walk_in' 고정. 응답은 0010·0011 전 컬럼(비-PII: patient_id=FK·encounter_no=사람용 번호).

대기 현황판(Story 4.3)은 EncounterListItem(내원 + 호출 상태 + denormalized 표시 필드 조인)을
{data, meta} 페이지로 반환한다 — 보드 행 렌더용(환자명·차트번호·진료과명·진료실·담당의). raw RRN/
연락처는 투영하지 않는다(UX-DR22 — 실시간 select-list 민감 컬럼 제외).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

_Stripped = Annotated[str, StringConstraints(strip_whitespace=True)]


class EncounterCreate(BaseModel):
    """walk-in 내원 생성 요청. status/visit_type/encounter_no 는 서버·DB 소유(클라 미수용)."""

    patient_id: UUID
    department_id: UUID
    room_id: UUID | None = None  # 선택(미배정 허용 — 진료실/담당의 배정은 4.4/현황판)


class EncounterResponse(BaseModel):
    """내원 응답(0010 전 컬럼). snake_case 유지 — camelCase 변환 금지(project-context)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    encounter_no: str
    patient_id: UUID
    department_id: UUID
    room_id: UUID | None = None
    doctor_id: UUID | None = None
    visit_type: str
    status: str
    cancel_reason: str | None = None
    registered_at: datetime | None = None
    consult_started_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None
    no_show_at: datetime | None = None
    # 호출 상태(0011 — 비-상태 마커, 호출은 전이 아님). 호출 액션 응답이 기록 결과를 반영.
    called_at: datetime | None = None
    call_count: int = 0
    last_called_by: UUID | None = None
    created_by: UUID | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class EncounterListItem(BaseModel):
    """대기 현황판 행(Story 4.3) — 내원 본문(0010) + 호출 상태(0011) + denormalized 표시 필드(조인).

    표시 필드(patient_name·chart_no·department_name·room_name·doctor_name)는 보드 렌더용 조인 결과.
    raw RRN/연락처는 투영하지 않는다(비-PII 보장). snake_case 유지.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    encounter_no: str
    patient_id: UUID
    department_id: UUID
    room_id: UUID | None = None
    doctor_id: UUID | None = None
    visit_type: str
    status: str
    registered_at: datetime | None = None
    consult_started_at: datetime | None = None
    called_at: datetime | None = None
    call_count: int = 0
    is_active: bool
    created_at: datetime
    # denormalized 표시 필드(조인) — 보드 행 렌더(오환자 방지 식별 단서).
    patient_name: str
    chart_no: str
    department_name: str
    room_name: str | None = None
    doctor_name: str | None = None


class EncounterPageMeta(BaseModel):
    """페이지 메타(목록 표준 봉투 {data, meta} — PatientPageMeta 미러)."""

    page: int
    page_size: int
    total: int


class EncounterPage(BaseModel):
    """대기 현황판 목록 응답 — 필터 적용 행 + 메타."""

    data: list[EncounterListItem]
    meta: EncounterPageMeta


class MedicalRecordWrite(BaseModel):
    """SOAP 진료기록 작성·갱신 요청(Story 4.6, FR-040). POST·PUT 공용 — 4 파트 전체 페이로드.

    S/O/A/P 전부 옵셔널(일부만 채운 기록 허용). 임상 자유텍스트는 암호화 대상 아님(평문 저장)이나,
    감사 스냅샷에선 마스킹된다(services/audit.py `_SENSITIVE_KEY` — 0013 트리거 유입분). web soap
    입력 거울. max_length 는 DoS 상한(임상기록 장문 허용).
    """

    subjective: _Stripped | None = Field(default=None, max_length=20000)
    objective: _Stripped | None = Field(default=None, max_length=20000)
    assessment: _Stripped | None = Field(default=None, max_length=20000)
    plan: _Stripped | None = Field(default=None, max_length=20000)

    @field_validator("subjective", "objective", "assessment", "plan", mode="after")
    @classmethod
    def _empty_to_none(cls, v: str | None) -> str | None:
        """빈 옵셔널을 None 으로 정규화(직접 API 호출의 "" 적재 방지, NULL=값없음 일관)."""
        return v or None


class MedicalRecordResponse(BaseModel):
    """SOAP 진료기록 응답(0013 medical_records 전 컬럼). snake_case 유지 — camelCase 변환 금지.

    임상 텍스트는 reveal 대상이 아니라 권한 게이트(medical_record.read)로 보호된다(비-마스킹 응답).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    encounter_id: UUID
    author_id: UUID
    subjective: str | None = None
    objective: str | None = None
    assessment: str | None = None
    plan: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class DiagnosisAttach(BaseModel):
    """진단 부착 요청(Story 4.7, FR-042). KCD diagnoses 마스터 행을 내원에 부착.

    diagnosis_id 는 마스터 FK(free-text 차단의 구조적 강제 — 클라가 코드 문자열을 임의 입력 못 함).
    is_primary=true 면 기존 활성 주상병을 강등(서버가 동일 트랜잭션). 기본은 부상병(false).
    """

    diagnosis_id: UUID
    is_primary: bool = False


class DiagnosisPrimaryUpdate(BaseModel):
    """주/부상병 토글 요청(Story 4.7). is_primary=true → 기존 주상병 강등 후 이 진단을 주상병."""

    is_primary: bool


class EncounterDiagnosisResponse(BaseModel):
    """내원진단 응답(0014 encounter_diagnoses + diagnoses 마스터 조인). snake_case 유지.

    diagnosis_code·diagnosis_name 은 KCD 마스터 조인 합성(읽기시점). 진단명은 권한 게이트
    (diagnosis.read)로 보호 — 행 자체엔 자유텍스트 없음(diagnosis_id=FK, 감사 마스킹 불요).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    encounter_id: UUID
    diagnosis_id: UUID
    diagnosis_code: str
    diagnosis_name: str
    is_primary: bool
    recorded_by: UUID
    is_active: bool
    created_at: datetime
    updated_at: datetime
