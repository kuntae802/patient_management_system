"""Story 1.9 — core/db.py 암복호 래퍼 통합 테스트(asyncpg 생산 경로).

psql 테스트(test_migrations_crypto)가 DB 함수 자체를 검증한다면, 여기서는 FastAPI 가 실제로 쓰는
경로 — asyncpg 의 bytea 마샬링 + `authenticated_conn` GUC(app.actor_id) 주입 → 복호 자가-감사 actor
캡처 — 를 검증한다. 로컬 DB 미가용 시 skip.

⚠️ 복호는 audit_logs('read')를 커밋한다(append-only, 정상 동작). 'wrap-smoke' 표식 1행만 생성하며
   `supabase db reset` 으로 정리된다.
"""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from app.core import db


async def _pool_or_skip() -> None:
    try:
        await db.create_pool()
    except (asyncpg.PostgresError, OSError) as exc:  # 로컬 DB 미가용
        pytest.skip(f"로컬 DB 미가용 — supabase start 후 재실행 ({type(exc).__name__})")


async def test_crypto_wrappers_via_pool(psql) -> None:
    """encrypt→decrypt 라운드트립(bytea), blind_index 결정성, 복호 자가-감사 actor=sub."""
    await _pool_or_skip()
    sub = uuid.uuid4()
    try:
        ciphertext = await db.encrypt_sensitive(sub, "710314-2345678")
        assert isinstance(ciphertext, (bytes, bytearray)) and len(ciphertext) > 0

        plaintext = await db.decrypt_sensitive(
            sub, ciphertext=ciphertext, target_table="patients", target_id="wrap-smoke"
        )
        assert plaintext == "710314-2345678"

        h1 = await db.blind_index(sub, "7103142345678")
        h2 = await db.blind_index(sub, "7103142345678")
        assert h1 == h2 and len(h1) == 64  # sha256 hex
    finally:
        await db.close_pool()

    # 복호 자가-감사: authenticated_conn 이 주입한 app.actor_id(=sub)가 actor 로 캡처됐는지.
    row = psql.scalar(
        "select action || '|' || actor_id from audit_logs "
        "where target_id = 'wrap-smoke' order by created_at desc limit 1"
    )
    assert row == f"read|{sub}", f"복호 actor 캡처 실패: {row!r}"
