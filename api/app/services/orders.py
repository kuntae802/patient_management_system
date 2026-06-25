"""오더(orders) 오케스트레이션(services 계층) — 검증·db 호출 → 응답 매핑.

처방 발행(Story 5.2): db.insert_prescription(헤더 + 상세 N 을 단일 txn 직접 INSERT) → 응답 매핑.
오더 생성은 전이 RPC 가 아니라 service_role 직접 쓰기(자유 CRUD — walk-in/medical_records 선례).
권한 재평가(TOCTOU)·내원/진단 검증·감사는 db/DB 가 동일 트랜잭션 소유. 에러(404·422·403)는 core/db
가 raise(AppError 계열). 향후 검사·처치 오더(5.3/5.4)도 이 모듈에 합류한다.
"""

from __future__ import annotations

from uuid import UUID

from app.core import db
from app.schemas.orders import (
    ExaminationCreate,
    ExaminationResponse,
    PrescriptionCreate,
    PrescriptionDocumentResponse,
    PrescriptionResponse,
    TreatmentOrderCreate,
    TreatmentOrderResponse,
)


def _to_prescription(row: dict[str, object]) -> PrescriptionResponse:
    """db 의 dict 트리({헤더..., "details":[상세 dict...]}) → PrescriptionResponse(중첩 검증)."""
    return PrescriptionResponse.model_validate(row)


async def create_prescription(
    sub: UUID, encounter_id: UUID, payload: PrescriptionCreate
) -> PrescriptionResponse:
    """처방전 발행(FR-050·FR-051) — 헤더 + 상세 라인 원자적 생성. ordered_by=발행 의사(sub).

    미존재 내원 → 404, 타 내원/비활성 근거 진단 → 422, 잘못된 약품 → 422, 권한 미보유 → 403
    (전부 db 가 동일 트랜잭션 검증·raise)."""
    row = await db.insert_prescription(
        sub,
        encounter_id=encounter_id,
        ordered_by=sub,
        encounter_diagnosis_id=payload.encounter_diagnosis_id,
        details=[d.model_dump() for d in payload.details],
    )
    return _to_prescription(row)


async def list_prescriptions(sub: UUID, encounter_id: UUID) -> list[PrescriptionResponse]:
    """한 내원의 발행 처방전 목록(헤더 최신순 + 상세 1:N). 게이트=라우터(order.read)."""
    rows = await db.fetch_prescriptions(sub, encounter_id)
    return [_to_prescription(r) for r in rows]


async def cancel_prescription(
    sub: UUID, encounter_id: UUID, prescription_id: UUID
) -> PrescriptionResponse:
    """처방 취소(issued→cancelled·0056). 게이트=라우터(order.cancel).

    cancel_prescription RPC 가 전이·종결내원 게이트·감사를 동일 txn 소유. 타 내원/미존재 → 404,
    비-issued(이미 발급/취소) → 409, 권한 미보유 → 403(전부 db/RPC raise). 반환 = 갱신 처방."""
    row = await db.cancel_prescription(sub, encounter_id, prescription_id)
    return _to_prescription(row)


async def get_prescription_document(sub: UUID, encounter_id: UUID) -> PrescriptionDocumentResponse:
    """원외처방전 문서 데이터 조립(Story 7.7·FR-115). 게이트=라우터(prescription.dispense).

    요양기관·환자(masked RRN)·진료·발행/발급 처방 1:N(면허·KCD·약품 라인). 미존재 내원 → 404
    (db 가 raise). payment 무관(finalize 게이트 없음)."""
    row = await db.fetch_prescription_document(sub, encounter_id)
    return PrescriptionDocumentResponse.model_validate(row)


async def dispense_prescription(
    sub: UUID, encounter_id: UUID, prescription_id: UUID
) -> PrescriptionResponse:
    """원외처방전 발급(issued→dispensed·Story 7.7·FR-115). 게이트=라우터(prescription.dispense).

    dispense_prescription RPC(0050)가 전이·감사를 동일 txn 소유. 타 내원/미존재 → 404, 비-issued
    재발급 → 409, 권한 미보유 → 403(전부 db/RPC 가 raise·_map_pg_sqlstate). 반환 = 갱신 처방."""
    row = await db.dispense_prescription(sub, encounter_id, prescription_id)
    return _to_prescription(row)


async def export_prescription_document(
    sub: UUID, encounter_id: UUID, prescription_id: UUID, document_type: str
) -> None:
    """처방전 인쇄/내보내기 = 감사 기록(Story 7.7·UX-DR22). 게이트=라우터(prescription.dispense).

    log_prescription_document_export RPC(0050)가 audit_logs 'read'(target='prescriptions') 소유.
    타 내원/미존재 → 404, 권한 미보유 → 403."""
    await db.log_prescription_document_export(sub, encounter_id, prescription_id, document_type)


def _to_examination(row: dict[str, object]) -> ExaminationResponse:
    """db 의 fee 조인 dict → ExaminationResponse(단건 평면 — 중첩 없음)."""
    return ExaminationResponse.model_validate(row)


async def create_examination(
    sub: UUID, encounter_id: UUID, payload: ExaminationCreate
) -> ExaminationResponse:
    """검사·영상 오더 생성(FR-060·FR-061) — examinations 단건 INSERT. ordered_by=지시 의사(sub).

    exam_type(lab/imaging)이 워크리스트 라우팅 분류 축. 미존재 내원 → 404, 잘못된 검사 행위 → 422,
    권한 미보유 → 403(전부 db 가 동일 트랜잭션 검증·raise)."""
    row = await db.insert_examination(
        sub,
        encounter_id=encounter_id,
        exam_type=payload.exam_type,
        fee_schedule_id=payload.fee_schedule_id,
        ordered_by=sub,
    )
    return _to_examination(row)


async def list_examinations(sub: UUID, encounter_id: UUID) -> list[ExaminationResponse]:
    """한 내원의 검사·영상 오더 목록(최신순, fee 조인). 게이트=라우터(order.read)."""
    rows = await db.fetch_examinations(sub, encounter_id)
    return [_to_examination(r) for r in rows]


async def cancel_examination(
    sub: UUID, encounter_id: UUID, examination_id: UUID
) -> ExaminationResponse:
    """검사·영상 오더 취소(ordered→cancelled·0056). 게이트=라우터(order.cancel).

    cancel_examination RPC 가 전이·종결내원 게이트·감사를 동일 txn 소유. 타 내원/미존재 → 404,
    비-ordered(수행/완료/취소) → 409, 권한 미보유 → 403(전부 db/RPC raise). 반환 = 갱신 검사."""
    row = await db.call_cancel_examination(
        sub, encounter_id=encounter_id, examination_id=examination_id
    )
    return _to_examination(row)


def _to_treatment_order(row: dict[str, object]) -> TreatmentOrderResponse:
    """db 의 fee 조인 dict → TreatmentOrderResponse(단건 평면 — 중첩 없음)."""
    return TreatmentOrderResponse.model_validate(row)


async def create_treatment_order(
    sub: UUID, encounter_id: UUID, payload: TreatmentOrderCreate
) -> TreatmentOrderResponse:
    """처치 오더 생성(FR-070) — treatment_orders 단건 INSERT. ordered_by=지시 의사(sub).

    간호 워크리스트로 전달(단일 라우팅 — 검사의 exam_type 분기 없음). 미존재 내원 → 404,
    잘못된 처치 행위 → 422, 권한 미보유 → 403(전부 db 가 동일 트랜잭션 검증·raise)."""
    row = await db.insert_treatment_order(
        sub,
        encounter_id=encounter_id,
        fee_schedule_id=payload.fee_schedule_id,
        ordered_by=sub,
    )
    return _to_treatment_order(row)


async def list_treatment_orders(sub: UUID, encounter_id: UUID) -> list[TreatmentOrderResponse]:
    """한 내원의 처치 오더 목록(최신순, fee 조인). 게이트=라우터(order.read)."""
    rows = await db.fetch_treatment_orders(sub, encounter_id)
    return [_to_treatment_order(r) for r in rows]


async def cancel_treatment_order(
    sub: UUID, encounter_id: UUID, order_id: UUID
) -> TreatmentOrderResponse:
    """처치 오더 취소(ordered→cancelled·0056). 게이트=라우터(order.cancel).

    cancel_treatment_order RPC 가 전이·종결내원 게이트·감사를 동일 txn 소유. 타 내원/미존재 → 404,
    비-ordered → 409, 권한 미보유 → 403(전부 db/RPC raise). 반환 = 갱신 처치 오더."""
    row = await db.call_cancel_treatment_order(sub, encounter_id=encounter_id, order_id=order_id)
    return _to_treatment_order(row)
