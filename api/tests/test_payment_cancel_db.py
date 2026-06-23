"""취소·노쇼 정산(settle_cancelled_visit·Story 7.9) DB 레벨 통합 테스트 — psql 직접(0052).

settle_cancelled_visit(encounter_id, reason) = cancel_encounter(registered→cancelled) + draft 수납
void(status='cancelled'·cancelled_at·cancel_reason) + 선납 전액 환급(refunded=paid).
취소·노쇼 = 수가 미발생(구조적·진찰 전 fee_items 0). 상태전이·정산은 DB 소유(project-context).

검증(AC 매핑):
  · AC2: cancel_encounter 전이 + draft void(status='cancelled'·cancelled_at)
  · AC3: 선납 후 취소 → refunded=paid(전액·paid 보존)·후수납(선납 0) → refunded=0
  · AC4: payments_cancelled_consistency CHECK(cancelled→cancelled_at 필수)·refunded≤paid CHECK
  · AC9: reception grant 통과 / nurse 미보유 → 42501·EXECUTE 회수(authenticated 차단)
  · 가드: 비-registered(in_progress/completed) → PT409·no-payment 직접호출 → PT404

위생: 환자=dummy bytea·진찰료=start_consult 자동(AA154·copay 5280). begin/rollback 격리.
"""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import Psql

_DEPT = "(select id from public.departments where lower(code) = 'im' limit 1)"
_ANY_DX = "(select id from public.diagnoses limit 1)"


# ── 헬퍼(test_payment_prepay_db 미러) ─────────────────────────────────────────


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
    """reception auth uid — settle 호출자(encounter.cancel grant 7.9)·감사 actor."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'reception' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def nurse_id(psql: Psql) -> str:
    """nurse auth uid — encounter.cancel 미보유(403 baseline)."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'nurse' limit 1"
    ).lower()


def _patient_sql(pid: str, *, insurance: str = "health_insurance") -> str:
    return (
        "insert into public.patients(id, name, birth_date, sex, resident_no_enc, "
        "resident_no_hash, resident_no_masked, insurance_type) values "
        f"('{pid}','취소TEST','1990-01-01','male','\\x00'::bytea,"
        f"'__enc_{pid}__','900101-1******','{insurance}');"
    )


def _claims(uid: str) -> str:
    """request.jwt.claims + app.actor_id GUC 세팅(has_permission·감사 actor)."""
    return (
        "select set_config('request.jwt.claims', "
        f'\'{{"sub":"{uid}","role":"authenticated"}}\', true);'
        f"select set_config('app.actor_id', '{uid}', true);"
    )


def _setup_registered(pid: str, eid: str) -> str:
    """registered 내원(진찰 전·수가 0) — 취소 진입점 셋업(헤더 미생성)."""
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


# ── 함수 존재 ─────────────────────────────────────────────────────────────────


def test_settle_function_exists(psql: Psql):
    out = psql.scalar(
        "select 'V:'||(exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
        "where n.nspname='public' and p.proname='settle_cancelled_visit'))::text;"
    )
    assert _verdict(out) == "true", out


def test_refunded_column_exists(psql: Psql):
    out = psql.scalar(
        "select 'V:'||(exists(select 1 from information_schema.columns "
        "where table_schema='public' and table_name='payments' "
        "and column_name='refunded_amount_krw'))::text;"
    )
    assert _verdict(out) == "true", out


# ── AC2·AC3: 선납 후 취소 = void + 전액 환급 ──────────────────────────────────


def test_settle_after_prepay_voids_and_refunds(psql: Psql, reception_id: str):
    """registered 선납 5000 → settle → cancelled·refunded=5000(전액)·paid 보존·내원 cancelled."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _setup_registered(pid, eid)
        + _claims(reception_id)
        + f"select public.prepay_payment('{eid}', 5000, 'card');"
        + f"select public.build_payment('{eid}');"  # db 계층 선행 미러(헤더 보장)
        + f"select public.settle_cancelled_visit('{eid}', '취소');"
        + f"""select 'V:pstatus='||p.status
            ||'|refunded='||p.refunded_amount_krw::text
            ||'|paid='||p.paid_amount_krw::text
            ||'|cancelled_at='||(p.cancelled_at is not null)::text
            ||'|reason='||p.cancel_reason
            ||'|enc='||e.status
            from public.payments p join public.encounters e on e.id = p.encounter_id
            where p.encounter_id = '{eid}';"""
        + "rollback;"
    )
    assert (
        _verdict(out)
        == "pstatus=cancelled|refunded=5000|paid=5000|cancelled_at=true|reason=취소|enc=cancelled"
    ), out


def test_settle_postpaid_registered_no_refund(psql: Psql, reception_id: str):
    """후수납 registered(선납 0) → build → settle → status='cancelled'·refunded=0·내원 cancelled."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _setup_registered(pid, eid)
        + _claims(reception_id)
        + f"select public.build_payment('{eid}');"  # 헤더 생성(paid 0)
        + f"select public.settle_cancelled_visit('{eid}', null);"
        + f"""select 'V:pstatus='||p.status
            ||'|refunded='||p.refunded_amount_krw::text
            ||'|enc='||e.status
            from public.payments p join public.encounters e on e.id = p.encounter_id
            where p.encounter_id = '{eid}';"""
        + "rollback;"
    )
    assert _verdict(out) == "pstatus=cancelled|refunded=0|enc=cancelled", out


# ── 가드: 비-registered·no-payment ────────────────────────────────────────────


def test_settle_no_payment_direct_pt404(psql: Psql, reception_id: str):
    """build 미선행(헤더 없음) 직접 settle → PT404(방어 — db 계층은 build 선행으로 도달 불가)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    err = psql.expect_error(
        "begin;"
        + _setup_registered(pid, eid)
        + _claims(reception_id)
        + f"select public.settle_cancelled_visit('{eid}', null);"  # 헤더 없음 → PT404
        "rollback;"
    )
    assert "payment not found" in err.lower() or "pt404" in err.lower(), err


def test_settle_in_progress_rejected_pt409(psql: Psql, doctor_id: str, reception_id: str):
    """진찰 중(in_progress) settle → PT409(cancel_encounter 비-registered 차단·부분수행=7.10)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    err = psql.expect_error(
        "begin;"
        + _setup_in_progress(pid, eid, doctor_id)
        + _claims(reception_id)
        + f"select public.settle_cancelled_visit('{eid}', null);"  # in_progress → PT409
        "rollback;"
    )
    assert "invalid encounter transition" in err.lower() or "pt409" in err.lower(), err


def test_settle_completed_rejected_pt409(psql: Psql, doctor_id: str, reception_id: str):
    """완료(completed·finalized) 내원 settle → PT409. 락 순서 payment→encounter 라 payment 가드
    (status='finalized')가 cancel_encounter 보다 먼저 발화 = 'invalid payment transition'."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    err = psql.expect_error(
        "begin;"
        + _setup_in_progress(pid, eid, doctor_id)
        + _claims(reception_id)
        + f"select public.finalize_payment('{eid}','card');"  # completed + finalized
        + f"select public.settle_cancelled_visit('{eid}', null);"  # finalized payment → PT409
        "rollback;"
    )
    assert (
        "invalid payment transition" in err.lower()
        or "invalid encounter transition" in err.lower()
        or "pt409" in err.lower()
    ), err


# ── AC9: 권한(encounter.cancel) + EXECUTE 회수 ────────────────────────────────


def test_settle_without_encounter_cancel_permission_denied(psql: Psql, nurse_id: str):
    """nurse(encounter.cancel 미보유) settle → 42501(cancel_encounter 내부 has_permission 거부)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    err = psql.expect_error(
        "begin;"
        + _setup_registered(pid, eid)
        + _claims(nurse_id)
        + f"select public.build_payment('{eid}');"
        + f"select public.settle_cancelled_visit('{eid}', null);"  # encounter.cancel 미보유 → 42501
        "rollback;"
    )
    assert "permission denied" in err.lower() and "encounter.cancel" in err.lower(), err


def test_settle_execute_revoked_from_authenticated(psql: Psql):
    """settle_cancelled_visit EXECUTE 는 authenticated 직접호출 차단(위조 방어·service_role 만)."""
    err = psql.expect_error(
        "begin;set local role authenticated;"
        f"select public.settle_cancelled_visit('{uuid.uuid4()}', null);rollback;"
    )
    assert "permission denied" in err.lower() and "settle_cancelled_visit" in err.lower(), err


# ── AC4: 일관성/환급 CHECK ────────────────────────────────────────────────────


def test_cancelled_consistency_check_requires_cancelled_at(psql: Psql, reception_id: str):
    """status='cancelled' + cancelled_at NULL → payments_cancelled_consistency CHECK 위반."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    err = psql.expect_error(
        "begin;"
        + _setup_registered(pid, eid)
        + _claims(reception_id)
        + f"select public.build_payment('{eid}');"
        # cancelled_at NULL 인 채 status='cancelled' → CHECK 위반
        + f"update public.payments set status='cancelled' where encounter_id='{eid}';"
        "rollback;"
    )
    assert "payments_cancelled_consistency" in err.lower(), err


def test_refund_le_paid_check(psql: Psql, reception_id: str):
    """refunded > paid(받은 것보다 더 환급) → payments_refund_le_paid CHECK 위반."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    err = psql.expect_error(
        "begin;"
        + _setup_registered(pid, eid)
        + _claims(reception_id)
        + f"select public.build_payment('{eid}');"  # paid=0
        # refunded 1000 > paid 0 → CHECK 위반
        + f"update public.payments set refunded_amount_krw=1000 where encounter_id='{eid}';"
        "rollback;"
    )
    assert "payments_refund_le_paid" in err.lower(), err
