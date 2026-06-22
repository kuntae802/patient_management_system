"""처방 오더 발행·조회(Story 5.2 AC1~5) 통합 테스트 — FastAPI TestClient + 0015 prescriptions.

실 Supabase 토큰 + 0015 스키마. 로컬 스택/부트스트랩 없으면 skip. 검증:
  · AC1(FR-050): 약품 마스터(drug_id FK)로 처방전 발행 → 201 + 헤더(issued·ordered_by) + 상세 라인
         (drug 조인 code/name/ingredient_code). 멀티라인. free-text 차단(잘못된 drug_id → 422).
  · AC2(FR-051): 같은 내원 부착 진단 연결 → encounter_diagnosis_id 영속. 타 내원 진단 → 422.
  · AC4: 발행 목록 조회(최신순) + 감사(create). dose=numeric → Decimal 라운드트립.
  · AC5: 발행=prescription.create(doctor) — reception/nurse 403. 조회=order.read — reception 403·
         nurse 200(read-yes/create-no). 미존재 내원 → 404. 빈 details → 422(Pydantic).

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
    """처방 발행 골든 패스 — doctor 는 prescription.create(5.2 seed) + order.read(5.1 seed) 보유."""
    token = _get_token("doctor@pms.local", "Staff1234")
    if not token:
        pytest.skip("doctor 부트스트랩 미가용 — 'supabase db reset'(seed 갱신) 후 재실행")
    return token


@pytest.fixture(scope="module")
def reception_token() -> str:
    """오더 403 baseline — reception 은 임상 오더 권한 0(prescription.create·order.read 미보유)."""
    token = _get_token("reception@pms.local", "Staff1234")
    if not token:
        pytest.skip("reception 부트스트랩 미가용 — 'supabase db reset'(seed 갱신) 후 재실행")
    return token


@pytest.fixture(scope="module")
def nurse_token() -> str:
    """read-yes/create-no — nurse 는 order.read(5.1 seed) 보유·prescription.create 미보유."""
    token = _get_token("nurse@pms.local", "Staff1234")
    if not token:
        pytest.skip("nurse 부트스트랩 미가용 — 'supabase db reset'(seed 갱신) 후 재실행")
    return token


@pytest.fixture(scope="module")
def client(admin_token: str):
    # with-블록 = lifespan 실행(asyncpg 풀 생성).
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def doctor_id(psql: Psql) -> str:
    """doctor auth uid — ordered_by(발행 의사) 단언 기준."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'doctor' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def dept_id(psql: Psql) -> str:
    """시드 진료과(내과 IM) id."""
    return psql.scalar("select id::text from public.departments where lower(code) = 'im' limit 1")


@pytest.fixture(scope="module")
def drug_ids(psql: Psql) -> dict[str, str]:
    """시드 약품 id 2종(타이레놀·부루펜) — 처방 대상(서로 다른 ingredient_code)."""
    return {
        "tylenol": psql.scalar(
            "select id::text from public.drugs where code = '645100250' limit 1"
        ),
        "ibuprofen": psql.scalar(
            "select id::text from public.drugs where code = '642900360' limit 1"
        ),
    }


@pytest.fixture(scope="module")
def diagnosis_ids(psql: Psql) -> dict[str, str]:
    """시드 KCD 진단 id(I10 고혈압) — 처방 근거 연결(FR-051)."""
    return {
        "i10": psql.scalar(
            "select id::text from public.diagnoses where lower(code) = 'i10' limit 1"
        ),
    }


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
            "name": "처방테스트환자",
            "phone": "010-1234-5678",
            "insurance_type": "health_insurance",
        },
        headers=_bearer(token),
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _walk_in(client: TestClient, admin_token: str, dept_id: str) -> str:
    """환자 + walk-in 내원 생성 → 내원 id(처방 대상; 서버는 status 게이트 없음)."""
    pid = _create_patient(client, admin_token)
    res = client.post(
        _ENCOUNTERS_URL,
        json={"patient_id": pid, "department_id": dept_id},
        headers=_bearer(admin_token),
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _attach_diagnosis(client: TestClient, doctor_token: str, eid: str, diagnosis_id: str) -> str:
    """진단 부착(doctor) → encounter_diagnosis id(처방 근거 연결용, FR-051)."""
    res = client.post(
        f"{_ENCOUNTERS_URL}/{eid}/diagnoses",
        json={"diagnosis_id": diagnosis_id, "is_primary": True},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _prescriptions_url(eid: str) -> str:
    return f"{_ENCOUNTERS_URL}/{eid}/prescriptions"


# ── AC1: 처방전 발행(헤더 + 상세, free-text 차단) ────────────────────────────────


def test_create_prescription_golden_path(
    client, admin_token, doctor_token, doctor_id, dept_id, drug_ids
):
    """doctor → 201 + status='issued' + ordered_by=doctor + 상세 1줄(drug 조인 code/name/성분)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _prescriptions_url(eid),
        json={
            "details": [
                {
                    "drug_id": drug_ids["tylenol"],
                    "dose": 1,
                    "frequency": "TID",
                    "duration_days": 3,
                    "usage_instruction": "식후 30분",
                }
            ]
        },
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["encounter_id"] == eid
    assert body["status"] == "issued"
    assert body["ordered_by"] == doctor_id
    assert body["encounter_diagnosis_id"] is None
    assert len(body["details"]) == 1
    line = body["details"][0]
    assert line["drug_id"] == drug_ids["tylenol"]
    assert line["drug_code"] == "645100250"  # 약품 마스터 조인
    assert line["drug_name"]  # 한글 약품명(비어있지 않음)
    assert line["ingredient_code"] == "153002ATB"  # FR-052 중복 비교 키
    assert line["frequency"] == "TID"
    assert line["duration_days"] == 3


def test_create_prescription_multiline(client, admin_token, doctor_token, dept_id, drug_ids):
    """헤더 1 + 상세 2줄 원자적 생성 → 201 + details 2건."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _prescriptions_url(eid),
        json={
            "details": [
                {"drug_id": drug_ids["tylenol"]},
                {"drug_id": drug_ids["ibuprofen"], "dose": 2},
            ]
        },
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 201, res.text
    assert len(res.json()["details"]) == 2


def test_create_prescription_invalid_drug_422(client, admin_token, doctor_token, dept_id):
    """잘못된 drug_id(마스터 미존재) → 422(FK 23503 백스톱 — free-text 차단 서버 최종선)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _prescriptions_url(eid),
        json={"details": [{"drug_id": str(uuid.uuid4())}]},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 422, res.text
    assert res.json()["error"]["code"] == "invalid_reference", res.text


def test_create_prescription_empty_details_422(client, admin_token, doctor_token, dept_id):
    """빈 details → 422(Pydantic min_length — 빈 처방전 차단)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _prescriptions_url(eid),
        json={"details": []},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 422, res.text


def test_create_prescription_nonexistent_encounter_404(client, doctor_token, drug_ids):
    """미존재 내원에 발행 → 404(FK 위반 전 명시 선검사)."""
    res = client.post(
        _prescriptions_url(str(uuid.uuid4())),
        json={"details": [{"drug_id": drug_ids["tylenol"]}]},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 404, res.text


# ── AC2(FR-051): 처방 ↔ 진단 연결 ───────────────────────────────────────────────


def test_create_prescription_with_diagnosis_link(
    client, admin_token, doctor_token, dept_id, drug_ids, diagnosis_ids
):
    """같은 내원 부착 진단을 근거로 연결 → encounter_diagnosis_id 영속(FR-051)."""
    eid = _walk_in(client, admin_token, dept_id)
    ed_id = _attach_diagnosis(client, doctor_token, eid, diagnosis_ids["i10"])
    res = client.post(
        _prescriptions_url(eid),
        json={
            "encounter_diagnosis_id": ed_id,
            "details": [{"drug_id": drug_ids["tylenol"]}],
        },
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 201, res.text
    assert res.json()["encounter_diagnosis_id"] == ed_id


def test_create_prescription_cross_encounter_diagnosis_422(
    client, admin_token, doctor_token, dept_id, drug_ids, diagnosis_ids
):
    """타 내원의 진단을 근거로 연결 → 422(소속 검증 — FK 만으론 소속 미보증)."""
    eid_a = _walk_in(client, admin_token, dept_id)
    ed_id_a = _attach_diagnosis(client, doctor_token, eid_a, diagnosis_ids["i10"])
    eid_b = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _prescriptions_url(eid_b),
        json={
            "encounter_diagnosis_id": ed_id_a,  # 다른 내원(A)의 진단
            "details": [{"drug_id": drug_ids["tylenol"]}],
        },
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 422, res.text
    assert res.json()["error"]["code"] == "invalid_diagnosis_reference", res.text


# ── AC4: 조회·감사·dose 라운드트립 ──────────────────────────────────────────────


def test_list_prescriptions_newest_first(client, admin_token, doctor_token, dept_id, drug_ids):
    """GET → 발행 처방 목록(헤더 + 상세). 같은 내원 2건 발행 시 최신순."""
    eid = _walk_in(client, admin_token, dept_id)
    first = client.post(
        _prescriptions_url(eid),
        json={"details": [{"drug_id": drug_ids["tylenol"]}]},
        headers=_bearer(doctor_token),
    )
    assert first.status_code == 201, first.text
    second = client.post(
        _prescriptions_url(eid),
        json={"details": [{"drug_id": drug_ids["ibuprofen"]}]},
        headers=_bearer(doctor_token),
    )
    assert second.status_code == 201, second.text
    res = client.get(_prescriptions_url(eid), headers=_bearer(doctor_token))
    assert res.status_code == 200, res.text
    rows = res.json()
    assert len(rows) == 2
    assert rows[0]["id"] == second.json()["id"]  # 최신순(created_at desc)


def test_create_prescription_dose_decimal_roundtrip(
    client, admin_token, doctor_token, dept_id, drug_ids
):
    """dose=0.5(numeric) → 저장·반환 0.5(asyncpg Decimal 변환 — JSON number)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _prescriptions_url(eid),
        json={"details": [{"drug_id": drug_ids["tylenol"], "dose": 0.5}]},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 201, res.text
    assert res.json()["details"][0]["dose"] == 0.5


def test_create_prescription_audited(client, admin_token, doctor_token, dept_id, drug_ids, psql):
    """발행 → audit_logs action='create' 행(prescriptions + prescription_details, 0015 트리거)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _prescriptions_url(eid),
        json={"details": [{"drug_id": drug_ids["tylenol"]}]},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    pid = body["id"]
    did = body["details"][0]["id"]
    header_audits = psql.scalar(
        "select count(*) from public.audit_logs "
        f"where target_table='prescriptions' and target_id='{pid}' and action='create';"
    )
    assert int(header_audits) >= 1
    detail_audits = psql.scalar(
        "select count(*) from public.audit_logs "
        f"where target_table='prescription_details' and target_id='{did}' and action='create';"
    )
    assert int(detail_audits) >= 1


# ── AC5: 권한 게이트(발행=prescription.create·조회=order.read) ─────────────────────


def test_create_prescription_forbidden_reception_403(
    client, admin_token, reception_token, dept_id, drug_ids
):
    """reception(오더 권한 0) → 발행 403(게이트가 본문 처리 전 차단)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _prescriptions_url(eid),
        json={"details": [{"drug_id": drug_ids["tylenol"]}]},
        headers=_bearer(reception_token),
    )
    assert res.status_code == 403, res.text


def test_create_prescription_forbidden_nurse_403(
    client, admin_token, nurse_token, dept_id, drug_ids
):
    """nurse(order.read 보유·prescription.create 미보유) → 발행 403(read-yes/create-no)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _prescriptions_url(eid),
        json={"details": [{"drug_id": drug_ids["tylenol"]}]},
        headers=_bearer(nurse_token),
    )
    assert res.status_code == 403, res.text


def test_list_prescriptions_forbidden_reception_403(client, admin_token, reception_token, dept_id):
    """reception(order.read 미보유) → 조회 403."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.get(_prescriptions_url(eid), headers=_bearer(reception_token))
    assert res.status_code == 403, res.text


def test_list_prescriptions_nurse_can_read(client, admin_token, nurse_token, dept_id):
    """nurse(order.read 보유) → 조회 200(read-yes)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.get(_prescriptions_url(eid), headers=_bearer(nurse_token))
    assert res.status_code == 200, res.text
