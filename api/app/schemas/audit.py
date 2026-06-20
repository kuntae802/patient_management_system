"""감사 로그 조회 스키마(Story 1.10, FR-243). 읽기전용 — 쓰기 모델 없음(append-only는 DB가 강제).

전 필드 snake_case(두 읽기 경로 일관, project-context). `audit_logs`(0004)의 거울 + actor 이름
조인 결과. before/after 스냅샷은 jsonb 그대로 노출하되 **민감 필드 마스킹은 web 렌더 계층**에서
수행한다(스냅샷에 잠재된 PII는 표시 단에서 차단, UX-DR22). raw 주민번호/PII는 응답·로그에 평문으로
남기지 않는다(현재 스냅샷은 roles·permissions·role_permissions·users 만 → PII 부재).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel

# 동작 종류 — 0004 audit_logs.action CHECK 거울. read=PII reveal(복호), login=의도(emit 미구현).
AuditAction = Literal["create", "read", "update", "delete", "login"]


class AuditLogEntry(BaseModel):
    """감사 항목(목록·상세 공용). actor_name/employee_no = users LEFT JOIN(NULL=시스템·삭제)."""

    id: UUID
    actor_id: UUID | None = None
    actor_name: str | None = None
    actor_employee_no: str | None = None
    action: AuditAction
    target_table: str
    target_id: str | None = None
    # 변경 전/후 전체행 스냅샷(create=before null, delete=after null). 마스킹은 web 렌더 계층.
    before_data: dict[str, Any] | None = None
    after_data: dict[str, Any] | None = None
    # 현재 항상 null(데드 와이어 — app.actor_ip 미주입, db.py:81). 컬럼·필드는 미래 대비 보존.
    ip_address: str | None = None
    created_at: datetime


class AuditPageMeta(BaseModel):
    """페이지네이션 메타(아키텍처 §Format Patterns: 목록 = {data, meta:{page,page_size,total}})."""

    page: int
    page_size: int
    total: int


class AuditLogPage(BaseModel):
    """감사 로그 페이지 응답 봉투. 코드베이스 최초의 페이지네이션 목록 봉투(후속 목록의 표준)."""

    data: list[AuditLogEntry]
    meta: AuditPageMeta
