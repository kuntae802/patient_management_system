"""코드 마스터(KCD·EDI·약품) 명령 엔드포인트 단위 테스트 (Story 2.2) — 실 DB/토큰 없이 격리.

get_current_user 는 dependency_override 로 가짜 주체 주입, db.fetch_has_permission(게이트)·db.* 쓰기
는 monkeypatch 로 고정 → 강제(403)·응답 모델·검증(422: 공백/금액음수/만료<발효)·도메인 오류 매핑
(404/409)만 본다. (test_masters.py 미러 + 유효기간·금액 검증.)
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import masters
from app.core import db
from app.core.errors import ConflictError, NotFoundError, init_error_handlers
from app.core.security import CurrentUser, get_current_user

_FAKE_ADMIN = CurrentUser(
    sub=uuid.uuid4(), aud="authenticated", role="authenticated", exp=9999999999
)
_DX_URL = "/v1/masters/diagnoses"
_FEE_URL = "/v1/masters/fee-schedules"
_DRUG_URL = "/v1/masters/drugs"

_TS = datetime(2026, 6, 20, 1, 0, tzinfo=UTC)
_DX_ROW: dict[str, Any] = {
    "id": uuid.uuid4(),
    "code": "I10",
    "name": "본태성 고혈압",
    "effective_from": date(2026, 1, 1),
    "effective_to": None,
    "is_active": True,
    "created_at": _TS,
    "updated_at": _TS,
}
_FEE_ROW: dict[str, Any] = {
    "id": uuid.uuid4(),
    "code": "AA157",
    "name": "재진 진찰료",
    "amount_krw": 12000,
    "category": "진찰료",
    "effective_from": date(2026, 1, 1),
    "effective_to": None,
    "is_active": True,
    "created_at": _TS,
    "updated_at": _TS,
}
_DRUG_ROW: dict[str, Any] = {
    "id": uuid.uuid4(),
    "code": "642901230",
    "name": "타이레놀정 500mg",
    "ingredient_code": "120901ATB",
    "unit": "정",
    "effective_from": date(2026, 1, 1),
    "effective_to": None,
    "is_active": True,
    "created_at": _TS,
    "updated_at": _TS,
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
        assert code == "master.manage"
        return allowed

    monkeypatch.setattr(db, "fetch_has_permission", _fake_has_permission)

    async def _ins_dx(sub: uuid.UUID, **kwargs: Any) -> dict[str, Any]:
        if capture is not None:
            capture.update(kwargs)
        return _DX_ROW

    async def _set_dx_active(sub: uuid.UUID, dx_id: uuid.UUID, **kwargs: Any) -> dict[str, Any]:
        if capture is not None:
            capture.update(kwargs)
            capture["diagnosis_id"] = dx_id
        return {**_DX_ROW, "is_active": kwargs.get("is_active", True)}

    async def _ins_fee(sub: uuid.UUID, **kwargs: Any) -> dict[str, Any]:
        if capture is not None:
            capture.update(kwargs)
        return _FEE_ROW

    async def _ins_drug(sub: uuid.UUID, **kwargs: Any) -> dict[str, Any]:
        if capture is not None:
            capture.update(kwargs)
        return _DRUG_ROW

    defaults: dict[str, Any] = {
        "insert_diagnosis": _ins_dx,
        "set_diagnosis_active": _set_dx_active,
        "insert_fee_schedule": _ins_fee,
        "insert_drug": _ins_drug,
    }
    defaults.update(overrides or {})
    for name, fn in defaults.items():
        monkeypatch.setattr(db, name, fn)
    return TestClient(app)


def test_create_diagnosis_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch).post(
        _DX_URL, json={"code": "I10", "name": "본태성 고혈압", "effective_from": "2026-01-01"}
    )
    assert res.status_code == 201
    body = res.json()
    assert body["code"] == "I10" and body["effective_to"] is None and body["is_active"] is True


def test_create_fee_schedule_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch).post(
        _FEE_URL,
        json={
            "code": "AA157",
            "name": "재진 진찰료",
            "amount_krw": 12000,
            "effective_from": "2026-01-01",
        },
    )
    assert res.status_code == 201
    assert res.json()["amount_krw"] == 12000


def test_create_drug_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch).post(
        _DRUG_URL,
        json={"code": "642901230", "name": "타이레놀정 500mg", "effective_from": "2026-01-01"},
    )
    assert res.status_code == 201
    assert res.json()["code"] == "642901230"


def test_no_master_manage_forbidden(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch, allowed=False).post(
        _DX_URL, json={"code": "X", "name": "Y", "effective_from": "2026-01-01"}
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


def test_create_missing_code_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch).post(_DX_URL, json={"name": "고혈압", "effective_from": "2026-01-01"})
    assert res.status_code == 422


def test_create_blank_code_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch).post(
        _DX_URL, json={"code": "   ", "name": "고혈압", "effective_from": "2026-01-01"}
    )
    assert res.status_code == 422


def test_create_missing_effective_from_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch).post(_DX_URL, json={"code": "I10", "name": "고혈압"})
    assert res.status_code == 422


def test_fee_negative_amount_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    res = _build(monkeypatch).post(
        _FEE_URL,
        json={"code": "AA157", "name": "재진", "amount_krw": -1, "effective_from": "2026-01-01"},
    )
    assert res.status_code == 422


def test_fee_amount_overflow_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    # PG integer 상한 초과 → 검증 422 로 차단(미차단 시 asyncpg 오버플로가 503 으로 오인됨).
    res = _build(monkeypatch).post(
        _FEE_URL,
        json={
            "code": "AA157",
            "name": "재진",
            "amount_krw": 3_000_000_000,
            "effective_from": "2026-01-01",
        },
    )
    assert res.status_code == 422


def test_effective_to_before_from_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    # 만료일 < 발효일 → model_validator 가 422 로 차단(DB CHECK 도달 전).
    res = _build(monkeypatch).post(
        _DX_URL,
        json={
            "code": "I10",
            "name": "고혈압",
            "effective_from": "2026-06-01",
            "effective_to": "2026-01-01",
        },
    )
    assert res.status_code == 422


def test_update_diagnosis_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _raise_nf(sub: uuid.UUID, dx_id: uuid.UUID, **kwargs: Any) -> dict[str, Any]:
        raise NotFoundError(detail={"diagnosis_id": str(dx_id)})

    client = _build(monkeypatch, overrides={"update_diagnosis": _raise_nf})
    res = client.patch(
        f"{_DX_URL}/{uuid.uuid4()}", json={"name": "새이름", "effective_from": "2026-01-01"}
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "not_found"


def test_create_diagnosis_duplicate_conflict(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _raise_conflict(sub: uuid.UUID, **kwargs: Any) -> dict[str, Any]:
        raise ConflictError("이미 사용 중인 진단 코드입니다.", code="code_taken")

    client = _build(monkeypatch, overrides={"insert_diagnosis": _raise_conflict})
    res = client.post(
        _DX_URL, json={"code": "I10", "name": "고혈압", "effective_from": "2026-01-01"}
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "code_taken"


def test_deactivate_diagnosis_passes_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    capture: dict[str, Any] = {}
    dx_id = uuid.uuid4()
    res = _build(monkeypatch, capture=capture).patch(
        f"{_DX_URL}/{dx_id}/active", json={"is_active": False}
    )
    assert res.status_code == 200
    assert res.json()["is_active"] is False
    assert capture["is_active"] is False
    assert capture["diagnosis_id"] == dx_id
