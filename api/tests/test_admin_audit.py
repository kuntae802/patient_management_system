"""감사 로그 조회 엔드포인트 단위 테스트 (Story 1.10 AC1) — 실 DB/토큰 없이 격리.

get_current_user 는 dependency_override 로 가짜 주체 주입, db.fetch_has_permission(게이트)·
db.fetch_audit_logs(조회)는 monkeypatch 로 고정 → 강제(403)·{data,meta} 봉투·필터 전달·검증만 본다.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import admin
from app.core import db
from app.core.errors import init_error_handlers
from app.core.security import CurrentUser, get_current_user

_FAKE_ADMIN = CurrentUser(
    sub=uuid.uuid4(), aud="authenticated", role="authenticated", exp=9999999999
)
_URL = "/v1/admin/audit-logs"

_SAMPLE_ROW: dict[str, Any] = {
    "id": uuid.uuid4(),
    "actor_id": uuid.uuid4(),
    "actor_name": "관리자",
    "actor_employee_no": "A0001",
    "action": "update",
    "target_table": "users",
    "target_id": "u-1",
    "before_data": {"employment_status": "active"},
    "after_data": {"employment_status": "on_leave"},
    "ip_address": None,
    "created_at": datetime(2026, 6, 20, 1, 0, tzinfo=UTC),
}


def _build(
    monkeypatch: pytest.MonkeyPatch,
    *,
    allowed: bool = True,
    rows: list[dict[str, Any]] | None = None,
    total: int = 1,
    capture: dict[str, Any] | None = None,
) -> TestClient:
    app = FastAPI()
    init_error_handlers(app)
    app.include_router(admin.router, prefix="/v1")
    app.dependency_overrides[get_current_user] = lambda: _FAKE_ADMIN

    async def _fake_has_permission(sub: uuid.UUID, code: str) -> bool:
        assert code == "audit.read"  # 게이트가 정확히 audit.read 를 평가하는지 고정
        return allowed

    async def _fake_fetch(sub: uuid.UUID, **kwargs: Any) -> tuple[list[dict[str, Any]], int]:
        if capture is not None:
            capture.update(kwargs)
            capture["sub"] = sub
        return (rows if rows is not None else [_SAMPLE_ROW]), total

    monkeypatch.setattr(db, "fetch_has_permission", _fake_has_permission)
    monkeypatch.setattr(db, "fetch_audit_logs", _fake_fetch)
    return TestClient(app)


def test_list_succeeds_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch, total=1).get(_URL)
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"data", "meta"}
    assert body["meta"] == {"page": 1, "page_size": 50, "total": 1}
    assert len(body["data"]) == 1
    entry = body["data"][0]
    assert entry["action"] == "update"
    assert entry["actor_name"] == "관리자"
    assert entry["before_data"] == {"employment_status": "active"}
    assert entry["after_data"] == {"employment_status": "on_leave"}
    assert entry["ip_address"] is None


def test_no_audit_read_forbidden(monkeypatch: pytest.MonkeyPatch) -> None:
    # require_permission 게이트가 has_permission=False 면 조회 도달 전 403.
    res = _build(monkeypatch, allowed=False).get(_URL)
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


def test_filters_passed_through(monkeypatch: pytest.MonkeyPatch) -> None:
    capture: dict[str, Any] = {}
    actor = uuid.uuid4()
    res = _build(monkeypatch, capture=capture).get(
        _URL,
        params={
            "actor_id": str(actor),
            "action": "delete",
            "target_table": "role_permissions",
            "target_id": "x",
            "date_from": "2026-06-01T00:00:00+09:00",
            "date_to": "2026-06-30T23:59:59+09:00",
            "page": 2,
            "page_size": 10,
        },
    )
    assert res.status_code == 200
    assert capture["actor_id"] == actor
    assert capture["action"] == "delete"
    assert capture["target_table"] == "role_permissions"
    assert capture["target_id"] == "x"
    assert capture["page"] == 2
    assert capture["page_size"] == 10
    assert capture["date_from"].isoformat().startswith("2026-06-01")
    assert capture["date_from"].tzinfo is not None
    assert res.json()["meta"]["page"] == 2


def test_empty_result(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch, rows=[], total=0).get(_URL)
    assert res.status_code == 200
    assert res.json() == {"data": [], "meta": {"page": 1, "page_size": 50, "total": 0}}


def test_invalid_page_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch).get(_URL, params={"page": 0})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "validation_error"


def test_page_size_over_max_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch).get(_URL, params={"page_size": 999})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "validation_error"


def test_invalid_action_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    # action 은 AuditAction Literal → enum 외 값은 무음 0건이 아니라 422(요청 계약 대칭).
    res = _build(monkeypatch).get(_URL, params={"action": "nope"})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "validation_error"


def test_reversed_date_range_unprocessable(monkeypatch: pytest.MonkeyPatch) -> None:
    # date_from > date_to → 항상 공집합이므로 "데이터 없음"과 구분되게 422.
    res = _build(monkeypatch).get(
        _URL,
        params={
            "date_from": "2026-06-30T00:00:00+09:00",
            "date_to": "2026-06-01T00:00:00+09:00",
        },
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_date_range"
