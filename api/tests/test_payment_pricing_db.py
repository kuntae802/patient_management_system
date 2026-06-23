"""본인부담 산정 함수(Story 7.3) DB 레벨 통합 테스트 — psql 직접(0047_payment_pricing).

price_payment(encounter_id) = payment_details 라인에 보험유형별 본인부담 산정(copay_rate·copay·
insurer) + 헤더 copay/insurer 롤업. 산정 로직은 DB 함수가 소유(project-context). 실 Supabase 로컬
db 에 psql 로 단언.

검증(AC 매핑):
  · AC1: copay_policies 8행 시드·unique·요율(건강보험 0.3/의료급여 0.15/자보 0/일반 1·비급여 1)
  · AC2: price_payment 보험유형별 산정·10원 절사·비급여 100%(전 유형)·라인 amount=copay+insurer·
         헤더 total=copay+insurer 롤업·draft 외 no-op·헤더 없음 null·멱등(change-guard)·EXECUTE 회수

위생: 환자=dummy bytea·수가=시드(aa254 12590 / aa154 17610). build_payment 로 라인 적재 후
price_payment. 전부 begin/rollback 격리(커밋 없음). uuid=Python.
"""

from __future__ import annotations

import uuid

from tests.conftest import Psql

_DEPT = "(select id from public.departments where lower(code) = 'im' limit 1)"


# ── SQL 조각 헬퍼(test_payment_aggregation_db 미러 + insurance 파라미터) ───────────


def _patient_sql(pid: str, *, insurance: str = "health_insurance") -> str:
    return (
        "insert into public.patients(id, name, birth_date, sex, resident_no_enc, "
        "resident_no_hash, resident_no_masked, insurance_type) values "
        f"('{pid}','산정TEST','1990-01-01','male','\\x00'::bytea,"
        f"'__enc_{pid}__','900101-1******','{insurance}');"
    )


def _encounter_sql(eid: str, pid: str, *, status: str = "registered") -> str:
    return (
        "insert into public.encounters(id, patient_id, department_id, visit_type, status) "
        f"values ('{eid}','{pid}',{_DEPT},'walk_in','{status}');"
    )


def _fee_item_sql(
    fiid: str,
    eid: str,
    *,
    code: str = "aa254",
    amount: int = 12590,
    coverage: str = "covered",
) -> str:
    """수가항목 1행 — quantity=1·unit=amount. coverage(급여/비급여)가 산정 분기를 가른다."""
    fee = f"(select id from public.fee_schedules where lower(code)='{code}' limit 1)"
    return (
        "insert into public.fee_items(id, encounter_id, fee_schedule_id, source_type, source_id, "
        " quantity, unit_amount_krw, amount_krw, category, coverage_type) "
        f"values ('{fiid}','{eid}',{fee},'examination','{fiid}',1,{amount},{amount},"
        f"'검사료','{coverage}');"
    )


def _build(eid: str) -> str:
    return f"select public.build_payment('{eid}');"


def _price(eid: str) -> str:
    return f"select public.price_payment('{eid}');"


def _verdict(out: str) -> str:
    lines = [ln.strip() for ln in out.splitlines() if ln.strip().startswith("V:")]
    assert lines, f"verdict 줄 없음: {out!r}"
    return lines[-1][2:]


def _hdr(eid: str) -> str:
    """헤더 copay/insurer/total verdict 조각."""
    return (
        "select 'V:copay='||(select copay_amount_krw from public.payments where encounter_id='"
        + eid
        + "')::text||'|insurer='||(select insurer_amount_krw from public.payments "
        "where encounter_id='" + eid + "')::text||'|total='||(select total_amount_krw "
        "from public.payments where encounter_id='" + eid + "')::text;"
    )


def _priced_case(psql: Psql, *, insurance: str, amount: int, coverage: str = "covered") -> str:
    """단일 라인 내원을 build+price 후 헤더 verdict(copay|insurer|total) 반환(rollback 격리)."""
    pid, eid, fi = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    code = "aa254" if amount == 12590 else "aa154"
    return _verdict(
        psql.scalar(
            "begin;"
            + _patient_sql(pid, insurance=insurance)
            + _encounter_sql(eid, pid)
            + _fee_item_sql(fi, eid, code=code, amount=amount, coverage=coverage)
            + _build(eid)
            + _price(eid)
            + _hdr(eid)
            + "rollback;"
        )
    )


# ── AC1: copay_policies 시드·요율 ─────────────────────────────────────────────


def test_copay_policies_seeded_8_rows(psql: Psql):
    """copay_policies 8행(보험유형 4 × 급여구분 2) 시드 — 마이그 임베드(운영 필수 참조)."""
    out = psql.scalar("select 'V:'||count(*)::text from public.copay_policies;")
    assert _verdict(out) == "8", out


def test_copay_policies_rates(psql: Psql):
    """요율 프리셋(사용자 확정): 급여 건강보험 0.300/의료급여 0.150/자보 0.000/일반 1.000."""
    out = psql.scalar(
        "select 'V:hi='||(select copay_rate from public.copay_policies "
        "  where insurance_type='health_insurance' and coverage_type='covered')::text"
        "||'|ma='||(select copay_rate from public.copay_policies "
        "  where insurance_type='medical_aid' and coverage_type='covered')::text"
        "||'|auto='||(select copay_rate from public.copay_policies "
        "  where insurance_type='auto_insurance' and coverage_type='covered')::text"
        "||'|self='||(select copay_rate from public.copay_policies "
        "  where insurance_type='self_pay' and coverage_type='covered')::text;"
    )
    assert _verdict(out) == "hi=0.300|ma=0.150|auto=0.000|self=1.000", out


def test_copay_policies_non_covered_all_full(psql: Psql):
    """비급여 = 전 보험유형 1.000(환자 전액·보험유형 무관)."""
    out = psql.scalar(
        "select 'V:'||coalesce(bool_and(copay_rate = 1.000),false)::text "
        "from public.copay_policies where coverage_type='non_covered';"
    )
    assert _verdict(out) == "true", out


def test_copay_policies_unique_violation(psql: Psql):
    """(insurance_type, coverage_type) 중복 INSERT → unique 위반(단일 요율 강제)."""
    err = psql.expect_error(
        "begin;insert into public.copay_policies(insurance_type, coverage_type, copay_rate) "
        "values ('health_insurance','covered',0.500);rollback;"
    )
    assert "duplicate key" in err.lower() or "unique" in err.lower(), err


def test_copay_policies_write_denied_for_authenticated(psql: Psql):
    """authenticated 쓰기 거부 — INSERT 권한 미부여(요율=마이그/시드 소유·AC1 쓰기 정책 없음)."""
    err = psql.expect_error(
        "begin;set local role authenticated;"
        "insert into public.copay_policies(insurance_type, coverage_type, copay_rate) "
        "values ('self_pay','covered',0.500);rollback;"
    )
    assert "permission denied" in err.lower(), err


# ── AC2: price_payment 보험유형별 산정 ────────────────────────────────────────


def test_price_payment_function_exists(psql: Psql):
    out = psql.scalar(
        "select 'V:'||(exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
        "where n.nspname='public' and p.proname='price_payment'))::text;"
    )
    assert _verdict(out) == "true", out


def test_price_payment_health_insurance_covered_and_non_covered(psql: Psql):
    """건강보험: 급여 12590(30%→3770/8820) + 비급여 3200(본인) → 헤더 copay 6970·insurer 8820."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    fi1, fi2 = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid, insurance="health_insurance")
        + _encounter_sql(eid, pid)
        + _fee_item_sql(fi1, eid, code="aa254", amount=12590, coverage="covered")
        + _fee_item_sql(fi2, eid, code="aa154", amount=3200, coverage="non_covered")
        + _build(eid)
        + _price(eid)
        + _hdr(eid)
        + "rollback;"
    )
    assert _verdict(out) == "copay=6970|insurer=8820|total=15790", out


def test_price_payment_10won_floor(psql: Psql):
    """10원 미만 절사: 건강보험 급여 17610 × 0.3 = 5283 → copay 5280(절사)·insurer 12330(차액)."""
    out = _priced_case(psql, insurance="health_insurance", amount=17610, coverage="covered")
    assert out == "copay=5280|insurer=12330|total=17610", out


def test_price_payment_medical_aid_covered(psql: Psql):
    """의료급여: 급여 12590 × 0.15 = 1888.5 → copay 1880(절사)·insurer 10710."""
    out = _priced_case(psql, insurance="medical_aid", amount=12590, coverage="covered")
    assert out == "copay=1880|insurer=10710|total=12590", out


def test_price_payment_auto_insurance_zero_copay(psql: Psql):
    """자동차보험: 급여 = 보험사 전액(copay 0·insurer = amount)."""
    out = _priced_case(psql, insurance="auto_insurance", amount=12590, coverage="covered")
    assert out == "copay=0|insurer=12590|total=12590", out


def test_price_payment_self_pay_full_copay(psql: Psql):
    """일반(self_pay): 급여라도 전액 본인(copay = amount·insurer 0)."""
    out = _priced_case(psql, insurance="self_pay", amount=12590, coverage="covered")
    assert out == "copay=12590|insurer=0|total=12590", out


def test_price_payment_non_covered_full_regardless_of_insurance(psql: Psql):
    """비급여 = 보험유형 무관 환자 전액(자동차보험이어도 copay = amount·insurer 0)."""
    out = _priced_case(psql, insurance="auto_insurance", amount=3200, coverage="non_covered")
    assert out == "copay=3200|insurer=0|total=3200", out


def test_price_payment_line_invariant_amount_eq_copay_plus_insurer(psql: Psql):
    """라인 불변식: 모든 라인 amount_krw = copay_amount_krw + insurer_amount_krw."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    fi1, fi2 = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid, insurance="health_insurance")
        + _encounter_sql(eid, pid)
        + _fee_item_sql(fi1, eid, code="aa254", amount=12590, coverage="covered")
        + _fee_item_sql(fi2, eid, code="aa154", amount=3200, coverage="non_covered")
        + _build(eid)
        + _price(eid)
        + "select 'V:'||coalesce(bool_and(pd.amount_krw = "
        "pd.copay_amount_krw + pd.insurer_amount_krw),false)::text "
        "from public.payment_details pd "
        "  join public.payments p on p.id=pd.payment_id where p.encounter_id='" + eid + "';"
        "rollback;"
    )
    assert _verdict(out) == "true", out


def test_price_payment_snapshots_copay_rate(psql: Psql):
    """copay_rate 스냅샷 = 적용 본인부담률(건강보험 급여 = 0.300)."""
    pid, eid, fi = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid, insurance="health_insurance")
        + _encounter_sql(eid, pid)
        + _fee_item_sql(fi, eid, code="aa254", amount=12590, coverage="covered")
        + _build(eid)
        + _price(eid)
        + "select 'V:'||(select copay_rate from public.payment_details pd "
        "  join public.payments p on p.id=pd.payment_id where p.encounter_id='"
        + eid
        + "' limit 1)::text;"
        "rollback;"
    )
    assert _verdict(out) == "0.300", out


def test_price_payment_idempotent(psql: Psql):
    """price_payment 2회 호출 → 동일값(change-guard·재산정 안정)."""
    pid, eid, fi = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid, insurance="health_insurance")
        + _encounter_sql(eid, pid)
        + _fee_item_sql(fi, eid, code="aa254", amount=12590, coverage="covered")
        + _build(eid)
        + _price(eid)
        + _price(eid)  # 2차 — 미변경 no-op
        + _hdr(eid)
        + "rollback;"
    )
    assert _verdict(out) == "copay=3770|insurer=8820|total=12590", out


def test_price_payment_noop_when_not_draft(psql: Psql):
    """finalized 수납(라인 1·copay 미산정)에 price_payment → 동결(copay 불변·비공허 단언)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    payid, pdid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid, insurance="health_insurance")
        + _encounter_sql(eid, pid)
        + "insert into public.payments(id, encounter_id, status, total_amount_krw, "
        "covered_amount_krw) "
        f"values ('{payid}','{eid}','finalized',12590,12590);"
        + "insert into public.payment_details"
        "(id, payment_id, quantity, unit_amount_krw, amount_krw, coverage_type, copay_amount_krw) "
        f"values ('{pdid}','{payid}',1,12590,12590,'covered',0);"
        + _price(eid)
        + "select 'V:copay='||(select copay_amount_krw from public.payment_details "
        "  where id='" + pdid + "')::text||'|hdr_copay='||(select copay_amount_krw "
        "  from public.payments where id='" + payid + "')::text;"
        "rollback;"
    )
    assert _verdict(out) == "copay=0|hdr_copay=0", out


def test_price_payment_null_when_no_header(psql: Psql):
    """수납 헤더 없는 내원(빌드 전) price_payment → null 반환(no-op)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + "select 'V:'||coalesce(public.price_payment('"
        + eid
        + "')::text,'NULL');"
        "rollback;"
    )
    assert _verdict(out) == "NULL", out


def test_price_payment_execute_revoked_from_authenticated(psql: Psql):
    """price_payment EXECUTE 는 authenticated 직접 호출 차단(산정 위조 방어 — service_role 만)."""
    err = psql.expect_error(
        "begin;set local role authenticated;"
        f"select public.price_payment('{uuid.uuid4()}');rollback;"
    )
    assert "permission denied" in err.lower() and "price_payment" in err.lower(), err
