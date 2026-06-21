"""근무표·휴진 명령 엔드포인트 단위 테스트 (Story 6.1) — 실 DB/토큰 없이 격리.

get_current_user 는 dependency_override 로 가짜 주체 주입, db.fetch_has_permission(게이트)·db.* 쓰기
는 monkeypatch 로 고정 → 강제(403)·응답 모델·검증(422)·도메인 오류 매핑(404/422/409)만 본다.
test_masters.py 미러 + 시간 순서·weekday·겹침(schedule_overlap) 검증.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, time
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import scheduling
from app.core import db
from app.core.errors import AppError, ConflictError, NotFoundError, init_error_handlers
from app.core.security import CurrentUser, get_current_user
from app.services import scheduling as sched_service

_FAKE_ADMIN = CurrentUser(
    sub=uuid.uuid4(), aud="authenticated", role="authenticated", exp=9999999999
)
_SCHED_URL = "/v1/scheduling/doctor-schedules"
_TIMEOFF_URL = "/v1/scheduling/doctor-time-offs"
_DOCTOR_ID = uuid.uuid4()
_DEPT_ID = uuid.uuid4()

_SCHED_ROW: dict[str, Any] = {
    "id": uuid.uuid4(),
    "doctor_id": _DOCTOR_ID,
    "department_id": _DEPT_ID,
    "room_id": None,
    "weekday": 1,
    "start_time": "09:00:00",
    "end_time": "12:00:00",
    "is_active": True,
    "created_at": datetime(2026, 6, 21, 1, 0, tzinfo=UTC),
    "updated_at": datetime(2026, 6, 21, 1, 0, tzinfo=UTC),
}
_TIMEOFF_ROW: dict[str, Any] = {
    "id": uuid.uuid4(),
    "doctor_id": _DOCTOR_ID,
    "start_at": datetime(2026, 7, 1, 0, 0, tzinfo=UTC),
    "end_at": datetime(2026, 7, 2, 0, 0, tzinfo=UTC),
    "reason": "학회",
    "is_active": True,
    "created_at": datetime(2026, 6, 21, 1, 0, tzinfo=UTC),
    "updated_at": datetime(2026, 6, 21, 1, 0, tzinfo=UTC),
}

_VALID_SCHED = {
    "doctor_id": str(_DOCTOR_ID),
    "department_id": str(_DEPT_ID),
    "weekday": 1,
    "start_time": "09:00:00",
    "end_time": "12:00:00",
}
_VALID_TIMEOFF = {
    "doctor_id": str(_DOCTOR_ID),
    "start_at": "2026-07-01T00:00:00Z",
    "end_at": "2026-07-02T00:00:00Z",
    "reason": "학회",
}


def _build(
    monkeypatch: pytest.MonkeyPatch,
    *,
    allowed: bool = True,
    overrides: dict[str, Any] | None = None,
    capture: dict[str, Any] | None = None,
) -> TestClient:
    app = FastAPI()
    init_error_handlers(app)
    app.include_router(scheduling.router, prefix="/v1")
    app.dependency_overrides[get_current_user] = lambda: _FAKE_ADMIN

    async def _fake_has_permission(sub: uuid.UUID, code: str) -> bool:
        assert code == "master.manage"  # 게이트가 정확히 master.manage 를 평가하는지 고정
        return allowed

    monkeypatch.setattr(db, "fetch_has_permission", _fake_has_permission)

    async def _ins_sched(sub: uuid.UUID, **kwargs: Any) -> dict[str, Any]:
        if capture is not None:
            capture.update(kwargs)
        return _SCHED_ROW

    async def _set_sched_active(
        sub: uuid.UUID, schedule_id: uuid.UUID, **kwargs: Any
    ) -> dict[str, Any]:
        if capture is not None:
            capture.update(kwargs)
            capture["schedule_id"] = schedule_id
        return {**_SCHED_ROW, "is_active": kwargs.get("is_active", True)}

    async def _ins_timeoff(sub: uuid.UUID, **kwargs: Any) -> dict[str, Any]:
        if capture is not None:
            capture.update(kwargs)
        return _TIMEOFF_ROW

    defaults: dict[str, Any] = {
        "insert_doctor_schedule": _ins_sched,
        "set_doctor_schedule_active": _set_sched_active,
        "insert_doctor_time_off": _ins_timeoff,
    }
    defaults.update(overrides or {})
    for name, fn in defaults.items():
        monkeypatch.setattr(db, name, fn)
    return TestClient(app)


# ── 권한 게이트 ───────────────────────────────────────────────────────────────


def test_create_schedule_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch).post(_SCHED_URL, json=_VALID_SCHED)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["weekday"] == 1 and body["is_active"] is True


def test_no_master_manage_forbidden(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch, allowed=False).post(_SCHED_URL, json=_VALID_SCHED)
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


def test_create_time_off_forbidden_without_permission(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch, allowed=False).post(_TIMEOFF_URL, json=_VALID_TIMEOFF)
    assert res.status_code == 403


# ── 검증(422) ─────────────────────────────────────────────────────────────────


def test_weekday_out_of_range_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch).post(_SCHED_URL, json={**_VALID_SCHED, "weekday": 7})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "validation_error"


def test_schedule_time_order_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch).post(
        _SCHED_URL, json={**_VALID_SCHED, "start_time": "12:00:00", "end_time": "09:00:00"}
    )
    assert res.status_code == 422


def test_missing_doctor_id_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {k: v for k, v in _VALID_SCHED.items() if k != "doctor_id"}
    res = _build(monkeypatch).post(_SCHED_URL, json=payload)
    assert res.status_code == 422


def test_time_off_range_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch).post(
        _TIMEOFF_URL,
        json={
            **_VALID_TIMEOFF,
            "start_at": "2026-07-02T00:00:00Z",
            "end_at": "2026-07-01T00:00:00Z",
        },
    )
    assert res.status_code == 422


# ── 도메인 오류 매핑 ──────────────────────────────────────────────────────────


def test_schedule_overlap_conflict(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _raise_overlap(sub: uuid.UUID, **kwargs: Any) -> dict[str, Any]:
        raise ConflictError("같은 의사·요일에 겹칩니다.", code="schedule_overlap")

    client = _build(monkeypatch, overrides={"insert_doctor_schedule": _raise_overlap})
    res = client.post(_SCHED_URL, json=_VALID_SCHED)
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "schedule_overlap"


def test_invalid_doctor_422(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _raise_invalid(sub: uuid.UUID, **kwargs: Any) -> dict[str, Any]:
        raise AppError(
            "존재하지 않거나 의사가 아닌 직원입니다.", code="invalid_doctor", status_code=422
        )

    client = _build(monkeypatch, overrides={"insert_doctor_schedule": _raise_invalid})
    res = client.post(_SCHED_URL, json=_VALID_SCHED)
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_doctor"


def test_update_schedule_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _raise_nf(sub: uuid.UUID, schedule_id: uuid.UUID, **kwargs: Any) -> dict[str, Any]:
        raise NotFoundError(detail={"schedule_id": str(schedule_id)})

    client = _build(monkeypatch, overrides={"update_doctor_schedule": _raise_nf})
    res = client.patch(f"{_SCHED_URL}/{uuid.uuid4()}", json=_VALID_SCHED)
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "not_found"


# ── active 토글 플래그 전달 ──────────────────────────────────────────────────


def test_deactivate_schedule_passes_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    capture: dict[str, Any] = {}
    schedule_id = uuid.uuid4()
    res = _build(monkeypatch, capture=capture).patch(
        f"{_SCHED_URL}/{schedule_id}/active", json={"is_active": False}
    )
    assert res.status_code == 200
    assert res.json()["is_active"] is False
    assert capture["is_active"] is False
    assert capture["schedule_id"] == schedule_id


def test_create_time_off_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch).post(_TIMEOFF_URL, json=_VALID_TIMEOFF)
    assert res.status_code == 201, res.text
    assert res.json()["reason"] == "학회"


# ── 동적 슬롯 계산: 순수 함수 _build_slots (Story 6.2, DB 무관) ────────────────
# 근무 블록(KST 로컬 time) → 30분 슬롯 전개 + status(available/booked/time_off/past).
# 09:00 KST = 00:00 UTC(고정 +9). _PAST/_FUTURE = '지남' 판정 기준(now) 양극단.

_DATE = date(2030, 6, 3)  # 월요일(KST dow=1)
_PAST = datetime(2020, 1, 1, tzinfo=UTC)  # now 가 모든 슬롯보다 과거 → past 없음
_FUTURE = datetime(2040, 1, 1, tzinfo=UTC)  # now 가 모든 슬롯보다 미래 → 전부 past


def _u(hour: int, minute: int = 0) -> datetime:
    """2030-06-03 의 UTC 시각(KST-9). 예: _u(0)=09:00 KST 슬롯 시작."""
    return datetime(2030, 6, 3, hour, minute, tzinfo=UTC)


def test_build_slots_available_grid() -> None:
    """09:00–10:30 KST 블록 → 30분 슬롯 3개, now 과거라 전부 available."""
    slots = sched_service._build_slots(_DATE, [(time(9, 0), time(10, 30))], [], [], _PAST)
    assert [s.status for s in slots] == ["available", "available", "available"]
    assert slots[0].start == _u(0, 0) and slots[0].end == _u(0, 30)  # 09:00 KST = 00:00 UTC
    assert slots[-1].end == _u(1, 30)  # 10:30 KST = 01:30 UTC


def test_build_slots_partial_tail_excluded() -> None:
    """09:00–09:40 블록 → 30분 슬롯 1개만(09:30–10:00 은 블록 초과)."""
    slots = sched_service._build_slots(_DATE, [(time(9, 0), time(9, 40))], [], [], _PAST)
    assert len(slots) == 1 and slots[0].end == _u(0, 30)


def test_build_slots_booked_subtraction() -> None:
    """booked 예약(09:00–09:30 KST=00:00–00:30 UTC) 겹치는 슬롯만 booked, 나머지 available."""
    booked = [(_u(0, 0), _u(0, 30))]
    slots = sched_service._build_slots(_DATE, [(time(9, 0), time(10, 0))], [], booked, _PAST)
    assert [s.status for s in slots] == ["booked", "available"]


def test_build_slots_time_off() -> None:
    time_offs = [(_u(0, 0), _u(0, 30))]
    slots = sched_service._build_slots(_DATE, [(time(9, 0), time(10, 0))], time_offs, [], _PAST)
    assert [s.status for s in slots] == ["time_off", "available"]


def test_build_slots_past() -> None:
    """now 가 미래면 전부 past(시각 지남)."""
    slots = sched_service._build_slots(_DATE, [(time(9, 0), time(10, 0))], [], [], _FUTURE)
    assert all(s.status == "past" for s in slots)


def test_build_slots_status_priority() -> None:
    """우선순위 past > time_off > booked: 지난 슬롯이 휴진·예약과 겹쳐도 past."""
    full = [(_u(0, 0), _u(0, 30))]
    slots = sched_service._build_slots(_DATE, [(time(9, 0), time(9, 30))], full, full, _FUTURE)
    assert slots[0].status == "past"


def test_build_slots_timeoff_over_booked() -> None:
    """past 아니면 time_off 가 booked 보다 우선."""
    full = [(_u(0, 0), _u(0, 30))]
    slots = sched_service._build_slots(_DATE, [(time(9, 0), time(9, 30))], full, full, _PAST)
    assert slots[0].status == "time_off"


def test_build_slots_empty_blocks() -> None:
    assert sched_service._build_slots(_DATE, [], [], [], _PAST) == []


def test_build_slots_sorted_across_blocks() -> None:
    """오전·오후 두 블록(역순 입력) → 시작 시각 오름차순 정렬."""
    blocks = [(time(14, 0), time(14, 30)), (time(9, 0), time(9, 30))]
    slots = sched_service._build_slots(_DATE, blocks, [], [], _PAST)
    assert [s.start for s in slots] == sorted(s.start for s in slots)
    assert slots[0].start == _u(0, 0)  # 09:00 KST 먼저


# ── 슬롯·예약 엔드포인트 게이트 (appointment.read) ─────────────────────────────


def _slots_client(monkeypatch: pytest.MonkeyPatch, *, allowed: bool = True) -> TestClient:
    app = FastAPI()
    init_error_handlers(app)
    app.include_router(scheduling.router, prefix="/v1")
    app.dependency_overrides[get_current_user] = lambda: _FAKE_ADMIN

    async def _perm(sub: uuid.UUID, code: str) -> bool:
        assert code == "appointment.read"  # 게이트가 정확히 appointment.read 평가
        return allowed

    monkeypatch.setattr(db, "fetch_has_permission", _perm)

    async def _empty(*args: Any, **kwargs: Any) -> list[Any]:
        return []

    for name in (
        "fetch_doctor_schedules_for_weekday",
        "fetch_doctor_time_offs_in_range",
        "fetch_booked_appointments_in_range",
        "fetch_bookable_doctors",
    ):
        monkeypatch.setattr(db, name, _empty)
    return TestClient(app)


def test_slots_forbidden_without_appointment_read(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _slots_client(monkeypatch, allowed=False).get(
        "/v1/scheduling/slots", params={"doctor_id": str(uuid.uuid4()), "date": "2030-06-03"}
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


def test_slots_empty_for_unknown_doctor(monkeypatch: pytest.MonkeyPatch) -> None:
    """근무 블록 0(비활성/미존재 의사) → 빈 슬롯·200(404 아님, AC3)."""
    res = _slots_client(monkeypatch).get(
        "/v1/scheduling/slots", params={"doctor_id": str(uuid.uuid4()), "date": "2030-06-03"}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["slots"] == [] and body["slot_minutes"] == 30


def test_slots_invalid_date_422(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _slots_client(monkeypatch).get(
        "/v1/scheduling/slots", params={"doctor_id": str(uuid.uuid4()), "date": "not-a-date"}
    )
    assert res.status_code == 422


def test_bookable_doctors_forbidden_without_appointment_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    res = _slots_client(monkeypatch, allowed=False).get("/v1/scheduling/bookable-doctors")
    assert res.status_code == 403


def test_bookable_doctors_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _slots_client(monkeypatch).get("/v1/scheduling/bookable-doctors")
    assert res.status_code == 200
    assert res.json() == []
