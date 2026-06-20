"""admin RBAC grant 엔드포인트 단위 테스트 (AC2·3·5) — 실 DB/토큰 없이 게이트·쓰기 분기 격리.

get_current_user 는 dependency_override 로 가짜 주체 주입, `db.fetch_has_permission`(게이트)·
`db.set_role_permission`(쓰기)은 monkeypatch 로 고정 → 강제·검증·에러봉투만 검증한다.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import admin
from app.core import db
from app.core.errors import AppError, ConflictError, NotFoundError, init_error_handlers
from app.core.security import CurrentUser, get_current_user

_FAKE_ADMIN = CurrentUser(
    sub=uuid.uuid4(), aud="authenticated", role="authenticated", exp=9999999999
)
_BODY = {"role_code": "reception", "permission_code": "patient.read", "granted": True}


def _build(
    monkeypatch: pytest.MonkeyPatch,
    *,
    allowed: bool = True,
    set_result: bool = True,
    set_error: Exception | None = None,
) -> TestClient:
    app = FastAPI()
    init_error_handlers(app)
    app.include_router(admin.router, prefix="/v1")
    app.dependency_overrides[get_current_user] = lambda: _FAKE_ADMIN

    async def _fake_has_permission(sub: uuid.UUID, code: str) -> bool:
        assert code == "rbac.manage"
        return allowed

    async def _fake_set(
        sub: uuid.UUID, role_code: str, permission_code: str, *, granted: bool
    ) -> bool:
        if set_error is not None:
            raise set_error
        return set_result

    monkeypatch.setattr(db, "fetch_has_permission", _fake_has_permission)
    monkeypatch.setattr(db, "set_role_permission", _fake_set)
    return TestClient(app)


def test_grant_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch, set_result=True).put("/v1/admin/rbac/grants", json=_BODY)
    assert res.status_code == 200
    assert res.json() == {
        "role_code": "reception",
        "permission_code": "patient.read",
        "granted": True,
        "changed": True,
    }


def test_idempotent_grant_changed_false(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch, set_result=False).put("/v1/admin/rbac/grants", json=_BODY)
    assert res.status_code == 200
    assert res.json()["changed"] is False


def test_revoke_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    body = {**_BODY, "granted": False}
    res = _build(monkeypatch, set_result=True).put("/v1/admin/rbac/grants", json=body)
    assert res.status_code == 200
    assert res.json()["granted"] is False


def test_non_rbac_manage_forbidden(monkeypatch: pytest.MonkeyPatch) -> None:
    # require_permission 게이트가 has_permission=False 면 쓰기 도달 전 403.
    res = _build(monkeypatch, allowed=False).put("/v1/admin/rbac/grants", json=_BODY)
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


def test_admin_target_conflict(monkeypatch: pytest.MonkeyPatch) -> None:
    err = ConflictError(
        "관리자 역할의 권한은 변경할 수 없습니다.",
        code="role_locked",
        detail={"role_code": "admin"},
    )
    res = _build(monkeypatch, set_error=err).put(
        "/v1/admin/rbac/grants", json={**_BODY, "role_code": "admin"}
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "role_locked"


def test_patient_target_unprocessable(monkeypatch: pytest.MonkeyPatch) -> None:
    err = AppError(
        "권한 매트릭스에서 변경할 수 없는 역할입니다.",
        code="invalid_target",
        status_code=422,
        detail={"role_code": "patient"},
    )
    res = _build(monkeypatch, set_error=err).put(
        "/v1/admin/rbac/grants", json={**_BODY, "role_code": "patient"}
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_target"


def test_unknown_code_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    err = NotFoundError(detail={"permission_code": "nope.nope"})
    res = _build(monkeypatch, set_error=err).put(
        "/v1/admin/rbac/grants", json={**_BODY, "permission_code": "nope.nope"}
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "not_found"


def test_missing_fields_validation_error(monkeypatch: pytest.MonkeyPatch) -> None:
    # 게이트는 통과(allowed=True)하나 body 필수 필드 누락 → 422 봉투.
    res = _build(monkeypatch).put("/v1/admin/rbac/grants", json={"role_code": "reception"})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "validation_error"
