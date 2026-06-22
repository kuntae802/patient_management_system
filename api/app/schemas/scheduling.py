"""근무표·휴진 스키마(Pydantic) — web Zod 의 거울. 전 필드 snake_case.

근무표·휴진엔 불변 `code` 가 없어(masters 와 달리) Update 도 전 필드 교체다. PII 없음(의사
uuid·요일·시각·운영 사유만). `reason` = 저민감 운영 사유(휴가·학회) — 임상/PII 자유텍스트 금지
(0010 cancel_reason 정합). 시간 순서(start<end)는 즉시 검증(422 조기 차단); DB CHECK 가 최종선,
겹침은 DB EXCLUDE(409 schedule_overlap).
"""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

# 앞뒤 공백 제거 문자열 — web Zod `.trim()` 정합(masters._Stripped 동형).
_Stripped = Annotated[str, StringConstraints(strip_whitespace=True)]


class _ScheduleFields(BaseModel):
    """근무표 공용 필드(Create·Update 공유) + 즉시 시간 순서 검증."""

    doctor_id: UUID
    department_id: UUID
    room_id: UUID | None = None
    weekday: int = Field(ge=0, le=6)  # 0=일 .. 6=토 (PG extract(dow) 정합)
    start_time: time
    end_time: time

    @model_validator(mode="after")
    def _check_time_order(self) -> _ScheduleFields:
        if self.end_time <= self.start_time:
            raise ValueError("종료 시각은 시작 시각보다 뒤여야 합니다.")
        return self


class DoctorScheduleCreate(_ScheduleFields):
    """근무표 생성 요청."""


class DoctorScheduleUpdate(_ScheduleFields):
    """근무표 수정 — 불변 code 없음 → 전 필드 교체(doctor 재배정 포함)."""


class DoctorScheduleResponse(BaseModel):
    """근무표 응답(생성·수정·비활성 공용)."""

    id: UUID
    doctor_id: UUID
    department_id: UUID
    room_id: UUID | None = None
    weekday: int
    start_time: time
    end_time: time
    is_active: bool
    created_at: datetime
    updated_at: datetime


class _TimeOffRange(BaseModel):
    """휴진 기간 공용 필드 + 즉시 검증(end > start)."""

    start_at: datetime
    end_at: datetime
    reason: _Stripped | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _check_range(self) -> _TimeOffRange:
        if self.end_at <= self.start_at:
            raise ValueError("종료 시각은 시작 시각보다 뒤여야 합니다.")
        return self


class DoctorTimeOffCreate(_TimeOffRange):
    """휴진·예외 생성 — doctor_id 는 생성 시에만(이후 불변; 변경은 삭제+재생성)."""

    doctor_id: UUID


class DoctorTimeOffUpdate(_TimeOffRange):
    """휴진·예외 수정 — 기간·사유만(doctor 불변)."""


class DoctorTimeOffResponse(BaseModel):
    """휴진·예외 응답(생성·수정·비활성 공용)."""

    id: UUID
    doctor_id: UUID
    start_at: datetime
    end_at: datetime
    reason: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class SchedulingDoctor(BaseModel):
    """근무표 폼·예약 피커용 경량 응답(users RLS self-only → service_role read)."""

    id: UUID
    name: str
    department_id: UUID | None = None


# ── 동적 가용 슬롯 (Story 6.2) ─────────────────────────────────────────────────
# 슬롯 status: available(선택가능)·booked(마감=예약됨)·time_off(휴진)·past(지난 시각).
SlotStatus = Literal["available", "booked", "time_off", "past"]


class Slot(BaseModel):
    """단일 시간 슬롯 — start/end 는 timestamptz(UTC ISO; web 이 Intl ko-KR 로 KST 표시)."""

    start: datetime
    end: datetime
    status: SlotStatus


class SlotGridResponse(BaseModel):
    """의사·날짜(KST)의 가용 슬롯 그리드 응답(근무−휴진−booked예약)."""

    doctor_id: UUID
    date: date
    slot_minutes: int
    slots: list[Slot]


# ── 예약 생성 · 캘린더 (Story 6.3) ─────────────────────────────────────────────


class AppointmentCreate(BaseModel):
    """booking-peek 예약 생성 요청. scheduled_end 는 서버가 +SLOT_MINUTES 로 계산(클라 미신뢰)."""

    department_id: UUID
    doctor_id: UUID
    patient_id: UUID
    scheduled_start: datetime
    note: _Stripped | None = Field(default=None, max_length=500)
    sms_opt_in: bool = False


class SelfAppointmentCreate(BaseModel):
    """환자 본인 예약 생성 요청(Story 6.5). ⚠️ **patient_id 없음** — 서버가 JWT 주체→
    `patients.auth_uid` 로 도출(클라 미수용·세션 uid 스코프). **note 없음** — 운영 텍스트는 직원
    입력(환자 자유텍스트=임상/PII 리스크 제외). scheduled_end 는 서버가 +SLOT_MINUTES 계산."""

    department_id: UUID
    doctor_id: UUID
    scheduled_start: datetime
    sms_opt_in: bool = False


class AppointmentResponse(BaseModel):
    """예약 응답(생성·전이 공용). 전이 타임스탬프(0033)는 해당 전이 시에만 채워짐."""

    id: UUID
    patient_id: UUID
    doctor_id: UUID
    department_id: UUID
    room_id: UUID | None = None
    scheduled_start: datetime
    scheduled_end: datetime
    status: str
    note: str | None = None
    sms_opt_in: bool
    cancel_reason: str | None = None
    cancelled_at: datetime | None = None
    no_show_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime


class AppointmentCancel(BaseModel):
    """예약 취소·노쇼 요청 — 저민감 운영 사유(임상/PII 금지)."""

    reason: _Stripped | None = Field(default=None, max_length=200)


class AppointmentReschedule(BaseModel):
    """예약 변경 요청 — 새 의사·시각(scheduled_end 는 서버가 +SLOT_MINUTES)."""

    doctor_id: UUID
    scheduled_start: datetime


class NoShowStatus(BaseModel):
    """환자 노쇼 상태(Story 6.7·booking-peek 프로액티브 배지용). count=노쇼 횟수·threshold=임계치(앱
    상수)·blocked=초과(count>threshold) 여부. web 이 threshold 를 하드코딩하지 않게 서버가 권위."""

    patient_id: UUID
    no_show_count: int
    threshold: int
    blocked: bool


# ── 휴진 영향 예약 · 변경 통지 (Story 6.8 / FR-016) ────────────────────────────


class AffectedAppointment(BaseModel):
    """휴진 기간에 걸린 영향 예약(항상 booked) — 재배정/취소·안내 대상. patient_name = staff 표시용
    (appointment.read·캘린더 4.3/6.3 선례)·주민번호/연락처 미포함."""

    id: UUID
    patient_id: UUID
    patient_name: str
    doctor_id: UUID
    department_id: UUID
    scheduled_start: datetime
    scheduled_end: datetime
    status: str


class ChangeNoticeRequest(BaseModel):
    """변경 통지 기록 요청 — 재배정(reschedule_notice) 또는 취소(cancellation_notice) 안내 종류."""

    kind: Literal["reschedule_notice", "cancellation_notice"]


# 캘린더 슬롯 상태 = 가용(available/time_off/past) + 예약 overlay(confirmed/완료/노쇼/취소).
CalendarSlotStatus = Literal[
    "available", "confirmed", "completed", "no_show", "cancelled", "time_off", "past"
]


class CalendarSlot(BaseModel):
    """캘린더 1슬롯 — 가용/예약 합성. patient_name·appointment_id 는 예약 overlay 시에만."""

    start: datetime
    end: datetime
    status: CalendarSlotStatus
    patient_name: str | None = None
    appointment_id: UUID | None = None


class DoctorColumn(BaseModel):
    """캘린더 의사 열 — 의사 1명의 하루 슬롯."""

    doctor_id: UUID
    doctor_name: str
    slots: list[CalendarSlot]


class CalendarResponse(BaseModel):
    """진료과·날짜(KST)의 예약 캘린더(시간레일 × 의사 열·일 보기)."""

    date: date
    slot_minutes: int
    doctors: list[DoctorColumn]
