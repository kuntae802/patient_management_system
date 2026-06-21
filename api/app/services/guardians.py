"""보호자(guardians) 오케스트레이션(services 계층) — db 쓰기/읽기 → 응답 매핑.

보호자는 환자의 sub-resource(1:N). 추가·수정·삭제는 patient.update(라우터 게이트 + db in-txn
재평가), 조회는 patient.read. 불변식·감사는 DB 가 소유(0009 trg_guardians_audit). RRN·암호화 없음
(보호자는 주민번호 비수집) — 연락처(phone)는 평문 저장·반환(환자 phone 동형, reveal 게이트 이월).
"""

from __future__ import annotations

from uuid import UUID

import asyncpg

from app.core import db
from app.core.errors import NotFoundError
from app.schemas.guardians import GuardianCreate, GuardianResponse, GuardianUpdate


def _to_guardian(row: asyncpg.Record) -> GuardianResponse:
    return GuardianResponse.model_validate(dict(row))


async def list_guardians(sub: UUID, patient_id: UUID) -> list[GuardianResponse]:
    """환자의 보호자 목록(등록순). 게이트(patient.read)는 라우터가 강제."""
    rows = await db.fetch_guardians(sub, patient_id)
    return [_to_guardian(r) for r in rows]


async def create_guardian(
    sub: UUID, patient_id: UUID, payload: GuardianCreate
) -> GuardianResponse:
    """보호자 추가. 환자 미존재 → 404(db 가 FK 위반을 매핑). 게이트=라우터(patient.update)."""
    row = await db.insert_guardian(
        sub,
        patient_id,
        name=payload.name,
        relationship=payload.relationship,
        phone=payload.phone,
    )
    return _to_guardian(row)


async def update_guardian(
    sub: UUID, patient_id: UUID, guardian_id: UUID, payload: GuardianUpdate
) -> GuardianResponse:
    """보호자 수정(전체 교체). 미존재(환자/보호자) → 404. 게이트=라우터(patient.update)."""
    row = await db.update_guardian(
        sub,
        patient_id,
        guardian_id,
        name=payload.name,
        relationship=payload.relationship,
        phone=payload.phone,
    )
    if row is None:
        raise NotFoundError("보호자를 찾을 수 없습니다.")
    return _to_guardian(row)


async def delete_guardian(sub: UUID, patient_id: UUID, guardian_id: UUID) -> None:
    """보호자 삭제(hard delete). 미존재(환자/보호자) → 404. 게이트=라우터(patient.update)."""
    deleted_id = await db.delete_guardian(sub, patient_id, guardian_id)
    if deleted_id is None:
        raise NotFoundError("보호자를 찾을 수 없습니다.")
