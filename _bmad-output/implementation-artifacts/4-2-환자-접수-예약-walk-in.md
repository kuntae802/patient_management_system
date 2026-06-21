---
baseline_commit: c0e043de5fe7e3534640f930da8d4ba192102408
---

# Story 4.2: 환자 접수 — 예약 · Walk-in

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 원무 직원,
I want 도착한 예약 환자 또는 예약 없는 방문 환자(walk-in)를 검색·선택해 접수하기를,
so that 내원(encounter)이 '접수(registered)' 상태로 생성되어 진료과 대기열에 진입하고, 의사가 진료를 시작(4.4)할 수 있는 파이프라인에 들어선다.

## Acceptance Criteria

1. **AC1 — walk-in 즉석 접수(직접 INSERT) + 4계층 FastAPI 액션 엔드포인트 (FR-021, FR-020):** 원무가 환자를 검색·선택해 `POST /api/v1/encounters` 로 walk-in 접수하면, service_role 이 `encounters` 에 `status='registered'`·`visit_type='walk_in'`·`registered_at=now()`·`created_by=<접수 직원 sub>`·`department_id=<선택 진료과>` 로 **1행 INSERT**(0010 초기상태 가드 통과)하고, 생성된 내원(`encounter_no`·`status='registered'` 포함)이 201 로 반환된다. 신규 4계층(`api/v1/encounters.py` → `services/encounters.py` → `core/db.py` 래퍼 → `schemas/encounters.py`)이 `patients` 4계층(3.1)을 미러하고, `register_encounter` 미경유 직접 INSERT 임이 명시된다(§스코프·Open Q1). **대기열 등록 = 이 INSERT 자체**(별도 큐 테이블 없음 — `department_id`+`status='registered'` 행이 곧 그 진료과 대기열, 4.3 현황판이 `idx_encounters_dept_status` 로 조회·구독).

2. **AC2 — 예약 환자 접수 액션 엔드포인트(register_encounter RPC 소비) + SQLSTATE→HTTP 매핑 (FR-020, NFR-040):** `POST /api/v1/encounters/{id}/register`(status PATCH 아님 — 액션 엔드포인트) 가 `register_encounter` RPC 를 호출해 `scheduled→registered` 전이를 수행하고 갱신된 내원을 200 으로 반환한다. **`core/db.py` 가 RPC 의 커스텀 SQLSTATE 를 HTTP 로 변환**한다(이 프로젝트 첫 sqlstate 분기 — 현재 `_run_authed` 는 모든 `asyncpg.PostgresError` 를 503 으로 매핑하므로 **PT409/PT404/42501 이 503 으로 잘못 흡수됨, 반드시 수정**): `PT409→ConflictError`(409, code `invalid_transition`, "잘못된 상태 전이입니다.")·`PT404→NotFoundError`(404)·`insufficient_privilege`(42501)→`ForbiddenError`(403). 잘못된 전이(이미 registered/in_progress 등 재호출·역행)는 409, 미존재 내원은 404, 권한 미보유는 403. (MVP 에 `scheduled` 행을 만드는 주체는 없음 — appointments=Epic 6 → 이 엔드포인트는 **계약·SQLSTATE 인프라**로 빌드·테스트되고 UI 데모는 walk-in. 4.4 `start_consult` 가 동일 SQLSTATE 인프라를 소비.)

3. **AC3 — 상태머신·감사 일관 적용 + 활성 가드 + 권한 게이트 (FR-020, NFR-040):** walk-in(INSERT)·예약(RPC) 두 경로 모두 **DB가 소유한 동일 상태머신·감사가 일관 적용**된다 — walk-in INSERT 는 `trg_encounters_transition`(초기상태 가드)·`trg_encounters_audit`(0004 재사용, `action='create'`)가, 예약 RPC 는 전이 트리거·감사가 actor 와 함께 강제(앱이 상태머신·감사를 재구현하지 않음). 접수는 **비활성(soft-deleted) 환자·비활성 진료과로 차단**(존재·`is_active` 검증 → 404/422)된다. 모든 접수 명령은 **FastAPI 게이트(`require_permission('encounter.register')`) + RPC/in-txn `has_permission()` 재평가(TOCTOU)** 이중으로 보호되며, 웹 접수 화면(`/reception/intake`)은 환자 검색(3.5 재사용)→진료과 선택→접수 확정 + 에러봉투 분기(409/403/404/422) + mutation 중 disable 로 동작한다.

> **이월 인수 조건(이 스토리에서 충족):** ① **walk-in `registered_at`·`created_by` 충전**(4.1 review handoff — RPC 미경유 직접 INSERT 라 4.1 이 NULL 로 남긴 두 컬럼을 4.2 INSERT 가 채움, deferred-work). ② **신규 마이그레이션 0건**(0010_encounters.sql 이 테이블·RPC·인덱스·권한 전부 보유 — 4.2=순수 소비 스토리, DDL 금지). 단 **seed.sql 에 reception→encounter.register/read grant 추가**(데모 가동 — seed 의 admin-only grant 를 reception 직무로 확장, 프로덕션 런타임 grant 는 1.7 매트릭스 소유). ③ **SQLSTATE 매핑은 공유 인프라**(`_run_authed`/공유 헬퍼)에 1회 추가해 4.4/Epic6/7 이 재사용. 상세는 Dev Notes §이월 인수.

## Tasks / Subtasks

- [x] **Task 1 — `core/db.py` SQLSTATE→HTTP 매핑(공유 인프라) + 내원 DB 래퍼 (AC1, AC2, AC3)**
  - [x] 1.1 **SQLSTATE 매핑 추가**(이 프로젝트 첫 sqlstate 분기). `_run_authed`(db.py:109) 의 `except _DB_OUTAGE_ERRORS`(=`(asyncpg.PostgresError, asyncpg.InterfaceError, OSError, asyncio.TimeoutError)`, db.py:43) 가 **현재 RPC 의 PT409/PT404/42501 을 503 으로 흡수**한다. `except _DB_OUTAGE_ERRORS` **앞에** `except asyncpg.PostgresError as exc:` 절을 추가(또는 `_map_pg_error(exc)->AppError|None` 헬퍼 추출)해 `exc.sqlstate` 분기: `'PT409'→ConflictError(code='invalid_transition', "잘못된 상태 전이입니다.")`·`'PT404'→NotFoundError("내원을 찾을 수 없습니다.")`·`'42501'→ForbiddenError()`. **그 외 sqlstate 는 기존대로 `ServiceUnavailableError`(503)** 로 폴백(회귀 0 — 기존 코드는 PT409/PT404/42501 미발생). ⚠️ `_op` 내부에서 raise 되는 `AppError`(ConflictError 등)는 PostgresError 가 아니므로 그대로 전파됨(영향 없음) — 검증할 것.
  - [x] 1.2 `insert_walk_in_encounter(sub, *, patient_id, department_id, created_by, room_id=None) -> asyncpg.Record`: `insert_patient`(db.py:1071) 골격 미러 — `_run_authed` 로 트랜잭션, `_op` 첫 줄 **in-txn 권한 재평가**(`if not await conn.fetchval("select public.has_permission('encounter.register')"): raise ForbiddenError(detail={"required_permission":"encounter.register"})`, TOCTOU), 이어 **환자 존재·활성 검증**(`select is_active from public.patients where id=$1` — None→`NotFoundError("환자를 찾을 수 없습니다.")`, false→`AppError(code="patient_inactive", status_code=422)`)·진료과 활성 검증(동일), 그다음 `insert into public.encounters (patient_id, department_id, room_id, visit_type, status, registered_at, created_by) values ($1,$2,$3,'walk_in','registered', now(), $4) returning <컬럼>`. encounter_no·status·전이 타임스탬프는 DB 가 채움(앱 입력 금지).
  - [x] 1.3 `call_register_encounter(sub, encounter_id) -> asyncpg.Record`: `_run_authed` 로 `row = await conn.fetchrow("select * from public.register_encounter($1)", encounter_id)` 호출. RPC 내부 has_permission/소스상태/not-found 가 PT409/PT404/42501 raise → **1.1 매핑이 자동 변환**(여기서 따로 try/except 불요). `returns public.encounters` 라 전체 행 반환.
  - [x] 1.4 `fetch_encounter(sub, encounter_id) -> asyncpg.Record | None`: RLS 게이트 적용 단순 조회(`select <컬럼> from public.encounters where id=$1`). 접수 결과/상세 확인용(목록·현황판은 4.3). 미존재→None(서비스가 404).
  - [x] 1.5 컬럼 상수: `_ENCOUNTER_COLUMNS`(patients 의 `_PATIENT_COLUMNS` 선례) — `id, encounter_no, patient_id, department_id, room_id, doctor_id, visit_type, status, cancel_reason, registered_at, consult_started_at, completed_at, cancelled_at, no_show_at, created_by, is_active, created_at, updated_at`. encounters 는 비-PII(patient_id=FK·encounter_no=비PII) → 컬럼 투영 자유(마스킹 불요).
- [x] **Task 2 — `schemas/encounters.py`(신규) (AC1, AC2)**
  - [x] 2.1 `EncounterCreate(BaseModel)`: `patient_id: UUID`·`department_id: UUID`·`room_id: UUID | None = None`. (`visit_type` 은 walk-in 생성이므로 서버가 `'walk_in'` 고정 — 클라 입력 미수용, 혹은 `Literal['walk_in']='walk_in'` 기본. `status`·`encounter_no` 클라 미수용.) `schemas/patients.py:PatientCreate` 컨벤션(`_Stripped` 등) 미러.
  - [x] 2.2 `EncounterResponse(BaseModel)`: 0010 전 컬럼(§스키마, Task 1.5 컬럼 = snake_case 그대로 — **camelCase 변환 금지**, project-context JSON 규칙). `model_config = ConfigDict(from_attributes=True)` 로 `model_validate(dict(row))`.
  - [x] 2.3 (선택) `EncounterListItem`/`EncounterPage` 는 **4.3(대기 현황판)** 소유 — 4.2 는 단건 응답(`EncounterResponse`)만. 미리 만들지 말 것(YAGNI, 4.3 이 형태 결정).
- [x] **Task 3 — `services/encounters.py`(신규) (AC1, AC2, AC3)**
  - [x] 3.1 `create_walk_in_encounter(sub: UUID, payload: EncounterCreate) -> EncounterResponse`: `row = await db.insert_walk_in_encounter(sub, patient_id=payload.patient_id, department_id=payload.department_id, created_by=sub, room_id=payload.room_id)` → `_to_encounter(row)`. (환자·진료과 활성 검증은 db 래퍼가 동일 txn 에서 — 서비스는 오케스트레이션만. `services/patients.py:create_patient` 선례.)
  - [x] 3.2 `register_scheduled_encounter(sub: UUID, encounter_id: UUID) -> EncounterResponse`: `row = await db.call_register_encounter(sub, encounter_id)` → `_to_encounter(row)`. (RPC 가 권한·전이·not-found 전부 강제 → 서비스는 호출·매핑만.)
  - [x] 3.3 `get_encounter(sub: UUID, encounter_id: UUID) -> EncounterResponse`: `row = await db.fetch_encounter(...)`; None→`NotFoundError("내원을 찾을 수 없습니다.")`. `_to_encounter(row) = EncounterResponse.model_validate(dict(row))` 헬퍼(`_to_patient` 선례).
- [x] **Task 4 — `api/v1/encounters.py`(신규) + router 등록 (AC1, AC2)**
  - [x] 4.1 라우터: `router = APIRouter(prefix="/encounters", tags=["encounters"])`. 모듈 로드 시 의존성 1회 생성: `require_encounter_register = require_permission("encounter.register")`·`require_encounter_read = require_permission("encounter.read")`(patients.py:35 선례).
  - [x] 4.2 `POST ""` → `create_encounter(payload: EncounterCreate, user=Depends(require_encounter_register)) -> EncounterResponse`(`status_code=201`). `return await encounters_service.create_walk_in_encounter(user.sub, payload)`.
  - [x] 4.3 `POST "/{encounter_id}/register"` → `register_encounter_action(encounter_id: UUID, user=Depends(require_encounter_register)) -> EncounterResponse`. `return await encounters_service.register_scheduled_encounter(user.sub, encounter_id)`. (status PATCH 아님 — 액션 엔드포인트, architecture:194/253.)
  - [x] 4.4 `GET "/{encounter_id}"` → `get_encounter(encounter_id: UUID, user=Depends(require_encounter_read)) -> EncounterResponse`. (접수 결과 확인·후속 네비. 목록 GET 은 4.3.)
  - [x] 4.5 `api/v1/router.py:26-27` **스텁 주석 해제**: `from app.api.v1 import encounters` + `api_router.include_router(encounters.router)`.
- [x] **Task 5 — `supabase/seed.sql` reception 권한 grant(데모 가동) (AC3)**
  - [x] 5.1 seed.sql 에 reception 역할 → `encounter.register`·`encounter.read` grant 추가(0002 admin cross-join 패턴 미러, 멱등 `on conflict do nothing`). 주석으로 "데모 시드 — 프로덕션 런타임 grant 는 Story 1.7 RBAC 매트릭스 소유"(rbac-ui-exposure-model: 접수=원무 직무 본질). **신규 마이그레이션 만들지 말 것**(seed.sql=dev 시드, 0010 가 권한 카탈로그 보유).
- [x] **Task 6 — 웹 접수 화면 `/reception/intake` (AC1, AC3)**
  - [x] 6.1 `web/src/lib/reception/encounters.ts`(신규): `Encounter` 타입 **수동 정의**(database.types.ts 미생성 — `lib/reception/patients.ts:PatientListItem` 선례, snake_case 필드). `createWalkInEncounter(payload): Promise<Encounter>` = `apiFetch<Encounter>("/v1/encounters", {method:"POST", body: JSON.stringify({patient_id, department_id})})`. Zod 스키마(`encounterIntakeSchema` — patient_id·department_id required).
  - [x] 6.2 `web/src/components/reception/patient-intake.tsx`(신규): **환자 검색 피커**(3.5 `searchPatients`(lib/reception/patients.ts) 재사용 — 디바운스·AbortController·결과행=이름·차트번호·생년월일·`resident_no_masked`·연락처 오환자 가드레일, 단 선택 핸들러는 `/patients/{id}` 이동 대신 `onSelect(patient)` 폼 바인딩) + **진료과 select**(`fetchDepartments`/Supabase 직접 조회 재사용, `lib/admin/masters.ts` 선례 — 단순 읽기는 Supabase RLS) + **접수 확정** 버튼.
  - [x] 6.3 폼 패턴: **RHF7 + Zod4**(`components/reception/patient-register.tsx` 선례), 제출 시 `createWalkInEncounter` → 성공 토스트("{환자명} 접수 완료 · 내원번호 {encounter_no} · {진료과} 대기") + 결과 카드(encounter_no·status 배지). **mutation 중 버튼 `disabled={isSubmitting}`**(이중 제출 방지 = 중복 접수 1차선). ⚠️ **상태 관리는 useState/useEffect + apiFetch**(이 프로젝트는 **TanStack Query 미사용** — 도입 금지) · UI 는 **Base UI(`@base-ui/react`)**(shadcn 직접 사용 안 함 — 실제 코드 관례, project-context 의 "TanStack Query/shadcn" 문구보다 **현행 코드 우선**).
  - [x] 6.4 에러봉투 분기(`ApiError`, lib/api/client.ts): `code==="invalid_transition"`(409)·403(권한)·404(환자/내원 없음)·422(`patient_inactive` 등) 별 한국어 토스트/필드 에러. 성공=`aria-live="polite"`, 충돌=`aria-live="assertive"`.
  - [x] 6.5 페이지 `web/src/app/(staff)/reception/intake/page.tsx`(신규): `requireStaff()` 가드(layout 선례) + `<patient-intake>` 렌더. 메뉴 진입점 `/reception/intake` 는 **nav 에 이미 존재**(staff-nav.ts:56 "접수", roles `reception` — 역할 노출, 권한 게이트 아님). 접수 상태 배지는 **인라인 최소**(앰버 점 + `status-received-ink` 라벨 — A3 풀 컴포넌트는 4.3). `lib/admin/masters.ts:CODE_STATUS_META` 의 status 토큰 패턴 참고.
- [x] **Task 7 — `docs/glossary.md` 갱신 (AC1, AC2)**
  - [x] 7.1 신규 식별자 등재(사용 전 등재 규칙): 엔드포인트(`POST /encounters`·`POST /encounters/{id}/register`·`GET /encounters/{id}`), db 래퍼(`insert_walk_in_encounter`·`call_register_encounter`·`fetch_encounter`), 서비스(`create_walk_in_encounter`·`register_scheduled_encounter`), 웹(`createWalkInEncounter`·`patient-intake`). (`encounter`·`encounter_no`·전이 RPC·`visit_type`·`encounter_status` 는 4.1 에 이미 등재 — 변경 없음.) SQLSTATE 매핑 계약(`PT409→409`)은 4.1 에 등재됨 — 재등재 불요.
- [x] **Task 8 — 테스트 (AC1, AC2, AC3)**
  - [x] 8.1 `api/tests/test_encounters_integration.py`(신규): FastAPI `TestClient` + 실 Supabase 토큰(`test_patients_integration.py` 픽스처 패턴 — `_get_token("admin@pms.local","Staff1234")`, 미가용 skip). **admin 토큰 사용**(reception 은 seed grant 후 가능하나 admin 이 전권 — 권한 경로 테스트만 별도).
  - [x] 8.2 walk-in 생성(AC1): 환자 1건 POST `/v1/patients`(3.1) → `POST /v1/encounters {patient_id, department_id(시드 IM)}` → **201** + `status=='registered'`·`visit_type=='walk_in'`·`encounter_no` 8자리·**`registered_at` not null·`created_by`==접수자 uid**(핸드오프 청산 검증).
  - [x] 8.3 검증 실패(AC1): patient_id 누락/잘못된 UUID → 422. 미존재 patient_id → 404. (비활성 환자 → 422 `patient_inactive` — 환자 soft-delete 픽스처 가능 시.)
  - [x] 8.4 register RPC 경로(AC2): service_role 로 `scheduled` 내원 1건 직접 INSERT(또는 db 픽스처) → `POST /v1/encounters/{id}/register` → **200** + `status=='registered'`·`registered_at` 세팅. **재호출**(이미 registered)→**409** `invalid_transition`. 미존재 id → **404**. (scheduled 행 셋업은 test conftest/psql 또는 service_role 직접 INSERT — 0010 초기상태 가드가 scheduled 허용.)
  - [x] 8.5 SQLSTATE 매핑 단위 가드(AC2): db 또는 서비스 레벨에서 PT409/PT404/42501 → ConflictError/NotFoundError/ForbiddenError 변환 확인(에러 특정성 — 409 status·code `invalid_transition` 단언, "denied" 류 비특정 금지, 1.3 P3 교훈).
  - [x] 8.6 권한(AC3): `encounter.register` 미보유 계정(예 seed `doctor@pms.local`)으로 `POST /v1/encounters` → **403**. (게이트 `require_permission` 가 in-txn 재평가 전에 차단.)
  - [x] 8.7 **회귀 0**: `supabase db reset`(0001~0010) 후 `uv run pytest` 전체 그린(기존 311 passed/9 skipped 유지). `ruff check`/`ruff format --check` clean. 웹 `npm run lint`/타입 그린.

### Review Findings

_코드리뷰 2026-06-21 (Blind Hunter / Edge Case Hunter / Acceptance Auditor 3레이어 병렬, 실패 레이어 0). 교차검증으로 추측성·범위밖 다수 기각: Blind 의 "`ENCOUNTER_STATUS_META[status]` undefined 크래시"(DB CHECK 가 6값 보장 + 전부 매핑 → 도달 불가)·"트랜잭션 오염"(asyncpg transaction CM 이 예외 시 자동 롤백)·"`_unique_rrn` 충돌"(기존 patients 테스트 동일 수용 패턴); Edge 의 "register-on-walk-in 409"(정상 동작)·"진료과 로드 실패 UX"(canSubmit 차단으로 처리됨)·"register 동시성 테스트 공백"(for-update 직렬화로 안전); Auditor 의 함수명(`register_encounter` vs `_action` — 충돌 없음)·`requireStaff→requirePermission`(의도적 강화·문서화)·Open Q4(명시 이월과 일치) = 전부 dismiss(9건)._

- [x] [Review][Patch] room_id FK 위반(23503) → 503 오분류, 422 백스톱 추가 [api/app/core/db.py insert_walk_in_encounter] — room_id 는 선검사 안 함(미배정 허용·배정 4.4)이라 미존재 진료실 지정 시 FK 위반이 `_map_pg_sqlstate` 미매핑 → 503(입력 오류인데 일시 장애로 위장). insert_room/update_room 의 `ForeignKeyViolationError→422` 백스톱 패턴과 불일치. **적용(2026-06-21):** INSERT 를 try/except `ForeignKeyViolationError → AppError(422, invalid_reference)` 로 감싸고 회귀 테스트(`test_create_encounter_invalid_room_422`) 추가 + 미매핑 SQLSTATE 503 폴백 로그에 `sqlstate` 포함(디버깅성). 백엔드 327 passed/9 skipped. [blind+edge]
- [x] [Review][Patch] 웹 접수 이중 제출 레이스, 동기 ref 락 [web/src/components/reception/patient-intake.tsx onSubmit] — `disabled={!canSubmit}` 가 다음 렌더에서야 반영돼 더블클릭/Enter 연타 시 stale 상태로 둘째 POST 발사 → 중복 내원(서버 중복 가드는 Open Q4 이월이라 클라 가드가 1차선). **적용(2026-06-21):** `useRef(false)` in-flight 락으로 onSubmit 재진입을 렌더 갭 무관하게 동기 차단(finally 해제). 웹 202 passed. [edge]
- [x] [Review][Defer] walk-in 활성 검사 TOCTOU(SELECT is_active→INSERT 비원자) [api/app/core/db.py] — deferred, is_active 하드닝 일괄 이월(patients 0009 동일 패턴·동시 soft-delete 빈도 낮음·생성경로 best-effort 가드는 충족). [blind+edge]
- [x] [Review][Defer] 동일 환자 중복 walk-in 가드 부재(서버) [api/app/core/db.py] — deferred, Open Q4 명시 결정(미차단·운영정책 확정 후). 클라 1차선은 이중제출 락으로 보강. [edge]
- [x] [Review][Defer] room_id 비활성/타 진료과 소속 무검증 [api/app/core/db.py] — deferred, 진료실 배정·검증은 4.4/현황판 소유(4.2 는 미배정 NULL·FK 존재만 백스톱). [edge]
- [x] [Review][Defer] 토큰 만료(401) 접수 실패 UX(재인증 흐름 없음) [web patient-intake.tsx + lib/api/client.ts] — deferred, 교차절단(apiFetch no_session 일관)·4.2 비특정. [edge]
- [x] [Review][Defer] 검색 결과 RESULT_LIMIT 초과 시 21번째+ 환자 선택 불가 [web patient-intake.tsx] — deferred, 3.5 전역검색 페이지네이션 부재 전파(검색 하드닝 묶음). [edge]

## Dev Notes

### 스코프 (이 스토리가 하는 것 / 안 하는 것)

**IN (4.2 = 상태머신의 첫 FastAPI/웹 소비처):**
- **walk-in 접수 풀스택**: `POST /encounters`(직접 INSERT `status='registered'`·`registered_at`·`created_by` 충전) → 4계층 신규(`api/v1/encounters.py`·`services/encounters.py`·`core/db.py` 래퍼·`schemas/encounters.py`) → 웹 `/reception/intake`(환자 검색 3.5 재사용 + 진료과 select + 접수 확정).
- **예약 환자 접수 액션 엔드포인트**: `POST /encounters/{id}/register`(register_encounter RPC 소비, `scheduled→registered`) — **계약·SQLSTATE 인프라로 빌드·테스트**. MVP 에 `scheduled` 행 생성 주체 없음(appointments=Epic 6) → **UI 데모는 walk-in**.
- **SQLSTATE→HTTP 매핑(공유 인프라)**: `PT409→409`·`PT404→404`·`42501→403`. 이 프로젝트 첫 sqlstate 분기 — `_run_authed`/공유 헬퍼에 1회. 4.4/Epic6/7 재사용.
- **walk-in `registered_at`·`created_by` 충전**(4.1 handoff 청산) · **활성 환자/진료과 가드** · **seed.sql reception grant**(데모 가동) · glossary · FastAPI 통합 테스트.

**OUT (후속 스토리 — 명시 이월, 은폐 아님):**
- **대기 현황판·실시간(postgres_changes)·"다음 호출" 히어로·status-badge A3 풀 컴포넌트·행별 다음-액션 버튼·`GET /encounters` 목록** → **4.3**(UX-DR6/7/8). 4.2 는 행을 만들기만(=대기열 진입), 보여주는 화면은 4.3.
- **진찰 시작(start_consult)·세션당 활성 내원 1개 가드** → **4.4**(동일 SQLSTATE 인프라 소비). **진료 허브·RRN/연락처 reveal·알레르기 can't-miss** → 4.5. **SOAP·주호소·진단** → 4.6/4.7.
- **예약(scheduled) 환자 생성·예약 목록 UI·appointments 테이블·`reservation_id` FK·근무표·슬롯** → **Epic 6**. 4.2 register 엔드포인트는 그 소비 계약.
- **완료/취소/노쇼 액션 엔드포인트·정산** → **Epic 7/6**. **부분수행** = `in_progress→completed` 후 Epic 7(FR-119).
- **검색 튜닝**(min-digit·NFC·phone 인덱스·IME Ctrl K, deferred-work) · **동시 전이 낙관적 잠금**(walk-in INSERT 엔 무관) · **hard delete 상태머신 우회 가드** · **포털 컬럼 투영**(Epic 8) · **cancel_reason 감사 드리프트** → **계속 이월**(4.1 defer 6건 유지). 4.2 는 이 경계를 만지지 않음(회고 교훈 #1 "교차절단 부채는 주인 스토리로만").

### ⚠️ 현행 코드 우선 — 문서 드리프트 주의(가장 먼저 내재화)

project-context.md·architecture.md 는 프론트 상태관리로 **TanStack Query v5 + shadcn/ui** 를 명시하나, **실제 web 코드는 그렇지 않다**(그린필드 진화 중 드리프트). dev 는 **현행 코드 관례를 따른다**(harness 규칙: 주변 코드처럼 작성):
- **TanStack Query 미사용** — 서버 상태 = `useState`/`useEffect` + `apiFetch`(`lib/api/client.ts`). 디바운스+`AbortController` 패턴(`patient-search-command.tsx`). **TanStack Query 도입 금지**(단독 도입 = 패턴 분기).
- **UI 라이브러리 = Base UI(`@base-ui/react`)** — `Dialog`·`Combobox`·`Button`. shadcn `components.json` 은 있으나 직접 사용 안 함. `components/ui/*`(button·master-search-picker·sonner·skeleton)·`@base-ui/react` 재사용.
- **`types/database.types.ts` 미생성** — `supabase gen types` 미실행. 타입은 **각 lib 에서 수동 정의**(`lib/reception/patients.ts:PatientListItem`). 4.2 `Encounter` 타입도 `lib/reception/encounters.ts` 에 수동 정의(snake_case 필드 — DB 계약 미러).
- **토스트 = Sonner**(`components/ui/sonner.tsx`, `toast.success`/`toast.error`).

### ⚠️ 마이그레이션 — 신규 0건(4.2 = 순수 소비)

`0010_encounters.sql`(4.1)이 **테이블·전이 트리거·RPC 5종·인덱스·권한 카탈로그·RLS·감사·encounter_no 시퀀스**를 전부 보유. 4.2 는 **DDL 을 만들지 않는다**(FastAPI DDL·Alembic 금지, 스키마 단일 소유). 유일한 SQL 변경 = **`supabase/seed.sql`** reception grant(Task 5 — dev 시드, 번호 마이그레이션 아님). encounters 컬럼/인덱스가 부족하다고 느껴도 0010 재편집·신규 0011 만들지 말 것 — 4.2 요구는 0010 으로 100% 충족(아래 §재사용 자산 확인). 회고 교훈: 번호 드리프트=영구 세금 → 4.2 는 마이그레이션 무증가가 정답.

### 재사용 자산 — 발명 금지 (DO NOT REINVENT)

4.2 는 **이미 깔린 인프라를 소비**한다. 재구현하면 회귀·이중 감사·패턴 분기.

| 자산 | 위치 | 시그니처/계약 | 4.2 사용처 |
|---|---|---|---|
| `encounters` 테이블 + 상태머신 | `0010_encounters.sql:27~` | status text+CHECK 6값·초기상태 가드(scheduled\|registered)·전이 타임스탬프 5종·`encounter_no` 시퀀스 | walk-in INSERT 대상·register RPC 대상 |
| 전이 RPC `register_encounter(p_encounter_id uuid)` | `0010:108~` | `returns public.encounters`, scheduled→registered, perm `encounter.register`, `registered_at=now()`, 소스상태 선검사(PT409)·not-found(PT404)·권한(42501) | `call_register_encounter` 가 `select * from public.register_encounter($1)` |
| 전이 트리거 `trg_encounters_transition` | `0010:174~` | INSERT=초기상태 가드·UPDATE=매트릭스, 위반→`PT409` | walk-in INSERT(registered) 통과·비정상 상태 차단(방어심층) |
| 감사 트리거 `trg_encounters_audit` | `0010` (0004 `audit_trigger_fn` 재사용) | after insert/update/delete, actor=`app.actor_id`∥`auth.uid()` | INSERT=`create` 감사·RPC=`update` 감사(앱 무작업) |
| 인덱스 `idx_encounters_dept_status` | `0010:60` | `(department_id, status)` | **대기열 = INSERT 자체**(4.3 가 이 인덱스로 조회·구독) |
| `_run_authed`/`authenticated_conn` | `core/db.py:109`/`:90`(approx) | sub→`request.jwt.claims`+`app.actor_id` GUC 주입, DB장애→503. **현재 PostgresError 전부 503**(1.1 이 sqlstate 분기 추가) | walk-in INSERT·RPC 호출 트랜잭션 |
| `insert_patient` 패턴 | `core/db.py:1071~` | `_run_authed`+in-txn `has_permission` 재평가(TOCTOU)+`returning {COLUMNS}`+UniqueViolation→Conflict | `insert_walk_in_encounter` 골격 |
| `require_permission(code)` | `core/security.py:125` | FastAPI 의존성 팩토리, 미충족 403 | 라우터 게이트(register/read) |
| `ConflictError`/`NotFoundError`/`ForbiddenError`/`AppError` | `core/errors.py:83`/`:77`/`:69`/`:37` | 409 "잘못된 상태 전이입니다."(code `conflict`)/404/403/봉투 `{error:{code,message,detail}}` | SQLSTATE 매핑 타깃 + 422(`AppError(status_code=422)`) |
| 422 검증 핸들러 | `core/errors.py:121~` | `_sanitize_validation_errors`(PII 차단) | Pydantic 검증 자동 |
| 환자 검색 API | `api/v1/patients.py` `GET ?q=` | `q:str|None Query(max_length=100)`, ILIKE 이름+차트번호+연락처, 게이트 `patient.read` | 웹 walk-in 환자 검색(변형 불요) |
| `searchPatients` | `web/src/lib/reception/patients.ts` | `(q, signal, pageSize=20)->PatientListItem[]`, encodeURIComponent·abort | 접수 화면 환자 피커(선택 핸들러만 폼 바인딩) |
| `PatientSearchCommand` | `web/src/components/shell/patient-search-command.tsx` | Base UI Dialog·전역 Ctrl K·디바운스200ms·↑↓Enter·aria-live·오환자 가드레일 | 검색 피커 패턴 미러(통째 재사용 말고 재조립 — 선택=이동 아닌 바인딩) |
| `apiFetch` | `web/src/lib/api/client.ts` | `<T>(path, init)`, Supabase 세션 Bearer 자동·`{error:{code,message,detail}}`→`ApiError(code,message,status,detail)` | 내원 생성 POST |
| RHF+Zod 폼 | `web/src/components/reception/patient-register.tsx` + `lib/reception/patients.ts` | `useForm({resolver:zodResolver})`·`disabled={isSubmitting}`·`setError`+toast 분리 | 접수 폼 |
| 진료과 직접 조회 | `web/src/lib/admin/masters.ts:fetchMasters/fetchDepartments` | Supabase `.from("departments").select(...)` RLS 읽기 | 진료과 select(단순 읽기=Supabase 직접) |
| FastAPI 통합 테스트 픽스처 | `api/tests/test_patients_integration.py` | `_get_token`·`TestClient`·모듈 스코프·실패 skip | 내원 엔드포인트 테스트 |
| 시드 계정·진료과·권한 grant 패턴 | `supabase/seed.sql` · `0002:110-114` | admin cross-join 멱등·`admin@pms.local`/`doctor@pms.local`/`Staff1234`·진료과 `IM,FM,OS,…` | reception grant(Task 5)·테스트 success/403/FK |
| nav 접수 메뉴 | `web/src/lib/nav/staff-nav.ts:56` | `{label:"접수", href:"/reception/intake", roles:["reception"]}` 이미 존재 | 페이지만 채우면 진입 |

### 스키마 — encounters 컬럼(4.1 소유, 4.2 소비)

walk-in INSERT 가 채우는 컬럼: `patient_id`·`department_id`·`room_id`(선택)·`visit_type='walk_in'`·`status='registered'`·**`registered_at=now()`**·**`created_by=<sub>`**. DB 자동: `id`·`encounter_no`(시퀀스)·`is_active=true`·`created_at`/`updated_at`. NULL 로 둠: `doctor_id`(4.4 start_consult 가 세팅)·`consult_started_at`/`completed_at`/`cancelled_at`/`no_show_at`(후속 전이)·`cancel_reason`. ⚠️ **PII/건강민감 자유텍스트 컬럼 없음**(주호소·증상=4.6 SOAP) → encounters 감사 스냅샷에 건강정보 무유입(3.6 마스킹 집합 변경 불요).

### 에러 계약 (DB SQLSTATE → HTTP) — 4.2 가 매핑 **구현**

4.1 이 DB 에서 `PT409`/`PT404`/`42501` 발생을 보증했고, **4.2 가 HTTP 변환을 처음 구현**한다(4.1 §에러 계약 핸드오프).

| 상황 | DB 신호(asyncpg `e.sqlstate`) | HTTP | errors.py 클래스 |
|---|---|---|---|
| 잘못된 전이(역행·건너뛰기·종결 재전이·비정상 초기상태·소스상태 불일치 재호출) | `'PT409'` | **409** | `ConflictError`(code 오버라이드 `invalid_transition`, "잘못된 상태 전이입니다.") |
| 대상 내원 없음 | `'PT404'` | 404 | `NotFoundError` |
| 권한 미보유(RPC has_permission 게이트) | `'42501'`(insufficient_privilege) | 403 | `ForbiddenError` |
| 비활성 환자/진료과 접수(앱 검증) | (앱 raise) | 422 | `AppError(code="patient_inactive", status_code=422)` 등 |
| DB 장애(연결·타임아웃·기타 sqlstate) | 기타 | 503 | `ServiceUnavailableError`(기존 폴백 유지) |

- **구현 위치(권장)**: `_run_authed`(db.py:109) 에 `except asyncpg.PostgresError as exc:` 를 `except _DB_OUTAGE_ERRORS` **앞에** 추가 — `exc.sqlstate` 가 3 코드면 AppError raise, 아니면 `ServiceUnavailableError`. 이렇게 하면 **모든 db 호출이 공유**(walk-in INSERT 의 트리거 PT409·register RPC·4.4 start_consult). 글로벌 수정이지만 기존 코드는 PT409/PT404/42501 을 발생시키지 않아 **회귀 0**. (대안: 전용 `_call_transition_rpc` 래퍼에 국소 try/except — 재사용성 낮아 비권장.)
- ⚠️ `_op` 내부에서 직접 raise 하는 `AppError`(in-txn has_permission→ForbiddenError, 활성 검증→NotFoundError/AppError)는 `asyncpg.PostgresError` 가 아니라 **그대로 전파**됨(매핑 절에 안 걸림) — 의도된 동작.

### walk-in 생성 메커니즘 (Open Q1 4.1 → 4.2 결정)

**walk-in = service_role 직접 INSERT**(`register_encounter` RPC **미경유**). 근거:
- `register_encounter` RPC 는 `scheduled→registered` **전이 전용**(4.1 Open Q1·매트릭스). walk-in 은 전이가 아니라 **신규 생성**(초기상태 `registered`).
- 0010 초기상태 가드가 INSERT `status='registered'` 를 허용 → walk-in 은 1 INSERT 로 완결. INSERT 가 `trg_encounters_transition`(초기상태 검증)·`trg_encounters_audit`(create 감사)를 발화 → **상태머신·감사 일관 적용**(AC3 충족 — RPC 와 동일한 DB 강제선을 INSERT 도 통과).
- 에픽 AC3 "register_encounter RPC를 통해 일관 적용" 의 해석: walk-in 은 **RPC 가 아니라 동일 상태머신·감사 트리거**를 통과(RPC 는 reserved 전이용). "일관"=두 경로가 같은 DB 불변식·감사를 거침. 별도 `create_walk_in_encounter` RPC 는 만들지 않음(직접 INSERT 가 더 단순·감사 자동, in-txn has_permission 으로 TOCTOU 동일 차단).

### 권한 모델 — ⚠️ reception 에 encounter.register 미시드

- `encounter.register`/`start`/`complete` = `0002:88-90` permission 시드, `encounter.read`/`cancel`/`no_show` = `0010` 신규. **role_permissions grant 는 admin cross-join 만**(0002:110-114, 0010 admin) — **reception·doctor 직무 grant 는 seed/마이그레이션에 0건**(확인: `grep reception|encounter|role_permissions supabase/seed.sql` → 빈 결과). 비-admin 런타임 grant = **Story 1.7 RBAC 매트릭스 UI** 소관.
- **4.2 결정**: 데모 가동을 위해 **seed.sql 에 reception→{encounter.register, encounter.read} grant 추가**(Task 5). 이는 1.7 의 런타임 grant 를 dev 시드로 미러 — rbac-ui-exposure-model("접수=원무 직무 본질 → 역할 노출, 메뉴는 nav 가 역할로 이미 노출")에 부합. API 는 `require_permission` 으로 방어심층 유지(시드 grant 가 있어야 reception 토큰이 통과).
- **테스트**: admin 토큰(전권)으로 success 경로, `encounter.register` 미보유 계정(doctor seed — grant 0)으로 403 경로. 게이트가 in-txn 재평가 전에 빠른 403.

### 대기열(waiting queue) — 별도 테이블 없음

핵심: **대기열은 `encounters` status 조회**다(별도 큐 테이블·enqueue 액션 없음). walk-in INSERT 가 `department_id`+`status='registered'` 행을 만드는 순간 **그 진료과 대기열에 진입**. 4.3 현황판이 `idx_encounters_dept_status`(0010:60)로 `where department_id=$ and status in ('registered','in_progress',...)` 조회·`postgres_changes` 구독해 표시. → **4.2 의 "대기열 등록" AC = INSERT 성공 자체**. 별도 큐잉 코드 작성 금지.

### 활성 가드 (is_active — 회고 4.2 체크 항목)

deferred-work: 0010 전이 트리거·RLS·INSERT 가 `is_active` 무시(비활성 환자/폐과 내원 생성 가능). **4.2 가 청산하는 부분**: walk-in 생성 시 **환자 존재+활성·진료과 활성을 앱 레벨에서 검증**(db 래퍼 in-txn `select is_active` → 비활성→404/422). 이는 "내원 생성 경로"가 주인인 가드라 4.2 스코프. **계속 이월**: 비활성 내원 자체의 전이 차단·포털 노출·hard delete 우회는 4.2 밖(전용 soft-delete 스토리, patients 0009 동일 패턴).

### 이월 인수 (상세)

- **① walk-in `registered_at`·`created_by` 충전** — 4.1 review handoff(deferred-work). RPC 미경유 직접 INSERT 라 4.1 이 NULL 로 둔 두 컬럼을 **INSERT 가 `now()`·`<sub>` 로 채움**(대기시간 메트릭 NFR-002·접수 직원 추적 근거). Task 1.2·8.2 검증.
- **② 신규 마이그레이션 0건 + seed grant** — 0010 이 전부 보유. seed.sql reception grant 만(dev 시드).
- **③ SQLSTATE 매핑 = 공유 인프라** — `_run_authed`/헬퍼 1회, 4.4/Epic6/7 재사용. 4.2 가 도입.
- **(이월 유지)** 동시 전이 낙관적 잠금·검색 튜닝·비활성 내원 전이/포털/hard delete·cancel_reason 감사 드리프트 = 4.2 밖, deferred-work 명시 유지(회고 교훈 #1·#2 — 은폐 금지).

### 회고 교훈 적용 (Epic 3 retro)

1. **번호 드리프트=영구 세금** → 4.2 마이그레이션 0건(0010 소비), seed.sql 만.
2. **교차절단 부채는 주인 스토리로만** → 4.2 는 walk-in 핸드오프·활성 가드(자기 경로)만 갚고, 감사 PII·reveal·검색 튜닝·동시성은 미접촉(명시 이월).
3. **적대 3레이어 리뷰 + 교차검증** → 구현 후 Blind/Edge/Acceptance 병렬, 추측성 findings 교차 기각.
4. **이월은 명시일 때만 자산** → Dev Notes 에 OUT·이월 항목 전부 기록.

### Project Structure Notes

- 신규: `api/app/api/v1/encounters.py`·`api/app/services/encounters.py`·`api/app/schemas/encounters.py`·`api/tests/test_encounters_integration.py`·`web/src/lib/reception/encounters.ts`·`web/src/components/reception/patient-intake.tsx`·`web/src/app/(staff)/reception/intake/page.tsx`. 수정: `api/app/core/db.py`(SQLSTATE 매핑 + 래퍼 3종)·`api/app/api/v1/router.py`(스텁 해제)·`supabase/seed.sql`(grant)·`docs/glossary.md`.
- 식별자 영문 snake_case(glossary 단일 진실). **JSON 전 경로 snake_case**(TS 도 camelCase 변환 금지). 무ORM: asyncpg + RPC 직접 호출. timestamptz=UTC(KST 는 `Intl`). 금액 무관(4.2 비-정산).
- root_path `/patient_management_system/api` → 외부 `/patient_management_system/api/v1/encounters/*`. 웹 `apiFetch` 는 `/v1/...`(basePath/baseURL 은 env). 내부 SSR fetch 는 prefix 없는 `http://api:8000/v1/...`(deferred-work 주의 — 단 4.2 접수 화면은 클라 컴포넌트 `apiFetch` 사용).

### References

- [Source: epics.md#Story-4.2] (`_bmad-output/planning-artifacts/epics.md:769-787`) — AC 원문(예약 접수·walk-in 즉석 접수·register_encounter 일관 적용).
- [Source: epics.md#Epic-4] (`:745-749`) — 에픽 목표·walk-in 독립 완결. [Source: epics.md] (`:40-41 FR-020/021`, `:142 NFR-040`, `:223-225`).
- [Source: 4-1-내원-상태머신-전이-rpc-db.md] — 상태머신·RPC 계약·§에러 계약(PT409→409)·Open Q1(walk-in 직접 INSERT)·review defer(walk-in registered_at/created_by 핸드오프·is_active 이월)·전이 매트릭스.
- [Source: architecture.md] (`:193-195` 쓰기=service_role·에러봉투·409, `:253` 액션 엔드포인트·status PATCH 금지, `:381` 3분할, `:212` root_path).
- [Source: project-context.md] — 불변식 DB 소유·상태머신 재구현 금지·쓰기=FastAPI/조회=Supabase/실시간=구독·정의된 전이만(409)·mutation 중 disable·raw PII 미로깅·JSON snake_case 전 경로.
- [Source: supabase/migrations/0010_encounters.sql] — 테이블·전이 트리거·RPC 5종·인덱스(`idx_encounters_dept_status`)·권한·RLS·감사. [Source: 0002_identity_rbac.sql:88-114] — encounter 권한 시드·admin-only grant.
- [Source: api/app/core] — `errors.py:37-96,121`(AppError/Conflict/NotFound/Forbidden/422 핸들러)·`db.py:43,90,109,1071`(_DB_OUTAGE_ERRORS·authenticated_conn·_run_authed·insert_patient)·`security.py:125`(require_permission). [Source: api/v1/patients.py·router.py:26-27]·[Source: api/v1/router.py] 스텁.
- [Source: web/src] — `lib/api/client.ts`(apiFetch·ApiError)·`lib/reception/patients.ts`(searchPatients·PatientListItem)·`components/shell/patient-search-command.tsx`·`components/reception/patient-register.tsx`(RHF+Zod)·`lib/admin/masters.ts`(fetchDepartments·CODE_STATUS_META)·`lib/nav/staff-nav.ts:56`(접수 nav)·`lib/supabase/client.ts`·`app/(staff)/layout.tsx`(requireStaff).
- [Source: ux-designs] — DESIGN.md(Colors L20-37 5상태 hex·status-received-ink #8A5D09·primary #0E7C8E·WCAG AA)·EXPERIENCE.md(IA L46-55 reception 사이트맵·Ctrl K 환자검색·모달 1단계·접근성 음영 비의존). UX-DR6(status-badge A3)·UX-DR7/8 풀 컴포넌트는 4.3.
- [Source: deferred-work.md] — walk-in registered_at/created_by 핸드오프·is_active 미필터·검색 튜닝·낙관적 동시성(전부 이월 상태 명시).
- [Source: epic-3-retro-2026-06-21.md] — 번호 정합·교차절단 부채 주인 스토리·적대 3레이어·3.5→4.2 검색 재사용.
- [Source: docs/glossary.md] — encounter·encounter_no·전이 RPC·encounter_status·SQLSTATE PT409/PT404 이미 등재(4.1).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMad dev-story)

### Debug Log References

- `supabase db reset`(0001~0010 + 새 seed) → exit 0. reception 계정(EMP0003)·`encounter.register`/`encounter.read` grant 확인.
- SQLSTATE 매핑 검증: `_run_authed` 가 PT409→409(`invalid_transition`)·PT404→404·42501→403 변환, 그 외 PostgresError→503 폴백(회귀 0).
- 테스트 디버그: `_insert_scheduled` 가 psql `-tA` 의 INSERT…returning 출력에 `INSERT 0 1` 명령 태그가 섞여 URL 오염 → CTE(`with … select id`)로 감싸 SELECT 반환으로 해소(SELECT 는 명령 태그 없음).
- `uv run pytest tests/test_encounters_integration.py` → 15 passed. 전체 `uv run pytest` → **326 passed, 9 skipped**(기존 311 + 신규 15, 회귀 0). `ruff check`/`ruff format --check` clean.
- 웹: `npm run lint`(ESLint) clean, `npx tsc --noEmit` exit 0, `npm test` → **202 passed**(기존 192 + 신규 10). 라우트 도달성 스모크: `/v1/encounters`·`/{id}/register`·GET 무인증 → 401(404 아님 = 등록 확인).

### Completion Notes List

- **Task 1 — `core/db.py`**: `_map_pg_sqlstate`(PT409→ConflictError `invalid_transition`·PT404→NotFoundError·42501→ForbiddenError, 그 외 None→503) + `_run_authed` 에 `except asyncpg.PostgresError` 분기를 `_DB_OUTAGE_ERRORS` 앞에 추가(프로젝트 첫 sqlstate 분기·공유 인프라, 4.4/Epic6·7 재사용). 내원 래퍼 3종: `insert_walk_in_encounter`(권한 in-txn 재평가 + 환자/진료과 존재·활성 검증 + `registered_at`·`created_by` 충전=4.1 handoff 청산) · `call_register_encounter`(register_encounter RPC) · `fetch_encounter`. `_require_encounter_register` + `_ENCOUNTER_COLUMNS`.
- **Task 2/3/4 — 4계층 신규**: `schemas/encounters.py`(EncounterCreate=patient_id·department_id·room_id?, EncounterResponse=0010 전 컬럼 snake_case) · `services/encounters.py`(create_walk_in_encounter·register_scheduled_encounter·get_encounter) · `api/v1/encounters.py`(POST `""`·POST `/{id}/register`·GET `/{id}`, 게이트 encounter.register/read) · `router.py` 스텁 주석 해제 + include.
- **Task 5 — `seed.sql`**: reception 데모 계정(EMP0003·reception@pms.local) 추가 + reception 역할 → encounter.register/read grant(0002/0010 cross-join 패턴 미러·멱등). 프로덕션 런타임 grant 는 1.7 매트릭스 소유 주석. **신규 마이그레이션 0건**(0010 소비).
- **Task 6 — 웹**: `lib/reception/encounters.ts`(Encounter 타입 수동 정의·walkInIntakeSchema·createWalkInEncounter·ENCOUNTER_STATUS_META) · `components/reception/patient-intake.tsx`(환자 검색 피커=3.5 searchPatients 재사용·선택 시 폼 바인딩 + 진료과 select=fetchDepartments 활성만 + 접수 확정 + 성공 카드 + ApiError 분기 + disabled) · `app/(staff)/reception/intake/page.tsx`(requirePermission encounter.register 가드). **현행 코드 우선 준수**: TanStack Query/shadcn 미사용 → Base UI 없는 플레인 요소 + useState/useEffect + apiFetch, database.types.ts 미생성 → 타입 수동.
- **Task 7 — `docs/glossary.md`**: 4.2 소비 레이어 섹션 신설(엔드포인트 3종·db 래퍼·`_map_pg_sqlstate`·서비스·스키마·웹 식별자·reception seed grant).
- **Task 8 — 테스트**: `test_encounters_integration.py`(15건 — walk-in 생성·handoff 충전·영속·감사·미존재/비활성/필수누락·register RPC 200·재호출 409 invalid_transition·미존재 404·권한 403·reception 201·GET) + 웹 `encounters.test.ts`(6) + `patient-intake.test.tsx`(4 — 활성 진료과만 노출·버튼 가드·성공 카드·에러 토스트).
- **결정 — reception 데모 계정 추가(Task 5 확장)**: 스토리는 역할 grant 만 명시했으나, nav 가 접수 메뉴를 `roles:["reception"]` 로 노출(admin 미노출)하므로 골든 패스 UI 데모엔 reception 계정이 필요 → seed 에 EMP0003 추가(기존 "데모 의사 배정" 선례 동형). 단위 테스트(`test_admin_users.py` len==2)는 모킹이라 무영향, 통합 테스트는 `.issubset` 라 안전.
- **이월 유지(은폐 아닌 명시)**: 대기 현황판·실시간·status-badge A3 풀 컴포넌트(4.3)·진찰 시작(4.4)·예약 환자 생성/예약 목록 UI(Epic 6)·검색 튜닝·동시 전이 낙관적 잠금·비활성 내원 전이/포털/hard delete = 4.2 범위 밖. register 엔드포인트는 계약·SQLSTATE 인프라로 빌드·테스트(UI 미연결 — appointments 없음).

### File List

- `api/app/core/db.py` (수정 — `_map_pg_sqlstate` + `_run_authed` SQLSTATE 분기 + 내원 래퍼 3종·`_require_encounter_register`·`_ENCOUNTER_COLUMNS`)
- `api/app/schemas/encounters.py` (신규)
- `api/app/services/encounters.py` (신규)
- `api/app/api/v1/encounters.py` (신규)
- `api/app/api/v1/router.py` (수정 — encounters import·include)
- `api/tests/test_encounters_integration.py` (신규)
- `supabase/seed.sql` (수정 — reception 데모 계정 + 역할 권한 grant)
- `docs/glossary.md` (수정 — 4.2 소비 레이어 섹션)
- `web/src/lib/reception/encounters.ts` (신규)
- `web/src/lib/reception/encounters.test.ts` (신규)
- `web/src/components/reception/patient-intake.tsx` (신규)
- `web/src/components/reception/patient-intake.test.tsx` (신규)
- `web/src/app/(staff)/reception/intake/page.tsx` (신규)

## Change Log

| 날짜 | 변경 | 작성자 |
|---|---|---|
| 2026-06-21 | 스토리 생성(create-story, ready-for-dev) — walk-in 접수 풀스택 + register_encounter RPC 액션 엔드포인트 + SQLSTATE→HTTP 공유 매핑 인프라 + 활성 가드 + reception seed grant. 4.1 handoff(registered_at/created_by) 청산·현행 코드 우선(TanStack Query/shadcn 미사용) 인코딩 | create-story |
| 2026-06-21 | 구현 완료(dev-story, review) — 4계층(`encounters.py`/서비스/스키마/db 래퍼) + `_map_pg_sqlstate` 공유 SQLSTATE 매핑 + 활성 가드 + 웹 접수 화면(`/reception/intake`) + seed reception 계정·grant + glossary. 백엔드 326 passed/9 skipped(ruff clean), 웹 202 passed(ESLint·tsc clean), db reset 0001~0010 그린 | dev-story |
| 2026-06-21 | 코드리뷰(3레이어 적대) done — patch 2건 적용(room_id FK 위반→422 백스톱 + 미매핑 SQLSTATE 로그·웹 이중제출 ref 락) + 회귀 테스트 1건. defer 5건·dismiss 9건. 백엔드 327 passed/9 skipped(ruff clean), 웹 202 passed(ESLint·tsc clean) | code-review |

## Open Questions

1. **register 엔드포인트 MVP 활용도** — `POST /encounters/{id}/register` 는 scheduled→registered 전이용이나 MVP 에 `scheduled` 행 생성 주체 없음(appointments=Epic 6). 권장: **계약·SQLSTATE 인프라로 빌드·테스트하되 UI 미연결**(walk-in 데모). 대안(엔드포인트 보류, 4.2=walk-in only)도 가능하나 SQLSTATE 매핑은 4.4 가 어차피 필요 → register 도 함께 빌드해 인프라를 1회 검증하는 편이 견고. **현 결정: register 엔드포인트 포함.**
2. **reception 권한 시드 vs 1.7 UI** — 권장: seed.sql 에 reception→encounter.register/read grant(데모 가동). 대안: 1.7 매트릭스 UI 로 런타임 grant(시드 무수정·프로덕션 충실). **현 결정: seed.sql grant(데모 우선) + 주석으로 1.7 소유 명시.** 팀이 시드 무오염 선호 시 1.7 수동 grant 로 대체 가능.
3. **walk-in 진료실(room_id)·담당의 사전 배정** — 권장: 접수 시 진료과만 필수, room_id 선택(미배정 NULL — 4.4/현황판이 배정). 담당의는 start_consult 가 세팅(4.4). **현 결정: 진료과 필수·진료실/담당의 미배정 허용.**
4. **중복 접수 방지** — 같은 환자의 미완결 내원이 있을 때 재접수 차단 정책? 권장: **4.2 범위 밖**(상태머신이 종결 전 재전이를 막고, UI mutation disable 이 이중 제출 1차선). 환자별 활성 내원 1건 제약은 운영 정책 확정 후 별도(현 결정: 미차단, 명시 이월).
