"""0031_appointments 마이그레이션 검증 (Story 6.2) — docker exec psql 로 실제 스키마 단언.

검증: appointments 테이블·컬럼(is_active 없음)·status CHECK·time_order CHECK·더블부킹 EXCLUDE
(구조 + 행동)·FK·encounters.reservation_id FK·appointment.read 권한(+admin 부트 grant·reception
seed·nurse baseline)·GRANT(authenticated SELECT only)·RLS(직원·환자 self)·감사 트리거. 로컬 스택이
없으면 skip. test_migrations_scheduling.py 미러.

⚠️ appointments.patient_id 는 NOT NULL FK → 더블부킹 행동 검증은 트랜잭션(begin/rollback) 안에서
   환자를 인라인 생성(encrypt_sensitive·blind_index 호출)하고 검증 후 ROLLBACK(영속 PII 미생성).
"""

from __future__ import annotations

# 시드 데모 의사(EMP0002)·진료과(IM)를 FK 타깃으로 쓰는 공용 서브셀렉트.
_DOCTOR = "(select id from public.users where employee_no='EMP0002')"
_DEPT = "(select id from public.departments where lower(code)=lower('IM'))"
_PATIENT = "'00000000-0000-4000-8000-0000000000f1'"

# 트랜잭션 안에서 굴려 ROLLBACK 으로 정리되는 환자 1건(암호화 PII 영속 회피).
_MK_PATIENT = (
    "insert into public.patients (id, name, birth_date, sex, resident_no_enc, "
    "resident_no_hash, resident_no_masked, insurance_type) values "
    f"({_PATIENT}, '테스트환자', '1990-01-01', 'male', "
    "public.encrypt_sensitive('9001011234567'), public.blind_index('9001011234567'), "
    "'900101-1******', 'health_insurance');"
)


def _appt(start: str, end: str, status: str = "booked") -> str:
    return (
        "insert into public.appointments (patient_id, doctor_id, department_id, "
        "scheduled_start, scheduled_end, status, created_by) values "
        f"({_PATIENT}, {_DOCTOR}, {_DEPT}, '{start}', '{end}', '{status}', {_DOCTOR});"
    )


# ── 0031: 테이블·컬럼 ─────────────────────────────────────────────────────────


def test_appointments_table_exists(psql):
    cnt = psql.scalar(
        "select count(*) from information_schema.tables "
        "where table_schema='public' and table_name='appointments';"
    )
    assert cnt == "1", "appointments 테이블 없음"


def test_appointments_has_no_is_active(psql):
    """appointments = encounters 형(status 만) — is_active 컬럼 없음(0030 config 와 구분)."""
    cnt = psql.scalar(
        "select count(*) from information_schema.columns "
        "where table_schema='public' and table_name='appointments' and column_name='is_active';"
    )
    assert cnt == "0", "appointments 에 is_active 가 있음(status 단일 모델 위반)"


def test_appointments_core_columns(psql):
    cols = psql.scalar(
        "select string_agg(column_name, ',' order by column_name) "
        "from information_schema.columns "
        "where table_schema='public' and table_name='appointments';"
    )
    have = set(cols.split(","))
    expected = {
        "id",
        "patient_id",
        "doctor_id",
        "department_id",
        "room_id",
        "scheduled_start",
        "scheduled_end",
        "status",
        "created_by",
        "created_at",
        "updated_at",
    }
    assert expected <= have, f"누락 컬럼: {expected - have}"


# ── 0031: CHECK 제약 ──────────────────────────────────────────────────────────


def test_status_check_rejects_invalid(psql):
    """status 는 booked/cancelled/no_show/completed 만 — 그 외는 CHECK 위반."""
    err = psql.expect_error(
        "begin;"
        + _MK_PATIENT
        + _appt("2030-06-03 10:00+09", "2030-06-03 10:30+09", "pending")
        + "rollback;"
    )
    assert "check" in err.lower() or "status" in err.lower(), err


def test_status_check_accepts_valid(psql):
    out = psql.scalar(
        "begin;"
        + _MK_PATIENT
        + _appt("2030-06-03 10:00+09", "2030-06-03 10:30+09", "completed")
        + _appt("2030-06-03 11:00+09", "2030-06-03 11:30+09", "no_show")
        + "select count(*) from public.appointments where patient_id="
        + _PATIENT
        + ";"
        "rollback;"
    )
    nums = [ln.strip() for ln in out.splitlines() if ln.strip().isdigit()]
    assert nums and int(nums[-1]) >= 2, out


def test_time_order_check(psql):
    """scheduled_start >= scheduled_end 은 CHECK 위반."""
    err = psql.expect_error(
        "begin;" + _MK_PATIENT + _appt("2030-06-03 11:00+09", "2030-06-03 10:00+09") + "rollback;"
    )
    assert "check" in err.lower() or "time_order" in err.lower(), err


# ── 0031: 더블부킹 EXCLUDE (btree_gist) ───────────────────────────────────────


def test_double_booking_exclude_exists(psql):
    cnt = psql.scalar(
        "select count(*) from pg_constraint c "
        "join pg_class t on t.oid=c.conrelid and t.relname='appointments' "
        "where c.contype='x' and c.conname='appointments_no_double_booking';"
    )
    assert cnt == "1", "appointments_no_double_booking EXCLUDE 제약 없음"


def test_double_booking_rejected(psql):
    """같은 의사·겹치는 활성(booked) 예약 → exclusion_violation(23P01)."""
    err = psql.expect_error(
        "begin;"
        + _MK_PATIENT
        + _appt("2030-06-03 10:00+09", "2030-06-03 10:30+09")
        + _appt("2030-06-03 10:15+09", "2030-06-03 10:45+09")  # 겹침
        + "rollback;"
    )
    assert "exclusion" in err.lower() or "double_booking" in err.lower(), err


def test_double_booking_adjacent_and_cancelled_allowed(psql):
    """인접 [) · 취소된 겹침은 허용 — 반열림 + 부분 제약(where status='booked')."""
    out = psql.scalar(
        "begin;"
        + _MK_PATIENT
        + _appt("2030-06-03 10:00+09", "2030-06-03 10:30+09", "booked")
        + _appt("2030-06-03 10:30+09", "2030-06-03 11:00+09", "booked")  # 인접 → OK
        + _appt("2030-06-03 10:00+09", "2030-06-03 10:30+09", "cancelled")  # 취소 겹침 → OK
        + "select count(*) from public.appointments where patient_id="
        + _PATIENT
        + ";"
        "rollback;"
    )
    nums = [ln.strip() for ln in out.splitlines() if ln.strip().isdigit()]
    assert nums and int(nums[-1]) >= 3, f"인접/취소 예약이 거부됨: {out!r}"


# ── 0031: FK 무결성 ──────────────────────────────────────────────────────────


def test_appointments_fks(psql):
    # created_by → users FK 는 0034 가 제거(환자 auth uid 는 users 에 없음·비정규화 생성자 uid).
    fks = (
        ("patient_id", "patients"),
        ("doctor_id", "users"),
        ("department_id", "departments"),
        ("room_id", "rooms"),
    )
    for col, ref in fks:
        cnt = psql.scalar(
            "select count(*) from pg_constraint c "
            "join pg_class t on t.oid=c.conrelid and t.relname='appointments' "
            f"join pg_class rt on rt.oid=c.confrelid and rt.relname='{ref}' "
            "where c.contype='f' "
            f"and '{col}' = any("
            "  select attname from pg_attribute where attrelid=t.oid and attnum=any(c.conkey));"
        )
        assert cnt == "1", f"appointments.{col} → {ref} FK 없음"


def test_encounters_reservation_id_fk(psql):
    """encounters.reservation_id → appointments FK(0010:54 이월 청산)."""
    cnt = psql.scalar(
        "select count(*) from pg_constraint c "
        "join pg_class t on t.oid=c.conrelid and t.relname='encounters' "
        "join pg_class rt on rt.oid=c.confrelid and rt.relname='appointments' "
        "where c.contype='f' "
        "and 'reservation_id' = any("
        "  select attname from pg_attribute where attrelid=t.oid and attnum=any(c.conkey));"
    )
    assert cnt == "1", "encounters.reservation_id → appointments FK 없음"


# ── 0031: 권한 (appointment.read) ─────────────────────────────────────────────


def test_appointment_read_permission_exists(psql):
    cnt = psql.scalar("select count(*) from public.permissions where code='appointment.read';")
    assert cnt == "1", "appointment.read 권한 미시드"


def test_admin_has_appointment_read(psql):
    """admin 부트 grant 재실행 — test_admin_role_has_all_permissions 회귀 회피."""
    cnt = psql.scalar(
        "select count(*) from public.role_permissions rp "
        "join public.roles r on r.id=rp.role_id "
        "join public.permissions p on p.id=rp.permission_id "
        "where r.code='admin' and p.code='appointment.read';"
    )
    assert cnt == "1", "admin 이 appointment.read 미보유(부트 grant 누락)"


def test_reception_has_appointment_read_seed(psql):
    cnt = psql.scalar(
        "select count(*) from public.role_permissions rp "
        "join public.roles r on r.id=rp.role_id "
        "join public.permissions p on p.id=rp.permission_id "
        "where r.code='reception' and p.code='appointment.read';"
    )
    assert cnt == "1", "reception 이 appointment.read 미보유(seed grant 누락)"


def test_nurse_lacks_appointment_read_baseline(psql):
    """nurse = appointment 403 baseline(미보유)."""
    cnt = psql.scalar(
        "select count(*) from public.role_permissions rp "
        "join public.roles r on r.id=rp.role_id "
        "join public.permissions p on p.id=rp.permission_id "
        "where r.code='nurse' and p.code='appointment.read';"
    )
    assert cnt == "0", "nurse 가 appointment.read 보유(403 baseline 소실)"


# ── 0031: GRANT · RLS · 감사 ──────────────────────────────────────────────────


def test_authenticated_has_select_only(psql):
    """authenticated 는 appointments 에 SELECT 만(쓰기 권위 = service_role/FastAPI)."""
    privs = psql.scalar(
        "select string_agg(privilege_type, ',' order by privilege_type) "
        "from information_schema.role_table_grants "
        "where table_schema='public' and table_name='appointments' and grantee='authenticated';"
    )
    assert privs == "SELECT", f"appointments authenticated 권한이 SELECT 만이 아님: {privs}"


def test_rls_enabled(psql):
    enabled = psql.scalar(
        "select c.relrowsecurity from pg_class c "
        "join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' "
        "where c.relname='appointments';"
    )
    assert enabled == "t", "appointments RLS 미활성"


def test_rls_policies_exist(psql):
    """직원(appointment.read 전체) + 환자 self(patient_id→auth_uid) SELECT 정책 2종."""
    cnt = psql.scalar(
        "select count(*) from pg_policies "
        "where schemaname='public' and tablename='appointments' and cmd='SELECT';"
    )
    assert int(cnt) >= 2, f"appointments SELECT 정책 부족: {cnt}"


def test_audit_trigger_attached(psql):
    cnt = psql.scalar(
        "select count(*) from pg_trigger tg "
        "join pg_class c on c.oid=tg.tgrelid "
        "join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' "
        "where not tg.tgisinternal and c.relname='appointments';"
    )
    assert int(cnt) >= 1, "appointments 감사 트리거 미부착"


def test_audit_trigger_records_appointment_change(psql):
    """appointments INSERT 시 audit_logs 에 create 이벤트 기록(트랜잭션 내 검증 후 ROLLBACK)."""
    out = psql.scalar(
        "begin;"
        + _MK_PATIENT
        + _appt("2030-06-03 09:00+09", "2030-06-03 09:30+09")
        + "select count(*) from public.audit_logs "
        "  where target_table='appointments' and action='create';"
        "rollback;"
    )
    nums = [ln.strip() for ln in out.splitlines() if ln.strip().isdigit()]
    assert nums and int(nums[-1]) >= 1, f"감사 create 이벤트 미기록: {out!r}"


# ── 0032: booking 컬럼·권한 (Story 6.3) ───────────────────────────────────────


def test_appointment_booking_columns(psql):
    """note·sms_opt_in 컬럼 존재 + sms_opt_in 기본 false(0032)."""
    cols = psql.scalar(
        "select string_agg(column_name, ',' order by column_name) "
        "from information_schema.columns "
        "where table_schema='public' and table_name='appointments' "
        "  and column_name in ('note','sms_opt_in');"
    )
    assert set(cols.split(",")) == {"note", "sms_opt_in"}, cols
    default = psql.scalar(
        "select column_default from information_schema.columns "
        "where table_name='appointments' and column_name='sms_opt_in';"
    )
    assert "false" in default, default


def test_appointment_create_permission_exists(psql):
    cnt = psql.scalar("select count(*) from public.permissions where code='appointment.create';")
    assert cnt == "1", "appointment.create 권한 미시드(0032)"


def test_admin_has_appointment_create(psql):
    """admin 부트 grant 재실행 — test_admin_role_has_all_permissions 회귀 회피."""
    cnt = psql.scalar(
        "select count(*) from public.role_permissions rp "
        "join public.roles r on r.id=rp.role_id "
        "join public.permissions p on p.id=rp.permission_id "
        "where r.code='admin' and p.code='appointment.create';"
    )
    assert cnt == "1", "admin 이 appointment.create 미보유(부트 grant 누락)"


def test_reception_has_appointment_create_seed(psql):
    cnt = psql.scalar(
        "select count(*) from public.role_permissions rp "
        "join public.roles r on r.id=rp.role_id "
        "join public.permissions p on p.id=rp.permission_id "
        "where r.code='reception' and p.code='appointment.create';"
    )
    assert cnt == "1", "reception 이 appointment.create 미보유(seed grant 누락)"


def test_nurse_lacks_appointment_create_baseline(psql):
    """nurse = appointment 403 baseline(create·read 둘 다 미보유)."""
    cnt = psql.scalar(
        "select count(*) from public.role_permissions rp "
        "join public.roles r on r.id=rp.role_id "
        "join public.permissions p on p.id=rp.permission_id "
        "where r.code='nurse' and p.code in ('appointment.create','appointment.read');"
    )
    assert cnt == "0", "nurse 가 appointment 권한 보유(403 baseline 소실)"


# ── 0033: 전이 상태머신·생명주기 컬럼·appointment.update (Story 6.4) ────────────


def test_lifecycle_columns(psql):
    """전이 타임스탬프·cancel_reason 컬럼 존재(0033)."""
    cols = psql.scalar(
        "select string_agg(column_name, ',' order by column_name) "
        "from information_schema.columns where table_schema='public' and table_name='appointments' "
        "  and column_name in ('cancelled_at','no_show_at','completed_at','cancel_reason');"
    )
    assert set(cols.split(",")) == {
        "cancelled_at",
        "no_show_at",
        "completed_at",
        "cancel_reason",
    }, cols


def test_transition_trigger_exists(psql):
    cnt = psql.scalar(
        "select count(*) from pg_trigger where tgname='trg_appointments_transition' "
        "and not tgisinternal;"
    )
    assert cnt == "1", "trg_appointments_transition 트리거 없음(0033)"


def test_booked_to_cancelled_and_no_show_allowed(psql):
    """booked→cancelled·booked→no_show 전이 허용(별 예약)."""
    out = psql.scalar(
        "begin;"
        + _MK_PATIENT
        + _appt("2030-06-03 10:00+09", "2030-06-03 10:30+09")  # id 자동
        + "update public.appointments set status='cancelled', cancelled_at=now() "
        "  where patient_id="
        + _PATIENT
        + " and status='booked';"
        + _appt("2030-06-03 11:00+09", "2030-06-03 11:30+09")
        + "update public.appointments set status='no_show', no_show_at=now() "
        "  where patient_id="
        + _PATIENT
        + " and status='booked';"
        + "select count(*) from public.appointments where patient_id="
        + _PATIENT
        + " and status in ('cancelled','no_show');"
        "rollback;"
    )
    nums = [ln.strip() for ln in out.splitlines() if ln.strip().isdigit()]
    assert nums and int(nums[-1]) == 2, out


def test_terminal_retransition_rejected(psql):
    """종결(cancelled) 재전이(→no_show) → PT409(enforce_appointment_transition)."""
    err = psql.expect_error(
        "begin;"
        + _MK_PATIENT
        + _appt("2030-06-03 10:00+09", "2030-06-03 10:30+09")
        + "update public.appointments set status='cancelled' where patient_id="
        + _PATIENT
        + ";"
        + "update public.appointments set status='no_show' where patient_id="
        + _PATIENT
        + ";"
        "rollback;"
    )
    assert "invalid appointment transition" in err.lower() or "pt409" in err.lower(), err


def test_reschedule_keeps_booked_allowed(psql):
    """변경(시각만 UPDATE·status booked 불변) → 트리거 same-status 통과."""
    out = psql.scalar(
        "begin;"
        + _MK_PATIENT
        + _appt("2030-06-03 10:00+09", "2030-06-03 10:30+09")
        + "update public.appointments set scheduled_start='2030-06-03 11:00+09', "
        "  scheduled_end='2030-06-03 11:30+09' where patient_id="
        + _PATIENT
        + ";"
        + "select count(*) from public.appointments where patient_id="
        + _PATIENT
        + " and status='booked' and scheduled_start='2030-06-03 11:00+09';"
        "rollback;"
    )
    nums = [ln.strip() for ln in out.splitlines() if ln.strip().isdigit()]
    assert nums and int(nums[-1]) == 1, out


def test_appointment_update_permission_grants(psql):
    """appointment.update 권한 + admin 부트 grant + reception seed grant + nurse 미보유."""
    assert (
        psql.scalar("select count(*) from public.permissions where code='appointment.update';")
        == "1"
    )
    for role, expected in (("admin", "1"), ("reception", "1"), ("nurse", "0")):
        cnt = psql.scalar(
            "select count(*) from public.role_permissions rp "
            "join public.roles r on r.id=rp.role_id "
            "join public.permissions p on p.id=rp.permission_id "
            f"where r.code='{role}' and p.code='appointment.update';"
        )
        assert cnt == expected, f"{role} appointment.update={cnt}(기대 {expected})"


# ── 0034: 환자 본인 예약 — created_by 비정규화(FK 제거) ────────────────────────


def test_created_by_users_fk_dropped(psql):
    """0034: created_by → users FK 제거(환자 auth uid 는 users 에 없음·비정규화 생성자 uid)."""
    cnt = psql.scalar(
        "select count(*) from pg_constraint c "
        "join pg_class t on t.oid=c.conrelid and t.relname='appointments' "
        "where c.contype='f' "
        "and 'created_by' = any("
        "  select attname from pg_attribute where attrelid=t.oid and attnum=any(c.conkey));"
    )
    assert cnt == "0", "appointments.created_by 에 FK 가 남아있음(0034 미적용)"


def test_created_by_still_not_null(psql):
    """FK 만 제거 — created_by 는 NOT NULL 유지(직원·환자 모두 항상 sub 보유)."""
    nullable = psql.scalar(
        "select is_nullable from information_schema.columns "
        "where table_schema='public' and table_name='appointments' and column_name='created_by';"
    )
    assert nullable == "NO", "created_by 가 nullable 이 됨(NOT NULL 유지 위반)"


def test_created_by_accepts_non_users_uuid(psql):
    """환자 auth uid(users 미존재) 로도 예약 INSERT 성공 — FK 부재 행동 검증(begin/rollback)."""
    # users 에 없는 임의 uuid(환자 auth_uid 시뮬). 환자 1건 인라인 → 예약 INSERT → ROLLBACK.
    fake_patient_sub = "'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'"
    out = psql.run(
        "begin;"
        f"{_MK_PATIENT}"
        "insert into public.appointments (patient_id, doctor_id, department_id, "
        "scheduled_start, scheduled_end, status, created_by) values "
        f"({_PATIENT}, {_DOCTOR}, {_DEPT}, "
        "'2026-09-01 01:00:00+00', '2026-09-01 01:30:00+00', 'booked', "
        f"{fake_patient_sub});"
        "rollback;"
    )
    assert out.returncode == 0, f"users 외 created_by INSERT 실패(FK 잔존?): {out.stderr}"
    assert "ERROR" not in out.stderr, f"INSERT 오류: {out.stderr}"


# ── 0036: 노쇼 카운트 단일 진실 함수 (Story 6.7 / FR-015) ───────────────────────


def test_patient_no_show_count_function_exists(psql):
    """patient_no_show_count(uuid) returns integer 함수 존재(0036)."""
    cnt = psql.scalar(
        "select count(*) from pg_proc p "
        "join pg_namespace n on n.oid=p.pronamespace and n.nspname='public' "
        "where p.proname='patient_no_show_count';"
    )
    assert cnt == "1", "patient_no_show_count 함수 없음(0036 미적용)"


def test_patient_no_show_count_counts_only_no_show(psql):
    """노쇼만 집계 — booked·cancelled·completed 제외(파생 카운트 단일 진실)."""
    out = psql.scalar(
        "begin;"
        + _MK_PATIENT
        # no_show 2건(서로 다른 시각) + cancelled 1 + completed 1 + booked 1 = 노쇼 카운트 2 기대
        + _appt("2030-06-03 09:00+09", "2030-06-03 09:30+09", "no_show")
        + _appt("2030-06-03 09:30+09", "2030-06-03 10:00+09", "no_show")
        + _appt("2030-06-03 10:00+09", "2030-06-03 10:30+09", "cancelled")
        + _appt("2030-06-03 10:30+09", "2030-06-03 11:00+09", "completed")
        + _appt("2030-06-03 11:00+09", "2030-06-03 11:30+09", "booked")
        + "select public.patient_no_show_count("
        + _PATIENT
        + ");"
        "rollback;"
    )
    nums = [ln.strip() for ln in out.splitlines() if ln.strip().lstrip("-").isdigit()]
    assert nums and int(nums[-1]) == 2, f"노쇼 카운트가 2가 아님(노쇼만 집계 위반): {out!r}"


def test_patient_no_show_count_zero_for_none(psql):
    """노쇼 예약이 없는(존재하지 않는) 환자 → 0(404 아님·조회 목적)."""
    cnt = psql.scalar(
        "select public.patient_no_show_count('00000000-0000-4000-8000-0000000000ff');"
    )
    assert cnt == "0", f"노쇼 0이어야 함: {cnt}"


def test_patient_no_show_count_execute_granted(psql):
    """authenticated·service_role 에 EXECUTE grant(public 회수 후 명시 grant)."""
    grantees = psql.scalar(
        "select string_agg(distinct grantee, ',' order by grantee) "
        "from information_schema.role_routine_grants "
        "where routine_schema='public' and routine_name='patient_no_show_count' "
        "  and privilege_type='EXECUTE';"
    )
    have = set((grantees or "").split(","))
    assert {"authenticated", "service_role"} <= have, f"EXECUTE grant 누락: {grantees}"


def test_patient_no_show_count_public_execute_revoked(psql):
    """PUBLIC 의 EXECUTE 회수 검증(revoke all from public). pg_proc.proacl 직접 검사 — proacl NULL
    (기본=PUBLIC EXECUTE 보유) 또는 grantee=0(PUBLIC) EXECUTE acl 이 있으면 회수 누락. 기대 0."""
    cnt = psql.scalar(
        "select count(*) from pg_proc p "
        "join pg_namespace n on n.oid=p.pronamespace and n.nspname='public' "
        "where p.proname='patient_no_show_count' and ("
        "  p.proacl is null "
        "  or exists (select 1 from aclexplode(p.proacl) a "
        "             where a.grantee=0 and a.privilege_type='EXECUTE'));"
    )
    assert cnt == "0", "PUBLIC 이 patient_no_show_count EXECUTE 를 보유(revoke 누락)"
