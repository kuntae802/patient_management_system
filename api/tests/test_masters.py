"""마스터(진료과·진료실) 명령 엔드포인트 단위 테스트 (Story 2.1) — 실 DB/토큰 없이 격리.

get_current_user 는 dependency_override 로 가짜 주체 주입, db.fetch_has_permission(게이트)·db.* 쓰기
는 monkeypatch 로 고정 → 강제(403)·응답 모델·검증(422)·도메인 오류 매핑(404/422/409)만 본다.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import masters
from app.core import db
from app.core.errors import AppError, ConflictError, NotFoundError, init_error_handlers
from app.core.security import CurrentUser, get_current_user

_FAKE_ADMIN = CurrentUser(
    sub=uuid.uuid4(), aud="authenticated", role="authenticated", exp=9999999999
)
_DEPT_URL = "/v1/masters/departments"
_ROOM_URL = "/v1/masters/rooms"

_DEPT_ROW: dict[str, Any] = {
    "id": uuid.uuid4(),
    "code": "ORTHO",
    "name": "정형외과",
    "description": None,
    "is_active": True,
    "created_at": datetime(2026, 6, 20, 1, 0, tzinfo=UTC),
    "updated_at": datetime(2026, 6, 20, 1, 0, tzinfo=UTC),
}
_ROOM_ROW: dict[str, Any] = {
    "id": uuid.uuid4(),
    "code": "R101",
    "name": "1진료실",
    "department_id": _DEPT_ROW["id"],
    "is_active": True,
    "created_at": datetime(2026, 6, 20, 1, 0, tzinfo=UTC),
    "updated_at": datetime(2026, 6, 20, 1, 0, tzinfo=UTC),
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
    app.include_router(masters.router, prefix="/v1")
    app.dependency_overrides[get_current_user] = lambda: _FAKE_ADMIN

    async def _fake_has_permission(sub: uuid.UUID, code: str) -> bool:
        assert code == "master.manage"  # 게이트가 정확히 master.manage 를 평가하는지 고정
        return allowed

    monkeypatch.setattr(db, "fetch_has_permission", _fake_has_permission)

    # 기본 db 쓰기 스텁(성공). overrides 로 케이스별 교체(예외·캡처).
    async def _ins_dept(sub: uuid.UUID, **kwargs: Any) -> dict[str, Any]:
        if capture is not None:
            capture.update(kwargs)
        return _DEPT_ROW

    async def _set_dept_active(sub: uuid.UUID, dept_id: uuid.UUID, **kwargs: Any) -> dict[str, Any]:
        if capture is not None:
            capture.update(kwargs)
            capture["department_id"] = dept_id
        return {**_DEPT_ROW, "is_active": kwargs.get("is_active", True)}

    async def _ins_room(sub: uuid.UUID, **kwargs: Any) -> dict[str, Any]:
        if capture is not None:
            capture.update(kwargs)
        return _ROOM_ROW

    defaults: dict[str, Any] = {
        "insert_department": _ins_dept,
        "set_department_active": _set_dept_active,
        "insert_room": _ins_room,
    }
    defaults.update(overrides or {})
    for name, fn in defaults.items():
        monkeypatch.setattr(db, name, fn)
    return TestClient(app)


def test_create_department_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch).post(_DEPT_URL, json={"code": "ORTHO", "name": "정형외과"})
    assert res.status_code == 201
    body = res.json()
    assert body["code"] == "ORTHO" and body["name"] == "정형외과"
    assert body["is_active"] is True


def test_no_master_manage_forbidden(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch, allowed=False).post(_DEPT_URL, json={"code": "X", "name": "Y"})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


def test_create_missing_code_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch).post(_DEPT_URL, json={"name": "정형외과"})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "validation_error"


def test_create_blank_code_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    # _Stripped + min_length=1 → 공백만 입력은 422(패딩 우회 차단).
    res = _build(monkeypatch).post(_DEPT_URL, json={"code": "   ", "name": "정형외과"})
    assert res.status_code == 422


def test_update_department_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _raise_nf(sub: uuid.UUID, dept_id: uuid.UUID, **kwargs: Any) -> dict[str, Any]:
        raise NotFoundError(detail={"department_id": str(dept_id)})

    client = _build(monkeypatch, overrides={"update_department": _raise_nf})
    res = client.patch(f"{_DEPT_URL}/{uuid.uuid4()}", json={"name": "새이름"})
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "not_found"


def test_create_department_duplicate_conflict(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _raise_conflict(sub: uuid.UUID, **kwargs: Any) -> dict[str, Any]:
        raise ConflictError("이미 사용 중인 진료과 코드입니다.", code="code_taken")

    client = _build(monkeypatch, overrides={"insert_department": _raise_conflict})
    res = client.post(_DEPT_URL, json={"code": "ORTHO", "name": "정형외과"})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "code_taken"


def test_deactivate_department_passes_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    capture: dict[str, Any] = {}
    dept_id = uuid.uuid4()
    res = _build(monkeypatch, capture=capture).patch(
        f"{_DEPT_URL}/{dept_id}/active", json={"is_active": False}
    )
    assert res.status_code == 200
    assert res.json()["is_active"] is False
    assert capture["is_active"] is False
    assert capture["department_id"] == dept_id


def test_create_room_invalid_department(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _raise_invalid(sub: uuid.UUID, **kwargs: Any) -> dict[str, Any]:
        raise AppError(
            "존재하지 않는 진료과입니다.", code="invalid_department", status_code=422
        )

    client = _build(monkeypatch, overrides={"insert_room": _raise_invalid})
    res = client.post(
        _ROOM_URL, json={"code": "R101", "name": "1진료실", "department_id": str(uuid.uuid4())}
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_department"


def test_create_room_without_department_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch).post(_ROOM_URL, json={"code": "R101", "name": "1진료실"})
    assert res.status_code == 201
    assert res.json()["code"] == "R101"
