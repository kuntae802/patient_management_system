"""오더-by-내원상태 게이트(Story 7.10) DB 레벨 통합 테스트 — psql 직접(0053).

순수 DB 스토리: FastAPI 미경유. 종결(completed/cancelled/no_show)·soft-deleted 내원에
오더 생성·수행이 차단되는지(PT409), 비종결(registered/in_progress) 내원엔 통과하는지,
complete_examination(판독)은 게이트가 없는지 단언. test_orders_db 미러. 미실행 시 skip.

검증(AC 매핑):
  · AC2: assert_encounter_orderable 가드 — 미존재 PT404·soft-deleted/종결 PT409.
  · AC3: 오더 생성 BEFORE INSERT 게이트 — 종결/inactive 내원 INSERT 차단·비종결 통과.
  · AC4: perform RPC 게이트 — 종결 내원 perform 차단 → fee 미적재(L346). complete 비게이트.

게이트 = 종결·soft-deleted 차단(NOT 비-in_progress) — registered 는 워크리스트 노출 대상.
begin/rollback 격리. perform/complete 액터=admin(전권 — 게이트는 내원상태만).
"""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import Psql

_DEPT = "(select id from public.departments where lower(code) = 'im' limit 1)"
_FEE_IMG = "(select id from public.fee_schedules where lower(code)='ha201' limit 1)"
_FEE_TRT = "(select id from public.fee_schedules where lower(code)='m0030' limit 1)"


@pytest.fixture(scope="module")
def admin_id(psql: Psql) -> str:
    """admin uid — 부트 grant 전권(perform/complete). 게이트는 내원상태만 검증."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'admin' limit 1"
    ).lower()


# ── SQL 조각 헬퍼 (test_orders_db 미러) ────────────────────────────────────────


def _patient_sql(pid: str) -> str:
    return (
        "insert into public.patients(id, name, birth_date, sex, resident_no_enc, "
        "resident_no_hash, resident_no_masked, insurance_type, auth_uid) values "
        f"('{pid}','게이트TEST','1990-01-01','male','\\x00'::bytea,"
        f"'__enc_{pid}__','900101-1******','health_insurance',null);"
    )


def _encounter_sql(eid: str, pid: str, *, status: str = "registered") -> str:
    """내원 1행 — 초기 상태는 scheduled/registered 만 허용(0010 INSERT 가드)."""
    return (
        "insert into public.encounters(id, patient_id, department_id, visit_type, status) "
        f"values ('{eid}','{pid}',{_DEPT},'walk_in','{status}');"
    )


def _set_status(eid: str, status: str) -> str:
    """내원 상태 전이(raw UPDATE — 전이 트리거가 합법성 검증). 종결 상태 셋업용."""
    return f"update public.encounters set status='{status}' where id='{eid}';"


def _soft_delete(eid: str) -> str:
    return f"update public.encounters set is_active=false where id='{eid}';"


def _exam_sql(xid: str, eid: str, by: str) -> str:
    return (
        "insert into public.examinations"
        "(id, encounter_id, exam_type, fee_schedule_id, status, ordered_by) "
        f"values ('{xid}','{eid}','imaging',{_FEE_IMG},'ordered','{by}');"
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
    claims = '{"sub":"' + uid + '","role":"authenticated"}'
    return (
        "select set_config('request.jwt.claims', '" + claims + "', true);"
        "select set_config('app.actor_id', '" + uid + "', true);"
    )


def _assert_sqlstate(
    psql: Psql, *, setup: str, op: str, sqlstate: str, claims_uid: str | None = None
) -> None:
    """`op` 가 정확히 `sqlstate` 로 실패하는지 단언(test_orders_db 동형)."""
    script = (
        "begin;" + setup + (_claims(claims_uid) if claims_uid else "") + "do $$ begin "
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


def _assert_ok(psql: Psql, *, setup: str, op: str, claims_uid: str | None = None) -> None:
    """`setup`+`op` 가 성공(returncode 0)하는지 단언. begin/rollback 격리."""
    script = "begin;" + setup + (_claims(claims_uid) if claims_uid else "") + op + "rollback;"
    proc = psql.run(script)
    assert proc.returncode == 0, f"성공 기대했으나 실패: {proc.stderr.strip()}"


# ── AC2: 가드 함수 — 미존재 PT404 ──────────────────────────────────────────────


def test_guard_not_found_raises_pt404(psql: Psql):
    """assert_encounter_orderable(미존재 uuid) → PT404."""
    _assert_sqlstate(
        psql,
        setup="",
        op=f"perform public.assert_encounter_orderable('{uuid.uuid4()}');",
        sqlstate="PT404",
    )


# ── AC3: 오더 생성 게이트 ──────────────────────────────────────────────────────


@pytest.mark.parametrize("status", ["registered", "in_progress"])
def test_order_creation_allowed_on_active_nonterminal(psql: Psql, admin_id: str, status: str):
    """비종결(registered/in_progress) 내원엔 검사·처치·처방 생성 통과(워크리스트 플로우 보존)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    setup = _patient_sql(pid) + _encounter_sql(eid, pid)
    if status == "in_progress":
        setup += _set_status(eid, "in_progress")
    _assert_ok(psql, setup=setup, op=_exam_sql(str(uuid.uuid4()), eid, admin_id))
    _assert_ok(psql, setup=setup, op=_trt_sql(str(uuid.uuid4()), eid, admin_id))
    _assert_ok(psql, setup=setup, op=_rx_sql(str(uuid.uuid4()), eid, admin_id))


def test_exam_creation_blocked_on_completed(psql: Psql, admin_id: str):
    """completed 내원에 검사 오더 생성 INSERT → PT409(게이트)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    setup = (
        _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _set_status(eid, "in_progress")
        + _set_status(eid, "completed")
    )
    _assert_sqlstate(
        psql, setup=setup, op=_exam_sql(str(uuid.uuid4()), eid, admin_id), sqlstate="PT409"
    )


def test_treatment_creation_blocked_on_cancelled(psql: Psql, admin_id: str):
    """cancelled 내원에 처치 오더 생성 INSERT → PT409(게이트)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    setup = _patient_sql(pid) + _encounter_sql(eid, pid) + _set_status(eid, "cancelled")
    _assert_sqlstate(
        psql, setup=setup, op=_trt_sql(str(uuid.uuid4()), eid, admin_id), sqlstate="PT409"
    )


def test_prescription_creation_blocked_on_no_show(psql: Psql, admin_id: str):
    """no_show 내원에 처방 생성 INSERT → PT409(게이트). no_show 는 scheduled 에서만 전이 가능."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    setup = (
        _patient_sql(pid)
        + _encounter_sql(eid, pid, status="scheduled")
        + _set_status(eid, "no_show")
    )
    _assert_sqlstate(
        psql, setup=setup, op=_rx_sql(str(uuid.uuid4()), eid, admin_id), sqlstate="PT409"
    )


def test_exam_creation_blocked_on_soft_deleted(psql: Psql, admin_id: str):
    """soft-deleted(is_active=false) 내원에 검사 오더 생성 INSERT → PT409(게이트)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    setup = _patient_sql(pid) + _encounter_sql(eid, pid) + _soft_delete(eid)
    _assert_sqlstate(
        psql, setup=setup, op=_exam_sql(str(uuid.uuid4()), eid, admin_id), sqlstate="PT409"
    )


# ── AC4: 오더 수행 게이트 ──────────────────────────────────────────────────────


def test_perform_examination_allowed_on_in_progress(psql: Psql, admin_id: str):
    """in_progress 내원의 ordered 검사 수행 통과(정상 경로)."""
    pid, eid, xid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    setup = (
        _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _set_status(eid, "in_progress")
        + _exam_sql(xid, eid, admin_id)
    )
    _assert_ok(
        psql, setup=setup, op=f"select public.perform_examination('{xid}');", claims_uid=admin_id
    )


def test_perform_examination_blocked_on_completed(psql: Psql, admin_id: str):
    """in_progress 에 검사 지시 후 내원 완료 → 검사 수행 → PT409(게이트·정산 후 변조 차단)."""
    pid, eid, xid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    setup = (
        _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _set_status(eid, "in_progress")
        + _exam_sql(xid, eid, admin_id)  # ordered (in_progress 게이트 통과)
        + _set_status(eid, "completed")
    )
    _assert_sqlstate(
        psql,
        setup=setup,
        op=f"perform public.perform_examination('{xid}');",
        sqlstate="PT409",
        claims_uid=admin_id,
    )


def test_perform_treatment_blocked_on_completed(psql: Psql, admin_id: str):
    """in_progress 에 처치 지시 후 내원 완료 → 처치 수행 → PT409(게이트)."""
    pid, eid, tid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    setup = (
        _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _set_status(eid, "in_progress")
        + _trt_sql(tid, eid, admin_id)
        + _set_status(eid, "completed")
    )
    _assert_sqlstate(
        psql,
        setup=setup,
        op=f"perform public.perform_treatment_order('{tid}');",
        sqlstate="PT409",
        claims_uid=admin_id,
    )


def test_perform_blocked_on_completed_accrues_no_fee(psql: Psql, admin_id: str):
    """게이트가 종결 내원 수행을 차단 → 검사 수가(fee_item) 미적재(deferred L346 청산 검증).

    DO 블록 내부에서 perform=PT409 단언 + fee_items 카운트=0 단언(stdout 파싱 없이 견고)."""
    pid, eid, xid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    script = (
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _set_status(eid, "in_progress")
        + _exam_sql(xid, eid, admin_id)
        + _set_status(eid, "completed")
        + _claims(admin_id)
        + "do $$ declare v_cnt int; begin "
        f"  begin perform public.perform_examination('{xid}'); raise exception 'NO_ERROR_RAISED'; "
        "  exception when sqlstate 'PT409' then null; "
        "    when others then raise exception 'WRONG_SQLSTATE:%', sqlstate; end; "
        "  select count(*) into v_cnt from public.fee_items "
        f"   where encounter_id='{eid}' and source_type='examination'; "
        "  if v_cnt <> 0 then raise exception 'FEE_ACCRUED:%', v_cnt; end if; "
        "end $$;"
        "rollback;"
    )
    proc = psql.run(script)
    assert proc.returncode == 0, f"게이트 미작동(수행 비차단 또는 수가 적재): {proc.stderr.strip()}"


def test_complete_examination_not_gated_on_completed_encounter(psql: Psql, admin_id: str):
    """complete_examination(판독·performed→completed)은 게이트 없음 — 종결 내원도 통과(fee 0)."""
    pid, eid, xid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    setup = (
        _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _set_status(eid, "in_progress")
        + _exam_sql(xid, eid, admin_id)
        + _claims(admin_id)
        # ordered→performed (in_progress·게이트 통과)
        + f"select public.perform_examination('{xid}');"
        + _set_status(eid, "completed")
    )
    _assert_ok(
        psql, setup=setup, op=f"select public.complete_examination('{xid}');", claims_uid=admin_id
    )
