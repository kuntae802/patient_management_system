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
from app.core.errors import AppError, ConflictError, NotFoundError
from app.schemas.encounters import EncounterListItem
from app.schemas.patients import (
    PatientClinicalProfileUpdate,
    PatientContactReveal,
    PatientCreate,
    PatientEncounterCard,
    PatientListItem,
    PatientResponse,
    PatientRrnReveal,
    PatientSelfLinkRequest,
    PatientSelfSummary,
)
from app.services import identity, rrn


def _to_patient(row: asyncpg.Record) -> PatientResponse:
    return PatientResponse.model_validate(dict(row))


def _to_self_summary(row: asyncpg.Record) -> PatientSelfSummary:
    return PatientSelfSummary.model_validate(dict(row))


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
    sub: UUID, *, q: str | None = None, page: int, page_size: int
) -> tuple[list[PatientListItem], int]:
    """환자 목록(최신순, 마스킹) + 건수. q(3.5)면 이름·차트번호·연락처 검색. 게이트=라우터."""
    rows, total = await db.fetch_patients(sub, q=q, page=page, page_size=page_size)
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


async def reveal_rrn(sub: UUID, patient_id: UUID) -> PatientRrnReveal:
    """주민번호 reveal(Story 4.5, FR-242). 권한 게이트(patient.reveal_rrn)+감사는 RPC(0012)가 강제.

    db.reveal_rrn 이 42501(→403)·PT404(→404)를 _map_pg_sqlstate 로 매핑. 반환 raw RRN 은 응답 바디
    전용(로그·에러 echo 금지). 미존재 환자 → 404(라우터/매핑)."""
    raw = await db.reveal_rrn(sub, patient_id)
    return PatientRrnReveal(resident_no=raw)


async def reveal_contact(sub: UUID, patient_id: UUID) -> PatientContactReveal:
    """연락처 reveal(Story 4.5, UX-DR22). 권한 게이트(reveal_contact)+감사는 RPC(0012)가 강제."""
    row = await db.reveal_contact(sub, patient_id)
    return PatientContactReveal.model_validate(dict(row))


async def list_patient_encounters(sub: UUID, patient_id: UUID) -> list[EncounterListItem]:
    """한 환자의 과거 내원 이력(Story 4.5, FR-031) — 진료 허브 좌 컨텍스트 타임라인. 최근순·조인.

    게이트=라우터 encounter.read. 진단/처방 per-visit 부착은 4.7/Epic5(이력 항목은 내원 메타만)."""
    rows = await db.fetch_patient_encounters(sub, patient_id)
    return [EncounterListItem.model_validate(dict(r)) for r in rows]


async def link_self_patient(sub: UUID, payload: PatientSelfLinkRequest) -> PatientSelfSummary:
    """앱 자가가입 본인 연결(Story 3.4, FR-003). RRN HARD 검증 → 본인인증 시뮬 → blind_index 매칭.

    연결 대상 `auth_uid` 는 **sub(JWT 주체)에서만** — 클라가 patient_id/uid 를 제공하지 않는다(세션
    uid 스코프). 분기별 HTTP 매핑: 성공(연결/멱등)=200, 미존재=404, 성명불일치=422, 연결충돌=409.
    """
    validation = rrn.validate_rrn(payload.resident_no)
    if not validation.is_valid:
        # HARD = 422. detail 은 기계용 코드만(원본 주민번호 미포함 — PII 경계, create_patient 미러).
        raise AppError(
            "주민번호가 올바르지 않습니다.",
            code="invalid_rrn",
            status_code=422,
            detail={"errors": list(validation.errors)},
        )

    # 본인인증 시뮬 seam(실 PASS 교체점). 시뮬 시대 사칭 방지는 아래 매칭의 성명 일치 가드가 1차선.
    identity.simulate_identity_verification(resident_no=payload.resident_no, name=payload.name)

    normalized = rrn.normalize_rrn(payload.resident_no)
    outcome, row = await db.link_self_patient(sub, normalized_rrn=normalized, name=payload.name)

    if outcome in ("linked", "already_linked"):
        assert row is not None  # 성공 분기는 항상 행 반환
        return _to_self_summary(row)
    if outcome == "no_patient_record":
        raise NotFoundError(
            "등록된 진료 기록이 없습니다. 병원 방문·문의 후 다시 연결해 주세요.",
            code="no_patient_record",
        )
    if outcome == "identity_mismatch":
        raise AppError(
            "입력하신 정보가 기록과 일치하지 않습니다. 병원에 문의해 주세요.",
            code="identity_mismatch",
            status_code=422,
        )
    if outcome == "already_linked_other":
        raise ConflictError("이미 가입·연결된 주민번호입니다.", code="already_linked_other")
    if outcome == "account_already_linked":
        raise ConflictError(
            "이 계정은 이미 다른 환자에 연결되어 있습니다.", code="account_already_linked"
        )
    raise AppError("자가연결을 처리하지 못했습니다.", code="self_link_failed")  # 방어적(미도달)


async def get_self_patient(sub: UUID) -> PatientSelfSummary | None:
    """본인(JWT sub)에 연결된 환자 요약 — 미연결 → None(라우터가 404 매핑)."""
    row = await db.fetch_self_patient(sub)
    return _to_self_summary(row) if row is not None else None


async def list_self_encounters(sub: UUID) -> list[PatientEncounterCard]:
    """본인(JWT sub) 내원 이력 카드(환자 포털 '내 기록', Story 8.1 / FR-120) — 최근순.

    세션 uid 스코프(auth_uid=sub, patient_id 클라 미수용). 미연결이면 빈 목록(프런트가 GET /self
    404 로 온보딩 유도 — 별도 에러 분기 불요). 게이트=라우터 get_current_patient(직원 403)."""
    rows = await db.fetch_self_encounters(sub)
    return [PatientEncounterCard.model_validate(dict(r)) for r in rows]
