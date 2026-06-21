"""환자(patients) 명령·조회 라우터 — 원무 직접 등록 + 마스킹 조회. Story 3.1 / FR-002·003·240.

쓰기 권위(FastAPI/service_role): 환자 INSERT 는 이 경로로만(authenticated 는 patients 쓰기 권한
없음, 0009). 게이트 = require_permission('patient.create') → 403. 실제 쓰기는 db.insert_patient 가
권한을 동일 트랜잭션에서 재평가(TOCTOU 차단) + 0005 프리미티브로 암호화·blind_index, 0009 감사
트리거가 변경을 자동 기록(actor=원무). 조회(목록·상세)는 require_permission('patient.read') + 마스킹
컬럼만 반환(_enc/_hash 미노출). reveal(복호) 엔드포인트는 첫 노출처(3.3/Epic 4) — 본 스토리 범위 밖.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.core.security import CurrentUser, require_permission
from app.schemas.patients import (
    PatientCreate,
    PatientPage,
    PatientPageMeta,
    PatientResponse,
)
from app.services import patients as patients_service

router = APIRouter(prefix="/patients", tags=["patients"])

# 권한 의존성은 모듈 로드 시 1회 생성(요청마다 팩토리 호출 회피).
require_patient_create = require_permission("patient.create")
require_patient_read = require_permission("patient.read")


@router.post("", response_model=PatientResponse, status_code=status.HTTP_201_CREATED)
async def create_patient(
    payload: PatientCreate,
    user: CurrentUser = Depends(require_patient_create),
) -> PatientResponse:
    """환자 생성(원무 직접 등록, auth_uid 미설정).

    HARD 실패 → 422 invalid_rrn.
    중복 → 409 patient_exists(기존 chart_no 안내)."""
    return await patients_service.create_patient(user.sub, payload)


@router.get("", response_model=PatientPage)
async def list_patients(
    user: CurrentUser = Depends(require_patient_read),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> PatientPage:
    """환자 목록(최신순, 마스킹) — 페이지네이션 봉투 {data, meta}. 권한 없으면 403."""
    items, total = await patients_service.list_patients(user.sub, page=page, page_size=page_size)
    meta = PatientPageMeta(page=page, page_size=page_size, total=total)
    return PatientPage(data=items, meta=meta)


@router.get("/{patient_id}", response_model=PatientResponse)
async def get_patient(
    patient_id: UUID,
    user: CurrentUser = Depends(require_patient_read),
) -> PatientResponse:
    """환자 상세(마스킹). 미존재 → 404."""
    return await patients_service.get_patient(user.sub, patient_id)
