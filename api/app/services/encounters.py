"""내원(encounters) 오케스트레이션(services 계층) — 검증·RPC 호출 → 응답 매핑.

walk-in: db.insert_walk_in_encounter(직접 INSERT status='registered', RPC 미경유 — Open Q1) →
대기열 진입(department_id+status 행 자체). 예약 접수: register_scheduled_encounter
가 register_encounter RPC 소비(scheduled→registered). 환자·진료과 활성 검증·권한 재평가는 db 가 동일
트랜잭션에서(TOCTOU). 상태머신·감사는 DB 소유(0010 — 재구현 금지). 에러(PT409→409·PT404→404·
42501→403)는 core/db 가 SQLSTATE 매핑.
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

import asyncpg

from app.core import db
from app.core.errors import NotFoundError
from app.schemas.encounters import (
    EncounterCreate,
    EncounterListItem,
    EncounterPage,
    EncounterPageMeta,
    EncounterResponse,
)

# 대기 현황판 "오늘" 기준 = 병원 운영 시간대(KST). timestamptz 는 UTC 저장 → KST 날짜로 환산해 조회.
_KST = ZoneInfo("Asia/Seoul")


def _to_encounter(row: asyncpg.Record) -> EncounterResponse:
    return EncounterResponse.model_validate(dict(row))


async def create_walk_in_encounter(sub: UUID, payload: EncounterCreate) -> EncounterResponse:
    """walk-in 접수 — 내원 생성(status='registered') + 진료과 대기열 진입.

    미존재 → 404, 비활성 환자/진료과 → 422(db 가 동일 트랜잭션 검증). created_by = 접수자(sub)."""
    row = await db.insert_walk_in_encounter(
        sub,
        patient_id=payload.patient_id,
        department_id=payload.department_id,
        created_by=sub,
        room_id=payload.room_id,
    )
    return _to_encounter(row)


async def register_scheduled_encounter(sub: UUID, encounter_id: UUID) -> EncounterResponse:
    """예약 환자 도착 접수 — register_encounter RPC(scheduled→registered).

    잘못된 전이 → 409, 미존재 → 404, 권한 미보유 → 403(전부 RPC SQLSTATE → core/db 매핑)."""
    row = await db.call_register_encounter(sub, encounter_id)
    return _to_encounter(row)


async def get_encounter(sub: UUID, encounter_id: UUID) -> EncounterResponse:
    """내원 단건 조회(접수 결과·상세). 미존재 → 404. 게이트=라우터(encounter.read)."""
    row = await db.fetch_encounter(sub, encounter_id)
    if row is None:
        raise NotFoundError("내원을 찾을 수 없습니다.", detail={"encounter_id": str(encounter_id)})
    return _to_encounter(row)


async def list_encounters(
    sub: UUID,
    *,
    department_id: UUID,
    statuses: list[str] | None = None,
    on_date: date | None = None,
    page: int = 1,
    page_size: int = 200,
) -> EncounterPage:
    """대기 현황판 목록(진료과 × 일자 × 상태) — {data, meta} 페이지. 게이트=라우터(encounter.read).

    일자 미지정 시 오늘(KST) — 종결 누적행을 일자-스코프로 바운드. 정렬은 db.fetch_encounters."""
    target_date = on_date or datetime.now(_KST).date()
    rows, total = await db.fetch_encounters(
        sub,
        department_id=department_id,
        statuses=statuses,
        on_date=target_date,
        page=page,
        page_size=page_size,
    )
    items = [EncounterListItem.model_validate(dict(r)) for r in rows]
    return EncounterPage(
        data=items, meta=EncounterPageMeta(page=page, page_size=page_size, total=total)
    )


async def record_call(sub: UUID, encounter_id: UUID) -> EncounterResponse:
    """환자 호출 기록(record_encounter_call RPC — 호출은 전이 아님, registered 행만).

    미접수/진행중/종결 → 409, 미존재 → 404, 권한 미보유 → 403(전부 RPC SQLSTATE → core/db 매핑)."""
    row = await db.call_encounter(sub, encounter_id)
    return _to_encounter(row)
