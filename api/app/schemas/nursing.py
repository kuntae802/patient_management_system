"""간호(nursing) 스키마(Pydantic) — web 타입의 거울. 전 필드 snake_case(camelCase 변환 금지).

활력징후 기록(Story 5.6, FR-091) = 혈압(수축기/이완기)·맥박·체온·호흡수·SpO2. 항목별 선택 입력
(부분 측정 허용·실제 임상) + **최소 1개 측정값 강제**(전부 None = 422). recorded_by/recorded_at
등은 DB·서버 소유(클라 미수용). DB CHECK(0017 vital_signs_at_least_one)가 최종선, 본 model_validator
가 서버 2차선, 클라 Zod 가 1차선(3중 방어 — 처방 details min_length=1 패턴 동형).

⚠️ body_temp 는 DB `numeric(4,1)` 거울 = JSON number(float). db.py 가 INSERT 직전 Decimal 로 변환
(asyncpg 가 numeric 에 float 바인딩 거부 — orders.dose 자세). Field 범위 = 입력 합리성(DB 물리
CHECK 보다 좁은 임상 경계는 표시 레이어 isAbnormal 소관 — 본 검증은 "측정 가능치"만 거른다).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

_Stripped = Annotated[str, StringConstraints(strip_whitespace=True)]

# 활력 수치 필드명(최소-1개 검증·빈값 판정 공유 — 스키마와 검증의 단일 진실).
_VITAL_FIELDS = ("systolic", "diastolic", "pulse", "body_temp", "respiratory_rate", "spo2")


class VitalSignsCreate(BaseModel):
    """활력징후 기록 요청(Story 5.6, FR-091). 6 항목 전부 선택(부분 측정) + 최소 1개 강제.

    Field 범위 = 입력 합리성(DB CHECK 거울·다소 좁게). notes 는 짧은 임상 메모(PII 금지).
    recorded_by/recorded_at 는 서버가 토큰 주체·now() 로 세팅(클라 미수용).
    """

    systolic: int | None = Field(default=None, ge=50, le=300)
    diastolic: int | None = Field(default=None, ge=20, le=200)
    pulse: int | None = Field(default=None, ge=20, le=300)
    body_temp: float | None = Field(default=None, ge=30.0, le=45.0)
    respiratory_rate: int | None = Field(default=None, ge=4, le=80)
    spo2: int | None = Field(default=None, ge=50, le=100)
    notes: _Stripped | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _at_least_one_vital(self) -> VitalSignsCreate:
        """6 측정값 중 최소 1개 not-null 강제(빈 활력 기록 차단 — 서버 2차선). 미충족 → 422."""
        if all(getattr(self, f) is None for f in _VITAL_FIELDS):
            raise ValueError("활력징후를 최소 1개 이상 입력해야 합니다.")
        return self

    @model_validator(mode="after")
    def _empty_notes_to_none(self) -> VitalSignsCreate:
        """빈 notes 를 None 으로 정규화(직접 API 의 "" 적재 방지, NULL=값없음 일관)."""
        if not self.notes:
            self.notes = None
        return self


class VitalSignsResponse(BaseModel):
    """활력징후 응답(0017 vital_signs + users 조인). snake_case 유지 — camelCase 변환 금지.

    recorded_by_name 은 users 조인 합성(측정자 표시, 진료 허브 좌 패널 FR-032). 수치·FK·timestamp =
    구조화 데이터(감사 마스킹 불요). notes 는 짧은 활력 메모(PII 금지 전제 — 마스킹 미적용).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    encounter_id: UUID
    systolic: int | None = None
    diastolic: int | None = None
    pulse: int | None = None
    body_temp: float | None = None
    respiratory_rate: int | None = None
    spo2: int | None = None
    notes: str | None = None
    recorded_by: UUID
    recorded_by_name: str | None = None  # users 조인(측정자)
    recorded_at: datetime
    is_active: bool
    created_at: datetime
    updated_at: datetime


class VitalsWorklistItem(BaseModel):
    """활력 워크리스트 1행(Story 5.6 AC3) — 오늘 활성 내원(registered·in_progress) + patients·dept
    조인 + 최근 활력 시각. 게이트 vital.record(간호 진입). 민감컬럼(resident_no 등) 미투영 = 비-PII.

    latest_vital_recorded_at = 해당 내원의 최근 활력 기록 시각(없으면 None) — "이미 측정함" 신호.
    """

    model_config = ConfigDict(from_attributes=True)

    encounter_id: UUID
    chart_no: str
    patient_name: str
    department_name: str
    status: str
    created_at: datetime
    latest_vital_recorded_at: datetime | None = None


# ── 처치 수행·일상 간호기록(Story 5.7 / FR-090·FR-092·FR-093·FR-094) ──────────────────
# 처치 수행 = perform_treatment_order RPC(ordered→performed·재수행 차단). 수행 시 처치기록
# 내용(content) 첨부 = 선택(연결 nursing_record). 일상 간호기록 = 오더 없음(treatment_order_id
# NULL). content = 자유 임상 서사(감사 마스킹) — 빈/공백 차단(클라·Pydantic·DB CHECK 3중).

# 간호기록 본문 — 빈/공백 차단(strip 후 1자 이상) + 상한(자유 서사 합리적 한도, max_length).
_NursingContent = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
]


class TreatmentPerformBody(BaseModel):
    """처치 오더 수행 요청(Story 5.7 AC1, FR-092). content = 처치기록 내용(선택).

    수행자·시각은 RPC 가 항상 기록(performed_by/performed_at). content 입력 시 해당 오더에 연결된
    nursing_record(treatment_order_id 부착)를 같은 액션에서 생성(사용자 확정: content 선택 입력).
    빈/공백 content 는 None 정규화(연결 기록 미생성).
    """

    content: _Stripped | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _empty_content_to_none(self) -> TreatmentPerformBody:
        """빈/공백 content 를 None 으로 정규화(연결 nursing_record 미생성 — 수행만)."""
        if not self.content:
            self.content = None
        return self


class NursingRecordCreate(BaseModel):
    """일상 간호기록 생성 요청(Story 5.7 AC3, FR-094). 오더 없음 — content 만(필수·빈값 차단).

    treatment_order_id 는 클라 미수용(일상 기록 = NULL 고정 — 오더 연결은 처치 수행 액션이 소유).
    content 는 strip 후 min_length=1(빈/공백 422). DB CHECK(content_not_blank) 최종선.
    """

    content: _NursingContent


class NursingRecordResponse(BaseModel):
    """간호기록 응답(0018 nursing_record + users 조인). snake_case 유지 — camelCase 변환 금지.

    treatment_order_id = 처치 수행 연결(있으면) / 일상 기록(None). content = 자유 임상 서사(마스킹).
    recorded_by_name = users 조인(기록자 표시).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    encounter_id: UUID
    treatment_order_id: UUID | None = None
    content: str
    recorded_by: UUID
    recorded_by_name: str | None = None  # users 조인(기록자)
    recorded_at: datetime
    is_active: bool
    created_at: datetime
    updated_at: datetime


class NursingWorklistItem(BaseModel):
    """간호 워크리스트 1행(Story 5.7) — 오늘 활성 내원 + patients·dept 조인 + 처치·간호기록 건수.

    게이트 require_any(treatment.perform ∨ nursing.record). 비-PII 투영. /nurse/worklist=
    pending_treatment_count>0 강조 · /nurse/notes=전체.
    """

    model_config = ConfigDict(from_attributes=True)

    encounter_id: UUID
    chart_no: str
    patient_name: str
    department_name: str
    status: str
    created_at: datetime
    pending_treatment_count: int
    oldest_pending_ordered_at: datetime | None = None  # 지연 디텍터(UX-DR21 ⑥)
    nursing_record_count: int
