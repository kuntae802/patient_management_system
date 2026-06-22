"""감사 로그 조회 오케스트레이션(Story 1.10, FR-243). 읽기전용 — db 페이지 조회 → 응답 봉투 매핑.

단일 조회라 1.8(직원)처럼 두-시스템 보상은 없으나, 3계층 컨벤션(api/v1 → services → db)
일관성을 위해 Record→모델 매핑과 {data, meta} 봉투 조립을 여기서 담당한다. 불변식·감사·append-only
는 DB 가 소유하고, 이 경로는 SELECT 만 수행한다.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg

from app.core import db
from app.schemas.audit import AuditLogEntry, AuditLogPage, AuditPageMeta

# ── 감사 스냅샷 서버측 PII/건강민감 마스킹(Story 3.6) ─────────────────────────────
# 감사 트리거(0004)는 전체 행을 jsonb 로 스냅샷(append-only·포렌식). 응답으로 내보낼 때 민감 필드
# 값을 마스킹해 API 본문·구조적 로그로 평문 PII 가 새지 않게 한다(1차 권위; 웹 렌더 마스킹 1.10 은
# 방어심층). 필드명 기반(table-agnostic)·중첩 재귀 — 웹 `SENSITIVE_KEY`/`maskDeep` 의 거울.
# ⚠️ 이 키 집합은 web `audit.ts SENSITIVE_KEY` 와 **동일 유지**(한쪽만 바꾸면 드리프트).
# 항상-민감 키(table-agnostic) — 연락처·건강민감(프로필·SOAP)·암호/비밀. 어느 테이블이든 마스킹.
# SOAP(subjective/objective/assessment/plan) = medical_records 자유텍스트(Story 4.6).
# allergy_override_reason = prescription_details 알레르기 오버라이드 사유 자유텍스트(Story 5.5).
# content = nursing_record 간호기록/처치 수행 내용 자유 임상 서사(Story 5.7).
# findings·reading_conclusion = examinations 영상 판독 소견·결론 자유 임상 서사(Story 5.9).
_SENSITIVE_KEY = re.compile(
    r"(resident_no|rrn|ssn|password|passwd|secret|token|email|phone|address|guardian"
    r"|allergies|chronic_diseases|medications|notes|insurance_no"
    r"|subjective|objective|assessment|plan|allergy_override_reason|content"
    r"|findings|reading_conclusion"
    r"|_enc$|_hash$|_blind_index$|ciphertext)",
    re.IGNORECASE,
)
# `name` 은 테이블 의존 — 환자/보호자만 PII(masters 진료과명·roles 라벨은 비-PII, 감사 가독성 보존).
_PII_NAME_TABLES = frozenset({"patients", "guardians"})
_MASK_DISPLAY = "●●●● (마스킹됨)"  # 웹 MASK_DISPLAY 와 동일 표시


def _is_sensitive_key(key: str, name_is_pii: bool) -> bool:
    """항상-민감 키이거나, PII 테이블의 `name` 이면 True."""
    if _SENSITIVE_KEY.search(key):
        return True
    return name_is_pii and key.lower() == "name"


def _mask_value(value: Any) -> Any:
    """민감 키면 값 마스킹, 아니면 중첩(dict/list) 재귀 — 안쪽 PII 누출 봉쇄(웹 maskDeep 동형).

    중첩 경로는 테이블 컨텍스트가 없어 항상-민감 키만 적용(`name` 제외; 중첩 name 은 드문 엣지)."""
    if isinstance(value, dict):
        return {
            k: (_MASK_DISPLAY if _SENSITIVE_KEY.search(k) else _mask_value(v))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_mask_value(v) for v in value]
    return value


def mask_snapshot(
    data: dict[str, Any] | None, target_table: str | None = None
) -> dict[str, Any] | None:
    """감사 스냅샷(before/after 전체행 dict)의 민감 필드 값을 마스킹. None → None.

    값만 마스킹하고 키는 보존 — "어느 필드가 바뀌었나"(diff)는 유지, 값(PII)만 ●●●●. 비민감
    필드(action·chart_no·birth_date·sex·code·is_active 등)는 노출(감사 가독성). `name` 은
    target_table 이 patients/guardians 일 때만 마스킹(masters/roles 名 보존)."""
    if data is None:
        return None
    name_is_pii = target_table in _PII_NAME_TABLES
    return {
        k: (_MASK_DISPLAY if _is_sensitive_key(k, name_is_pii) else _mask_value(v))
        for k, v in data.items()
    }


def _to_entry(row: asyncpg.Record) -> AuditLogEntry:
    """DB Record → 감사 항목 모델. before/after 는 jsonb 코덱이 dict 디코드.

    스냅샷은 응답 직전 서버측 마스킹(Story 3.6) — 평문 PII 가 API 본문으로 안 나가게."""
    d = dict(row)
    table = d.get("target_table")
    d["before_data"] = mask_snapshot(d.get("before_data"), table)
    d["after_data"] = mask_snapshot(d.get("after_data"), table)
    return AuditLogEntry.model_validate(d)


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
