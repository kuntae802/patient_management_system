"""직원 계정·재직상태 통합 테스트 (AC1·2·3·4) — 실 Supabase Auth admin + DB + 감사 + ban.

로컬 스택(`supabase start` + `db reset`) + `SUPABASE_SECRET_KEY`(admin 프로비저닝용)가 없으면
skip. 검증:
  · admin 토큰으로 직원 생성 → auth.users + public.users + audit_logs(create, actor=admin)
  · 신규 직원 로그인 성공(active) → 휴직 전환 → 로그인 차단(GoTrue ban) → 복귀 → 로그인 복원
  · 사번 중복 → 409 + 보상(고아 Auth 미잔존), 자가-락아웃 → 409, doctor → 403

⚠️ 테스트는 `itest-1-8-*@pms.local` 직원을 만들고 끝에 auth.users 에서 삭제(→ users CASCADE)한다.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from tests.conftest import Psql

_API = os.getenv("SUPABASE_API_URL", "http://127.0.0.1:54321")
_PUBLISHABLE = os.getenv(
    "SUPABASE_PUBLISHABLE_KEY", "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
)
_USERS_URL = "/v1/admin/users"
_EMAIL_A = "itest-1-8-a@pms.local"
_EMAIL_B = "itest-1-8-b@pms.local"
_TEMP_PW = "Staff1234"
_EMAIL_LIKE = "itest-1-8-%@pms.local"


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
    token = _get_token("admin@pms.local", _TEMP_PW)
    if not token:
        pytest.skip("로컬 Supabase 스택/부트스트랩 미가용 — supabase start && db reset 후 재실행")
    return token


@pytest.fixture(scope="module")
def doctor_token() -> str:
    token = _get_token("doctor@pms.local", _TEMP_PW)
    if not token:
        pytest.skip("doctor 부트스트랩 계정 미가용 — 'supabase db reset' 후 재실행")
    return token


@pytest.fixture(scope="module")
def _require_secret() -> None:
    if not settings.supabase_secret_key:
        pytest.skip("SUPABASE_SECRET_KEY 미설정 — admin 프로비저닝 불가(env 설정 후 재실행)")


@pytest.fixture(scope="module")
def cleanup(psql: Psql) -> Iterator[None]:
    """테스트 직원을 전후로 정리(auth.users 삭제 → public.users CASCADE)."""
    psql.run(f"delete from auth.users where email like '{_EMAIL_LIKE}'")
    yield
    psql.run(f"delete from auth.users where email like '{_EMAIL_LIKE}'")


@pytest.fixture(scope="module")
def client(admin_token: str, _require_secret: None) -> Iterator[TestClient]:
    # with-블록 = lifespan(asyncpg 풀 + settings.validate_runtime). 풀 없이는 쓰기 불가.
    with TestClient(app) as test_client:
        yield test_client


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_body(*, email: str, employee_no: str, **over) -> dict:
    return {
        "employee_no": employee_no,
        "name": "통합테스트직원",
        "email": email,
        "password": _TEMP_PW,
        "role_code": "nurse",
        **over,
    }


def _post(client: TestClient, token: str, **body_kw):
    return client.post(_USERS_URL, headers=_bearer(token), json=_create_body(**body_kw))


def test_full_lifecycle(
    client: TestClient, admin_token: str, psql: Psql, cleanup: None
) -> None:
    # ── 생성 (AC1) ──
    res = _post(client, admin_token, email=_EMAIL_A, employee_no="ITEST18A")
    assert res.status_code == 201, res.text
    body = res.json()
    new_id = body["id"]
    assert body["employee_no"] == "ITEST18A"
    assert body["employment_status"] == "active"
    assert body["role_code"] == "nurse"
    assert "email" not in body and "password" not in body  # PII 비노출

    # auth.users + public.users 실제 생성
    assert psql.scalar(f"select count(*) from auth.users where email = '{_EMAIL_A}'") == "1"
    assert psql.scalar(f"select employee_no from public.users where id = '{new_id}'") == "ITEST18A"

    # 감사: create + actor = admin(EMP0001) (AC3)
    audit = psql.scalar(
        "select action || '|' || coalesce(actor_id::text,'') from audit_logs "
        f"where target_table = 'users' and target_id = '{new_id}' order by created_at desc limit 1"
    )
    action, actor = audit.split("|")
    assert action == "create"
    assert actor == psql.scalar("select id from users where employee_no = 'EMP0001'")

    # ── 신규 직원 로그인 성공(active) (AC1) ──
    assert _get_token(_EMAIL_A, _TEMP_PW) is not None

    # ── 휴직 전환 → 접근·로그인 차단 (AC2) ──
    res = client.patch(
        f"{_USERS_URL}/{new_id}/employment-status",
        headers=_bearer(admin_token),
        json={"employment_status": "on_leave"},
    )
    assert res.status_code == 200
    assert res.json()["employment_status"] == "on_leave"
    assert psql.scalar(f"select employment_status from users where id = '{new_id}'") == "on_leave"
    # 감사 update 기록
    assert (
        psql.scalar(
            "select action from audit_logs where target_table = 'users' "
            f"and target_id = '{new_id}' order by created_at desc limit 1"
        )
        == "update"
    )
    # GoTrue ban → 로그인 차단(신규 토큰 발급 실패)
    assert _get_token(_EMAIL_A, _TEMP_PW) is None

    # ── 복귀(active) → 로그인 복원 (AC2) ──
    res = client.patch(
        f"{_USERS_URL}/{new_id}/employment-status",
        headers=_bearer(admin_token),
        json={"employment_status": "active"},
    )
    assert res.status_code == 200
    assert _get_token(_EMAIL_A, _TEMP_PW) is not None  # unban → 로그인 복원


def test_list_includes_created(client: TestClient, admin_token: str, cleanup: None) -> None:
    res = client.get(_USERS_URL, headers=_bearer(admin_token))
    assert res.status_code == 200
    rows = res.json()
    # 부트스트랩 admin/doctor + 생성한 직원 포함, 전원 조회(RLS 우회 service_role)
    employee_nos = {r["employee_no"] for r in rows}
    assert {"EMP0001", "EMP0002"}.issubset(employee_nos)


def test_duplicate_employee_no_conflicts_and_compensates(
    client: TestClient, admin_token: str, psql: Psql, cleanup: None
) -> None:
    # 사번 ITEST18A 는 test_full_lifecycle 가 만들었을 수 있음 — 멱등 보장 위해 먼저 보장 생성.
    _post(client, admin_token, email=_EMAIL_A, employee_no="ITEST18A")
    # 다른 이메일 + 같은 사번 → 409 employee_no_taken + 보상(email_B Auth 미잔존)
    res = _post(client, admin_token, email=_EMAIL_B, employee_no="ITEST18A")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "employee_no_taken"
    # 보상 검증: email_B 의 Auth 사용자가 남지 않음(고아 없음)
    assert psql.scalar(f"select count(*) from auth.users where email = '{_EMAIL_B}'") == "0"


def test_duplicate_email_conflicts(client: TestClient, admin_token: str, cleanup: None) -> None:
    _post(client, admin_token, email=_EMAIL_A, employee_no="ITEST18A")
    # 같은 이메일 + 다른 사번 → GoTrue 단계에서 409 email_taken(DB 미도달)
    res = _post(client, admin_token, email=_EMAIL_A, employee_no="ITEST18C")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "email_taken"


def test_self_lockout_conflicts(client: TestClient, admin_token: str, psql: Psql) -> None:
    admin_id = psql.scalar("select id from users where employee_no = 'EMP0001'")
    res = client.patch(
        f"{_USERS_URL}/{admin_id}/employment-status",
        headers=_bearer(admin_token),
        json={"employment_status": "terminated"},
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "self_lockout"
    # 방어 확인: admin 은 여전히 active(실제로 바뀌지 않음)
    assert psql.scalar(f"select employment_status from users where id = '{admin_id}'") == "active"


def test_patient_role_unprocessable(client: TestClient, admin_token: str, cleanup: None) -> None:
    res = _post(
        client, admin_token,
        email="itest-1-8-p@pms.local", employee_no="ITEST18P", role_code="patient",
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_target"


def test_doctor_forbidden(client: TestClient, doctor_token: str, cleanup: None) -> None:
    # doctor 는 user.manage 미보유 → 403(쓰기 도달 전 게이트 차단).
    res = _post(client, doctor_token, email=_EMAIL_A, employee_no="ITEST18A")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"
