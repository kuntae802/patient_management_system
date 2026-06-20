"""인증·권한 통합 테스트 (AC8) — 실 Supabase 로컬 스택의 ES256 토큰 + asyncpg DB 평가.

로컬 스택(`supabase start` + `db reset`)이 없으면 skip. 401/403/200 매트릭스를 실증:
  · 무토큰 → 401
  · admin 토큰 → /auth/me 200(role=admin) · /auth/check 200(rbac.manage 보유)
  · doctor 토큰(권한 0) → /auth/check 403
"""

from __future__ import annotations

import os

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app

# 로컬 supabase 고정 기본값(`supabase status`). 환경변수로 override 가능.
_API = os.getenv("SUPABASE_API_URL", "http://127.0.0.1:54321")
_PUBLISHABLE = os.getenv(
    "SUPABASE_PUBLISHABLE_KEY", "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
)


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
    # with-블록 = lifespan 실행(asyncpg 풀 생성). 풀 없이는 권한 평가 불가.
    with TestClient(app) as test_client:
        yield test_client


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_no_token_returns_401(client: TestClient) -> None:
    res = client.get("/v1/auth/me")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthenticated"


def test_forged_token_returns_401(client: TestClient) -> None:
    # 실 PyJWKClient 경로에서 위조/malformed 토큰은 401(500 아님) — DecodeError 폴백 회귀 가드.
    res = client.get("/v1/auth/me", headers=_bearer("eyJhbGciOiJFUzI1NiJ9.fake.sig"))
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthenticated"


def test_admin_me_returns_identity(client: TestClient, admin_token: str) -> None:
    res = client.get("/v1/auth/me", headers=_bearer(admin_token))
    assert res.status_code == 200
    body = res.json()
    assert body["role"] == "admin"
    assert body["is_staff"] is True
    assert body["employee_no"] == "EMP0001"
    # snake_case 필드 계약(AC3)
    assert set(body.keys()) == {"sub", "role", "is_staff", "employee_no", "name"}


def test_admin_permission_check_passes(client: TestClient, admin_token: str) -> None:
    res = client.get("/v1/auth/check", headers=_bearer(admin_token))
    assert res.status_code == 200
    assert res.json() == {"permission": "rbac.manage", "allowed": True}


def test_doctor_permission_check_forbidden(client: TestClient, doctor_token: str) -> None:
    res = client.get("/v1/auth/check", headers=_bearer(doctor_token))
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


def test_doctor_me_is_staff(client: TestClient, doctor_token: str) -> None:
    res = client.get("/v1/auth/me", headers=_bearer(doctor_token))
    assert res.status_code == 200
    body = res.json()
    assert body["role"] == "doctor"
    assert body["is_staff"] is True
