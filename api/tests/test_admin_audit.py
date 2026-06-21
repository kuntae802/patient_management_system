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
from app.services.audit import mask_snapshot

_MASK = "●●●● (마스킹됨)"

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


# ── Story 3.6: 감사 스냅샷 서버측 PII/건강민감 마스킹 ──────────────────────────────


def test_mask_snapshot_masks_sensitive_preserves_others() -> None:
    """환자 스냅샷: 식별 PII·건강민감·암호 컬럼은 마스킹, 비민감 식별자는 보존."""
    snap = {
        "id": "p1",
        "chart_no": "00000001",
        "name": "홍길동",
        "birth_date": "1990-01-01",
        "sex": "male",
        "phone": "010-1234-5678",
        "address": "서울시",
        "email": "a@b.com",
        "insurance_no": "X1",
        "allergies": "페니실린",
        "chronic_diseases": "고혈압",
        "medications": "와파린",
        "notes": "특이사항",
        "resident_no_enc": "\\xdead",
        "resident_no_hash": "abcd",
        "resident_no_masked": "900101-1******",
        "is_active": True,
    }
    out = mask_snapshot(snap, "patients")
    assert out is not None
    for key in (
        "name", "phone", "address", "email", "insurance_no",
        "allergies", "chronic_diseases", "medications", "notes",
        "resident_no_enc", "resident_no_hash", "resident_no_masked",
    ):
        assert out[key] == _MASK, f"{key} 미마스킹"
    # 비민감 식별자/플래그는 보존(감사 가독성).
    assert out["chart_no"] == "00000001"
    assert out["birth_date"] == "1990-01-01"
    assert out["sex"] == "male"
    assert out["is_active"] is True


def test_mask_snapshot_masks_soap_clinical_text() -> None:
    """medical_records 감사 스냅샷: SOAP 자유텍스트(S/O/A/P) 마스킹, 비민감 식별자 보존(4.6).

    0013 트리거가 SOAP 평문을 audit_logs 에 유입 → 읽기시점 마스킹이 4 컬럼을 가린다. 웹 거울
    (audit.ts SENSITIVE_KEY)도 동일 4종 마스킹(드리프트 가드 — 양쪽 test 단언)."""
    snap = {
        "id": "r1",
        "encounter_id": "e1",
        "author_id": "d1",
        "subjective": "두통 3일",
        "objective": "BP 140/90",
        "assessment": "고혈압 의증",
        "plan": "암로디핀 5mg",
        "is_active": True,
        "created_at": "2026-06-21T00:00:00Z",
    }
    out = mask_snapshot(snap, "medical_records")
    assert out is not None
    for key in ("subjective", "objective", "assessment", "plan"):
        assert out[key] == _MASK, f"{key} 미마스킹(SOAP 평문 누출)"
    # 비민감 식별자/플래그는 보존(diff 가독성).
    assert out["encounter_id"] == "e1"
    assert out["author_id"] == "d1"
    assert out["is_active"] is True
    assert out["created_at"] == "2026-06-21T00:00:00Z"


def test_mask_snapshot_name_is_table_aware() -> None:
    """`name` 은 환자/보호자만 PII — masters(진료과명)·roles 라벨은 보존(감사 가독성)."""
    # 환자/보호자: name 마스킹.
    assert mask_snapshot({"name": "홍길동"}, "patients")["name"] == _MASK
    assert mask_snapshot({"name": "보호자"}, "guardians")["name"] == _MASK
    # masters/roles: name 보존(비-PII 라벨). 단 항상-민감 키는 여전히 마스킹.
    dept = mask_snapshot({"name": "내과", "code": "IM"}, "departments")
    assert dept["name"] == "내과"
    assert dept["code"] == "IM"
    role = mask_snapshot({"name": "관리자", "code": "admin"}, "roles")
    assert role["name"] == "관리자"
    # target_table 미지정(중첩/미상)이면 name 보존(보수적 — 항상-민감 키만).
    assert mask_snapshot({"name": "x", "email": "a@b.com"})["name"] == "x"
    assert mask_snapshot({"name": "x", "email": "a@b.com"})["email"] == _MASK


def test_mask_snapshot_none_passthrough() -> None:
    assert mask_snapshot(None) is None


def test_mask_snapshot_recurses_nested() -> None:
    """비민감 컨테이너 안쪽의 민감 키도 재귀 마스킹(평문 덤프 차단)."""
    snap = {
        "meta": {"guardian": {"phone": "010-1-2"}, "label": "공개"},
        "items": [{"email": "x@y.z"}, {"label": "ok"}],
    }
    out = mask_snapshot(snap)
    assert out is not None
    assert out["meta"]["guardian"] == _MASK  # guardian 키 자체 민감 → 통째 마스킹
    assert out["meta"]["label"] == "공개"  # 비민감 보존
    assert out["items"][0]["email"] == _MASK
    assert out["items"][1]["label"] == "ok"


def test_list_masks_patient_snapshot_in_response(monkeypatch: pytest.MonkeyPatch) -> None:
    """응답 경로: 환자 스냅샷의 PII/건강민감이 마스킹되고 평문이 본문에 없다(AC1·2·3)."""
    row = {
        **_SAMPLE_ROW,
        "target_table": "patients",
        "before_data": {"name": "홍길동", "phone": "010-1234-5678", "chart_no": "00000001"},
        "after_data": {"name": "홍길동", "allergies": "페니실린", "chart_no": "00000001"},
    }
    res = _build(monkeypatch, rows=[row]).get(_URL)
    assert res.status_code == 200
    entry = res.json()["data"][0]
    assert entry["before_data"]["name"] == _MASK
    assert entry["before_data"]["phone"] == _MASK
    assert entry["before_data"]["chart_no"] == "00000001"  # 비민감 보존
    assert entry["after_data"]["allergies"] == _MASK
    # 평문 PII 가 응답 본문 어디에도 없다.
    assert "홍길동" not in res.text
    assert "010-1234-5678" not in res.text
    assert "페니실린" not in res.text
