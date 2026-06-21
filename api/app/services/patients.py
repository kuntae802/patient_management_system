"""환자(patients) 오케스트레이션(services 계층) — 검증·파생 → db 쓰기/읽기 → 응답 매핑.

생성 흐름(원무 직접 등록):
  1. services/rrn.validate_rrn — HARD 실패 시 422(invalid_rrn). 원본 값은 응답·로그에 echo 안 함.
  2. normalize_rrn → blind_index/encrypt 입력 / mask_rrn(표시값) / parse_rrn(birth_date·sex 파생).
  3. db.insert_patient — 권한 동일 트랜잭션 재평가(TOCTOU) + encrypt/blind_index + INSERT(중복→409).
불변식·감사는 DB 가 소유(0009 트리거). 읽기(목록·상세)는 마스킹 컬럼만 반환(_enc/_hash 미노출).
"""

from __future__ import annotations

from uuid import UUID

import asyncpg

from app.core import db
from app.core.errors import AppError, NotFoundError
from app.schemas.patients import (
    PatientClinicalProfileUpdate,
    PatientCreate,
    PatientListItem,
    PatientResponse,
)
from app.services import rrn


def _to_patient(row: asyncpg.Record) -> PatientResponse:
    return PatientResponse.model_validate(dict(row))


def _to_list_item(row: asyncpg.Record) -> PatientListItem:
    return PatientListItem.model_validate(dict(row))


async def create_patient(sub: UUID, payload: PatientCreate) -> PatientResponse:
    """환자 생성. 주민번호 HARD 검증 → 암호화·blind_index·마스킹 → INSERT. 중복(hash) → 409."""
    validation = rrn.validate_rrn(payload.resident_no)
    if not validation.is_valid:
        # detail 은 기계용 코드만(원본 주민번호 미포함 — PII 경계). HARD = 422.
        raise AppError(
            "주민번호가 올바르지 않습니다.",
            code="invalid_rrn",
            status_code=422,
            detail={"errors": list(validation.errors)},
        )

    normalized = rrn.normalize_rrn(payload.resident_no)
    masked = rrn.mask_rrn(payload.resident_no)
    birth_date, sex = rrn.parse_rrn(payload.resident_no)

    row = await db.insert_patient(
        sub,
        normalized_rrn=normalized,
        masked_rrn=masked,
        birth_date=birth_date,
        sex=sex,
        name=payload.name,
        phone=payload.phone,
        address=payload.address,
        email=payload.email,
        insurance_type=payload.insurance_type,
        insurance_no=payload.insurance_no,
    )
    return _to_patient(row)


async def list_patients(
    sub: UUID, *, page: int, page_size: int
) -> tuple[list[PatientListItem], int]:
    """환자 목록(최신순, 마스킹) + 전체 건수. 권한 게이트(patient.read)는 라우터가 강제."""
    rows, total = await db.fetch_patients(sub, page=page, page_size=page_size)
    return [_to_list_item(r) for r in rows], total


async def get_patient(sub: UUID, patient_id: UUID) -> PatientResponse:
    """환자 상세(마스킹 + 임상 프로필). 미존재 → 404."""
    row = await db.fetch_patient(sub, patient_id)
    if row is None:
        raise NotFoundError("환자를 찾을 수 없습니다.")
    return _to_patient(row)


async def update_clinical_profile(
    sub: UUID, patient_id: UUID, payload: PatientClinicalProfileUpdate
) -> PatientResponse:
    """임상 프로필 갱신(Story 3.2, FR-004). 5필드 전체 교체. 미존재 → 404. 게이트=라우터."""
    row = await db.update_patient_clinical_profile(
        sub,
        patient_id,
        blood_type=payload.blood_type,
        allergies=payload.allergies,
        chronic_diseases=payload.chronic_diseases,
        medications=payload.medications,
        notes=payload.notes,
    )
    if row is None:
        raise NotFoundError("환자를 찾을 수 없습니다.")
    return _to_patient(row)
