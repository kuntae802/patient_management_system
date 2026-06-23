"""오더 생명주기 상태머신(Story 5.1) DB 레벨 통합 테스트 — psql 직접(0015_orders).

순수 DB 스토리: FastAPI 미경유. 실 Supabase 로컬 db 컨테이너에 psql 로 붙어 유형별 상태머신·재수행
차단·권한·감사·RLS 를 단언한다. 컨테이너 미실행 시 skip(conftest). test_encounters_db 하니스 미러.

검증(AC 매핑):
  · AC1: 초기상태 가드(처방=issued / 검사·처치=ordered 만, 그 외 PT409) + 유효 초기 INSERT 성공
  · AC2: 전이 RPC 가 수행자/완료자·시각 분리 세팅(perform·complete·perform_treatment_order)
  · AC3: 합법 체인(ordered→performed→completed) + 불법 전이(역행·건너뛰기) → PT409
  · AC4: 재수행 차단 — performed 검사·처치에 perform 재호출 → PT409(소스상태 선검사, FR-093)
  · AC5: 권한 미보유(reception=오더 baseline / nurse=complete 미보유) RPC → 42501; 대상 없음 → PT404
  · AC6: 5개 테이블 INSERT(create)+전이(update)가 actor 와 함께 audit_logs 기록
  · AC7: RLS — 직원(order.read)=전체 / 환자=본인 오더만 / anon=거부 / equipment=authenticated

위생: 환자=dummy '\\x00'::bytea, 오더=시드 마스터(fee_schedules·drugs) 참조 psql 직접 INSERT.
전부 begin/rollback 격리(커밋 없음 → flaky 0). uuid 는 Python 이 부여.
"""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import Psql

_DEPT = "(select id from public.departments where lower(code) = 'im' limit 1)"
# 시드 마스터 참조(0007/2.5 seed) — 행위/약품은 마스터 FK 로만(free-text 차단).
# lab=C3800(CBC)·imaging=HA201(흉부촬영)·처치=M0030(드레싱)·약품=645100250(타이레놀).
_FEE = {
    "lab": "(select id from public.fee_schedules where lower(code)='c3800' limit 1)",
    "imaging": "(select id from public.fee_schedules where lower(code)='ha201' limit 1)",
}
_FEE_TRT = "(select id from public.fee_schedules where lower(code)='m0030' limit 1)"
_DRUG = "(select id from public.drugs where lower(code)='645100250' limit 1)"


# ── 픽스처: 시드 직원 uid ──────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def admin_id(psql: Psql) -> str:
    """admin uid — 0015 부트 grant(order.* 전권) + 0002 전권 — 성공 경로 기준."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'admin' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def doctor_id(psql: Psql) -> str:
    """doctor uid — seed(5.1)로 order.read/examination.complete 보유 + auth.users 실재(FK).

    complete_examination 성공(판독의=호출자) 검증 기준. examination.perform 은 미보유."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'doctor' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def nurse_id(psql: Psql) -> str:
    """nurse uid — seed(5.1) order.read/examination.perform/treatment.perform 보유(검체·처치 수행).

    examination.complete 미보유(판독 거부 검증) + auth.users 실재(FK)."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'nurse' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def reception_id(psql: Psql) -> str:
    """reception uid — 오더 권한 0(order-403 baseline, Story 5.1). encounter.* 만 보유.

    nurse 가 오더 권한을 받아 더 이상 무권한이 아니므로 reception 이 오더 RPC 권한 거부 baseline.
    order.read 미보유 → RLS 환자 self 임퍼소네이터로도 재사용(직원 정책 false → self 만)."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'reception' limit 1"
    ).lower()


# ── SQL 조각 헬퍼 ─────────────────────────────────────────────────────────────


def _patient_sql(pid: str, *, auth_uid: str | None = None) -> str:
    """dummy 환자 1행 INSERT(postgres 컨텍스트). resident_no_hash 는 pid 로 고유 보장."""
    auth = f"'{auth_uid}'" if auth_uid else "null"
    return (
        "insert into public.patients(id, name, birth_date, sex, resident_no_enc, "
        "resident_no_hash, resident_no_masked, insurance_type, auth_uid) values "
        f"('{pid}','오더TEST','1990-01-01','male','\\x00'::bytea,"
        f"'__enc_{pid}__','900101-1******','health_insurance',{auth});"
    )


def _encounter_sql(eid: str, pid: str) -> str:
    """오더를 매달 내원 1행(registered — 오더는 내원 상태를 게이트하지 않음, 5.1)."""
    return (
        "insert into public.encounters(id, patient_id, department_id, visit_type, status) "
        f"values ('{eid}','{pid}',{_DEPT},'walk_in','registered');"
    )


def _exam_sql(
    xid: str, eid: str, by: str, *, exam_type: str = "imaging", status: str = "ordered"
) -> str:
    return (
        "insert into public.examinations"
        "(id, encounter_id, exam_type, fee_schedule_id, status, ordered_by) "
        f"values ('{xid}','{eid}','{exam_type}',{_FEE[exam_type]},'{status}','{by}');"
    )


def _trt_sql(tid: str, eid: str, by: str, *, status: str = "ordered") -> str:
    return (
        "insert into public.treatment_orders"
        "(id, encounter_id, fee_schedule_id, status, ordered_by) "
        f"values ('{tid}','{eid}',{_FEE_TRT},'{status}','{by}');"
    )


def _rx_sql(rid: str, eid: str, by: str, *, status: str = "issued") -> str:
    return (
        "insert into public.prescriptions(id, encounter_id, status, ordered_by) "
        f"values ('{rid}','{eid}','{status}','{by}');"
    )


def _rxd_sql(did: str, rid: str) -> str:
    return (
        "insert into public.prescription_details"
        "(id, prescription_id, drug_id, dose, frequency, duration_days) "
        f"values ('{did}','{rid}',{_DRUG},1,'TID',3);"
    )


def _equipment_sql(qid: str, code: str) -> str:
    return (
        "insert into public.equipment(id, code, name, modality) "
        f"values ('{qid}','{code}','테스트촬영기','X-ray');"
    )


def _claims(uid: str) -> str:
    """RPC 권한 평가용 GUC 주입 — SECURITY DEFINER RPC 가 auth.uid()/has_permission 을 읽는다.

    role 전환 불요(연결 role 무관)."""
    claims = '{"sub":"' + uid + '","role":"authenticated"}'
    return (
        "select set_config('request.jwt.claims', '" + claims + "', true);"
        "select set_config('app.actor_id', '" + uid + "', true);"
    )


def _as_authenticated(uid: str) -> str:
    """RLS 검증용 — authenticated 역할 전환 + JWT 주체 GUC(정책 auth.uid() 평가)."""
    claims = '{"sub":"' + uid + '","role":"authenticated"}'
    return (
        "set local role authenticated;"
        "select set_config('request.jwt.claims', '" + claims + "', true);"
    )


def _seed_exam_to_status(
    xid: str,
    eid: str,
    by: str,
    status: str,
    *,
    perform_by: str,
    complete_by: str,
    exam_type: str = "imaging",
) -> str:
    """initial guard 때문에 performed/completed 는 합법 RPC 로 걸어서 만든다(perform/complete)."""
    s = _exam_sql(xid, eid, by, exam_type=exam_type)
    if status == "ordered":
        return s
    s += _claims(perform_by) + "select public.perform_examination('" + xid + "');"
    if status == "completed":
        s += _claims(complete_by) + "select public.complete_examination('" + xid + "');"
    return s


def _seed_trt_to_status(tid: str, eid: str, by: str, status: str, *, perform_by: str) -> str:
    s = _trt_sql(tid, eid, by)
    if status == "performed":
        s += _claims(perform_by) + "select public.perform_treatment_order('" + tid + "');"
    return s


def _assert_sqlstate(
    psql: Psql, *, setup: str, op: str, sqlstate: str, claims_uid: str | None = None
) -> None:
    """`op`(plpgsql 문장)이 정확히 `sqlstate` 로 실패하는지 단언(test_encounters_db 동형).

    DO 내부 sub-begin/exception 으로 sqlstate 직접 비교 → 일치 0, 불일치/미발생 raise."""
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


def _verdict(out: str) -> str:
    """psql 출력에서 'V:' 태그 줄 추출(RPC 합성행 출력과 구분)."""
    lines = [ln.strip() for ln in out.splitlines() if ln.strip().startswith("V:")]
    assert lines, f"verdict 줄 없음: {out!r}"
    return lines[-1][2:]


# ── AC1: 초기상태 가드 + 유효 초기 INSERT ──────────────────────────────────────


@pytest.mark.parametrize("bad", ["performed", "completed"])
def test_examination_initial_status_guard(psql: Psql, admin_id: str, bad: str):
    """검사 INSERT 초기상태는 ordered 만 — performed/completed 직접 INSERT → PT409."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid) + _encounter_sql(eid, pid),
        op=_exam_sql(str(uuid.uuid4()), eid, admin_id, status=bad),
        sqlstate="PT409",
    )


@pytest.mark.parametrize("bad", ["performed", "completed"])
def test_treatment_initial_status_guard(psql: Psql, admin_id: str, bad: str):
    """처치 INSERT 초기상태는 ordered 만 → PT409."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid) + _encounter_sql(eid, pid),
        op=_trt_sql(str(uuid.uuid4()), eid, admin_id, status=bad),
        sqlstate="PT409",
    )


def test_prescription_initial_status_guard(psql: Psql, admin_id: str):
    """처방 INSERT 초기상태는 issued 만 — dispensed 직접 INSERT → PT409."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid) + _encounter_sql(eid, pid),
        op=_rx_sql(str(uuid.uuid4()), eid, admin_id, status="dispensed"),
        sqlstate="PT409",
    )


def test_valid_initial_inserts_ok(psql: Psql, admin_id: str):
    """유효 초기 INSERT 성공: 처방=issued / 검사=ordered / 처치=ordered + 처방상세 라인."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    rid, did, xid, tid = (str(uuid.uuid4()) for _ in range(4))
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _rx_sql(rid, eid, admin_id)
        + _rxd_sql(did, rid)
        + _exam_sql(xid, eid, admin_id, exam_type="lab")
        + _trt_sql(tid, eid, admin_id)
        + "select 'V:rx='||(select status from public.prescriptions where id='"
        + rid
        + "')"
        "||'|rxd='||(select drug_id is not null from public.prescription_details where id='"
        + did
        + "')::text"
        "||'|ex='||(select status from public.examinations where id='" + xid + "')"
        "||'|trt='||(select status from public.treatment_orders where id='" + tid + "');"
        "rollback;"
    )
    assert _verdict(out) == "rx=issued|rxd=true|ex=ordered|trt=ordered", out


# ── AC2·AC3: 합법 전이 체인 + 수행자/완료자 분리 ──────────────────────────────


def test_examination_legal_chain(psql: Psql, nurse_id: str, doctor_id: str):
    """검사 ordered→performed(간호)→completed(의사) + 수행자·완료자·시각 분리 세팅(FR-080)."""
    pid, eid, xid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _exam_sql(xid, eid, doctor_id)  # 지시자=doctor
        + _claims(nurse_id)
        + "select public.perform_examination('"
        + xid
        + "');"
        + _claims(doctor_id)
        + "select public.complete_examination('"
        + xid
        + "');"
        + "select 'V:'||status"
        "||'|perf='||(performed_by::text='"
        + nurse_id
        + "')::text||'|pat='||(performed_at is not null)::text"
        "||'|comp='||(completed_by::text='"
        + doctor_id
        + "')::text||'|cat='||(completed_at is not null)::text "
        "  from public.examinations where id='" + xid + "';"
        "rollback;"
    )
    assert _verdict(out) == "completed|perf=true|pat=true|comp=true|cat=true", out


def test_treatment_legal_perform(psql: Psql, nurse_id: str, doctor_id: str):
    """처치 ordered→performed(간호) + 수행자·시각 세팅."""
    pid, eid, tid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _trt_sql(tid, eid, doctor_id)
        + _claims(nurse_id)
        + "select public.perform_treatment_order('"
        + tid
        + "');"
        + "select 'V:'||status||'|perf='||(performed_by::text='"
        + nurse_id
        + "')::text"
        "||'|pat='||(performed_at is not null)::text from public.treatment_orders where id='"
        + tid
        + "';"
        "rollback;"
    )
    assert _verdict(out) == "performed|perf=true|pat=true", out


def test_prescription_dispense_transition_allowed(psql: Psql, admin_id: str):
    """처방 issued→dispensed 직접 update 는 매트릭스 허용(dispense=Epic 7 예약 어휘)."""
    pid, eid, rid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _rx_sql(rid, eid, admin_id)
        + "update public.prescriptions set status='dispensed' where id='"
        + rid
        + "';"
        + "select 'V:'||status from public.prescriptions where id='"
        + rid
        + "';"
        "rollback;"
    )
    assert _verdict(out) == "dispensed", out


# ── AC3: 불법 전이(직접 update + 잘못된 RPC) → PT409 ───────────────────────────

# 검사·처치 공용 매트릭스(ordered→performed→completed) 외 전이.
_ILLEGAL_ACT = [
    ("ordered", "completed"),  # 건너뛰기
    ("performed", "ordered"),  # 역행
    ("completed", "performed"),  # 역행
    ("completed", "ordered"),  # 역행
]


@pytest.mark.parametrize("frm,to", _ILLEGAL_ACT)
def test_illegal_examination_direct_update(
    psql: Psql, admin_id: str, nurse_id: str, doctor_id: str, frm: str, to: str
):
    """검사 직접 update(서비스롤/트리거 우회 시도)도 매트릭스 외면 PT409."""
    pid, eid, xid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _seed_exam_to_status(
            xid, eid, doctor_id, frm, perform_by=nurse_id, complete_by=doctor_id
        ),
        op="update public.examinations set status='" + to + "' where id='" + xid + "';",
        sqlstate="PT409",
    )


def test_prescription_reverse_transition_blocked(psql: Psql, admin_id: str):
    """처방 dispensed→issued 역행 직접 update → PT409."""
    pid, eid, rid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _rx_sql(rid, eid, admin_id)
        + "update public.prescriptions set status='dispensed' where id='"
        + rid
        + "';",
        op="update public.prescriptions set status='issued' where id='" + rid + "';",
        sqlstate="PT409",
    )


def test_wrong_rpc_complete_before_perform(psql: Psql, admin_id: str, doctor_id: str):
    """ordered 검사에 complete_examination(수행 건너뛰기) → PT409(RPC 소스 선검사)."""
    pid, eid, xid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid) + _encounter_sql(eid, pid) + _exam_sql(xid, eid, admin_id),
        op="perform public.complete_examination('" + xid + "');",
        sqlstate="PT409",
        claims_uid=doctor_id,
    )


# ── AC4: 재수행 차단(FR-093) ──────────────────────────────────────────────────


def test_reexecution_block_examination(psql: Psql, admin_id: str, nurse_id: str, doctor_id: str):
    """이미 performed 인 검사에 perform_examination 재호출 → PT409(소스상태 ordered 선검사)."""
    pid, eid, xid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _seed_exam_to_status(
            xid, eid, doctor_id, "performed", perform_by=nurse_id, complete_by=doctor_id
        ),
        op="perform public.perform_examination('" + xid + "');",
        sqlstate="PT409",
        claims_uid=nurse_id,
    )


def test_reexecution_block_treatment(psql: Psql, admin_id: str, nurse_id: str, doctor_id: str):
    """이미 performed 인 처치에 perform_treatment_order 재호출 → PT409."""
    pid, eid, tid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _seed_trt_to_status(tid, eid, doctor_id, "performed", perform_by=nurse_id),
        op="perform public.perform_treatment_order('" + tid + "');",
        sqlstate="PT409",
        claims_uid=nurse_id,
    )


def test_reexecution_block_complete_examination(psql: Psql, nurse_id: str, doctor_id: str):
    """이미 completed 인 검사에 complete_examination 재호출 → PT409(소스상태 performed 선검사).

    perform 재실행 차단과 대칭 — 완료 단계도 재수행 불가(FR-093)."""
    pid, eid, xid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _seed_exam_to_status(
            xid, eid, doctor_id, "completed", perform_by=nurse_id, complete_by=doctor_id
        ),
        op="perform public.complete_examination('" + xid + "');",
        sqlstate="PT409",
        claims_uid=doctor_id,
    )


# ── AC5: 권한 게이트 + not-found ──────────────────────────────────────────────


def test_perform_examination_denied_for_reception(psql: Psql, admin_id: str, reception_id: str):
    """examination.perform 미보유(reception=오더 baseline) → insufficient_privilege(42501 → 403)."""
    pid, eid, xid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid) + _encounter_sql(eid, pid) + _exam_sql(xid, eid, admin_id),
        op="perform public.perform_examination('" + xid + "');",
        sqlstate="42501",
        claims_uid=reception_id,
    )


def test_complete_examination_denied_for_nurse(
    psql: Psql, admin_id: str, nurse_id: str, doctor_id: str
):
    """examination.complete 미보유(nurse 는 perform 만) → 42501. 판독은 의사 전용(최소권한)."""
    pid, eid, xid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _seed_exam_to_status(
            xid, eid, doctor_id, "performed", perform_by=nurse_id, complete_by=doctor_id
        ),
        op="perform public.complete_examination('" + xid + "');",
        sqlstate="42501",
        claims_uid=nurse_id,
    )


def test_perform_treatment_denied_for_reception(psql: Psql, admin_id: str, reception_id: str):
    """treatment.perform 미보유(reception) → 42501."""
    pid, eid, tid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid) + _encounter_sql(eid, pid) + _trt_sql(tid, eid, admin_id),
        op="perform public.perform_treatment_order('" + tid + "');",
        sqlstate="42501",
        claims_uid=reception_id,
    )


@pytest.mark.parametrize(
    "rpc", ["perform_examination", "complete_examination", "perform_treatment_order"]
)
def test_rpc_not_found(psql: Psql, admin_id: str, rpc: str):
    """존재하지 않는 오더 RPC → PT404."""
    _assert_sqlstate(
        psql,
        setup="",
        op="perform public." + rpc + "('" + str(uuid.uuid4()) + "');",
        sqlstate="PT404",
        claims_uid=admin_id,
    )


# ── AC6: 전이 감사 ────────────────────────────────────────────────────────────


def test_orders_audited_with_actor(psql: Psql, admin_id: str, nurse_id: str):
    """5개 테이블 INSERT(create=admin actor) + 검사 전이(update=nurse actor) 가 audit_logs 기록."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    rid, did, xid, tid, qid = (str(uuid.uuid4()) for _ in range(5))
    code = "TEST-" + xid[:8]
    out = psql.scalar(
        "begin;"
        + _claims(admin_id)  # create actor 보장
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _equipment_sql(qid, code)
        + _rx_sql(rid, eid, admin_id)
        + _rxd_sql(did, rid)
        + _exam_sql(xid, eid, admin_id)
        + _trt_sql(tid, eid, admin_id)
        + _claims(nurse_id)  # 전이 actor = nurse
        + "select public.perform_examination('"
        + xid
        + "');"
        + "select 'V:tables='||count(distinct target_table)::text"
        "||'|exupd='||(count(*) filter (where target_table='examinations'"
        " and action='update'))::text"
        "||'|cactor='||coalesce(bool_and(actor_id::text='"
        + admin_id
        + "') filter (where action='create'),false)::text"
        "||'|uactor='||coalesce(bool_and(actor_id::text='" + nurse_id + "') "
        "  filter (where action='update' and target_table='examinations'),false)::text "
        "  from public.audit_logs where target_id in "
        "('" + qid + "','" + rid + "','" + did + "','" + xid + "','" + tid + "');"
        "rollback;"
    )
    v = _verdict(out)
    assert "tables=5" in v and "cactor=true" in v and "uactor=true" in v, v
    assert int(v.split("exupd=")[1].split("|")[0]) >= 1, v


# ── AC7: RLS 경계 ─────────────────────────────────────────────────────────────


def test_rls_staff_with_order_read_sees_orders(psql: Psql, admin_id: str, doctor_id: str):
    """직원(order.read=doctor)은 RLS 직원 정책으로 오더 행(처방·검사·처치)을 받는다."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    rid, xid, tid = (str(uuid.uuid4()) for _ in range(3))
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _rx_sql(rid, eid, admin_id)
        + _exam_sql(xid, eid, admin_id)
        + _trt_sql(tid, eid, admin_id)
        + _as_authenticated(doctor_id)
        + "select 'V:rx='||(select count(*)>=1 from public.prescriptions)::text"
        "||'|ex='||(select count(*)>=1 from public.examinations)::text"
        "||'|trt='||(select count(*)>=1 from public.treatment_orders)::text;"
        "rollback;"
    )
    assert _verdict(out) == "rx=true|ex=true|trt=true", out


def test_rls_patient_sees_only_own_orders(psql: Psql, admin_id: str, reception_id: str):
    """환자 본인 내원 오더만 가시 — reception(order.read 미보유 → 직원 정책 false → self 정책만).

    reception 을 auth_uid 가장(own 환자)으로 — 본인 내원 검사만, 타인 내원 검사 비가시."""
    own_p, own_e, own_x = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    oth_p, oth_e, oth_x = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(own_p, auth_uid=reception_id)
        + _encounter_sql(own_e, own_p)
        + _exam_sql(own_x, own_e, admin_id)
        + _patient_sql(oth_p)  # auth_uid NULL(타인)
        + _encounter_sql(oth_e, oth_p)
        + _exam_sql(oth_x, oth_e, admin_id)
        + _as_authenticated(reception_id)
        + "select 'V:'||coalesce(bool_and(id::text='"
        + own_x
        + "'),false)::text"
        "||'|'||(count(*)=1)::text from public.examinations;"
        "rollback;"
    )
    assert _verdict(out) == "true|true", out


def test_rls_patient_sees_only_own_prescription_details(
    psql: Psql, admin_id: str, reception_id: str
):
    """환자 본인 처방의 상세 라인만 가시 — prescription_details self 정책 3홉 조인 검증.

    상세→처방→내원→환자→auth_uid. reception(order.read 미보유) 가장 — 본인 라인만, 타인 비가시."""
    own_p, own_e, own_r, own_d = (str(uuid.uuid4()) for _ in range(4))
    oth_p, oth_e, oth_r, oth_d = (str(uuid.uuid4()) for _ in range(4))
    out = psql.scalar(
        "begin;"
        + _patient_sql(own_p, auth_uid=reception_id)
        + _encounter_sql(own_e, own_p)
        + _rx_sql(own_r, own_e, admin_id)
        + _rxd_sql(own_d, own_r)
        + _patient_sql(oth_p)  # auth_uid NULL(타인)
        + _encounter_sql(oth_e, oth_p)
        + _rx_sql(oth_r, oth_e, admin_id)
        + _rxd_sql(oth_d, oth_r)
        + _as_authenticated(reception_id)
        + "select 'V:'||coalesce(bool_and(id::text='"
        + own_d
        + "'),false)::text"
        "||'|'||(count(*)=1)::text from public.prescription_details;"
        "rollback;"
    )
    assert _verdict(out) == "true|true", out


def test_rls_equipment_visible_to_authenticated(psql: Psql, reception_id: str):
    """equipment 는 전역 참조 — order.read 없는 직원(reception)도 authenticated 정책으로 본다."""
    out = psql.scalar(
        "begin;"
        + _as_authenticated(reception_id)
        + "select 'V:'||(count(*) >= 1)::text from public.equipment;"
        "rollback;"
    )
    assert _verdict(out) == "true", out


def test_rls_anon_cannot_select_orders(psql: Psql):
    """anon 은 오더 SELECT 거부(revoke all + 쓰기/읽기 정책 미부여)."""
    err = psql.expect_error(
        "begin;set local role anon;select count(*) from public.prescriptions;rollback;"
    )
    assert "permission denied" in err.lower() and "prescriptions" in err.lower(), err


# ── Story 7.7: 원외처방전 발급(dispense)·내보내기 감사 RPC (0050) ───────────────────
# reception 은 0050/seed 로 prescription.dispense 보유(발급 직무·FR-115) — 발행(create)·조회는
# baseline 403 은 비중첩 유지. nurse 는 dispense 미보유(거부 baseline).


def test_dispense_prescription_rpc_transition(psql: Psql, admin_id: str, reception_id: str):
    """dispense_prescription RPC(reception): issued→dispensed + dispensed_at + 전이 감사."""
    pid, eid, rid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _rx_sql(rid, eid, admin_id)
        + _claims(reception_id)
        + "select public.dispense_prescription('"
        + rid
        + "');"
        + "select 'V:'||status||'|d='||(dispensed_at is not null)::text"
        "||'|aud='||(exists (select 1 from public.audit_logs where target_id='"
        + rid
        + "' and action='update' and actor_id::text='"
        + reception_id
        + "'))::text from public.prescriptions where id='"
        + rid
        + "';"
        "rollback;"
    )
    assert _verdict(out) == "dispensed|d=true|aud=true", out


def test_dispense_prescription_already_dispensed_409(psql: Psql, admin_id: str, reception_id: str):
    """이미 dispensed 인 처방 재발급 → PT409(비가역 1방향·소스상태 issued 선검사)."""
    pid, eid, rid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _rx_sql(rid, eid, admin_id)
        + _claims(reception_id)
        + "select public.dispense_prescription('"
        + rid
        + "');",
        op="perform public.dispense_prescription('" + rid + "');",
        sqlstate="PT409",
        claims_uid=reception_id,
    )


def test_dispense_prescription_not_found_404(psql: Psql, reception_id: str):
    """존재하지 않는 처방 발급 → PT404."""
    _assert_sqlstate(
        psql,
        setup="",
        op="perform public.dispense_prescription('" + str(uuid.uuid4()) + "');",
        sqlstate="PT404",
        claims_uid=reception_id,
    )


def test_dispense_prescription_denied_for_nurse(psql: Psql, admin_id: str, nurse_id: str):
    """prescription.dispense 미보유(nurse=order.read 만) → insufficient_privilege(42501 → 403)."""
    pid, eid, rid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid) + _encounter_sql(eid, pid) + _rx_sql(rid, eid, admin_id),
        op="perform public.dispense_prescription('" + rid + "');",
        sqlstate="42501",
        claims_uid=nurse_id,
    )


def test_log_prescription_document_export_audits(psql: Psql, admin_id: str, reception_id: str):
    """log_prescription_document_export(reception): audit 'read'·target=prescriptions.

    finalized 게이트 없음 검증 — payment 없는 처방도 내보내기 감사 성공(0049 영수증과의 차이)."""
    pid, eid, rid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid)
        + _rx_sql(rid, eid, admin_id)
        + _claims(reception_id)
        + "select public.log_prescription_document_export('"
        + rid
        + "','prescription');"
        + "select 'V:'||count(*)::text||'|t='||coalesce(max(target_table),'')"
        "||'|dt='||coalesce(max(after_data->>'document_type'),'') from public.audit_logs "
        "where target_id='"
        + rid
        + "' and action='read' and after_data->>'event'='document_export';"
        "rollback;"
    )
    assert _verdict(out) == "1|t=prescriptions|dt=prescription", out


def test_log_prescription_export_denied_for_nurse(psql: Psql, admin_id: str, nurse_id: str):
    """prescription.dispense 미보유(nurse) → 42501(내보내기 감사도 dispense 게이트)."""
    pid, eid, rid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid) + _encounter_sql(eid, pid) + _rx_sql(rid, eid, admin_id),
        op="perform public.log_prescription_document_export('" + rid + "','prescription');",
        sqlstate="42501",
        claims_uid=nurse_id,
    )
