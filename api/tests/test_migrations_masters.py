"""Story 2.1 — 진료과·진료실 마스터 마이그레이션(0006) 스모크 검증.

검증 대상(0006): departments·rooms 테이블, soft delete(is_active), rooms.department_id FK,
users.department_id FK(0002 이월 추가), GRANT posture, RLS 활성·SELECT 정책, 0004 감사 트리거 부착.
실제 적용된 로컬 DB(`supabase db reset` 선행)를 단언한다. 로컬 스택 없으면 skip(conftest).

행동(behavioral) 검증 — master.manage 게이트로 쓰기 + 변경 감사 기록 — 은 실제 JWT 토큰이 필요하므로
test_masters_integration.py 로 이월.
"""

from __future__ import annotations

# ── 0006: 테이블 존재 ────────────────────────────────────────────────────────


def test_master_tables_exist(psql):
    rows = psql.scalar(
        "select string_agg(tablename, ',' order by tablename) from pg_tables "
        "where schemaname='public' and tablename in ('departments','rooms');"
    )
    assert set(rows.split(",")) == {"departments", "rooms"}


def test_master_tables_have_is_active(psql):
    """soft delete 컬럼 is_active(default true) 존재 — 물리 삭제 대신 비활성."""
    for table in ("departments", "rooms"):
        default = psql.scalar(
            "select column_default from information_schema.columns "
            f"where table_schema='public' and table_name='{table}' and column_name='is_active';"
        )
        assert default.startswith("true"), f"{table}.is_active 기본값이 true 가 아님: {default}"


def test_master_code_unique_case_insensitive(psql):
    """departments·rooms code 대소문자 무관 unique(0008) — lower(code) 인덱스 + 기존 제약 제거."""
    for table in ("departments", "rooms"):
        # 신규(0008): lower(code) unique 인덱스 — ORTHO/ortho 공존 차단(원본 케이스 표시는 보존)
        idx = psql.scalar(
            "select count(*) from pg_indexes "
            f"where schemaname='public' and tablename='{table}' "
            "and indexdef ilike '%unique%' and indexdef ilike '%lower(code)%';"
        )
        assert int(idx) >= 1, f"{table}.code 대소문자 무관 unique 인덱스(lower(code)) 없음(0008)"
        # 기존 인라인 unique 제약(<table>_code_key)은 0008 이 drop 함(이중 unique 방지)
        old = psql.scalar(f"select count(*) from pg_constraint where conname='{table}_code_key';")
        assert int(old) == 0, f"{table}_code_key 제약이 아직 존재(0008 drop 누락)"


# ── 0006: FK 무결성 ──────────────────────────────────────────────────────────


def test_rooms_department_id_fk(psql):
    """rooms.department_id → departments(id) FK 존재."""
    cnt = psql.scalar(
        "select count(*) from pg_constraint c "
        "join pg_class t on t.oid=c.conrelid and t.relname='rooms' "
        "join pg_class rt on rt.oid=c.confrelid and rt.relname='departments' "
        "where c.contype='f' "
        "and 'department_id' = any("
        "  select attname from pg_attribute where attrelid=t.oid and attnum=any(c.conkey));"
    )
    assert cnt == "1"


def test_users_department_id_fk_added(psql):
    """0006 이 users.department_id → departments(id) FK 를 추가했다(0002 이월)."""
    cnt = psql.scalar(
        "select count(*) from pg_constraint c "
        "join pg_class t on t.oid=c.conrelid and t.relname='users' "
        "join pg_class rt on rt.oid=c.confrelid and rt.relname='departments' "
        "where c.contype='f' "
        "and 'department_id' = any("
        "  select attname from pg_attribute where attrelid=t.oid and attnum=any(c.conkey));"
    )
    assert cnt == "1", "users.department_id FK 가 departments 로 추가되지 않음(0006 누락)"


# ── 0006: 권한 posture ───────────────────────────────────────────────────────


def test_authenticated_has_select_only(psql):
    """authenticated 는 마스터에 SELECT 만(쓰기 권위는 service_role/FastAPI)."""
    for table in ("departments", "rooms"):
        privs = psql.scalar(
            "select string_agg(privilege_type, ',' order by privilege_type) "
            "from information_schema.role_table_grants "
            f"where table_schema='public' and table_name='{table}' and grantee='authenticated';"
        )
        assert privs == "SELECT", f"{table} authenticated 권한이 SELECT 만이 아님: {privs}"


# ── 0006: RLS ────────────────────────────────────────────────────────────────


def test_rls_enabled_on_masters(psql):
    disabled = psql.scalar(
        "select string_agg(relname, ',') from pg_class c "
        "join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' "
        "where c.relkind='r' and not c.relrowsecurity and relname in ('departments','rooms');"
    )
    assert disabled in ("", "\\N"), f"RLS 미활성 마스터 테이블: {disabled}"


def test_master_select_policies_exist(psql):
    """departments·rooms 에 authenticated SELECT 정책 존재(전역 참조 직접조회)."""
    cnt = psql.scalar(
        "select count(*) from pg_policies "
        "where schemaname='public' and tablename in ('departments','rooms') and cmd='SELECT';"
    )
    assert int(cnt) >= 2


# ── 0006: 감사 트리거 부착 ────────────────────────────────────────────────────


def test_audit_triggers_attached_to_masters(psql):
    rows = psql.scalar(
        "select string_agg(distinct c.relname, ',' order by c.relname) "
        "from pg_trigger tg "
        "join pg_class c on c.oid=tg.tgrelid "
        "join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' "
        "where not tg.tgisinternal and c.relname in ('departments','rooms');"
    )
    assert set(rows.split(",")) == {"departments", "rooms"}


def test_audit_trigger_records_department_change(psql):
    """departments INSERT 시 audit_logs 에 create 이벤트 기록(트랜잭션 내 검증 후 ROLLBACK)."""
    out = psql.scalar(
        "begin;"
        "insert into departments(code, name) values ('__smoke_dept__', '스모크과');"
        "select count(*) from audit_logs "
        "  where target_table='departments' and action='create' "
        "  and after_data->>'code'='__smoke_dept__';"
        "rollback;"
    )
    nums = [ln.strip() for ln in out.splitlines() if ln.strip().isdigit()]
    assert nums and nums[-1] == "1", f"감사 트리거가 create 이벤트를 기록하지 않음: {out!r}"
