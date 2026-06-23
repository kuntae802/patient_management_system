"""수납 집계 함수(Story 7.2) DB 레벨 통합 테스트 — psql 직접(0046_payment_aggregation).

build_payment(encounter_id) = fee_items → payment_details 멱등 적재 + 헤더 롤업(total/covered/
non_covered). 집계 로직은 DB 함수가 소유(project-context). 실 Supabase 로컬 db 에 psql 로 단언.

검증(AC 매핑):
  · AC1: build_payment 집계·멱등(2회 호출 라인 중복 0)·헤더 롤업(total=covered+non_covered=Σ라인)·
         재집계 신규 fee_item 추가·draft 외 no-op·code/name fee_schedules 조인 스냅샷·EXECUTE 회수
  · AC2: payment.manage 카탈로그 + admin 부트 grant + reception grant(doctor/nurse 미보유)

위생: 환자=dummy bytea·수가=시드(aa254/aa154). 전부 begin/rollback 격리(커밋 없음). uuid=Python.
"""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import Psql

_DEPT = "(select id from public.departments where lower(code) = 'im' limit 1)"


# ── 픽스처: 시드 직원 uid ──────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def admin_id(psql: Psql) -> str:
    """admin uid — 0046 부트 grant(payment.manage) + 0002 전권."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'admin' limit 1"
    ).lower()


# ── SQL 조각 헬퍼(test_payments_db 미러) ──────────────────────────────────────


def _patient_sql(pid: str) -> str:
    return (
        "insert into public.patients(id, name, birth_date, sex, resident_no_enc, "
        "resident_no_hash, resident_no_masked, insurance_type) values "
        f"('{pid}','집계TEST','1990-01-01','male','\\x00'::bytea,"
        f"'__enc_{pid}__','900101-1******','health_insurance');"
    )


def _encounter_sql(eid: str, pid: str, *, status: str = "registered") -> str:
    """내원 1행(기본 registered — 유효 초기 상태). build_payment 는 상태 무관하게 fee_items 집계.

    수가는 _fee_item_sql 로 직접 적재(start_consult 미경유 → 진찰료 자동발생 없음·금액 통제)."""
    return (
        "insert into public.encounters(id, patient_id, department_id, visit_type, status) "
        f"values ('{eid}','{pid}',{_DEPT},'walk_in','{status}');"
    )


def _fee_item_sql(
    fiid: str,
    eid: str,
    *,
    code: str = "aa254",
    amount: int = 100,
    coverage: str = "covered",
    source_type: str = "examination",
    source_id: str | None = None,
) -> str:
    """수가항목 1행 INSERT — quantity=1·unit=amount(amount=qty*unit). coverage 는 라인 스냅샷."""
    sid = source_id or fiid
    fee = f"(select id from public.fee_schedules where lower(code)='{code}' limit 1)"
    return (
        "insert into public.fee_items(id, encounter_id, fee_schedule_id, source_type, source_id, "
        " quantity, unit_amount_krw, amount_krw, category, coverage_type) "
        f"values ('{fiid}','{eid}',{fee},'{source_type}','{sid}',1,{amount},{amount},"
        f"'검사료','{coverage}');"
    )


def _build(eid: str) -> str:
    return f"select public.build_payment('{eid}');"


def _verdict(out: str) -> str:
    lines = [ln.strip() for ln in out.splitlines() if ln.strip().startswith("V:")]
    assert lines, f"verdict 줄 없음: {out!r}"
    return lines[-1][2:]


# ── AC1: build_payment 집계·멱등·롤업 ─────────────────────────────────────────


def test_build_payment_function_exists(psql: Psql):
    """build_payment(uuid) 함수 존재."""
    out = psql.scalar(
        "select 'V:'||(exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
        "where n.nspname='public' and p.proname='build_payment'))::text;"
    )
    assert _verdict(out) == "true", out


def test_build_payment_aggregates_and_rolls_up(psql: Psql):
    """fee_items 2건(급여 12590 + 비급여 3200) → 라인 2·total 15790·cov·non 롤업. 멱등(2회)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    fi1, fi2 = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _fee_item_sql(fi1, eid, code="aa254", amount=12590, coverage="covered")
        + _fee_item_sql(fi2, eid, code="aa154", amount=3200, coverage="non_covered")
        + _build(eid)  # 1차 빌드
        + _build(eid)  # 2차 빌드(멱등 — 라인 중복 0)
        + "select 'V:lines='||(select count(*) from public.payment_details pd "
        "  join public.payments p on p.id=pd.payment_id where p.encounter_id='" + eid + "')::text"
        "||'|total='||(select total_amount_krw from public.payments where encounter_id='"
        + eid
        + "')::text"
        "||'|cov='||(select covered_amount_krw from public.payments where encounter_id='"
        + eid
        + "')::text"
        "||'|non='||(select non_covered_amount_krw from public.payments where encounter_id='"
        + eid
        + "')::text;"
        "rollback;"
    )
    assert _verdict(out) == "lines=2|total=15790|cov=12590|non=3200", out


def test_build_payment_creates_single_draft_header(psql: Psql):
    """build_payment 는 내원당 단일 draft 헤더 생성(2회 호출에도 payments 1행, 1:1)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    fi1 = str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _fee_item_sql(fi1, eid, amount=12590)
        + _build(eid)
        + _build(eid)
        + "select 'V:cnt='||count(*)::text||'|status='||coalesce(max(status),'-') "
        "  from public.payments where encounter_id='" + eid + "';"
        "rollback;"
    )
    assert _verdict(out) == "cnt=1|status=draft", out


def test_build_payment_snapshots_code_and_name(psql: Psql):
    """라인 code/name 은 fee_schedules 조인 스냅샷(fee_items 엔 code/name 없음)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    fi1 = str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _fee_item_sql(fi1, eid, code="aa254", amount=12590)
        + _build(eid)
        + "select 'V:code='||coalesce(bool_and(pd.code = "
        "  (select code from public.fee_schedules where lower(code)='aa254')),false)::text"
        "||'|hasname='||coalesce(bool_and(pd.name is not null),false)::text"
        "||'|feeitem='||coalesce(bool_and(pd.fee_item_id is not null),false)::text "
        "  from public.payment_details pd join public.payments p on p.id=pd.payment_id "
        "  where p.encounter_id='" + eid + "';"
        "rollback;"
    )
    assert _verdict(out) == "code=true|hasname=true|feeitem=true", out


def test_build_payment_picks_up_new_fee_item(psql: Psql):
    """재집계 — 1차 빌드 후 새 fee_item 추가 → 2차 빌드가 그 라인만 추가(append, 기존 불변)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    fi1, fi2 = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _fee_item_sql(fi1, eid, amount=12590, coverage="covered")
        + _build(eid)  # 라인 1
        + _fee_item_sql(fi2, eid, amount=3200, coverage="non_covered")  # 이후 수행된 오더
        + _build(eid)  # 라인 2(신규만 추가)
        + "select 'V:lines='||(select count(*) from public.payment_details pd "
        "  join public.payments p on p.id=pd.payment_id where p.encounter_id='" + eid + "')::text"
        "||'|total='||(select total_amount_krw from public.payments where encounter_id='"
        + eid
        + "')::text;"
        "rollback;"
    )
    assert _verdict(out) == "lines=2|total=15790", out


def test_build_payment_noop_when_not_draft(psql: Psql):
    """finalized 수납(직접 INSERT)에 build_payment → 집계 동결(라인 0·총액 불변, 7.4 후 불변)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    fi1 = str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _fee_item_sql(fi1, eid, amount=12590)
        # finalized 행은 payments_finalized_consistency CHECK(0048) 충족 — 결제 컬럼 동반.
        + "insert into public.payments(id, encounter_id, status, payment_no, payment_method, "
        "finalized_at, finalized_by) "
        f"values ('{uuid.uuid4()}','{eid}','finalized','R-TEST-{eid[:6]}','card',now(),"
        "(select id from public.users limit 1));"
        + _build(eid)
        + "select 'V:lines='||(select count(*) from public.payment_details pd "
        "  join public.payments p on p.id=pd.payment_id where p.encounter_id='" + eid + "')::text"
        "||'|total='||(select total_amount_krw from public.payments where encounter_id='"
        + eid
        + "')::text;"
        "rollback;"
    )
    assert _verdict(out) == "lines=0|total=0", out


def test_build_payment_noop_preserves_existing_lines(psql: Psql):
    """finalized 수납에 기존 라인 1 + 미집계 fee_item → build_payment 무변경(비공허 불변 단언).

    라인 0 페이로드 공허 단언 보완 — 라인 존재 상태로 '라인 불변·fee_item 미적재' 검증(코드리뷰)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    fi1, payid, pdid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _fee_item_sql(fi1, eid, amount=12590)  # 미집계 수가(finalized 라 적재 안 됨)
        # finalized 행은 payments_finalized_consistency CHECK(0048) 충족 — 결제 컬럼 동반.
        + "insert into public.payments(id, encounter_id, status, total_amount_krw, payment_no, "
        "payment_method, finalized_at, finalized_by) "
        f"values ('{payid}','{eid}','finalized',5000,'R-TEST-{payid[:6]}','card',now(),"
        "(select id from public.users limit 1));" + "insert into public.payment_details"
        "(id, payment_id, quantity, unit_amount_krw, amount_krw, coverage_type) "
        f"values ('{pdid}','{payid}',1,5000,5000,'covered');"
        + _build(eid)
        + "select 'V:lines='||(select count(*) from public.payment_details "
        "  where payment_id='" + payid + "')::text"
        "||'|total='||(select total_amount_krw from public.payments where id='" + payid + "')::text"
        "||'|fee_added='||(exists(select 1 from public.payment_details "
        "  where payment_id='" + payid + "' and fee_item_id='" + fi1 + "'))::text;"
        "rollback;"
    )
    assert _verdict(out) == "lines=1|total=5000|fee_added=false", out


def test_build_payment_empty_encounter_creates_empty_draft(psql: Psql):
    """fee_item 없는 내원 → 빈 draft 헤더(라인 0·총액 0). 빌드 안전(빈 상태 표시)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _build(eid)
        + "select 'V:hdr='||(select count(*) from public.payments where encounter_id='"
        + eid
        + "')::text"
        "||'|lines='||(select count(*) from public.payment_details pd "
        "  join public.payments p on p.id=pd.payment_id where p.encounter_id='" + eid + "')::text;"
        "rollback;"
    )
    assert _verdict(out) == "hdr=1|lines=0", out


def test_build_payment_execute_revoked_from_authenticated(psql: Psql):
    """build_payment EXECUTE 는 authenticated 직접 호출 차단(쓰기 위조 방어 — service_role 만)."""
    err = psql.expect_error(
        "begin;set local role authenticated;"
        f"select public.build_payment('{uuid.uuid4()}');rollback;"
    )
    assert "permission denied" in err.lower() and "build_payment" in err.lower(), err


# ── AC2: payment.manage 권한 ──────────────────────────────────────────────────


def test_payment_manage_catalogued_and_admin_has_it(psql: Psql, admin_id: str):
    """payment.manage 권한 카탈로그 존재 + admin 부트 grant 보유(회귀 가드)."""
    out = psql.scalar(
        "select 'V:cat='||(exists(select 1 from public.permissions "
        "where code='payment.manage'))::text"
        "||'|admin='||(exists(select 1 from public.role_permissions rp "
        "  join public.roles r on r.id=rp.role_id "
        "  join public.permissions p on p.id=rp.permission_id "
        "  where r.code='admin' and p.code='payment.manage'))::text;"
    )
    assert _verdict(out) == "cat=true|admin=true", out


def test_payment_manage_granted_to_reception_only(psql: Psql):
    """payment.manage = reception 만 보유(수납 정산 쓰기). doctor/nurse 미보유(403 baseline)."""
    out = psql.scalar(
        "select 'V:rec='||(exists(select 1 from public.role_permissions rp "
        "  join public.roles r on r.id=rp.role_id "
        "  join public.permissions p on p.id=rp.permission_id "
        "  where r.code='reception' and p.code='payment.manage'))::text"
        "||'|doc='||(exists(select 1 from public.role_permissions rp "
        "  join public.roles r on r.id=rp.role_id "
        "  join public.permissions p on p.id=rp.permission_id "
        "  where r.code='doctor' and p.code='payment.manage'))::text"
        "||'|nur='||(exists(select 1 from public.role_permissions rp "
        "  join public.roles r on r.id=rp.role_id "
        "  join public.permissions p on p.id=rp.permission_id "
        "  where r.code='nurse' and p.code='payment.manage'))::text;"
    )
    assert _verdict(out) == "rec=true|doc=false|nur=false", out
