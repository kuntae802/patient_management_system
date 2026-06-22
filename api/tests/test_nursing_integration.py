"""간호 활력징후·처치 수행·간호기록·워크리스트(Story 5.6·5.7) 통합 테스트 — TestClient + 0017·0018.

실 Supabase 토큰 + 0017/0018 스키마. 로컬 스택/부트스트랩 없으면 skip. 검증:
  · 5.6 AC1(FR-091): 활력 기록 201 + recorded_by=nurse + 부분/최소1개/범위/404/감사.
  · 5.6 AC2(FR-032): 활력 조회 — doctor(encounter.read) 200·nurse(vital.record) 200(require_any).
  · 5.6 AC3: 활력 워크리스트 — nurse 200(walk-in 노출·latest_vital 갱신).
  · 5.7 AC1(FR-090·FR-092): 처치 수행 — doctor 오더 → nurse perform 200(status=performed·
         performed_by=nurse·performed_at). content 첨부 → 연결 nursing_record. 미존재 404.
  · 5.7 AC2(FR-093): 재수행 → 409 invalid_transition(상태머신 최종선).
  · 5.7 AC3(FR-094): 일상 간호기록 — nurse 201(treatment_order_id None)·빈값 422·조회·감사.
  · 권한: 활력 기록 403 = reception + doctor(read-yes/record-no). 처치 수행 403 = reception +
         doctor(treatment.order 有·treatment.perform 無). 간호기록 403 = reception + doctor.
         워크리스트 403 = reception + doctor(treatment.perform·nursing.record 無).

⚠️ 생성행 잔존(db reset 초기화)·주민번호 매 실행 고유. ⚠️ DB 검증='db reset && pytest' 원자 실행.
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
_NURSING_WORKLIST_URL = "/v1/nursing/worklist"

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


@pytest.fixture(scope="module")
def treatment_fee_id(psql: Psql) -> str:
    """시드 EDI 처치 행위(드레싱 M0030) id — 처치 오더 생성 fee_schedule_id."""
    return psql.scalar("select id::text from public.fee_schedules where code = 'M0030' limit 1")


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


def _treatment_orders_url(eid: str) -> str:
    return f"{_ENCOUNTERS_URL}/{eid}/treatment-orders"


def _perform_url(eid: str, oid: str) -> str:
    return f"{_ENCOUNTERS_URL}/{eid}/treatment-orders/{oid}/perform"


def _nursing_records_url(eid: str) -> str:
    return f"{_ENCOUNTERS_URL}/{eid}/nursing-records"


def _create_treatment_order(client: TestClient, doctor_token: str, eid: str, fee_id: str) -> str:
    """doctor 가 처치 오더 생성(treatment.order) → order id(status='ordered')."""
    res = client.post(
        _treatment_orders_url(eid),
        json={"fee_schedule_id": fee_id},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


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


# ══════════════════════════════════════════════════════════════════════════════
# Story 5.7 — 처치 수행 · 재수행 차단 · 일상 간호기록
# ══════════════════════════════════════════════════════════════════════════════


# ── AC1(FR-090·FR-092): 처치 오더 수행(ordered→performed) ───────────────────────


def test_perform_treatment_golden_path(
    client, admin_token, doctor_token, nurse_token, nurse_id, dept_id, treatment_fee_id
):
    """doctor 오더 → nurse 수행 200 + status=performed + performed_by=nurse + performed_at."""
    eid = _walk_in(client, admin_token, dept_id)
    oid = _create_treatment_order(client, doctor_token, eid, treatment_fee_id)
    res = client.post(_perform_url(eid, oid), json={}, headers=_bearer(nurse_token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["id"] == oid
    assert body["status"] == "performed"
    assert body["performed_by"] == nurse_id
    assert body["performed_by_name"]  # users 조인(수행자명)
    assert body["performed_at"] is not None


def test_perform_treatment_with_content_creates_nursing_record(
    client, admin_token, doctor_token, nurse_token, nurse_id, dept_id, treatment_fee_id
):
    """수행 시 content 첨부 → 연결 nursing_record(treatment_order_id·내용·기록자=수행 nurse)."""
    eid = _walk_in(client, admin_token, dept_id)
    oid = _create_treatment_order(client, doctor_token, eid, treatment_fee_id)
    res = client.post(
        _perform_url(eid, oid),
        json={"content": "드레싱 교환 완료, 삼출물 소량"},
        headers=_bearer(nurse_token),
    )
    assert res.status_code == 200, res.text
    recs = client.get(_nursing_records_url(eid), headers=_bearer(nurse_token))
    assert recs.status_code == 200, recs.text
    linked = [r for r in recs.json() if r["treatment_order_id"] == oid]
    assert len(linked) == 1  # 정확히 1건(중복 누출 없음)
    assert linked[0]["content"] == "드레싱 교환 완료, 삼출물 소량"
    assert linked[0]["recorded_by"] == nurse_id  # attribution=수행 간호사(별도 insert 경로 검증)


def test_perform_treatment_reperform_409(
    client, admin_token, doctor_token, nurse_token, dept_id, treatment_fee_id
):
    """이미 수행된 오더 재수행 → 409 invalid_transition(FR-093 상태머신 최종선)."""
    eid = _walk_in(client, admin_token, dept_id)
    oid = _create_treatment_order(client, doctor_token, eid, treatment_fee_id)
    first = client.post(_perform_url(eid, oid), json={}, headers=_bearer(nurse_token))
    assert first.status_code == 200, first.text
    again = client.post(_perform_url(eid, oid), json={}, headers=_bearer(nurse_token))
    assert again.status_code == 409, again.text
    assert again.json()["error"]["code"] == "invalid_transition"


def test_perform_treatment_nonexistent_404(client, admin_token, nurse_token, dept_id):
    """미존재 처치 오더 수행 → 404."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(_perform_url(eid, str(uuid.uuid4())), json={}, headers=_bearer(nurse_token))
    assert res.status_code == 404, res.text


def test_perform_treatment_forbidden_reception_403(
    client, admin_token, doctor_token, reception_token, dept_id, treatment_fee_id
):
    """reception(treatment.perform 미보유) → 수행 403."""
    eid = _walk_in(client, admin_token, dept_id)
    oid = _create_treatment_order(client, doctor_token, eid, treatment_fee_id)
    res = client.post(_perform_url(eid, oid), json={}, headers=_bearer(reception_token))
    assert res.status_code == 403, res.text


def test_perform_treatment_forbidden_doctor_403(
    client, admin_token, doctor_token, dept_id, treatment_fee_id
):
    """doctor(treatment.order 보유·treatment.perform 미보유 = order-yes/perform-no) → 수행 403."""
    eid = _walk_in(client, admin_token, dept_id)
    oid = _create_treatment_order(client, doctor_token, eid, treatment_fee_id)
    res = client.post(_perform_url(eid, oid), json={}, headers=_bearer(doctor_token))
    assert res.status_code == 403, res.text


# ── AC3(FR-094): 일상 간호기록(오더 연결 없음) ────────────────────────────────


def test_create_nursing_record_golden_path(client, admin_token, nurse_token, nurse_id, dept_id):
    """nurse → 201 + treatment_order_id None(일상 기록) + recorded_by=nurse + 내용 echo."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _nursing_records_url(eid),
        json={"content": "오전 라운딩 — 활력 안정, 통증 호소 없음"},
        headers=_bearer(nurse_token),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["encounter_id"] == eid
    assert body["treatment_order_id"] is None
    assert body["content"] == "오전 라운딩 — 활력 안정, 통증 호소 없음"
    assert body["recorded_by"] == nurse_id
    assert body["recorded_by_name"]
    assert body["is_active"] is True


def test_create_nursing_record_blank_422(client, admin_token, nurse_token, dept_id):
    """빈/공백 content → 422(Pydantic min_length 후 strip)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _nursing_records_url(eid), json={"content": "   "}, headers=_bearer(nurse_token)
    )
    assert res.status_code == 422, res.text


def test_create_nursing_record_nonexistent_404(client, nurse_token):
    """미존재 내원에 간호기록 → 404."""
    res = client.post(
        _nursing_records_url(str(uuid.uuid4())),
        json={"content": "기록"},
        headers=_bearer(nurse_token),
    )
    assert res.status_code == 404, res.text


def test_create_nursing_record_forbidden_reception_403(
    client, admin_token, reception_token, dept_id
):
    """reception(nursing.record 미보유) → 간호기록 403."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _nursing_records_url(eid), json={"content": "기록"}, headers=_bearer(reception_token)
    )
    assert res.status_code == 403, res.text


def test_create_nursing_record_forbidden_doctor_403(client, admin_token, doctor_token, dept_id):
    """doctor(nursing.record 미보유) → 간호기록 403."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _nursing_records_url(eid), json={"content": "기록"}, headers=_bearer(doctor_token)
    )
    assert res.status_code == 403, res.text


# ── 간호기록 조회(order.read ∨ nursing.record — require_any) ───────────────────


def test_list_nursing_records_nurse_can_read(client, admin_token, nurse_token, dept_id):
    """nurse(nursing.record) → 조회 200 + 방금 작성한 기록 노출."""
    eid = _walk_in(client, admin_token, dept_id)
    client.post(
        _nursing_records_url(eid), json={"content": "간호기록 A"}, headers=_bearer(nurse_token)
    )
    res = client.get(_nursing_records_url(eid), headers=_bearer(nurse_token))
    assert res.status_code == 200, res.text
    assert res.json()[0]["content"] == "간호기록 A"


def test_list_nursing_records_doctor_can_read(
    client, admin_token, nurse_token, doctor_token, dept_id
):
    """doctor(order.read) → 조회 200(require_any 의 다른 분기)."""
    eid = _walk_in(client, admin_token, dept_id)
    client.post(
        _nursing_records_url(eid), json={"content": "간호기록 B"}, headers=_bearer(nurse_token)
    )
    res = client.get(_nursing_records_url(eid), headers=_bearer(doctor_token))
    assert res.status_code == 200, res.text
    assert res.json()[0]["content"] == "간호기록 B"


def test_list_nursing_records_forbidden_reception_403(
    client, admin_token, reception_token, dept_id
):
    """reception(order.read·nursing.record 둘 다 미보유) → 조회 403."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.get(_nursing_records_url(eid), headers=_bearer(reception_token))
    assert res.status_code == 403, res.text


# ── AC1(FR-090): 간호 워크리스트(미수행 처치·간호기록 건수) ──────────────────


def test_nursing_worklist_nurse_lists_pending(
    client, admin_token, doctor_token, nurse_token, dept_id, treatment_fee_id
):
    """nurse → 200 + 미수행 처치 보유 내원 노출(pending_treatment_count≥1·oldest 지시시각)."""
    eid = _walk_in(client, admin_token, dept_id)
    _create_treatment_order(client, doctor_token, eid, treatment_fee_id)
    res = client.get(_NURSING_WORKLIST_URL, headers=_bearer(nurse_token))
    assert res.status_code == 200, res.text
    item = next((r for r in res.json() if r["encounter_id"] == eid), None)
    assert item is not None, "미수행 처치 보유 내원이 워크리스트에 없음"
    assert item["pending_treatment_count"] >= 1
    assert item["oldest_pending_ordered_at"] is not None
    assert item["patient_name"] and item["chart_no"] and item["department_name"]


def test_nursing_worklist_count_decrements_after_perform(
    client, admin_token, doctor_token, nurse_token, dept_id, treatment_fee_id
):
    """수행 후 pending_treatment_count 감소·nursing_record_count 증가(content 첨부)."""
    eid = _walk_in(client, admin_token, dept_id)
    oid = _create_treatment_order(client, doctor_token, eid, treatment_fee_id)
    client.post(_perform_url(eid, oid), json={"content": "수행 메모"}, headers=_bearer(nurse_token))
    res = client.get(_NURSING_WORKLIST_URL, headers=_bearer(nurse_token))
    item = next((r for r in res.json() if r["encounter_id"] == eid), None)
    # 워크리스트는 전체 활성 내원 반환(pending>0 필터=클라) → 수행 후도 내원 노출(pending 0·기록 1).
    assert item is not None, "활성 내원이 워크리스트에서 사라짐"
    assert item["pending_treatment_count"] == 0  # 유일 처치 수행 → 미수행 0
    assert item["nursing_record_count"] >= 1  # content 첨부 기록 누적


def test_nursing_worklist_forbidden_reception_403(client, reception_token):
    """reception(treatment.perform·nursing.record 미보유) → 워크리스트 403."""
    res = client.get(_NURSING_WORKLIST_URL, headers=_bearer(reception_token))
    assert res.status_code == 403, res.text


def test_nursing_worklist_forbidden_doctor_403(client, doctor_token):
    """doctor(treatment.order 보유·treatment.perform·nursing.record 미보유) → 워크리스트 403."""
    res = client.get(_NURSING_WORKLIST_URL, headers=_bearer(doctor_token))
    assert res.status_code == 403, res.text


# ── 감사: 수행 → audit_logs update 행 · 간호기록 → create 행(0018 트리거) ────────


def test_perform_treatment_audit_update(
    client, admin_token, doctor_token, nurse_token, dept_id, treatment_fee_id, psql: Psql
):
    """수행(ordered→performed) → audit_logs action='update' 행(treatment_orders)."""
    eid = _walk_in(client, admin_token, dept_id)
    oid = _create_treatment_order(client, doctor_token, eid, treatment_fee_id)
    res = client.post(_perform_url(eid, oid), json={}, headers=_bearer(nurse_token))
    assert res.status_code == 200, res.text
    count = psql.scalar(
        "select count(*) from public.audit_logs "
        f"where target_table='treatment_orders' and target_id='{oid}' and action='update';"
    )
    assert int(count) >= 1


def test_create_nursing_record_audit(client, admin_token, nurse_token, dept_id, psql: Psql):
    """간호기록 작성 → audit_logs action='create' 행(nursing_record, 0018 트리거)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _nursing_records_url(eid), json={"content": "감사 검증 기록"}, headers=_bearer(nurse_token)
    )
    assert res.status_code == 201, res.text
    nrid = res.json()["id"]
    count = psql.scalar(
        "select count(*) from public.audit_logs "
        f"where target_table='nursing_record' and target_id='{nrid}' and action='create';"
    )
    assert int(count) == 1
