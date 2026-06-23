"""환자 포털 '내 기록'(Story 8.1 AC1·2·3·4) 통합 — 실 Supabase signup + self-link + psql 시드.

GET /v1/patients/me/encounters 검증:
  · AC1: 연결 환자 → 본인 내원 카드(날짜·상태·진료과·담당의·주상병 + 쉬운 말 부연 0054)
  · AC2: 세션 uid 스코프 — 타인 0건, PII 경계(patient_id·resident_no 미투영)
  · AC3: 주상병 friendly_note 조인(I10 → "혈압이 높은 상태")·취소 cancel_reason 노출
  · 권한: 직원 → 403(get_current_patient) / 미연결 → 200 빈 목록(프런트가 /self 404 로 온보딩)

내원은 psql 직접 시드(합법 전이 단계: registered→in_progress→completed). 0010 INSERT 가드 때문에
초기 상태는 registered 만 허용 → 단계 전이. 로컬 스택 + 환자 공개 가입 + 0054 마이그/시드(db reset)
필요. 미가용 시 skip(다른 통합 테스트 동일). 시드 행은 잔존(db reset 이 초기화).
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
_ME_ENCOUNTERS_URL = "/v1/patients/me/encounters"
_DEPT = "(select id from public.departments where lower(code)='im' limit 1)"


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
def doctor_ref(psql: Psql) -> tuple[str, str]:
    """담당의(doctor) uid·name — 카드 doctor_name 단언용."""
    row = psql.scalar(
        "select u.id::text || '|' || u.name from public.users u "
        "join public.roles r on r.id = u.role_id where r.code='doctor' limit 1"
    )
    uid, name = row.split("|", 1)
    return uid.lower(), name


def _link_patient(client: TestClient, admin_token: str, token: str, *, name: str) -> str:
    """미연결 환자 생성(admin) → 본인 연결(self-link) → patient_id."""
    rrn = _unique_rrn()
    pid = _create_unlinked_patient(client, admin_token, rrn=rrn, name=name)
    res = client.post(
        _SELF_LINK_URL, json={"resident_no": rrn, "name": name}, headers=_bearer(token)
    )
    assert res.status_code == 200, res.text
    return pid


def _seed_completed_encounter(
    psql: Psql, *, patient_id: str, doctor_id: str, dx_code: str | None = None
) -> str:
    """완료 내원 1건 시드(registered→in_progress→completed 합법 전이) + 선택 주상병 부착."""
    eid = str(uuid.uuid4())
    script = (
        f"select set_config('app.actor_id','{doctor_id}',false);"
        "insert into public.encounters(id, patient_id, department_id, visit_type, status, "
        f"registered_at) values ('{eid}','{patient_id}',{_DEPT},'walk_in','registered', now());"
        f"update public.encounters set status='in_progress', consult_started_at=now(), "
        f"doctor_id='{doctor_id}' where id='{eid}';"
        f"update public.encounters set status='completed', completed_at=now() where id='{eid}';"
    )
    if dx_code is not None:
        script += (
            "insert into public.encounter_diagnoses(encounter_id, diagnosis_id, is_primary, "
            f"recorded_by) values ('{eid}',(select id from public.diagnoses where "
            f"code='{dx_code}' limit 1),true,'{doctor_id}');"
        )
    proc = psql.run(script)
    assert proc.returncode == 0, f"내원 시드 실패: {proc.stderr.strip()}"
    return eid


def _seed_cancelled_encounter(psql: Psql, *, patient_id: str, reason: str) -> str:
    """취소 내원 1건 시드(registered→cancelled) + 취소 사유."""
    eid = str(uuid.uuid4())
    script = (
        "insert into public.encounters(id, patient_id, department_id, visit_type, status, "
        f"registered_at) values ('{eid}','{patient_id}',{_DEPT},'reserved','registered', now());"
        f"update public.encounters set status='cancelled', cancelled_at=now(), "
        f"cancel_reason='{reason}' where id='{eid}';"
    )
    proc = psql.run(script)
    assert proc.returncode == 0, f"취소 내원 시드 실패: {proc.stderr.strip()}"
    return eid


# ── AC1·AC3: 본인 내원 카드 + 진단 쉬운 말 부연 ────────────────────────────────


def test_me_encounters_returns_own_completed_with_diagnosis(
    client, admin_token, patient_session, doctor_ref, psql: Psql
):
    token, _ = patient_session
    doctor_id, doctor_name = doctor_ref
    pid = _link_patient(client, admin_token, token, name="이수진")
    _seed_completed_encounter(psql, patient_id=pid, doctor_id=doctor_id, dx_code="I10")

    res = client.get(_ME_ENCOUNTERS_URL, headers=_bearer(token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert isinstance(body, list) and len(body) == 1
    card = body[0]
    assert card["status"] == "completed"
    assert card["department_name"] == "내과"
    assert card["doctor_name"] == doctor_name
    # AC3: 주상병 + 0054 쉬운 말 부연.
    assert card["primary_diagnosis_name"] == "본태성(원발성) 고혈압"
    assert card["primary_diagnosis_friendly_note"] == "혈압이 높은 상태"
    # AC2 PII 경계: patient_id·resident_no 미투영.
    assert "patient_id" not in card
    assert "resident_no" not in card and "resident_no_masked" not in card


def test_me_encounters_cancelled_exposes_reason(
    client, admin_token, patient_session, psql: Psql
):
    token, _ = patient_session
    pid = _link_patient(client, admin_token, token, name="김도현")
    _seed_cancelled_encounter(psql, patient_id=pid, reason="본인 사정으로 취소")

    res = client.get(_ME_ENCOUNTERS_URL, headers=_bearer(token))
    assert res.status_code == 200, res.text
    card = res.json()[0]
    assert card["status"] == "cancelled"
    assert card["cancel_reason"] == "본인 사정으로 취소"
    assert card["primary_diagnosis_name"] is None


# ── AC2: 세션 uid 스코프(타인 0건) ────────────────────────────────────────────


def test_me_encounters_scoped_to_self_only(
    client, admin_token, patient_session, doctor_ref, psql: Psql
):
    token, _ = patient_session
    doctor_id, _ = doctor_ref
    pid = _link_patient(client, admin_token, token, name="정해린")
    _seed_completed_encounter(psql, patient_id=pid, doctor_id=doctor_id, dx_code="J00")

    # 타인(미연결) 환자 + 내원 — 본인 응답에 절대 섞이면 안 됨.
    other_pid = _create_unlinked_patient(
        client, admin_token, rrn=_unique_rrn(), name="남남남"
    )
    _seed_completed_encounter(psql, patient_id=other_pid, doctor_id=doctor_id, dx_code="I10")

    res = client.get(_ME_ENCOUNTERS_URL, headers=_bearer(token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body) == 1  # 본인 1건만(타인 0건)
    assert body[0]["primary_diagnosis_name"] == "급성 비인두염[감기]"


# ── 권한·미연결 ────────────────────────────────────────────────────────────────


def test_me_encounters_staff_forbidden_403(client, doctor_token):
    """직원(active 5역할)은 환자 포털 조회 불가 — get_current_patient 게이트."""
    res = client.get(_ME_ENCOUNTERS_URL, headers=_bearer(doctor_token))
    assert res.status_code == 403, res.text


def test_me_encounters_unlinked_returns_empty(client, patient_session):
    """미연결(self 레코드 없음) → 200 빈 목록(프런트가 GET /self 404 로 온보딩 유도)."""
    token, _ = patient_session
    res = client.get(_ME_ENCOUNTERS_URL, headers=_bearer(token))
    assert res.status_code == 200, res.text
    assert res.json() == []
