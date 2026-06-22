"""오더(orders) 오케스트레이션(services 계층) — 검증·db 호출 → 응답 매핑.

처방 발행(Story 5.2): db.insert_prescription(헤더 + 상세 N 을 단일 txn 직접 INSERT) → 응답 매핑.
오더 생성은 전이 RPC 가 아니라 service_role 직접 쓰기(자유 CRUD — walk-in/medical_records 선례).
권한 재평가(TOCTOU)·내원/진단 검증·감사는 db/DB 가 동일 트랜잭션 소유. 에러(404·422·403)는 core/db
가 raise(AppError 계열). 향후 검사·처치 오더(5.3/5.4)도 이 모듈에 합류한다.
"""

from __future__ import annotations

from uuid import UUID

from app.core import db
from app.schemas.orders import PrescriptionCreate, PrescriptionResponse


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
