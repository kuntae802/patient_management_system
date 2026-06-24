"""환자 포털 '내 기록' 카드 펼침 상세(Story 8.2 AC1~5) 통합 — 실 Supabase + self-link + psql 시드.

GET /v1/patients/me/encounters/{encounter_id}/detail 검증:
  · AC2: 복약 안내 원천(처방 drugs 조인·dose·frequency·usage_instruction)
  · AC3: 검사 결과 요약 + 정상/주의 플래그(patient_result_*·0055)·완료 전/NULL 폴백
  · AC5: 소유 검증(타인 내원 id → 404)·직원 403·미연결 404·처방/검사 0건 → 빈 배열
  · PII·임상 서사 경계: findings·reading_conclusion·fee_schedule_id·drug_id·*_by 미투영

처방·검사는 psql 직접 시드. 0053 게이트(종결 내원 오더 차단) 때문에 오더 INSERT 는 registered 동안,
이후 완료 전이. 로컬 스택 + 환자 공개 가입 + 0055 마이그/시드(db reset) 필요. 미가용 시 skip.
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
_DEPT = "(select id from public.departments where lower(code)='im' limit 1)"
_DRUG_AMLO = "(select id from public.drugs where code='641603080' limit 1)"  # 노바스크(암로디핀)
_DRUG_TYL = "(select id from public.drugs where code='645100250' limit 1)"  # 타이레놀
_FEE_CBC = "(select id from public.fee_schedules where code='C3800' limit 1)"  # 일반혈액검사(CBC)
_FEE_HBA1C = "(select id from public.fee_schedules where code='D2700' limit 1)"  # 당화혈색소(HbA1c)


def _detail_url(eid: str) -> str:
    return f"/v1/patients/me/encounters/{eid}/detail"


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
def doctor_id(psql: Psql) -> str:
    """담당의(doctor) uid — 내원/오더 actor."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code='doctor' limit 1"
    ).strip().lower()


def _link_patient(client: TestClient, admin_token: str, token: str, *, name: str) -> str:
    rrn = _unique_rrn()
    pid = _create_unlinked_patient(client, admin_token, rrn=rrn, name=name)
    res = client.post(
        _SELF_LINK_URL, json={"resident_no": rrn, "name": name}, headers=_bearer(token)
    )
    assert res.status_code == 200, res.text
    return pid


def _seed_encounter_base(psql: Psql, *, patient_id: str, doctor_id: str) -> str:
    """registered 내원 1건 생성(오더 INSERT 가 게이트 통과하도록 비종결 상태로 시작)."""
    eid = str(uuid.uuid4())
    script = (
        f"select set_config('app.actor_id','{doctor_id}',false);"
        "insert into public.encounters(id, patient_id, department_id, visit_type, status, "
        f"registered_at) values ('{eid}','{patient_id}',{_DEPT},'walk_in','registered', now());"
    )
    proc = psql.run(script)
    assert proc.returncode == 0, f"내원 시드 실패: {proc.stderr.strip()}"
    return eid


def _complete_encounter(psql: Psql, *, eid: str, doctor_id: str) -> None:
    script = (
        f"select set_config('app.actor_id','{doctor_id}',false);"
        f"update public.encounters set status='in_progress', consult_started_at=now(), "
        f"doctor_id='{doctor_id}' where id='{eid}';"
        f"update public.encounters set status='completed', completed_at=now() where id='{eid}';"
    )
    proc = psql.run(script)
    assert proc.returncode == 0, f"내원 완료 전이 실패: {proc.stderr.strip()}"


def _seed_full_encounter(psql: Psql, *, patient_id: str, doctor_id: str) -> str:
    """완료 내원 + 처방(암로디핀·타이레놀 2라인) + 검사 2건(CBC 정상·HbA1c 주의)."""
    eid = _seed_encounter_base(psql, patient_id=patient_id, doctor_id=doctor_id)
    rxid = str(uuid.uuid4())
    x_cbc = str(uuid.uuid4())
    x_hba1c = str(uuid.uuid4())
    script = (
        f"select set_config('app.actor_id','{doctor_id}',false);"
        # 처방(issued) + 상세 2라인 — registered 동안(0053 게이트 통과).
        f"insert into public.prescriptions(id, encounter_id, status, ordered_by, ordered_at) "
        f"values ('{rxid}','{eid}','issued','{doctor_id}', now());"
        "insert into public.prescription_details"
        "(prescription_id, drug_id, dose, frequency, duration_days, usage_instruction) values "
        f"('{rxid}',{_DRUG_AMLO},1,'1일 1회',28,'아침 식후'),"
        f"('{rxid}',{_DRUG_TYL},1,'필요시',3,'발열 시');"
        # 검사 2건(ordered).
        "insert into public.examinations(id, encounter_id, exam_type, fee_schedule_id, ordered_by) "
        f"values ('{x_cbc}','{eid}','lab',{_FEE_CBC},'{doctor_id}'),"
        f"('{x_hba1c}','{eid}','lab',{_FEE_HBA1C},'{doctor_id}');"
        # 검사 완료 전이(ordered→performed→completed) + 환자용 결과·플래그.
        f"update public.examinations set status='performed', performed_by='{doctor_id}', "
        f"performed_at=now() where id in ('{x_cbc}','{x_hba1c}');"
        "update public.examinations set status='completed', completed_by="
        f"'{doctor_id}', completed_at=now(), "
        "findings = case id when '" + x_cbc + "'::uuid then 'WBC 7.2, Hb 14.1 — 정상' "
        "when '" + x_hba1c + "'::uuid then 'HbA1c 7.8% — 목표 미달' end, "
        "patient_result_summary = case id when '" + x_cbc + "'::uuid then "
        "'피검사 수치가 모두 정상 범위예요.' when '" + x_hba1c + "'::uuid then "
        "'혈당 조절이 조금 더 필요해요.' end, "
        "patient_result_flag = case id when '" + x_cbc + "'::uuid then 'normal' "
        "when '" + x_hba1c + "'::uuid then 'attention' end "
        f"where id in ('{x_cbc}','{x_hba1c}');"
    )
    proc = psql.run(script)
    assert proc.returncode == 0, f"오더 시드 실패: {proc.stderr.strip()}"
    _complete_encounter(psql, eid=eid, doctor_id=doctor_id)
    return eid


# ── AC2·AC3: 처방·검사 결과 반환 + PII/임상 서사 경계 ─────────────────────────────


def test_detail_returns_prescriptions_and_exam_results(
    client, admin_token, patient_session, doctor_id, psql: Psql
):
    token, _ = patient_session
    pid = _link_patient(client, admin_token, token, name="이수진")
    eid = _seed_full_encounter(psql, patient_id=pid, doctor_id=doctor_id)

    res = client.get(_detail_url(eid), headers=_bearer(token))
    assert res.status_code == 200, res.text
    body = res.json()

    # AC2: 처방 2라인(약명·dose·frequency·용법·일수·단위).
    rx = body["prescriptions"]
    assert len(rx) == 2
    amlo = next(r for r in rx if "암로디핀" in r["drug_name"])
    assert amlo["dose"] == 1
    assert amlo["frequency"] == "1일 1회"
    assert amlo["usage_instruction"] == "아침 식후"
    assert amlo["duration_days"] == 28
    assert amlo["unit"] == "정"
    # PII/내부 식별자 미투영.
    for r in rx:
        assert "drug_id" not in r and "ingredient_code" not in r and "ordered_by" not in r

    # AC3: 검사 결과 요약 + 정상/주의 플래그.
    exams = body["examinations"]
    assert len(exams) == 2
    cbc = next(e for e in exams if e["exam_name"] == "일반혈액검사(CBC)")
    assert cbc["status"] == "completed"
    assert cbc["patient_result_flag"] == "normal"
    assert cbc["patient_result_summary"] == "피검사 수치가 모두 정상 범위예요."
    hba1c = next(e for e in exams if e["exam_name"] == "당화혈색소(HbA1c)")
    assert hba1c["patient_result_flag"] == "attention"

    # ⚠️ 임상 서사·내부 식별자 미투영(환자 비노출 — 구조적 차단).
    for e in exams:
        assert "findings" not in e and "reading_conclusion" not in e
        assert "fee_schedule_id" not in e and "ordered_by" not in e and "completed_by" not in e


def test_detail_exam_without_result_falls_back_null(
    client, admin_token, patient_session, doctor_id, psql: Psql
):
    """완료 검사여도 patient_result_* 가 NULL 이면 요약·플래그 None(클라가 안내 폴백)."""
    token, _ = patient_session
    pid = _link_patient(client, admin_token, token, name="박결과")
    eid = _seed_encounter_base(psql, patient_id=pid, doctor_id=doctor_id)
    x = str(uuid.uuid4())
    script = (
        f"select set_config('app.actor_id','{doctor_id}',false);"
        "insert into public.examinations(id, encounter_id, exam_type, fee_schedule_id, ordered_by) "
        f"values ('{x}','{eid}','lab',{_FEE_CBC},'{doctor_id}');"
        f"update public.examinations set status='performed', performed_by='{doctor_id}', "
        f"performed_at=now() where id='{x}';"
        f"update public.examinations set status='completed', completed_by='{doctor_id}', "
        f"completed_at=now() where id='{x}';"
    )
    assert psql.run(script).returncode == 0
    _complete_encounter(psql, eid=eid, doctor_id=doctor_id)

    res = client.get(_detail_url(eid), headers=_bearer(token))
    assert res.status_code == 200, res.text
    exams = res.json()["examinations"]
    assert len(exams) == 1
    assert exams[0]["status"] == "completed"
    assert exams[0]["patient_result_summary"] is None
    assert exams[0]["patient_result_flag"] is None


def test_detail_empty_when_no_orders(
    client, admin_token, patient_session, doctor_id, psql: Psql
):
    """처방·검사 0건 내원 → 200 + 빈 배열(클라가 섹션 생략/안내)."""
    token, _ = patient_session
    pid = _link_patient(client, admin_token, token, name="공내역")
    eid = _seed_encounter_base(psql, patient_id=pid, doctor_id=doctor_id)
    _complete_encounter(psql, eid=eid, doctor_id=doctor_id)

    res = client.get(_detail_url(eid), headers=_bearer(token))
    assert res.status_code == 200, res.text
    assert res.json() == {"prescriptions": [], "examinations": []}


# ── AC5: 소유 검증(IDOR 차단)·권한·미연결 ────────────────────────────────────────


def test_detail_other_patient_encounter_404(
    client, admin_token, patient_session, doctor_id, psql: Psql
):
    """타인 내원 id 로 요청 → 404(존재/비소유 구분 노출 금지·IDOR 차단)."""
    token, _ = patient_session
    _link_patient(client, admin_token, token, name="정본인")
    # 타인(미연결) 환자 + 완료 내원(처방·검사 보유).
    other_pid = _create_unlinked_patient(
        client, admin_token, rrn=_unique_rrn(), name="남남남"
    )
    other_eid = _seed_full_encounter(psql, patient_id=other_pid, doctor_id=doctor_id)

    res = client.get(_detail_url(other_eid), headers=_bearer(token))
    assert res.status_code == 404, res.text


def test_detail_staff_forbidden_403(client, doctor_token):
    """직원(active 5역할)은 환자 포털 조회 불가 — get_current_patient 게이트."""
    res = client.get(_detail_url(str(uuid.uuid4())), headers=_bearer(doctor_token))
    assert res.status_code == 403, res.text


def test_detail_unlinked_patient_404(client, patient_session):
    """미연결(self 레코드 없음) → 어떤 내원도 비소유 → 404."""
    token, _ = patient_session
    res = client.get(_detail_url(str(uuid.uuid4())), headers=_bearer(token))
    assert res.status_code == 404, res.text
