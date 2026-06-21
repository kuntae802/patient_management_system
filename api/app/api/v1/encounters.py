"""내원(encounters) 접수·조회 라우터 — walk-in 생성 + 예약 접수 RPC 소비. Story 4.2 / FR-020·FR-021.

쓰기 권위(FastAPI/service_role): 내원 생성·전이는 이 경로(authenticated 직접 쓰기 정책 없음, 0010).
상태 전이는 **액션 엔드포인트**(POST .../register — status PATCH 아님, architecture §REST). 게이트 =
require_permission('encounter.register') → 403. 실제 쓰기는 db 가 권한을 동일 트랜잭션에서 재평가
(TOCTOU) + 0010 전이 트리거·감사가 상태머신·감사를 강제(앱은 오케스트레이션만). 대기열 등록 =
생성된 행 자체(department_id + status='registered' → 그 진료과 대기열, 4.3 현황판 소비).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, status

from app.core.security import CurrentUser, require_permission
from app.schemas.encounters import EncounterCreate, EncounterResponse
from app.services import encounters as encounters_service

router = APIRouter(prefix="/encounters", tags=["encounters"])

# 권한 의존성은 모듈 로드 시 1회 생성(요청마다 팩토리 호출 회피, patients.py 선례).
require_encounter_register = require_permission("encounter.register")
require_encounter_read = require_permission("encounter.read")


@router.post("", response_model=EncounterResponse, status_code=status.HTTP_201_CREATED)
async def create_encounter(
    payload: EncounterCreate,
    user: CurrentUser = Depends(require_encounter_register),
) -> EncounterResponse:
    """walk-in 즉석 접수 — 내원 생성(status='registered') + 진료과 대기열 진입(FR-021).

    직접 INSERT(register_encounter 미경유, Open Q1). 미존재 → 404, 비활성 환자/진료과 → 422."""
    return await encounters_service.create_walk_in_encounter(user.sub, payload)


@router.post("/{encounter_id}/register", response_model=EncounterResponse)
async def register_encounter(
    encounter_id: UUID,
    user: CurrentUser = Depends(require_encounter_register),
) -> EncounterResponse:
    """예약 환자 도착 접수 — register_encounter RPC(scheduled→registered, FR-020).

    액션 엔드포인트(status PATCH 아님). 잘못된 전이 → 409, 미존재 → 404. (예약은 Epic 6.)"""
    return await encounters_service.register_scheduled_encounter(user.sub, encounter_id)


@router.get("/{encounter_id}", response_model=EncounterResponse)
async def get_encounter(
    encounter_id: UUID,
    user: CurrentUser = Depends(require_encounter_read),
) -> EncounterResponse:
    """내원 단건 조회(접수 결과·상세). 미존재 → 404. (대기 현황판 목록은 4.3.)"""
    return await encounters_service.get_encounter(user.sub, encounter_id)
