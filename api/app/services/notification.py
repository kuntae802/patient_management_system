"""알림(SMS 리마인더) 오케스트레이션 — Story 6.6 / FR-014(이월 갭 ③).

**시뮬 이음매(seam):** 실 SMS 게이트웨이 미연동 — 디스패치는 `notification_logs` 에 발송 이력을
남기는 시뮬로 처리한다(architecture §Integration: notification_service + notification_logs). 운영
전환 시 로그 INSERT 를 실 게이트웨이 호출로 교체하거나, cron 이 `run_appointment_reminders` 를
호출하면 된다(`as_of` 로 "오늘로 가정할 날짜"를 받아 시간 목킹 없이 데모/테스트 가능).

대상 = `status='booked'` ∩ `sms_opt_in=true` ∩ KST일자 ∈ {`as_of+3일`(D-3), `as_of+1일`(D-1)}.
멱등은 DB UNIQUE(appointment_id, reminder_kind)가 보장(재실행 중복 0). PII: 원시 phone 은 마스킹
후에만 로그에 들어가고(`recipient_masked`), body 는 비-식별(환자명·주민번호 금지·AC4). KST=고정 +9.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime, time, timedelta, timezone
from uuid import UUID

from app.core import db
from app.schemas.notifications import NotificationLogResponse, ReminderRunSummary

# KST = 무 DST → 고정 +9 오프셋(zoneinfo/tzdata 의존 회피·6.2 _KST 동형).
_KST = timezone(timedelta(hours=9))
# 리마인더 종류 → 예약 며칠 전(D-N). 병원별 가변 오프셋 설정은 이월(상수 고정).
REMINDER_OFFSETS: dict[str, int] = {"d_minus_3": 3, "d_minus_1": 1}
# 시뮬 발신 병원명(데모용 — 실 연동 시 설정값으로 대체).
_CLINIC_NAME = "한울병원"


def mask_phone(phone: str | None) -> str | None:
    """전화번호 마스킹 — 마지막 4자리만 노출(가운데 가림). `mask_rrn` 선례(부분 노출 최소).

    예: '010-1234-5678'/'01012345678' → '010-****-5678'. None/빈/숫자 4자리 미만 → None
    (발송 불가 → 호출부가 skipped(no_recipient) 처리). 원시 phone 은 로그에 저장되지 않는다(AC4).
    ⚠️ 앞 3자리 prefix 는 **가릴 중간 자리가 남을 때만**(전체 ≥10자리·표준 휴대폰/지역번호) 노출한다
    — 짧은 번호(예 7자리)에서 prefix+last4 가 전체를 재구성하는 PII 누출 방지(아니면 last4 만).
    """
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if len(digits) < 4:
        return None
    last4 = digits[-4:]
    # ≥10자리(휴대폰 11·지역번호 포함 10)면 앞 3 + 가운데 마스킹 + 끝 4(가운데 ≥3자리 가림). 그보다
    # 짧으면 prefix 를 생략해 전체 재구성 차단(끝 4자리만 노출).
    prefix = digits[:3] if len(digits) >= 10 else ""
    return f"{prefix}-****-{last4}" if prefix else f"****-{last4}"


def _format_kst_12h(value: datetime) -> str:
    """timestamptz → KST 비-식별 한국어 12시간 표기('6월 25일 오후 2:30'). locale/ICU 비의존
    (수동 산출 — 6.5 웹 ICU 폴백 교훈)."""
    local = value.astimezone(_KST)
    period = "오전" if local.hour < 12 else "오후"
    hour12 = local.hour % 12 or 12
    return f"{local.month}월 {local.day}일 {period} {hour12}:{local.minute:02d}"


def _build_reminder_body(*, appointment_start: datetime, department_name: str, kind: str) -> str:
    """비-식별 시뮬 SMS 메시지. ⚠️ 환자명·주민번호·연락처 금지(AC4) — 날짜·시각·진료과·병원명만."""
    lead = "3일 전" if kind == "d_minus_3" else "1일 전"
    when = _format_kst_12h(appointment_start)
    return (
        f"[{_CLINIC_NAME}] 예약 {lead} 안내: {when} {department_name} 진료 예약이 있습니다. "
        f"변경·취소는 병원으로 문의해 주세요."
    )


def _kst_day_range_utc(target_date: date) -> tuple[datetime, datetime]:
    """KST 달력 하루 → UTC [start, end) 범위(6.2 슬롯 계산 동형)."""
    start = datetime.combine(target_date, time.min, tzinfo=_KST).astimezone(UTC)
    return start, start + timedelta(days=1)


async def run_appointment_reminders(sub: UUID, as_of: date | None) -> ReminderRunSummary:
    """리마인더 디스패치 실행 — booked∩opt-in∩{D-3,D-1} 예약마다 시뮬 발송 후 멱등 로그.

    as_of 기본 = KST 오늘. D-3 대상일 = as_of+3일·D-1 대상일 = as_of+1일(KST date). 연락처 있으면
    status='simulated'(발송)·없으면 status='skipped'(no_recipient·정직 기록). 멱등 충돌(이미 발송됨)
    → duplicate 집계(새 행 0)."""
    if as_of is None:
        as_of = datetime.now(_KST).date()
    d3_date = as_of + timedelta(days=REMINDER_OFFSETS["d_minus_3"])
    d1_date = as_of + timedelta(days=REMINDER_OFFSETS["d_minus_1"])
    d3_start, d3_end = _kst_day_range_utc(d3_date)
    d1_start, d1_end = _kst_day_range_utc(d1_date)

    rows = await db.fetch_reminder_due_appointments(
        sub, d3_start=d3_start, d3_end=d3_end, d1_start=d1_start, d1_end=d1_end
    )

    created = duplicate = simulated = skipped = 0
    by_kind = {"d_minus_3": 0, "d_minus_1": 0}
    now = datetime.now(UTC)
    for row in rows:
        appt_date = row["scheduled_start"].astimezone(_KST).date()
        kind = "d_minus_3" if appt_date == d3_date else "d_minus_1"
        recipient = mask_phone(row["phone"])
        body = _build_reminder_body(
            appointment_start=row["scheduled_start"],
            department_name=row["department_name"],
            kind=kind,
        )
        if recipient is None:
            status, skip_reason, sent_at = "skipped", "no_recipient", None
        else:
            status, skip_reason, sent_at = "simulated", None, now

        logged = await db.insert_notification_log(
            sub,
            appointment_id=row["id"],
            patient_id=row["patient_id"],
            reminder_kind=kind,
            recipient_masked=recipient,
            body=body,
            status=status,
            skip_reason=skip_reason,
            appointment_start=row["scheduled_start"],
            sent_at=sent_at,
        )
        if logged is None:  # 멱등 충돌(이미 발송된 (예약, 종류)) → 중복 집계
            duplicate += 1
            continue
        created += 1
        by_kind[kind] += 1
        if status == "simulated":
            simulated += 1
        else:
            skipped += 1

    return ReminderRunSummary(
        as_of=as_of,
        created=created,
        duplicate=duplicate,
        simulated=simulated,
        skipped=skipped,
        by_kind=by_kind,
    )


async def list_notification_logs(sub: UUID, *, limit: int = 100) -> list[NotificationLogResponse]:
    """최근 알림 발송 이력(원무 읽기뷰). 원시 phone·환자명 미반환(마스킹·비-식별만)."""
    rows = await db.fetch_notification_logs(sub, limit=limit)
    return [NotificationLogResponse.model_validate(dict(r)) for r in rows]
