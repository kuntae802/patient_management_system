"""Story 1.9 — 암복호 프리미티브(0005_crypto.sql) 마이그레이션 스모크 검증.

검증 대상: Vault 키 보관, service_role 한정 SECURITY DEFINER 암복호 RPC,
HMAC blind index(결정적), 복호 자가-감사('read' 이벤트), 평문 키 부재.
실제 적용된 로컬 DB(`supabase db reset` 선행)를 단언한다 — 미실행 시 skip(conftest psql 픽스처).

순수 정적 검사(평문 키 부재)는 DB 불요라 psql 픽스처 없이 항상 실행한다.
"""

from __future__ import annotations

import re
from pathlib import Path

_MIGRATION = (
    Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "0005_crypto.sql"
)
_CRYPTO_FNS = ("encrypt_sensitive", "decrypt_sensitive", "blind_index")
_SMOKE_ACTOR = "11111111-2222-3333-4444-555555555555"


# ── 정적 검사: 평문 키가 마이그레이션 파일에 없음(FR-241) ─────────────────────


def test_migration_has_no_plaintext_key() -> None:
    """키는 DB 안에서 gen_random_bytes 로 생성 — 파일에 평문 키 리터럴이 없어야 한다."""
    sql = _MIGRATION.read_text(encoding="utf-8")
    assert "extensions.gen_random_bytes(32)" in sql, "키를 DB에서 생성하지 않음"
    # create_secret 의 첫 인자가 따옴표 리터럴(평문 키)이면 안 됨 — encode(...) 표현식이어야 한다.
    assert not re.search(r"create_secret\(\s*'", sql), "create_secret 에 평문 키 리터럴이 있음"
    # 32바이트 hex(=64+자) 리터럴이 통째로 박혀 있으면 안 됨.
    assert not re.search(r"'[0-9a-fA-F]{32,}'", sql), "긴 hex 리터럴(키 의심)이 파일에 있음"


# ── 함수 존재 · SECURITY DEFINER · search_path ───────────────────────────────


def test_crypto_functions_are_security_definer_with_search_path(psql) -> None:
    rows = psql.scalar(
        "select string_agg(proname, ',' order by proname) from pg_proc p "
        "join pg_namespace n on n.oid=p.pronamespace and n.nspname='public' "
        "where p.prosecdef "
        "and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') "
        f"and proname in {_CRYPTO_FNS};"
    )
    assert set(rows.split(",")) == set(_CRYPTO_FNS), f"SECURITY DEFINER+search_path 누락: {rows}"


# ── 권한 posture: service_role only ──────────────────────────────────────────


def test_crypto_functions_service_role_only(psql) -> None:
    """service_role 만 EXECUTE, authenticated/anon 은 거부(직접 클라 호출 차단)."""
    for fn in (
        "public.encrypt_sensitive(text)",
        "public.decrypt_sensitive(bytea,text,text)",
        "public.blind_index(text)",
    ):
        sr = psql.scalar(f"select has_function_privilege('service_role','{fn}','execute');")
        assert sr == "t", f"service_role 이 {fn} 실행 불가"
        for role in ("authenticated", "anon"):
            got = psql.scalar(f"select has_function_privilege('{role}','{fn}','execute');")
            assert got == "f", f"{role} 이 {fn} 실행 가능하면 안 됨"


# ── Vault 키(이름만 확인, 값 비노출) ─────────────────────────────────────────


def test_vault_keys_present(psql) -> None:
    names = psql.scalar(
        "select string_agg(name, ',' order by name) from vault.secrets "
        "where name in ('pms_pii_enc_key','pms_pii_hmac_key');"
    )
    assert set(names.split(",")) == {"pms_pii_enc_key", "pms_pii_hmac_key"}


def test_encrypt_raises_when_vault_key_missing(psql) -> None:
    """키 부재 시 조용한 암호화 누락 대신 명시적 예외(방어심층). 키 삭제는 ROLLBACK."""
    err = psql.expect_error(
        "begin;"
        "delete from vault.secrets where name='pms_pii_enc_key';"
        "select public.encrypt_sensitive('x');"
        "rollback;"
    )
    assert "pms_pii_enc_key" in err, f"키 누락 명시 예외가 아님: {err}"


# ── 라운드트립 + 결정성 ──────────────────────────────────────────────────────


def test_encrypt_decrypt_roundtrip(psql) -> None:
    """encrypt → decrypt 라운드트립(복호는 자가-감사하므로 트랜잭션 ROLLBACK)."""
    out = psql.scalar(
        "begin;"
        "select public.decrypt_sensitive("
        "  public.encrypt_sensitive('710314-2345678'),'patients','rt-smoke')='710314-2345678';"
        "rollback;"
    )
    flags = [ln.strip() for ln in out.splitlines() if ln.strip() in ("t", "f")]
    assert flags and flags[-1] == "t", f"라운드트립 실패: {out!r}"


def test_blind_index_deterministic(psql) -> None:
    same = psql.scalar(
        "select public.blind_index('7103142345678')=public.blind_index('7103142345678');"
    )
    assert same == "t", "같은 입력의 blind_index 가 다름(결정성 위반)"
    distinct = psql.scalar("select public.blind_index('a') <> public.blind_index('b');")
    assert distinct == "t", "다른 입력의 blind_index 가 같음(충돌)"


# ── 복호 = 감사('read') · 값 미저장(AC3) ─────────────────────────────────────


def test_decrypt_self_audits_read_event(psql) -> None:
    """복호 시 audit_logs 에 'read' 행이 actor·target 과 함께 기록되고, raw 값은 저장되지 않는다."""
    out = psql.scalar(
        "begin;"
        f"select set_config('app.actor_id','{_SMOKE_ACTOR}',true);"
        "select public.decrypt_sensitive(public.encrypt_sensitive('val'),'patients','audit-smoke');"
        "select (count(*)=1 "
        "  and bool_and(action='read') "
        f"  and bool_and(actor_id='{_SMOKE_ACTOR}') "
        "  and bool_and(target_table='patients' and target_id='audit-smoke') "
        "  and bool_and(before_data is null and after_data is null)) "
        "from audit_logs where target_id='audit-smoke';"
        "rollback;"
    )
    flags = [ln.strip() for ln in out.splitlines() if ln.strip() in ("t", "f")]
    assert flags and flags[-1] == "t", f"복호 자가-감사가 올바르지 않음: {out!r}"
