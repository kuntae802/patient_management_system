"""감사 로그 조회 통합 테스트 (Story 1.10 AC1·2·3) — 실 Supabase 토큰 + asyncpg + 0004 감사 트리거.

로컬 스택(`supabase start` + `db reset`)/부트스트랩 계정이 없으면 skip. 검증:
  · AC1: admin 토큰 조회 200 + {data,meta} 봉투 · 필터(action·target·기간) · 페이지네이션
  · AC1: 비-admin(doctor) → 403(audit.read 미보유)
  · AC2: create=before null·after 스냅샷, delete=after null·before 스냅샷(diff 뷰어 백킹 데이터)
  · AC3: 관리자 본인의 RBAC 변경(grant/revoke)이 actor=admin 으로 빠짐없이 기록·조회됨
         + actor 이름이 users 조인으로 해석됨

⚠️ append-only 라 테스트가 만든 'create'/'delete' 감사행은 잔존한다(정리 불가, db reset 이 초기화).
   교차 실행 간섭을 피하려고 정확한 카운트가 아니라 actor_id 일치·필터 정합으로 단언한다.
"""

from __future__ import annotations

import os

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import Psql

_API = os.getenv("SUPABASE_API_URL", "http://127.0.0.1:54321")
_PUBLISHABLE = os.getenv(
    "SUPABASE_PUBLISHABLE_KEY", "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
)
_AUDIT_URL = "/v1/admin/audit-logs"
_GRANT_URL = "/v1/admin/rbac/grants"
# 부트스트랩상 reception 은 권한 0개 → patient.read grant/revoke 로 role_permissions 변경을 유발.
_TARGET = {"role_code": "reception", "permission_code": "patient.read"}


def _get_token(email: str, password: str) -> str | None:
    try:
        res = httpx.post(
            f"{_API}/auth/v1/token",
            params={"grant_type": "password"},
            headers={"apikey": _PUBLISHABLE, "Content-Type": "application/json"},
            json={"email": email, "password": password},
            timeout=10.0,
        )
    except httpx.HTTPError:
        return None
    if res.status_code != 200:
        return None
    return res.json().get("access_token")


@pytest.fixture(scope="module")
def admin_token() -> str:
    token = _get_token("admin@pms.local", "Staff1234")
    if not token:
        pytest.skip("로컬 Supabase 스택/부트스트랩 미가용 — supabase start && db reset 후 재실행")
    return token


@pytest.fixture(scope="module")
def doctor_token() -> str:
    token = _get_token("doctor@pms.local", "Staff1234")
    if not token:
        pytest.skip("doctor 부트스트랩 계정 미가용 — 'supabase db reset'(seed 갱신) 후 재실행")
    return token


@pytest.fixture(scope="module")
def admin_id(psql: Psql) -> str:
    """관리자 auth uid(= 감사 actor). create/delete 감사가 '관리자 본인'인지 단정하는 기준(AC3)."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'admin' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def client(admin_token: str):
    # with-블록 = lifespan 실행(asyncpg 풀 생성). 풀 없이는 권한 평가·조회 불가.
    with TestClient(app) as test_client:
        yield test_client


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_admin_list_ok_doctor_forbidden(
    client: TestClient, admin_token: str, doctor_token: str
) -> None:
    """AC1: admin 조회 200 + 봉투 셰이프 · page_size 반영. 비-admin(doctor) → 403."""
    ok = client.get(_AUDIT_URL, headers=_bearer(admin_token), params={"page_size": 5})
    assert ok.status_code == 200
    body = ok.json()
    assert set(body.keys()) == {"data", "meta"}
    assert body["meta"]["page_size"] == 5
    assert body["meta"]["page"] == 1
    assert len(body["data"]) <= 5

    forbidden = client.get(_AUDIT_URL, headers=_bearer(doctor_token), params={"page_size": 5})
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "forbidden"


def test_admin_own_rbac_change_audited_and_visible(
    client: TestClient, admin_token: str, admin_id: str
) -> None:
    """AC3+AC1+AC2: 관리자 본인의 grant(create)/revoke(delete)가 actor=admin 으로 기록·조회됨."""
    # cleanup → grant(create)
    client.put(_GRANT_URL, headers=_bearer(admin_token), json={**_TARGET, "granted": False})
    grant = client.put(_GRANT_URL, headers=_bearer(admin_token), json={**_TARGET, "granted": True})
    assert grant.status_code == 200 and grant.json()["changed"] is True

    res = client.get(
        _AUDIT_URL,
        headers=_bearer(admin_token),
        params={"target_table": "role_permissions", "action": "create", "page_size": 20},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["meta"]["total"] >= 1
    mine = [e for e in body["data"] if (e["actor_id"] or "").lower() == admin_id]
    assert mine, "관리자 본인 actor 의 role_permissions create 감사가 없음(AC3 위반)"
    entry = mine[0]  # 최신순 → 방금 만든 grant
    assert entry["actor_name"], "actor 이름이 users 조인으로 해석되지 않음(AC1)"
    assert entry["before_data"] is None  # create → before 없음(AC2)
    assert entry["after_data"] and "role_id" in entry["after_data"]
    assert "permission_id" in entry["after_data"]
    assert entry["action"] == "create" and entry["target_table"] == "role_permissions"

    # revoke(delete) → before 스냅샷·after null
    client.put(_GRANT_URL, headers=_bearer(admin_token), json={**_TARGET, "granted": False})
    res2 = client.get(
        _AUDIT_URL,
        headers=_bearer(admin_token),
        params={"target_table": "role_permissions", "action": "delete", "page_size": 20},
    )
    del_mine = [e for e in res2.json()["data"] if (e["actor_id"] or "").lower() == admin_id]
    assert del_mine, "관리자 본인 actor 의 role_permissions delete 감사가 없음(AC3 위반)"
    assert del_mine[0]["after_data"] is None  # delete → after 없음(AC2)
    assert del_mine[0]["before_data"], "delete 전 스냅샷이 없음(AC2)"


def test_filter_action_returns_only_matching(client: TestClient, admin_token: str) -> None:
    """AC1: action 필터는 해당 동작만 반환한다."""
    res = client.get(
        _AUDIT_URL, headers=_bearer(admin_token), params={"action": "create", "page_size": 50}
    )
    assert res.status_code == 200
    assert all(e["action"] == "create" for e in res.json()["data"])


def test_filter_target_returns_only_matching(client: TestClient, admin_token: str) -> None:
    """AC1: target_table 필터는 해당 대상만 반환한다."""
    res = client.get(
        _AUDIT_URL,
        headers=_bearer(admin_token),
        params={"target_table": "role_permissions", "page_size": 50},
    )
    assert res.status_code == 200
    assert all(e["target_table"] == "role_permissions" for e in res.json()["data"])


def test_future_date_filter_empty(client: TestClient, admin_token: str) -> None:
    """AC1: 미래 기간 필터 → 0건(기간 필터 동작 확인)."""
    res = client.get(
        _AUDIT_URL,
        headers=_bearer(admin_token),
        params={"date_from": "2099-01-01T00:00:00+09:00"},
    )
    assert res.status_code == 200
    assert res.json()["meta"]["total"] == 0
    assert res.json()["data"] == []


def test_pagination_meta(client: TestClient, admin_token: str) -> None:
    """AC1: 페이지네이션 메타(page·page_size·total) 정합 + data 길이 ≤ page_size."""
    res = client.get(
        _AUDIT_URL, headers=_bearer(admin_token), params={"page": 1, "page_size": 2}
    )
    assert res.status_code == 200
    meta = res.json()["meta"]
    assert meta["page"] == 1 and meta["page_size"] == 2
    assert len(res.json()["data"]) <= 2
    assert meta["total"] >= len(res.json()["data"])
