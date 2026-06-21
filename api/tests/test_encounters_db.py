"""내원 상태머신(Story 4.1) DB 레벨 통합 테스트 — psql 직접(0010_encounters).

순수 DB 스토리: FastAPI 미경유. 실 Supabase 로컬 db 컨테이너(`supabase start` + `db reset`)에
psql 로 붙어 상태머신·권한·감사·RLS 를 단언한다. 컨테이너 미실행 시 skip(conftest).

검증(AC 매핑):
  · AC1: 상태 어휘 CHECK + 초기상태 가드(scheduled|registered 만 INSERT, 그 외 PT409) + encounter_no
  · AC2: 합법 전이 체인(scheduled→registered→in_progress→completed) + 타임스탬프/담당의 세팅
  · AC2: 불법 전이(역행·건너뛰기·종결 재전이) 직접 update·잘못된 RPC 양쪽 → SQLSTATE PT409
  · AC2: 권한 미보유(doctor) RPC → insufficient_privilege(42501); 대상 없음 → PT404
  · AC3: 취소·노쇼 경로 + 매트릭스 외(registered→no_show·in_progress→cancelled) → PT409
  · AC3: 모든 전이(INSERT create + UPDATE)가 actor 와 함께 audit_logs 기록
  · AC1: RLS — 직원(encounter.read)=전체 / 환자=본인 내원만 / anon=거부

테스트 위생: 환자·내원은 dummy '\\x00'::bytea 로 psql 직접 INSERT(Vault 키 불요 — 기존 RLS 테스트
선례). 전부 begin/rollback 격리(커밋 없음 → 누적·flaky 0, 별도 정리 불요). uuid 는 Python 이 부여.
"""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import Psql

_DEPT = "(select id from public.departments where lower(code) = 'im' limit 1)"


# ── 픽스처: 시드 직원 uid ──────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def admin_id(psql: Psql) -> str:
    """admin uid — 0010 에서 encounter.read/cancel/no_show + 0002 전권 보유(성공 경로 기준)."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'admin' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def doctor_id(psql: Psql) -> str:
    """doctor uid — Story 4.4 부터 encounter.read/start 보유(seed grant) + auth.users 실재(FK).

    start_consult 성공(담당의=호출자) 검증 기준."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'doctor' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def nurse_id(psql: Psql) -> str:
    """nurse uid — encounter.* 권한 0(무권한 baseline, 간호 권한=Epic 5) + auth.users 실재(FK).

    권한 거부(42501) 검증 + RLS 본인행(auth_uid 가장) 검증 기준(Story 4.4 — doctor 가 권한을 받아
    더 이상 무권한 baseline 이 아니므로 nurse 가 대체)."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'nurse' limit 1"
    ).lower()


# ── SQL 조각 헬퍼 ─────────────────────────────────────────────────────────────


def _patient_sql(pid: str, *, auth_uid: str | None = None) -> str:
    """dummy 환자 1행 INSERT(postgres 컨텍스트). resident_no_hash 는 pid 로 고유 보장."""
    auth = f"'{auth_uid}'" if auth_uid else "null"
    return (
        "insert into public.patients(id, name, birth_date, sex, resident_no_enc, "
        "resident_no_hash, resident_no_masked, insurance_type, auth_uid) values "
        f"('{pid}','상태머신TEST','1990-01-01','male','\\x00'::bytea,"
        f"'__enc_{pid}__','900101-1******','health_insurance',{auth});"
    )


def _encounter_sql(eid: str, pid: str, status: str, *, visit: str = "walk_in") -> str:
    return (
        "insert into public.encounters(id, patient_id, department_id, visit_type, status) "
        f"values ('{eid}','{pid}',{_DEPT},'{visit}','{status}');"
    )


def _claims(uid: str) -> str:
    """RPC 권한 평가용 GUC 주입(role 전환 불요 — SECURITY DEFINER RPC 가 auth.uid() 를 읽음)."""
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


def _assert_sqlstate(
    psql: Psql, *, setup: str, op: str, sqlstate: str, claims_uid: str | None = None
) -> None:
    """`op`(plpgsql 문장)이 정확히 `sqlstate` 로 실패하는지 결정적으로 단언.

    DO 블록 내부 sub-begin/exception 으로 sqlstate 를 직접 비교 → 일치하면 returncode 0,
    불일치/미발생이면 raise → returncode != 0(비특정 'denied' 단언 회피, 1.3 P3 교훈).
    """
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


# ── 3.2 초기상태 가드 + encounter_no (AC1) ────────────────────────────────────


def test_initial_status_guard_blocks_terminal(psql: Psql):
    """INSERT status=completed/in_progress → PT409(초기상태는 scheduled|registered 만)."""
    pid = str(uuid.uuid4())
    for bad in ("completed", "in_progress", "cancelled", "no_show"):
        _assert_sqlstate(
            psql,
            setup=_patient_sql(pid),
            op=_encounter_sql(str(uuid.uuid4()), pid, bad),
            sqlstate="PT409",
        )


def test_initial_status_registered_and_scheduled_ok_and_encounter_no(psql: Psql):
    """INSERT registered/scheduled 성공 + encounter_no 8자리 zero-pad·unique."""
    pid, e1, e2 = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(e1, pid, "registered")
        + _encounter_sql(e2, pid, "scheduled")
        + "select 'V:'||status from public.encounters where id='"
        + e1
        + "';"
        + "select 'V:'||status from public.encounters where id='"
        + e2
        + "';"
        + "select 'V:no='||encounter_no||'|len='||length(encounter_no)::text "
        "  from public.encounters where id='"
        + e1
        + "';"
        + "select 'V:uniq='||(count(distinct encounter_no)=2)::text "
        "  from public.encounters where id in ('" + e1 + "','" + e2 + "');"
        "rollback;"
    )
    vs = [ln[2:] for ln in out.splitlines() if ln.strip().startswith("V:")]
    assert vs[0] == "registered" and vs[1] == "scheduled", vs
    assert vs[2].startswith("no=") and vs[2].endswith("|len=8"), vs[2]
    assert vs[3] == "uniq=true", vs[3]


# ── 3.3 합법 전이 체인 + 타임스탬프 + 담당의 (AC2) ────────────────────────────


def test_legal_transition_chain(psql: Psql, admin_id: str):
    """scheduled→registered→in_progress→completed 성공 + 전이 타임스탬프·doctor_id 세팅."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid, "scheduled", visit="reserved")
        + _claims(admin_id)
        + "select public.register_encounter('"
        + eid
        + "');"
        + "select public.start_consult('"
        + eid
        + "');"
        + "select public.complete_encounter('"
        + eid
        + "');"
        + "select 'V:'||status||'|reg='||(registered_at is not null)::text"
        "  ||'|cons='||(consult_started_at is not null)::text"
        "  ||'|done='||(completed_at is not null)::text"
        "  ||'|doc='||(doctor_id::text='" + admin_id + "')::text "
        "  from public.encounters where id='" + eid + "';"
        "rollback;"
    )
    assert _verdict(out) == "completed|reg=true|cons=true|done=true|doc=true", out


# ── 3.4 불법 전이(직접 update + 잘못된 RPC) → PT409 (AC2) ──────────────────────

# (from_status, to_status) — 직접 update 로 차단되어야 하는 전이.
_ILLEGAL_DIRECT = [
    ("scheduled", "completed"),  # 건너뛰기
    ("scheduled", "in_progress"),  # 건너뛰기
    ("registered", "completed"),  # 건너뛰기
    ("registered", "scheduled"),  # 역행
    ("in_progress", "registered"),  # 역행
    ("completed", "cancelled"),  # 종결 재전이
    ("cancelled", "in_progress"),  # 종결 재전이
    ("no_show", "registered"),  # 종결 재전이
]


@pytest.mark.parametrize("frm,to", _ILLEGAL_DIRECT)
def test_illegal_transition_direct_update(psql: Psql, admin_id: str, frm: str, to: str):
    """직접 update status(서비스롤/트리거 우회 시도)도 매트릭스 외면 PT409."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid) + _seed_to_status(eid, pid, frm, admin_id),
        op="update public.encounters set status='" + to + "' where id='" + eid + "';",
        sqlstate="PT409",
    )


def test_illegal_transition_wrong_rpc(psql: Psql, admin_id: str):
    """잘못된 RPC(예: registered 에 complete_encounter)도 PT409 로 차단(RPC 소스 선검사)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid) + _encounter_sql(eid, pid, "registered"),
        op="perform public.complete_encounter('" + eid + "');",  # registered→completed 건너뛰기
        sqlstate="PT409",
        claims_uid=admin_id,
    )


def test_rpc_recall_on_same_status_rejected(psql: Psql, admin_id: str):
    """재수행 차단(NFR-040·UX-DR21⑤): 이미 in_progress 인 내원에 start_consult 재호출 →
    트리거 same-status 통과 갭을 RPC 소스 선검사가 PT409 로 막아 doctor_id/타임스탬프 탈취 방지."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid) + _seed_to_status(eid, pid, "in_progress", admin_id),
        op="perform public.start_consult('" + eid + "');",  # in_progress 에 재호출
        sqlstate="PT409",
        claims_uid=admin_id,
    )


def _seed_to_status(eid: str, pid: str, status: str, admin_id: str) -> str:
    """initial guard 때문에 in_progress/completed/cancelled/no_show 는 합법 RPC 로 걸어서 만든다."""
    if status in ("scheduled", "registered"):
        return _encounter_sql(eid, pid, status)
    # initial guard 우회 불가 → 합법 RPC 로 목표 상태까지 걸어서 만든다(admin 권한 + GUC).
    walk = _encounter_sql(eid, pid, "scheduled") + _claims(admin_id)
    if status == "in_progress":
        walk += (
            "select public.register_encounter('" + eid + "');"
            "select public.start_consult('" + eid + "');"
        )
    elif status == "completed":
        walk += (
            "select public.register_encounter('" + eid + "');"
            "select public.start_consult('" + eid + "');"
            "select public.complete_encounter('" + eid + "');"
        )
    elif status == "cancelled":
        walk += "select public.cancel_encounter('" + eid + "','t');"
    elif status == "no_show":
        walk += "select public.mark_no_show('" + eid + "','t');"
    return walk


# ── 3.5 취소·노쇼 경로 (AC3) ──────────────────────────────────────────────────


def test_cancel_from_scheduled_and_registered(psql: Psql, admin_id: str):
    """scheduled→cancelled, registered→cancelled 성공 + cancel_reason 영속."""
    for frm in ("scheduled", "registered"):
        pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
        out = psql.scalar(
            "begin;"
            + _patient_sql(pid)
            + _encounter_sql(eid, pid, frm)
            + _claims(admin_id)
            + "select public.cancel_encounter('"
            + eid
            + "','환자요청');"
            + "select 'V:'||status||'|reason='||cancel_reason"
            "||'|at='||(cancelled_at is not null)::text "
            "  from public.encounters where id='" + eid + "';"
            "rollback;"
        )
        assert _verdict(out) == "cancelled|reason=환자요청|at=true", (frm, out)


def test_no_show_from_scheduled(psql: Psql, admin_id: str):
    """scheduled→no_show 성공 + no_show_at 영속."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid, "scheduled")
        + _claims(admin_id)
        + "select public.mark_no_show('"
        + eid
        + "');"
        + "select 'V:'||status||'|at='||(no_show_at is not null)::text "
        "  from public.encounters where id='" + eid + "';"
        "rollback;"
    )
    assert _verdict(out) == "no_show|at=true", out


def test_no_show_from_registered_blocked(psql: Psql, admin_id: str):
    """registered→no_show 는 매트릭스 외(접수=도착 증명) → PT409."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid) + _encounter_sql(eid, pid, "registered"),
        op="perform public.mark_no_show('" + eid + "');",
        sqlstate="PT409",
        claims_uid=admin_id,
    )


def test_cancel_from_in_progress_blocked(psql: Psql, admin_id: str):
    """in_progress→cancelled 기본 불허(부분수행=completed 후 Epic7 정산) → PT409."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid) + _seed_to_status(eid, pid, "in_progress", admin_id),
        op="perform public.cancel_encounter('" + eid + "','중단');",
        sqlstate="PT409",
        claims_uid=admin_id,
    )


# ── 3.6 권한 게이트 + not-found (AC2) ─────────────────────────────────────────


def test_rpc_permission_denied_for_nurse(psql: Psql, nurse_id: str):
    """encounter.start 미보유(nurse 무권한 baseline) → insufficient_privilege(42501 → 403).

    Story 4.4 부터 doctor 가 encounter.start 를 받으므로 권한 거부 baseline 은 nurse 로 이관."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid) + _encounter_sql(eid, pid, "registered"),
        op="perform public.start_consult('" + eid + "');",
        sqlstate="42501",
        claims_uid=nurse_id,
    )


def test_start_consult_succeeds_for_doctor(psql: Psql, doctor_id: str):
    """doctor(seed encounter.start 보유, 4.4)는 start_consult 성공 → in_progress + 담당의=doctor."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid, "registered")
        + _claims(doctor_id)
        + "select public.start_consult('" + eid + "');"
        + "select 'V:'||status||'|cons='||(consult_started_at is not null)::text"
        "  ||'|doc='||(doctor_id::text='" + doctor_id + "')::text "
        "  from public.encounters where id='" + eid + "';"
        "rollback;"
    )
    assert _verdict(out) == "in_progress|cons=true|doc=true", out


def test_rpc_not_found(psql: Psql, admin_id: str):
    """존재하지 않는 내원 RPC → PT404."""
    _assert_sqlstate(
        psql,
        setup="",
        op="perform public.start_consult('" + str(uuid.uuid4()) + "');",
        sqlstate="PT404",
        claims_uid=admin_id,
    )


# ── 3.7 전이 감사 (AC3) ───────────────────────────────────────────────────────


def test_transitions_are_audited_with_actor(psql: Psql, admin_id: str):
    """INSERT=create + 전이=update 가 audit_logs 에 actor 와 함께 기록."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _claims(admin_id)  # app.actor_id 를 INSERT 전에 세팅(create 감사 actor 보장)
        + _patient_sql(pid)
        + _encounter_sql(eid, pid, "scheduled")
        + "select public.register_encounter('"
        + eid
        + "');"
        + "select public.start_consult('"
        + eid
        + "');"
        + "select 'V:crt='||(count(*) filter (where action='create'))::text"
        "  ||'|upd='||(count(*) filter (where action='update'))::text"
        "  ||'|actor='||coalesce(bool_and(actor_id::text='" + admin_id + "'),false)::text "
        "  from public.audit_logs where target_table='encounters' and target_id='" + eid + "';"
        "rollback;"
    )
    v = _verdict(out)
    assert "crt=1" in v and "actor=true" in v, v
    # register + start_consult = update 2건 이상.
    upd = int(v.split("upd=")[1].split("|")[0])
    assert upd >= 2, v


# ── 3.8 RLS 경계 (AC1) ────────────────────────────────────────────────────────


def test_rls_staff_with_read_sees_encounters(psql: Psql, admin_id: str):
    """직원(encounter.read=admin)은 RLS 직원 정책으로 내원 행을 받는다."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid, "registered")
        + _as_authenticated(admin_id)
        + "select 'V:'||(count(*) >= 1)::text from public.encounters;"
        "rollback;"
    )
    assert _verdict(out) == "true", out


def test_rls_patient_sees_only_own_encounter(psql: Psql, nurse_id: str):
    """환자 본인 내원만 가시 — 본인(auth_uid=nurse_id 가장) 내원만, 타인 내원 비가시.

    nurse 는 encounter.read 미보유 → 직원 정책 false → self 정책(patient_id→auth_uid)만 작동.
    (4.4 — doctor 가 encounter.read 를 받아 무권한 가장 계정이 아니므로 nurse 로 이관.)
    """
    own_p, own_e = str(uuid.uuid4()), str(uuid.uuid4())
    other_p, other_e = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(own_p, auth_uid=nurse_id)
        + _encounter_sql(own_e, own_p, "registered")
        + _patient_sql(other_p)  # auth_uid NULL(타인)
        + _encounter_sql(other_e, other_p, "registered")
        + _as_authenticated(nurse_id)
        + "select 'V:'||coalesce(bool_and(patient_id::text='"
        + own_p
        + "'),false)::text"
        "  ||'|'||(count(*)=1)::text from public.encounters;"
        "rollback;"
    )
    assert _verdict(out) == "true|true", out


def test_rls_anon_cannot_select(psql: Psql):
    """anon 은 encounters SELECT 거부(revoke all + 쓰기/읽기 정책 미부여)."""
    err = psql.expect_error(
        "begin;set local role anon;select count(*) from public.encounters;rollback;"
    )
    assert "permission denied" in err.lower() and "encounters" in err.lower(), err


# ── 4.3 호출 상태 기록 record_encounter_call (0011) ───────────────────────────


def test_call_records_on_registered(psql: Psql, admin_id: str):
    """registered 호출 → called_at·call_count·last_called_by 기록 + 재호출 시 count 증가.

    호출은 상태 전이 아님(status 불변 registered) — 트리거 same-status 통과 활용."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _patient_sql(pid)
        + _encounter_sql(eid, pid, "registered")
        + _claims(admin_id)
        + "select public.record_encounter_call('" + eid + "');"  # 1차 호출
        + "select public.record_encounter_call('" + eid + "');"  # 재호출(허용 — count++)
        + "select 'V:cnt='||call_count::text||'|at='||(called_at is not null)::text"
        "||'|by='||(last_called_by::text='" + admin_id + "')::text||'|st='||status "
        "  from public.encounters where id='" + eid + "';"
        "rollback;"
    )
    assert _verdict(out) == "cnt=2|at=true|by=true|st=registered", out


@pytest.mark.parametrize(
    "status", ["scheduled", "in_progress", "completed", "cancelled", "no_show"]
)
def test_call_on_non_registered_rejected(psql: Psql, admin_id: str, status: str):
    """미접수/진행중/종결 내원 호출 → PT409(호출 대상은 접수 대기 환자만)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid) + _seed_to_status(eid, pid, status, admin_id),
        op="perform public.record_encounter_call('" + eid + "');",
        sqlstate="PT409",
        claims_uid=admin_id,
    )


def test_call_permission_denied_for_doctor(psql: Psql, doctor_id: str):
    """encounter.call 미보유(doctor 기본 권한 0) → insufficient_privilege(42501 → 403)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    _assert_sqlstate(
        psql,
        setup=_patient_sql(pid) + _encounter_sql(eid, pid, "registered"),
        op="perform public.record_encounter_call('" + eid + "');",
        sqlstate="42501",
        claims_uid=doctor_id,
    )


def test_call_not_found(psql: Psql, admin_id: str):
    """존재하지 않는 내원 호출 → PT404."""
    _assert_sqlstate(
        psql,
        setup="",
        op="perform public.record_encounter_call('" + str(uuid.uuid4()) + "');",
        sqlstate="PT404",
        claims_uid=admin_id,
    )


def test_call_is_audited_with_actor(psql: Psql, admin_id: str):
    """호출 UPDATE 가 audit_logs 에 actor 와 함께 기록(FR-023 호출 기록 — 0010 감사 트리거 자동)."""
    pid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    out = psql.scalar(
        "begin;"
        + _claims(admin_id)
        + _patient_sql(pid)
        + _encounter_sql(eid, pid, "registered")
        + "select public.record_encounter_call('" + eid + "');"
        + "select 'V:upd='||(count(*) filter (where action='update'))::text"
        "||'|actor='||coalesce(bool_and(actor_id::text='" + admin_id + "'),false)::text "
        "  from public.audit_logs where target_table='encounters' and target_id='" + eid + "';"
        "rollback;"
    )
    v = _verdict(out)
    assert "upd=1" in v and "actor=true" in v, v
