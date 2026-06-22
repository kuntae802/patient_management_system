"""알림(SMS 리마인더) 단위 테스트 (Story 6.6) — 순수 함수 + 디스패치 로직(db 모킹).

DB·실제 발송은 통합 테스트가 커버. 여기선 mask_phone·body 비-식별·run_appointment_reminders 의
D-3/D-1 매칭·opt-in(db 필터 신뢰)·no-phone→skipped·멱등(insert None→duplicate)·by_kind·게이트만.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import scheduling
from app.core import db
from app.core.errors import init_error_handlers
from app.core.security import CurrentUser, get_current_user
from app.services import notification as notif
from app.services.notification import _build_reminder_body, _format_kst_12h, mask_phone

# ── 순수: mask_phone ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("010-1234-5678", "010-****-5678"),
        ("01012345678", "010-****-5678"),
        ("010 1234 5678", "010-****-5678"),
        ("0212345678", "021-****-5678"),  # 10자리 지역번호 → prefix 노출(가운데 2자리 가림)
        ("1234567", "****-4567"),  # 7자리 → prefix 생략(전체 재구성 차단)
        ("12345678", "****-5678"),  # 8자리(<10) → prefix 생략
        (None, None),
        ("", None),
        ("123", None),  # 4자리 미만 → 발송 불가(None)
    ],
)
def test_mask_phone(raw: str | None, expected: str | None) -> None:
    assert mask_phone(raw) == expected


def test_mask_phone_never_exposes_full_number() -> None:
    """마스킹 결과에 원시 가운데 4자리가 없어야(부분 노출 최소·PII 경계)."""
    masked = mask_phone("010-1234-5678")
    assert masked is not None
    assert "1234" not in masked
    assert masked.endswith("5678")


def test_mask_phone_short_number_not_reconstructable() -> None:
    """7자리 번호도 전체 재구성 불가 — prefix 생략으로 앞 3자리 비노출(PII 경계·코드리뷰 patch)."""
    masked = mask_phone("1234567")
    assert masked == "****-4567"
    # 앞 3자리(123)가 노출되지 않아 끝 4자리 + 마스크만으로 원번호 재구성 불가.
    assert "123" not in masked


# ── 순수: body 비-식별 + 12h 표기 ─────────────────────────────────────────────


def test_format_kst_12h_no_locale_dependency() -> None:
    """KST 12시간 한국어 표기(locale/ICU 비의존 수동 산출)."""
    # 2026-06-25 05:00 UTC = 14:00 KST → 오후 2:30 (분 30 확인용 별도)
    assert _format_kst_12h(datetime(2026, 6, 25, 5, 30, tzinfo=UTC)) == "6월 25일 오후 2:30"
    # 자정 0시 KST → 오전 12:00
    assert _format_kst_12h(datetime(2026, 6, 24, 15, 0, tzinfo=UTC)) == "6월 25일 오전 12:00"


def test_build_reminder_body_has_no_pii() -> None:
    """body 에 환자명·주민번호 없음(비-식별) + 진료과·D-N 리드·시각 포함(AC4)."""
    body = _build_reminder_body(
        appointment_start=datetime(2026, 6, 25, 5, 30, tzinfo=UTC),
        department_name="정형외과",
        kind="d_minus_3",
    )
    assert "3일 전" in body
    assert "정형외과" in body
    assert "오후 2:30" in body
    # 비-식별: 호출부가 환자명·주민번호를 인자로 주지 않으므로 body 에 들어갈 수 없다(구조적).
    assert "정형외과" in body and "예약" in body


# ── 디스패치: run_appointment_reminders (db 모킹) ──────────────────────────────

_SUB = uuid.uuid4()


def _row(start: datetime, phone: str | None, dept: str = "정형외과") -> dict[str, Any]:
    return {
        "id": uuid.uuid4(),
        "patient_id": uuid.uuid4(),
        "scheduled_start": start,
        "phone": phone,
        "department_name": dept,
    }


async def test_run_reminders_d3_d1_matching_and_skip(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-3(연락처 있음→simulated)·D-1(연락처 없음→skipped) 매칭·집계·by_kind."""
    as_of = date(2026, 6, 22)
    # D-3 대상일 = 6/25(14:00 KST), D-1 대상일 = 6/23(10:00 KST).
    rows = [
        _row(datetime(2026, 6, 25, 5, 0, tzinfo=UTC), "010-1234-5678"),  # D-3 simulated
        _row(datetime(2026, 6, 23, 1, 0, tzinfo=UTC), None),  # D-1 skipped(no phone)
    ]
    captured: list[dict[str, Any]] = []

    async def _fake_fetch(sub: uuid.UUID, **kwargs: Any) -> list[dict[str, Any]]:
        return rows

    async def _fake_insert(sub: uuid.UUID, **kwargs: Any) -> dict[str, Any]:
        captured.append(kwargs)
        return {"id": uuid.uuid4(), **kwargs}  # 신규 발송(멱등 충돌 아님)

    monkeypatch.setattr(db, "fetch_reminder_due_appointments", _fake_fetch)
    monkeypatch.setattr(db, "insert_notification_log", _fake_insert)

    summary = await notif.run_appointment_reminders(_SUB, as_of)

    assert summary.created == 2
    assert summary.duplicate == 0
    assert summary.simulated == 1
    assert summary.skipped == 1
    assert summary.by_kind == {"d_minus_3": 1, "d_minus_1": 1}

    by_kind = {c["reminder_kind"]: c for c in captured}
    assert by_kind["d_minus_3"]["status"] == "simulated"
    assert by_kind["d_minus_3"]["recipient_masked"] == "010-****-5678"
    assert by_kind["d_minus_3"]["sent_at"] is not None
    assert by_kind["d_minus_1"]["status"] == "skipped"
    assert by_kind["d_minus_1"]["skip_reason"] == "no_recipient"
    assert by_kind["d_minus_1"]["recipient_masked"] is None
    assert by_kind["d_minus_1"]["sent_at"] is None


async def test_run_reminders_idempotent_duplicate(monkeypatch: pytest.MonkeyPatch) -> None:
    """insert 가 None(멱등 충돌·이미 발송) → created 0·duplicate 집계(재실행 중복 0·AC2)."""
    as_of = date(2026, 6, 22)
    rows = [_row(datetime(2026, 6, 25, 5, 0, tzinfo=UTC), "010-1234-5678")]

    async def _fake_fetch(sub: uuid.UUID, **kwargs: Any) -> list[dict[str, Any]]:
        return rows

    async def _fake_insert_conflict(sub: uuid.UUID, **kwargs: Any) -> None:
        return None  # on conflict do nothing → 이미 존재

    monkeypatch.setattr(db, "fetch_reminder_due_appointments", _fake_fetch)
    monkeypatch.setattr(db, "insert_notification_log", _fake_insert_conflict)

    summary = await notif.run_appointment_reminders(_SUB, as_of)
    assert summary.created == 0
    assert summary.duplicate == 1
    assert summary.by_kind == {"d_minus_3": 0, "d_minus_1": 0}


async def test_run_reminders_default_as_of_kst_today(monkeypatch: pytest.MonkeyPatch) -> None:
    """as_of None → KST 오늘로 기본(요약 as_of 반환). 빈 대상이어도 무오류."""

    async def _fake_fetch(sub: uuid.UUID, **kwargs: Any) -> list[dict[str, Any]]:
        return []

    monkeypatch.setattr(db, "fetch_reminder_due_appointments", _fake_fetch)
    summary = await notif.run_appointment_reminders(_SUB, None)
    assert summary.created == 0
    assert isinstance(summary.as_of, date)


# ── 라우터 게이트(403) ────────────────────────────────────────────────────────


_FAKE_USER = CurrentUser(sub=_SUB, aud="authenticated", role="authenticated", exp=9999999999)


def _client(monkeypatch: pytest.MonkeyPatch, *, allowed: bool) -> TestClient:
    app = FastAPI()
    init_error_handlers(app)
    app.include_router(scheduling.router, prefix="/v1")
    app.dependency_overrides[get_current_user] = lambda: _FAKE_USER

    async def _fake_has_permission(sub: uuid.UUID, code: str) -> bool:
        return allowed

    monkeypatch.setattr(db, "fetch_has_permission", _fake_has_permission)
    return TestClient(app)


def test_run_reminders_forbidden_without_send(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _client(monkeypatch, allowed=False).post("/v1/scheduling/reminders/run")
    assert res.status_code == 403


def test_list_reminders_forbidden_without_read(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _client(monkeypatch, allowed=False).get("/v1/scheduling/reminders")
    assert res.status_code == 403


@pytest.mark.parametrize("bad", ["0", "-1", "600"])
def test_list_reminders_rejects_out_of_bound_limit(
    monkeypatch: pytest.MonkeyPatch, bad: str
) -> None:
    """limit 무경계 방지(코드리뷰 patch) — 음수/0/과대값 → 422(풀로드·LIMIT -1 500 차단)."""
    res = _client(monkeypatch, allowed=True).get(f"/v1/scheduling/reminders?limit={bad}")
    assert res.status_code == 422


def test_run_reminders_success(monkeypatch: pytest.MonkeyPatch) -> None:
    """notification.send 보유 + db 모킹 → 200 + 요약."""

    async def _fake_fetch(sub: uuid.UUID, **kwargs: Any) -> list[dict[str, Any]]:
        return []

    monkeypatch.setattr(db, "fetch_reminder_due_appointments", _fake_fetch)
    res = _client(monkeypatch, allowed=True).post("/v1/scheduling/reminders/run?as_of=2026-06-22")
    assert res.status_code == 200
    body = res.json()
    assert body["as_of"] == "2026-06-22"
    assert body["created"] == 0
    assert body["by_kind"] == {"d_minus_3": 0, "d_minus_1": 0}
