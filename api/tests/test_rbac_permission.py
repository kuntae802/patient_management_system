"""require_permission 의존성 단위 테스트 (AC2) — DB 평가를 monkeypatch 해 통과/403 분기만 격리.

get_current_user 는 dependency_override 로 가짜 주체 주입, `db.fetch_has_permission` 은
monkeypatch 로 결과 고정 → 실 DB·실 토큰 없이 강제 로직만 검증.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.core import db
from app.core.errors import init_error_handlers
from app.core.security import (
    CurrentUser,
    get_current_staff,
    get_current_user,
    require_permission,
)

_FAKE_USER = CurrentUser(
    sub=uuid.uuid4(), aud="authenticated", role="authenticated", exp=9999999999
)
_guard = require_permission("rbac.manage")


def _build(monkeypatch: pytest.MonkeyPatch, *, allowed: bool) -> TestClient:
    app = FastAPI()
    init_error_handlers(app)

    @app.get("/guarded")
    async def guarded(_: CurrentUser = Depends(_guard)) -> dict[str, bool]:
        return {"ok": True}

    app.dependency_overrides[get_current_user] = lambda: _FAKE_USER

    async def _fake_has_permission(sub: uuid.UUID, code: str) -> bool:
        assert code == "rbac.manage"
        return allowed

    monkeypatch.setattr(db, "fetch_has_permission", _fake_has_permission)
    return TestClient(app)


def test_permission_granted_passes(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _build(monkeypatch, allowed=True)
    res = client.get("/guarded")
    assert res.status_code == 200
    assert res.json() == {"ok": True}


def test_permission_denied_403(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _build(monkeypatch, allowed=False)
    res = client.get("/guarded")
    assert res.status_code == 403
    body = res.json()
    assert body["error"]["code"] == "forbidden"
    assert body["error"]["detail"] == {"required_permission": "rbac.manage"}


def _build_staff(monkeypatch: pytest.MonkeyPatch, role: str | None) -> TestClient:
    app = FastAPI()
    init_error_handlers(app)

    @app.get("/staff-only")
    async def staff_only(_: CurrentUser = Depends(get_current_staff)) -> dict[str, bool]:
        return {"ok": True}

    app.dependency_overrides[get_current_user] = lambda: _FAKE_USER

    async def _fake_user_role(sub: uuid.UUID) -> str | None:
        return role

    monkeypatch.setattr(db, "fetch_user_role", _fake_user_role)
    return TestClient(app)


def test_staff_role_passes(monkeypatch: pytest.MonkeyPatch) -> None:
    assert _build_staff(monkeypatch, "admin").get("/staff-only").status_code == 200


def test_patient_role_forbidden(monkeypatch: pytest.MonkeyPatch) -> None:
    # patient 역할은 직원 5역할 집합 밖 → 403(D-4: non-null이어도 직원 아님).
    res = _build_staff(monkeypatch, "patient").get("/staff-only")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


def test_non_staff_none_forbidden(monkeypatch: pytest.MonkeyPatch) -> None:
    assert _build_staff(monkeypatch, None).get("/staff-only").status_code == 403
