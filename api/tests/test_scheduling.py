"""근무표·휴진 명령 엔드포인트 단위 테스트 (Story 6.1) — 실 DB/토큰 없이 격리.

get_current_user 는 dependency_override 로 가짜 주체 주입, db.fetch_has_permission(게이트)·db.* 쓰기
는 monkeypatch 로 고정 → 강제(403)·응답 모델·검증(422)·도메인 오류 매핑(404/422/409)만 본다.
test_masters.py 미러 + 시간 순서·weekday·겹침(schedule_overlap) 검증.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import scheduling
from app.core import db
from app.core.errors import AppError, ConflictError, NotFoundError, init_error_handlers
from app.core.security import CurrentUser, get_current_user

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
