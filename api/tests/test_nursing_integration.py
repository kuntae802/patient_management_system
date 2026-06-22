"""간호 활력징후 기록·조회·워크리스트(Story 5.6 AC1~3) 통합 테스트 — FastAPI TestClient + 0017.

실 Supabase 토큰 + 0017 스키마. 로컬 스택/부트스트랩 없으면 skip. 검증:
  · AC1(FR-091): 간호사가 활력(혈압·맥박·체온·호흡·SpO2) 기록 → 201 + recorded_by=nurse + 내원 연결.
         항목별 선택(부분 측정 201) + 최소 1개 강제(전부 빈 값 422) + 범위(Pydantic 422). body_temp
         numeric → float 라운드트립. 미존재 내원 404. 감사(create).
  · AC2(FR-032): 기록된 활력 조회 — doctor(encounter.read) 200·nurse(vital.record) 200(require_any).
  · AC3: 활력 워크리스트(오늘 활성 내원) — nurse 200(walk-in 노출·latest_vital 갱신).
  · 권한: 기록 403 baseline = reception(권한 0) + doctor(encounter.read 有·vital.record 無 =
         read-yes/record-no). 워크리스트 403 = reception + doctor(vital.record 無).

⚠️ 생성행은 잔존(db reset 이 초기화). 주민번호는 매 실행 고유값.
"""

from __future__ import annotations

import itertools
import os
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import Psql

_API = os.getenv("SUPABASE_API_URL", "http://127.0.0.1:54321")
_PUBLISHABLE = os.getenv(
    "SUPABASE_PUBLISHABLE_KEY", "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
)
_ENCOUNTERS_URL = "/v1/encounters"
_PATIENTS_URL = "/v1/patients"
_WORKLIST_URL = "/v1/nursing/vitals-worklist"

_FULL_VITALS = {
    "systolic": 120,
    "diastolic": 80,
    "pulse": 72,
    "body_temp": 36.5,
    "respiratory_rate": 16,
    "spo2": 98,
}


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
def nurse_token() -> str:
    """활력 기록 골든 패스 — nurse 는 vital.record(5.6 seed grant) 보유."""
    token = _get_token("nurse@pms.local", "Staff1234")
    if not token:
        pytest.skip("nurse 부트스트랩 미가용 — 'supabase db reset'(seed 갱신) 후 재실행")
    return token


@pytest.fixture(scope="module")
def doctor_token() -> str:
    """read-yes/record-no — doctor 는 encounter.read(4.4 seed) 보유·vital.record 미보유."""
    token = _get_token("doctor@pms.local", "Staff1234")
    if not token:
        pytest.skip("doctor 부트스트랩 미가용 — 'supabase db reset'(seed 갱신) 후 재실행")
    return token


@pytest.fixture(scope="module")
def reception_token() -> str:
    """활력 403 baseline — reception 은 vital.record 미보유(encounter.read 는 有 → GET 200)."""
    token = _get_token("reception@pms.local", "Staff1234")
    if not token:
        pytest.skip("reception 부트스트랩 미가용 — 'supabase db reset'(seed 갱신) 후 재실행")
    return token


@pytest.fixture(scope="module")
def client(admin_token: str):
    # with-블록 = lifespan 실행(asyncpg 풀 생성).
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def nurse_id(psql: Psql) -> str:
    """nurse auth uid — recorded_by(기록 간호사) 단언 기준."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'nurse' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def dept_id(psql: Psql) -> str:
    """시드 진료과(내과 IM) id."""
    return psql.scalar("select id::text from public.departments where lower(code) = 'im' limit 1")


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


_RRN_BASE = uuid.uuid4().int % 1_000_000
_rrn_seq = itertools.count()


def _unique_rrn() -> str:
    tail = (_RRN_BASE + next(_rrn_seq)) % 1_000_000
    return f"9001011{tail:06d}"


def _create_patient(client: TestClient, token: str) -> str:
    res = client.post(
        _PATIENTS_URL,
        json={
            "resident_no": _unique_rrn(),
            "name": "활력테스트환자",
            "phone": "010-1234-5678",
            "insurance_type": "health_insurance",
        },
        headers=_bearer(token),
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _walk_in(client: TestClient, admin_token: str, dept_id: str) -> str:
    """환자 + walk-in 내원 생성 → 내원 id(registered 상태 = 활력 워크리스트 노출 대상)."""
    pid = _create_patient(client, admin_token)
    res = client.post(
        _ENCOUNTERS_URL,
        json={"patient_id": pid, "department_id": dept_id},
        headers=_bearer(admin_token),
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _vitals_url(eid: str) -> str:
    return f"{_ENCOUNTERS_URL}/{eid}/vitals"


# ── AC1: 활력징후 기록(전체·부분·최소1개·범위·미존재) ──────────────────────────


def test_create_vitals_golden_path(client, admin_token, nurse_token, nurse_id, dept_id):
    """nurse → 201 + 6 항목 echo + recorded_by=nurse + recorded_by_name. body_temp numeric→float."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(_vitals_url(eid), json=_FULL_VITALS, headers=_bearer(nurse_token))
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["encounter_id"] == eid
    assert body["systolic"] == 120
    assert body["diastolic"] == 80
    assert body["pulse"] == 72
    assert body["body_temp"] == 36.5  # numeric(4,1) → JSON number 라운드트립
    assert body["respiratory_rate"] == 16
    assert body["spo2"] == 98
    assert body["recorded_by"] == nurse_id
    assert body["recorded_by_name"]  # users 조인(측정자명 비어있지 않음)
    assert body["is_active"] is True


def test_create_vitals_partial(client, admin_token, nurse_token, dept_id):
    """부분 측정(혈압+체온만) → 201 + 나머지 None(항목별 선택)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _vitals_url(eid),
        json={"systolic": 110, "diastolic": 70, "body_temp": 37.2},
        headers=_bearer(nurse_token),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["systolic"] == 110
    assert body["body_temp"] == 37.2
    assert body["pulse"] is None
    assert body["respiratory_rate"] is None
    assert body["spo2"] is None


def test_create_vitals_all_empty_422(client, admin_token, nurse_token, dept_id):
    """전부 빈 값 → 422(Pydantic model_validator 최소-1개)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(_vitals_url(eid), json={"notes": "메모만"}, headers=_bearer(nurse_token))
    assert res.status_code == 422, res.text


def test_create_vitals_out_of_range_422(client, admin_token, nurse_token, dept_id):
    """범위 초과(spo2=200) → 422(Pydantic Field le=100)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(_vitals_url(eid), json={"spo2": 200}, headers=_bearer(nurse_token))
    assert res.status_code == 422, res.text


def test_create_vitals_nonexistent_encounter_404(client, nurse_token):
    """미존재 내원에 기록 → 404."""
    res = client.post(
        _vitals_url(str(uuid.uuid4())), json=_FULL_VITALS, headers=_bearer(nurse_token)
    )
    assert res.status_code == 404, res.text


# ── AC1 권한: 기록 403 baseline(reception·doctor) ──────────────────────────────


def test_create_vitals_forbidden_reception_403(client, admin_token, reception_token, dept_id):
    """reception(vital.record 미보유) → 기록 403."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(_vitals_url(eid), json=_FULL_VITALS, headers=_bearer(reception_token))
    assert res.status_code == 403, res.text


def test_create_vitals_forbidden_doctor_403(client, admin_token, doctor_token, dept_id):
    """doctor(encounter.read 보유·vital.record 미보유 = read-yes/record-no) → 기록 403."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(_vitals_url(eid), json=_FULL_VITALS, headers=_bearer(doctor_token))
    assert res.status_code == 403, res.text


# ── AC2: 활력 조회(doctor encounter.read · nurse vital.record — require_any) ────


def test_list_vitals_doctor_can_read(client, admin_token, nurse_token, doctor_token, dept_id):
    """doctor(encounter.read) → 조회 200 + 방금 기록한 활력 노출(FR-032 진료 허브)."""
    eid = _walk_in(client, admin_token, dept_id)
    post = client.post(_vitals_url(eid), json=_FULL_VITALS, headers=_bearer(nurse_token))
    assert post.status_code == 201, post.text
    res = client.get(_vitals_url(eid), headers=_bearer(doctor_token))
    assert res.status_code == 200, res.text
    rows = res.json()
    assert len(rows) == 1
    assert rows[0]["systolic"] == 120
    assert rows[0]["spo2"] == 98


def test_list_vitals_nurse_can_read(client, admin_token, nurse_token, dept_id):
    """nurse(vital.record) → 조회 200(require_any 의 다른 분기)."""
    eid = _walk_in(client, admin_token, dept_id)
    client.post(_vitals_url(eid), json={"pulse": 88}, headers=_bearer(nurse_token))
    res = client.get(_vitals_url(eid), headers=_bearer(nurse_token))
    assert res.status_code == 200, res.text
    assert res.json()[0]["pulse"] == 88


def test_list_vitals_latest_first(client, admin_token, nurse_token, dept_id):
    """다중 측정 → 최신순(recorded_at desc) 정렬."""
    eid = _walk_in(client, admin_token, dept_id)
    client.post(_vitals_url(eid), json={"spo2": 95}, headers=_bearer(nurse_token))
    client.post(_vitals_url(eid), json={"spo2": 99}, headers=_bearer(nurse_token))
    res = client.get(_vitals_url(eid), headers=_bearer(nurse_token))
    assert res.status_code == 200, res.text
    rows = res.json()
    assert len(rows) == 2
    assert rows[0]["spo2"] == 99  # 최신 먼저


# ── AC3: 활력 워크리스트(오늘 활성 내원 + 권한) ───────────────────────────────


def test_vitals_worklist_nurse_lists_active(client, admin_token, nurse_token, dept_id):
    """nurse → 200 + 오늘 walk-in 내원 노출 + 기록 후 latest_vital_recorded_at 갱신."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.get(_WORKLIST_URL, headers=_bearer(nurse_token))
    assert res.status_code == 200, res.text
    rows = res.json()
    item = next((r for r in rows if r["encounter_id"] == eid), None)
    assert item is not None, "오늘 활성 내원이 워크리스트에 없음"
    assert item["status"] == "registered"
    assert item["patient_name"]
    assert item["chart_no"]
    assert item["department_name"]
    assert item["latest_vital_recorded_at"] is None  # 측정 전

    client.post(_vitals_url(eid), json={"body_temp": 36.8}, headers=_bearer(nurse_token))
    res2 = client.get(_WORKLIST_URL, headers=_bearer(nurse_token))
    item2 = next((r for r in res2.json() if r["encounter_id"] == eid), None)
    assert item2 is not None
    assert item2["latest_vital_recorded_at"] is not None  # 측정 후 갱신


def test_vitals_worklist_forbidden_reception_403(client, reception_token):
    """reception(vital.record 미보유) → 워크리스트 403."""
    res = client.get(_WORKLIST_URL, headers=_bearer(reception_token))
    assert res.status_code == 403, res.text


def test_vitals_worklist_forbidden_doctor_403(client, doctor_token):
    """doctor(vital.record 미보유) → 워크리스트 403."""
    res = client.get(_WORKLIST_URL, headers=_bearer(doctor_token))
    assert res.status_code == 403, res.text


# ── 감사: 기록 → audit_logs create 행(0017 트리거) ─────────────────────────────


def test_create_vitals_audit(client, admin_token, nurse_token, dept_id, psql: Psql):
    """기록 → audit_logs action='create' 행(vital_signs, 0017 트리거)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(_vitals_url(eid), json=_FULL_VITALS, headers=_bearer(nurse_token))
    assert res.status_code == 201, res.text
    vsid = res.json()["id"]
    count = psql.scalar(
        "select count(*) from public.audit_logs "
        f"where target_table='vital_signs' and target_id='{vsid}' and action='create';"
    )
    assert int(count) == 1
