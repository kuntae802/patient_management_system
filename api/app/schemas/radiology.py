"""방사선(radiology) 스키마 — 촬영 워크리스트·장비·촬영 영상·수행 요청(Story 5.8 / FR-100·101·103).

전 필드 snake_case(DB/JSON 일관 — TS 도 동일 유지). from_attributes=True(asyncpg dict 매핑).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StringConstraints


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


class ReadingWorklistItem(BaseModel):
    """판독 워크리스트 1행(FR-102) — 오늘 활성 내원의 미판독 영상검사(imaging·performed).

    게이트 examination.complete(판독의 겸임). 비-PII(resident_no 제외). RadiologyWorklistItem 미러 +
    수행자명·수행 시각(촬영 추적 라인). image_count=판독 근거 영상 수.
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
    performed_by_name: str | None = None
    performed_at: datetime | None = None
    image_count: int


class CompleteExaminationBody(BaseModel):
    """판독 완료 요청(FR-102) — 소견(필수·non-blank) + 결론(선택). 전이는 서버/DB 가 강제.

    findings = strip 후 빈/공백-only → 서비스가 422 findings_required(5.8 image_required 형제 코드·
    클라 disable 1차선·DB CHECK 최종선). max_length=DoS 가드. reading_conclusion = 선택(서비스가
    strip 후 빈 문자열 → NULL 정규화). 길이 상한 외 구조 검증은 Pydantic, 공백 의미 판정은 서비스.
    """

    findings: Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)]
    reading_conclusion: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] | None
    ) = None
