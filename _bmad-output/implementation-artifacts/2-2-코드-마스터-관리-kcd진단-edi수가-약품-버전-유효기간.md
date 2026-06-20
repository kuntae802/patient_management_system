---
baseline_commit: b8428d8
---
# Story 2.2: 코드 마스터 관리 — KCD진단 · EDI수가 · 약품 (버전 · 유효기간)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 관리자,
I want 진단(KCD)·수가(EDI 행위)·약품 마스터를 발효일·만료일(유효기간)과 함께 등록·수정·비활성하기를,
so that 시점에 맞는 표준 코드만 임상(진단·처방)·정산(수가)에 사용되고, 과거 기록이 참조하는 만료 코드의 무결성도 보존된다.

## Acceptance Criteria

**AC1 (FR-201, 이월 갭 ①) — 코드 마스터 3종 + 유효기간 등록·수정**
**Given** 관리자 권한(`master.manage`)으로 마스터 화면(`/admin/masters`)에서
**When** 신규 마이그레이션 `0007_masters_codes.sql`의 `diagnoses`·`fee_schedules`·`drugs`를 기반으로 KCD·수가·약품 코드를 등록·수정하면
**Then** 각 코드가 **발효일(`effective_from`)·만료일(`effective_to`)·활성여부(`is_active`)**를 갖고 관리되고, 후속 화면(진단 부착·처방·수가 산정)이 참조할 수 있는 단일 진실이 선다. 권한 없는 사용자는 화면 자체에 접근 불가(`/home` 강등) + 엔드포인트 403.

**AC2 — 유효기간 내 코드만 신규 노출(소비처 필터 계약)**
**Given** 만료된(`effective_to < 오늘`)·발효 전(`effective_from > 오늘`)·비활성(`is_active=false`) 코드가 섞여 있을 때
**When** 신규 입력 화면(2.3 피커·Epic 4·5 소비처)이 "현재 유효 코드"를 조회하면
**Then** `is_active=true AND effective_from <= 오늘 AND (effective_to IS NULL OR effective_to >= 오늘)` 인 코드만 노출된다. **이 스토리는 그 필터 규칙을 확립하고 관리 화면의 상태 배지(발효전/유효/만료/비활성)로 가시화**한다(피커 컴포넌트 자체는 Story 2.3).

**AC3 (FR-203) — 참조 보존(만료·비활성 코드도 무결하게 표시)**
**Given** 과거 기록(향후 내원진단·처방상세·수납상세)이 만료·비활성 코드를 참조할 때
**When** 그 기록을 조회하면
**Then** 코드가 **물리 삭제되지 않고 행·명칭·값이 보존**되어(soft delete = `is_active` + 만료는 행 유지) 만료 코드도 명칭·코드값이 정상 표시된다. 관리 화면은 비활성·만료 행도 표시(편집 목적), 신규 선택만 소비처가 필터.

**AC4 — 변경 감사 + RBAC 게이트 + TOCTOU**
**Given** 코드 마스터의 생성·수정·비활성 변경이 발생하면
**When** 그 변경이 커밋되면
**Then** `0004` 제네릭 감사 트리거가 행위자(=호출 관리자)와 전/후 스냅샷을 `audit_logs`에 자동 기록하고 감사 뷰어(1.10)에서 조회된다. 모든 쓰기는 `require_permission('master.manage')`(403)로 게이트되며, 평가↔쓰기는 동일 트랜잭션에서 재평가(TOCTOU 차단)된다. 코드 마스터엔 PII가 없다(코드·명칭·금액·날짜만).

> **AC 해석(중요·dev agent 필독):** 이 스토리는 **Story 2.1이 깐 마스터 패턴(0006·schemas/db/service/router·`/admin/masters` 화면)을 그대로 확장**해 코드 마스터 3종(diagnoses·fee_schedules·drugs)을 추가하고, **2.1엔 없던 발효/만료 유효기간 컬럼 2개 + 시점 상태 배지**를 더하는 일이다. **재사용 검색 피커는 Story 2.3**(여기선 "현재 유효" 필터 규칙만 확립), **참조 무결성 심화·비활성 의존성 경고는 Story 2.4**, **마스터 시드(seed.sql)는 Story 2.5**(여기선 빈 테이블 + 관리자 UI 직접 입력). 새 라이브러리·새 권한·새 nav 항목 도입 금지(전부 기존 자산 재사용). 스키마 설계 결정은 §Dev Notes "스키마 설계 결정"을 정확히 따른다.

## Tasks / Subtasks

- [x] **Task 1 — DB: `0007_masters_codes.sql` 마이그레이션(diagnoses·fee_schedules·drugs + 유효기간·RLS·감사)** (AC: 1, 2, 3, 4)
  - [x] `supabase/migrations/0007_masters_codes.sql` 신규. **파일명 `0007` 확정**(0001~0006 적용됨; 0006=조직 마스터). patients(아키텍처 계획의 0006_patients)는 `0008`로 한 칸 더 cascade — glossary §마이그레이션 번호 변이 갱신(Task 9).
  - [x] `public.diagnoses` 테이블: `id uuid PK default gen_random_uuid()`, `code text not null`(KCD 코드값, 예 `I10`), `name text not null`(한글 진단명, 예 `본태성 고혈압`), `effective_from date not null`, `effective_to date`(nullable=무기한), `is_active boolean not null default true`, `created_at/updated_at timestamptz not null default now()`. (0006 테이블 패턴 + 유효기간 컬럼 2개.)
  - [x] `public.fee_schedules` 테이블: 위 공통 컬럼 + `amount_krw integer not null`(단가, **KRW 정수**), `category text`(분류, nullable). EDI 행위 수가 마스터.
  - [x] `public.drugs` 테이블: 위 공통 컬럼 + `ingredient_code text`(주성분코드 9자리, nullable), `unit text`(단위 예 `정`/`mL`, nullable). 약품 마스터.
  - [x] **제약(스키마 설계 결정 §Dev Notes 준수):** 세 테이블 모두 `code text not null **unique**`(0006 departments 패턴 미러 — 코드당 1행, code 불변). `check (effective_to is null or effective_to >= effective_from)`(만료가 발효보다 이르지 않음). fee_schedules `check (amount_krw >= 0)`. `create index idx_<table>_effective on <table>(effective_from, effective_to)`(유효기간 조회용, 선택적이나 권장).
  - [x] **GRANT posture(0006 미러):** `revoke all on ... from anon, authenticated;` `grant select, insert, update, delete ... to service_role;` `grant select on ... to authenticated;`(전역 참조 — 피커·관리화면 직접조회). anon 불가.
  - [x] **RLS(0006 미러):** `enable row level security` 세 테이블. `<table>_select_authenticated for select to authenticated using (true)`. 쓰기 정책 없음(=authenticated 쓰기 거부; 쓰기는 service_role/FastAPI가 RLS 우회). **비활성·만료 행도 authenticated SELECT 노출**(관리화면이 봐야 함; 신규 선택 제외는 소비처 피커가 "현재 유효" 필터로 책임 — AC2).
  - [x] **감사 트리거 부착:** `trg_diagnoses_audit`·`trg_fee_schedules_audit`·`trg_drugs_audit` = `after insert or update or delete for each row execute function public.audit_trigger_fn()`(0004 재사용). **세 테이블 모두 `id` 보유 → 1.3 이월 `target_id` 컬럼 계약 충족**.
  - [x] 적용 검증: `supabase db reset`(로컬) 후 테이블·제약·트리거·RLS 생성 확인. + `test_migrations_masters_codes.py` 통과. **회귀 점검**: RLS 테이블 목록 테스트가 존재하면 신규 3테이블 반영.

- [x] **Task 2 — API: 코드 마스터 스키마(Pydantic)** (AC: 1) — `api/app/schemas/masters.py`에 **추가**(신규 파일 아님)
  - [x] 전 필드 snake_case(web Zod의 거울). `_Stripped`(기존, 앞뒤 공백 제거) 재사용. 날짜는 `datetime.date`.
  - [x] `DiagnosisCreate(code: _Stripped[1..20], name: _Stripped[1..200], effective_from: date, effective_to: date|None=None)` · `DiagnosisUpdate(name, effective_from, effective_to)` — **`code` 생성 후 불변**(Update 미포함, 2.1 관례). `DiagnosisResponse(id, code, name, effective_from, effective_to, is_active, created_at, updated_at)`.
  - [x] `FeeScheduleCreate(code, name, amount_krw: int>=0, category: _Stripped|None, effective_from, effective_to)` · `FeeScheduleUpdate(name, amount_krw, category, effective_from, effective_to)` · `FeeScheduleResponse(... amount_krw, category ...)`. `amount_krw`는 `Field(ge=0)`.
  - [x] `DrugCreate(code, name, ingredient_code: _Stripped|None, unit: _Stripped|None, effective_from, effective_to)` · `DrugUpdate(...)` · `DrugResponse(...)`.
  - [x] **`ActiveUpdate`(기존, is_active 토글) 3종 공용 재사용** — 신규 스키마 만들지 말 것.
  - [x] **검증 규칙(서버 권위):** `effective_to`가 있으면 `effective_to >= effective_from`(Pydantic `model_validator` 또는 DB CHECK 위임 — 둘 다 가능, DB가 최종선이므로 Pydantic 검증은 즉시 UX용으로 권장). `code`는 trim·길이만(엄격 정규식 과도명세 금지 — 2.1 관례, KCD/EDI 형식은 시드·운영이 보장).

- [x] **Task 3 — API: db 쓰기 함수(권한 재평가 동일 트랜잭션 + 자동 감사)** (AC: 1, 3, 4) — `api/app/core/db.py`에 **추가**
  - [x] **`insert_department`/`update_department`/`set_department_active` 패턴 그대로 복제**(db.py:499-562). `_require_master_manage(conn)`(기존, db.py:493) 재사용 — 새 헬퍼 만들지 말 것.
  - [x] 컬럼 리터럴 상수 추가: `_DIAGNOSIS_COLUMNS`/`_FEE_SCHEDULE_COLUMNS`/`_DRUG_COLUMNS`(고정 리터럴, 값만 `$n` 바인딩 — db.py:489-490 미러).
  - [x] `insert_diagnosis(sub, *, code, name, effective_from, effective_to) -> Record` — INSERT returning. `asyncpg.UniqueViolationError` → `ConflictError(code="code_taken", "이미 사용 중인 진단 코드입니다.")`(409).
  - [x] `update_diagnosis(sub, diagnosis_id, *, name, effective_from, effective_to) -> Record` — `update ... set name=$, effective_from=$, effective_to=$, updated_at=now() where id=$ returning ...`. 0행 → `NotFoundError`(404). **`updated_at=now()` 명시**(트리거 없음 — db.py 관례).
  - [x] `set_diagnosis_active(sub, diagnosis_id, *, is_active) -> Record` — 0006 `set_department_active` 그대로.
  - [x] `insert_fee_schedule/update_fee_schedule/set_fee_schedule_active` · `insert_drug/update_drug/set_drug_active` 동일 패턴(각 추가 컬럼 바인딩).
  - [x] (감사 INSERT 직접 호출 금지 — 트리거가 자동 기록, actor=`app.actor_id`. 0007 CHECK 위반 시 `asyncpg`가 던지는 예외 → 일반 503/422 매핑은 `_run_authed`·기존 핸들러가 처리; effective 날짜 역전은 Pydantic이 먼저 막으므로 정상경로 비도달.)

- [x] **Task 4 — API: 서비스 오케스트레이션** (AC: 1, 3, 4) — `api/app/services/masters.py`에 **추가**
  - [x] `_to_diagnosis`/`_to_fee_schedule`/`_to_drug` = `Model.model_validate(dict(row))`(services/masters.py:25-30 미러). 함수: `create_diagnosis/update_diagnosis/set_diagnosis_active` + fee_schedule 3종 + drug 3종(총 9). db.* 호출 → 응답 매핑만(단일 DML, 보상 없음).

- [x] **Task 5 — API: 라우터 엔드포인트 + 등록** (AC: 1, 4) — `api/app/api/v1/masters.py`에 **추가**
  - [x] 기존 `router`(prefix `/masters`)·`require_master_manage`(이미 정의) 재사용. **신규 라우터·신규 권한 만들지 말 것.**
  - [x] 엔드포인트(2.1 departments 미러): `POST /masters/diagnoses`(201) · `PATCH /masters/diagnoses/{diagnosis_id}` · `PATCH /masters/diagnoses/{diagnosis_id}/active` · fee_schedules 3종(`/masters/fee-schedules`, path는 kebab; 자원명 snake `fee_schedules`도 허용하나 **URL은 `fee-schedules` 하이픈 권장**, 일관 선택) · drugs 3종(`/masters/drugs`). 전부 `Depends(require_master_manage)`.
  - [x] **GET(목록) 없음 — 읽기는 web이 Supabase 직접조회**(§Dev Notes 읽기 경로). `router.py`는 이미 `masters` include 완료(추가 작업 없음).

- [x] **Task 6 — web: 타입·메타·검증·직접조회 헬퍼** (AC: 1, 2, 3) — `web/src/lib/admin/masters.ts`에 **추가**
  - [x] `Diagnosis`/`FeeSchedule`/`Drug` 타입(FastAPI 응답 거울 snake_case, 날짜=string). `MastersData`를 **확장**: `{ departments, rooms, diagnoses, feeSchedules, drugs }`(키는 camelCase 변수명이나 행 필드는 snake_case 유지).
  - [x] `fetchMasters(supabase)`를 **확장** — 기존 departments·rooms 2병렬에 diagnoses·fee_schedules·drugs 3개 `from().select(...).order("code")` 추가(`Promise.all` 5개). active/만료 포함 전부(관리화면용). fail-loud 유지(에러 throw).
  - [x] **`codeStatusMeta(row)` 헬퍼 신규** — 시점 상태 4종 계산(색+글리프+라벨 3중, 음영 비의존 UX-DR20):
    - `is_active=false` → "비활성"(status-cancelled 톤)
    - else `today < effective_from` → "발효 전"(muted/info 톤)
    - else `effective_to && today > effective_to` → "만료"(amber/warn 톤 — 기존 status 토큰에서 선택)
    - else → "유효"(status-done 톤)
    - 날짜 비교는 **로컬 자정 기준 date 문자열 비교**(KST, `YYYY-MM-DD` 문자열 비교로 충분 — timestamptz 아님). 기존 `activeMeta`(진료과·진료실용)는 그대로 유지.
  - [x] zod: `diagnosisCreateSchema`/`feeScheduleCreateSchema`/`drugCreateSchema`(Pydantic 거울) + create/update payload 매퍼(2.1 `toDepartmentCreate/UpdatePayload` 패턴 — update는 옵셔널·날짜 항상 전송해 부분수정 NULL화 누락 방지). `effective_from`은 필수(폼 기본=오늘), `effective_to`는 `""` 허용 → 제출 시 `null`. `amount_krw`는 숫자 문자열 → number 변환.
  - [x] **현재 유효 필터 헬퍼 신규**(AC2 계약, 2.3·Epic4·5가 소비): `isCurrentlyValid(row, today)` = `row.is_active && row.effective_from <= today && (!row.effective_to || row.effective_to >= today)`. export(소비처 재사용). **이 스토리에선 관리화면이 직접 쓰진 않지만(관리화면은 전부 표시) 규칙을 코드로 확립**해 2.3이 import.

- [x] **Task 7 — web: 마스터 관리 화면 탭 확장** (AC: 1, 2, 3, 4) — `web/src/components/admin/masters-manager.tsx` **확장**
  - [x] `Tab` 유니온에 `"diagnoses" | "feeSchedules" | "drugs"` 추가(기존 departments·rooms 유지). 탭 버튼 3개 추가(아이콘 `lucide-react`: 예 `Stethoscope`(진단)·`Receipt`/`Coins`(수가)·`Pill`(약품); 이미 import한 것 외 신규 아이콘만 추가). `Count` 배지·"추가" 버튼 라벨 분기.
  - [x] 각 코드 마스터 테이블 컴포넌트(`DiagnosisTable`/`FeeScheduleTable`/`DrugTable`) — `DepartmentTable` 골격 복제(`<table>`+`<th scope>`·`tabular-nums`·hover). 컬럼:
    - 진단: 코드 · 이름 · 발효일 · 만료일 · 상태 · 관리
    - 수가: 코드 · 이름 · 금액(KRW, `tabular-nums`·천단위 `Intl.NumberFormat('ko-KR')`) · 분류 · 발효일 · 만료일 · 상태 · 관리
    - 약품: 코드 · 이름 · 주성분코드 · 단위 · 발효일 · 만료일 · 상태 · 관리
    - 만료일 null → "—". 상태 = `codeStatusMeta` 4종 배지.
  - [x] 쓰기: `applyActive`를 코드 마스터로 일반화 또는 분기 — `apiFetch("/v1/masters/<kind>/{id}/active", PATCH)` → 로컬 상태 머지. **mutation 중 버튼 disable**(`pendingId` 재사용). 비활성 전환 → 기존 `ConfirmDialog`("비활성 시 신규 선택에서 제외되며, 과거 기록 참조는 유지됩니다"). 활성 복귀 즉시.
  - [x] **초기 데이터는 RSC `initial`(확장된 MastersData) 주입** → 마운트 fetch 없음(2.1과 동일, `set-state-in-effect` 마찰 없음). 상태 화면 헤더 카피에 "진단·수가·약품" 추가.

- [x] **Task 8 — web: 생성·수정 폼(모달) 3종** (AC: 1) — `web/src/components/admin/`에 신규
  - [x] `diagnosis-form.tsx`·`fee-schedule-form.tsx`·`drug-form.tsx` — `department-form.tsx` **그대로 복제**(base-ui `Dialog` 네임스페이스 import · RHF + zodResolver · `values`로 create/edit 겸용 · `Field` 헬퍼 · 제출 중 disable · `code_taken` → 코드 필드 인라인). code는 생성 시만(수정 시 disabled).
  - [x] **날짜 입력 = 네이티브 `<input type="date">`**(새 의존성 금지 — date picker 라이브러리 도입 X). 발효일 필수(기본값=오늘, `new Date().toISOString().slice(0,10)`), 만료일 선택(빈값 허용). `FIELD` 클래스 재사용.
  - [x] 수가 폼: 금액 `<input type="number" min="0" step="1">`(KRW 정수, 소수 금지). 분류는 선택 텍스트. 약품 폼: 주성분코드·단위 선택 텍스트.
  - [x] 🚫 코드 마스터에 PII 없음 — 마스킹 불필요. 라우트·식별은 불투명 `id`(UUID).

- [x] **Task 9 — docs: 글로서리 컬럼 등재 + 마이그레이션 번호 cascade** (AC: 1)
  - [x] `docs/glossary.md` §명명 규칙 또는 도메인 엔티티 표에 신규 **컬럼 식별자** 등재: `effective_from`(발효일) · `effective_to`(만료일) · `amount_krw`(단가/금액, KRW 정수) · `ingredient_code`(주성분코드) · `unit`(단위) · `category`(분류). (테이블 식별자 `diagnosis`/`fee_schedule`/`drug`는 이미 등재 — 추가 불요.)
  - [x] §마이그레이션 번호 변이 노트 갱신: `0007=masters_codes(diagnoses·fee_schedules·drugs, Story 2.2)`, `patients`는 `0008`로 cascade(0006_masters→0007_patients 계획에서 한 칸 더 시프트). Epic 3 스토리 생성 시 patients=0008 반영.

- [x] **Task 10 — 테스트** (AC: 1, 2, 3, 4)
  - [x] DB 마이그레이션 `api/tests/test_migrations_masters_codes.py`(신규): 3테이블 존재·`code unique`·유효기간 컬럼(`effective_from` NOT NULL·`effective_to` nullable)·`is_active`·fee `amount_krw`·CHECK(effective 날짜·amount>=0)·authenticated SELECT-only GRANT·RLS SELECT 정책·감사 트리거 3개 부착. (`test_migrations_masters.py` 미러.)
  - [x] API 단위 `api/tests/test_masters_codes.py`(신규, DB 불요): 생성 201 · 403 게이트(doctor) · code/공백/길이 422 · `amount_krw` 음수 422 · `effective_to < effective_from` 422(Pydantic 검증 시) · 수정 404 · 중복 409 · 비활성 플래그 전달. (`test_masters.py` 미러, db 함수 스텁.)
  - [x] API 통합 `api/tests/test_masters_codes_integration.py`(신규): admin 진단·수가·약품 생성 201+행 · 동일 code 409 · 수정 반영 · **비활성 후 행·명칭 보존**(AC3)·재활성 · **만료(effective_to 과거) 후 authenticated SELECT가 만료 행도 반환**(AC3 참조 보존·RLS) · **변경이 audit_logs에 actor=admin 기록**(AC4) · doctor 쓰기 403. (`test_masters_integration.py` 미러.)
  - [x] web 단위 `web/src/components/admin/masters-manager.test.tsx`에 **추가** 또는 신규 테스트: 진단/수가/약품 탭 렌더(상태 배지 4종 — 발효전/유효/만료/비활성 계산)·생성 POST·비활성 ConfirmDialog→PATCH·금액 천단위 포맷·만료일 null="—". `codeStatusMeta`·`isCurrentlyValid` 순수함수 단위 테스트(경계: today==effective_from, today==effective_to).

## Review Findings (Code Review 2026-06-20)

> 3레이어 적대적 리뷰(Blind Hunter·Edge Case Hunter·Acceptance Auditor). **Acceptance Auditor: AC1~4 전부 충족, MUST 규칙·Non-goals 전부 준수 — 차단성 위반 없음.** decision-needed 0건. patch 2·defer 3·dismiss 5.

**Patch (수정 대상):**

- [x] [Review][Patch] `amount_krw` 상한 미검증 → PG `integer`(최대 2,147,483,647) 오버플로가 사용자 입력 오류를 503(ServiceUnavailable)으로 오인 [api/app/schemas/masters.py · web/src/lib/admin/masters.ts] — **수정 적용:** Pydantic `Field(ge=0, le=_AMOUNT_MAX)` + zod `.refine(Number(s) <= 2_147_483_647)` 로 422 차단(2^53 초과 `Number()` 정밀도 손실도 함께 해소) + API 단위 테스트 `test_fee_amount_overflow_validation` 추가. (edge#1 High + edge#2 Med 병합.)
- [x] [Review][Patch] 매니저 컴포넌트 테스트에 "비활성"(inactive) 배지 렌더 케이스 누락 [web/src/components/admin/masters-manager.test.tsx] — **수정 적용:** 배지 렌더 테스트에 `DX_INACTIVE` 행 추가, "비활성" 배지 단언(4종 전부 커버). (auditor G2 Low.)

**Defer (이월 — deferred-work.md 기록):**

- [x] [Review][Defer] `codeStatus`/`isCurrentlyValid`의 today=브라우저 로컬 시간 [web/src/lib/admin/masters.ts] — 관리화면 배지는 클라 today, 향후 2.3 피커가 DB `current_date`(UTC)로 필터하면 배지↔피커 경계(자정·비-KST) 불일치 가능. Story 2.3에서 "현재 유효"를 DB 권위(서버 today 주입 또는 RPC)로 통일 (edge#3 Med)
- [x] [Review][Defer] `fetchMasters` 단일 실패점 2→5 테이블로 확대 [web/src/lib/admin/masters.ts] — 한 테이블 오류가 전체 관리화면을 RSC 에러로 다운(의도된 fail-loud 패턴이나 영향 범위 확대). 대량화·부분 강등 필요 시 per-table 처리 검토 (edge#7 Low, 2.1 패턴과 동일)
- [x] [Review][Defer] 단일 `pendingId` 다중행 동시 토글 [web/src/components/admin/masters-manager.tsx] — 활성 복귀(즉시 실행) 연속 클릭 시 한 행 pending UI 소실. 2.1 deferred-work에 이미 기록된 프로젝트 전역 패턴(per-row pending Set 일괄 개선) (edge#8 Low)

**Dismissed (5건):** ① edge#4 "발효 전+만료 동시 → 발효 전 표시" — 미발효 코드에 "발효 전" 라벨은 정확(결함 아님). ② edge#5 `effective_from==effective_to` 당일 허용 — 3계층 검증 일관(`>=`/`<`)·의도된 동작. ③ edge#6 PATCH로 effective_from 미래 변경 — 관리자 마스터 유효기간 수정은 의도된 기능, 과거 참조는 FK·명칭 보존. ④ blind#1 수정 폼이 create 스키마로 검증(code 버림) — `values`로 code 채워져 정상, 2.1 폼 패턴과 동일. ⑤ blind#2 category 빈문자열↔None 비대칭 — 매퍼가 정규화(일관 동작), 2.1 패턴과 동일.

## Dev Notes

> **이 스토리의 핵심:** Story 2.1이 마스터 인프라(0006 조직 마스터 + schemas/db/service/router 3계층 + `/admin/masters` 탭 화면 + 읽기 Supabase직접/쓰기 FastAPI 분담)를 완성했다. 2.2는 **그 패턴을 코드 마스터 3종(diagnoses·fee_schedules·drugs)으로 복제·확장**하고, **2.1엔 없던 유효기간(발효/만료) 컬럼 2개 + 시점 상태 배지**를 더해 **이월 갭 ①(FR-201 vs 스키마 — CONFLICT-2)을 해소**한다. 사실상 "departments/rooms 패턴 × 3 + 날짜 필드 + 4상태 배지"다. 새 권한·새 nav·새 라이브러리 0건.

### 🧭 읽기 경로 — Supabase 직접조회(2.1과 동일, 1.10 감사뷰어와 반대)

코드 마스터 **목록 읽기 = web의 Supabase 직접조회**(authenticated SELECT, RLS `using(true)`). **쓰기만 FastAPI**(`master.manage`). 근거: 마스터는 **전역 참조 데이터**(모든 직원이 피커/조회로 읽음) → `users`처럼 본인행 RLS 마찰이 없다(epic-1-retro:36,50,69). RSC가 `createClient()`로 직접조회해 `initial` 주입(`set-state-in-effect` 린트 예외 불필요). 쓰기는 authenticated가 SELECT만 가지므로 반드시 FastAPI(service_role + `master.manage` 게이트 + 동일트랜잭션 재평가). RLS는 방어심층 2차선.
[Source: web/src/app/(staff)/admin/masters/page.tsx, web/src/lib/admin/masters.ts:53, epic-1-retro:50]

### 🗂️ 스키마 설계 결정 (0007_masters_codes.sql — 정확히 이 형태)

[Source: architecture.md:314(0005_masters 계획 — `diagnoses(KCD)·fee_schedules(+effective/expiry)·drugs`), prds/.../reconcile-schema.md:46-49(CONFLICT-2/갭①), prds/.../research-domain.md:18-20,46, 0006_masters.sql 패턴]

| 테이블 | 컬럼 | 비고 |
|---|---|---|
| `diagnoses` | `id`·`code`(unique)·`name`·`effective_from`(NOT NULL)·`effective_to`(null)·`is_active`·`created_at`/`updated_at` | KCD 진단. code=KCD 코드값(영문1+숫자, 예 `I10`), name=한글 진단명 |
| `fee_schedules` | 위 + `amount_krw`(integer NOT NULL, KRW 정수)·`category`(null) | EDI 행위 수가. amount=단가, category=분류(선택) |
| `drugs` | 위 + `ingredient_code`(null)·`unit`(null) | 약품. ingredient_code=주성분코드 9자리(대체조제, 선택), unit=단위(선택) |

**🔑 버전·유효기간 모델 결정(반드시 이대로):**

- **`code` UNIQUE = 코드당 1행**(0006 departments 미러). **"버전"은 별도 version 정수 컬럼이 아니라 `effective_from`/`effective_to` 유효기간 + `audit_logs` 변경이력으로 표현**한다. 근거:
  1. **AC 전부 충족** — AC1(각 코드가 발효/만료/활성을 가짐 ✓), AC2(소비처가 "현재 유효" 필터 ✓), AC3(만료·비활성 행 보존·참조 무결 ✓). 어느 AC도 "한 코드의 복수 버전 행 공존"을 요구하지 않는다.
  2. **변경이력 = audit_logs가 이미 소유** — 0004 트리거가 모든 수정의 전/후 스냅샷을 append-only로 기록(코드명·단가 변경 = 시점 이력). "버전 관리"의 backward 추적은 감사로그가, forward 유효성은 effective-dating이 담당.
  3. **2.1 패턴 최대 재사용·다운스트림 단순** — code 불변·`code_taken` 409·update 시맨틱이 0006과 동일. 소비처(2.3 피커·Epic4·5)는 "코드당 유효 행 1개"라 모호성 없음.
- **대안(채택 안 함):** `unique(code, effective_from)`로 같은 코드의 복수 시점 버전 행을 공존시키는 완전 temporal 모델(KCD 8차→9차 동시 보유 등). 더 "사전적 버전"이나 소비처 선택 로직·중첩기간 무결성이 복잡해져 **스코프·패턴 일관성 우선으로 보류**(필요 시 후속 마이그레이션으로 승격 — deferred 후보). **사용자 확인 완료(2026-06-20): code-unique + 유효기간 모델 채택. fee_schedules는 단가+분류까지(급여여부=`is_benefit`는 Epic 7 수납으로 이월).**
- **PK/네이밍:** `id` uuid `gen_random_uuid()`, snake_case, soft delete=`is_active`. `updated_at`=UPDATE 시 명시 `now()`(자동 트리거 금지 — db.py 관례). [Source: glossary.md:9, db.py:532]
- **날짜 타입 = `date`(timestamptz 아님)** — 유효기간은 일 단위. JSON/응답은 `YYYY-MM-DD` 문자열. (created_at/updated_at만 timestamptz.)
- **"현재 유효" 규칙(AC2 단일 정의, 코드·SQL 공통):** `is_active = true AND effective_from <= 오늘 AND (effective_to IS NULL OR effective_to >= 오늘)`. 경계 포함(`<=`/`>=`). 소비처가 이 술어로 필터.

### 🔐 쓰기 권위 패턴 (2.1 그대로 복제 — 재발명 금지)

[Source: api/app/core/db.py:493-562 `_require_master_manage`·`insert_department`·`update_department`·`set_department_active`]

```
async def insert_diagnosis(sub, *, code, name, effective_from, effective_to):
    async def _op(conn):
        await _require_master_manage(conn)        # 동일 트랜잭션 재평가(TOCTOU 차단)
        try:
            row = await conn.fetchrow(
                f"insert into public.diagnoses (code, name, effective_from, effective_to) "
                f"values ($1,$2,$3,$4) returning {_DIAGNOSIS_COLUMNS}",
                code, name, effective_from, effective_to)
        except asyncpg.UniqueViolationError as exc:
            raise ConflictError("이미 사용 중인 진단 코드입니다.", code="code_taken", detail={"code": code}) from exc
        assert row is not None
        return row
    return await _run_authed(sub, _op)
```

- **actor 캡처:** `_run_authed` → `authenticated_conn(sub)`가 `app.actor_id` 주입 → 감사 트리거가 actor 기록. 앱은 감사 INSERT 직접 안 함(트리거 소유).
- **에러 매핑(errors.py 재사용):** 권한 403(`ForbiddenError`) · 중복 409(`ConflictError code_taken`) · 미존재 404(`NotFoundError`) · DB 일시장애 503(`_run_authed`). 검증(날짜 역전·amount 음수)은 Pydantic 422가 1차, DB CHECK가 최종선.

### 🧱 구현 패턴 (그대로 복제)

**API (3계층, 전부 2.1 미러):**
- 라우터: 기존 `router`(prefix `/masters`)·`require_master_manage`(`require_permission("master.manage")`) 재사용, 엔드포인트 `Depends`. 상태 전이(비활성)=액션 하위리소스 `PATCH .../{id}/active`. [Source: api/app/api/v1/masters.py:28-31,58-67]
- service: `Model.model_validate(dict(row))` 매핑. [Source: services/masters.py:25-37]
- 스키마: 전 필드 snake_case, `_Stripped` trim, `code` Update 미포함(불변). [Source: schemas/masters.py:16-43]
- db: `_require_master_manage` + `_run_authed` + 컬럼 리터럴 상수 + UniqueViolation→409. [Source: db.py:489-562]

**web (얇은 RSC 셸 + 클라 컴포넌트):**
- RSC 페이지: 기존 `page.tsx`가 `requirePermission("master.manage", STAFF_HOME)` → `fetchMasters` → `MastersManager initial=...`. **확장된 MastersData를 주입**(page.tsx 거의 무변경 — fetchMasters 반환이 커질 뿐). [Source: web/src/app/(staff)/admin/masters/page.tsx]
- 직접조회: `supabase.from("diagnoses"/"fee_schedules"/"drugs").select("...").order("code")`(fetchMasters 확장). [Source: lib/admin/masters.ts:53-72]
- 매니저: `MastersManager`에 탭 3개 + 테이블 3개 추가(`DepartmentTable` 골격 복제). `upsert`/`sortByCode`/`applyActive`/`ConfirmDialog`/`pendingId` 재사용. [Source: components/admin/masters-manager.tsx]
- 폼: `department-form.tsx` 복제 + 네이티브 `<input type="date">` 2개 + (수가) number 금액. [Source: components/admin/department-form.tsx]
- 배지 메타: `activeMeta`(2.1)는 진료과·진료실 유지, 코드 마스터는 **신규 `codeStatusMeta`**(4상태). 색+글리프+라벨 3중(음영 비의존 UX-DR20). [Source: lib/admin/masters.ts:33-46]
- API 클라이언트: `apiFetch<T>("/v1/masters/...")`. [Source: lib/api/client.ts]

### 🚫 절대 어기면 안 되는 규칙 (보안·회귀·일관성)

1. **마이그레이션 번호 = `0007_masters_codes.sql`** — 0001~0006 적용됨. **이미 적용된 마이그레이션(0006 등) 절대 수정 금지** — 코드 마스터는 반드시 신규 0007 파일. patients는 0008로 cascade(glossary 갱신). [Source: supabase/migrations/ 목록, glossary.md:174]
2. **읽기=Supabase 직접 / 쓰기=FastAPI(master.manage)** — 2.1 분담 그대로. users(1.8) 전-FastAPI 패턴 복제 금지. [Source: epic-1-retro:36,50]
3. **권한·nav·라우터 재사용** — `master.manage`·`/admin/masters`·`/masters` 라우터 모두 존재. **새 권한·새 nav·새 라우터 추가 금지**. [Source: api/app/api/v1/masters.py:28-31, web staff-nav.ts]
4. **감사 트리거 부착 필수** — `trg_diagnoses_audit`·`trg_fee_schedules_audit`·`trg_drugs_audit`(audit_trigger_fn 재사용, id 계약 충족). 누락 시 AC4 위반. [Source: 0004:audit_trigger_fn, 0006:66-72]
5. **soft delete만 — 물리 삭제 금지** — `is_active` 토글이 유일한 "삭제". 만료(effective_to)도 행 유지. **DELETE 엔드포인트/DML 금지**(참조 보존 = FR-203·AC3). [Source: 0006:14, architecture.md:83]
6. **TOCTOU** — 권한평가+쓰기 동일 트랜잭션(`_require_master_manage` → DML). [Source: db.py:493-496]
7. **JSON snake_case 전 경로** — `effective_from`/`amount_krw` 등 camelCase 변환 금지(MastersData의 *키*는 camelCase 변수명 OK, 행 *필드*는 snake_case). [Source: project-context.md]
8. **금액 = KRW 정수** — `amount_krw` 소수 없음, `<input type="number" step="1">`, Pydantic `int Field(ge=0)`, DB `integer`. 표시는 `Intl.NumberFormat('ko-KR')` 천단위. [Source: project-context.md, architecture.md:270]
9. **에러 봉투 통일** — `{error:{code,message,detail}}` + HTTP(409/403/404/422/503), `code`=영문·`message`=한국어, `detail`에 민감정보 없음(마스터엔 PII 자체가 없음). [Source: errors.py]
10. **신규 의존성 금지** — TanStack Query·zustand·date-picker 라이브러리·shadcn data-table 전부 미설치 유지. 단순 로컬 상태 + 네이티브 컨트롤(`<input type="date">`·`<input type="number">`) + `apiFetch` + Supabase 직접조회. [Source: epic-1-retro:31]
11. **영문 식별자** — `diagnosis`/`fee_schedule`/`drug` glossary 등재됨. 신규 컬럼(`effective_from` 등)은 Task 9에서 등재 후 사용. 한국어는 표시명(name)·주석만. [Source: glossary.md:26-28]
12. **base-ui 네임스페이스 import** — `import { Dialog } from "@base-ui/react/dialog"`. [Source: department-form.tsx:4]

### 🆕 최신 기술 주의 (Next.js 16)

- **⚠️ `web/AGENTS.md` 강제 규칙:** "This is NOT the Next.js you know — 코드 작성 전 `node_modules/next/dist/docs/`의 관련 가이드를 읽어라." App Router·route group `(staff)`·RSC 가드·`createClient()` 패턴은 1.6~2.1에서 확립됐으니 그 파일들을 1차 레퍼런스로 삼는다.
- **생성 TS 타입 미사용(현재):** `web/src/types/database.types.ts` 미생성. Supabase 클라이언트 untyped → `fetchMasters`는 수동 미러 타입 캐스트(2.1 동일). `supabase gen types` 강제 금지(스코프 확장).
- **날짜 입력:** 네이티브 `<input type="date">`는 `YYYY-MM-DD` 문자열 값 → Pydantic `date`·Supabase `date` 컬럼과 직결(변환 불요). 빈값="" → 제출 시 `effective_to: null`.

### 📐 라우트·구조

- API **수정(추가)**: `api/app/schemas/masters.py` · `api/app/services/masters.py` · `api/app/api/v1/masters.py` · `api/app/core/db.py`. (router.py 무변경 — 이미 include.)
- web **수정(추가)**: `web/src/lib/admin/masters.ts` · `web/src/components/admin/masters-manager.tsx`. **신규**: `web/src/components/admin/{diagnosis,fee-schedule,drug}-form.tsx`.
- DB **신규**: `supabase/migrations/0007_masters_codes.sql`.
- docs **수정**: `docs/glossary.md`.
- 테스트 **신규**: `api/tests/test_migrations_masters_codes.py` · `test_masters_codes.py` · `test_masters_codes_integration.py`. **수정/추가**: `web/.../masters-manager.test.tsx`.
- 구조는 `api/app/{core,api/v1,schemas,services}` · `web/src/{app/(staff),components/admin,lib/admin}` 컨벤션. [Source: project-context.md, architecture.md:330-368]

### 🚧 Non-goals (이 스토리에서 하지 말 것 — 명시적 다운스트림)

- **재사용 검색 피커(KCD/약품/수가)** = **Story 2.3**(Epic 4·5 소비). 2.2는 관리 화면 + "현재 유효" 필터 규칙(`isCurrentlyValid`) 확립까지. 피커 컴포넌트(검색·키보드·aria-live·free-text 차단)는 만들지 말 것.
- **참조 무결성 심화·비활성 의존성 경고·완전 temporal 버전(`code,effective_from`)** = **Story 2.4** 또는 후속. 2.2는 기본 `is_active` 토글 + 만료일 + 행 보존까지.
- **마스터 시드(seed.sql에 KCD/EDI/약품 코드)** = **Story 2.5**. 2.2는 빈 테이블 + 관리자 UI 직접 입력. **seed.sql에 코드 마스터 시드 추가 금지**(seed.sql은 이미 존재 — 신원/개발용; 손대지 말 것).
- **급여여부·산정특례·가산·본인부담률** = **Epic 7 수납**. fee_schedules는 `amount_krw`(단가)·`category`까지. 급여/비급여 판정·본인부담 산정 로직은 만들지 말 것(reconcile-schema·review-adversarial DEC-1/R-1: 수가 매핑·청구 단순화 선은 Epic 7 착수 전 확정 — 다운스트림).
- **수가 자동발생 트리거(fee_mappings)** = **Epic 5.10/Epic 7**. 2.2는 수가 *마스터*만, 임상 행위→수가 매핑·트리거는 범위 밖.

### Previous Story Intelligence (2.1 · Epic 1 retro)

- **2.1(조직 마스터):** 0006 마이그레이션 + schemas/db/service/router 3계층(쓰기 전용) + `/admin/masters` 탭 화면 + 읽기 Supabase직접/쓰기 FastAPI 분담 + soft delete 토글 + 자동 감사 — **2.2가 그대로 복제·확장하는 청사진**. 코드 리뷰 clean pass(AC1~4 충족). [Source: 2-1 스토리 전문]
- **2.1 코드리뷰 defer(2.2에도 적용·동일 수용):** 마스터 PATCH=전체 교체(web이 전체 필드 전송 → 무영향), 단일 `pendingId`(다중행 동시토글 한계), `set_*_active` 멱등 미보장, 낙관적 동시성 부재, fetchMasters limit 부재 — **전부 프로젝트 전역 패턴/후속 하드닝**. 2.2도 동일 패턴 따르고 새로 고치지 말 것(일괄 하드닝 대상). [Source: deferred-work.md:9-24]
- **2.1 defer 중 2.2 직접 관련:** `code` 대소문자 구분 unique(`I10`/`i10` 공존) — 스펙이 엄격 정규식 강제 안 함, 의도된 유연성. 정규화는 Story 2.4. [Source: deferred-work.md:13]
- **Epic 1 retro 액션(Epic 2):** ② 마스터 테이블 감사 트리거 부착(id 계약) ④ 마스터 읽기 Supabase 직접조회 — 2.1이 이행, 2.2도 동일 적용. [Source: epic-1-retro:46-50]

### Git Intelligence

최근 커밋(b8428d8=2.1 산출물+done / f103ece=2.1 web / f2dcf7c=2.1 api / 5bb789e=2.1 db): **의미 단위 단계별 커밋, 코드/산출물 분리**. 2.2도 `feat(db)`(0007 마이그레이션) → `feat(api)`(스키마·db·service·router) → `feat(web)`(탭·폼) → `docs`(glossary) 순 권장. 마이그레이션 순번 0001~0006 연속. **커밋·푸시는 승인 시에만**(project-context). [Source: git log, project-context.md]

### 도메인 참고 (research-domain.md — 현실성 근거, 과도구현 금지)

- **KCD(진단):** 영문1+숫자, 다단계(대/중/소/세분류), 3~5년 주기 개정(8차 2021→9차 2026). 심평원 상병마스터. → 본 스토리는 평면 code+name+유효기간으로 단순화(계층·세분류 미구현). [Source: research-domain.md:18]
- **EDI 수가(행위):** 심평원 행위급여목록. 필드 {수가코드, 명칭, 분류번호, 급여여부, 단가}. → 본 스토리는 code+name+amount_krw+category. **급여여부는 Epic 7로 이월**(Non-goals). [Source: research-domain.md:19]
- **약품(이원):** 주성분코드 9자리(대체조제) + 의약품 표준코드 KD 13자리(약가마스터). → 본 스토리는 code(=표준/보험코드)+name+ingredient_code(주성분9, 선택)+unit. ATC·약가 정책 미구현. [Source: research-domain.md:20]
- **갭① 출처:** reconcile-schema.md CONFLICT-2 — 원 PRD 스키마(약품·수가·진단)엔 `사용여부`(soft delete)만 있고 발효/만료/버전 컬럼 부재 → FR-201이 스키마를 앞섬 → **본 스토리가 발효/만료 컬럼을 추가해 해소**. [Source: reconcile-schema.md:46-49, architecture.md:70,431]

### References

- [Source: _bmad-output/planning-artifacts/epics.md:575-593] — Story 2.2 정의·AC, FR-201, 이월 갭 ①
- [Source: _bmad-output/planning-artifacts/epics.md:101-105,263-266] — FR-200~203 인벤토리·커버리지
- [Source: _bmad-output/planning-artifacts/epics.md:551-555] — Epic 2 개요·범위 노트(피커 재사용·수가 매핑 다운스트림)
- [Source: _bmad-output/planning-artifacts/architecture.md:70,314,431] — 갭①(마스터 유효기간 컬럼)·0005_masters 계획(diagnoses/fee_schedules+effective/drugs)·CONFLICT-2
- [Source: _bmad-output/planning-artifacts/architecture.md:83,247,253,270,330-368] — soft delete·is_active·액션 엔드포인트·KRW 정수·디렉토리 구조
- [Source: _bmad-output/planning-artifacts/prds/.../reconcile-schema.md:46-49,65] — CONFLICT-2 FR-201 유효기간 스키마 보강
- [Source: _bmad-output/planning-artifacts/prds/.../research-domain.md:18-20,46] — KCD/EDI/약품 도메인 코드 구조
- [Source: _bmad-output/planning-artifacts/prds/.../review-adversarial-general.md:54-56,132-137] — DEC-1/R-1 수가 매핑·급여판정 다운스트림(Epic 7 경계)
- [Source: _bmad-output/implementation-artifacts/2-1-진료과-진료실-마스터-관리.md] — 복제 청사진(전 섹션)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:9-24] — 2.1 defer(전역 패턴·후속 하드닝)
- [Source: _bmad-output/implementation-artifacts/epic-1-retro-2026-06-20.md:46-50,63-69] — Epic 2 착수 액션·미리보기
- [Source: docs/glossary.md:9,26-28,174] — 명명 규칙·diagnosis/fee_schedule/drug 등재·마이그레이션 번호 변이
- [Source: docs/project-context.md] — 전역 규칙(snake_case·RLS·무ORM·신규 의존성 금지·검증 3중·KRW 정수)
- [Source: supabase/migrations/0006_masters.sql] — 테이블·GRANT·RLS·감사 트리거 미러 원본
- [Source: supabase/migrations/0004_audit.sql] — audit_trigger_fn(재사용)
- [Source: api/app/core/db.py:489-634] — `_require_master_manage`·insert/update/set_active 미러 원본
- [Source: api/app/schemas/masters.py] — Pydantic snake_case·`_Stripped`·`ActiveUpdate` 미러
- [Source: api/app/services/masters.py] — model_validate 매핑 미러
- [Source: api/app/api/v1/masters.py] — 라우터·require_master_manage·액션 엔드포인트 미러
- [Source: api/app/api/v1/router.py:9,20] — masters include(완료)
- [Source: web/src/app/(staff)/admin/masters/page.tsx] — RSC 가드 + 직접조회 주입
- [Source: web/src/lib/admin/masters.ts] — 타입·activeMeta·fetchMasters·zod·payload 매퍼 미러
- [Source: web/src/components/admin/masters-manager.tsx] — 탭·테이블·applyActive·ConfirmDialog 미러
- [Source: web/src/components/admin/department-form.tsx, room-form.tsx] — 생성/수정 폼 모달 미러
- [Source: web/AGENTS.md] — Next.js 16 변경 경고(코드 전 node_modules 문서)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Opus 4.8, 1M context) — BMad dev-story 워크플로

### Debug Log References

- `supabase db reset` → 0001~0007 적용 + seed 정상(0007_masters_codes 신규 적용 확인)
- `uv run ruff check app tests` → All checks passed
- `uv run pytest -q` → 193 passed, 7 skipped (기존 supabase_admin 프로비저닝 의존분 — SECRET_KEY·vault)
  - 신규: test_masters_codes(13 단위) · test_migrations_masters_codes(13 마이그레이션) · test_masters_codes_integration(4 통합, 로컬 스택+부트스트랩 가용 시 통과)
- `npx tsc --noEmit` → 0 errors (fee/drug select 는 리터럴이어야 행 타입 추론 — 결합 금지)
- `npx eslint src` → 0 errors (프로젝트 lint 권위 = eslint; prettier 미사용)
- `npx vitest run` → 20 files, 103 passed (masters-manager 10 + masters 순수함수 9 포함)

### Completion Notes List

**구현 요약:** 코드 마스터 3종(diagnoses·fee_schedules·drugs)을 Story 2.1 마스터 패턴으로 구현 — DB(0007 마이그레이션: 테이블·유효기간 컬럼·CHECK·RLS·감사 트리거) + API 3계층(schema→db→service→router, 쓰기 전용 9 함수/엔드포인트) + web(RSC Supabase 직접조회 확장 + 탭 3개 + 폼 3종 + 4상태 시점 배지). 새 의존성 0(TanStack/zustand/date-picker 미도입 유지). 이월 갭 ①(CONFLICT-2/FR-201) 해소.

**버전·유효기간 모델(확정):** `code` UNIQUE(코드당 1행, 0006 미러) + `effective_from`/`effective_to`(date) 유효기간 + `audit_logs` 변경이력으로 "버전" 표현(별도 version 컬럼 없음). "현재 유효" 규칙 = `is_active AND effective_from<=오늘 AND (effective_to IS NULL OR effective_to>=오늘)`을 `isCurrentlyValid` 헬퍼로 코드화(2.3 피커·Epic4·5 소비). 관리화면은 비활성·만료 행도 표시(편집 목적), 신규 선택 제외는 소비처가 필터.

**읽기/쓰기 경로(2.1 분담 이행):** 목록 읽기 = web Supabase 직접조회(`fetchMasters` 5병렬로 확장 — 전역 참조 데이터, 0007 RLS authenticated SELECT). 쓰기 = FastAPI(`master.manage` 게이트 + 동일 트랜잭션 권한 재평가 TOCTOU 차단, 기존 `_require_master_manage` 재사용). 감사 트리거 자동 기록(actor=app.actor_id).

**마이그레이션 번호:** `0007_masters_codes.sql`(0006=조직 마스터). patients는 0008로 cascade — glossary 갱신. 이미 적용된 마이그레이션은 수정하지 않음(신규 0007 파일).

**스키마:** 공통(code unique·name·effective_from NOT NULL·effective_to nullable·is_active·timestamps) + diagnoses(KCD) / fee_schedules(amount_krw 정수 ≥0 CHECK·category) / drugs(ingredient_code·unit). effective 날짜 역전·금액 음수는 Pydantic 422(model_validator/ge=0)가 1차, DB CHECK가 최종선.

**UI:** `/admin/masters` 단일 화면에 탭 5개(진료과·진료실·진단·수가·약품)로 통합. 코드 마스터는 `codeStatus` 4상태 배지(유효/발효 전/만료/비활성, 색+글리프+라벨 3중 음영 비의존). 날짜 = 네이티브 `<input type="date">`(발효일 기본=오늘), 금액 = `<input type="number">` + `Intl` 천단위 표시. 비활성=ConfirmDialog, 활성 복귀=즉시.

**검증(3중):** 클라 Zod(즉시 UX, refine 만료≥발효) → 서버 Pydantic(권위, model_validator·ge=0) → DB CHECK(최종선). 테스트가 세 경계 반영.

**Non-goals 준수:** 재사용 피커(2.3)·참조 무결성 심화·완전 temporal 버전(2.4)·시드(2.5)·급여여부/본인부담(Epic 7)·수가 자동발생 트리거(Epic 5/7) 미착수. seed.sql 미변경(코드 마스터 시드는 2.5). 2.1 코드/화면 회귀 없음(department/room 로직 보존).

### File List

**신규(DB):**
- `supabase/migrations/0007_masters_codes.sql` — diagnoses·fee_schedules·drugs + 유효기간·CHECK·RLS·감사 트리거

**신규(API 테스트):**
- `api/tests/test_masters_codes.py` — 엔드포인트 단위(13, DB 불요)
- `api/tests/test_migrations_masters_codes.py` — 마이그레이션 스모크(13)
- `api/tests/test_masters_codes_integration.py` — 통합(4, AC1·3·4 + 만료 참조 보존)

**신규(web):**
- `web/src/components/admin/diagnosis-form.tsx` — KCD 진단 생성/수정 모달(날짜 입력)
- `web/src/components/admin/fee-schedule-form.tsx` — EDI 수가 생성/수정 모달(금액·분류·날짜)
- `web/src/components/admin/drug-form.tsx` — 약품 생성/수정 모달(주성분·단위·날짜)
- `web/src/lib/admin/masters.test.ts` — codeStatus·isCurrentlyValid·todayISO·formatKrw 순수함수 단위(9)

**수정(API):**
- `api/app/schemas/masters.py` — 코드 마스터 Create/Update/Response 6 + `_EffectiveRange` 검증 믹스인
- `api/app/services/masters.py` — 코드 마스터 오케스트레이션·매핑 9 함수
- `api/app/core/db.py` — 코드 마스터 쓰기 9 함수 + 컬럼 리터럴 상수(`date` import 추가)
- `api/app/api/v1/masters.py` — 코드 마스터 엔드포인트 9개(기존 라우터·게이트 재사용)

**수정(web):**
- `web/src/lib/admin/masters.ts` — 타입 3 + MastersData/fetchMasters 확장 + codeStatus·isCurrentlyValid·CODE_STATUS_META·formatKrw·zod·payload 매퍼
- `web/src/components/admin/masters-manager.tsx` — 탭 3개·테이블 3개·코드 상태 배지·applyActive 일반화·폼 연결
- `web/src/components/admin/masters-manager.test.tsx` — MastersData 형태 갱신 + 코드 마스터 테스트 6

**수정(docs):**
- `docs/glossary.md` — 유효기간·금액·주성분 컬럼 식별자 등재 + 마이그레이션 번호 cascade(0007=masters_codes, patients→0008)

## Change Log

| 날짜 | 변경 | 작성자 |
|---|---|---|
| 2026-06-20 | Story 2.2 컨텍스트 생성 — 코드 마스터 3종(diagnoses·fee_schedules·drugs) + 유효기간(발효/만료) 컬럼 + 4상태 배지. 0007_masters_codes 신규, 2.1 마스터 패턴 복제·확장. 읽기 Supabase직접/쓰기 FastAPI(master.manage·TOCTOU)·감사·RLS·soft delete. 갭①(CONFLICT-2/FR-201) 해소. 버전 모델=code-unique + effective-dating + audit(temporal 다중버전은 보류). ready-for-dev. | Bob (SM) |
| 2026-06-20 | Story 2.2 구현 — 0007 마이그레이션(diagnoses·fee_schedules·drugs·유효기간·CHECK·RLS·감사) + API 3계층(스키마·db·service·router 9 함수/엔드포인트·master.manage·TOCTOU) + web(fetchMasters 5병렬 확장 + 탭 3개·폼 3종·codeStatus 4상태 배지) + glossary(컬럼 등재·번호 cascade). 테스트 +39(API 단위 13·마이그레이션 13·통합 4 / web manager 6·순수함수 9). 회귀 0(2.1 보존). ruff·tsc·eslint 클린, API 193 passed·web 103 passed. Status → review. | Amelia (dev) |
| 2026-06-20 | 코드 리뷰 — 3레이어 적대적(Blind·Edge·Acceptance). Acceptance Auditor: AC1~4·MUST·Non-goals 충족(차단성 위반 없음). decision-needed 0·patch 2·defer 3·dismiss 5. **patch 2건 수정 적용:** ① amount_krw 상한(Pydantic le + zod refine)으로 PG integer 오버플로 503 오인 차단 + 단위테스트(API 194 passed) ② 매니저 "비활성" 배지 렌더 테스트 추가(4종 커버). defer 3건 deferred-work 이월. Status → done. | Code Review |
