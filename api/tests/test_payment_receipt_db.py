"""진료비 계산서·영수증 출력 토대(Story 7.5) DB 레벨 통합 테스트 — psql 직접(0049_payment_receipt).

검증(AC 매핑):
  · AC1: clinic_profile 단일행 마스터 — id=1 CHECK·authenticated SELECT 허용·쓰기 거부·시드 1행
  · AC2: log_payment_document_export — 'read' 감사 적재(target=payments/payment_id·document_type)·
         actor=app.actor_id·payment 미존재 PT404·payment.read 미보유 거부·EXECUTE 회수

위생: 환자=dummy bytea·payments draft 직접 적재(export 는 payment 존재만). begin/rollback 격리.
"""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import Psql

_DEPT = "(select id from public.departments where lower(code) = 'im' limit 1)"


# ── 헬퍼 ──────────────────────────────────────────────────────────────────────


def _verdict(out: str) -> str:
    lines = [ln.strip() for ln in out.splitlines() if ln.strip().startswith("V:")]
    assert lines, f"verdict 줄 없음: {out!r}"
    return lines[-1][2:]


@pytest.fixture(scope="module")
def reception_id(psql: Psql) -> str:
    """reception auth uid — payment.read 보유(문서 조회·내보내기 actor)."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'reception' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def nurse_id(psql: Psql) -> str:
    """nurse auth uid — payment.read 미보유(거부 baseline)."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'nurse' limit 1"
    ).lower()


def _claims(uid: str) -> str:
    return (
        "select set_config('request.jwt.claims', "
        f'\'{{"sub":"{uid}","role":"authenticated"}}\', true);'
        f"select set_config('app.actor_id', '{uid}', true);"
    )


def _payment_sql(pid: str, eid: str, payid: str, *, status: str = "finalized") -> str:
    """환자 + 내원 + 수납 직접 적재. 기본 finalized(export 게이트·consistency CHECK 충족 위해 결제
    4컬럼 동반). status='draft' 면 결제 컬럼 없이 draft(finalized 게이트 PT409 baseline)."""
    base = (
        "insert into public.patients(id, name, birth_date, sex, resident_no_enc, "
        "resident_no_hash, resident_no_masked, insurance_type) values "
        f"('{pid}','영수증TEST','1990-01-01','male','\\x00'::bytea,"
        f"'__enc_{pid}__','900101-1******','health_insurance');"
        "insert into public.encounters(id, patient_id, department_id, visit_type, status) "
        f"values ('{eid}','{pid}',{_DEPT},'walk_in','registered');"
    )
    if status == "finalized":
        return base + (
            "insert into public.payments(id, encounter_id, status, total_amount_krw, "
            " payment_method, payment_no, finalized_at, finalized_by) values "
            f"('{payid}','{eid}','finalized',10000,'card','R-TEST-000001',now(),"
            "(select id from public.users limit 1));"
        )
    return base + (
        "insert into public.payments(id, encounter_id, status, total_amount_krw) "
        f"values ('{payid}','{eid}','{status}',10000);"
    )


# ── AC1: clinic_profile 단일행 마스터 ─────────────────────────────────────────


def test_clinic_profile_seeded_single_row(psql: Psql):
    """seed = 단일행(id=1·병원명·요양기관기호 채워짐)."""
    out = psql.scalar(
        "select 'V:'||(count(*)=1 and bool_and(id=1 and length(name)>0 "
        "and length(hira_no)>0))::text "
        "from public.clinic_profile;"
    )
    assert _verdict(out) == "true", out


def test_clinic_profile_single_row_check(psql: Psql):
    """id=2 INSERT → CHECK 위반(단일행 강제·요양기관 단일 운영)."""
    err = psql.expect_error(
        "begin;"
        "insert into public.clinic_profile(id,name,biz_no,hira_no,address,ceo_name,phone) "
        "values (2,'x','x','x','x','x','x');"
        "rollback;"
    )
    assert "check" in err.lower() or "clinic_profile" in err.lower(), err


def test_clinic_profile_authenticated_select_allowed(psql: Psql, reception_id: str):
    """authenticated 역할 SELECT 허용(전역 참조·비민감 — 영수증 헤더 조회)."""
    out = psql.scalar(
        "begin;set local role authenticated;"
        + _claims(reception_id)
        + "select 'V:'||(select count(*) from public.clinic_profile)::text;"
        "rollback;"
    )
    assert _verdict(out) == "1", out


def test_clinic_profile_authenticated_write_denied(psql: Psql, reception_id: str):
    """authenticated UPDATE 거부 — GRANT 가 SELECT 만(쓰기는 service_role·departments 동형)."""
    err = psql.expect_error(
        "begin;set local role authenticated;"
        + _claims(reception_id)
        + "update public.clinic_profile set phone='99' where id=1;"
        "rollback;"
    )
    assert "permission denied" in err.lower() and "clinic_profile" in err.lower(), err


# ── AC2: log_payment_document_export 내보내기 감사 ────────────────────────────


def test_log_export_function_exists(psql: Psql):
    out = psql.scalar(
        "select 'V:'||(exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
        "where n.nspname='public' and p.proname='log_payment_document_export'))::text;"
    )
    assert _verdict(out) == "true", out


def test_log_export_records_read_audit(psql: Psql, reception_id: str):
    """export → audit 'read'·target=payments/payment_id·document_type=receipt·actor."""
    pid, eid, payid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _payment_sql(pid, eid, payid)
        + _claims(reception_id)
        + f"select public.log_payment_document_export('{eid}','receipt');"
        + "select 'V:'||(select "
        "  action||'|'||target_table||'|'||(target_id='" + payid + "')::text"
        "  ||'|'||(after_data->>'document_type')||'|'||(actor_id='" + reception_id + "')::text "
        "  from public.audit_logs "
        "  where target_id='" + payid + "' and after_data->>'event'='document_export' "
        "  order by created_at desc limit 1);"
        "rollback;"
    )
    assert _verdict(out) == "read|payments|true|receipt|true", out


def test_log_export_payment_missing_pt404(psql: Psql, reception_id: str):
    """payment 미존재 내원 export → PT404(방어 — 정상 경로는 finalized 영수증)."""
    err = psql.expect_error(
        "begin;"
        + _claims(reception_id)
        + f"select public.log_payment_document_export('{uuid.uuid4()}','receipt');"
        "rollback;"
    )
    assert "payment not found" in err.lower() or "pt404" in err.lower(), err


def test_log_export_non_finalized_pt409(psql: Psql, reception_id: str):
    """draft(비-finalized) 수납 export → PT409(GET receipt 409 와 일관·감사 오염 차단)."""
    pid, eid, payid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    err = psql.expect_error(
        "begin;"
        + _payment_sql(pid, eid, payid, status="draft")
        + _claims(reception_id)
        + f"select public.log_payment_document_export('{eid}','receipt');"
        "rollback;"
    )
    assert "finalized" in err.lower() or "pt409" in err.lower(), err


def test_log_export_without_payment_read_denied(psql: Psql, nurse_id: str):
    """payment.read 미보유(nurse) export → insufficient_privilege(방어심층·라우터 게이트 1차선)."""
    pid, eid, payid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    err = psql.expect_error(
        "begin;"
        + _payment_sql(pid, eid, payid)
        + _claims(nurse_id)
        + f"select public.log_payment_document_export('{eid}','receipt');"
        "rollback;"
    )
    assert "permission denied" in err.lower() and "payment.read" in err.lower(), err


def test_log_export_execute_revoked_from_authenticated(psql: Psql):
    """EXECUTE 회수 — authenticated 직접 호출 차단(감사 위조 방어·service_role 만)."""
    err = psql.expect_error(
        "begin;set local role authenticated;"
        f"select public.log_payment_document_export('{uuid.uuid4()}','receipt');rollback;"
    )
    assert "permission denied" in err.lower() and "log_payment_document_export" in err.lower(), err
