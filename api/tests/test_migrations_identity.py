"""Story 1.3 — 신원·RBAC 스키마 · RLS 헬퍼 · 감사 트리거 마이그레이션 스모크 검증.

검증 대상(0001~0004): 확장, 4개 신원/RBAC 테이블, SECURITY DEFINER 헬퍼,
append-only 감사로그·트리거. 실제 적용된 로컬 DB(`supabase db reset` 선행)를 단언한다.

행동(behavioral) 테스트(JWT 컨텍스트의 has_permission/auth_user_role 평가)는
실제 auth 사용자가 필요하므로 Story 1.5 통합 테스트로 이월(Dev Notes §테스트).
"""

from __future__ import annotations

# ── 0001_extensions ────────────────────────────────────────────────────────


def test_pgcrypto_extension_present(psql):
    assert psql.scalar("select count(*) from pg_extension where extname='pgcrypto';") == "1"


# ── 0002_identity_rbac: 테이블 존재 ──────────────────────────────────────────


def test_identity_tables_exist(psql):
    rows = psql.scalar(
        "select string_agg(tablename, ',' order by tablename) from pg_tables "
        "where schemaname='public' "
        "and tablename in ('users','roles','permissions','role_permissions','audit_logs');"
    )
    assert set(rows.split(",")) == {
        "users", "roles", "permissions", "role_permissions", "audit_logs"
    }


# ── 0002: 핵심 설계 결정(D-2, D-4) 단언 ──────────────────────────────────────


def test_users_id_has_no_default(psql):
    """users.id는 auth uid PK — gen_random_uuid() 기본값을 두지 않는다(D-2)."""
    default = psql.scalar(
        "select coalesce(column_default,'<none>') from information_schema.columns "
        "where table_schema='public' and table_name='users' and column_name='id';"
    )
    assert default == "<none>", f"users.id에 기본값이 있으면 안 됨: {default}"


def test_users_id_fk_to_auth_users(psql):
    """users.id → auth.users(id) FK 존재(D-2)."""
    cnt = psql.scalar(
        "select count(*) from pg_constraint c "
        "join pg_class t on t.oid=c.conrelid and t.relname='users' "
        "join pg_class rt on rt.oid=c.confrelid "
        "join pg_namespace rn on rn.oid=rt.relnamespace "
        "where c.contype='f' and rt.relname='users' and rn.nspname='auth';"
    )
    assert cnt == "1"


def test_users_department_id_has_no_fk(psql):
    """users.department_id는 0002에서 FK 미부착 — departments(0005) 부재(D-4)."""
    cnt = psql.scalar(
        "select count(*) from pg_constraint c "
        "join pg_class t on t.oid=c.conrelid and t.relname='users' "
        "where c.contype='f' "
        "and 'department_id' = any("
        "  select attname from pg_attribute "
        "  where attrelid=t.oid and attnum=any(c.conkey));"
    )
    assert cnt == "0", "0002에 department_id FK가 있으면 마이그레이션 적용 실패함(0005가 추가)"


def test_users_check_constraints(psql):
    """employment_status / license_type CHECK 제약 존재."""
    cnt = psql.scalar(
        "select count(*) from pg_constraint c "
        "join pg_class t on t.oid=c.conrelid and t.relname='users' "
        "where c.contype='c';"
    )
    assert int(cnt) >= 2


# ── 0002: 시드(roles 6 + 권한 카탈로그 + admin grant) ─────────────────────────


def test_seed_roles_six(psql):
    codes = psql.scalar("select string_agg(code, ',' order by code) from roles;")
    assert set(codes.split(",")) == {
        "admin", "doctor", "nurse", "patient", "radiologist", "reception"
    }


def test_seed_permission_catalog_nonempty(psql):
    cnt = psql.scalar("select count(*) from permissions;")
    assert int(cnt) >= 8, "권한 카탈로그(초기)가 비어있음"


def test_permission_code_format(psql):
    """모든 권한 코드는 `<resource>.<action>` 형식."""
    bad = psql.scalar(
        "select count(*) from permissions where code !~ '^[a-z_]+\\.[a-z_]+$';"
    )
    assert bad == "0"


def test_admin_role_has_all_permissions(psql):
    """기본 grant: admin = 전체 권한(D-5)."""
    missing = psql.scalar(
        "select count(*) from permissions p "
        "where not exists ("
        "  select 1 from role_permissions rp "
        "  join roles r on r.id=rp.role_id and r.code='admin' "
        "  where rp.permission_id=p.id);"
    )
    assert missing == "0", "admin이 일부 권한을 못 받음"


def test_role_permissions_unique(psql):
    """(role_id, permission_id) UNIQUE 제약 존재."""
    cnt = psql.scalar(
        "select count(*) from pg_constraint c "
        "join pg_class t on t.oid=c.conrelid and t.relname='role_permissions' "
        "where c.contype='u';"
    )
    assert int(cnt) >= 1


# ── 0003_rls_helpers: SECURITY DEFINER 헬퍼 ──────────────────────────────────


def test_helper_functions_are_security_definer(psql):
    """auth_user_role · has_permission · audit_trigger_fn 모두 SECURITY DEFINER."""
    rows = psql.scalar(
        "select string_agg(proname, ',' order by proname) from pg_proc p "
        "join pg_namespace n on n.oid=p.pronamespace and n.nspname='public' "
        "where p.prosecdef "  # security definer
        "and proname in ('auth_user_role','has_permission','audit_trigger_fn');"
    )
    assert set(rows.split(",")) == {"auth_user_role", "has_permission", "audit_trigger_fn"}


def test_security_definer_have_search_path(psql):
    """SECURITY DEFINER 함수는 명시적 search_path 필수(Supabase 린트 · 하이재킹 방지)."""
    cnt = psql.scalar(
        "select count(*) from pg_proc p "
        "join pg_namespace n on n.oid=p.pronamespace and n.nspname='public' "
        "where p.prosecdef "
        "and proname in ('auth_user_role','has_permission','audit_trigger_fn') "
        "and (proconfig is null or not exists ("
        "  select 1 from unnest(proconfig) cfg where cfg like 'search_path=%'));"
    )
    assert cnt == "0", "search_path 미설정 SECURITY DEFINER 함수가 있음"


# ── 0003: RLS 활성화 ─────────────────────────────────────────────────────────


def test_rls_enabled_on_all_tables(psql):
    disabled = psql.scalar(
        "select string_agg(relname, ',') from pg_class c "
        "join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' "
        "where c.relkind='r' and not c.relrowsecurity "
        "and relname in ('users','roles','permissions','role_permissions','audit_logs');"
    )
    assert disabled in ("", "\\N"), f"RLS 미활성 테이블: {disabled}"


# ── 0004_audit: append-only 강제 ─────────────────────────────────────────────


def test_audit_logs_append_only_update_revoked(psql):
    """service_role로 audit_logs UPDATE 시도 → GRANT 회수로 권한 거부(append-only)."""
    err = psql.expect_error(
        "set role service_role; update audit_logs set action='update' where false;"
    ).lower()
    # 오류가 audit_logs 권한 거부임을 특정 — 무관한 set role 실패도 'denied'를 포함하므로 오탐 방지.
    assert "audit_logs" in err and "denied" in err, f"audit_logs 권한 거부가 아님: {err}"


def test_audit_logs_append_only_delete_revoked(psql):
    """service_role로 audit_logs DELETE 시도 → GRANT 회수로 권한 거부(append-only)."""
    err = psql.expect_error(
        "set role service_role; delete from audit_logs where false;"
    ).lower()
    assert "audit_logs" in err and "denied" in err, f"audit_logs 권한 거부가 아님: {err}"


def test_audit_logs_owner_blocked_by_trigger(psql):
    """테이블 owner(postgres)도 BEFORE 트리거로 UPDATE/DELETE 차단(append-only 강화, owner 경로)."""
    err_u = psql.expect_error("update audit_logs set action='update' where false;").lower()
    assert "append-only" in err_u, f"owner UPDATE가 트리거로 차단되지 않음: {err_u}"
    err_d = psql.expect_error("delete from audit_logs where false;").lower()
    assert "append-only" in err_d, f"owner DELETE가 트리거로 차단되지 않음: {err_d}"


def test_audit_actor_id_has_no_fk(psql):
    """audit_logs.actor_id는 비정규화 — FK 미부착(감사 INSERT 회복력 + 삭제 후 보존, D-6')."""
    cnt = psql.scalar(
        "select count(*) from pg_constraint c "
        "join pg_class t on t.oid=c.conrelid and t.relname='audit_logs' "
        "where c.contype='f' "
        "and 'actor_id' = any("
        "  select attname from pg_attribute where attrelid=t.oid and attnum=any(c.conkey));"
    )
    assert cnt == "0", "actor_id FK는 부재 actor가 감사 쓰기를 abort시키므로 두면 안 됨"


# ── 0004: 트리거 부착 + actor 캡처 동작 ───────────────────────────────────────


def test_audit_triggers_attached_to_identity_tables(psql):
    rows = psql.scalar(
        "select string_agg(distinct c.relname, ',' order by c.relname) "
        "from pg_trigger tg "
        "join pg_class c on c.oid=tg.tgrelid "
        "join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' "
        "where not tg.tgisinternal "
        "and c.relname in ('users','roles','permissions','role_permissions');"
    )
    assert set(rows.split(",")) == {"users", "roles", "permissions", "role_permissions"}


def test_audit_trigger_records_change(psql):
    """roles INSERT 시 audit_logs에 create 이벤트가 기록된다(트랜잭션 내 검증 후 ROLLBACK)."""
    out = psql.scalar(
        "begin;"
        "insert into roles(code, name) values ('__smoke_test__', '스모크');"
        "select count(*) from audit_logs "
        "  where target_table='roles' and action='create' "
        "  and after_data->>'code'='__smoke_test__';"
        "rollback;"
    )
    # 다중 문장 출력엔 BEGIN/ROLLBACK 커맨드 태그가 섞이므로 숫자 줄만 취한다.
    nums = [ln.strip() for ln in out.splitlines() if ln.strip().isdigit()]
    assert nums and nums[-1] == "1", f"감사 트리거가 create 이벤트를 기록하지 않음: {out!r}"
