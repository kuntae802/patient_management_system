"""Story 2.2 — 코드 마스터 마이그레이션(0007) 스모크 검증.

검증 대상(0007): diagnoses·fee_schedules·drugs 테이블, 유효기간 컬럼(effective_from NOT NULL·
effective_to nullable), soft delete(is_active), code UNIQUE, fee amount_krw + 음수 금지 CHECK,
유효기간 역전 금지 CHECK, GRANT posture(authenticated SELECT only), RLS 활성·SELECT 정책,
0004 감사 트리거 부착. 적용된 로컬 DB(`supabase db reset` 선행)를 단언. 스택 없으면 skip(conftest).

행동(behavioral) 검증 — master.manage 게이트 쓰기 + 감사 기록 + 만료 행 보존 — 은 실제 JWT 가
필요하므로 test_masters_codes_integration.py 로 이월.
"""

from __future__ import annotations

_TABLES = ("diagnoses", "fee_schedules", "drugs")

# ── 0007: 테이블·유효기간 컬럼 ────────────────────────────────────────────────


def test_code_master_tables_exist(psql):
    rows = psql.scalar(
        "select string_agg(tablename, ',' order by tablename) from pg_tables "
        "where schemaname='public' and tablename in ('diagnoses','fee_schedules','drugs');"
    )
    assert set(rows.split(",")) == set(_TABLES)


def test_code_master_tables_have_is_active(psql):
    for table in _TABLES:
        default = psql.scalar(
            "select column_default from information_schema.columns "
            f"where table_schema='public' and table_name='{table}' and column_name='is_active';"
        )
        assert default.startswith("true"), f"{table}.is_active 기본값이 true 가 아님: {default}"


def test_effective_from_not_null_and_to_nullable(psql):
    """effective_from 은 NOT NULL(유효기간 필수), effective_to 는 nullable(무기한 허용)."""
    for table in _TABLES:
        nullable = psql.scalar(
            "select string_agg(column_name || ':' || is_nullable, ',' order by column_name) "
            "from information_schema.columns "
            f"where table_schema='public' and table_name='{table}' "
            "and column_name in ('effective_from','effective_to');"
        )
        assert "effective_from:NO" in nullable, f"{table}.effective_from NOT NULL 아님: {nullable}"
        assert "effective_to:YES" in nullable, f"{table}.effective_to nullable 아님: {nullable}"


def test_code_master_code_unique_case_insensitive(psql):
    """진단·수가·약품 code 대소문자 무관 unique(0008) — lower(code) 인덱스 + 기존 제약 제거."""
    for table in _TABLES:
        idx = psql.scalar(
            "select count(*) from pg_indexes "
            f"where schemaname='public' and tablename='{table}' "
            "and indexdef ilike '%unique%' and indexdef ilike '%lower(code)%';"
        )
        assert int(idx) >= 1, f"{table}.code 대소문자 무관 unique 인덱스(lower(code)) 없음(0008)"
        old = psql.scalar(f"select count(*) from pg_constraint where conname='{table}_code_key';")
        assert int(old) == 0, f"{table}_code_key 제약이 아직 존재(0008 drop 누락)"


def test_fee_schedules_has_amount_krw(psql):
    dtype = psql.scalar(
        "select data_type from information_schema.columns "
        "where table_schema='public' and table_name='fee_schedules' and column_name='amount_krw';"
    )
    assert dtype == "integer", f"amount_krw 가 integer 아님(KRW 정수): {dtype}"


# ── 0007: CHECK 제약 ──────────────────────────────────────────────────────────


def test_effective_range_check_exists(psql):
    """세 테이블에 effective_to >= effective_from CHECK 존재."""
    for table in _TABLES:
        cnt = psql.scalar(
            "select count(*) from pg_constraint c "
            f"join pg_class t on t.oid=c.conrelid and t.relname='{table}' "
            "where c.contype='c' and c.conname like '%effective_range';"
        )
        assert int(cnt) >= 1, f"{table} 유효기간 CHECK 가 없음"


def test_fee_amount_nonneg_check_exists(psql):
    cnt = psql.scalar(
        "select count(*) from pg_constraint c "
        "join pg_class t on t.oid=c.conrelid and t.relname='fee_schedules' "
        "where c.contype='c' and c.conname like '%amount%';"
    )
    assert int(cnt) >= 1, "fee_schedules amount_krw>=0 CHECK 가 없음"


# ── 0007: 권한 posture ───────────────────────────────────────────────────────


def test_authenticated_has_select_only(psql):
    for table in _TABLES:
        privs = psql.scalar(
            "select string_agg(privilege_type, ',' order by privilege_type) "
            "from information_schema.role_table_grants "
            f"where table_schema='public' and table_name='{table}' and grantee='authenticated';"
        )
        assert privs == "SELECT", f"{table} authenticated 권한이 SELECT 만이 아님: {privs}"


# ── 0007: RLS ────────────────────────────────────────────────────────────────


def test_rls_enabled_on_code_masters(psql):
    disabled = psql.scalar(
        "select string_agg(relname, ',') from pg_class c "
        "join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' "
        "where c.relkind='r' and not c.relrowsecurity "
        "and relname in ('diagnoses','fee_schedules','drugs');"
    )
    assert disabled in ("", "\\N"), f"RLS 미활성 코드 마스터 테이블: {disabled}"


def test_code_master_select_policies_exist(psql):
    cnt = psql.scalar(
        "select count(*) from pg_policies "
        "where schemaname='public' and tablename in ('diagnoses','fee_schedules','drugs') "
        "and cmd='SELECT';"
    )
    assert int(cnt) >= 3


# ── 0007: 감사 트리거 부착 ────────────────────────────────────────────────────


def test_audit_triggers_attached_to_code_masters(psql):
    rows = psql.scalar(
        "select string_agg(distinct c.relname, ',' order by c.relname) "
        "from pg_trigger tg "
        "join pg_class c on c.oid=tg.tgrelid "
        "join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' "
        "where not tg.tgisinternal and c.relname in ('diagnoses','fee_schedules','drugs');"
    )
    assert set(rows.split(",")) == set(_TABLES)


def test_audit_trigger_records_diagnosis_change(psql):
    """diagnoses INSERT 시 audit_logs 에 create 이벤트 기록(트랜잭션 내 검증 후 ROLLBACK)."""
    out = psql.scalar(
        "begin;"
        "insert into diagnoses(code, name, effective_from) "
        "  values ('__smoke_dx__', '스모크진단', '2026-01-01');"
        "select count(*) from audit_logs "
        "  where target_table='diagnoses' and action='create' "
        "  and after_data->>'code'='__smoke_dx__';"
        "rollback;"
    )
    nums = [ln.strip() for ln in out.splitlines() if ln.strip().isdigit()]
    assert nums and nums[-1] == "1", f"감사 트리거가 create 이벤트를 기록하지 않음: {out!r}"
