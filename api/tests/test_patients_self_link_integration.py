"""환자 앱 자가가입 본인 연결(Story 3.4 AC1·2·3) 통합 테스트 — 실 Supabase signup + asyncpg + 0009.

로컬 스택 + 환자 공개 가입(`enable_signup=true`, config 재활성 후 `supabase stop && supabase start`
적용) + 부트스트랩 직원 계정이 필요하다. 미가용 시 skip(다른 통합 테스트와 동일 posture). 검증:
  · AC2 연결: 미연결 환자 + 본인 가입 → self-link 200 + auth_uid=본인 sub DB 영속 + 응답 PII 경계
  · AC2 멱등: 재호출(하이픈 변형) → 200(auth_uid 불변)
  · AC3 폴백: 미존재 404 / 성명불일치 422(연결 안 함) / 타계정 선점 409 / 계정 중복 409
  · 권한: 직원 토큰 → 403(self-link·get_self) / HARD RRN → 422
  · 세션 uid 스코프: 연결된 auth_uid == 토큰 주체(클라가 uid 미제공)

⚠️ 가입한 auth.users·연결 행은 잔존(db reset 이 초기화). 이메일·주민번호는 매 실행 고유값.
"""

from __future__ import annotations

import os
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import Psql
from tests.test_patients_integration import _bearer, _get_token, _unique_rrn

_API = os.getenv("SUPABASE_API_URL", "http://127.0.0.1:54321")
_PUBLISHABLE = os.getenv(
    "SUPABASE_PUBLISHABLE_KEY", "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
)
_PATIENTS_URL = "/v1/patients"
_SELF_LINK_URL = "/v1/patients/self-link"
_SELF_URL = "/v1/patients/self"
_PATIENT_PASSWORD = "Patient1234"  # config 정책: 8자+소·대문자+숫자


def _signup_patient(email: str) -> tuple[str, str] | None:
    """공개 가입(enable_signup) → (access_token, uid). 가입 비활성/스택 미가용 → None(skip)."""
    try:
        res = httpx.post(
            f"{_API}/auth/v1/signup",
            headers={"apikey": _PUBLISHABLE, "Content-Type": "application/json"},
            json={"email": email, "password": _PATIENT_PASSWORD},
            timeout=10.0,
        )
    except httpx.HTTPError:
        return None
    if res.status_code != 200:
        return None  # 가입 비활성(403/422) 등 — 호출자가 skip
    body = res.json()
    token = body.get("access_token")
    uid = (body.get("user") or {}).get("id")
    if not token or not uid:
        return None
    return token, uid


def _new_patient_email() -> str:
    return f"selflink-{uuid.uuid4().hex[:12]}@pms.local"


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
        pytest.skip("doctor 부트스트랩 계정 미가용 — 'supabase db reset' 후 재실행")
    return token


@pytest.fixture(scope="module")
def client(admin_token: str):
    # with-블록 = lifespan(asyncpg 풀) 실행.
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def patient_session() -> tuple[str, str]:
    """매 테스트 새 환자 공개 가입 → (token, uid). 가입 비활성 시 skip."""
    sess = _signup_patient(_new_patient_email())
    if sess is None:
        pytest.skip(
            "환자 공개 가입(enable_signup) 미가용 — config 재활성 + supabase stop/start 후 재실행"
        )
    return sess


def _create_unlinked_patient(client: TestClient, admin_token: str, *, rrn: str, name: str) -> str:
    """원무(admin)가 미연결(auth_uid=NULL) 환자 레코드 생성 → patient_id."""
    payload = {"resident_no": rrn, "name": name, "insurance_type": "health_insurance"}
    res = client.post(_PATIENTS_URL, json=payload, headers=_bearer(admin_token))
    assert res.status_code == 201, res.text
    return res.json()["id"]


# ── AC2: 연결 + 세션 uid 스코프 + PII 경계 ────────────────────────────────────


def test_self_link_links_unlinked_record(client, admin_token, patient_session, psql: Psql):
    token, uid = patient_session
    rrn = _unique_rrn()
    pid = _create_unlinked_patient(client, admin_token, rrn=rrn, name="홍길동")

    res = client.post(
        _SELF_LINK_URL, json={"resident_no": rrn, "name": "홍길동"}, headers=_bearer(token)
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["chart_no"] and body["resident_no_masked"].endswith("******")
    assert body["name"] == "홍길동"
    # PII 경계: 마스킹만 — auth_uid·암호문·blind index 미노출.
    assert "auth_uid" not in body
    assert "resident_no_enc" not in body
    assert "resident_no_hash" not in body
    assert rrn not in res.text

    # 세션 uid 스코프: 연결 auth_uid == 토큰 주체(uid), DB 영속(응답 echo 아님).
    linked = psql.scalar(f"select auth_uid::text from public.patients where id='{pid}'")
    assert linked.lower() == uid.lower()


def test_self_link_idempotent_on_hyphen_variant(client, admin_token, patient_session, psql: Psql):
    token, uid = patient_session
    rrn = _unique_rrn()
    _create_unlinked_patient(client, admin_token, rrn=rrn, name="홍길동")

    first = client.post(
        _SELF_LINK_URL, json={"resident_no": rrn, "name": "홍길동"}, headers=_bearer(token)
    )
    assert first.status_code == 200, first.text

    # 하이픈 변형 재호출 → 정규화 동일 → 멱등(같은 본인 = already_linked, 200).
    hyphenated = f"{rrn[:6]}-{rrn[6:]}"
    second = client.post(
        _SELF_LINK_URL, json={"resident_no": hyphenated, "name": "홍길동"}, headers=_bearer(token)
    )
    assert second.status_code == 200, second.text

    # 본인 계정에 연결된 환자는 정확히 1행(중복 연결 없음).
    cnt = psql.scalar(f"select count(*) from public.patients where auth_uid='{uid}'")
    assert cnt == "1"


# ── AC3: 안전 폴백(미존재·성명불일치·연결충돌) ────────────────────────────────


def test_self_link_no_patient_record_404(client, patient_session):
    token, _ = patient_session
    res = client.post(
        _SELF_LINK_URL,
        json={"resident_no": _unique_rrn(), "name": "아무개"},
        headers=_bearer(token),
    )
    assert res.status_code == 404, res.text
    assert res.json()["error"]["code"] == "no_patient_record"


def test_self_link_name_mismatch_422_does_not_link(
    client, admin_token, patient_session, psql: Psql
):
    token, _ = patient_session
    rrn = _unique_rrn()
    pid = _create_unlinked_patient(client, admin_token, rrn=rrn, name="김철수")

    res = client.post(
        _SELF_LINK_URL, json={"resident_no": rrn, "name": "다른이름"}, headers=_bearer(token)
    )
    assert res.status_code == 422, res.text
    assert res.json()["error"]["code"] == "identity_mismatch"
    # 사칭 방지: 성명 불일치면 연결하지 않는다(auth_uid 여전히 NULL).
    auth_uid = psql.scalar(
        f"select coalesce(auth_uid::text,'NULL') from public.patients where id='{pid}'"
    )
    assert auth_uid == "NULL"


def test_self_link_already_linked_other_409(client, admin_token, patient_session):
    token1, _ = patient_session
    rrn = _unique_rrn()
    _create_unlinked_patient(client, admin_token, rrn=rrn, name="이영희")

    first = client.post(
        _SELF_LINK_URL, json={"resident_no": rrn, "name": "이영희"}, headers=_bearer(token1)
    )
    assert first.status_code == 200, first.text

    # 다른 계정이 같은(이미 연결된) 레코드 연결 시도 → 409(탈취 차단).
    sess2 = _signup_patient(_new_patient_email())
    assert sess2 is not None, "둘째 환자 가입 실패"
    token2, _ = sess2
    res = client.post(
        _SELF_LINK_URL, json={"resident_no": rrn, "name": "이영희"}, headers=_bearer(token2)
    )
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "already_linked_other"


def test_self_link_account_already_linked_409(client, admin_token, patient_session):
    token, _ = patient_session
    rrn_a = _unique_rrn()
    _create_unlinked_patient(client, admin_token, rrn=rrn_a, name="박민수")
    first = client.post(
        _SELF_LINK_URL, json={"resident_no": rrn_a, "name": "박민수"}, headers=_bearer(token)
    )
    assert first.status_code == 200, first.text

    # 같은 계정이 또 다른 환자에 연결 시도 → 409(1 계정 = 1 환자).
    rrn_b = _unique_rrn()
    _create_unlinked_patient(client, admin_token, rrn=rrn_b, name="최지우")
    res = client.post(
        _SELF_LINK_URL, json={"resident_no": rrn_b, "name": "최지우"}, headers=_bearer(token)
    )
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "account_already_linked"


# ── 권한·검증 ──────────────────────────────────────────────────────────────────


def test_self_link_staff_forbidden_403(client, doctor_token):
    """직원(active 5역할)은 self-link 불가 — 직원 uid 가 환자 행에 묻는 것 방지."""
    res = client.post(
        _SELF_LINK_URL,
        json={"resident_no": _unique_rrn(), "name": "홍길동"},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 403, res.text


def test_self_link_hard_invalid_rrn_422(client, patient_session):
    token, _ = patient_session
    res = client.post(
        _SELF_LINK_URL,
        json={"resident_no": "900101-9234567", "name": "홍길동"},  # 성별·세기 자리 9 = HARD
        headers=_bearer(token),
    )
    assert res.status_code == 422, res.text
    assert res.json()["error"]["code"] == "invalid_rrn"


# ── GET /self (연결 전/후) ──────────────────────────────────────────────────────


def test_get_self_404_before_and_summary_after_link(client, admin_token, patient_session):
    token, _ = patient_session
    before = client.get(_SELF_URL, headers=_bearer(token))
    assert before.status_code == 404, before.text
    assert before.json()["error"]["code"] == "no_self_patient"

    rrn = _unique_rrn()
    _create_unlinked_patient(client, admin_token, rrn=rrn, name="정수민")
    link = client.post(
        _SELF_LINK_URL, json={"resident_no": rrn, "name": "정수민"}, headers=_bearer(token)
    )
    assert link.status_code == 200, link.text

    after = client.get(_SELF_URL, headers=_bearer(token))
    assert after.status_code == 200, after.text
    assert after.json()["name"] == "정수민"


def test_get_self_staff_forbidden_403(client, doctor_token):
    res = client.get(_SELF_URL, headers=_bearer(doctor_token))
    assert res.status_code == 403, res.text
