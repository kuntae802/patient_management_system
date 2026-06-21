"""Story 6.1 — 근무표·휴진 마이그레이션(0030) 스모크 검증.

검증 대상(0030): doctor_schedules·doctor_time_offs 테이블, weekday CHECK(0–6)·시간 순서 CHECK,
FK(doctor_id→users·department_id→departments·room_id→rooms), 겹침 방지 EXCLUDE(btree_gist),
GRANT posture(authenticated SELECT 만), RLS 활성·SELECT 정책, 0004 감사 트리거 부착.
실제 적용된 로컬 DB(`supabase db reset` 선행)를 단언한다. 로컬 스택 없으면 skip(conftest).

행동(behavioral) 검증 — master.manage 게이트 쓰기·변경 감사 — 은 실제 JWT 토큰이 필요하므로
test_scheduling_integration.py 로 이월. 겹침 EXCLUDE 동작은 FK 만 필요해 여기서 검증(weekday=6 =
시드 Mon–Fri 미사용 → 시드 행과 독립).
"""

from __future__ import annotations

# 시드 데모 의사(EMP0002)·진료과(IM)를 FK 타깃으로 쓰는 공용 서브셀렉트(겹침 EXCLUDE 행동 검증용).
_DOCTOR = "(select id from users where employee_no='EMP0002')"
_DEPT = "(select id from departments where lower(code)=lower('IM'))"


# ── 0030: 테이블 존재 ─────────────────────────────────────────────────────────


def test_scheduling_tables_exist(psql):
    rows = psql.scalar(
        "select string_agg(tablename, ',' order by tablename) from pg_tables "
        "where schemaname='public' and tablename in ('doctor_schedules','doctor_time_offs');"
    )
    assert set(rows.split(",")) == {"doctor_schedules", "doctor_time_offs"}


def test_scheduling_tables_have_is_active(psql):
    """soft delete 컬럼 is_active(default true) — 물리 삭제 대신 비활성(예약 참조 보존)."""
    for table in ("doctor_schedules", "doctor_time_offs"):
        default = psql.scalar(
            "select column_default from information_schema.columns "
            f"where table_schema='public' and table_name='{table}' and column_name='is_active';"
        )
        assert default.startswith("true"), f"{table}.is_active 기본값이 true 가 아님: {default}"


# ── 0030: CHECK 제약 ──────────────────────────────────────────────────────────


def test_weekday_check_rejects_out_of_range(psql):
    """weekday 는 0–6(PG dow) 만 — 7·-1 은 CHECK 위반(23514)."""
    for bad in (7, -1):
        err = psql.expect_error(
            "insert into doctor_schedules(doctor_id, department_id, weekday, start_time, end_time) "
            f"values ({_DOCTOR}, {_DEPT}, {bad}, '09:00', '12:00');"
        )
        assert "check" in err.lower() or "weekday" in err.lower(), f"weekday={bad} 미거부: {err}"


def test_schedule_time_order_check(psql):
    """start_time >= end_time 은 CHECK 위반."""
    err = psql.expect_error(
        "insert into doctor_schedules(doctor_id, department_id, weekday, start_time, end_time) "
        f"values ({_DOCTOR}, {_DEPT}, 6, '12:00', '09:00');"
    )
    assert "check" in err.lower() or "time_order" in err.lower(), err


def test_time_off_time_order_check(psql):
    """doctor_time_offs.start_at >= end_at 은 CHECK 위반."""
    err = psql.expect_error(
        "insert into doctor_time_offs(doctor_id, start_at, end_at) "
        f"values ({_DOCTOR}, '2030-01-02 00:00+09', '2030-01-01 00:00+09');"
    )
    assert "check" in err.lower() or "time_order" in err.lower(), err


# ── 0030: FK 무결성 ──────────────────────────────────────────────────────────


def test_doctor_schedules_fks(psql):
    """doctor_schedules 의 doctor_id→users·department_id→departments·room_id→rooms FK 존재."""
    fks = (("doctor_id", "users"), ("department_id", "departments"), ("room_id", "rooms"))
    for col, ref in fks:
        cnt = psql.scalar(
            "select count(*) from pg_constraint c "
            "join pg_class t on t.oid=c.conrelid and t.relname='doctor_schedules' "
            f"join pg_class rt on rt.oid=c.confrelid and rt.relname='{ref}' "
            "where c.contype='f' "
            f"and '{col}' = any("
            "  select attname from pg_attribute where attrelid=t.oid and attnum=any(c.conkey));"
        )
        assert cnt == "1", f"doctor_schedules.{col} → {ref} FK 없음"


def test_time_off_doctor_fk(psql):
    cnt = psql.scalar(
        "select count(*) from pg_constraint c "
        "join pg_class t on t.oid=c.conrelid and t.relname='doctor_time_offs' "
        "join pg_class rt on rt.oid=c.confrelid and rt.relname='users' "
        "where c.contype='f' "
        "and 'doctor_id' = any("
        "  select attname from pg_attribute where attrelid=t.oid and attnum=any(c.conkey));"
    )
    assert cnt == "1", "doctor_time_offs.doctor_id → users FK 없음"


# ── 0030: 겹침 방지 EXCLUDE (btree_gist) ──────────────────────────────────────


def test_no_overlap_exclusion_constraint_exists(psql):
    """doctor_schedules_no_overlap EXCLUDE 제약(contype='x') 존재."""
    cnt = psql.scalar(
        "select count(*) from pg_constraint c "
        "join pg_class t on t.oid=c.conrelid and t.relname='doctor_schedules' "
        "where c.contype='x' and c.conname='doctor_schedules_no_overlap';"
    )
    assert cnt == "1", "doctor_schedules_no_overlap EXCLUDE 제약 없음"


def test_btree_gist_extension_installed(psql):
    cnt = psql.scalar("select count(*) from pg_extension where extname='btree_gist';")
    assert cnt == "1", "btree_gist 확장 미설치(0030)"


def test_overlapping_schedule_rejected(psql):
    """같은 의사·요일의 겹치는 활성 블록 → exclusion_violation(23P01). weekday=6(시드 미사용)."""
    err = psql.expect_error(
        "begin;"
        "insert into doctor_schedules(doctor_id, department_id, weekday, start_time, end_time) "
        f"  values ({_DOCTOR}, {_DEPT}, 6, '09:00', '12:00');"
        "insert into doctor_schedules(doctor_id, department_id, weekday, start_time, end_time) "
        f"  values ({_DOCTOR}, {_DEPT}, 6, '11:00', '13:00');"  # 09–12 와 겹침
        "rollback;"
    )
    assert "exclusion" in err.lower() or "no_overlap" in err.lower(), f"겹침이 거부되지 않음: {err}"


def test_adjacent_and_inactive_schedules_allowed(psql):
    """인접 [) · 다른 요일 · 비활성(부분 제약 제외) 은 허용 — weekday=6 격리, 트랜잭션 ROLLBACK."""
    out = psql.scalar(
        "begin;"
        "insert into doctor_schedules(doctor_id, department_id, weekday, start_time, end_time) "
        f"  values ({_DOCTOR}, {_DEPT}, 6, '09:00', '12:00');"
        "insert into doctor_schedules(doctor_id, department_id, weekday, start_time, end_time) "
        f"  values ({_DOCTOR}, {_DEPT}, 6, '12:00', '13:00');"  # 인접 → OK
        "insert into doctor_schedules"
        "(doctor_id, department_id, weekday, start_time, end_time, is_active) "
        f"  values ({_DOCTOR}, {_DEPT}, 6, '09:30', '11:00', false);"  # 비활성 겹침 → OK
        "select count(*) from doctor_schedules where weekday=6;"
        "rollback;"
    )
    nums = [ln.strip() for ln in out.splitlines() if ln.strip().isdigit()]
    assert nums and int(nums[-1]) >= 3, f"인접/비활성 블록이 거부됨: {out!r}"


# ── 0030: 권한 posture ───────────────────────────────────────────────────────


def test_authenticated_has_select_only(psql):
    """authenticated 는 근무표·휴진에 SELECT 만(쓰기 권위 = service_role/FastAPI)."""
    for table in ("doctor_schedules", "doctor_time_offs"):
        privs = psql.scalar(
            "select string_agg(privilege_type, ',' order by privilege_type) "
            "from information_schema.role_table_grants "
            f"where table_schema='public' and table_name='{table}' and grantee='authenticated';"
        )
        assert privs == "SELECT", f"{table} authenticated 권한이 SELECT 만이 아님: {privs}"


# ── 0030: RLS ────────────────────────────────────────────────────────────────


def test_rls_enabled(psql):
    disabled = psql.scalar(
        "select string_agg(relname, ',') from pg_class c "
        "join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' "
        "where c.relkind='r' and not c.relrowsecurity "
        "and relname in ('doctor_schedules','doctor_time_offs');"
    )
    assert disabled in ("", "\\N"), f"RLS 미활성 테이블: {disabled}"


def test_select_policies_exist(psql):
    cnt = psql.scalar(
        "select count(*) from pg_policies "
        "where schemaname='public' "
        "and tablename in ('doctor_schedules','doctor_time_offs') and cmd='SELECT';"
    )
    assert int(cnt) >= 2


# ── 0030: 감사 트리거 부착 ────────────────────────────────────────────────────


def test_audit_triggers_attached(psql):
    rows = psql.scalar(
        "select string_agg(distinct c.relname, ',' order by c.relname) "
        "from pg_trigger tg "
        "join pg_class c on c.oid=tg.tgrelid "
        "join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' "
        "where not tg.tgisinternal and c.relname in ('doctor_schedules','doctor_time_offs');"
    )
    assert set(rows.split(",")) == {"doctor_schedules", "doctor_time_offs"}


def test_audit_trigger_records_schedule_change(psql):
    """doctor_schedules INSERT 시 audit_logs 에 create 이벤트 기록(트랜잭션 내 검증 후 ROLLBACK)."""
    out = psql.scalar(
        "begin;"
        "insert into doctor_schedules(doctor_id, department_id, weekday, start_time, end_time) "
        f"  values ({_DOCTOR}, {_DEPT}, 6, '08:00', '08:30');"
        "select count(*) from audit_logs "
        "  where target_table='doctor_schedules' and action='create';"
        "rollback;"
    )
    nums = [ln.strip() for ln in out.splitlines() if ln.strip().isdigit()]
    assert nums and int(nums[-1]) >= 1, f"감사 트리거가 create 이벤트를 기록하지 않음: {out!r}"
