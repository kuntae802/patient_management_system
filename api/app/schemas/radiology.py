"""방사선(radiology) 스키마 — 촬영 워크리스트·장비·촬영 영상·수행 요청(Story 5.8 / FR-100·101·103).

전 필드 snake_case(DB/JSON 일관 — TS 도 동일 유지). from_attributes=True(asyncpg dict 매핑).
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class RadiologyWorklistItem(BaseModel):
    """촬영 워크리스트 1행(FR-100) — 오늘 활성 내원의 미수행 영상검사 + 조인 + 업로드 영상 수.

    게이트 examination.perform. 비-PII 투영(resident_no 제외). image_count=업로드 누적.
    """

    model_config = ConfigDict(from_attributes=True)

    examination_id: UUID
    encounter_id: UUID
    chart_no: str
    patient_name: str
    department_name: str
    fee_name: str
    status: str
    ordered_by_name: str | None = None
    ordered_at: datetime
    image_count: int


class EquipmentResponse(BaseModel):
    """장비 1행(FR-103) — 코드·표시명·양식·상태(available/in_use/maintenance). 읽기 전용 표시."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name: str
    modality: str | None = None
    status: str
    is_active: bool


class ExaminationImageResponse(BaseModel):
    """촬영 영상 1건(FR-101) — 메타 + 서버 발급 단기 서명 URL. storage_path 는 비노출(서명 URL만).

    signed_url 은 조회 시점 재생성(DB 미저장 — architecture.md:217). 5.9 판독의도 동일 응답 소비.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    examination_id: UUID
    content_type: str
    file_size: int | None = None
    uploaded_by: UUID
    uploaded_by_name: str | None = None
    uploaded_at: datetime
    signed_url: str


class PerformExaminationBody(BaseModel):
    """촬영 수행 요청(FR-101) — 배정 장비(선택). 영상≥1·상태 전이는 서버/DB 가 강제."""

    equipment_id: UUID | None = None
