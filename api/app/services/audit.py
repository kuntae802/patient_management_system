"""감사 로그 조회 오케스트레이션(Story 1.10, FR-243). 읽기전용 — db 페이지 조회 → 응답 봉투 매핑.

단일 조회라 1.8(직원)처럼 두-시스템 보상은 없으나, 3계층 컨벤션(api/v1 → services → db)
일관성을 위해 Record→모델 매핑과 {data, meta} 봉투 조립을 여기서 담당한다. 불변식·감사·append-only
는 DB 가 소유하고, 이 경로는 SELECT 만 수행한다.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

import asyncpg

from app.core import db
from app.schemas.audit import AuditLogEntry, AuditLogPage, AuditPageMeta


def _to_entry(row: asyncpg.Record) -> AuditLogEntry:
    """DB Record(조인 결과 셰이프) → 감사 항목 모델. before/after 는 jsonb 코덱이 dict 로 디코드."""
    return AuditLogEntry.model_validate(dict(row))


async def list_audit_logs(
    sub: UUID,
    *,
    actor_id: UUID | None = None,
    action: str | None = None,
    target_table: str | None = None,
    target_id: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    page: int = 1,
    page_size: int = 50,
) -> AuditLogPage:
    """감사 로그 페이지 조회 → {data, meta} 봉투. 게이트는 라우터 audit.read."""
    rows, total = await db.fetch_audit_logs(
        sub,
        actor_id=actor_id,
        action=action,
        target_table=target_table,
        target_id=target_id,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
    )
    return AuditLogPage(
        data=[_to_entry(row) for row in rows],
        meta=AuditPageMeta(page=page, page_size=page_size, total=total),
    )
