"""수납 스키마(Story 7.1) DB 레벨 통합 테스트 — psql 직접(0045_payments).

순수 DB 토대 스토리: FastAPI 미경유. payments(헤더)·payment_details(라인) 스키마·RLS·감사·권한을
실 Supabase 로컬 db 컨테이너에 psql 로 붙어 단언한다. test_billing_db 하니스 미러.

검증(AC 매핑):
  · AC1: payments 테이블 — encounter_id UNIQUE(내원 1:1)·status/billing_type CHECK·금액 음수 거부
  · AC2: payment_details — payment_id CASCADE·unique(payment_id,fee_item_id)·amount=qty*unit CHECK
  · AC6: payment.read(admin) + RLS(직원=전체 / nurse 미보유=0 / 환자=본인 / anon=거부)
  · AC7: payments/payment_details INSERT → audit_logs(actor·create) 기록(마스킹 무변경=평문 status)

집계(fee_items→payment_details)=7.2·본인부담 산정=7.3·finalize=7.4 — 본 스토리 미구현(스키마만).
위생: 환자=dummy bytea·수가=시드 마스터. 전부 begin/rollback 격리(커밋 없음). uuid=Python 부여.
"""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import Psql

_DEPT = "(select id from public.departments where lower(code) = 'im' limit 1)"
_FEE_CONSULT = "(select id from public.fee_schedules where lower(code)='aa254' limit 1)"


# ── 픽스처: 시드 직원 uid ──────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def admin_id(psql: Psql) -> str:
    """admin uid — 0045 부트 grant(payment.read) + 0002 전권."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'admin' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def doctor_id(psql: Psql) -> str:
    """doctor uid — seed(7.1) payment.read 보유. RLS 직원 가시 기준."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'doctor' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def reception_id(psql: Psql) -> str:
    """reception uid — seed(7.1) payment.read 보유(수납 정산). RLS 직원 가시 기준."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'reception' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def nurse_id(psql: Psql) -> str:
    """nurse uid — payment.read 미보유 → RLS 직원 정책 false(403 baseline) + self 임퍼소네이터."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'nurse' limit 1"
    ).lower()


# ── SQL 조각 헬퍼(test_billing_db 미러) ───────────────────────────────────────


def _patient_sql(pid: str, *, auth_uid: str | None = None) -> str:
    auth = f"'{auth_uid}'" if auth_uid else "null"
    return (
        "insert into public.patients(id, name, birth_date, sex, resident_no_enc, "
        "resident_no_hash, resident_no_masked, insurance_type, auth_uid) values "
        f"('{pid}','수납TEST','1990-01-01','male','\\x00'::bytea,"
        f"'__enc_{pid}__','900101-1******','health_insurance',{auth});"
    )


def _encounter_sql(eid: str, pid: str, *, status: str = "registered") -> str:
    return (
        "insert into public.encounters(id, patient_id, department_id, visit_type, status) "
        f"values ('{eid}','{pid}',{_DEPT},'walk_in','{status}');"
    )


def _fee_item_sql(fiid: str, eid: str) -> str:
    """수가항목 1행 직접 INSERT(postgres 컨텍스트) — payment_detail.fee_item_id 참조용."""
    return (
        "insert into public.fee_items(id, encounter_id, fee_schedule_id, source_type, source_id, "
        " unit_amount_krw, amount_krw, coverage_type) "
        f"values ('{fiid}','{eid}',{_FEE_CONSULT},'encounter','{eid}',100,100,'covered');"
    )


def _payment_sql(payid: str, eid: str, *, status: str = "draft") -> str:
    """수납 헤더 1행 직접 INSERT(금액 컬럼 default 0)."""
    return (
        "insert into public.payments(id, encounter_id, status) "
        f"values ('{payid}','{eid}','{status}');"
    )


def _payment_detail_sql(
    pdid: str,
    payid: str,
    *,
    fee_item_id: str | None = None,
    qty: int = 1,
    unit: int = 100,
    amount: int = 100,
    coverage: str = "covered",
) -> str:
    fi = f"'{fee_item_id}'" if fee_item_id else "null"
    return (
        "insert into public.payment_details"
        "(id, payment_id, fee_item_id, quantity, unit_amount_krw, amount_krw, coverage_type) "
        f"values ('{pdid}','{payid}',{fi},{qty},{unit},{amount},'{coverage}');"
    )


def _as_authenticated(uid: str) -> str:
    claims = '{"sub":"' + uid + '","role":"authenticated"}'
    return (
        "set local role authenticated;"
        "select set_config('request.jwt.claims', '" + claims + "', true);"
    )


def _actor(uid: str) -> str:
    """감사 actor GUC 주입(audit_trigger_fn 이 app.actor_id 읽음)."""
    return "select set_config('app.actor_id', '" + uid + "', true);"


def _assert_sqlstate(psql: Psql, *, setup: str, op: str, sqlstate: str) -> None:
    script = (
        "begin;" + setup + "do $$ begin "
        "  begin "
        "    " + op + " "
        "    raise exception 'NO_ERROR_RAISED'; "
        "  exception when others then "
        "    if sqlstate <> '"
        + sqlstate
        + "' then raise exception 'WRONG_SQLSTATE:%', sqlstate; end if; "
        "  end; "
        "end $$;"
        "rollback;"
    )
    proc = psql.run(script)
    assert proc.returncode == 0, f"기대 SQLSTATE {sqlstate} 미확인: {proc.stderr.strip()}"


def _verdict(out: str) -> str:
    lines = [ln.strip() for ln in out.splitlines() if ln.strip().startswith("V:")]
    assert lines, f"verdict 줄 없음: {out!r}"
    return lines[-1][2:]


# ── AC1: payments 테이블·불변식 ───────────────────────────────────────────────


def test_payment_tables_exist(psql: Psql):
    """payments·payment_details 테이블 + payment_details amount 정합 CHECK 존재."""
    out = psql.scalar(
        "select 'V:pay='||(to_regclass('public.payments') is not null)::text"
        "||'|det='||(to_regclass('public.payment_details') is not null)::text"
        "||'|amt_chk='||(exists(select 1 from pg_constraint "
        "  where conrelid='public.payment_details'::regclass "
        "  and conname='payment_details_amount_calc'))::text;"
    )
    assert _verdict(out) == "pay=true|det=true|amt_chk=true", out


def test_payment_encounter_unique(psql: Psql):
    """같은 내원 2번째 payment INSERT → encounter_id UNIQUE 위반(23505·내원 1:1)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    payid2 = str(uuid.uuid4())
    setup = _patient_sql(pid) + _encounter_sql(eid, pid) + _payment_sql(str(uuid.uuid4()), eid)
    op = f"insert into public.payments(id, encounter_id) values ('{payid2}','{eid}');"
    _assert_sqlstate(psql, setup=setup, op=op, sqlstate="23505")


def test_payment_status_check(psql: Psql):
    """잘못된 status 직접 INSERT → CHECK 위반(23514)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    op = (
        "insert into public.payments(id, encounter_id, status) "
        f"values ('{uuid.uuid4()}','{eid}','bogus');"
    )
    _assert_sqlstate(
        psql, setup=_patient_sql(pid) + _encounter_sql(eid, pid), op=op, sqlstate="23514"
    )


def test_payment_negative_amount_check(psql: Psql):
    """음수 copay_amount_krw 직접 INSERT → CHECK 위반(23514)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    op = (
        "insert into public.payments(id, encounter_id, copay_amount_krw) "
        f"values ('{uuid.uuid4()}','{eid}',-1);"
    )
    _assert_sqlstate(
        psql, setup=_patient_sql(pid) + _encounter_sql(eid, pid), op=op, sqlstate="23514"
    )


# ── AC2: payment_details 테이블·불변식 ────────────────────────────────────────


def test_payment_detail_amount_calc_check(psql: Psql):
    """payment_details amount_krw <> quantity*unit_amount_krw → CHECK 위반(23514)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    payid = str(uuid.uuid4())
    setup = _patient_sql(pid) + _encounter_sql(eid, pid) + _payment_sql(payid, eid)
    # qty=2 * unit=100 = 200 ≠ amount 150
    op = _payment_detail_sql(str(uuid.uuid4()), payid, qty=2, unit=100, amount=150)
    _assert_sqlstate(psql, setup=setup, op=op, sqlstate="23514")


def test_payment_detail_amount_calc_ok(psql: Psql):
    """qty=2 * unit=100 = amount 200 정합 → INSERT 성공(1행)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    payid = str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _payment_sql(payid, eid)
        + _payment_detail_sql(str(uuid.uuid4()), payid, qty=2, unit=100, amount=200)
        + "select 'V:'||count(*)::text from public.payment_details where payment_id='"
        + payid
        + "';"
        "rollback;"
    )
    assert _verdict(out) == "1", out


def test_payment_detail_cascade_delete(psql: Psql):
    """payment 삭제 → payment_details ON DELETE CASCADE 동반 삭제(draft 정리)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    payid = str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _payment_sql(payid, eid)
        + _payment_detail_sql(str(uuid.uuid4()), payid)
        + f"delete from public.payments where id='{payid}';"
        + "select 'V:'||count(*)::text from public.payment_details where payment_id='"
        + payid
        + "';"
        "rollback;"
    )
    assert _verdict(out) == "0", out


def test_payment_detail_unique_fee_item(psql: Psql):
    """같은 (payment_id, fee_item_id) 2회 INSERT → unique 위반(23505·집계 멱등)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    payid, fiid = str(uuid.uuid4()), str(uuid.uuid4())
    setup = (
        _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _fee_item_sql(fiid, eid)
        + _payment_sql(payid, eid)
        + _payment_detail_sql(str(uuid.uuid4()), payid, fee_item_id=fiid)
    )
    op = _payment_detail_sql(str(uuid.uuid4()), payid, fee_item_id=fiid)
    _assert_sqlstate(psql, setup=setup, op=op, sqlstate="23505")


def test_payment_detail_null_fee_item_allowed_multiple(psql: Psql):
    """fee_item_id NULL(수기 라인)은 한 수납에 여러 행 허용(NULL distinct)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    payid = str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _payment_sql(payid, eid)
        + _payment_detail_sql(str(uuid.uuid4()), payid)  # fee_item_id NULL
        + _payment_detail_sql(str(uuid.uuid4()), payid)  # fee_item_id NULL
        + "select 'V:'||count(*)::text from public.payment_details where payment_id='"
        + payid
        + "';"
        "rollback;"
    )
    assert _verdict(out) == "2", out


def test_payment_detail_copay_rate_range_check(psql: Psql):
    """copay_rate 범위 밖(>1) 직접 INSERT → CHECK 위반(23514·코드리뷰 patch P1)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    payid = str(uuid.uuid4())
    setup = _patient_sql(pid) + _encounter_sql(eid, pid) + _payment_sql(payid, eid)
    op = (
        "insert into public.payment_details"
        "(id, payment_id, quantity, unit_amount_krw, amount_krw, coverage_type, copay_rate) "
        f"values ('{uuid.uuid4()}','{payid}',1,100,100,'covered',1.5);"  # 1.5 > 1
    )
    _assert_sqlstate(psql, setup=setup, op=op, sqlstate="23514")


# ── AC6: 권한 + RLS ───────────────────────────────────────────────────────────


def test_payment_read_permission_catalogued_and_admin_has_it(psql: Psql, admin_id: str):
    """payment.read 권한 카탈로그 존재 + admin 부트 grant 보유(회귀 가드)."""
    out = psql.scalar(
        "select 'V:cat='||(exists(select 1 from public.permissions "
        "where code='payment.read'))::text"
        "||'|admin='||(exists(select 1 from public.role_permissions rp "
        "  join public.roles r on r.id=rp.role_id "
        "  join public.permissions p on p.id=rp.permission_id "
        "  where r.code='admin' and p.code='payment.read'))::text;"
    )
    assert _verdict(out) == "cat=true|admin=true", out


@pytest.mark.parametrize("role", ["doctor", "reception"])
def test_rls_staff_with_payment_read_sees_payments(
    psql: Psql, doctor_id: str, reception_id: str, role: str
):
    """직원(payment.read=doctor/reception)은 RLS 직원 정책으로 삽입된 payment 행을 받는다."""
    uid = doctor_id if role == "doctor" else reception_id
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _payment_sql(str(uuid.uuid4()), eid)
        + _as_authenticated(uid)
        # 전역 카운트 아닌 *이* 내원 가시성으로 격리(직원=auth_uid 불일치 → staff 정책)
        + "select 'V:'||(count(*) filter (where encounter_id='"
        + eid
        + "') = 1)::text "
        "from public.payments;"
        "rollback;"
    )
    assert _verdict(out) == "true", out


def test_rls_nurse_without_payment_read_blocked(psql: Psql, nurse_id: str):
    """nurse(payment.read 미보유)는 직원 정책 false → 타인 내원 payments 비가시(403 baseline)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)  # auth_uid NULL(nurse 본인 아님)
        + _encounter_sql(eid, pid)
        + _payment_sql(str(uuid.uuid4()), eid)
        + _as_authenticated(nurse_id)
        + "select 'V:'||count(*)::text from public.payments;"
        "rollback;"
    )
    assert _verdict(out) == "0", out


def test_rls_patient_sees_only_own_payment(psql: Psql, nurse_id: str):
    """환자 본인 내원 payments 만 가시 — nurse(payment.read 미보유)를 auth_uid 가장."""
    own_p, own_e = str(uuid.uuid4()), str(uuid.uuid4())
    oth_p, oth_e = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(own_p, auth_uid=nurse_id)
        + _encounter_sql(own_e, own_p)
        + _payment_sql(str(uuid.uuid4()), own_e)
        + _patient_sql(oth_p)  # auth_uid NULL(타인)
        + _encounter_sql(oth_e, oth_p)
        + _payment_sql(str(uuid.uuid4()), oth_e)
        + _as_authenticated(nurse_id)
        + "select 'V:'||coalesce(bool_and(encounter_id='"
        + own_e
        + "'),false)::text"
        "||'|'||(count(*)=1)::text from public.payments;"
        "rollback;"
    )
    assert _verdict(out) == "true|true", out


def test_rls_patient_sees_only_own_payment_detail(psql: Psql, nurse_id: str):
    """환자 본인 수납의 payment_details 만 가시(payment→encounter→patient→auth_uid)."""
    own_p, own_e, own_pay = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    oth_p, oth_e, oth_pay = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(own_p, auth_uid=nurse_id)
        + _encounter_sql(own_e, own_p)
        + _payment_sql(own_pay, own_e)
        + _payment_detail_sql(str(uuid.uuid4()), own_pay)
        + _patient_sql(oth_p)
        + _encounter_sql(oth_e, oth_p)
        + _payment_sql(oth_pay, oth_e)
        + _payment_detail_sql(str(uuid.uuid4()), oth_pay)
        + _as_authenticated(nurse_id)
        + "select 'V:'||coalesce(bool_and(payment_id='"
        + own_pay
        + "'),false)::text"
        "||'|'||(count(*)=1)::text from public.payment_details;"
        "rollback;"
    )
    assert _verdict(out) == "true|true", out


def test_rls_anon_cannot_select_payments(psql: Psql):
    """anon 은 payments SELECT 거부(revoke all + 읽기 정책 미부여)."""
    err = psql.expect_error(
        "begin;set local role anon;select count(*) from public.payments;rollback;"
    )
    assert "permission denied" in err.lower() and "payments" in err.lower(), err


def test_rls_anon_cannot_select_payment_details(psql: Psql):
    """anon 은 payment_details SELECT 거부."""
    err = psql.expect_error(
        "begin;set local role anon;select count(*) from public.payment_details;rollback;"
    )
    assert "permission denied" in err.lower() and "payment_details" in err.lower(), err


# ── AC7: 감사 ─────────────────────────────────────────────────────────────────


def test_payment_insert_audited_with_actor(psql: Psql, admin_id: str):
    """payments INSERT 가 actor 와 함께 audit_logs 에 create 기록(평문 status=마스킹 무변경)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    payid = str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _actor(admin_id)
        + _payment_sql(payid, eid)
        + "select 'V:cnt='||count(*)::text"
        "||'|actor='||coalesce(bool_and(actor_id::text='" + admin_id + "'),false)::text"
        "||'|act='||coalesce(max(action),'-')"
        "||'|status='||coalesce(bool_and(after_data->>'status'='draft'),false)::text "
        "  from public.audit_logs where target_table='payments' and target_id='" + payid + "';"
        "rollback;"
    )
    assert _verdict(out) == "cnt=1|actor=true|act=create|status=true", out


def test_payment_detail_insert_audited(psql: Psql, admin_id: str):
    """payment_details INSERT 가 audit_logs 에 create 기록(append-only)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    payid, pdid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _payment_sql(payid, eid)
        + _actor(admin_id)
        + _payment_detail_sql(pdid, payid)
        + "select 'V:cnt='||count(*)::text||'|act='||coalesce(max(action),'-') "
        "  from public.audit_logs where target_table='payment_details' and target_id='"
        + pdid
        + "';"
        "rollback;"
    )
    assert _verdict(out) == "cnt=1|act=create", out
