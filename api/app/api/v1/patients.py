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

from app.core.errors import NotFoundError
from app.core.security import CurrentUser, get_current_patient, require_permission
from app.schemas.billing import ReceiptResponse
from app.schemas.encounters import EncounterListItem
from app.schemas.guardians import GuardianCreate, GuardianResponse, GuardianUpdate
from app.schemas.patients import (
    PatientClinicalProfileUpdate,
    PatientContactReveal,
    PatientCreate,
    PatientEncounterCard,
    PatientEncounterDetail,
    PatientPage,
    PatientPageMeta,
    PatientPaymentCard,
    PatientResponse,
    PatientRrnReveal,
    PatientSelfLinkRequest,
    PatientSelfSummary,
)
from app.services import billing as billing_service
from app.services import guardians as guardians_service
from app.services import patients as patients_service

router = APIRouter(prefix="/patients", tags=["patients"])

# 권한 의존성은 모듈 로드 시 1회 생성(요청마다 팩토리 호출 회피).
require_patient_create = require_permission("patient.create")
require_patient_read = require_permission("patient.read")
require_patient_update = require_permission("patient.update")
require_patient_reveal_rrn = require_permission("patient.reveal_rrn")
require_patient_reveal_contact = require_permission("patient.reveal_contact")
# 과거 내원 이력은 encounter 데이터 → encounter.read 게이트(진료 허브, Story 4.5).
require_encounter_read = require_permission("encounter.read")


# ── 앱 자가가입 본인 연결(Story 3.4, FR-001·FR-003) ──────────────────────────────
# 환자(비직원) 전용. ⚠️ 정적 경로(/self-link·/self)는 /{patient_id} 동적 라우트보다 **먼저** 선언
# — 'self' 가 UUID 로 파싱돼 422 가 되지 않게(라우트 순서). 게이트 = get_current_patient(직원 403).
# 연결 대상 auth_uid = JWT sub 에서만(클라가 patient_id/uid 미제공 — 세션 uid 스코프).


@router.post("/self-link", response_model=PatientSelfSummary)
async def self_link(
    payload: PatientSelfLinkRequest,
    user: CurrentUser = Depends(get_current_patient),
) -> PatientSelfSummary:
    """앱 자가가입 후 기존 환자 레코드 자동 연결(FR-003).

    blind_index 매칭 → 연결/멱등 200, 미존재 404, 성명불일치 422, 연결충돌 409. 직원 → 403."""
    return await patients_service.link_self_patient(user.sub, payload)


@router.get("/self", response_model=PatientSelfSummary)
async def get_self(
    user: CurrentUser = Depends(get_current_patient),
) -> PatientSelfSummary:
    """본인(JWT sub)에 연결된 환자 요약 — 미연결 → 404. 직원 → 403. (onboarding 진입 분기용.)"""
    summary = await patients_service.get_self_patient(user.sub)
    if summary is None:
        raise NotFoundError("연결된 환자 기록이 없습니다.", code="no_self_patient")
    return summary


@router.get("/me/encounters", response_model=list[PatientEncounterCard])
async def list_self_encounters(
    user: CurrentUser = Depends(get_current_patient),
) -> list[PatientEncounterCard]:
    """본인 내원 이력 카드(FR-120, UX-DR17) — 환자 포털 '내 기록' 탭. 세션 uid 스코프·최근순.

    ⚠️ 정적 경로(/me/encounters)는 /{patient_id} 동적 라우트보다 **먼저** 선언(self-link·self 선례
    — 'me' 가 UUID 로 파싱돼 422 가 되지 않게). 게이트 get_current_patient(직원 403). patient_id
    미수용(서버가 auth_uid=sub 도출). 미연결은 빈 목록(프런트가 /self 404 로 온보딩 유도).
    작은 sub-collection → 직접 배열(guardians·encounters 선례). 펼침 상세는 Story 8.2."""
    return await patients_service.list_self_encounters(user.sub)


@router.get("/me/encounters/{encounter_id}/detail", response_model=PatientEncounterDetail)
async def get_self_encounter_detail(
    encounter_id: UUID,
    user: CurrentUser = Depends(get_current_patient),
) -> PatientEncounterDetail:
    """본인 내원 1건의 처방·검사 상세(FR-121, UX-DR17·23) — '내 기록' 카드 펼침. 세션 uid 스코프.

    ⚠️ 정적 'me' 프리픽스라 /{patient_id} 동적 라우트와 무관(별도 깊이). 게이트 get_current_patient
    (직원 403). ⚠️ 소유 검증: 본인 내원이 아니면(타인 encounter_id·미연결) 404(존재/비소유 구분
    노출 금지·IDOR 차단). 임상 서사(findings 등) 미투영 — 환자는 큐레이션된 결과 요약만 본다."""
    return await patients_service.get_self_encounter_detail(user.sub, encounter_id)


@router.get("/me/payments", response_model=list[PatientPaymentCard])
async def list_self_payments(
    user: CurrentUser = Depends(get_current_patient),
) -> list[PatientPaymentCard]:
    """본인 finalized 수납 카드(FR-122, UX-DR17) — 환자 포털 '마이' 탭. 세션 uid 스코프·최근순.

    ⚠️ 정적 'me' 프리픽스(/{patient_id} 동적 라우트보다 먼저). 게이트 get_current_patient(직원
    403). patient_id 미수용(서버가 auth_uid=sub 도출). finalized 만(draft·cancelled 제외). 미연결은
    빈 목록(프런트가 /self 404 로 온보딩 유도). 영수증 상세는 /me/encounters/{id}/receipt."""
    return await patients_service.list_self_payments(user.sub)


@router.get("/me/encounters/{encounter_id}/receipt", response_model=ReceiptResponse)
async def get_self_receipt(
    encounter_id: UUID,
    user: CurrentUser = Depends(get_current_patient),
) -> ReceiptResponse:
    """본인 내원 1건의 영수증 문서 데이터(FR-122) — '마이' 탭 수납 카드 → 영수증 상세.

    세션 uid 스코프. ⚠️ 정적 'me' 프리픽스라 /{patient_id} 동적 라우트와 무관. 게이트
    get_current_patient(직원 403).
    ⚠️ 소유 검증 + finalized: 본인 finalized 수납이 아니면(타인 encounter_id·미연결·비-finalized) 404
    (존재/비소유/비-finalized 구분 노출 금지·IDOR 차단·직원 영수증 409와 달리 self 는 404 일원화).
    7.5 ReceiptResponse 재사용 — 친화 요약(화면)·법정 서식(인쇄)이 동일 응답 공유. masked RRN 만."""
    return await billing_service.get_self_receipt(user.sub, encounter_id)


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
    q: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> PatientPage:
    """환자 목록(최신순, 마스킹) — 페이지네이션 봉투 {data, meta}. 권한 없으면 403.

    q 가 주어지면 이름·차트번호·연락처로 검색(Story 3.5, 전역 Ctrl K 커맨드 팔레트). q 는 PII
    (이름·연락처)라 로그에 남기지 않는다(라우트=불투명, 검색은 service_role 마스킹 투영만 반환)."""
    items, total = await patients_service.list_patients(
        user.sub, q=q, page=page, page_size=page_size
    )
    meta = PatientPageMeta(page=page, page_size=page_size, total=total)
    return PatientPage(data=items, meta=meta)


@router.get("/{patient_id}", response_model=PatientResponse)
async def get_patient(
    patient_id: UUID,
    user: CurrentUser = Depends(require_patient_read),
) -> PatientResponse:
    """환자 상세(마스킹 + 임상 프로필). 미존재 → 404."""
    return await patients_service.get_patient(user.sub, patient_id)


@router.put("/{patient_id}/clinical-profile", response_model=PatientResponse)
async def update_clinical_profile(
    patient_id: UUID,
    payload: PatientClinicalProfileUpdate,
    user: CurrentUser = Depends(require_patient_update),
) -> PatientResponse:
    """임상 프로필 갱신(혈액형·알레르기·기저질환·복용약·특이사항, FR-004).

    sub-resource action(상태 PATCH 아님) — 5필드 전체 교체(PUT). 게이트 patient.update → 403,
    실제 쓰기는 동일 트랜잭션 권한 재평가(TOCTOU). 미존재 → 404. 갱신=0009 감사 트리거 기록."""
    return await patients_service.update_clinical_profile(user.sub, patient_id, payload)


# ── 민감정보 reveal + 과거 내원 이력(Story 4.5, 진료 허브 배너·좌 컨텍스트) ─────────
# reveal = 부수효과(감사)가 있는 읽기 → POST(액션 엔드포인트, GET 아님). 권한 게이트(라우터) +
# RPC 동일-txn has_permission 재평가 + 감사(DB 강제, 0012). raw 값은 응답 바디로만(PII 경계).


@router.post("/{patient_id}/reveal-rrn", response_model=PatientRrnReveal)
async def reveal_rrn_action(
    patient_id: UUID,
    user: CurrentUser = Depends(require_patient_reveal_rrn),
) -> PatientRrnReveal:
    """주민번호 reveal(FR-242, UX-DR9) — full RRN + 'read' 자가-감사(0012/0005 RPC).

    부수효과(감사) 있는 읽기 → POST. 권한 미보유 → 403, 미존재 → 404. 복호=감사는 DB 강제.
    ⚠️ 반환 raw RRN 은 응답 바디 전용 — 로그·에러봉투 echo 금지(PII 경계)."""
    return await patients_service.reveal_rrn(user.sub, patient_id)


@router.post("/{patient_id}/reveal-contact", response_model=PatientContactReveal)
async def reveal_contact_action(
    patient_id: UUID,
    user: CurrentUser = Depends(require_patient_reveal_contact),
) -> PatientContactReveal:
    """연락처 reveal(UX-DR22) — full phone/address/email + 'read' 자가-감사(0012 RPC).

    부수효과(감사) 있는 읽기 → POST. 권한 미보유 → 403, 미존재 → 404."""
    return await patients_service.reveal_contact(user.sub, patient_id)


@router.get("/{patient_id}/encounters", response_model=list[EncounterListItem])
async def list_patient_encounters(
    patient_id: UUID,
    user: CurrentUser = Depends(require_encounter_read),
) -> list[EncounterListItem]:
    """환자의 과거 내원 이력(FR-031) — 진료 허브 좌 컨텍스트 타임라인. 최근순·조인(진료과·담당의).

    작은 sub-collection → 직접 배열(guardians 목록 선례). 데이터=encounters → encounter.read 게이트.
    진단/처방 per-visit 부착은 4.7/Epic5(이력 항목은 내원 메타만). 권한 없으면 403."""
    return await patients_service.list_patient_encounters(user.sub, patient_id)


# ── 보호자(guardians) 서브리소스(Story 3.3, FR-006) ──────────────────────────────
# 환자의 sub-resource(1:N). 조회=patient.read, 쓰기(추가·수정·삭제)=patient.update(환자 정보 수정).
# 실제 쓰기는 db 가 동일 트랜잭션에서 재평가(TOCTOU). 연락처는 평문(환자 phone 동형, reveal 이월).


@router.get("/{patient_id}/guardians", response_model=list[GuardianResponse])
async def list_guardians(
    patient_id: UUID,
    user: CurrentUser = Depends(require_patient_read),
) -> list[GuardianResponse]:
    """환자의 보호자 목록(등록순). 작은 sub-collection → 직접 배열. 권한 없으면 403."""
    return await guardians_service.list_guardians(user.sub, patient_id)


@router.post(
    "/{patient_id}/guardians",
    response_model=GuardianResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_guardian(
    patient_id: UUID,
    payload: GuardianCreate,
    user: CurrentUser = Depends(require_patient_update),
) -> GuardianResponse:
    """보호자 추가(성명·관계·연락처). 환자 미존재 → 404. 게이트 patient.update → 403."""
    return await guardians_service.create_guardian(user.sub, patient_id, payload)


@router.put("/{patient_id}/guardians/{guardian_id}", response_model=GuardianResponse)
async def update_guardian(
    patient_id: UUID,
    guardian_id: UUID,
    payload: GuardianUpdate,
    user: CurrentUser = Depends(require_patient_update),
) -> GuardianResponse:
    """보호자 수정(전체 교체). patient_id 스코프(IDOR 차단). 미존재 → 404. 갱신=0009 감사 기록."""
    return await guardians_service.update_guardian(user.sub, patient_id, guardian_id, payload)


@router.delete("/{patient_id}/guardians/{guardian_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_guardian(
    patient_id: UUID,
    guardian_id: UUID,
    user: CurrentUser = Depends(require_patient_update),
) -> None:
    """보호자 삭제(hard delete). patient_id 스코프(IDOR 차단). 미존재 → 404. 삭제=0009 감사 기록."""
    await guardians_service.delete_guardian(user.sub, patient_id, guardian_id)
