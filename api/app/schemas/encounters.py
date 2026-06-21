"""내원(encounters) 스키마(Pydantic) — web 타입의 거울. 전 필드 snake_case(camelCase 변환 금지).

생성 요청(walk-in)은 patient_id·department_id(+선택 room_id)만 받는다 — encounter_no·status·
visit_type·전이 타임스탬프는 **DB·서버 소유**(클라 입력 금지). walk-in 생성이라 visit_type 은 서버가
'walk_in' 고정. 응답은 0010 전 컬럼(비-PII: patient_id=FK·encounter_no=사람용 번호 → 마스킹 불요).
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
    created_by: UUID | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
