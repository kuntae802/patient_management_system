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
from uuid import UUID

from pydantic import BaseModel, ConfigDict


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
