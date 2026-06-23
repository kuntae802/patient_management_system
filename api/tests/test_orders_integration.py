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


# ══ Story 5.3: 검사·영상 오더 ══════════════════════════════════════════════════
# examinations = 단건 평면(처방 헤더/상세 1:N 아님). exam_type(lab/imaging) = 라우팅 분류 축
# (FR-061), fee_schedule 마스터 FK = free-text 차단. 5.2 처방 발행 미러(service_role·신규권한 0).


@pytest.fixture(scope="module")
def fee_schedule_ids(psql: Psql) -> dict[str, str]:
    """시드 EDI 행위 id — lab(CBC C3800)·imaging(흉부촬영 HA201). 검사·영상 오더 대상."""
    return {
        "lab": psql.scalar(
            "select id::text from public.fee_schedules where code = 'C3800' limit 1"
        ),
        "imaging": psql.scalar(
            "select id::text from public.fee_schedules where code = 'HA201' limit 1"
        ),
    }


def _examinations_url(eid: str) -> str:
    return f"{_ENCOUNTERS_URL}/{eid}/examinations"


# ── AC1·AC2: 검사·영상 오더 생성(지시 상태 · exam_type 라우팅 분류) ──────────────


def test_create_examination_lab_golden_path(
    client, admin_token, doctor_token, doctor_id, dept_id, fee_schedule_ids
):
    """doctor → 201 + status='ordered' + ordered_by=doctor + exam_type='lab' + fee 조인."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _examinations_url(eid),
        json={"exam_type": "lab", "fee_schedule_id": fee_schedule_ids["lab"]},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["encounter_id"] == eid
    assert body["status"] == "ordered"
    assert body["ordered_by"] == doctor_id
    assert body["exam_type"] == "lab"
    assert body["fee_schedule_id"] == fee_schedule_ids["lab"]
    assert body["fee_code"] == "C3800"  # fee_schedules 마스터 조인
    assert body["fee_name"]  # 한글 행위명(비어있지 않음)
    assert body["amount_krw"] == 3500
    assert body["equipment_id"] is None  # 장비 배정 = 5.8
    assert body["performed_by"] is None  # 수행 = 5.7/5.8


def test_create_examination_imaging_golden_path(
    client, admin_token, doctor_token, dept_id, fee_schedule_ids
):
    """영상검사 오더 → 201 + exam_type='imaging'(방사선 워크리스트 라우팅 분류 축, FR-061)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _examinations_url(eid),
        json={"exam_type": "imaging", "fee_schedule_id": fee_schedule_ids["imaging"]},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 201, res.text
    assert res.json()["exam_type"] == "imaging"


def test_create_examination_invalid_fee_422(client, admin_token, doctor_token, dept_id):
    """잘못된 fee_schedule_id(마스터 미존재) → 422(FK 23503 백스톱 — free-text 차단 서버 최종선)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _examinations_url(eid),
        json={"exam_type": "lab", "fee_schedule_id": str(uuid.uuid4())},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 422, res.text
    assert res.json()["error"]["code"] == "invalid_reference", res.text


def test_create_examination_invalid_exam_type_422(
    client, admin_token, doctor_token, dept_id, fee_schedule_ids
):
    """잘못된 exam_type(lab/imaging 외) → 422(Pydantic Literal · DB CHECK 거울)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _examinations_url(eid),
        json={"exam_type": "mri", "fee_schedule_id": fee_schedule_ids["imaging"]},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 422, res.text


def test_create_examination_nonexistent_encounter_404(client, doctor_token, fee_schedule_ids):
    """미존재 내원에 오더 → 404(FK 위반 전 명시 선검사)."""
    res = client.post(
        _examinations_url(str(uuid.uuid4())),
        json={"exam_type": "lab", "fee_schedule_id": fee_schedule_ids["lab"]},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 404, res.text


def test_list_examinations_newest_first(
    client, admin_token, doctor_token, dept_id, fee_schedule_ids
):
    """한 내원에 lab + imaging 오더 → 목록 최신순(imaging 먼저) + fee 조인."""
    eid = _walk_in(client, admin_token, dept_id)
    for exam_type, key in (("lab", "lab"), ("imaging", "imaging")):
        r = client.post(
            _examinations_url(eid),
            json={"exam_type": exam_type, "fee_schedule_id": fee_schedule_ids[key]},
            headers=_bearer(doctor_token),
        )
        assert r.status_code == 201, r.text
    res = client.get(_examinations_url(eid), headers=_bearer(doctor_token))
    assert res.status_code == 200, res.text
    rows = res.json()
    assert len(rows) == 2
    assert {r["exam_type"] for r in rows} == {"lab", "imaging"}  # 양 유형 모두 반환
    # 최신순(created_at desc) — ordered_at==created_at(동일 INSERT now())이라 내림차순 보장.
    # 랜덤 UUID id desc 타이브레이크는 삽입순서와 무상관 → 위치 단언 대신 시각 내림차순 검증.
    assert rows[0]["ordered_at"] >= rows[1]["ordered_at"]
    assert all(r["fee_code"] for r in rows)  # fee_schedules 조인


def test_create_examination_audited(
    client, admin_token, doctor_token, dept_id, fee_schedule_ids, psql
):
    """오더 → audit_logs action='create' 행(examinations, 0015 트리거)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _examinations_url(eid),
        json={"exam_type": "lab", "fee_schedule_id": fee_schedule_ids["lab"]},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 201, res.text
    exid = res.json()["id"]
    audits = psql.scalar(
        "select count(*) from public.audit_logs "
        f"where target_table='examinations' and target_id='{exid}' and action='create';"
    )
    assert int(audits) >= 1


# ── AC4: 권한 게이트(오더=examination.order · 조회=order.read) ────────────────────


def test_create_examination_forbidden_reception_403(
    client, admin_token, reception_token, dept_id, fee_schedule_ids
):
    """reception(오더 권한 0) → 오더 403(게이트가 본문 처리 전 차단)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _examinations_url(eid),
        json={"exam_type": "lab", "fee_schedule_id": fee_schedule_ids["lab"]},
        headers=_bearer(reception_token),
    )
    assert res.status_code == 403, res.text


def test_create_examination_forbidden_nurse_403(
    client, admin_token, nurse_token, dept_id, fee_schedule_ids
):
    """nurse(order.read 보유·examination.order 미보유) → 오더 403(read-yes/order-no)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _examinations_url(eid),
        json={"exam_type": "lab", "fee_schedule_id": fee_schedule_ids["lab"]},
        headers=_bearer(nurse_token),
    )
    assert res.status_code == 403, res.text


def test_list_examinations_forbidden_reception_403(client, admin_token, reception_token, dept_id):
    """reception(order.read 미보유) → 조회 403."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.get(_examinations_url(eid), headers=_bearer(reception_token))
    assert res.status_code == 403, res.text


def test_list_examinations_nurse_can_read(client, admin_token, nurse_token, dept_id):
    """nurse(order.read 보유) → 조회 200(read-yes)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.get(_examinations_url(eid), headers=_bearer(nurse_token))
    assert res.status_code == 200, res.text


# ══ Story 5.4: 처치 오더 ══════════════════════════════════════════════════════
# treatment_orders = 단건 평면(검사 동형, 단 exam_type/equipment_id/completed_* 없음 — 처치는
# 간호 단일 라우팅 FR-070). fee_schedule 마스터 FK = free-text 차단. 5.3 검사·영상 미러(신규권한 0).


@pytest.fixture(scope="module")
def treatment_fee_ids(psql: Psql) -> dict[str, str]:
    """시드 EDI 처치 행위 id — 단순처치(드레싱 M0030)·표층열치료(핫팩 MM070). 처치 오더 대상."""
    return {
        "dressing": psql.scalar(
            "select id::text from public.fee_schedules where code = 'M0030' limit 1"
        ),
        "hotpack": psql.scalar(
            "select id::text from public.fee_schedules where code = 'MM070' limit 1"
        ),
    }


def _treatment_orders_url(eid: str) -> str:
    return f"{_ENCOUNTERS_URL}/{eid}/treatment-orders"


# ── AC1·AC2: 처치 오더 생성(지시 상태 · 간호 워크리스트 단일 라우팅) ──────────────


def test_create_treatment_order_golden_path(
    client, admin_token, doctor_token, doctor_id, dept_id, treatment_fee_ids
):
    """doctor → 201 + status='ordered' + ordered_by=doctor + fee 조인 + performed=None."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _treatment_orders_url(eid),
        json={"fee_schedule_id": treatment_fee_ids["dressing"]},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["encounter_id"] == eid
    assert body["status"] == "ordered"
    assert body["ordered_by"] == doctor_id
    assert body["fee_schedule_id"] == treatment_fee_ids["dressing"]
    assert body["fee_code"] == "M0030"  # fee_schedules 마스터 조인
    assert body["fee_name"]  # 한글 행위명(비어있지 않음)
    assert body["amount_krw"] == 4500
    assert body["performed_by"] is None  # 수행 = 5.7
    assert body["performed_at"] is None


def test_create_treatment_order_invalid_fee_422(client, admin_token, doctor_token, dept_id):
    """잘못된 fee_schedule_id(마스터 미존재) → 422(FK 23503 백스톱 — free-text 차단 서버 최종선)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _treatment_orders_url(eid),
        json={"fee_schedule_id": str(uuid.uuid4())},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 422, res.text
    assert res.json()["error"]["code"] == "invalid_reference", res.text


def test_create_treatment_order_nonexistent_encounter_404(client, doctor_token, treatment_fee_ids):
    """미존재 내원에 오더 → 404(FK 위반 전 명시 선검사)."""
    res = client.post(
        _treatment_orders_url(str(uuid.uuid4())),
        json={"fee_schedule_id": treatment_fee_ids["dressing"]},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 404, res.text


def test_list_treatment_orders_newest_first(
    client, admin_token, doctor_token, dept_id, treatment_fee_ids
):
    """한 내원에 2건 오더 → 목록 최신순(시각 내림차순) + fee 조인 + 양 행위 반환."""
    eid = _walk_in(client, admin_token, dept_id)
    for key in ("dressing", "hotpack"):
        r = client.post(
            _treatment_orders_url(eid),
            json={"fee_schedule_id": treatment_fee_ids[key]},
            headers=_bearer(doctor_token),
        )
        assert r.status_code == 201, r.text
    res = client.get(_treatment_orders_url(eid), headers=_bearer(doctor_token))
    assert res.status_code == 200, res.text
    rows = res.json()
    assert len(rows) == 2
    assert {r["fee_code"] for r in rows} == {"M0030", "MM070"}  # 양 행위 모두 반환
    # 최신순 — 랜덤 UUID id desc 타이브레이크는 삽입순서 무상관 → 위치 단언 대신 시각 내림차순.
    # 실제 정렬키 = created_at(fetch_treatment_orders), ordered_at 은 동일 now() 라 동행 검증.
    assert rows[0]["created_at"] >= rows[1]["created_at"]
    assert rows[0]["ordered_at"] >= rows[1]["ordered_at"]
    assert all(r["fee_code"] for r in rows)  # fee_schedules 조인


def test_create_treatment_order_audited(
    client, admin_token, doctor_token, dept_id, treatment_fee_ids, psql
):
    """오더 → audit_logs action='create' 행(treatment_orders, 0015 트리거)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _treatment_orders_url(eid),
        json={"fee_schedule_id": treatment_fee_ids["dressing"]},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 201, res.text
    tid = res.json()["id"]
    audits = psql.scalar(
        "select count(*) from public.audit_logs "
        f"where target_table='treatment_orders' and target_id='{tid}' and action='create';"
    )
    assert int(audits) >= 1


# ── AC4: 권한 게이트(오더=treatment.order · 조회=order.read) ───────────────────


def test_create_treatment_order_forbidden_reception_403(
    client, admin_token, reception_token, dept_id, treatment_fee_ids
):
    """reception(오더 권한 0) → 오더 403(게이트가 본문 처리 전 차단)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _treatment_orders_url(eid),
        json={"fee_schedule_id": treatment_fee_ids["dressing"]},
        headers=_bearer(reception_token),
    )
    assert res.status_code == 403, res.text


def test_create_treatment_order_forbidden_nurse_403(
    client, admin_token, nurse_token, dept_id, treatment_fee_ids
):
    """nurse(order.read 有·treatment.order 無) → 오더 403(read-yes/order-no)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _treatment_orders_url(eid),
        json={"fee_schedule_id": treatment_fee_ids["dressing"]},
        headers=_bearer(nurse_token),
    )
    assert res.status_code == 403, res.text


def test_list_treatment_orders_forbidden_reception_403(
    client, admin_token, reception_token, dept_id
):
    """reception(order.read 미보유) → 조회 403."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.get(_treatment_orders_url(eid), headers=_bearer(reception_token))
    assert res.status_code == 403, res.text


def test_list_treatment_orders_nurse_can_read(client, admin_token, nurse_token, dept_id):
    """nurse(order.read 보유) → 조회 200(read-yes)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.get(_treatment_orders_url(eid), headers=_bearer(nurse_token))
    assert res.status_code == 200, res.text


# ══ Story 5.5: 알레르기 교차검증 · pay-chip(coverage) · 추적 라인 이름 ════════════
# UX-DR21② 알레르기↔오더 교차검증(서버 강제 사유 오버라이드+감사)·UX-DR13 coverage_type pay-chip·
# 지시자 이름 추적 라인(users 조인). 0016 마이그(coverage_type·allergy_override_reason) 소비.


def _walk_in_with_allergies(
    client: TestClient, admin_token: str, dept_id: str, psql: Psql, allergies: str
) -> str:
    """환자 + walk-in 내원 + 알레르기 설정(psql 직접) → 내원 id. allergies=자유텍스트(0009)."""
    pid = _create_patient(client, admin_token)
    proc = psql.run(
        f"update public.patients set allergies = $tok${allergies}$tok$ where id = '{pid}'"
    )
    assert proc.returncode == 0, proc.stderr
    res = client.post(
        _ENCOUNTERS_URL,
        json={"patient_id": pid, "department_id": dept_id},
        headers=_bearer(admin_token),
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_prescription_allergy_conflict_blocks_without_reason(
    client, admin_token, doctor_token, dept_id, drug_ids, psql
):
    """기록 알레르기(타이레놀)와 약품명 매칭 + 오버라이드 사유 미입력 → 409 allergy_conflict."""
    eid = _walk_in_with_allergies(client, admin_token, dept_id, psql, "타이레놀")
    res = client.post(
        _prescriptions_url(eid),
        json={"details": [{"drug_id": drug_ids["tylenol"]}]},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 409, res.text
    err = res.json()["error"]
    assert err["code"] == "allergy_conflict"
    conflicts = err["detail"]["conflicts"]
    assert any(c["drug_id"] == drug_ids["tylenol"] for c in conflicts)
    assert conflicts[0]["allergen"]  # 매칭 토큰(타이레놀)


def test_prescription_allergy_override_with_reason_succeeds(
    client, admin_token, doctor_token, dept_id, drug_ids, psql
):
    """매칭 + 오버라이드 사유 입력 → 201 + 사유가 상세에 기록(감사 트리거 캡처 — append-only)."""
    eid = _walk_in_with_allergies(client, admin_token, dept_id, psql, "타이레놀")
    res = client.post(
        _prescriptions_url(eid),
        json={
            "details": [
                {
                    "drug_id": drug_ids["tylenol"],
                    "allergy_override_reason": "환자 재확인 결과 경미·투여 가능 판단",
                }
            ]
        },
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 201, res.text
    pres_id = res.json()["id"]
    # 사유가 DB 에 기록(응답엔 미노출 — 쓰기·감사 전용).
    stored = psql.scalar(
        "select allergy_override_reason from public.prescription_details "
        f"where prescription_id = '{pres_id}' limit 1"
    )
    assert "투여 가능" in stored
    # 감사 트리거가 prescription_details INSERT 의 사유를 append-only 캡처(after_data).
    audited = psql.scalar(
        "select count(*) from public.audit_logs where target_table = 'prescription_details' "
        "and after_data->>'allergy_override_reason' is not null"
    )
    assert int(audited) >= 1


def test_prescription_unrelated_allergy_proceeds(
    client, admin_token, doctor_token, dept_id, drug_ids, psql
):
    """기록 알레르기가 약품명과 무관(꽃가루) → 매칭 없음 → 정상 201(false-positive 회피)."""
    eid = _walk_in_with_allergies(client, admin_token, dept_id, psql, "꽃가루, 집먼지진드기")
    res = client.post(
        _prescriptions_url(eid),
        json={"details": [{"drug_id": drug_ids["tylenol"]}]},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 201, res.text


def test_prescription_response_has_coverage_and_orderer_name(
    client, admin_token, doctor_token, dept_id, drug_ids
):
    """처방 응답: 상세 coverage_type(pay-chip) + 헤더 ordered_by_name(추적 라인 지시자)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _prescriptions_url(eid),
        json={"details": [{"drug_id": drug_ids["tylenol"]}]},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["ordered_by_name"]  # users 조인 의사 이름
    assert body["details"][0]["coverage_type"] == "covered"  # 타이레놀=급여(시드)


def test_examination_response_has_coverage_and_orderer_name(
    client, admin_token, doctor_token, dept_id, fee_schedule_ids
):
    """검사 응답: coverage_type(pay-chip) + ordered_by_name + performed_by_name(미수행=None)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _examinations_url(eid),
        json={"exam_type": "lab", "fee_schedule_id": fee_schedule_ids["lab"]},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["coverage_type"] == "covered"  # CBC C3800=급여
    assert body["ordered_by_name"]
    assert body["performed_by_name"] is None  # 미수행(수행=5.7/5.8)


def test_treatment_response_has_coverage_and_orderer_name(
    client, admin_token, doctor_token, dept_id, treatment_fee_ids
):
    """처치 응답: coverage_type 비급여(MM070 핫팩) + ordered_by_name + performed_by_name=None."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _treatment_orders_url(eid),
        json={"fee_schedule_id": treatment_fee_ids["hotpack"]},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["coverage_type"] == "non_covered"  # 핫팩 MM070=비급여(시드)
    assert body["ordered_by_name"]
    assert body["performed_by_name"] is None


def test_coverage_seed_has_both_classes(psql):
    """0016 coverage_type 시드: 급여/비급여 각 1+ 존재(pay-chip 양색 데모·테스트 고정 코드)."""
    assert psql.scalar("select coverage_type from public.fee_schedules where code = 'AA154'") == (
        "covered"
    )
    assert psql.scalar("select coverage_type from public.fee_schedules where code = 'MM151'") == (
        "non_covered"
    )
    assert psql.scalar("select coverage_type from public.drugs where code = '645100250'") == (
        "covered"
    )
    assert psql.scalar("select coverage_type from public.drugs where code = '653700110'") == (
        "non_covered"
    )


# ── Story 7.7: 원외처방전 출력·발급 (FR-115·FR-080) ───────────────────────────────
# 게이트=prescription.dispense(원무). 발행(create)·조회와 별개 권한 — 비중첩 baseline.
# 문서=요양기관+환자(masked RRN)+처방 1:N(발행의 면허·KCD·약품). 발급=issued→dispensed(비가역).


def _prescription_document_url(eid: str) -> str:
    return f"{_ENCOUNTERS_URL}/{eid}/prescription-document"


def _dispense_url(eid: str, rid: str) -> str:
    return f"{_ENCOUNTERS_URL}/{eid}/prescriptions/{rid}/dispense"


def _rx_export_url(eid: str, rid: str) -> str:
    return f"{_ENCOUNTERS_URL}/{eid}/prescriptions/{rid}/document/export"


def _issue_prescription(client, doctor_token, eid, drug_id, *, encounter_diagnosis_id=None) -> str:
    body = {
        "details": [
            {
                "drug_id": drug_id,
                "dose": 1,
                "frequency": "TID",
                "duration_days": 3,
                "usage_instruction": "식후 30분",
            }
        ]
    }
    if encounter_diagnosis_id:
        body["encounter_diagnosis_id"] = encounter_diagnosis_id
    res = client.post(_prescriptions_url(eid), json=body, headers=_bearer(doctor_token))
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_prescription_document_golden_path(
    client, admin_token, doctor_token, reception_token, dept_id, drug_ids, diagnosis_ids
):
    """reception GET prescription-document → 200: 요양기관·환자 masked·처방 라인·KCD·면허."""
    import re

    eid = _walk_in(client, admin_token, dept_id)
    ed = _attach_diagnosis(client, doctor_token, eid, diagnosis_ids["i10"])
    rid = _issue_prescription(
        client, doctor_token, eid, drug_ids["tylenol"], encounter_diagnosis_id=ed
    )
    res = client.get(_prescription_document_url(eid), headers=_bearer(reception_token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["clinic"]["hira_no"]  # 요양기관기호(0049 시드)
    assert body["patient"]["resident_no_masked"].endswith("******")  # masked
    # full RRN(13자리 평문) 미투영(PII 경계).
    assert not re.search(r"\d{6}-\d{7}", body["patient"]["resident_no_masked"])
    assert len(body["prescriptions"]) == 1
    rx = body["prescriptions"][0]
    assert rx["id"] == rid
    assert rx["status"] == "issued"
    assert rx["dispensed_at"] is None
    assert rx["prescriber"]["license_type"] == "doctor"
    assert rx["prescriber"]["license_no"] == "12345"  # 데모 의사 면허(seed 7.7)
    assert rx["diagnosis"]["code"].lower() == "i10"  # 질병분류기호 KCD(FR-051)
    assert len(rx["drugs"]) == 1
    drug = rx["drugs"][0]
    assert drug["drug_code"] == "645100250"
    assert drug["drug_name"]
    assert drug["frequency"] == "TID"
    assert drug["duration_days"] == 3


def test_prescription_document_empty_when_no_prescriptions(
    client, admin_token, reception_token, dept_id
):
    """처방 없는 내원 → 200 + prescriptions=[](404 아님)."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.get(_prescription_document_url(eid), headers=_bearer(reception_token))
    assert res.status_code == 200, res.text
    assert res.json()["prescriptions"] == []


def test_prescription_document_nonexistent_encounter_404(client, reception_token):
    """미존재 내원 문서 → 404."""
    res = client.get(
        _prescription_document_url(str(uuid.uuid4())), headers=_bearer(reception_token)
    )
    assert res.status_code == 404, res.text


def test_dispense_prescription_golden_path(
    client, admin_token, doctor_token, reception_token, dept_id, drug_ids
):
    """reception 발급 → 200 status='dispensed'·dispensed_at 세팅. 재발급 → 409(비가역 1방향)."""
    eid = _walk_in(client, admin_token, dept_id)
    rid = _issue_prescription(client, doctor_token, eid, drug_ids["tylenol"])
    res = client.post(_dispense_url(eid, rid), headers=_bearer(reception_token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "dispensed"
    assert body["dispensed_at"] is not None
    # 재발급 → 409(invalid_transition).
    res2 = client.post(_dispense_url(eid, rid), headers=_bearer(reception_token))
    assert res2.status_code == 409, res2.text
    assert res2.json()["error"]["code"] == "invalid_transition"


def test_dispense_reflected_in_document(
    client, admin_token, doctor_token, reception_token, dept_id, drug_ids
):
    """발급 후 문서 재조회 → status='dispensed'·dispensed_at 반영."""
    eid = _walk_in(client, admin_token, dept_id)
    rid = _issue_prescription(client, doctor_token, eid, drug_ids["tylenol"])
    client.post(_dispense_url(eid, rid), headers=_bearer(reception_token))
    res = client.get(_prescription_document_url(eid), headers=_bearer(reception_token))
    rx = next(r for r in res.json()["prescriptions"] if r["id"] == rid)
    assert rx["status"] == "dispensed"
    assert rx["dispensed_at"] is not None


def test_prescription_document_export_204(
    client, admin_token, doctor_token, reception_token, dept_id, drug_ids
):
    """내보내기 감사 → 204(finalize 무관 — 발행 처방이면 출력 가능)."""
    eid = _walk_in(client, admin_token, dept_id)
    rid = _issue_prescription(client, doctor_token, eid, drug_ids["tylenol"])
    res = client.post(_rx_export_url(eid, rid), headers=_bearer(reception_token))
    assert res.status_code == 204, res.text


def test_dispense_cross_encounter_404(
    client, admin_token, doctor_token, reception_token, dept_id, drug_ids
):
    """타 내원의 prescription_id 로 발급 시도 → 404(경로 정합 선검사)."""
    eid_a = _walk_in(client, admin_token, dept_id)
    eid_b = _walk_in(client, admin_token, dept_id)
    rid = _issue_prescription(client, doctor_token, eid_a, drug_ids["tylenol"])
    res = client.post(_dispense_url(eid_b, rid), headers=_bearer(reception_token))
    assert res.status_code == 404, res.text


def test_prescription_document_forbidden_for_doctor(
    client, admin_token, doctor_token, dept_id, drug_ids
):
    """doctor 는 prescription.dispense 미보유 → 문서/발급 403(발급=원무 직무·비중첩 baseline)."""
    eid = _walk_in(client, admin_token, dept_id)
    rid = _issue_prescription(client, doctor_token, eid, drug_ids["tylenol"])
    doc = client.get(_prescription_document_url(eid), headers=_bearer(doctor_token))
    assert doc.status_code == 403, doc.text
    disp = client.post(_dispense_url(eid, rid), headers=_bearer(doctor_token))
    assert disp.status_code == 403, disp.text


def test_reception_cannot_issue_prescription_baseline(
    client, admin_token, reception_token, dept_id, drug_ids
):
    """비중첩 baseline 유지 — reception 은 prescription.dispense 만, 발행(create)은 여전히 403."""
    eid = _walk_in(client, admin_token, dept_id)
    res = client.post(
        _prescriptions_url(eid),
        json={"details": [{"drug_id": drug_ids["tylenol"]}]},
        headers=_bearer(reception_token),
    )
    assert res.status_code == 403, res.text
