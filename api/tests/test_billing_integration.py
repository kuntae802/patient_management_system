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
