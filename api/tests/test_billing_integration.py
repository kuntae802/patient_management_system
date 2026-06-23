"""수납 집계·조회·워크리스트(Story 7.2 AC3·4·5) 통합 테스트 — 실 Supabase 토큰 + FastAPI TestClient.

build_payment(집계 빌드)·get_payment(조회)·billing/worklist(정산 대상) 엔드포인트를 0046 집계 함수와
함께 검증. 로컬 스택/부트스트랩 없으면 skip. 검증:
  · AC3: POST /encounters/{id}/payment → 200 draft 헤더 + 라인 집계(total=Σ·자동 라인 fee_item)·멱등
  · AC4: GET /encounters/{id}/payment → 200(빌드 후) / 404(빌드 전·미집계)
  · AC5: GET /billing/worklist → in_progress 내원 + estimated_total(라이브)
  · 권한: payment.manage 미보유(doctor·nurse) → POST 403 / payment.read 미보유(nurse) → GET 403
  · 404: 미존재 내원 POST/GET

⚠️ 셋업 행(patient·encounter·fee_items)은 psql 직접 커밋(API 가 별 커넥션 조회) — db reset 이 초기화.
"""

from __future__ import annotations

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
_DEPT = "(select id from public.departments where lower(code) = 'im' limit 1)"


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
def reception_token() -> str:
    """수납 정산 — payment.manage + payment.read 보유(seed 7.1/7.2)."""
    token = _get_token("reception@pms.local", "Staff1234")
    if not token:
        pytest.skip("reception 부트스트랩 미가용 — 'supabase db reset' 후 재실행")
    return token


@pytest.fixture(scope="module")
def doctor_token() -> str:
    """payment.read 보유·payment.manage 미보유 — 빌드 403 baseline."""
    token = _get_token("doctor@pms.local", "Staff1234")
    if not token:
        pytest.skip("doctor 부트스트랩 미가용 — 'supabase db reset' 후 재실행")
    return token


@pytest.fixture(scope="module")
def nurse_token() -> str:
    """payment.read·manage 모두 미보유 — 조회·빌드·워크리스트 403 baseline."""
    token = _get_token("nurse@pms.local", "Staff1234")
    if not token:
        pytest.skip("nurse 부트스트랩 미가용 — 'supabase db reset' 후 재실행")
    return token


@pytest.fixture(scope="module")
def client(admin_token: str):
    # with-블록 = lifespan 실행(asyncpg 풀 생성). 풀 없이는 권한 평가·쓰기 불가.
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def doctor_id(psql: Psql) -> str:
    """doctor auth uid — start_consult(워크리스트 셋업 in_progress 전이) 호출자."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'doctor' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def admin_id(psql: Psql) -> str:
    """admin auth uid — 전권(examination.perform). 부분수행 셋업의 검사 수행 호출자(7.10)."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'admin' limit 1"
    ).lower()


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _payment_url(encounter_id: str) -> str:
    return f"/v1/encounters/{encounter_id}/payment"


def _fee_item_sql(eid: str, *, amount: int, coverage: str, code: str) -> str:
    fiid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    fee = f"(select id from public.fee_schedules where lower(code)='{code}' limit 1)"
    return (
        "insert into public.fee_items(id, encounter_id, fee_schedule_id, source_type, source_id, "
        " quantity, unit_amount_krw, amount_krw, category, coverage_type) "
        f"values ('{fiid}','{eid}',{fee},'examination','{sid}',1,{amount},{amount},"
        f"'검사료','{coverage}');"
    )


def _patient_sql(pid: str, *, insurance: str = "health_insurance") -> str:
    return (
        "insert into public.patients(id, name, birth_date, sex, resident_no_enc, "
        "resident_no_hash, resident_no_masked, insurance_type) values "
        f"('{pid}','집계통합TEST','1990-01-01','male','\\x00'::bytea,"
        f"'__enc_{pid}__','900101-1******','{insurance}');"
    )


def _setup_billable_encounter(
    psql: Psql, *, with_fees: bool = True, insurance: str = "health_insurance"
) -> str:
    """내원(registered) + 수가 fee_items 커밋 — encounter_id 반환. build_payment 는 상태 무관 집계.

    급여 12590 + 비급여 3200 = total 15790. with_fees=False 면 빈 내원. insurance = 환자 보험유형
    (본인부담 산정 분기). 수가는 직접 적재(start_consult 미경유 → 진찰료 자동발생 없음)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    sql = _patient_sql(pid, insurance=insurance) + (
        "insert into public.encounters(id, patient_id, department_id, visit_type, status) "
        f"values ('{eid}','{pid}',{_DEPT},'walk_in','registered');"
    )
    if with_fees:
        sql += _fee_item_sql(eid, amount=12590, coverage="covered", code="aa254")
        sql += _fee_item_sql(eid, amount=3200, coverage="non_covered", code="aa154")
    proc = psql.run(sql)
    assert proc.returncode == 0, proc.stderr
    return eid


def _setup_in_progress_encounter(psql: Psql, doctor_id: str) -> str:
    """registered → start_consult(doctor) = in_progress + 진찰료 자동 적재(AA154 초진 17610).

    워크리스트(in_progress 필터)용. 단일 begin/commit(claims local) — 커밋되어 API 가 조회."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    claims = '{"sub":"' + doctor_id + '","role":"authenticated"}'
    sql = (
        "begin;"
        + _patient_sql(pid)
        + "insert into public.encounters(id, patient_id, department_id, visit_type, status) "
        f"values ('{eid}','{pid}',{_DEPT},'walk_in','registered');"
        f"select set_config('request.jwt.claims', '{claims}', true);"
        f"select set_config('app.actor_id', '{doctor_id}', true);"
        f"select public.start_consult('{eid}');"
        "commit;"
    )
    proc = psql.run(sql)
    assert proc.returncode == 0, proc.stderr
    return eid


# ── AC3: 집계 빌드 POST ───────────────────────────────────────────────────────


def test_build_payment_aggregates(client, reception_token, psql):
    """POST → 200 draft 헤더 + 라인 2(total 15790·급여 12590·비급여 3200·자동 라인 fee_item)."""
    eid = _setup_billable_encounter(psql)
    res = client.post(_payment_url(eid), headers=_bearer(reception_token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["encounter_id"] == eid
    assert body["status"] == "draft"
    assert body["total_amount_krw"] == 15790
    assert body["covered_amount_krw"] == 12590
    assert body["non_covered_amount_krw"] == 3200
    assert len(body["details"]) == 2
    # 자동 집계 라인 = 전부 fee_item_id 보유("자동" 마커 근거) + code 스냅샷.
    assert all(d["fee_item_id"] for d in body["details"])
    assert all(d["code"] for d in body["details"])
    # 본인부담 산정(7.3) = build→price 원자 호출로 함께 채워짐(건강보험: 급여 12590×0.3 절사 3770
    #   + 비급여 3200 전액 → copay 6970·insurer 8820·total=copay+insurer).
    assert body["insurance_type"] == "health_insurance"
    assert body["copay_amount_krw"] == 6970
    assert body["insurer_amount_krw"] == 8820
    assert body["total_amount_krw"] == body["copay_amount_krw"] + body["insurer_amount_krw"]


def test_build_payment_prices_self_pay_full(client, reception_token, psql):
    """일반(self_pay) 환자 → 급여라도 전액 본인부담(copay=total·insurer 0·insurance_type 노출)."""
    eid = _setup_billable_encounter(psql, insurance="self_pay")
    res = client.post(_payment_url(eid), headers=_bearer(reception_token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["insurance_type"] == "self_pay"
    assert body["copay_amount_krw"] == 15790  # 급여+비급여 전액 본인
    assert body["insurer_amount_krw"] == 0
    # 라인 불변식: amount = copay + insurer.
    assert all(
        d["amount_krw"] == d["copay_amount_krw"] + d["insurer_amount_krw"] for d in body["details"]
    )


def test_build_payment_prices_auto_insurance_zero_copay(client, reception_token, psql):
    """자동차보험 환자 → 급여는 보험사 전액(copay 0)·비급여만 본인(3200)."""
    eid = _setup_billable_encounter(psql, insurance="auto_insurance")
    res = client.post(_payment_url(eid), headers=_bearer(reception_token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["insurance_type"] == "auto_insurance"
    assert body["copay_amount_krw"] == 3200  # 비급여만 본인(급여 12590 = 보험사)
    assert body["insurer_amount_krw"] == 12590


def test_build_payment_idempotent(client, reception_token, psql):
    """POST 2회 → 라인 중복 0(멱등). 같은 라인 수·총액 유지."""
    eid = _setup_billable_encounter(psql)
    first = client.post(_payment_url(eid), headers=_bearer(reception_token))
    second = client.post(_payment_url(eid), headers=_bearer(reception_token))
    assert first.status_code == 200 and second.status_code == 200, second.text
    assert len(second.json()["details"]) == 2
    assert second.json()["total_amount_krw"] == 15790
    assert first.json()["id"] == second.json()["id"]  # 동일 헤더(내원 1:1)


def test_build_payment_empty_encounter(client, reception_token, psql):
    """fee_item 없는 내원 → 200 빈 draft(라인 0·총액 0)."""
    eid = _setup_billable_encounter(psql, with_fees=False)
    res = client.post(_payment_url(eid), headers=_bearer(reception_token))
    assert res.status_code == 200, res.text
    assert res.json()["details"] == []
    assert res.json()["total_amount_krw"] == 0


def test_build_payment_nonexistent_404(client, reception_token):
    """미존재 내원 POST → 404 not_found."""
    res = client.post(_payment_url(str(uuid.uuid4())), headers=_bearer(reception_token))
    assert res.status_code == 404, res.text
    assert res.json()["error"]["code"] == "not_found", res.text


def test_build_payment_forbidden_doctor(client, doctor_token, psql):
    """doctor(payment.read 보유·manage 미보유) POST → 403(쓰기 권한 분리)."""
    eid = _setup_billable_encounter(psql)
    res = client.post(_payment_url(eid), headers=_bearer(doctor_token))
    assert res.status_code == 403, res.text
    assert res.json()["error"]["code"] == "forbidden", res.text


def test_build_payment_forbidden_nurse(client, nurse_token, psql):
    """nurse(payment.* 미보유) POST → 403."""
    eid = _setup_billable_encounter(psql)
    res = client.post(_payment_url(eid), headers=_bearer(nurse_token))
    assert res.status_code == 403, res.text


# ── AC4: 수납 건 조회 GET ─────────────────────────────────────────────────────


def test_get_payment_after_build(client, reception_token, psql):
    """빌드 후 GET → 200 헤더 + 라인(빌드 결과와 동일 총액 + 영속된 본인부담 산정·보험유형)."""
    eid = _setup_billable_encounter(psql)
    client.post(_payment_url(eid), headers=_bearer(reception_token))
    res = client.get(_payment_url(eid), headers=_bearer(reception_token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total_amount_krw"] == 15790
    assert len(body["details"]) == 2
    # 산정 결과 영속(POST 의 build→price) — GET 도 동일 copay/insurer·insurance_type 노출.
    assert body["insurance_type"] == "health_insurance"
    assert body["copay_amount_krw"] == 6970
    assert body["insurer_amount_krw"] == 8820


def test_get_payment_before_build_404(client, reception_token, psql):
    """빌드 전(미집계) GET → 404(수납 건 없음)."""
    eid = _setup_billable_encounter(psql)
    res = client.get(_payment_url(eid), headers=_bearer(reception_token))
    assert res.status_code == 404, res.text
    assert res.json()["error"]["code"] == "not_found", res.text


def test_get_payment_forbidden_nurse(client, nurse_token, reception_token, psql):
    """nurse(payment.read 미보유) GET → 403(빌드는 reception 으로 선행)."""
    eid = _setup_billable_encounter(psql)
    client.post(_payment_url(eid), headers=_bearer(reception_token))
    res = client.get(_payment_url(eid), headers=_bearer(nurse_token))
    assert res.status_code == 403, res.text


def test_doctor_can_read_payment(client, doctor_token, reception_token, psql):
    """doctor(payment.read 보유) GET → 200(조회는 가능·쓰기만 불가)."""
    eid = _setup_billable_encounter(psql)
    client.post(_payment_url(eid), headers=_bearer(reception_token))
    res = client.get(_payment_url(eid), headers=_bearer(doctor_token))
    assert res.status_code == 200, res.text


# ── AC5: 수납 워크리스트 GET ──────────────────────────────────────────────────


def test_worklist_contains_in_progress(client, reception_token, doctor_id, psql):
    """GET /billing/worklist → 오늘 in_progress 내원이 estimated_total(진찰료 17610) 포함."""
    eid = _setup_in_progress_encounter(psql, doctor_id)
    res = client.get("/v1/billing/worklist", headers=_bearer(reception_token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert "data" in body and "meta" in body
    row = next((r for r in body["data"] if r["encounter_id"] == eid), None)
    assert row is not None, f"내원 {eid} 워크리스트 미포함"
    assert row["estimated_total_krw"] == 17610  # 진찰료 AA154(초진) 자동 적재
    assert row["status"] == "in_progress"
    assert row["patient_name"] and row["chart_no"]  # denormalized 표시


def test_worklist_forbidden_nurse(client, nurse_token):
    """nurse(payment.read 미보유) 워크리스트 → 403."""
    res = client.get("/v1/billing/worklist", headers=_bearer(nurse_token))
    assert res.status_code == 403, res.text


# ── Story 7.4: 수납 finalize(결제·내원 완료) POST ─────────────────────────────


def _finalize_url(encounter_id: str) -> str:
    return f"/v1/encounters/{encounter_id}/payment/finalize"


def _encounter_status(psql: Psql, eid: str) -> str:
    return psql.scalar(f"select status from public.encounters where id='{eid}'")


def _setup_finalizable_encounter(
    psql: Psql, doctor_id: str, *, primary: bool = True, insurance: str = "health_insurance"
) -> str:
    """in_progress 내원 + 진찰료 자동(AA154 초진 17610) + 주상병(완료 게이트용). encounter_id 반환.

    finalize 는 complete_encounter(주상병 게이트 PT422) 호출 → primary=True 기본. primary=False
    = 422 baseline. begin/commit(doctor claims — start_consult·진단 부착 우회)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    claims = '{"sub":"' + doctor_id + '","role":"authenticated"}'
    sql = (
        "begin;"
        + _patient_sql(pid, insurance=insurance)
        + "insert into public.encounters(id, patient_id, department_id, visit_type, status) "
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


def test_finalize_payment_completes_encounter(client, reception_token, doctor_id, psql):
    """reception finalize → 200 finalized·영수증·결제수단·paid=copay(5280)·신원·completed."""
    eid = _setup_finalizable_encounter(psql, doctor_id)
    res = client.post(
        _finalize_url(eid), headers=_bearer(reception_token), json={"payment_method": "card"}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "finalized"
    assert body["payment_method"] == "card"
    assert body["payment_no"] and body["payment_no"].startswith("R-")
    # 건강보험 초진 AA154 17610 × 0.3 = 5283 → copay 5280(절사)·전액 정산 paid=copay.
    assert body["copay_amount_krw"] == 5280
    assert body["paid_amount_krw"] == 5280
    assert body["finalized_at"] and body["finalized_by"]
    assert body["patient_name"] and body["chart_no"]  # 신원 재진술 confirm 용 노출
    assert _encounter_status(psql, eid) == "completed"  # complete_encounter 전이(reception grant)


def test_finalize_payment_missing_primary_diagnosis_422(client, reception_token, doctor_id, psql):
    """주상병 미부착 내원 finalize → 422 primary_diagnosis_required·내원 in_progress 유지(롤백)."""
    eid = _setup_finalizable_encounter(psql, doctor_id, primary=False)
    res = client.post(
        _finalize_url(eid), headers=_bearer(reception_token), json={"payment_method": "card"}
    )
    assert res.status_code == 422, res.text
    assert res.json()["error"]["code"] == "primary_diagnosis_required", res.text
    assert _encounter_status(psql, eid) == "in_progress"  # 결제·완료 원자 롤백


def test_finalize_payment_double_409(client, reception_token, doctor_id, psql):
    """이미 결제된 수납 재finalize → 409 invalid_transition(이중결제 차단)·첫 결제 불변."""
    eid = _setup_finalizable_encounter(psql, doctor_id)
    first = client.post(
        _finalize_url(eid), headers=_bearer(reception_token), json={"payment_method": "card"}
    )
    assert first.status_code == 200, first.text
    second = client.post(
        _finalize_url(eid), headers=_bearer(reception_token), json={"payment_method": "cash"}
    )
    assert second.status_code == 409, second.text
    assert second.json()["error"]["code"] == "invalid_transition", second.text
    # 이중결제 차단 핵심: 2차 실패가 1차 결제를 덮어쓰지 않음(영수증번호·결제수단·납부액 불변).
    after = client.get(_payment_url(eid), headers=_bearer(reception_token))
    assert after.status_code == 200, after.text
    body = after.json()
    assert body["status"] == "finalized"
    assert body["payment_method"] == "card"  # 'cash' 로 덮어쓰이지 않음
    assert body["payment_no"] == first.json()["payment_no"]
    assert body["paid_amount_krw"] == first.json()["paid_amount_krw"]


def test_finalize_payment_invalid_method_422(client, reception_token, doctor_id, psql):
    """결제수단 Literal 위반(bitcoin) → 422(Pydantic 1차 검증)."""
    eid = _setup_finalizable_encounter(psql, doctor_id)
    res = client.post(
        _finalize_url(eid), headers=_bearer(reception_token), json={"payment_method": "bitcoin"}
    )
    assert res.status_code == 422, res.text


def test_finalize_payment_forbidden_doctor(client, doctor_token, doctor_id, psql):
    """doctor(payment.manage 미보유) finalize → 403(쓰기 권한 분리·encounter.complete 무관)."""
    eid = _setup_finalizable_encounter(psql, doctor_id)
    res = client.post(
        _finalize_url(eid), headers=_bearer(doctor_token), json={"payment_method": "card"}
    )
    assert res.status_code == 403, res.text


def test_finalize_payment_forbidden_nurse(client, nurse_token, doctor_id, psql):
    """nurse(payment.* 미보유) finalize → 403."""
    eid = _setup_finalizable_encounter(psql, doctor_id)
    res = client.post(
        _finalize_url(eid), headers=_bearer(nurse_token), json={"payment_method": "card"}
    )
    assert res.status_code == 403, res.text


def test_finalize_payment_nonexistent_404(client, reception_token):
    """미존재 내원 finalize → 404."""
    res = client.post(
        _finalize_url(str(uuid.uuid4())),
        headers=_bearer(reception_token),
        json={"payment_method": "card"},
    )
    assert res.status_code == 404, res.text


# ── Story 7.5: 진료비 계산서·영수증 출력 (receipt 데이터 + 내보내기 감사) ───────


def _receipt_url(encounter_id: str) -> str:
    return f"/v1/encounters/{encounter_id}/payment/receipt"


def _export_url(encounter_id: str) -> str:
    return f"/v1/encounters/{encounter_id}/payment/receipt/export"


def _export_audit_count(psql: Psql, eid: str, document_type: str | None = None) -> int:
    """한 내원의 문서 내보내기('document_export') 감사 행 수 — payment_id 대상 'read' 이벤트.

    document_type 지정 시 해당 문서 유형(receipt/statement)만 카운트(after_data 구분성 검증).
    """
    doc_filter = f"and a.after_data->>'document_type'='{document_type}' " if document_type else ""
    return int(
        psql.scalar(
            "select count(*) from public.audit_logs a "
            "where a.action='read' and a.target_table='payments' "
            "and a.after_data->>'event'='document_export' "
            f"{doc_filter}"
            f"and a.target_id=(select id::text from public.payments where encounter_id='{eid}');"
        )
    )


def _finalize(client, reception_token, eid: str) -> dict:
    res = client.post(
        _finalize_url(eid), headers=_bearer(reception_token), json={"payment_method": "card"}
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_receipt_assembles_finalized_document(client, reception_token, doctor_id, psql):
    """finalized 영수증 GET → 200·요양기관·환자(masked RRN)·진료과/담당의·결제·발급·납부할금액."""
    eid = _setup_finalizable_encounter(psql, doctor_id)
    paid = _finalize(client, reception_token, eid)
    res = client.get(_receipt_url(eid), headers=_bearer(reception_token))
    assert res.status_code == 200, res.text
    body = res.json()
    # 요양기관(clinic_profile seed)
    assert body["clinic"]["name"] == "○○의원"
    assert body["clinic"]["hira_no"] == "31234567"
    # 환자 — masked RRN 만(full 미렌더)
    assert body["patient"]["resident_no_masked"] == "900101-1******"
    assert body["patient"]["chart_no"]
    assert body["patient"]["insurance_type"] == "health_insurance"
    # 진료 — 진료과(IM=내과)·담당의(start_consult doctor)
    assert body["encounter"]["department_name"] == "내과"
    assert body["encounter"]["doctor_name"]
    assert body["encounter"]["treatment_started_on"]
    # 결제·발급
    assert body["status"] == "finalized"
    assert body["payment_no"] == paid["payment_no"]
    assert body["payment_method"] == "card"
    assert body["issued_by_name"]  # finalized_by → users.name(발급담당)
    # 3행 합계: 본인부담총액(copay) / 기납부(paid) / 납부할금액(due=copay-paid·전액정산이면 0)
    assert body["copay_amount_krw"] == paid["copay_amount_krw"]
    assert body["paid_amount_krw"] == paid["paid_amount_krw"]
    assert body["due_amount_krw"] == body["copay_amount_krw"] - body["paid_amount_krw"]
    assert len(body["details"]) >= 1
    # PII 경계: raw 주민번호(13자리) 미유입 — 마스킹 값만.
    assert "******" in res.text
    assert "9001011" not in res.text


def test_receipt_draft_rejected_409(client, reception_token, psql):
    """비-finalized(draft) 수납 영수증 GET → 409 invalid_transition('정산된 수납 건만')."""
    eid = _setup_billable_encounter(psql)
    client.post(_payment_url(eid), headers=_bearer(reception_token))  # draft 빌드만(finalize 안 함)
    res = client.get(_receipt_url(eid), headers=_bearer(reception_token))
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "invalid_transition", res.text


def test_receipt_nonexistent_404(client, reception_token):
    """미존재(빌드 전) 영수증 GET → 404."""
    res = client.get(_receipt_url(str(uuid.uuid4())), headers=_bearer(reception_token))
    assert res.status_code == 404, res.text
    assert res.json()["error"]["code"] == "not_found", res.text


def test_receipt_forbidden_nurse(client, nurse_token, reception_token, doctor_id, psql):
    """nurse(payment.read 미보유) 영수증 GET → 403(finalize 는 reception 선행)."""
    eid = _setup_finalizable_encounter(psql, doctor_id)
    _finalize(client, reception_token, eid)
    res = client.get(_receipt_url(eid), headers=_bearer(nurse_token))
    assert res.status_code == 403, res.text


def test_doctor_can_read_receipt(client, doctor_token, reception_token, doctor_id, psql):
    """doctor(payment.read 보유) 영수증 GET → 200(조회 가능)."""
    eid = _setup_finalizable_encounter(psql, doctor_id)
    _finalize(client, reception_token, eid)
    res = client.get(_receipt_url(eid), headers=_bearer(doctor_token))
    assert res.status_code == 200, res.text


def test_export_records_audit_204(client, reception_token, doctor_id, psql):
    """내보내기 POST → 204 + audit 'read' 1건(receipt). 재호출 = 각 인쇄 1감사(2건 누적)."""
    eid = _setup_finalizable_encounter(psql, doctor_id)
    _finalize(client, reception_token, eid)
    assert _export_audit_count(psql, eid) == 0
    first = client.post(
        _export_url(eid), headers=_bearer(reception_token), json={"document_type": "receipt"}
    )
    assert first.status_code == 204, first.text
    assert _export_audit_count(psql, eid) == 1
    # 각 인쇄가 독립 내보내기 이벤트 — 재호출 시 감사 누적(중복 제거 안 함).
    second = client.post(
        _export_url(eid), headers=_bearer(reception_token), json={"document_type": "receipt"}
    )
    assert second.status_code == 204, second.text
    assert _export_audit_count(psql, eid) == 2


def test_export_default_document_type(client, reception_token, doctor_id, psql):
    """document_type 미지정 → 기본 'receipt'(Literal default)·204."""
    eid = _setup_finalizable_encounter(psql, doctor_id)
    _finalize(client, reception_token, eid)
    res = client.post(_export_url(eid), headers=_bearer(reception_token), json={})
    assert res.status_code == 204, res.text
    assert _export_audit_count(psql, eid) == 1


def test_export_statement_records_audit_204(client, reception_token, doctor_id, psql):
    """세부산정내역서(Story 7.6) 내보내기 → 204 + audit 'read' 1건(document_type='statement').

    영수증(receipt)과 동일 엔드포인트·RPC(log_payment_document_export·제네릭 text)이나 after_data 의
    document_type 으로 구분 기록된다(receipt 1 + statement 1 = 총 2·각 유형 1)."""
    eid = _setup_finalizable_encounter(psql, doctor_id)
    _finalize(client, reception_token, eid)
    res = client.post(
        _export_url(eid), headers=_bearer(reception_token), json={"document_type": "statement"}
    )
    assert res.status_code == 204, res.text
    assert _export_audit_count(psql, eid, "statement") == 1
    assert _export_audit_count(psql, eid, "receipt") == 0
    # 영수증 내보내기도 하면 유형별 1건씩 분리 카운트(총 2).
    client.post(
        _export_url(eid), headers=_bearer(reception_token), json={"document_type": "receipt"}
    )
    assert _export_audit_count(psql, eid, "receipt") == 1
    assert _export_audit_count(psql, eid) == 2


def test_export_forbidden_nurse(client, nurse_token, reception_token, doctor_id, psql):
    """nurse(payment.read 미보유) 내보내기 → 403."""
    eid = _setup_finalizable_encounter(psql, doctor_id)
    _finalize(client, reception_token, eid)
    res = client.post(
        _export_url(eid), headers=_bearer(nurse_token), json={"document_type": "receipt"}
    )
    assert res.status_code == 403, res.text


def test_export_nonexistent_payment_404(client, reception_token):
    """payment 미존재 내원 내보내기 → 404."""
    res = client.post(
        _export_url(str(uuid.uuid4())),
        headers=_bearer(reception_token),
        json={"document_type": "receipt"},
    )
    assert res.status_code == 404, res.text


# ── Story 7.8: 선결제(선수납) + 차액 정산 + 워크리스트 registered ──────────────


def _prepay_url(encounter_id: str) -> str:
    return f"/v1/encounters/{encounter_id}/payment/prepay"


def test_prepay_at_registered_accumulates(client, reception_token, psql):
    """registered(수가 0) 선결제 5000 → 200 draft·paid=5000·billing_type prepaid(선수납 진입점)."""
    eid = _setup_billable_encounter(psql, with_fees=False)
    res = client.post(
        _prepay_url(eid),
        headers=_bearer(reception_token),
        json={"amount_krw": 5000, "payment_method": "card"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "draft"
    assert body["billing_type"] == "prepaid"
    assert body["paid_amount_krw"] == 5000
    assert body["payment_method"] == "card"


def test_prepay_invalid_amount_422(client, reception_token, psql):
    """선결제 금액 0/음수/상한초과 → 422(Pydantic Field gt=0·le=1억 — int4 overflow 방어)."""
    eid = _setup_billable_encounter(psql, with_fees=False)
    zero = client.post(
        _prepay_url(eid),
        headers=_bearer(reception_token),
        json={"amount_krw": 0, "payment_method": "card"},
    )
    assert zero.status_code == 422, zero.text
    over_cap = client.post(
        _prepay_url(eid),
        headers=_bearer(reception_token),
        json={"amount_krw": 100_000_001, "payment_method": "card"},  # 1억 초과
    )
    assert over_cap.status_code == 422, over_cap.text


def test_prepay_forbidden_doctor(client, doctor_token, psql):
    """doctor(payment.read 보유·manage 미보유) 선결제 → 403(쓰기 권한 분리)."""
    eid = _setup_billable_encounter(psql, with_fees=False)
    res = client.post(
        _prepay_url(eid),
        headers=_bearer(doctor_token),
        json={"amount_krw": 5000, "payment_method": "card"},
    )
    assert res.status_code == 403, res.text


def test_prepay_then_finalize_settles_difference(client, reception_token, doctor_id, psql):
    """선결제 3000(copay 5280) → finalize → paid=5280(차액 정산·완납)·billing_type prepaid 유지."""
    eid = _setup_finalizable_encounter(psql, doctor_id)
    prepay = client.post(
        _prepay_url(eid),
        headers=_bearer(reception_token),
        json={"amount_krw": 3000, "payment_method": "card"},
    )
    assert prepay.status_code == 200, prepay.text
    assert prepay.json()["paid_amount_krw"] == 3000
    final = client.post(
        _finalize_url(eid), headers=_bearer(reception_token), json={"payment_method": "card"}
    )
    assert final.status_code == 200, final.text
    body = final.json()
    assert body["status"] == "finalized"
    assert body["copay_amount_krw"] == 5280
    assert body["paid_amount_krw"] == 5280  # greatest(5280, 3000) — 차액 수금·완납
    assert body["billing_type"] == "prepaid"
    assert _encounter_status(psql, eid) == "completed"


def test_worklist_includes_registered(client, reception_token, psql):
    """GET /billing/worklist → registered(선수납 가능) 내원도 포함(status=registered·예상총액 0)."""
    eid = _setup_billable_encounter(psql, with_fees=False)  # registered·수가 0
    res = client.get("/v1/billing/worklist", headers=_bearer(reception_token))
    assert res.status_code == 200, res.text
    row = next((r for r in res.json()["data"] if r["encounter_id"] == eid), None)
    assert row is not None, f"registered 내원 {eid} 워크리스트 미포함(7.8 선수납 진입점)"
    assert row["status"] == "registered"
    assert row["estimated_total_krw"] == 0


# ── Story 7.9: 취소·노쇼 정산(수가 미발생·선납 환급) ──────────────────────────


def _cancel_url(encounter_id: str) -> str:
    return f"/v1/encounters/{encounter_id}/payment/cancel"


def test_cancel_at_registered_voids_no_refund(client, reception_token, psql):
    """후수납 registered(선납 0) 취소 → 200·cancelled·refunded 0·내원 cancelled(수가 미발생)."""
    eid = _setup_billable_encounter(psql, with_fees=False)  # registered·수가 0
    res = client.post(
        _cancel_url(eid), headers=_bearer(reception_token), json={"reason": "미내원"}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "cancelled"
    assert body["refunded_amount_krw"] == 0
    assert body["cancelled_at"] is not None
    assert body["cancel_reason"] == "미내원"
    assert _encounter_status(psql, eid) == "cancelled"


def test_cancel_after_prepay_refunds_full(client, reception_token, psql):
    """registered 선납 5000 → 취소 → cancelled·refunded=5000(전액)·paid 보존·내원 cancelled."""
    eid = _setup_billable_encounter(psql, with_fees=False)
    prepay = client.post(
        _prepay_url(eid),
        headers=_bearer(reception_token),
        json={"amount_krw": 5000, "payment_method": "card"},
    )
    assert prepay.status_code == 200, prepay.text
    res = client.post(_cancel_url(eid), headers=_bearer(reception_token), json={})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "cancelled"
    assert body["paid_amount_krw"] == 5000  # 총 수령 보존
    assert body["refunded_amount_krw"] == 5000  # 선납 전액 환급
    assert body["payment_method"] == "card"  # 환급수단=원 선결제수단
    assert _encounter_status(psql, eid) == "cancelled"


def test_cancel_removes_from_worklist(client, reception_token, psql):
    """registered 선납 내원 취소 후 → 워크리스트에서 사라짐(cancelled 제외)."""
    eid = _setup_billable_encounter(psql, with_fees=False)
    client.post(
        _prepay_url(eid),
        headers=_bearer(reception_token),
        json={"amount_krw": 3000, "payment_method": "cash"},
    )
    before = client.get("/v1/billing/worklist", headers=_bearer(reception_token))
    assert any(r["encounter_id"] == eid for r in before.json()["data"]), "취소 전 워크리스트 포함"
    client.post(_cancel_url(eid), headers=_bearer(reception_token), json={})
    after = client.get("/v1/billing/worklist", headers=_bearer(reception_token))
    assert not any(r["encounter_id"] == eid for r in after.json()["data"]), (
        "취소 후 워크리스트에서 제외(cancelled)"
    )


def test_cancel_in_progress_409(client, reception_token, doctor_id, psql):
    """진찰 중(in_progress) 취소 → 409(cancel_encounter 비-registered 차단·부분수행=7.10)."""
    eid = _setup_finalizable_encounter(psql, doctor_id)  # in_progress
    res = client.post(_cancel_url(eid), headers=_bearer(reception_token), json={})
    assert res.status_code == 409, res.text


def test_cancel_forbidden_doctor(client, doctor_token, psql):
    """doctor(payment.manage 미보유) 취소 → 403(쓰기 권한 분리)."""
    eid = _setup_billable_encounter(psql, with_fees=False)
    res = client.post(_cancel_url(eid), headers=_bearer(doctor_token), json={})
    assert res.status_code == 403, res.text


def test_cancel_forbidden_nurse(client, nurse_token, psql):
    """nurse(payment.manage·encounter.cancel 미보유) 취소 → 403."""
    eid = _setup_billable_encounter(psql, with_fees=False)
    res = client.post(_cancel_url(eid), headers=_bearer(nurse_token), json={})
    assert res.status_code == 403, res.text


def test_cancel_nonexistent_404(client, reception_token):
    """미존재 내원 취소 → 404."""
    res = client.post(_cancel_url(str(uuid.uuid4())), headers=_bearer(reception_token), json={})
    assert res.status_code == 404, res.text


# ── Story 7.10: 부분 수행 정산 — pending_orders_count + 수행분만 정산 ──────────────

_FEE_IMG_CODE = "ha201"  # 검사(흉부촬영) — 수행 시 fee_item
_FEE_TRT_CODE = "m0030"  # 처치(드레싱) — 미수행 시 fee_item 없음


def _setup_partial_encounter(psql: Psql, doctor_id: str, admin_id: str) -> str:
    """부분수행 in_progress 내원 — 진찰료 + 수행 검사 1 + 미수행 검사 1 + 미수행 처치 1.

    주상병 부착(finalize). pending_orders_count == 2. 검사 수행=admin. eid 반환."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    xperf, xpend, tpend = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    doc = '{"sub":"' + doctor_id + '","role":"authenticated"}'
    adm = '{"sub":"' + admin_id + '","role":"authenticated"}'
    img = f"(select id from public.fee_schedules where lower(code)='{_FEE_IMG_CODE}' limit 1)"
    trt = f"(select id from public.fee_schedules where lower(code)='{_FEE_TRT_CODE}' limit 1)"
    sql = (
        "begin;"
        + _patient_sql(pid)
        + "insert into public.encounters(id, patient_id, department_id, visit_type, status) "
        f"values ('{eid}','{pid}',{_DEPT},'walk_in','registered');"
        f"select set_config('request.jwt.claims', '{doc}', true);"
        f"select set_config('app.actor_id', '{doctor_id}', true);"
        f"select public.start_consult('{eid}');"
        "insert into public.encounter_diagnoses"
        "(encounter_id, diagnosis_id, is_primary, recorded_by, is_active) "
        f"values ('{eid}',(select id from public.diagnoses limit 1),true,'{doctor_id}',true);"
        # 오더 3건 생성(in_progress·게이트 통과). 수행 1·미수행 2.
        "insert into public.examinations"
        "(id, encounter_id, exam_type, fee_schedule_id, status, ordered_by) "
        f"values ('{xperf}','{eid}','imaging',{img},'ordered','{doctor_id}');"
        "insert into public.examinations"
        "(id, encounter_id, exam_type, fee_schedule_id, status, ordered_by) "
        f"values ('{xpend}','{eid}','imaging',{img},'ordered','{doctor_id}');"
        "insert into public.treatment_orders"
        "(id, encounter_id, fee_schedule_id, status, ordered_by) "
        f"values ('{tpend}','{eid}',{trt},'ordered','{doctor_id}');"
        # 검사 1건만 수행(admin) → fee_item 적재. 나머지 2건 ordered 잔존(미수행).
        f"select set_config('request.jwt.claims', '{adm}', true);"
        f"select set_config('app.actor_id', '{admin_id}', true);"
        f"select public.perform_examination('{xperf}');"
        "commit;"
    )
    proc = psql.run(sql)
    assert proc.returncode == 0, proc.stderr
    return eid


def test_partial_performance_pending_count(client, reception_token, doctor_id, admin_id, psql):
    """부분수행 내원 build → pending_orders_count == 2(미수행 검사 1 + 처치 1)."""
    eid = _setup_partial_encounter(psql, doctor_id, admin_id)
    res = client.post(_payment_url(eid), headers=_bearer(reception_token))
    assert res.status_code == 200, res.text
    assert res.json()["pending_orders_count"] == 2


def test_partial_performance_settles_performed_only(
    client, reception_token, doctor_id, admin_id, psql
):
    """부분수행 finalize → 수행분만 청구·미수행 제외·내원 completed·미수행 오더 잔존(7.10)."""
    eid = _setup_partial_encounter(psql, doctor_id, admin_id)
    res = client.post(
        _finalize_url(eid), headers=_bearer(reception_token), json={"payment_method": "card"}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "finalized"
    # 수행 검사(HA201) 1건만 청구·미수행 검사(동일 HA201) 제외·미수행 처치(M0030) 제외.
    codes = [(d["code"] or "").upper() for d in body["details"]]
    assert codes.count(_FEE_IMG_CODE.upper()) == 1, codes  # 수행 1건만(미수행 검사 fee_item 0)
    assert codes.count(_FEE_TRT_CODE.upper()) == 0, codes  # 미수행 처치 제외
    assert body["total_amount_krw"] == sum(d["amount_krw"] for d in body["details"])
    assert _encounter_status(psql, eid) == "completed"
    # 미수행 오더는 그대로 ordered 잔존(자동 cancel 안 함·설계 결정 ②).
    assert (
        psql.scalar(
            "select count(*) from public.examinations "
            f"where encounter_id='{eid}' and status='ordered'"
        )
        == "1"
    )
    assert (
        psql.scalar(
            "select count(*) from public.treatment_orders "
            f"where encounter_id='{eid}' and status='ordered'"
        )
        == "1"
    )


def test_pending_orders_count_zero_when_no_pending(client, reception_token, doctor_id, psql):
    """미수행 오더 없는 내원 build → pending_orders_count == 0(부분수행 배지 미표시 경로)."""
    eid = _setup_finalizable_encounter(psql, doctor_id)  # 진찰료만·오더 없음
    res = client.post(_payment_url(eid), headers=_bearer(reception_token))
    assert res.status_code == 200, res.text
    assert res.json()["pending_orders_count"] == 0
