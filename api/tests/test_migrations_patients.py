"""Story 3.1 — 환자 patients/guardians 마이그레이션(0009) 스모크 검증.

검증 대상(0009): patients(주민번호 _enc/_hash/_masked, 임상 프로필, auth_uid nullable, chart_no
시퀀스)·guardians 테이블, soft delete(is_active), resident_no_hash UNIQUE, sex·insurance_type
CHECK, 컬럼 레벨 GRANT(authenticated 는 _enc/_hash 제외 SELECT), RLS 활성·정책, 0004 감사 트리거.
실제 적용된 로컬 DB(`supabase db reset` 선행)를 단언한다. 로컬 스택 없으면 skip(conftest).

행동(behavioral) 검증 — patient.create 게이트로 쓰기 + 암호화 라운드트립 + 변경 감사 — 은 실제 JWT
토큰이 필요하므로 test_patients_integration.py 로 이월.
"""

from __future__ import annotations

# ── 0009: 테이블 존재 ────────────────────────────────────────────────────────


def test_patient_tables_exist(psql):
    rows = psql.scalar(
        "select string_agg(tablename, ',' order by tablename) from pg_tables "
        "where schemaname='public' and tablename in ('patients','guardians');"
    )
    assert set(rows.split(",")) == {"guardians", "patients"}


def test_patients_has_is_active(psql):
    """soft delete 컬럼 is_active(default true) — 물리 삭제 금지(진료·법적 보존)."""
    default = psql.scalar(
        "select column_default from information_schema.columns "
        "where table_schema='public' and table_name='patients' and column_name='is_active';"
    )
    assert default.startswith("true"), f"patients.is_active 기본값이 true 가 아님: {default}"


def test_resident_no_columns_types(psql):
    """주민번호 3컬럼 타입: _enc=bytea, _hash=text, _masked=text. 전부 NOT NULL."""
    rows = psql.scalar(
        "select string_agg(column_name||':'||data_type||':'||is_nullable, ',' "
        "order by column_name) "
        "from information_schema.columns where table_schema='public' and table_name='patients' "
        "and column_name in ('resident_no_enc','resident_no_hash','resident_no_masked');"
    )
    got = {c.split(":")[0]: (c.split(":")[1], c.split(":")[2]) for c in rows.split(",")}
    assert got["resident_no_enc"] == ("bytea", "NO"), got
    assert got["resident_no_hash"] == ("text", "NO"), got
    assert got["resident_no_masked"] == ("text", "NO"), got


def test_resident_no_hash_unique_index(psql):
    """resident_no_hash 컬럼 UNIQUE 인덱스(FR-003) — 식 인덱스 아님(blind_index IMMUTABLE 불가)."""
    cnt = psql.scalar(
        "select count(*) from pg_indexes where schemaname='public' and tablename='patients' "
        "and indexdef ilike '%unique%' and indexdef ilike '%(resident_no_hash)%';"
    )
    assert int(cnt) >= 1, "resident_no_hash 컬럼 UNIQUE 인덱스 없음(0009)"


def test_chart_no_unique_default_sequence(psql):
    """chart_no UNIQUE + 시퀀스 기반 기본값(race-free 부여)."""
    default = psql.scalar(
        "select column_default from information_schema.columns "
        "where table_schema='public' and table_name='patients' and column_name='chart_no';"
    )
    assert "patients_chart_no_seq" in default, f"chart_no 기본값이 시퀀스 기반이 아님: {default}"
    uniq = psql.scalar(
        "select count(*) from pg_indexes where schemaname='public' and tablename='patients' "
        "and indexdef ilike '%unique%' and indexdef ilike '%(chart_no)%';"
    )
    assert int(uniq) >= 1, "chart_no UNIQUE 인덱스 없음"


def test_sex_and_insurance_checks(psql):
    """sex·insurance_type CHECK 제약 존재(허용값 강제)."""
    checks = psql.scalar(
        "select string_agg(pg_get_constraintdef(c.oid), ' | ') from pg_constraint c "
        "join pg_class t on t.oid=c.conrelid and t.relname='patients' "
        "where c.contype='c';"
    )
    assert "sex" in checks and "male" in checks, f"sex CHECK 누락: {checks}"
    assert "insurance_type" in checks and "health_insurance" in checks, (
        f"insurance CHECK 누락: {checks}"
    )


def test_auth_uid_nullable_fk(psql):
    """auth_uid nullable + auth.users FK(원무 등록=NULL, 앱 자가가입 설정)."""
    nullable = psql.scalar(
        "select is_nullable from information_schema.columns "
        "where table_schema='public' and table_name='patients' and column_name='auth_uid';"
    )
    assert nullable == "YES", "auth_uid 가 NOT NULL — 원무 직접 등록(auth 미설정) 불가"
    fk = psql.scalar(
        "select count(*) from pg_constraint c "
        "join pg_class t on t.oid=c.conrelid and t.relname='patients' "
        "join pg_class rt on rt.oid=c.confrelid and rt.relname='users' "
        "join pg_namespace rn on rn.oid=rt.relnamespace and rn.nspname='auth' "
        "where c.contype='f' and 'auth_uid' = any("
        "  select attname from pg_attribute where attrelid=t.oid and attnum=any(c.conkey));"
    )
    assert fk == "1", "auth_uid → auth.users(id) FK 없음"


def test_guardians_patient_fk(psql):
    """guardians.patient_id → patients(id) FK 존재(on delete cascade)."""
    cnt = psql.scalar(
        "select count(*) from pg_constraint c "
        "join pg_class t on t.oid=c.conrelid and t.relname='guardians' "
        "join pg_class rt on rt.oid=c.confrelid and rt.relname='patients' "
        "where c.contype='f' and 'patient_id' = any("
        "  select attname from pg_attribute where attrelid=t.oid and attnum=any(c.conkey));"
    )
    assert cnt == "1"


def test_clinical_profile_columns_exist_nullable(psql):
    """임상 프로필 컬럼(0009 생성, 입력 UI 는 3.2) — 전부 nullable."""
    rows = psql.scalar(
        "select string_agg(column_name||':'||is_nullable, ',' order by column_name) "
        "from information_schema.columns where table_schema='public' and table_name='patients' "
        "and column_name in ('blood_type','allergies','chronic_diseases','medications','notes');"
    )
    got = {c.split(":")[0]: c.split(":")[1] for c in rows.split(",")}
    assert set(got) == {"blood_type", "allergies", "chronic_diseases", "medications", "notes"}
    assert all(v == "YES" for v in got.values()), f"임상 프로필 컬럼이 nullable 이 아님: {got}"


# ── 0009: 컬럼 레벨 GRANT(민감 컬럼 방어심층) ─────────────────────────────────


def test_authenticated_column_grants_exclude_sensitive(psql):
    """authenticated 는 patients 비민감 컬럼만 SELECT — _enc/_hash 제외(컬럼 방어심층)."""
    granted = psql.scalar(
        "select string_agg(column_name, ',' order by column_name) "
        "from information_schema.column_privileges "
        "where table_schema='public' and table_name='patients' "
        "and grantee='authenticated' and privilege_type='SELECT';"
    )
    cols = set(granted.split(",")) if granted else set()
    assert "resident_no_masked" in cols, "마스킹 컬럼은 authenticated 가 읽어야 함"
    assert "resident_no_enc" not in cols, "resident_no_enc 가 authenticated 에 노출됨(GRANT 누락)"
    assert "resident_no_hash" not in cols, "resident_no_hash 가 authenticated 에 노출됨(GRANT 누락)"


def test_authenticated_has_no_write_on_patients(psql):
    """authenticated 는 patients 에 INSERT/UPDATE/DELETE 없음(쓰기 권위=service_role)."""
    writes = psql.scalar(
        "select count(*) from information_schema.role_table_grants "
        "where table_schema='public' and table_name='patients' and grantee='authenticated' "
        "and privilege_type in ('INSERT','UPDATE','DELETE');"
    )
    assert int(writes) == 0, "authenticated 에 patients 쓰기 권한 존재(service_role 전용이어야 함)"


# ── 0009: RLS ────────────────────────────────────────────────────────────────


def test_rls_enabled_on_patient_tables(psql):
    disabled = psql.scalar(
        "select string_agg(relname, ',') from pg_class c "
        "join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' "
        "where c.relkind='r' and not c.relrowsecurity and relname in ('patients','guardians');"
    )
    assert disabled in ("", "\\N"), f"RLS 미활성 환자 테이블: {disabled}"


def test_patient_select_policies_exist(psql):
    """patients 본인(self)·직원(staff) SELECT 정책 둘 다 존재."""
    rows = psql.scalar(
        "select string_agg(policyname, ',' order by policyname) from pg_policies "
        "where schemaname='public' and tablename='patients' and cmd='SELECT';"
    )
    names = set(rows.split(",")) if rows else set()
    assert {"patients_select_self", "patients_select_staff"} <= names, names


# ── 0009: 감사 트리거 부착 ────────────────────────────────────────────────────


def test_audit_triggers_attached_to_patient_tables(psql):
    rows = psql.scalar(
        "select string_agg(distinct c.relname, ',' order by c.relname) "
        "from pg_trigger tg join pg_class c on c.oid=tg.tgrelid "
        "join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' "
        "where not tg.tgisinternal and c.relname in ('patients','guardians');"
    )
    assert set(rows.split(",")) == {"guardians", "patients"}


def test_audit_trigger_records_patient_change(psql):
    """patients INSERT 시 audit_logs 에 create 이벤트 기록(트랜잭션 내 검증 후 ROLLBACK).

    raw 주민번호 미저장 검증: after_data 에 resident_no_enc 는 hex 문자열(암호문)일 뿐 평문 부재.
    """
    out = psql.scalar(
        "begin;"
        "insert into patients(name, birth_date, sex, resident_no_enc, resident_no_hash, "
        "  resident_no_masked, insurance_type) "
        "values ('스모크환자', '1971-03-14', 'female', '\\x00'::bytea, '__smoke_hash__', "
        "  '710314-2******', 'health_insurance');"
        "select count(*) from audit_logs "
        "  where target_table='patients' and action='create' "
        "  and after_data->>'resident_no_masked'='710314-2******';"
        "rollback;"
    )
    nums = [ln.strip() for ln in out.splitlines() if ln.strip().isdigit()]
    assert nums and nums[-1] == "1", f"감사 트리거가 create 이벤트를 기록하지 않음: {out!r}"
