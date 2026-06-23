"""수납 finalize 함수(Story 7.4) DB 레벨 통합 테스트 — psql 직접(0048_payment_finalize).

finalize_payment(encounter_id, payment_method) = draft 수납 건을 finalized 로 전이(결제 컬럼 기록 +
영수증번호 부여) + complete_encounter(내원 in_progress→completed) 호출. 정산 로직·상태머신은 DB 가
소유(project-context). 실 Supabase 로컬 db 에 psql 로 단언.

검증(AC 매핑):
  · AC1: payment_no_seq 시퀀스·payment_no 포맷 R-YYYYMMDD-NNNNNN·유일·단조증가
  · AC2: draft→finalized 전이·결제 컬럼(method/finalized_at/by/paid=copay)·내원 completed·
         주상병 미지정 PT422(롤백)·비-draft PT409(이중결제)·정산대상 0 PT409·EXECUTE 회수
  · AC3: payments_finalized_consistency CHECK(finalized 면 payment_no/finalized_at/by/method 필수)
  · AC4: reception encounter.complete grant — reception actor 로 finalize 성공(완료 전이)

위생: 환자=dummy bytea·진찰료=start_consult 자동(AA154 초진 17610)·주상병=diagnoses 직접 부착.
전부 begin/rollback 격리(커밋 없음). uuid=Python. 완료 게이트(주상병·in_progress) 통과 셋업 포함.
"""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import Psql

_DEPT = "(select id from public.departments where lower(code) = 'im' limit 1)"
_ANY_DX = "(select id from public.diagnoses limit 1)"


# ── 헬퍼 ──────────────────────────────────────────────────────────────────────


def _verdict(out: str) -> str:
    lines = [ln.strip() for ln in out.splitlines() if ln.strip().startswith("V:")]
    assert lines, f"verdict 줄 없음: {out!r}"
    return lines[-1][2:]


@pytest.fixture(scope="module")
def doctor_id(psql: Psql) -> str:
    """doctor auth uid — start_consult(in_progress 전이)·encounter.complete(4.7) 호출자."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'doctor' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def reception_id(psql: Psql) -> str:
    """reception auth uid — 7.4 finalize 호출자(encounter.complete grant 보유)."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'reception' limit 1"
    ).lower()


def _patient_sql(pid: str, *, insurance: str = "health_insurance") -> str:
    return (
        "insert into public.patients(id, name, birth_date, sex, resident_no_enc, "
        "resident_no_hash, resident_no_masked, insurance_type) values "
        f"('{pid}','수납TEST','1990-01-01','male','\\x00'::bytea,"
        f"'__enc_{pid}__','900101-1******','{insurance}');"
    )


def _claims(uid: str) -> str:
    """request.jwt.claims + app.actor_id GUC 세팅(has_permission·감사 actor·finalized_by)."""
    return (
        "select set_config('request.jwt.claims', "
        f'\'{{"sub":"{uid}","role":"authenticated"}}\', true);'
        f"select set_config('app.actor_id', '{uid}', true);"
    )


def _setup_in_progress(
    pid: str, eid: str, doctor_id: str, *, insurance: str = "health_insurance", primary: bool = True
) -> str:
    """registered → start_consult = in_progress + 진찰료 AA154(초진 17610). primary=주상병 부착."""
    sql = _patient_sql(pid, insurance=insurance) + (
        "insert into public.encounters(id, patient_id, department_id, visit_type, status) "
        f"values ('{eid}','{pid}',{_DEPT},'walk_in','registered');"
    )
    sql += _claims(doctor_id)
    sql += f"select public.start_consult('{eid}');"
    if primary:
        sql += (
            "insert into public.encounter_diagnoses"
            "(encounter_id, diagnosis_id, is_primary, recorded_by, is_active) "
            f"values ('{eid}',{_ANY_DX},true,'{doctor_id}',true);"
        )
    # finalize 는 헤더 선행 필요(build→price→finalize 오케스트레이션·DB 테스트 동형).
    sql += f"select public.build_payment('{eid}');select public.price_payment('{eid}');"
    return sql


# ── AC1: payment_no 시퀀스·포맷 ───────────────────────────────────────────────


def test_payment_no_seq_exists(psql: Psql):
    out = psql.scalar(
        "select 'V:'||(exists(select 1 from pg_class where relkind='S' "
        "and relname='payment_no_seq'))::text;"
    )
    assert _verdict(out) == "true", out


def test_finalize_payment_function_exists(psql: Psql):
    out = psql.scalar(
        "select 'V:'||(exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
        "where n.nspname='public' and p.proname='finalize_payment'))::text;"
    )
    assert _verdict(out) == "true", out


def test_finalize_payment_no_format(psql: Psql, doctor_id: str, reception_id: str):
    """영수증번호 = R-YYYYMMDD-NNNNNN(전역 시퀀스 + KST 날짜·6자리 패딩)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _setup_in_progress(pid, eid, doctor_id)
        + _claims(reception_id)
        + f"select public.finalize_payment('{eid}','card');"
        + "select 'V:'||(select payment_no ~ '^R-[0-9]{8}-[0-9]{6}$' "
        f"  from public.payments where encounter_id='{eid}')::text;"
        "rollback;"
    )
    assert _verdict(out) == "true", out


def test_finalize_payment_no_unique_and_monotonic(psql: Psql, doctor_id: str, reception_id: str):
    """두 내원 finalize → payment_no 상이 + 시퀀스 단조증가(NNNNNN 후행 증가)."""
    p1, e1 = str(uuid.uuid4()), str(uuid.uuid4())
    p2, e2 = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _setup_in_progress(p1, e1, doctor_id)
        + _claims(reception_id)
        + f"select public.finalize_payment('{e1}','card');"
        + _setup_in_progress(p2, e2, doctor_id)
        + _claims(reception_id)
        + f"select public.finalize_payment('{e2}','cash');"
        + "select 'V:'||(("
        f"  (select right(payment_no,6)::int from public.payments where encounter_id='{e2}') > "
        f"  (select right(payment_no,6)::int from public.payments where encounter_id='{e1}'))"
        "  and ("
        f"  (select payment_no from public.payments where encounter_id='{e1}') <> "
        f"  (select payment_no from public.payments where encounter_id='{e2}')))::text;"
        "rollback;"
    )
    assert _verdict(out) == "true", out


# ── AC2: finalize 전이·결제 컬럼·내원 완료 ────────────────────────────────────


def test_finalize_transitions_and_records(psql: Psql, doctor_id: str, reception_id: str):
    """finalize → finalized·method·completed·paid=copay(초진 17610×0.3=5280)·finalized_by."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _setup_in_progress(pid, eid, doctor_id)
        + _claims(reception_id)
        + f"select public.finalize_payment('{eid}','card');"
        + "select 'V:status='||(select status from public.payments where encounter_id='"
        + eid
        + "')"
        "||'|method='||(select payment_method from public.payments where encounter_id='"
        + eid
        + "')"
        "||'|enc='||(select status from public.encounters where id='" + eid + "')"
        "||'|paid='||(select paid_amount_krw from public.payments where encounter_id='"
        + eid
        + "')::text"
        "||'|finby='||(select (finalized_by='" + reception_id + "')::text "
        "  from public.payments where encounter_id='" + eid + "')"
        "||'|fat='||(select (finalized_at is not null)::text "
        "  from public.payments where encounter_id='" + eid + "');"
        "rollback;"
    )
    assert (
        _verdict(out) == "status=finalized|method=card|enc=completed|paid=5280|finby=true|fat=true"
    ), out


def test_finalize_freezes_pricing_status(psql: Psql, doctor_id: str, reception_id: str):
    """finalize 후 재build/price 호출해도 status≠draft → 동결(copay 불변·status finalized 유지)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _setup_in_progress(pid, eid, doctor_id)
        + _claims(reception_id)
        + f"select public.finalize_payment('{eid}','card');"
        + f"select public.build_payment('{eid}');"  # no-op(status≠draft)
        + f"select public.price_payment('{eid}');"  # no-op(status≠draft)
        + "select 'V:status='||(select status from public.payments where encounter_id='"
        + eid
        + "')"
        "||'|copay='||(select copay_amount_krw from public.payments where encounter_id='"
        + eid
        + "')::text;"
        "rollback;"
    )
    assert _verdict(out) == "status=finalized|copay=5280", out


def test_finalize_missing_primary_diagnosis_pt422(psql: Psql, doctor_id: str, reception_id: str):
    """주상병 미부착 내원 finalize → complete_encounter PT422 → 전체 롤백(결제 무효)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    err = psql.expect_error(
        "begin;"
        + _setup_in_progress(pid, eid, doctor_id, primary=False)
        + _claims(reception_id)
        + f"select public.finalize_payment('{eid}','card');"
        "rollback;"
    )
    assert "primary diagnosis required" in err.lower() or "pt422" in err.lower(), err


def test_finalize_non_draft_rejected_pt409(psql: Psql, doctor_id: str, reception_id: str):
    """이미 finalized 수납 재finalize → PT409(이중결제·비가역 차단)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    err = psql.expect_error(
        "begin;"
        + _setup_in_progress(pid, eid, doctor_id)
        + _claims(reception_id)
        + f"select public.finalize_payment('{eid}','card');"
        + f"select public.finalize_payment('{eid}','cash');"  # 2차 — status=finalized → PT409
        "rollback;"
    )
    assert "invalid payment transition" in err.lower() or "pt409" in err.lower(), err


def test_finalize_no_billable_items_pt409(psql: Psql, reception_id: str):
    """정산 대상 0(total=0) draft 수납 finalize → PT409(빈 내원 차단·total 가드 선행)."""
    pid, eid, payid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    err = psql.expect_error(
        "begin;"
        + _patient_sql(pid)
        + "insert into public.encounters(id, patient_id, department_id, visit_type, status) "
        f"values ('{eid}','{pid}',{_DEPT},'walk_in','registered');"
        + "insert into public.payments(id, encounter_id, status, total_amount_krw) "
        f"values ('{payid}','{eid}','draft',0);"
        + _claims(reception_id)
        + f"select public.finalize_payment('{eid}','card');"
        "rollback;"
    )
    assert "no billable items" in err.lower() or "pt409" in err.lower(), err


def test_finalize_execute_revoked_from_authenticated(psql: Psql):
    """finalize_payment EXECUTE 는 authenticated 직접 호출 차단(위조 방어 — service_role 만)."""
    err = psql.expect_error(
        "begin;set local role authenticated;"
        f"select public.finalize_payment('{uuid.uuid4()}','card');rollback;"
    )
    assert "permission denied" in err.lower() and "finalize_payment" in err.lower(), err


# ── AC3: finalized 컬럼 일관성 CHECK ──────────────────────────────────────────


def test_payments_finalized_consistency_check(psql: Psql):
    """finalized 인데 payment_no/finalized_* NULL INSERT → CHECK 위반(부분 finalize 차단)."""
    pid, eid, payid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    err = psql.expect_error(
        "begin;"
        + _patient_sql(pid)
        + "insert into public.encounters(id, patient_id, department_id, visit_type, status) "
        f"values ('{eid}','{pid}',{_DEPT},'walk_in','registered');"
        + "insert into public.payments(id, encounter_id, status, total_amount_krw) "
        f"values ('{payid}','{eid}','finalized',1000);"  # payment_no 등 NULL → CHECK 위반
        "rollback;"
    )
    assert "payments_finalized_consistency" in err.lower() or "check" in err.lower(), err


# ── AC4: reception encounter.complete grant ───────────────────────────────────


def test_finalize_by_reception_completes_encounter(psql: Psql, doctor_id: str, reception_id: str):
    """reception finalize → complete_encounter 성공(encounter.complete grant·내원 completed)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _setup_in_progress(pid, eid, doctor_id)
        + _claims(reception_id)  # reception 이 finalize → 내부 complete_encounter 권한 통과해야 함
        + f"select public.finalize_payment('{eid}','transfer');"
        + "select 'V:'||(select status from public.encounters where id='"
        + eid
        + "');"
        "rollback;"
    )
    assert _verdict(out) == "completed", out
