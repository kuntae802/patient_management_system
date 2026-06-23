"""수가 자동발생 트리거(Story 5.10) DB 레벨 통합 테스트 — psql 직접(0021_billing).

순수 DB 스토리: FastAPI 미경유. 실 Supabase 로컬 db 컨테이너에 psql 로 붙어 임상 이벤트가
수가 항목(fee_items)을 원자적·멱등적으로 적재하는지 단언한다. test_orders_db 하니스 미러.

검증(AC 매핑 — 5.10 + Story 7.1 갱신):
  · AC1/AC2: fee_items·fee_mappings 테이블·CHECK·unique(source_type, source_id) 존재
  · AC3(7.1 초진/재진 동적): 첫 내원 → 초진 AA154(17610) / 과거 완료 내원 보유 → 재진 AA254(12590)
  · AC4(7.1 만료수가 적재제외): 만료·비활성 수가 → insert_fee_item no-op(0행 적재 제외)
  · AC5(7.1 amount CHECK): fee_items amount_krw <> quantity*unit_amount_krw → CHECK 위반(23514)
  · 검사 수행(perform_examination, ordered→performed) → 검사료 1행 / 판독 추가 적재 0
  · 처치 수행(perform_treatment_order, ordered→performed) → 처치료 1행
  · 멱등(insert_fee_item 재호출 1행) + 금액 스냅샷 불변(마스터 변경 후 보존)
  · 처방 발행(issued) → fee_items 0(약제비 원외 스코프아웃 — 약가 부재)
  · RLS — 직원(fee_item.read)=전체 / 환자=본인 내원 / nurse(미보유)=0 / anon=거부
  · 적재가 actor 와 함께 audit_logs 기록(트리거가 RPC 호출자 컨텍스트 계승)

⚠️ Story 7.1 회귀: fee_on_encounter_start 초진/재진 동적 재정의 → 첫 내원 진찰료 = AA154 초진
  (5.10 단일 AA254 재진 고정에서 변경). 재진 검증은 과거 완료 내원(full RPC 체인)을 선행 세팅한다.

위생: 환자=dummy '\\x00'::bytea, 수가=시드 마스터(fee_schedules) 참조. 진찰/수행은 RPC 직접 호출.
전부 begin/rollback 격리(커밋 없음 → flaky 0). uuid 는 Python 이 부여.
"""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import Psql

_DEPT = "(select id from public.departments where lower(code) = 'im' limit 1)"
# 시드 마스터 참조(0007/2.5 seed) — 수가는 마스터 FK 로만.
# 진찰료=AA154(초진 17610)/AA254(재진 12590).
# imaging=HA201(9030)·lab=C3800(3500)·처치=M0030(4500).
_FEE_CONSULT_INITIAL = "(select id from public.fee_schedules where lower(code)='aa154' limit 1)"
# 재진(직접 적재 헬퍼 테스트용)
_FEE_CONSULT = "(select id from public.fee_schedules where lower(code)='aa254' limit 1)"
_FEE_EXAM = {
    "lab": "(select id from public.fee_schedules where lower(code)='c3800' limit 1)",
    "imaging": "(select id from public.fee_schedules where lower(code)='ha201' limit 1)",
}
_FEE_TRT = "(select id from public.fee_schedules where lower(code)='m0030' limit 1)"

# 적재 시점 스냅샷 기대값(seed.sql §EDI 수가 — 마스터 변경 전 현재값).
_CONSULT_INITIAL_AMOUNT = "17610"  # 초진(첫 내원·7.1 동적)
_CONSULT_AMOUNT = "12590"  # 재진(과거 완료 내원 보유)
_EXAM_IMAGING_AMOUNT = "9030"
_TRT_AMOUNT = "4500"


# ── 픽스처: 시드 직원 uid ──────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def admin_id(psql: Psql) -> str:
    """admin uid — 0021 부트 grant(fee_item.read) + 0002 전권."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'admin' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def doctor_id(psql: Psql) -> str:
    """doctor uid — seed(4.4)로 encounter.start 보유(start_consult) + seed(5.10) fee_item.read 보유.

    진찰료 적재(진찰 시작=호출자) + RLS 직원 가시 기준. auth.users 실재(FK)."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'doctor' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def nurse_id(psql: Psql) -> str:
    """nurse uid — seed(5.1) examination.perform/treatment.perform 보유(수행 RPC).

    ⚠️ fee_item.read 미보유 → fee_items RLS 직원 정책 false(403 baseline) + self 임퍼소네이터."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'nurse' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def reception_id(psql: Psql) -> str:
    """reception uid — seed(5.10) fee_item.read 보유(수납 정산). RLS 직원 가시 기준."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'reception' limit 1"
    ).lower()


# ── SQL 조각 헬퍼(test_orders_db 미러) ────────────────────────────────────────


def _patient_sql(pid: str, *, auth_uid: str | None = None) -> str:
    """dummy 환자 1행 INSERT(postgres 컨텍스트). resident_no_hash 는 pid 로 고유 보장."""
    auth = f"'{auth_uid}'" if auth_uid else "null"
    return (
        "insert into public.patients(id, name, birth_date, sex, resident_no_enc, "
        "resident_no_hash, resident_no_masked, insurance_type, auth_uid) values "
        f"('{pid}','수가TEST','1990-01-01','male','\\x00'::bytea,"
        f"'__enc_{pid}__','900101-1******','health_insurance',{auth});"
    )


def _encounter_sql(eid: str, pid: str, *, status: str = "registered") -> str:
    """수가를 매달 내원 1행(기본 registered — 진찰 시작 전 상태)."""
    return (
        "insert into public.encounters(id, patient_id, department_id, visit_type, status) "
        f"values ('{eid}','{pid}',{_DEPT},'walk_in','{status}');"
    )


def _exam_sql(xid: str, eid: str, by: str, *, exam_type: str = "imaging") -> str:
    return (
        "insert into public.examinations"
        "(id, encounter_id, exam_type, fee_schedule_id, status, ordered_by) "
        f"values ('{xid}','{eid}','{exam_type}',{_FEE_EXAM[exam_type]},'ordered','{by}');"
    )


def _trt_sql(tid: str, eid: str, by: str) -> str:
    return (
        "insert into public.treatment_orders"
        "(id, encounter_id, fee_schedule_id, status, ordered_by) "
        f"values ('{tid}','{eid}',{_FEE_TRT},'ordered','{by}');"
    )


def _rx_sql(rid: str, eid: str, by: str) -> str:
    return (
        "insert into public.prescriptions(id, encounter_id, status, ordered_by) "
        f"values ('{rid}','{eid}','issued','{by}');"
    )


def _claims(uid: str) -> str:
    """RPC 권한 평가 + 감사 actor GUC 주입(SECURITY DEFINER RPC 가 auth.uid/has_permission 읽음)."""
    claims = '{"sub":"' + uid + '","role":"authenticated"}'
    return (
        "select set_config('request.jwt.claims', '" + claims + "', true);"
        "select set_config('app.actor_id', '" + uid + "', true);"
    )


def _as_authenticated(uid: str) -> str:
    """RLS 검증용 — authenticated 역할 전환 + JWT 주체 GUC(정책 auth.uid()/has_permission 평가)."""
    claims = '{"sub":"' + uid + '","role":"authenticated"}'
    return (
        "set local role authenticated;"
        "select set_config('request.jwt.claims', '" + claims + "', true);"
    )


def _start_consult(eid: str, doctor: str) -> str:
    """진찰 시작 RPC(registered→in_progress) — 진찰료 트리거 발화. doctor=encounter.start 보유."""
    return _claims(doctor) + "select public.start_consult('" + eid + "');"


def _primary_diagnosis_sql(eid: str, recorded_by: str) -> str:
    """주상병 1개 부착(postgres) — complete_encounter 게이트(주상병 미지정 PT422) 충족(4.7).

    시드 KCD I10 참조. test_encounters_db._primary_diagnosis_sql 미러."""
    return (
        "insert into public.encounter_diagnoses"
        "(encounter_id, diagnosis_id, is_primary, recorded_by) "
        "select '" + eid + "', d.id, true, '" + recorded_by + "' "
        "from public.diagnoses d where lower(d.code)='i10' limit 1;"
    )


def _prior_completed_encounter(pid: str, eid: str, doctor: str) -> str:
    """과거 완료 내원 1건(full RPC 체인: registered→in_progress→completed) — 재진 판정용 이력.

    start_consult 가 이 내원에 초진료 적재(이 시점 이력 0=초진)하나 재진은 *새* 내원만 카운트.
    종결 게이트(주상병)는 I10 부착으로 충족. doctor=encounter.start/complete 보유(seed 4.4/4.7)."""
    return (
        _encounter_sql(eid, pid, status="registered")
        + _start_consult(eid, doctor)
        + _primary_diagnosis_sql(eid, doctor)
        + _claims(doctor)
        + "select public.complete_encounter('"
        + eid
        + "');"
    )


def _perform_exam(xid: str, nurse: str) -> str:
    """검사 수행 RPC(ordered→performed) — 검사료 트리거 발화. nurse=examination.perform 보유."""
    return _claims(nurse) + "select public.perform_examination('" + xid + "');"


def _perform_trt(tid: str, nurse: str) -> str:
    """처치 수행 RPC(ordered→performed) — 처치료 트리거 발화. nurse=treatment.perform 보유."""
    return _claims(nurse) + "select public.perform_treatment_order('" + tid + "');"


def _insert_fee_item(eid: str, fee_sql: str, source_type: str, source_id: str) -> str:
    """적재 헬퍼 직접 호출(postgres 컨텍스트) — 멱등·스냅샷 검증용."""
    return (
        "select public.insert_fee_item('"
        + eid
        + "',"
        + fee_sql
        + ",'"
        + source_type
        + "','"
        + source_id
        + "');"
    )


def _assert_sqlstate(psql: Psql, *, setup: str, op: str, sqlstate: str) -> None:
    """`op`(plpgsql 문장)이 정확히 `sqlstate` 로 실패하는지 단언(test_orders_db 동형)."""
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
    """psql 출력에서 'V:' 태그 줄 추출(RPC 합성행 출력과 구분)."""
    lines = [ln.strip() for ln in out.splitlines() if ln.strip().startswith("V:")]
    assert lines, f"verdict 줄 없음: {out!r}"
    return lines[-1][2:]


# ── AC1·AC2: 테이블·CHECK·unique 존재 ─────────────────────────────────────────


def test_billing_tables_exist(psql: Psql):
    """fee_items·fee_mappings 테이블 + 멱등 unique 제약 존재."""
    out = psql.scalar(
        "select 'V:fi='||(to_regclass('public.fee_items') is not null)::text"
        "||'|fm='||(to_regclass('public.fee_mappings') is not null)::text"
        "||'|uq='||(exists(select 1 from pg_constraint "
        "  where conrelid='public.fee_items'::regclass and contype='u'))::text;"
    )
    assert _verdict(out) == "fi=true|fm=true|uq=true", out


def test_fee_item_source_type_check(psql: Psql, admin_id: str):
    """잘못된 source_type 직접 INSERT → CHECK 위반(23514)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    sid = str(uuid.uuid4())
    op = (
        "insert into public.fee_items"
        "(encounter_id, fee_schedule_id, source_type, source_id, "
        " unit_amount_krw, amount_krw, coverage_type) "
        f"values ('{eid}',{_FEE_CONSULT},'bogus','{sid}',100,100,'covered');"
    )
    _assert_sqlstate(
        psql, setup=_patient_sql(pid) + _encounter_sql(eid, pid), op=op, sqlstate="23514"
    )


def test_fee_item_negative_amount_check(psql: Psql, admin_id: str):
    """음수 amount_krw 직접 INSERT → CHECK 위반(23514)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    sid = str(uuid.uuid4())
    op = (
        "insert into public.fee_items"
        "(encounter_id, fee_schedule_id, source_type, source_id, "
        " unit_amount_krw, amount_krw, coverage_type) "
        f"values ('{eid}',{_FEE_CONSULT},'encounter','{sid}',-1,-1,'covered');"
    )
    _assert_sqlstate(
        psql, setup=_patient_sql(pid) + _encounter_sql(eid, pid), op=op, sqlstate="23514"
    )


def test_fee_item_unique_source_violation(psql: Psql, admin_id: str):
    """같은 (source_type, source_id) 직접 INSERT 2회(on conflict 없이) → unique 위반(23505)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    sid = str(uuid.uuid4())

    def _ins() -> str:
        return (
            "insert into public.fee_items"
            "(encounter_id, fee_schedule_id, source_type, source_id, "
            " unit_amount_krw, amount_krw, coverage_type) "
            f"values ('{eid}',{_FEE_CONSULT},'encounter','{sid}',100,100,'covered');"
        )

    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid) + _encounter_sql(eid, pid) + _ins(),
        op=_ins(),
        sqlstate="23505",
    )


def test_fee_mapping_source_event_check(psql: Psql):
    """fee_mappings 잘못된 source_event 직접 INSERT → CHECK 위반(23514)."""
    op = (
        "insert into public.fee_mappings(source_event, fee_schedule_id) "
        f"values ('bogus_event',{_FEE_CONSULT});"
    )
    _assert_sqlstate(psql, setup="", op=op, sqlstate="23514")


def test_fee_mapping_unique_active_source_event(psql: Psql):
    """활성 encounter_start 매핑은 source_event 당 1행만 — 2번째 활성 INSERT → unique 위반(23505).

    seed 가 이미 활성 encounter_start(AA254) 1행 → 부분 unique 인덱스가 다중 활성 매핑 차단
    (fee_on_encounter_start 의 limit 1 비결정성 방지)."""
    op = (
        "insert into public.fee_mappings(source_event, fee_schedule_id) "
        f"values ('encounter_start',{_FEE_CONSULT});"
    )
    _assert_sqlstate(psql, setup="", op=op, sqlstate="23505")


# ── AC3: 진찰료 자동 적재 ──────────────────────────────────────────────────────


def test_first_visit_accrues_initial_consult_fee(psql: Psql, doctor_id: str):
    """첫 내원(과거 완료 내원 0) → 초진 AA154(17610) 적재 — 7.1 초진/재진 동적 판정."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _start_consult(eid, doctor_id)
        + "select 'V:cnt='||count(*)::text"
        "||'|amt='||coalesce(max(amount_krw)::text,'-')"
        "||'|unit='||coalesce(max(unit_amount_krw)::text,'-')"
        "||'|qty='||coalesce(max(quantity)::text,'-')"
        "||'|cat='||coalesce(max(category),'-')"
        "||'|cov='||coalesce(max(coverage_type),'-')"
        "||'|src='||coalesce(max(source_type),'-')"
        "||'|sid='||coalesce(bool_and(source_id='" + eid + "'),false)::text "
        "  from public.fee_items where encounter_id='" + eid + "';"
        "rollback;"
    )
    assert (
        _verdict(out) == f"cnt=1|amt={_CONSULT_INITIAL_AMOUNT}|unit={_CONSULT_INITIAL_AMOUNT}|qty=1"
        "|cat=진찰료|cov=covered|src=encounter|sid=true"
    ), out


def test_repeat_visit_accrues_repeat_consult_fee(psql: Psql, doctor_id: str):
    """과거 완료 내원 보유 환자의 새 내원 → 재진 AA254(12590) 적재 — 7.1 초진/재진 동적 판정."""
    pid = str(uuid.uuid4())
    prior_eid, new_eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _prior_completed_encounter(pid, prior_eid, doctor_id)  # 과거 완료 내원 = 재진 근거
        + _encounter_sql(new_eid, pid)
        + _start_consult(new_eid, doctor_id)
        + "select 'V:cnt='||count(*)::text"
        "||'|amt='||coalesce(max(amount_krw)::text,'-')"
        "||'|cat='||coalesce(max(category),'-')"
        "||'|src='||coalesce(max(source_type),'-')"
        "||'|sid='||coalesce(bool_and(source_id='" + new_eid + "'),false)::text "
        "  from public.fee_items where encounter_id='" + new_eid + "';"
        "rollback;"
    )
    assert _verdict(out) == f"cnt=1|amt={_CONSULT_AMOUNT}|cat=진찰료|src=encounter|sid=true", out


def test_consult_start_no_mapping_is_noop(psql: Psql, doctor_id: str):
    """활성 진찰 매핑이 전부 없으면 진찰 시작해도 적재 0(no-op·예외 아님).

    7.1: 트리거가 initial/repeat 우선 후 encounter_start 폴백 → 세 매핑 모두 비활성화해야 no-op."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        # 활성 진찰 매핑 3종 모두 비활성화(트랜잭션 내·rollback 으로 복구)
        + "update public.fee_mappings set is_active=false where source_event in "
        "('encounter_start','encounter_start_initial','encounter_start_repeat');"
        + _start_consult(eid, doctor_id)
        + "select 'V:'||count(*)::text from public.fee_items where encounter_id='"
        + eid
        + "';"
        "rollback;"
    )
    assert _verdict(out) == "0", out


# ── AC4: 검사·영상 수가 자동 적재 ─────────────────────────────────────────────


def test_examination_perform_accrues_fee(psql: Psql, doctor_id: str, nurse_id: str):
    """검사 수행(ordered→performed) → 검사료 1행(examinations.fee_schedule_id 직접·금액 스냅샷)."""
    pid, eid, xid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _exam_sql(xid, eid, doctor_id, exam_type="imaging")
        + _perform_exam(xid, nurse_id)
        + "select 'V:cnt='||count(*)::text"
        "||'|amt='||coalesce(max(amount_krw)::text,'-')"
        "||'|src='||coalesce(max(source_type),'-')"
        "||'|sid='||coalesce(bool_and(source_id='" + xid + "'),false)::text "
        "  from public.fee_items where encounter_id='" + eid + "';"
        "rollback;"
    )
    assert _verdict(out) == f"cnt=1|amt={_EXAM_IMAGING_AMOUNT}|src=examination|sid=true", out


def test_examination_complete_no_additional_fee(psql: Psql, doctor_id: str, nurse_id: str):
    """판독 완료(performed→completed)는 추가 적재 없음 — 검사당 1행 유지(수가=수행 1회)."""
    pid, eid, xid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _exam_sql(xid, eid, doctor_id, exam_type="imaging")
        + _perform_exam(xid, nurse_id)
        + _claims(doctor_id)
        + "select public.complete_examination('"
        + xid
        + "');"
        + "select 'V:'||count(*)::text from public.fee_items where encounter_id='"
        + eid
        + "';"
        "rollback;"
    )
    assert _verdict(out) == "1", out


# ── AC5: 처치 수가 자동 적재 ──────────────────────────────────────────────────


def test_treatment_perform_accrues_fee(psql: Psql, doctor_id: str, nurse_id: str):
    """처치 수행(ordered→performed) → 처치료 1행(treatment_orders.fee_schedule_id 직접)."""
    pid, eid, tid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _trt_sql(tid, eid, doctor_id)
        + _perform_trt(tid, nurse_id)
        + "select 'V:cnt='||count(*)::text"
        "||'|amt='||coalesce(max(amount_krw)::text,'-')"
        "||'|src='||coalesce(max(source_type),'-')"
        "||'|sid='||coalesce(bool_and(source_id='" + tid + "'),false)::text "
        "  from public.fee_items where encounter_id='" + eid + "';"
        "rollback;"
    )
    assert _verdict(out) == f"cnt=1|amt={_TRT_AMOUNT}|src=treatment|sid=true", out


# ── AC6: 멱등 + 금액 스냅샷 불변 ──────────────────────────────────────────────


def test_insert_fee_item_idempotent(psql: Psql):
    """insert_fee_item 재호출(같은 source_type, source_id) → fee_items 1행(on conflict)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _insert_fee_item(eid, _FEE_CONSULT, "encounter", eid)
        + _insert_fee_item(eid, _FEE_CONSULT, "encounter", eid)  # 재호출
        + "select 'V:'||count(*)::text from public.fee_items "
        "  where source_type='encounter' and source_id='" + eid + "';"
        "rollback;"
    )
    assert _verdict(out) == "1", out


def test_fee_amount_snapshot_immutable(psql: Psql):
    """적재 후 fee_schedules.amount_krw 변경 → 기존 fee_item 금액 불변(청구 시점 고정)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _insert_fee_item(eid, _FEE_CONSULT, "encounter", eid)
        + "update public.fee_schedules set amount_krw=99999 where lower(code)='aa254';"
        + "select 'V:'||amount_krw::text from public.fee_items "
        "  where source_type='encounter' and source_id='" + eid + "';"
        "rollback;"
    )
    assert _verdict(out) == _CONSULT_AMOUNT, out


# ── AC4(7.1): 만료·비활성 수가 적재 제외 ──────────────────────────────────────


@pytest.mark.parametrize(
    "mutate",
    [
        "update public.fee_schedules set is_active=false where lower(code)='aa254';",
        "update public.fee_schedules set effective_to=current_date - 1 where lower(code)='aa254';",
        "update public.fee_schedules set effective_from=current_date+1 where lower(code)='aa254';",
    ],
    ids=["inactive", "expired", "not_yet_effective"],
)
def test_insert_fee_item_skips_non_current_fee(psql: Psql, mutate: str):
    """insert_fee_item 직접 호출: 비활성·만료·미발효 fee_schedule → 적재 0(현재 유효 술어·7.1)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + mutate
        + _insert_fee_item(eid, _FEE_CONSULT, "encounter", eid)
        + "select 'V:'||count(*)::text from public.fee_items where encounter_id='"
        + eid
        + "';"
        "rollback;"
    )
    assert _verdict(out) == "0", out


def test_expired_consult_fee_not_accrued_via_trigger(psql: Psql, doctor_id: str):
    """첫 내원 초진 대상 AA154 가 만료면 start_consult 해도 진찰료 적재 0(적재 시점 검증·7.1)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + "update public.fee_schedules set effective_to=current_date - 1 where lower(code)='aa154';"
        + _start_consult(eid, doctor_id)
        + "select 'V:'||count(*)::text from public.fee_items where encounter_id='"
        + eid
        + "';"
        "rollback;"
    )
    assert _verdict(out) == "0", out


# ── AC5(7.1): fee_items amount 정합 CHECK ──────────────────────────────────────


def test_fee_item_amount_calc_check(psql: Psql):
    """fee_items amount_krw <> quantity*unit_amount_krw 직접 INSERT → CHECK 위반(23514·7.1)."""
    pid, eid, sid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    op = (
        "insert into public.fee_items"
        "(encounter_id, fee_schedule_id, source_type, source_id, "
        " quantity, unit_amount_krw, amount_krw, coverage_type) "
        f"values ('{eid}',{_FEE_CONSULT},'encounter','{sid}',2,100,150,'covered');"  # 2*100=200≠150
    )
    _assert_sqlstate(
        psql, setup=_patient_sql(pid) + _encounter_sql(eid, pid), op=op, sqlstate="23514"
    )


# ── AC7: 약제비 미적재(약가 부재) ─────────────────────────────────────────────


def test_prescription_issue_accrues_no_fee(psql: Psql, admin_id: str):
    """처방 발행(issued) → fee_items 0(약제비 미적재 — drugs 약가 컬럼 부재)."""
    pid, eid, rid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _rx_sql(rid, eid, admin_id)
        + "select 'V:'||count(*)::text from public.fee_items where encounter_id='"
        + eid
        + "';"
        "rollback;"
    )
    assert _verdict(out) == "0", out


# ── AC8: RLS 경계 ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("role", ["doctor", "reception"])
def test_rls_staff_with_fee_item_read_sees_items(
    psql: Psql, doctor_id: str, reception_id: str, role: str
):
    """직원(fee_item.read=doctor/reception)은 RLS 직원 정책으로 fee_items 행을 받는다."""
    uid = doctor_id if role == "doctor" else reception_id
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _insert_fee_item(eid, _FEE_CONSULT, "encounter", eid)
        + _as_authenticated(uid)
        + "select 'V:'||(count(*)>=1)::text from public.fee_items;"
        "rollback;"
    )
    assert _verdict(out) == "true", out


def test_rls_nurse_without_fee_item_read_blocked(psql: Psql, nurse_id: str):
    """nurse(fee_item.read 미보유)는 직원 정책 false → 타인 내원 fee_items 비가시(403 baseline)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)  # auth_uid NULL(nurse 본인 아님)
        + _encounter_sql(eid, pid)
        + _insert_fee_item(eid, _FEE_CONSULT, "encounter", eid)
        + _as_authenticated(nurse_id)
        + "select 'V:'||count(*)::text from public.fee_items;"
        "rollback;"
    )
    assert _verdict(out) == "0", out


def test_rls_patient_sees_only_own_fee_items(psql: Psql, nurse_id: str):
    """환자 본인 내원 fee_items 만 가시 — nurse(fee_item.read 미보유)를 auth_uid 가장."""
    own_p, own_e = str(uuid.uuid4()), str(uuid.uuid4())
    oth_p, oth_e = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(own_p, auth_uid=nurse_id)
        + _encounter_sql(own_e, own_p)
        + _insert_fee_item(own_e, _FEE_CONSULT, "encounter", own_e)
        + _patient_sql(oth_p)  # auth_uid NULL(타인)
        + _encounter_sql(oth_e, oth_p)
        + _insert_fee_item(oth_e, _FEE_CONSULT, "encounter", oth_e)
        + _as_authenticated(nurse_id)
        + "select 'V:'||coalesce(bool_and(encounter_id='"
        + own_e
        + "'),false)::text"
        "||'|'||(count(*)=1)::text from public.fee_items;"
        "rollback;"
    )
    assert _verdict(out) == "true|true", out


def test_rls_fee_mappings_visible_to_authenticated(psql: Psql, nurse_id: str):
    """fee_mappings 는 전역 참조 — fee_item.read 없는 직원(nurse)도 authenticated 정책으로 본다."""
    out = psql.scalar(
        "begin;"
        + _as_authenticated(nurse_id)
        + "select 'V:'||(count(*)>=1)::text from public.fee_mappings "
        "  where source_event='encounter_start';"
        "rollback;"
    )
    assert _verdict(out) == "true", out


def test_rls_anon_cannot_select_fee_items(psql: Psql):
    """anon 은 fee_items SELECT 거부(revoke all + 쓰기/읽기 정책 미부여)."""
    err = psql.expect_error(
        "begin;set local role anon;select count(*) from public.fee_items;rollback;"
    )
    assert "permission denied" in err.lower() and "fee_items" in err.lower(), err


def test_insert_fee_item_execute_denied_for_authenticated(psql: Psql, nurse_id: str):
    """insert_fee_item(SECURITY DEFINER)은 authenticated 직접 호출 거부(42501) — 수가 위조 차단.

    PUBLIC EXECUTE 회수(0021)로 임의 직원이 SECURITY DEFINER 로 RLS 쓰기 정책을 우회해 임의 내원에
    위조 수가를 적재하는 경로를 봉쇄(0005 decrypt_sensitive·0012 reveal_rrn 동형 posture)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid) + _encounter_sql(eid, pid) + _as_authenticated(nurse_id),
        op=f"perform public.insert_fee_item('{eid}',{_FEE_CONSULT},'encounter','{eid}');",
        sqlstate="42501",
    )


# ── AC9: 적재 감사 ────────────────────────────────────────────────────────────


def test_fee_accrual_audited_with_actor(psql: Psql, doctor_id: str):
    """진찰료 적재(start_consult 호출자=doctor)가 actor 와 함께 audit_logs 에 create 기록."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _start_consult(eid, doctor_id)  # _claims(doctor) 포함 → actor=doctor
        + "select 'V:cnt='||count(*)::text"
        "||'|actor='||coalesce(bool_and(actor_id::text='" + doctor_id + "'),false)::text"
        "||'|act='||coalesce(max(action),'-')||'|tbl='||coalesce(max(target_table),'-') "
        "  from public.audit_logs where target_table='fee_items' and target_id in "
        "  (select id::text from public.fee_items where encounter_id='" + eid + "');"
        "rollback;"
    )
    v = _verdict(out)
    assert v == "cnt=1|actor=true|act=create|tbl=fee_items", out
