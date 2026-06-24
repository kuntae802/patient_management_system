"""환자 포털 '마이' 탭 수납·영수증(Story 8.3 AC1~5) 통합 — 실 Supabase + self-link + finalize 체인.

GET /v1/patients/me/payments(수납 카드 리스트) + GET /v1/patients/me/encounters/{id}/receipt 검증:
  · AC1: 본인 finalized 수납 → 카드(요양기관·진료과·납부액·결제수단·payment_no·status)
  · AC3: 영수증 상세 = 7.5 ReceiptResponse 재사용(clinic/patient/encounter/details·금액)
  · AC4: self-scope(타인 encounter receipt → 404·IDOR)·비-finalized → 404(직원 409와 다름)·
         미연결(리스트 빈 목록·receipt 404)·draft 리스트 제외(finalized 만)
  · AC5: 직원 403·PII 경계(raw resident_no·_enc·_hash·finalized_by 미투영·masked RRN 만)

self-linked 환자의 finalized 수납은 in_progress(start_consult 자동 진찰료) + 주상병 → reception
finalize(build→price→finalize→complete 원자) 로 만든다. 로컬 스택 + 공개 가입 필요(미가용 skip).
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import Psql
from tests.test_patients_integration import _bearer, _get_token, _unique_rrn
from tests.test_patients_self_link_integration import (
    _create_unlinked_patient,
    _new_patient_email,
    _signup_patient,
)

_SELF_LINK_URL = "/v1/patients/self-link"
_PAYMENTS_URL = "/v1/patients/me/payments"
_DEPT = "(select id from public.departments where lower(code)='im' limit 1)"


def _receipt_url(eid: str) -> str:
    return f"/v1/patients/me/encounters/{eid}/receipt"


def _finalize_url(eid: str) -> str:
    return f"/v1/encounters/{eid}/payment/finalize"


def _build_url(eid: str) -> str:
    return f"/v1/encounters/{eid}/payment"


@pytest.fixture(scope="module")
def admin_token() -> str:
    token = _get_token("admin@pms.local", "Staff1234")
    if not token:
        pytest.skip("로컬 Supabase 스택/부트스트랩 미가용 — supabase start && db reset 후 재실행")
    return token


@pytest.fixture(scope="module")
def reception_token() -> str:
    """수납 finalize — payment.manage + payment.read 보유(seed 7.1/7.2)."""
    token = _get_token("reception@pms.local", "Staff1234")
    if not token:
        pytest.skip("reception 부트스트랩 계정 미가용 — 'supabase db reset' 후 재실행")
    return token


@pytest.fixture(scope="module")
def doctor_token() -> str:
    token = _get_token("doctor@pms.local", "Staff1234")
    if not token:
        pytest.skip("doctor 부트스트랩 계정 미가용 — 'supabase db reset' 후 재실행")
    return token


@pytest.fixture(scope="module")
def client(admin_token: str):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def patient_session() -> tuple[str, str]:
    """매 테스트 새 환자 공개 가입 → (token, uid). 가입 비활성 시 skip."""
    sess = _signup_patient(_new_patient_email())
    if sess is None:
        pytest.skip("환자 공개 가입(enable_signup) 미가용 — config 재활성 후 재실행")
    return sess


@pytest.fixture(scope="module")
def doctor_id(psql: Psql) -> str:
    """담당의(doctor) uid — start_consult(진찰료 자동 적재) actor."""
    return (
        psql.scalar(
            "select u.id::text from public.users u "
            "join public.roles r on r.id = u.role_id where r.code='doctor' limit 1"
        )
        .strip()
        .lower()
    )


def _link_self(client: TestClient, admin_token: str, token: str, *, name: str) -> tuple[str, str]:
    """원무 미연결 환자 생성 → 환자 세션이 self-link. (patient_id, raw_rrn) 반환(PII 단언용)."""
    rrn = _unique_rrn()
    pid = _create_unlinked_patient(client, admin_token, rrn=rrn, name=name)
    res = client.post(
        _SELF_LINK_URL, json={"resident_no": rrn, "name": name}, headers=_bearer(token)
    )
    assert res.status_code == 200, res.text
    return pid, rrn


def _seed_in_progress(psql: Psql, *, pid: str, doctor_id: str, primary: bool = True) -> str:
    """registered → start_consult(in_progress + 진찰료 자동) + 주상병(완료 게이트) → encounter_id.

    finalize(complete_encounter)는 주상병 게이트(PT422) → primary=True 기본. begin/commit(doctor
    claims — start_consult·진단 부착 우회·7.5 _setup_finalizable_encounter 미러)."""
    eid = str(uuid.uuid4())
    claims = '{"sub":"' + doctor_id + '","role":"authenticated"}'
    sql = (
        "begin;"
        "insert into public.encounters(id, patient_id, department_id, visit_type, status) "
        f"values ('{eid}','{pid}',{_DEPT},'walk_in','registered');"
        f"select set_config('request.jwt.claims', '{claims}', true);"
        f"select set_config('app.actor_id', '{doctor_id}', true);"
        f"select public.start_consult('{eid}');"
    )
    if primary:
        sql += (
            "insert into public.encounter_diagnoses"
            "(encounter_id, diagnosis_id, is_primary, recorded_by, is_active) "
            f"values ('{eid}',(select id from public.diagnoses limit 1),true,'{doctor_id}',true);"
        )
    sql += "commit;"
    proc = psql.run(sql)
    assert proc.returncode == 0, proc.stderr
    return eid


def _finalize(client: TestClient, reception_token: str, eid: str) -> dict:
    res = client.post(
        _finalize_url(eid), headers=_bearer(reception_token), json={"payment_method": "card"}
    )
    assert res.status_code == 200, res.text
    return res.json()


# ── AC1: 수납 카드 리스트(finalized) ─────────────────────────────────────────────


def test_payments_list_returns_finalized(
    client, admin_token, reception_token, patient_session, doctor_id, psql: Psql
):
    """본인 finalized 수납 1건 → 카드(요양기관·진료과·납부액·payment_no·status='finalized')."""
    token, _ = patient_session
    pid, _rrn = _link_self(client, admin_token, token, name="이수진")
    eid = _seed_in_progress(psql, pid=pid, doctor_id=doctor_id)
    paid = _finalize(client, reception_token, eid)

    res = client.get(_PAYMENTS_URL, headers=_bearer(token))
    assert res.status_code == 200, res.text
    cards = res.json()
    assert len(cards) == 1
    card = cards[0]
    assert card["encounter_id"] == eid
    assert card["status"] == "finalized"
    assert card["payment_no"] == paid["payment_no"]
    assert card["clinic_name"]  # clinic_profile.name(seed)
    assert card["department_name"]  # 진료과(NOT NULL FK)
    assert card["payment_method"] == "card"
    assert card["total_amount_krw"] == paid["total_amount_krw"]
    assert card["paid_amount_krw"] == paid["paid_amount_krw"] > 0
    # PII·내부 식별자 미투영(비-PII 결제 메타만).
    for forbidden in ("resident_no", "resident_no_masked", "finalized_by", "patient_id"):
        assert forbidden not in card


def test_payments_list_excludes_non_finalized(
    client, admin_token, reception_token, patient_session, doctor_id, psql: Psql
):
    """draft(집계만·미결제) 수납은 리스트 제외 — finalized 만 노출."""
    token, _ = patient_session
    pid, _rrn = _link_self(client, admin_token, token, name="박드래프트")
    # finalized 1건.
    eid_final = _seed_in_progress(psql, pid=pid, doctor_id=doctor_id)
    _finalize(client, reception_token, eid_final)
    # draft 1건(build 만·finalize 안 함).
    eid_draft = _seed_in_progress(psql, pid=pid, doctor_id=doctor_id)
    assert client.post(_build_url(eid_draft), headers=_bearer(reception_token)).status_code == 200

    res = client.get(_PAYMENTS_URL, headers=_bearer(token))
    assert res.status_code == 200, res.text
    eids = [c["encounter_id"] for c in res.json()]
    assert eid_final in eids
    assert eid_draft not in eids  # draft 제외(finalized 만)


def test_payments_list_unlinked_empty(client, patient_session):
    """미연결(self 레코드 없음) → 빈 목록(409 아님·8.1 패턴)."""
    token, _ = patient_session
    res = client.get(_PAYMENTS_URL, headers=_bearer(token))
    assert res.status_code == 200, res.text
    assert res.json() == []


def test_payments_list_staff_403(client, doctor_token):
    """직원(active 역할)은 환자 포털 조회 불가 — get_current_patient 게이트."""
    res = client.get(_PAYMENTS_URL, headers=_bearer(doctor_token))
    assert res.status_code == 403, res.text


# ── AC3·AC5: 영수증 상세(ReceiptResponse 재사용 + PII 경계) ────────────────────────


def test_receipt_returns_document_masked_rrn(
    client, admin_token, reception_token, patient_session, doctor_id, psql: Psql
):
    """본인 finalized 영수증 → clinic/patient/encounter/details + masked RRN(raw RRN 부재)."""
    token, _ = patient_session
    pid, rrn = _link_self(client, admin_token, token, name="이수진")
    eid = _seed_in_progress(psql, pid=pid, doctor_id=doctor_id)
    paid = _finalize(client, reception_token, eid)

    res = client.get(_receipt_url(eid), headers=_bearer(token))
    assert res.status_code == 200, res.text
    body = res.json()
    # 요양기관·환자·진료·금액 조립(7.5 ReceiptResponse).
    assert body["clinic"]["name"] and body["clinic"]["biz_no"]
    assert body["patient"]["name"] == "이수진" and body["patient"]["chart_no"]
    assert body["encounter"]["department_name"]
    assert body["status"] == "finalized"
    assert body["payment_no"] == paid["payment_no"]
    assert body["total_amount_krw"] == paid["total_amount_krw"]
    assert body["paid_amount_krw"] == paid["paid_amount_krw"]
    assert body["due_amount_krw"] == body["copay_amount_krw"] - body["paid_amount_krw"]
    assert len(body["details"]) >= 1  # 진찰료 자동 라인

    # ⚠️ PII 경계: masked RRN 만(raw 주민번호·암호문·blind index 부재).
    assert body["patient"]["resident_no_masked"].endswith("******")
    assert "resident_no" not in body["patient"]  # raw 키 부재
    assert rrn not in res.text  # raw RRN 값 자체가 본문에 없음
    assert "resident_no_enc" not in res.text and "resident_no_hash" not in res.text
    assert "finalized_by" not in res.text  # 내부 actor id 미투영


def test_receipt_other_patient_404(
    client, admin_token, reception_token, patient_session, doctor_id, psql: Psql
):
    """타인 내원 영수증 요청 → 404(존재/비소유 구분 노출 금지·IDOR 차단)."""
    token, _ = patient_session
    _link_self(client, admin_token, token, name="정본인")
    # 타인(미연결) 환자의 finalized 영수증.
    other_pid = _create_unlinked_patient(client, admin_token, rrn=_unique_rrn(), name="남남남")
    other_eid = _seed_in_progress(psql, pid=other_pid, doctor_id=doctor_id)
    _finalize(client, reception_token, other_eid)

    res = client.get(_receipt_url(other_eid), headers=_bearer(token))
    assert res.status_code == 404, res.text


def test_receipt_non_finalized_404(
    client, admin_token, reception_token, patient_session, doctor_id, psql: Psql
):
    """본인 draft(비-finalized) 영수증 요청 → 404(직원 409와 달리 self 는 draft 존재 비노출)."""
    token, _ = patient_session
    pid, _rrn = _link_self(client, admin_token, token, name="최드래프트")
    eid = _seed_in_progress(psql, pid=pid, doctor_id=doctor_id)
    assert client.post(_build_url(eid), headers=_bearer(reception_token)).status_code == 200

    res = client.get(_receipt_url(eid), headers=_bearer(token))
    assert res.status_code == 404, res.text


def test_receipt_unlinked_404(client, patient_session):
    """미연결 → 어떤 영수증도 비소유 → 404."""
    token, _ = patient_session
    res = client.get(_receipt_url(str(uuid.uuid4())), headers=_bearer(token))
    assert res.status_code == 404, res.text


def test_receipt_staff_403(client, doctor_token):
    """직원은 self 영수증 경로 불가 — get_current_patient 게이트(직원용 7.5 경로는 별도)."""
    res = client.get(_receipt_url(str(uuid.uuid4())), headers=_bearer(doctor_token))
    assert res.status_code == 403, res.text
