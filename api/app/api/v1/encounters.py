"""내원(encounters) 접수·조회 라우터 — walk-in 생성 + 예약 접수 RPC 소비. Story 4.2 / FR-020·FR-021.

쓰기 권위(FastAPI/service_role): 내원 생성·전이는 이 경로(authenticated 직접 쓰기 정책 없음, 0010).
상태 전이는 **액션 엔드포인트**(POST .../register — status PATCH 아님, architecture §REST). 게이트 =
require_permission('encounter.register') → 403. 실제 쓰기는 db 가 권한을 동일 트랜잭션에서 재평가
(TOCTOU) + 0010 전이 트리거·감사가 상태머신·감사를 강제(앱은 오케스트레이션만). 대기열 등록 =
생성된 행 자체(department_id + status='registered' → 그 진료과 대기열, 4.3 현황판 소비).
"""

from __future__ import annotations

from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.core.security import CurrentUser, require_permission
from app.schemas.encounters import (
    EncounterCreate,
    EncounterPage,
    EncounterResponse,
    MedicalRecordResponse,
    MedicalRecordWrite,
)
from app.services import encounters as encounters_service

router = APIRouter(prefix="/encounters", tags=["encounters"])

# 대기 목록 status 필터 허용값(0010 enum 6값). Literal → FastAPI 가 잘못/빈 값을 422 거부
# (`?status=` 무음 빈 보드 방지). 미지정(None)은 전체 — fetch_encounters 가 status 절 미추가.
EncounterStatusName = Literal[
    "scheduled", "registered", "in_progress", "completed", "cancelled", "no_show"
]

# 권한 의존성은 모듈 로드 시 1회 생성(요청마다 팩토리 호출 회피, patients.py 선례).
require_encounter_register = require_permission("encounter.register")
require_encounter_read = require_permission("encounter.read")
require_encounter_call = require_permission("encounter.call")
require_encounter_start = require_permission("encounter.start")
# SOAP 진료기록(Story 4.6): 쓰기=medical_record.write(0002 기존)·조회=medical_record.read(0013 신규,
# 의사 임상기록 최소권한 — encounter.read 가 아님). 원무가 의사 SOAP 를 읽지 못하게.
require_medical_record_write = require_permission("medical_record.write")
require_medical_record_read = require_permission("medical_record.read")


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


@router.post("/{encounter_id}/call", response_model=EncounterResponse)
async def call_encounter(
    encounter_id: UUID,
    user: CurrentUser = Depends(require_encounter_call),
) -> EncounterResponse:
    """환자 호출 — record_encounter_call RPC(호출 상태 기록, FR-023). 게이트 encounter.call.

    호출은 상태 전이 아님(status 불변, called_at/call_count 갱신). 액션 엔드포인트(PATCH 아님).
    미접수/진행중/종결 호출 → 409, 미존재 → 404. 중복 호출 1차선 = 클라 mutation 중 버튼 disable."""
    return await encounters_service.record_call(user.sub, encounter_id)


@router.post("/{encounter_id}/start-consult", response_model=EncounterResponse)
async def start_consult(
    encounter_id: UUID,
    user: CurrentUser = Depends(require_encounter_start),
) -> EncounterResponse:
    """진찰 시작 — start_consult RPC(registered→in_progress, 담당의=호출자, FR-030).

    게이트 encounter.start. 액션 엔드포인트(status PATCH 아님). 미접수/종결/이미 진행중 → 409
    invalid_transition(RPC 소스상태 precondition·재수행/진료 탈취 차단 NFR-040), 미존재 → 404,
    권한 미보유 → 403. 성공 시 진료 허브 진입(웹). 동시전이 2차 의사 = in_progress → 409."""
    return await encounters_service.start_consult(user.sub, encounter_id)


@router.get("", response_model=EncounterPage)
async def list_encounters(
    department_id: UUID,
    status: list[EncounterStatusName] | None = Query(default=None),
    on_date: date | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=200, ge=1, le=500),
    user: CurrentUser = Depends(require_encounter_read),
) -> EncounterPage:
    """대기 현황판 목록(FR-022) — 진료과(필수)·상태·일자(KST, 기본 오늘) 필터, 활성도 순 그룹.

    게이트 encounter.read. denormalized 조인(환자명·차트번호·진료과명·진료실·담당의). 보드는 하루치
    활성+종결 집합을 한 번에 그룹핑 → page_size 기본 200(일자-스코프로 바운드)."""
    return await encounters_service.list_encounters(
        user.sub,
        department_id=department_id,
        statuses=status,
        on_date=on_date,
        page=page,
        page_size=page_size,
    )


@router.get("/{encounter_id}", response_model=EncounterResponse)
async def get_encounter(
    encounter_id: UUID,
    user: CurrentUser = Depends(require_encounter_read),
) -> EncounterResponse:
    """내원 단건 조회(접수 결과·상세). 미존재 → 404. (대기 현황판 목록은 4.3.)"""
    return await encounters_service.get_encounter(user.sub, encounter_id)


# ── SOAP 진료기록(medical_records) — Story 4.6 / FR-040·FR-041 ────────────────
# sub-resource(내원의 진료기록). 쓰기=POST(생성)·PUT(autosave 전체 교체), 조회=GET(1:N 목록).
# 경로 세그먼트 수가 달라 기존 /{encounter_id}·액션 경로와 충돌 없음. SQLSTATE 매핑 재사용(신규 0).
@router.post(
    "/{encounter_id}/medical-records",
    response_model=MedicalRecordResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_medical_record(
    encounter_id: UUID,
    payload: MedicalRecordWrite,
    user: CurrentUser = Depends(require_medical_record_write),
) -> MedicalRecordResponse:
    """SOAP 진료기록 생성(autosave 첫 저장, FR-040). 게이트 medical_record.write.

    author_id=작성 의사(sub). 미존재 내원 → 404, FK → 422, 권한 미보유 → 403. 1:N(FR-041)."""
    return await encounters_service.create_medical_record(user.sub, encounter_id, payload)


@router.put(
    "/{encounter_id}/medical-records/{record_id}",
    response_model=MedicalRecordResponse,
)
async def update_medical_record(
    encounter_id: UUID,
    record_id: UUID,
    payload: MedicalRecordWrite,
    user: CurrentUser = Depends(require_medical_record_write),
) -> MedicalRecordResponse:
    """SOAP 진료기록 갱신(autosave 전체 교체 — clinical-profile PUT 선례). 게이트 write.

    4 파트 전체 교체(미전송=None=값없음). 미존재/내원 불일치 기록 → 404, 권한 미보유 → 403."""
    return await encounters_service.update_medical_record(
        user.sub, encounter_id, record_id, payload
    )


@router.get(
    "/{encounter_id}/medical-records",
    response_model=list[MedicalRecordResponse],
)
async def list_medical_records(
    encounter_id: UUID,
    user: CurrentUser = Depends(require_medical_record_read),
) -> list[MedicalRecordResponse]:
    """한 내원의 SOAP 진료기록 목록(최근순·1:N, FR-041). 게이트 medical_record.read.

    ★ 읽기 게이트 = medical_record.read(encounter.read 아님 — 원무·간호 임상 SOAP 미열람, 최소권한).
    작은 sub-collection → 직접 배열(GET /patients/{id}/encounters 선례)."""
    return await encounters_service.list_medical_records(user.sub, encounter_id)
