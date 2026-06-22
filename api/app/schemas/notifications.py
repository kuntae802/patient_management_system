"""알림(SMS 리마인더) 스키마 — Story 6.6 / FR-014.

⚠️ PII 경계: 응답 모델은 **마스킹 수신처(`recipient_masked`)와 비-식별 `body`만** 담는다 —
원시 전화번호·환자명 필드는 절대 추가하지 않는다(notification_logs 컬럼에도 없음·AC4).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

ReminderKind = Literal["d_minus_3", "d_minus_1"]
NotificationStatus = Literal["simulated", "skipped"]


class ReminderRunSummary(BaseModel):
    """리마인더 디스패치 실행 요약 — 멱등 재실행 시 created 와 duplicate 를 구분 집계(AC2)."""

    as_of: date
    created: int
    duplicate: int
    simulated: int
    skipped: int
    by_kind: dict[str, int]


class NotificationLogResponse(BaseModel):
    """알림 로그 항목 — ⚠️ 원시 phone·patient_name 필드 부재(마스킹 수신처·비-식별 body 만, AC4)."""

    id: UUID
    appointment_id: UUID
    patient_id: UUID
    channel: str
    reminder_kind: ReminderKind
    recipient_masked: str | None = None
    body: str
    status: NotificationStatus
    skip_reason: str | None = None
    appointment_start: datetime
    sent_at: datetime | None = None
    created_at: datetime
