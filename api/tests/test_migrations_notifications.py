"""0035_notifications 마이그레이션 검증 (Story 6.6) — docker exec psql 로 실제 스키마 단언.

검증: notification_logs 테이블·컬럼·reminder_kind/status/channel CHECK·UNIQUE(appointment_id,
reminder_kind) 멱등·FK(appointment_id·patient_id)·append-only GRANT(authenticated SELECT only·
service_role INSERT/SELECT only — UPDATE/DELETE grant 부재)·RLS(직원 notification.read)·감사 트리거·
notification.read/send 권한(+admin 부트 grant·reception seed·nurse baseline). 로컬 스택 없으면 skip.
test_migrations_appointments.py 미러.

⚠️ notification_logs.appointment_id/patient_id 는 NOT NULL FK → 행동 검증은 트랜잭션(begin/rollback)
   안에서 환자·예약을 인라인 생성하고 검증 후 ROLLBACK(영속 PII 미생성).
"""

from __future__ import annotations

# 시드 데모 의사(EMP0002)·진료과(IM)를 FK 타깃으로 쓰는 공용 서브셀렉트(appointments 테스트 미러).
_DOCTOR = "(select id from public.users where employee_no='EMP0002')"
_DEPT = "(select id from public.departments where lower(code)=lower('IM'))"
_PATIENT = "'00000000-0000-4000-8000-0000000000f1'"
_APPT_ID = "'00000000-0000-4000-8000-0000000000a1'"

# 트랜잭션 안에서 굴려 ROLLBACK 으로 정리되는 환자 1건(암호화 PII 영속 회피).
_MK_PATIENT = (
    "insert into public.patients (id, name, birth_date, sex, resident_no_enc, "
    "resident_no_hash, resident_no_masked, insurance_type) values "
    f"({_PATIENT}, '테스트환자', '1990-01-01', 'male', "
    "public.encrypt_sensitive('9001011234567'), public.blind_index('9001011234567'), "
    "'900101-1******', 'health_insurance');"
)

# 고정 id 예약 1건(notification_logs FK 타깃).
_MK_APPT = (
    "insert into public.appointments (id, patient_id, doctor_id, department_id, "
    "scheduled_start, scheduled_end, status, created_by) values "
    f"({_APPT_ID}, {_PATIENT}, {_DOCTOR}, {_DEPT}, "
    "'2030-06-03 01:00:00+00', '2030-06-03 01:30:00+00', 'booked', {_DOCTOR});"
).replace("{_DOCTOR}", _DOCTOR)


def _notif(kind: str = "d_minus_3", status: str = "simulated", channel: str = "sms") -> str:
    recipient = "'010-****-5678'" if status == "simulated" else "null"
    skip = "null" if status == "simulated" else "'no_recipient'"
    sent = "now()" if status == "simulated" else "null"
    return (
        "insert into public.notification_logs (appointment_id, patient_id, channel, "
        "reminder_kind, recipient_masked, body, status, skip_reason, appointment_start, sent_at) "
        f"values ({_APPT_ID}, {_PATIENT}, '{channel}', '{kind}', {recipient}, "
        f"'[테스트병원] 예약 안내', '{status}', {skip}, '2030-06-03 01:00:00+00', {sent});"
    )


# ── 테이블·컬럼 ───────────────────────────────────────────────────────────────


def test_notification_logs_table_exists(psql):
    cnt = psql.scalar(
        "select count(*) from information_schema.tables "
        "where table_schema='public' and table_name='notification_logs';"
    )
    assert cnt == "1", "notification_logs 테이블 없음"


def test_notification_logs_core_columns(psql):
    cols = psql.scalar(
        "select string_agg(column_name, ',' order by column_name) "
        "from information_schema.columns "
        "where table_schema='public' and table_name='notification_logs';"
    )
    have = set(cols.split(","))
    expected = {
        "id",
        "appointment_id",
        "patient_id",
        "channel",
        "reminder_kind",
        "recipient_masked",
        "body",
        "status",
        "skip_reason",
        "appointment_start",
        "sent_at",
        "created_at",
    }
    assert expected <= have, f"누락 컬럼: {expected - have}"


# ── CHECK 제약 ────────────────────────────────────────────────────────────────


def test_reminder_kind_check_rejects_invalid(psql):
    """reminder_kind 는 d_minus_3/d_minus_1 만 — 그 외는 CHECK 위반."""
    err = psql.expect_error(
        "begin;" + _MK_PATIENT + _MK_APPT + _notif(kind="d_minus_7") + "rollback;"
    )
    assert "check" in err.lower() or "reminder_kind" in err.lower(), err


def test_status_check_rejects_invalid(psql):
    """status 는 simulated/skipped 만 — 그 외는 CHECK 위반."""
    err = psql.expect_error("begin;" + _MK_PATIENT + _MK_APPT + _notif(status="sent") + "rollback;")
    assert "check" in err.lower() or "status" in err.lower(), err


def test_channel_check_rejects_invalid(psql):
    """channel 은 sms 만(향후 push/email = CHECK 확장 이음매)."""
    err = psql.expect_error(
        "begin;" + _MK_PATIENT + _MK_APPT + _notif(channel="email") + "rollback;"
    )
    assert "check" in err.lower() or "channel" in err.lower(), err


def test_status_check_accepts_valid(psql):
    """simulated·skipped 둘 다 허용(D-3 simulated + D-1 skipped)."""
    out = psql.scalar(
        "begin;"
        + _MK_PATIENT
        + _MK_APPT
        + _notif(kind="d_minus_3", status="simulated")
        + _notif(kind="d_minus_1", status="skipped")
        + "select count(*) from public.notification_logs where appointment_id="
        + _APPT_ID
        + ";"
        "rollback;"
    )
    nums = [ln.strip() for ln in out.splitlines() if ln.strip().isdigit()]
    assert nums and int(nums[-1]) == 2, out


# ── UNIQUE(appointment_id, reminder_kind) 멱등 ────────────────────────────────


def test_unique_appointment_kind_rejects_duplicate(psql):
    """같은 예약·같은 종류 2회 INSERT → unique 위반(멱등 토대·재실행 중복 0)."""
    err = psql.expect_error(
        "begin;"
        + _MK_PATIENT
        + _MK_APPT
        + _notif(kind="d_minus_3")
        + _notif(kind="d_minus_3")  # 같은 (appointment_id, kind) → unique 위반
        + "rollback;"
    )
    assert "unique" in err.lower() or "notification_logs_once" in err.lower(), err


def test_unique_constraint_exists(psql):
    cnt = psql.scalar(
        "select count(*) from pg_constraint c "
        "join pg_class t on t.oid=c.conrelid and t.relname='notification_logs' "
        "where c.contype='u' and c.conname='notification_logs_once';"
    )
    assert cnt == "1", "notification_logs_once UNIQUE 제약 없음"


# ── FK 무결성 ────────────────────────────────────────────────────────────────


def test_notification_logs_fks(psql):
    for col, ref in (("appointment_id", "appointments"), ("patient_id", "patients")):
        cnt = psql.scalar(
            "select count(*) from pg_constraint c "
            "join pg_class t on t.oid=c.conrelid and t.relname='notification_logs' "
            f"join pg_class rt on rt.oid=c.confrelid and rt.relname='{ref}' "
            "where c.contype='f' "
            f"and '{col}' = any("
            "  select attname from pg_attribute where attrelid=t.oid and attnum=any(c.conkey));"
        )
        assert cnt == "1", f"notification_logs.{col} → {ref} FK 없음"


# ── GRANT (append-only by grant) · RLS · 감사 ─────────────────────────────────


def test_authenticated_has_select_only(psql):
    """authenticated 는 notification_logs 에 SELECT 만(쓰기 = service_role/FastAPI)."""
    privs = psql.scalar(
        "select string_agg(privilege_type, ',' order by privilege_type) "
        "from information_schema.role_table_grants "
        "where table_schema='public' and table_name='notification_logs' "
        "and grantee='authenticated';"
    )
    assert privs == "SELECT", f"authenticated 권한이 SELECT 만이 아님: {privs}"


def test_service_role_has_insert_select_only(psql):
    """append-only by grant — service_role 도 INSERT/SELECT 만(UPDATE/DELETE grant 부재·불변)."""
    privs = psql.scalar(
        "select string_agg(privilege_type, ',' order by privilege_type) "
        "from information_schema.role_table_grants "
        "where table_schema='public' and table_name='notification_logs' and grantee='service_role';"
    )
    assert privs == "INSERT,SELECT", f"service_role 권한이 INSERT/SELECT 만이 아님: {privs}"


def test_rls_enabled(psql):
    enabled = psql.scalar(
        "select c.relrowsecurity from pg_class c "
        "join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' "
        "where c.relname='notification_logs';"
    )
    assert enabled == "t", "notification_logs RLS 미활성"


def test_rls_staff_policy_exists(psql):
    """직원(notification.read) SELECT 정책. 환자 self 정책은 본 스토리 제외(Epic 8)."""
    cnt = psql.scalar(
        "select count(*) from pg_policies "
        "where schemaname='public' and tablename='notification_logs' and cmd='SELECT';"
    )
    assert int(cnt) >= 1, f"notification_logs SELECT 정책 부족: {cnt}"


def test_audit_trigger_attached(psql):
    cnt = psql.scalar(
        "select count(*) from pg_trigger tg "
        "join pg_class c on c.oid=tg.tgrelid "
        "join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' "
        "where not tg.tgisinternal and c.relname='notification_logs';"
    )
    assert int(cnt) >= 1, "notification_logs 감사 트리거 미부착"


def test_audit_trigger_records_notification_insert(psql):
    """notification_logs INSERT 시 audit_logs 에 create 이벤트 기록(트랜잭션 내 검증 후 정리)."""
    out = psql.scalar(
        "begin;"
        + _MK_PATIENT
        + _MK_APPT
        + _notif(kind="d_minus_3")
        + "select count(*) from public.audit_logs "
        "  where target_table='notification_logs' and action='create';"
        "rollback;"
    )
    nums = [ln.strip() for ln in out.splitlines() if ln.strip().isdigit()]
    assert nums and int(nums[-1]) >= 1, f"감사 create 이벤트 미기록: {out!r}"


# ── 권한 (notification.read · notification.send) ──────────────────────────────


def test_notification_permissions_exist(psql):
    cnt = psql.scalar(
        "select count(*) from public.permissions "
        "where code in ('notification.read','notification.send');"
    )
    assert cnt == "2", "notification.read/send 권한 미시드(0035)"


def test_admin_has_notification_permissions(psql):
    """admin 부트 grant 재실행 — test_admin_role_has_all_permissions 회귀 회피(2종 다)."""
    cnt = psql.scalar(
        "select count(*) from public.role_permissions rp "
        "join public.roles r on r.id=rp.role_id "
        "join public.permissions p on p.id=rp.permission_id "
        "where r.code='admin' and p.code in ('notification.read','notification.send');"
    )
    assert cnt == "2", "admin 이 notification.read/send 미보유(부트 grant 누락)"


def test_reception_has_notification_permissions_seed(psql):
    cnt = psql.scalar(
        "select count(*) from public.role_permissions rp "
        "join public.roles r on r.id=rp.role_id "
        "join public.permissions p on p.id=rp.permission_id "
        "where r.code='reception' and p.code in ('notification.read','notification.send');"
    )
    assert cnt == "2", "reception 이 notification.read/send 미보유(seed grant 누락)"


def test_nurse_lacks_notification_permissions_baseline(psql):
    """nurse = notification 403 baseline(read·send 둘 다 미보유)."""
    cnt = psql.scalar(
        "select count(*) from public.role_permissions rp "
        "join public.roles r on r.id=rp.role_id "
        "join public.permissions p on p.id=rp.permission_id "
        "where r.code='nurse' and p.code in ('notification.read','notification.send');"
    )
    assert cnt == "0", "nurse 가 notification 권한 보유(403 baseline 소실)"
