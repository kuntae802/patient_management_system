"""간호(nursing) 오케스트레이션(services 계층) — 검증·db 호출 → 응답 매핑.

활력징후 기록(Story 5.6, FR-091): db.insert_vital_signs(단건 직접 INSERT) → 응답 매핑. 활력은 전이
RPC 가 아니라 service_role 직접 쓰기(구조화 수치·불변식 없음 — medical_records 선례). 권한 재평가
(TOCTOU)·내원 검증·감사는 db/DB 가 동일 트랜잭션 소유. 에러(404·422·403)는 core/db 가 raise.

워크리스트(AC3): 오늘(KST) 활성 내원 목록 — 일자 계산은 서비스(list_encounters 동형), 조인은 db.
향후 일상 간호기록·처치 수행(5.7)도 이 모듈에 합류한다.
"""

from __future__ import annotations

from uuid import UUID

from app.core import db
from app.schemas.nursing import (
    NursingRecordCreate,
    NursingRecordResponse,
    NursingWorklistItem,
    TreatmentPerformBody,
    VitalSignsCreate,
    VitalSignsResponse,
    VitalsWorklistItem,
)
from app.schemas.orders import TreatmentOrderResponse


def _to_vital_signs(row: dict[str, object]) -> VitalSignsResponse:
    """db 의 users 조인 dict → VitalSignsResponse(수치·측정자명 검증)."""
    return VitalSignsResponse.model_validate(row)


async def create_vital_signs(
    sub: UUID, encounter_id: UUID, payload: VitalSignsCreate
) -> VitalSignsResponse:
    """활력징후 기록(FR-091) — vital_signs 단건 INSERT. recorded_by=기록 간호사(sub).

    미존재 내원 → 404, 빈 활력/범위 위반 → 422(Pydantic 1차·DB CHECK 백스톱), 권한 미보유 → 403
    (db 가 동일 트랜잭션 검증·raise).
    """
    row = await db.insert_vital_signs(
        sub,
        encounter_id=encounter_id,
        recorded_by=sub,
        systolic=payload.systolic,
        diastolic=payload.diastolic,
        pulse=payload.pulse,
        body_temp=payload.body_temp,
        respiratory_rate=payload.respiratory_rate,
        spo2=payload.spo2,
        notes=payload.notes,
    )
    return _to_vital_signs(row)


async def list_vital_signs(sub: UUID, encounter_id: UUID) -> list[VitalSignsResponse]:
    """한 내원의 활력징후 목록(최신순). 게이트=라우터(encounter.read ∨ vital.record)."""
    rows = await db.fetch_vital_signs(sub, encounter_id)
    return [_to_vital_signs(r) for r in rows]


async def list_vitals_worklist(sub: UUID) -> list[VitalsWorklistItem]:
    """활력 워크리스트(AC3) — 활성 내원. 게이트=라우터(vital.record)."""
    rows = await db.fetch_vitals_worklist(sub)
    return [VitalsWorklistItem.model_validate(r) for r in rows]


# ── 처치 수행·일상 간호기록(Story 5.7 / FR-090·FR-092·FR-093·FR-094) ──────────────────


async def perform_treatment_order(
    sub: UUID, encounter_id: UUID, order_id: UUID, payload: TreatmentPerformBody
) -> TreatmentOrderResponse:
    """처치 오더 수행(FR-090·FR-092·FR-093) — perform_treatment_order RPC(ordered→performed).

    재수행(이미 performed) → 409 invalid_transition, 미존재 → 404, 권한 → 403(db/RPC raise).
    content 입력 시 연결 nursing_record 생성. 응답 = 갱신된 처치 오더(performed_by/at 반영).
    """
    row = await db.call_perform_treatment_order(
        sub, encounter_id=encounter_id, order_id=order_id, content=payload.content
    )
    return TreatmentOrderResponse.model_validate(row)


async def create_nursing_record(
    sub: UUID, encounter_id: UUID, payload: NursingRecordCreate
) -> NursingRecordResponse:
    """일상 간호기록 생성(FR-094) — 오더 없음(treatment_order_id=None). recorded_by=기록 간호사.

    미존재 내원 → 404, 빈/공백 content → 422(Pydantic 1차·DB CHECK 백스톱), 권한 → 403.
    """
    row = await db.insert_nursing_record(
        sub,
        encounter_id=encounter_id,
        treatment_order_id=None,
        content=payload.content,
        recorded_by=sub,
    )
    return NursingRecordResponse.model_validate(row)


async def list_nursing_records(sub: UUID, encounter_id: UUID) -> list[NursingRecordResponse]:
    """한 내원의 간호기록 목록(최신순). 게이트=라우터(order.read ∨ nursing.record)."""
    rows = await db.fetch_nursing_records(sub, encounter_id)
    return [NursingRecordResponse.model_validate(r) for r in rows]


async def list_nursing_worklist(sub: UUID) -> list[NursingWorklistItem]:
    """간호 워크리스트(Story 5.7) — 활성 내원 + 미수행 처치·간호기록 건수.

    게이트=라우터(require_any treatment.perform ∨ nursing.record).
    """
    rows = await db.fetch_nursing_worklist(sub)
    return [NursingWorklistItem.model_validate(r) for r in rows]
