"""선결제(prepay) + finalize 차액 정산(Story 7.8) DB 레벨 통합 테스트 — psql 직접(0051).

prepay_payment(encounter_id, amount, method) = draft 수납에 선결제 누적 + billing_type prepaid 전환
(status draft 유지·내원 상태 전이 없음). finalize_payment 재정의 = paid=greatest(copay, paid)(차액
수금·과납 보존·후수납 무회귀). 정산 로직은 DB 소유(project-context). 실 Supabase 로컬 db 에 단언.

검증(AC 매핑):
  · AC2: prepay 누적·billing_type→prepaid·status draft 유지·registered 에서 헤더 생성(수가 0)
  · AC3: 비-draft(finalized) prepay PT409·금액≤0 PT409·EXECUTE 회수(authenticated 차단)
  · AC4: finalize 차액 정산(선납<copay → paid=copay)·후수납 무회귀(선납 0 → paid=copay)
  · AC8: 과납(선납>copay → paid=선납 보존·차액 음수)

위생: 환자=dummy bytea·진찰료=start_consult 자동(AA154 초진 17610·copay 5280). 전부 begin/rollback
격리(커밋 없음). uuid=Python.
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
    """doctor auth uid — start_consult(in_progress 전이)·encounter.complete 호출자."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'doctor' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def reception_id(psql: Psql) -> str:
    """reception auth uid — finalize 호출자(encounter.complete grant 보유)·감사 actor."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'reception' limit 1"
    ).lower()


def _patient_sql(pid: str, *, insurance: str = "health_insurance") -> str:
    return (
        "insert into public.patients(id, name, birth_date, sex, resident_no_enc, "
        "resident_no_hash, resident_no_masked, insurance_type) values "
        f"('{pid}','선수납TEST','1990-01-01','male','\\x00'::bytea,"
        f"'__enc_{pid}__','900101-1******','{insurance}');"
    )


def _claims(uid: str) -> str:
    """request.jwt.claims + app.actor_id GUC 세팅(has_permission·감사 actor·finalized_by)."""
    return (
        "select set_config('request.jwt.claims', "
        f'\'{{"sub":"{uid}","role":"authenticated"}}\', true);'
        f"select set_config('app.actor_id', '{uid}', true);"
    )


def _setup_registered(pid: str, eid: str) -> str:
    """registered 내원(진찰 전·수가 0) — 선수납 진입점 셋업(헤더 미생성)."""
    return _patient_sql(pid) + (
        "insert into public.encounters(id, patient_id, department_id, visit_type, status) "
        f"values ('{eid}','{pid}',{_DEPT},'walk_in','registered');"
    )


def _setup_in_progress(pid: str, eid: str, doctor_id: str) -> str:
    """registered → start_consult = in_progress + 진찰료 AA154(copay 5280) + 주상병 부착."""
    sql = _setup_registered(pid, eid)
    sql += _claims(doctor_id)
    sql += f"select public.start_consult('{eid}');"
    sql += (
        "insert into public.encounter_diagnoses"
        "(encounter_id, diagnosis_id, is_primary, recorded_by, is_active) "
        f"values ('{eid}',{_ANY_DX},true,'{doctor_id}',true);"
    )
    sql += f"select public.build_payment('{eid}');select public.price_payment('{eid}');"
    return sql


# ── AC2: prepay 누적·billing_type 전환·status draft 유지 ───────────────────────


def test_prepay_payment_function_exists(psql: Psql):
    out = psql.scalar(
        "select 'V:'||(exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
        "where n.nspname='public' and p.proname='prepay_payment'))::text;"
    )
    assert _verdict(out) == "true", out


def test_prepay_at_registered_creates_header_and_accumulates(psql: Psql, reception_id: str):
    """registered(수가 0) 선결제 5000 → 헤더 생성·paid=5000·prepaid·draft·내원 registered 유지."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _setup_registered(pid, eid)
        + _claims(reception_id)
        + f"select public.prepay_payment('{eid}', 5000, 'card');"
        + "select 'V:paid='||(select paid_amount_krw from public.payments where encounter_id='"
        + eid
        + "')::text"
        "||'|btype='||(select billing_type from public.payments where encounter_id='" + eid + "')"
        "||'|pstatus='||(select status from public.payments where encounter_id='" + eid + "')"
        "||'|method='||(select payment_method from public.payments where encounter_id='"
        + eid
        + "')"
        "||'|enc='||(select status from public.encounters where id='" + eid + "');"
        "rollback;"
    )
    assert _verdict(out) == "paid=5000|btype=prepaid|pstatus=draft|method=card|enc=registered", out


def test_prepay_accumulates_multiple(psql: Psql, reception_id: str):
    """선결제 2회(3000 + 2000) → paid 누계 5000(단일 누계·별도 행 아님)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _setup_registered(pid, eid)
        + _claims(reception_id)
        + f"select public.prepay_payment('{eid}', 3000, 'card');"
        + f"select public.prepay_payment('{eid}', 2000, 'cash');"
        + "select 'V:'||(select paid_amount_krw from public.payments where encounter_id='"
        + eid
        + "')::text;"
        "rollback;"
    )
    assert _verdict(out) == "5000", out


# ── AC3: 상태·금액 가드 + EXECUTE 회수 ────────────────────────────────────────


def test_prepay_non_draft_rejected_pt409(psql: Psql, doctor_id: str, reception_id: str):
    """finalize 후(완료된 내원·finalized 수납) 선결제 → PT409(종결 내원 가드 + 비가역 수납 가드)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    err = psql.expect_error(
        "begin;"
        + _setup_in_progress(pid, eid, doctor_id)
        + _claims(reception_id)
        + f"select public.finalize_payment('{eid}','card');"  # 내원 completed + 수납 finalized
        + f"select public.prepay_payment('{eid}', 1000, 'cash');"  # 종결 내원 → PT409
        "rollback;"
    )
    assert (
        "invalid encounter state" in err.lower()
        or "invalid payment transition" in err.lower()
        or "pt409" in err.lower()
    ), err


def test_prepay_cancelled_encounter_pt409(psql: Psql, reception_id: str):
    """취소(cancelled) 내원 선결제 → PT409(종결 내원 funds 누적 차단·수납 헤더 미생성)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    err = psql.expect_error(
        "begin;"
        + _setup_registered(pid, eid)
        + f"update public.encounters set status = 'cancelled' where id = '{eid}';"
        + _claims(reception_id)
        + f"select public.prepay_payment('{eid}', 1000, 'card');"  # cancelled → PT409(가드 선행)
        "rollback;"
    )
    assert "invalid encounter state" in err.lower() or "pt409" in err.lower(), err


def test_prepay_zero_amount_pt409(psql: Psql, reception_id: str):
    """선결제 0원 → PT409(금액 양수 가드·DB 최종선)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    err = psql.expect_error(
        "begin;"
        + _setup_registered(pid, eid)
        + _claims(reception_id)
        + f"select public.prepay_payment('{eid}', 0, 'card');"
        "rollback;"
    )
    assert "positive" in err.lower() or "pt409" in err.lower(), err


def test_prepay_negative_amount_pt409(psql: Psql, reception_id: str):
    """선결제 음수 → PT409."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    err = psql.expect_error(
        "begin;"
        + _setup_registered(pid, eid)
        + _claims(reception_id)
        + f"select public.prepay_payment('{eid}', -100, 'card');"
        "rollback;"
    )
    assert "positive" in err.lower() or "pt409" in err.lower(), err


def test_prepay_execute_revoked_from_authenticated(psql: Psql):
    """prepay_payment EXECUTE 는 authenticated 직접 호출 차단(위조 방어 — service_role 만)."""
    err = psql.expect_error(
        "begin;set local role authenticated;"
        f"select public.prepay_payment('{uuid.uuid4()}', 1000, 'card');rollback;"
    )
    assert "permission denied" in err.lower() and "prepay_payment" in err.lower(), err


# ── AC4: finalize 차액 정산 + 후수납 무회귀 ───────────────────────────────────


def test_finalize_settles_difference_after_prepay(psql: Psql, doctor_id: str, reception_id: str):
    """선결제 3000(copay 5280) → finalize → paid=greatest(5280,3000)=5280(차액 2280 수금·완납)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _setup_in_progress(pid, eid, doctor_id)
        + _claims(reception_id)
        + f"select public.prepay_payment('{eid}', 3000, 'card');"
        + f"select public.finalize_payment('{eid}','card');"
        + "select 'V:paid='||(select paid_amount_krw from public.payments where encounter_id='"
        + eid
        + "')::text"
        "||'|copay='||(select copay_amount_krw from public.payments where encounter_id='"
        + eid
        + "')::text"
        "||'|status='||(select status from public.payments where encounter_id='" + eid + "')"
        "||'|btype='||(select billing_type from public.payments where encounter_id='" + eid + "');"
        "rollback;"
    )
    assert _verdict(out) == "paid=5280|copay=5280|status=finalized|btype=prepaid", out


def test_finalize_postpaid_no_regression(psql: Psql, doctor_id: str, reception_id: str):
    """선결제 없이 finalize → paid=greatest(5280,0)=5280·billing_type postpaid 유지(7.4 무회귀)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _setup_in_progress(pid, eid, doctor_id)
        + _claims(reception_id)
        + f"select public.finalize_payment('{eid}','card');"
        + "select 'V:paid='||(select paid_amount_krw from public.payments where encounter_id='"
        + eid
        + "')::text"
        "||'|btype='||(select billing_type from public.payments where encounter_id='" + eid + "');"
        "rollback;"
    )
    assert _verdict(out) == "paid=5280|btype=postpaid", out


# ── AC8: 과납(선납 > copay) 보존 ──────────────────────────────────────────────


def test_finalize_overpay_preserves_prepaid(psql: Psql, doctor_id: str, reception_id: str):
    """선결제 9000(copay 5280·과납) → finalize → paid=greatest(5280,9000)=9000(보존·환급 7.9)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _setup_in_progress(pid, eid, doctor_id)
        + _claims(reception_id)
        + f"select public.prepay_payment('{eid}', 9000, 'card');"
        + f"select public.finalize_payment('{eid}','card');"
        + "select 'V:paid='||(select paid_amount_krw from public.payments where encounter_id='"
        + eid
        + "')::text"
        "||'|copay='||(select copay_amount_krw from public.payments where encounter_id='"
        + eid
        + "')::text;"
        "rollback;"
    )
    assert _verdict(out) == "paid=9000|copay=5280", out
