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
    DiagnosisAttach,
    DiagnosisPrimaryUpdate,
    EncounterCreate,
    EncounterDiagnosisResponse,
    EncounterListItem,
    EncounterPage,
    EncounterPageMeta,
    EncounterResponse,
    MedicalRecordResponse,
    MedicalRecordWrite,
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


async def start_consult(sub: UUID, encounter_id: UUID) -> EncounterResponse:
    """진찰 시작(start_consult RPC — registered→in_progress, 담당의=호출자, FR-030).

    미접수/종결/이미 진행중 → 409, 미존재 → 404, 권한 미보유(encounter.start) → 403
    (전부 RPC SQLSTATE → core/db 매핑). consult_started_at·doctor_id 세팅 반영 행 반환."""
    row = await db.call_start_consult(sub, encounter_id)
    return _to_encounter(row)


# ── SOAP 진료기록(medical_records, Story 4.6) ─────────────────────────────────
def _to_medical_record(row: asyncpg.Record) -> MedicalRecordResponse:
    return MedicalRecordResponse.model_validate(dict(row))


async def create_medical_record(
    sub: UUID, encounter_id: UUID, payload: MedicalRecordWrite
) -> MedicalRecordResponse:
    """SOAP 진료기록 생성(autosave 첫 저장). author_id=작성 의사(sub).

    미존재 내원 → 404, FK 위반 → 422, 권한 미보유 → 403(db 가 동일 트랜잭션 검증)."""
    row = await db.insert_medical_record(
        sub,
        encounter_id=encounter_id,
        author_id=sub,
        subjective=payload.subjective,
        objective=payload.objective,
        assessment=payload.assessment,
        plan=payload.plan,
    )
    return _to_medical_record(row)


async def update_medical_record(
    sub: UUID, encounter_id: UUID, record_id: UUID, payload: MedicalRecordWrite
) -> MedicalRecordResponse:
    """SOAP 진료기록 갱신(autosave 전체 교체). 미존재 기록 → 404, 권한 미보유 → 403."""
    row = await db.update_medical_record(
        sub,
        encounter_id=encounter_id,
        record_id=record_id,
        subjective=payload.subjective,
        objective=payload.objective,
        assessment=payload.assessment,
        plan=payload.plan,
    )
    return _to_medical_record(row)


async def list_medical_records(sub: UUID, encounter_id: UUID) -> list[MedicalRecordResponse]:
    """한 내원의 SOAP 진료기록 목록(최근순·1:N). 게이트=라우터(medical_record.read)."""
    rows = await db.fetch_medical_records(sub, encounter_id)
    return [_to_medical_record(r) for r in rows]


# ── 내원진단(encounter_diagnoses, Story 4.7) ──────────────────────────────────
def _to_encounter_diagnosis(row: asyncpg.Record) -> EncounterDiagnosisResponse:
    return EncounterDiagnosisResponse.model_validate(dict(row))


async def attach_diagnosis(
    sub: UUID, encounter_id: UUID, payload: DiagnosisAttach
) -> EncounterDiagnosisResponse:
    """KCD 진단 부착(FR-042). recorded_by=부착 의사(sub). 주상병 시 기존 강등(db 동일 트랜잭션).

    미존재 내원 → 404, 같은 코드 중복 → 409, 잘못된 diagnosis_id → 422, 권한 미보유 → 403."""
    row = await db.attach_diagnosis(
        sub,
        encounter_id=encounter_id,
        diagnosis_id=payload.diagnosis_id,
        is_primary=payload.is_primary,
        recorded_by=sub,
    )
    return _to_encounter_diagnosis(row)


async def set_diagnosis_primary(
    sub: UUID, encounter_id: UUID, ed_id: UUID, payload: DiagnosisPrimaryUpdate
) -> EncounterDiagnosisResponse:
    """주/부상병 토글. is_primary=true 면 기존 주상병 강등(db 동일 트랜잭션). 미존재 → 404."""
    row = await db.set_diagnosis_primary(
        sub, encounter_id=encounter_id, ed_id=ed_id, is_primary=payload.is_primary
    )
    return _to_encounter_diagnosis(row)


async def remove_diagnosis(sub: UUID, encounter_id: UUID, ed_id: UUID) -> None:
    """부착 진단 제거(soft delete). 미존재 → 404, 권한 미보유 → 403."""
    await db.remove_diagnosis(sub, encounter_id=encounter_id, ed_id=ed_id)


async def list_encounter_diagnoses(
    sub: UUID, encounter_id: UUID
) -> list[EncounterDiagnosisResponse]:
    """한 내원의 부착 진단 목록(주상병 우선·부착순). 게이트=라우터(diagnosis.read)."""
    rows = await db.fetch_encounter_diagnoses(sub, encounter_id)
    return [_to_encounter_diagnosis(r) for r in rows]


async def complete_encounter(sub: UUID, encounter_id: UUID) -> EncounterResponse:
    """진료 완료(complete_encounter RPC — in_progress→completed, 주상병 게이트; FR-042·UX-DR18).

    주상병 미지정 → 422, 잘못된 전이(비-in_progress) → 409, 미존재 → 404, 권한 미보유 → 403
    (전부 RPC SQLSTATE → core/db 매핑). completed_at 세팅 반영 행 반환."""
    row = await db.call_complete_encounter(sub, encounter_id)
    return _to_encounter(row)
