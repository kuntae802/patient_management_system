"""admin RBAC grant 통합 테스트 (AC2·3·5) — 실 Supabase 토큰 + asyncpg 쓰기 + 감사 트리거 검증.

로컬 스택(`supabase start` + `db reset`)이 없으면 skip. 검증:
  · admin 토큰으로 reception 에 patient.read grant/revoke 사이클(멱등 포함)
  · 0004 트리거가 role_permissions 변경을 자동 감사(actor = 호출 admin) — psql 로 확인
  · admin 역할 대상 → 409(role_locked), patient → 422, doctor 토큰 → 403, 미존재 코드 → 404
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
_GRANT_URL = "/v1/admin/rbac/grants"
# 부트스트랩상 reception 은 권한 0개 → patient.read 비보유가 출발점(테스트가 grant/revoke 로 복원).
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
def client(admin_token: str):
    # with-블록 = lifespan 실행(asyncpg 풀 생성). 풀 없이는 권한 평가·쓰기 불가.
    with TestClient(app) as test_client:
        yield test_client


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _put(client: TestClient, token: str, **overrides):
    return client.put(_GRANT_URL, headers=_bearer(token), json={**_TARGET, **overrides})


def test_grant_revoke_cycle_and_audit(
    client: TestClient, admin_token: str, psql: Psql
) -> None:
    # 사전 정리: 이전 실패 잔여 grant 제거(멱등) → 깨끗한 출발점.
    _put(client, admin_token, granted=False)

    # grant → 200 · changed True
    res = _put(client, admin_token, granted=True)
    assert res.status_code == 200
    body = res.json()
    assert body == {
        "role_code": "reception",
        "permission_code": "patient.read",
        "granted": True,
        "changed": True,
    }

    # 멱등 재요청 → changed False(중복 grant 없음)
    assert _put(client, admin_token, granted=True).json()["changed"] is False

    # role_permissions 에 실제 행 존재(reception × patient.read)
    cnt = psql.scalar(
        "select count(*) from role_permissions rp "
        "join roles r on r.id = rp.role_id "
        "join permissions p on p.id = rp.permission_id "
        "where r.code = 'reception' and p.code = 'patient.read'"
    )
    assert cnt == "1"

    # 0004 트리거 자동 감사: 최근 role_permissions 감사가 create + actor = admin(EMP0001)
    audit = psql.scalar(
        "select action || '|' || coalesce(actor_id::text,'') from audit_logs "
        "where target_table = 'role_permissions' order by created_at desc limit 1"
    )
    action, actor = audit.split("|")
    assert action == "create"
    admin_id = psql.scalar("select id from users where employee_no = 'EMP0001'")
    assert actor == admin_id  # actor 캡처 계약(app.actor_id) 동작 확인

    # revoke → changed True, 재요청 → changed False(상태 복원)
    assert _put(client, admin_token, granted=False).json()["changed"] is True
    assert _put(client, admin_token, granted=False).json()["changed"] is False

    # 감사에 delete 기록
    last_action = psql.scalar(
        "select action from audit_logs where target_table = 'role_permissions' "
        "order by created_at desc limit 1"
    )
    assert last_action == "delete"


def test_admin_target_locked(client: TestClient, admin_token: str) -> None:
    res = _put(client, admin_token, role_code="admin", granted=True)
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "role_locked"


def test_patient_target_unprocessable(client: TestClient, admin_token: str) -> None:
    res = _put(client, admin_token, role_code="patient", granted=True)
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_target"


def test_unknown_permission_not_found(client: TestClient, admin_token: str) -> None:
    res = _put(client, admin_token, permission_code="nope.nope", granted=True)
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "not_found"


def test_doctor_forbidden(client: TestClient, doctor_token: str) -> None:
    # doctor 는 rbac.manage 미보유 → 403(쓰기 도달 전 게이트 차단).
    res = _put(client, doctor_token, granted=True)
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"
