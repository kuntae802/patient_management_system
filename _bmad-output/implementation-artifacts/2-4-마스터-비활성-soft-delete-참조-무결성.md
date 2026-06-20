---
baseline_commit: de6bcfe87f5f650c6a1b4cbd83b2b42fbfd27f35
---

# Story 2.4: 마스터 비활성(soft delete) · 참조 무결성

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 관리자,
I want 더 이상 쓰지 않는 마스터 코드를 비활성 처리하되 그 영향(참조 중인 진료실·직원)을 사전에 인지하고, 비활성 마스터로의 신규 배정이 시스템 차원에서 막히기를,
so that 신규 사용은 막되 과거 기록의 무결성은 보존되고, 단일 진실이 데이터 차원에서 끝까지 강제된다.

## Acceptance Criteria

> **출처:** epics.md Story 2.4 (AC1·AC2 = 에픽 원문, FR-203). AC3~AC7 = 2.1/2.2 코드리뷰가 본 스토리("참조 무결성 심화")로 명시 이월한 항목(deferred-work.md:27-31)을 운영 가능한 검증 기준으로 구체화.

**AC1 (에픽·FR-203 — soft delete 본질):**
**Given** 참조 중인 마스터 코드에 대해
**When** 비활성(`is_active=false`)으로 전환하면
**Then** 물리 삭제 없이 신규 선택에서만 제외된다(행·명칭·값 보존, 재활성 가능). DELETE 엔드포인트·DML 은 만들지 않는다.

**AC2 (에픽 — 참조 보존):**
**Given** 비활성 코드를 참조하는 과거 임상·정산 기록에 대해
**When** 그 기록을 조회하면
**Then** 코드 명칭·값이 정상 표시되어 참조 무결성이 유지된다(전역 참조 데이터 RLS `authenticated SELECT using(true)` 가 비활성·만료 행도 노출 — 0006·0007 이미 충족, 회귀 금지).

**AC3 (API 권위 레벨 참조 무결성 — 신규 배정 차단):**
**Given** 비활성 진료과가 있을 때
**When** 진료실을 그 진료과에 **새로 배정**(생성 또는 소속 변경)하려 하면
**Then** API(쓰기 권위)가 422 `inactive_department` 로 거부한다. 단, 수정 중인 진료실의 **현 소속이 이미 비활성**이고 그대로 유지하는 경우는 허용한다(이탈 강요 금지 — room-form 의 "현 소속 유지" 옵션과 일치). 미존재 진료과는 기존대로 422 `invalid_department`.

**AC4 (진료과 비활성 시 의존성 경고):**
**Given** 진료실·직원이 참조 중인 진료과에 대해
**When** 관리자가 비활성을 시도하면
**Then** 확인 다이얼로그가 "N개 진료실 · M명 직원이 이 진료과를 참조 중입니다(비활성해도 과거 기록은 보존)"를 표시한다. 이는 **경고일 뿐 차단이 아니다**(soft delete 는 참조 중에도 가능, AC1). 의존성 0건이거나 카운트 조회 실패 시 기존 일반 확인 문구로 폴백한다(경고는 보조 정보 — fail-soft).

**AC5 (UI 명확성 — 비활성 소속 표기):**
**Given** 비활성 진료과에 소속된 진료실에 대해
**When** 진료실 목록을 조회하면
**Then** 소속 진료과 셀에 "(비활성)" 마커가 표시된다. 그리고 소속 진료과 미해석 시 폴백 문구는 오해를 주는 "(삭제된 진료과)" 대신 "(미상)"으로 표기한다(hard delete 부재 — 정상 경로 비도달).

**AC6 (데이터 품질 — 코드 대소문자 무관 unique):**
**Given** 마스터(진료과·진료실·진단·수가·약품) 코드에 대해
**When** 대소문자만 다른 코드(`ORTHO`/`ortho`)를 추가하려 하면
**Then** 409 `code_taken` 으로 거부된다(`lower(code)` unique — 원본 케이스 표시는 보존).

**AC7 (회귀 가드 — 권한·감사):**
**Given** 본 스토리의 모든 변경에 대해
**When** 비활성·신규배정거부·코드교체가 일어나면
**Then** 변경은 감사 로그에 actor=관리자로 자동 기록되고(0006·0007 트리거), `master.manage` 미보유자는 모든 쓰기 경로에서 거부된다(403). 2.1/2.2/2.3 의 기존 동작·테스트는 회귀하지 않는다.

> **AC 해석(중요 · dev agent 필독):**
> 이 스토리는 **새 마스터 기능을 만드는 게 아니라, 2.1/2.2/2.3 이 세운 마스터의 "참조 무결성"을 데이터·API·UI 끝까지 단단히 채우는 일**이다. soft delete 스키마(`is_active`)·기본 토글·행 보존·만료 필터·검색 피커는 **이미 전부 구현·테스트됨**(0006·0007 · db.py `set_*_active` · masters-manager · isCurrentlyValid). 따라서 AC1·AC2 의 "기본 메커니즘"을 **다시 만들지 말 것** — 이미 충족돼 있고, 본 스토리는 회귀 가드(AC7)로 그것을 지키며 다음 4개 갭만 메운다:
> 1. **AC3** — 비활성 진료과로의 신규 배정을 API 권위 레벨에서 차단(현재 UI 피커만 필터, DB FK 는 존재만 검증).
> 2. **AC4** — 진료과 비활성의 운영 영향(참조 진료실·직원 수)을 경고.
> 3. **AC5** — 진료실 목록의 비활성 소속 표기 + 오해성 폴백 문구 교체.
> 4. **AC6** — 코드 대소문자 무관 unique(데이터 일관성).
>
> **의존성 경고(AC4)는 진료과에만 적용한다.** 진료실·진단·수가·약품을 참조하는 테이블은 Epic 4(내원·진단)·Epic 5(오더·약품·수가)·Epic 7(수납)에서야 생긴다 — 현재는 참조처가 없어 카운트가 항상 0이므로 경고가 무의미하다. 진료실·코드 마스터는 기존 일반 확인 다이얼로그를 유지한다(이 패턴을 후속 에픽이 참조처 등장 시 확장). **새 라이브러리·새 권한·새 nav 항목 도입 금지**(전부 기존 자산 재사용).

## Tasks / Subtasks

- [x] **Task 1 — 마이그레이션 0008: 코드 대소문자 무관 unique (AC6)**
  - [x] `supabase/migrations/0008_masters_code_ci_unique.sql` 생성. 5개 마스터 테이블(`departments`·`rooms`·`diagnoses`·`fee_schedules`·`drugs`)의 기존 `code text ... unique`(제약명 `<table>_code_key`) 를 **drop** 하고, `create unique index <table>_code_lower_key on public.<table> (lower(code));` 로 교체. `citext` 미사용(컬럼 타입 변경·전 비교 경로 영향 회피 — 함수 인덱스로 원본 케이스 표시는 보존하면서 유일성만 대소문자 무관화).
  - [x] 파일 헤더에 번호 cascade 명시: 0008 = 마스터 코드 CI unique(Story 2.4). 아키텍처 계획의 `0008_patients`(Epic 3)는 **0009 로 한 칸 더 시프트**(glossary.md §마이그레이션 번호 변이 패턴 — 0005 crypto·0007 codes 와 동일). **이미 적용된 0001~0007 은 편집 금지**(마이그레이션 불변성).
  - [x] 멱등 보장: `alter table ... drop constraint if exists`, `create unique index if not exists`. 적용 순서 안전(기존 데이터가 대소문자 충돌 시 인덱스 생성 실패 — 현재 시드 없음/관리자 입력만이라 충돌 데이터 없음, 정상).
  - [x] `docs/glossary.md` §마이그레이션 번호 변이에 0008 항목 추가(있으면 갱신). + `supabase migration up --local` 로 실 DB 적용, 마이그레이션 테스트 22개 GREEN(기존 `_code_key` 제약 단언 테스트 2개를 `lower(code)` 인덱스 단언으로 갱신).

- [x] **Task 2 — API: 비활성 진료과 신규 배정 차단 (AC3)** [api/app/core/db.py]
  - [x] `insert_room`: INSERT 전, `department_id is not None` 이면 동일 트랜잭션에서 `select is_active from public.departments where id=$1` 조회. None → 422 `invalid_department`(기존 코드 유지), `is_active=false` → 422 `inactive_department`(신규). 기존 `ForeignKeyViolationError` catch 는 백스톱으로 유지. (공용 헬퍼 `_assert_department_assignable` 추출.)
  - [x] `update_room`: room 현 소속 비교가 필요. UPDATE 전 `select id, department_id from public.rooms where id=$1` 으로 현 소속 + 존재 확인(없으면 404). 새 `department_id is not None` **그리고 현 소속과 다를 때만** 진료과 `is_active` 검사(None→422 `invalid_department`, 비활성→422 `inactive_department`). 현 소속(이미 비활성) 유지 시 통과. 검사 통과 후 UPDATE.
  - [x] 새 에러는 `AppError(..., code="inactive_department", status_code=422, detail={"department_id": str(...)})` — `invalid_department` 미러. 메시지 한국어("비활성된 진료과에는 새로 배정할 수 없습니다.").
  - [x] `_require_master_manage` 동일 트랜잭션 재평가(TOCTOU 차단)는 그대로 유지(검사·쓰기 모두 같은 `_op` conn). 통합 테스트 GREEN(AC3 생성/변경/유지 + AC6 대소문자 코드).

- [x] **Task 3 — API: 진료과 의존성 카운트 엔드포인트 (AC4)**
  - [x] [api/app/schemas/masters.py] `DepartmentDependents(BaseModel)`: `rooms: int`, `staff: int` 추가.
  - [x] [api/app/core/db.py] `count_department_dependents(sub, department_id) -> dict[str,int]`: 진료과 존재 확인(없으면 404), `select count(*) from rooms where department_id=$1 and is_active=true` + `select count(*) from users where department_id=$1 and employment_status='active'`. service_role 풀이 users RLS(본인행, 0003)를 우회하므로 직원 수 카운트 가능(클라 직접조회로는 불가 — 이 엔드포인트가 필요한 이유). 읽기이므로 권한 재평가 불요(엔드포인트 게이트로 충분 — `fetch_staff_list`·`fetch_audit_logs` 동형).
  - [x] [api/app/services/masters.py] `count_department_dependents(sub, department_id) -> DepartmentDependents`.
  - [x] [api/app/api/v1/masters.py] `GET /departments/{department_id}/dependents` → `DepartmentDependents`, `Depends(require_master_manage)`. **masters 라우터 최초의 GET**(기존 읽기는 전부 Supabase 직접조회) — 라우터 docstring 에 "직원 수는 RLS 우회가 필요해 예외적으로 API 읽기" 1줄 주석. 통합 테스트 GREEN(rooms=2·staff 0→1 임시배정·doctor 403), ruff·전체 199 통과.

- [x] **Task 4 — Web: 진료과 비활성 의존성 경고 (AC4)** [web/src/components/admin/masters-manager.tsx · web/src/lib/admin/masters.ts]
  - [x] [lib] `DepartmentDependents` 타입(`{ rooms: number; staff: number }`, snake 불필요 — 숫자 2개) + `fetchDepartmentDependents(id: string)`: `apiFetch<DepartmentDependents>(\`/v1/masters/departments/${id}/dependents\`)`.
  - [x] [masters-manager] `onToggleActive`에서 **진료과 비활성**일 때만: 카운트를 조회한 뒤 그 수치를 담아 ConfirmDialog 를 연다(`openDepartmentConfirm` 헬퍼). 조회 중 `pendingId` 로 버튼 disable(이중 클릭 방지). 카운트 실패(ApiError/네트워크) 또는 진료과 외 마스터 → 기존 일반 문구로 폴백(경고는 보조 — fail-soft, 비활성 자체를 막지 않음).
  - [x] `PendingConfirm` 타입에 옵셔널 `dependents?: { rooms: number; staff: number }` 추가. ConfirmDialog `description` 을 의존성 유무로 분기(`confirmDescription` 헬퍼): 있으면 "현재 {rooms}개 진료실 · {staff}명 직원이 이 진료과를 참조 중…"; 없으면(0건/폴백) 기존 문구.
  - [x] 진료실·진단·수가·약품 비활성은 **기존 일반 확인 그대로**(참조처 미존재 — Non-goals). 컴포넌트 테스트 GREEN(카운트 표시·fail-soft 폴백·진료과 GET+PATCH 2회).

- [x] **Task 5 — Web: 진료실 목록 비활성 소속 표기 + 폴백 문구 (AC5)** [web/src/lib/admin/masters.ts · web/src/components/admin/masters-manager.tsx]
  - [x] `departmentLabel(departments, departmentId)`: 매칭된 진료과가 `is_active=false` 면 이름 뒤에 " (비활성)" 접미사. 미매칭 폴백 `"(삭제된 진료과)"` → `"(미상)"`(hard delete 부재로 정상 경로 비도달 — 절단/RLS 아티팩트만, 오해 방지). RoomTable 소속 진료과 셀이 이 라벨을 그대로 사용하므로 컴포넌트 변경 최소(라벨 함수 1곳). lib 테스트 GREEN(활성=이름·비활성=마커·미매칭=미상·null=—).
  - [x] room-form 의 select 는 이미 "(비활성)" 표기(58-67·129-136행) — 목록과 폼이 일관됨을 확인(회귀 없음).

- [x] **Task 6 — 테스트 (AC1~AC7)**
  - [x] [api/tests/test_masters_integration.py] 추가: ① 비활성 진료과 생성 후 그 진료과로 진료실 **생성** → 422 `inactive_department`(AC3). ② 진료실을 활성→비활성 진료과로 **소속 변경**(PATCH) → 422 `inactive_department`; 현 소속이 비활성인 진료실을 그 소속 유지로 PATCH(name 만 변경) → 200(AC3 예외). ③ `GET /departments/{id}/dependents`: 진료실 2개·직원 0→1 임시배정(try/finally 원복) 카운트 단언(admin 토큰, AC4). doctor → 403(AC7). ④ 대소문자 코드 충돌 — 대문자 생성 후 같은 값 소문자 → 409 `code_taken`(AC6). (실행 고유 code 패턴 `_code()` 사용.)
  - [x] [api/tests/test_migrations_masters.py · test_migrations_masters_codes.py] 갱신: 5개 테이블에 `lower(code)` unique 인덱스 존재 + 기존 `<table>_code_key` 제약 부재 단언(`pg_indexes`/`pg_constraint`). 기존 `contype='u'` 단언 테스트 2개를 교체.
  - [x] [web/src/lib/admin/masters.test.ts] 추가: `departmentLabel` — 활성 소속=이름, 비활성 소속=이름+"(비활성)", 미매칭="(미상)", null=`—`(AC5).
  - [x] [web/src/components/admin/masters-manager.test.tsx] 추가: 진료과 비활성 → `fetchDepartmentDependents` 모킹 → "N개 진료실 · M명 직원" 노출 + PATCH(`is_active:false`); 카운트 실패 시 일반 문구 폴백(AC4). 기존 진료과 비활성 테스트는 GET+PATCH 2회로 갱신, 진단 비활성은 일반 문구 유지(회귀).
  - [x] 기존 마스터 테스트 전부 통과 유지(AC7 회귀 가드) — API 199 pass/7 skip, web 122 pass.

- [x] **Task 7 — 검증·정리**
  - [x] API: `uv run ruff check`(클린)·`uv run pytest`(199 pass/7 skip — masters 통합 10건 실행). Web: `npm run lint`(클린)·`npx tsc --noEmit`(클린)·`npx vitest run`(122 pass).
  - [x] `database.types.ts` — **현재 프로젝트에 미존재**(생성 TS 타입 계약은 후속 도입, staff-nav 의 `Database` 는 lucide 아이콘). 재생성 대상 없음 확인. 0008 은 인덱스 교체라 어차피 타입 셰이프 무변.
  - [x] 커밋은 의미 단위로 분리(db / api / web)하되 **승인 시에만**(project-context 워크플로 규칙) — 커밋 미수행(승인 대기).

### Review Findings (코드 리뷰 2026-06-20)

> 3레이어 적대적 리뷰(Blind Hunter · Edge Case Hunter · Acceptance Auditor). **Acceptance Auditor: AC1~AC7 clean pass** · project-context 규칙 위반·Non-goals 침범 0. 분류: decision-needed 1 · patch 1 · defer 3 · dismiss 8.

- [x] [Review][Decision→Patch] 의존성 경고 직원 카운트 의미 — `count_department_dependents` 가 `employment_status='active'` 만 셌다. **결정(옵션 2): 휴직 포함 = 비-terminated.** "재직(在職)"은 휴직 포함(퇴사만 제외)이고 휴직 직원도 그 진료과 소속이라 복귀 시 영향받으므로 카운트에 포함. `<> 'terminated'` 로 patch + docstring·통합테스트(휴직→1·퇴사→0) 보강. [api/app/core/db.py count_department_dependents] (edge) — ✅ 적용
- [x] [Review][Patch] `update_room` 존재 확인 후 `assert row is not None` → `if row is None: raise NotFoundError` (graceful 404 복원·기존 `update_*` 패턴 일치·`python -O` 제거 위험 제거; Blind+Auditor 공통 지적) [api/app/core/db.py update_room] (blind+auditor) — ✅ 적용
- [x] [Review][Defer] 단일 `pendingId` 다중행 경합 — `openDepartmentConfirm` 의 `finally setPendingId(null)` 가 무조건 실행돼 await 중 다른 행 토글 시 잘못된 행 pending 해제. 기존 전역 deferred(per-row pending Set, 2.1/2.2)와 동형 [web masters-manager.tsx] — deferred, 전역 하드닝 (blind+edge)
- [x] [Review][Defer] 의존성 카운트 테스트의 시드 원복 robustness — `try/finally` 로 원복하나 restore `psql.run` 자체 실패 시 시드 직원 소속이 오염될 수 있음(test-only, UUID 보간이라 인젝션은 무위험) [api/tests/test_masters_integration.py] — deferred, test 하드닝 (blind)
- [x] [Review][Defer] `lower(code)` unique 가 내부 공백·유니코드 케이스폴딩(NFC/dotless-i 등) 미정규화 — `_Stripped` 는 양끝 trim 만. ASCII 영숫자 코드라 실무 위험 낮음, 스펙이 code 정규식 비강제 [supabase/migrations/0008] — deferred, data quality (edge)

**Dismissed(노이즈/오탐/의도된 설계, 8):** ① 비활성 진료과로 옮긴 뒤 되돌리기 차단 = AC3 의도대로(신규 배정 차단). ② `count`/`update_room` 의 exists↔쓰기 TOCTOU = soft delete only(물리 삭제 없음)라 행 소멸 불가 → 비도달. ③ 비활성 진료실 카운트 제외 = "운영상 살아있는 참조"의 명시적 설계(비활성 진료실 ≈ 제거된 자원). ④ `fetchDepartmentDependents` 런타임 검증 부재 = 코드베이스 전역이 API 응답 zod 미검증(일관). ⑤ 마이그레이션 충돌 데이터 실패/부분적용 = 그린필드(충돌 데이터 0)+파일 단위 트랜잭션. ⑥ FK 백스톱 detail None = 무해 방어코드. ⑦ 테스트 `==` 정확매칭 = 신규 uuid 진료과라 결정적. ⑧ 다이얼로그 스냅샷 TOCTOU = 경고는 비차단 보조정보(AC4 설계).

## Dev Notes

### 핵심 프레이밍 — 이미 끝난 것 vs 본 스토리가 채우는 것

| 항목 | 상태 | 위치 |
|---|---|---|
| `is_active` soft delete 컬럼 + CHECK + RLS(비활성도 SELECT) | ✅ 완료 | 0006·0007 |
| `set_*_active` 토글 엔드포인트(진료과·진료실·진단·수가·약품) | ✅ 완료 | db.py · masters service/router |
| 비활성 후 행·명칭 보존(AC1·AC2 기본) + 통합 테스트 | ✅ 완료 | test_masters_integration.py · test_masters_codes_integration.py |
| 만료/비활성 "현재 유효" 필터(소비처 피커) | ✅ 완료 | isCurrentlyValid · fetchCurrentlyValidMasters(2.3) |
| `users.department_id → departments` FK(미존재 차단) | ✅ 완료 | 0006:37-39 |
| **비활성 진료과로의 신규 배정 차단(API 권위)** | ⛔ 갭 → **AC3** | db.py insert_room/update_room |
| **진료과 비활성 시 의존성(진료실·직원) 경고** | ⛔ 갭 → **AC4** | 신규 GET 엔드포인트 + masters-manager |
| **진료실 목록 비활성 소속 표기 + 폴백 문구** | ⛔ 갭 → **AC5** | departmentLabel |
| **코드 대소문자 무관 unique** | ⛔ 갭 → **AC6** | 마이그레이션 0008 |

본 스토리의 모든 작업은 deferred-work.md 가 **"Story 2.4(참조 무결성 심화)에서 다룰 항목"**으로 명시 이월한 것이다(deferred-work.md:27-31). 새 발명이 아니라 의도된 후속.

### AC3 상세 — 비활성 진료과 신규 배정 차단 (방어심층)

현재 `insert_room`/`update_room`(db.py:565-623)은 FK 위반만 catch 한다 → 진료과가 **존재**하면 비활성이어도 배정을 허용한다. UI 피커(room-form.tsx:58-67)는 활성 진료과만 노출하나, 스펙은 "신규 선택 제외"를 소비처 피커에 위임할 뿐 **쓰기 권위(API)는 비워뒀다**. 프로젝트 원칙(project-context §검증 3중 + "쓰기=FastAPI service_role 권위")상 API 가 권위 레벨에서 막아야 단일 진실이 끝까지 강제된다.

- **insert_room**: 신규 = 모든 비활성 배정 차단. `department_id` 비-null → `select is_active` 조회. None→422 `invalid_department`, false→422 `inactive_department`.
- **update_room**: **변경분만** 차단. 현 소속을 먼저 읽어, 새 값이 현 값과 **다르고** 비활성일 때만 거부. 현 소속(이미 비활성) 유지는 허용 — room-form 이 수정 시 현 소속을 옵션에 남겨두는(58-67행) 정책의 API 미러. 이걸 어기면 "비활성 진료과 소속 진료실의 이름만 바꾸는" 정당한 수정이 막힌다.
- **TOCTOU**: 검사와 INSERT/UPDATE 는 동일 `_op` 트랜잭션 내. 검사 직후 진료과가 비활성화되는 창은 read-committed 하에 미세하고, 결과(방금 비활성된 과에 배정)는 AC2 가 허용하는 "참조 보존"과 동치라 무해. 추가 락 불요.
- **FK catch 유지**: 물리 삭제가 없으므로(soft delete only) FK 위반은 진짜 미존재 id 뿐 — 명시 검사가 이를 먼저 422 로 잡지만, race 백스톱으로 except 절은 남긴다.

### AC4 상세 — 의존성 카운트는 왜 신규 엔드포인트인가

진료과를 참조하는 두 축: `rooms.department_id`(0006 RLS `authenticated SELECT using(true)` — 클라가 이미 전체 보유, masters-manager `rooms` 상태) + `users.department_id`(0003 RLS = **본인 행만** — 클라 직접조회 불가). 따라서 직원 수는 service_role(FastAPI)로만 셀 수 있다. 진료실 수만 클라로 세고 직원은 무시하면 deferred 항목의 "진료실·**직원** 수" 요구를 절반만 충족 → 정석은 service_role 엔드포인트 1개로 둘 다 센다.

- 카운트 기준 = **운영상 살아있는 참조**: 활성 진료실(`is_active=true`) + 재직 직원(`employment_status='active'`). 비활성 진료실/퇴사자는 이미 운영에서 빠졌으므로 경고 대상 아님.
- 엔드포인트는 **경고 보조 정보**다. 조회 실패가 비활성 자체를 막으면 안 된다(fail-soft) — 프로젝트의 다른 경로(fetchMasters·피커)는 fail-loud 지만, 여기 카운트는 informational 이므로 의도적으로 다르다(이 차이를 코드 주석에 1줄).
- 차단 아님: AC1/AC2 가 "참조 중에도 비활성 가능 + 행 보존"을 보장하므로, 경고 후 관리자가 진행하면 그대로 비활성된다.

### AC5 상세 — UI 명확성

`departmentLabel`(masters.ts:432-438) 폴백 `"(삭제된 진료과)"` 는 **hard delete 가 없는 시스템에서 오해**를 준다(삭제된 적 없음). 정상 경로(매칭 성공)에서는 비도달이고, 도달 시는 절단/RLS 아티팩트뿐이므로 중립적인 `"(미상)"` 으로 교체한다. 더해 매칭된 진료과가 비활성이면 `"(비활성)"` 접미사 — room-form select(129-136행)와 목록 표기를 일관화. 라벨 함수 한 곳만 고치면 RoomTable(518행)이 자동 반영.

### AC6 상세 — 코드 대소문자 무관 unique

`code text unique`(0006·0007)는 `ORTHO`/`ortho`/`Ortho` 를 별개로 허용한다. 단일 진실(Epic 2 주제)에 균열. `lower(code)` 함수 unique 인덱스로 교체 = 유일성은 대소문자 무관, 표시는 원본 케이스 보존(citext 면 컬럼 타입이 바뀌어 전 비교·조인 경로에 영향 → 함수 인덱스가 더 보수적). **insert 핸들러(db.py)의 `UniqueViolationError → code_taken` 매핑은 제약명 비의존**(masters insert 는 broad catch — staff_profile 과 달리 `constraint_name` 검사 안 함)이라 인덱스명이 바뀌어도 무영향. 검증 후 회귀 없음 확인.

### 기존 파일 현재 상태(읽고 보존할 것)

- **db.py:565-623 (insert_room/update_room)** — 단일 DML + FK catch. AC3 는 여기에 사전 `select is_active` 를 끼운다. `_require_master_manage` 동일 트랜잭션 재평가(493-496) 패턴 보존.
- **db.py:545-562, 715-906 (set_*_active)** — 비활성 토글. **건드리지 말 것**(이미 AC1 충족, 회귀 금지). 멱등 가드(동일 상태 재토글 감사 노이즈)는 deferred-work.md:35 의 별도 항목 — 참조 무결성과 직교하고 404 분기 복잡도가 있어 **본 스토리 Non-goal**.
- **masters-manager.tsx:106-155 (applyActive/onToggleActive)** — 비활성=ConfirmDialog, 활성복귀=즉시. AC4 는 `onToggleActive` 의 진료과-비활성 분기에 카운트 조회를 끼운다. 다른 분기·활성복귀 경로 보존.
- **masters.ts:432-438 (departmentLabel)** — AC5 가 이 함수만 수정. 다른 export(codeStatus/isCurrentlyValid/payload 매퍼) 불변.
- **ConfirmDialog(confirm-dialog.tsx)** — `description: string` 받는 정적 다이얼로그. 시그니처 변경 불필요(조립된 문자열만 전달).

### 권한·감사·RLS·규약 (project-context 강제 — 위반 금지)

- **쓰기=FastAPI(service_role)+`master.manage` 게이트 / 읽기 목록=Supabase 직접조회(RLS)**. AC4 의 카운트만 예외적 API 읽기(users RLS 우회 필요).
- **불변식·감사는 DB 소유**: 비활성·배정거부의 감사는 0006·0007 트리거가 자동(actor=`app.actor_id`). 앱이 audit INSERT 직접 금지. 상태머신/수가 로직 재구현 금지(여기 무관).
- **전 경로 snake_case**(JSON 포함) — `is_active`·`effective_from` 등 camelCase 변환 금지.
- **에러 봉투** `{error:{code,message,detail}}` + HTTP(422 검증/403 권한/404/409). `code`=기계용 영문(`inactive_department`), `message`=한국어.
- **마이그레이션 단일 소유**(Supabase CLI). FastAPI DDL 금지. 적용된 0001~0007 편집 금지.
- **신규 식별자**(`inactive_department` 에러코드, `dependents` 라우트 세그먼트)는 자명하나, 도메인 식별자 신설 아님(영문 코드값) → glossary 등재 불요. 단 0008 번호 변이는 glossary §마이그레이션 번호 변이에 기록.
- **mutation 중 버튼 disable**(이중 제출 방지) — 카운트 조회 중에도 적용.

### Non-goals (이번 스토리에서 하지 않음 — 명시 추적)

- 진료실·진단·수가·약품의 의존성 경고(참조 테이블이 Epic 4/5/7 에서야 생김 — 그때 본 패턴 확장).
- 완전 temporal 버전(`(code, effective_from)` 복수 행 공존) — 2.2 가 code-unique+effective-dating 으로 확정, 후속/불요(deferred-work.md:235).
- `set_*_active` 멱등 가드(감사 노이즈) — 참조 무결성과 직교, deferred 유지(deferred-work.md:35).
- 낙관적 동시성(lost update)·per-row pending Set·토글 실패 재조회·fetchMasters 페이지네이션 — 프로젝트 전역 하드닝 묶음(deferred-work.md:38-41), 별도.
- 마스터 시드(seed.sql) = Story 2.5. 급여여부/본인부담·수가 자동발생 = Epic 5/7.
- 재배정 마법사(비활성 진료과의 진료실·직원을 다른 과로 일괄 이동) — 경고까지만(deferred 의 "재배정 유도"는 경고로 충족, 자동 재배정 UI 는 과범위).

### Project Structure Notes

신규/수정 경로는 전부 기존 구조에 정렬(project-context §구조). 신규 디렉터리 0.

- 신규: `supabase/migrations/0008_masters_code_ci_unique.sql`
- 수정(API): `api/app/core/db.py`(insert_room/update_room + count_department_dependents) · `api/app/services/masters.py` · `api/app/api/v1/masters.py` · `api/app/schemas/masters.py`
- 수정(Web): `web/src/lib/admin/masters.ts`(departmentLabel + fetchDepartmentDependents) · `web/src/components/admin/masters-manager.tsx`
- 수정(테스트): `api/tests/test_masters_integration.py` · `api/tests/test_migrations_masters.py` · `web/src/lib/admin/masters.test.ts` · `web/src/components/admin/masters-manager.test.tsx`

변이: 마이그레이션 번호가 아키텍처 계획 맵보다 한 칸씩 밀린 상태가 이어진다(0005 crypto·0007 codes·**0008 ci-unique**) — Epic 3 patients 는 0009 로. 이는 기록된 의도된 변이(glossary §마이그레이션 번호 변이)이며 충돌 아님.

### References

- [Source: epics.md#Story-2.4] — AC1·AC2 원문, "참조 무결성 심화는 Story 2.4" 명시(575-627행)
- [Source: epics.md#Requirements-Inventory] — FR-203(비활성 soft delete·참조 무결성), FR-200(진료과·진료실 마스터)
- [Source: deferred-work.md:27-31] — Story 2.4 로 이월된 4개 항목(API 미차단·의존성 경고·UI 폴백·CI unique)
- [Source: architecture.md:83] — 기둥 8 "마스터 무결성 — soft delete + 유효기간 + 과거 기록 참조 보존"
- [Source: supabase/migrations/0006_masters.sql] — departments/rooms 스키마·FK·RLS·감사(현 code unique·is_active)
- [Source: supabase/migrations/0007_masters_codes.sql] — diagnoses/fee_schedules/drugs 스키마(code unique·effective dating)
- [Source: supabase/migrations/0002_identity_rbac.sql:66 · 0003_rls_helpers.sql] — users RLS=본인 행(직원 카운트는 service_role 필요 근거)
- [Source: api/app/core/db.py:565-623] — insert_room/update_room 현 상태(FK catch only)
- [Source: web/src/lib/admin/masters.ts:432-438] — departmentLabel 폴백 현 상태
- [Source: web/src/components/admin/masters-manager.tsx:106-155, 278-292] — applyActive/onToggleActive/ConfirmDialog 흐름
- [Source: web/src/components/admin/room-form.tsx:58-67, 129-136] — 활성 진료과 필터 + 현 소속 유지 정책(AC3 미러 기준)
- [Source: docs/project-context.md] — 쓰기/읽기 권위 분리·snake_case·에러 봉투·감사 append-only·마이그레이션 단일 소유

### Previous Story Intelligence (2.1 / 2.2 / 2.3)

- **2.1** 이 마스터 패턴 전체(0006·schemas/db/service/router·`/admin/masters`·ConfirmDialog·activeMeta)를 세웠다. soft delete=토글, "DELETE 엔드포인트 만들지 말 것"(2.1 Dev Notes:188). 본 스토리는 그 위에 참조 무결성만 덧댄다.
- **2.2** 가 코드 마스터 3종 + 유효기간 + 시점 배지를 추가(0007). insert 핸들러는 broad UniqueViolation catch(제약명 비의존) — AC6 인덱스 교체가 안전한 이유.
- **2.3** 가 검색 피커 + "현재 유효" 필터를 서버 today 단일 권위로 통일(2.2 이월 해소). 본 스토리는 피커를 건드리지 않음(이미 is_active 필터 완비).
- **공통 테스트 하니스**: 통합 테스트는 로컬 Supabase 스택 미가용 시 skip(`admin@pms.local`/`Staff1234`·`doctor@pms.local`). 생성행 잔존 대비 code 는 매 실행 `_code(prefix)`=uuid 접미. `psql` fixture 로 직접 SQL(RLS 평가·FK 위반 검증). 새 테스트는 이 패턴을 그대로 미러.

### Git Intelligence (최근 작업 맥락)

최근 커밋(de6bcfe…b8428d8)은 Story 2.1→2.2→2.3 을 db→api→web 의미 단위로 분리 커밋 + 각 스토리 done 시 산출물·findings·deferred-work 를 별도 chore 커밋. 본 스토리도 동일 리듬: `feat(db): 0008 코드 CI unique` → `feat(api): 비활성 진료과 배정 차단·의존성 카운트` → `feat(web): 의존성 경고·비활성 소속 표기` → (done 시) `chore(bmad): Story 2.4 산출물`. 커밋·푸시는 승인 시에만(project-context).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- 마이그레이션 적용: `supabase migration up --local`(0008 비파괴 적용 — 시드 계정 보존). 로컬 스택 healthy.
- API 통합 테스트: 실 Supabase 로컬 스택 + 부트스트랩(admin/doctor) 가용 → masters 통합 10건 전부 실행(skip 아님).
- RED→GREEN 확인: 마이그레이션 테스트 2건·AC3 2건·AC4 2건·AC5 lib 2건 모두 적용/구현 전 실패 → 후 통과.

### Completion Notes List

**구현 요약 — 참조 무결성 심화(2.1/2.2/2.3 의 soft delete 위에 4개 갭 충전):**

- **AC3 (API 권위 차단):** `_assert_department_assignable` 헬퍼 추출 → `insert_room`(모든 비활성 배정 차단)·`update_room`(현 소속과 **다를 때만** 검사 — 현 비활성 소속 유지는 허용, room-form 정책 미러). 새 에러 `inactive_department`(422), `invalid_department`(미존재) 유지. FK catch 는 race 백스톱으로 존치.
- **AC4 (의존성 경고):** 신규 `GET /v1/masters/departments/{id}/dependents`(masters 라우터 유일 read) → `{rooms(활성), staff(재직)}`. service_role 이 users RLS(본인행) 우회. web `fetchDepartmentDependents` + `openDepartmentConfirm`(진료과 비활성 시 카운트 선조회 → ConfirmDialog 경고). **차단 아닌 경고**, 조회 실패는 fail-soft 폴백.
- **AC5 (UI 명확성):** `departmentLabel` — 비활성 소속 "(비활성)" 마커 + 미매칭 폴백 "(삭제된 진료과)"→"(미상)". RoomTable 이 라벨 함수만 소비해 자동 반영.
- **AC6 (데이터 품질):** 마이그레이션 0008 — 5개 마스터 `code` UNIQUE 제약 drop → `lower(code)` 함수 unique 인덱스(`ORTHO`/`ortho` 공존 차단, 원본 케이스 표시 보존). `UniqueViolationError→code_taken` 매핑은 제약명 비의존이라 무영향.
- **AC1·AC2·AC7 (회귀 가드):** soft delete·행 보존·비활성 SELECT(RLS)·감사·권한은 기존 자산 그대로 — 기존 테스트 전부 통과로 무회귀 확인.

**검증:** API ruff 클린 + pytest 199 pass/7 skip(masters 통합 10 실행). Web tsc 클린 + eslint 클린 + vitest 122 pass. `database.types.ts` 미존재(후속 도입) → 재생성 N/A.

**범위 준수(Non-goals):** 진료실·코드 마스터 의존성 경고(참조처 Epic 4/5/7), set_*_active 멱등 가드, 낙관적 동시성, seed.sql 미착수.

### Change Log

| 날짜 | 변경 | 작성 |
|---|---|---|
| 2026-06-20 | Story 2.4 구현 — 참조 무결성 심화(AC3 비활성 진료과 배정 차단·AC4 의존성 경고 엔드포인트/UI·AC5 비활성 소속 마커·AC6 코드 CI unique 0008). DB→API→web 전 계층, 테스트 RED→GREEN. Status → review. | Dev (Amelia) |
| 2026-06-20 | 코드 리뷰 — 3레이어 적대적(Blind·Edge·Acceptance). Acceptance Auditor clean pass(AC1~7·규칙·Non-goals 충족). decision-needed 1(직원 카운트=휴직 포함으로 결정·patch)·patch 2(직원 카운트 `<>terminated`·update_room graceful 404) 적용, defer 3, dismiss 8. 회귀 API 199 pass/web 122 pass. Status → done. | Code Review |

### File List

**신규:**
- `supabase/migrations/0008_masters_code_ci_unique.sql` — 마스터 5종 코드 대소문자 무관 unique(AC6)

**수정(API):**
- `api/app/core/db.py` — `_assert_department_assignable`·`insert_room`/`update_room` 비활성 검사(AC3)·`count_department_dependents`(AC4)
- `api/app/schemas/masters.py` — `DepartmentDependents`(AC4)
- `api/app/services/masters.py` — `count_department_dependents`(AC4)
- `api/app/api/v1/masters.py` — `GET /departments/{id}/dependents`(AC4)
- `api/tests/test_masters_integration.py` — AC3·AC4·AC6 통합 테스트
- `api/tests/test_migrations_masters.py` · `api/tests/test_migrations_masters_codes.py` — code CI unique 인덱스 단언(AC6)

**수정(Web):**
- `web/src/lib/admin/masters.ts` — `DepartmentDependents`·`fetchDepartmentDependents`(AC4)·`departmentLabel` 마커/폴백(AC5)
- `web/src/components/admin/masters-manager.tsx` — 진료과 의존성 경고 흐름(AC4)
- `web/src/lib/admin/masters.test.ts` — `departmentLabel` 테스트(AC5)
- `web/src/components/admin/masters-manager.test.tsx` — 의존성 경고·fail-soft 테스트(AC4)

**수정(문서):**
- `docs/glossary.md` — 마이그레이션 번호 변이 0008 항목(patients→0009 cascade)
