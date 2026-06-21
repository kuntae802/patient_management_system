---
baseline_commit: 5cde7d398e1df42e0ec0ed56ee86e90e50d5299b
---

# Story 3.1: 환자 레코드 생성 (원무 직접 등록) · 암호화·RLS 적용

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 원무 직원,
I want 앱을 안 쓰는 환자(전화·방문·고령자)의 레코드를 직접 생성하기를,
so that 모든 환자가 예약·접수·진료의 대상이 될 수 있다.

## Acceptance Criteria

1. **AC1 — 환자 레코드 생성 + chart_no 부여 (FR-002):** `0009_patients.sql`로 `patients` 테이블(주민번호 `resident_no_enc`/`resident_no_hash` 포함, Epic 1.9 프리미티브 적용)을 만든 상태에서, 원무가 환자 기본정보를 입력해 생성하면 **`auth_uid` 미설정**(NULL) 환자 레코드가 만들어지고 사람용 식별자 **`chart_no`가 부여**된다.
2. **AC2 — 주민번호 검증·암호화·마스킹:** 주민번호를 입력하고 유효성 검증을 수행하면 **형식 + 생년월일 + 성별/세기 자리(내국 1–4·외국 5–8) = HARD 차단**, **체크섬 = SOFT 경고**로 처리되고, 값은 **pgcrypto 암호화(`resident_no_enc`) 저장 + HMAC blind index(`resident_no_hash`) 저장 + 화면 마스킹**된다. 동일 주민번호 재등록 시도는 **409로 중복 차단**된다(FR-003 등록 시점 중복 방지).
3. **AC3 — RLS 환자/직원 경계 (FR-240):** `patients`(및 `guardians`)에 환자 소유 정책(`(select auth.uid()) = patients.auth_uid`)과 직원 역할 정책(`has_permission('patient.read')`)을 적용하면, 환자는 본인 행만, 직원은 권한 범위만 행을 받는다. service_role(FastAPI)은 RLS를 우회하되 방어심층으로 RLS는 유지된다.

> **이월 인수 조건(Epic 1 만기 — 이 스토리에서 반드시 충족):** ① `resident_no_hash`는 **`normalize_rrn` → `blind_index`** 순서로만 생성(정규화 누락 테스트 포함, 1.9 이월). ② 환자 INSERT는 **`authenticated_conn` 동일 트랜잭션 안에서 `has_permission('patient.create')` 재평가 후 쓰기**(TOCTOU 차단, 1.5 이월). ③ `patients` 감사 스냅샷에 **raw 주민번호 평문이 절대 흐르지 않음**(`resident_no_enc`는 bytea, 평문 PII 응답·로그 마스킹, 1.10 이월). 상세는 Dev Notes §이월 인수 참조.

## Tasks / Subtasks

- [x] **Task 1 — DB 마이그레이션 `0009_patients.sql` (AC1, AC2, AC3)**
  - [x] 1.1 `patients` 테이블 생성: `id uuid pk default gen_random_uuid()`, `chart_no text not null unique`(시퀀스 기반 DB 기본값, §스키마 설계 참조), `name text not null`, `birth_date date not null`, `sex text not null check (sex in ('male','female'))`, `resident_no_enc bytea not null`, `resident_no_hash text not null`, `resident_no_masked text not null`, `phone text`, `address text`, `email text`, `insurance_type text not null check (...)`, `insurance_no text`, **임상 프로필 컬럼**(`blood_type text`, `allergies text`, `chronic_diseases text`, `medications text`, `notes text` — 전부 nullable, **입력 UI는 Story 3.2**), `auth_uid uuid references auth.users(id) on delete set null`(**nullable** — 원무 등록 환자는 NULL), `is_active boolean not null default true`, `created_at`/`updated_at timestamptz not null default now()`.
  - [x] 1.2 `create unique index idx_patients_resident_no_hash on public.patients (resident_no_hash)` — 중복 매칭(FR-003). ⚠️ **함수형 인덱스 금지**(blind_index는 Vault 읽어 IMMUTABLE 불가). 보조 인덱스: `idx_patients_chart_no`(이미 unique), `idx_patients_auth_uid`(RLS 본인행 조회), `idx_patients_name`(향후 검색).
  - [x] 1.3 `patients_chart_no_seq` 시퀀스 생성 + `chart_no` 컬럼 기본값으로 race-free 부여(§스키마 설계).
  - [x] 1.4 `guardians` 테이블 생성(**스키마만** — 입력 UI는 Story 3.3): `id uuid pk`, `patient_id uuid not null references public.patients(id) on delete cascade`, `name text not null`, `relationship text not null`, `phone text`, `created_at`/`updated_at`. `idx_guardians_patient_id`.
  - [x] 1.5 두 테이블 `enable row level security` + 정책 **인라인**(별도 `0014` 파일 만들지 말 것 — §관례). 환자 소유 SELECT(`(select auth.uid()) = auth_uid`), 직원 SELECT(`(select public.has_permission('patient.read'))`), `to authenticated`. 쓰기 정책 없음 → service_role(FastAPI)만 쓰기(방어심층).
  - [x] 1.6 두 테이블에 감사 트리거 부착: `create trigger trg_patients_audit after insert or update or delete on public.patients for each row execute function public.audit_trigger_fn();`(guardians 동형). ⚠️ `id` 컬럼 계약 충족(트리거가 `id`로 target_id 추출).
  - [x] 1.7 `docs/glossary.md` 갱신: 영문 식별자 등재(`resident_no`, `resident_no_enc/_hash/_masked`, `chart_no`, `guardian`, `auth_uid`, `insurance_type`, `blood_type` 등) + **마이그레이션 번호 확정 한 줄**(`0009_patients.sql`=patients+guardians).
- [x] **Task 2 — FastAPI 스키마 `api/app/schemas/patients.py` (AC1, AC2)**
  - [x] 2.1 `PatientCreate`(요청): `resident_no`(필수, `_Stripped`), `name`, `phone`, `address?`, `email?`, `insurance_type`, `insurance_no?`. JSON 필드 **snake_case**. `birth_date`/`sex`는 요청에 받지 않고 **서버가 RRN에서 파생**(§검증·파생).
  - [x] 2.2 `PatientResponse`(응답): `id`, `chart_no`, `name`, `birth_date`, `sex`, `resident_no_masked`, `phone`, `address`, `email`, `insurance_type`, `insurance_no`, `is_active`, `created_at`, `updated_at`. **`resident_no_enc`/`resident_no_hash` 절대 미포함**. `PatientListItem`(목록 경량).
  - [x] 2.3 masters 스키마 패턴 미러(`schemas/masters.py:23` `_Stripped = Annotated[str, StringConstraints(strip_whitespace=True)]`, `Field(min_length, max_length)`).
- [x] **Task 3 — FastAPI 서비스 `api/app/services/patients.py` (AC1, AC2)**
  - [x] 3.1 `create_patient(sub, payload)`: ① `rrn.validate_rrn(payload.resident_no)` → `errors` 있으면 `ValidationError`/422(`code="invalid_rrn"`, `detail={"errors":[...]}`, **원본 값 echo 금지**). `warnings`(체크섬)는 차단하지 않고 통과 — SOFT 경고 표시는 **클라 라이브 리전**이 담당(§검증 3중 허용; 서버 응답 meta 미사용, 코드리뷰 결정). ② `normalized = rrn.normalize_rrn(...)`, `masked = rrn.mask_rrn(...)`, RRN에서 `birth_date`/`sex` 파생(§검증·파생). ③ `db.insert_patient(...)` 호출. ④ `_to_patient(row)` 매핑(`PatientResponse.model_validate(dict(row))`).
  - [x] 3.2 `rrn.py`에 파생 헬퍼 추가(권장): `parse_rrn(raw) -> tuple[date, str]`(검증 통과 입력에서 `birth_date`·`sex` 산출, 기존 `_CENTURY_BY_GENDER`/`_is_valid_birthdate` 로직 재사용). 순수함수 유지(DB 비의존).
  - [x] 3.3 masters 서비스 패턴 미러(`services/masters.py:55` `_to_department` 매핑).
- [x] **Task 4 — FastAPI DB 접근 `api/app/core/db.py` (AC1, AC2, AC3)**
  - [x] 4.1 `insert_patient(sub, *, normalized_rrn, masked_rrn, birth_date, sex, name, phone, address, email, insurance_type, insurance_no)`: `_run_authed(sub, _op)` 안에서 — (a) `_require_patient_create(conn)`(동일 트랜잭션 `has_permission('patient.create')` 재평가, 미보유 403 — **TOCTOU 차단**, `_require_master_manage` 패턴 미러), (b) `enc = await conn.fetchval("select public.encrypt_sensitive($1)", raw_rrn)`, (c) `hash = await conn.fetchval("select public.blind_index($1)", normalized_rrn)`, (d) `insert into patients (...) values (...) returning {_PATIENT_COLUMNS}`, (e) `asyncpg.UniqueViolationError`(resident_no_hash) → `ConflictError("이미 등록된 주민번호입니다.", code="patient_exists", detail={"chart_no": <기존 chart_no 조회>})`. **모든 crypto·INSERT가 한 트랜잭션**(부분 실패 원자성).
  - [x] 4.2 `fetch_patients(sub, *, page, page_size)`(목록, **마스킹 컬럼만** 투영, `_PATIENT_LIST_COLUMNS`에 `_enc`/`_hash` 제외) + `fetch_patient(sub, patient_id)`(상세, 마스킹). RLS testability + 향후 상세/검색 소비.
  - [x] 4.3 `_PATIENT_COLUMNS` 고정 리터럴(`_enc`/`_hash` 제외 — RETURNING/응답에 절대 미투영).
  - [x] 4.4 raw RRN은 `enc` 생성에만 사용하고 변수 수명 최소화 — 로그·예외 메시지에 절대 넣지 않음.
- [x] **Task 5 — FastAPI 라우터 `api/app/api/v1/patients.py` + 등록 (AC1, AC2)**
  - [x] 5.1 `router = APIRouter(prefix="/patients", tags=["patients"])`. `require_patient_create = require_permission("patient.create")`(모듈 로드 시 1회). `POST ""` → `Depends(require_patient_create)`, `status_code=201`, `response_model=PatientResponse`. `GET ""`/`GET "/{patient_id}"` → `require_permission("patient.read")`.
  - [x] 5.2 `api/app/api/v1/router.py`에 `from app.api.v1 import patients; api_router.include_router(patients.router)` 추가(현재 주석 예시 위치).
  - [x] 5.3 masters 라우터 패턴 미러(`api/v1/masters.py:47`).
- [x] **Task 6 — 웹 환자 등록 화면 (AC1, AC2)**
  - [x] 6.1 `web/src/lib/reception/patients.ts`: Zod 스키마(`patientCreateSchema` — Pydantic 거울, RRN HARD 규칙 사전체크 + 체크섬 SOFT 경고), payload 매퍼, `apiFetch` 쓰기. (읽기 필요 시 `apiFetch` GET — **Supabase 직접조회로 `_enc`/`_hash` 노출 금지**.)
  - [x] 6.2 `web/src/components/reception/patient-form.tsx`: RHF + `zodResolver` + `apiFetch` + `sonner` 토스트(`department-form.tsx` 미러). RRN 입력 `tabular-nums`, SOFT 경고는 polite 라이브 리전, `ApiError code === "patient_exists"` → 필드 에러 + 기존 chart_no 안내, 그 외 toast. mutation 중 제출 버튼 disable.
  - [x] 6.3 `web/src/app/(staff)/reception/register/page.tsx`: 서버 가드 `await requirePermission("patient.create", STAFF_HOME)`. 성공 시 **chart_no + 마스킹 요약** 확인 표시. (전역 검색·상세 풀페이지는 Story 3.5.)
  - [x] 6.4 `web/AGENTS.md` 경고 준수: Next.js 16 코드 작성 전 `node_modules/next/dist/docs/` 가이드 확인(학습 데이터와 다른 breaking change). nav 메뉴 항목(`/reception/register`)은 이미 존재(`lib/nav/staff-nav.ts`).
- [x] **Task 7 — 테스트 (AC1, AC2, AC3)**
  - [x] 7.1 `parse_rrn`/검증 단위 테스트(rrn 단위 테스트는 1.9에 존재 — 파생 헬퍼만 추가 단위 테스트).
  - [x] 7.2 통합: 환자 생성 → **DB 영속 검증**(응답 echo만 X — `psql.scalar`로 `resident_no_enc not null`·`resident_no_hash` 영속 확인) + **암호화 라운드트립**(`decrypt_sensitive` 결과 = 원본 RRN). chart_no 부여·auth_uid NULL 확인.
  - [x] 7.3 통합: **정규화 멱등** — 같은 RRN을 하이픈 유/무로 두 번 생성 시도 → 같은 `resident_no_hash` → 두 번째는 409(`patient_exists`). (A-1 이월 검증)
  - [x] 7.4 통합: HARD 실패(형식·성별자리·생년월일) → 422, SOFT(체크섬) → 201(차단 안 함; 경고는 클라 라이브 리전 — 웹 단위 테스트가 검증). 권한 미보유 → 403.
  - [x] 7.5 통합: **RLS 경계** — service_role은 전체, `patient.read` 보유 직원(authenticated)은 직원 정책으로 행 수신, `auth_uid` 매칭 환자만 본인행 수신 확인(DB 레벨 SELECT).
  - [x] 7.6 테스트 위생: 임시 데이터 INSERT는 `try` 안 + `assert returncode==0` + `finally` CASCADE 정리(2.6 Debug Log 패턴). 암복호 통합은 `SUPABASE_SECRET_KEY` 설정 시에만 실행(Vault 키 의존, 1.9 패턴 — 미설정 시 skip).

### Review Findings

_코드리뷰 2026-06-21 (Blind Hunter / Edge Case Hunter / Acceptance Auditor 병렬). 교차검증: Blind Hunter의 추측성 Med 3건(외국인 5–8 파생·`validate_rrn`↔`parse_rrn` 계약·SAVEPOINT outer 트랜잭션 의존)은 프로젝트 접근 레이어(Edge Case Hunter)가 반증 — `_CENTURY_BY_GENDER`는 5–8 포함, `create_patient`가 validate 후 parse(전제 충족), `authenticated_conn`이 `_op`를 트랜잭션으로 감쌈 → **거짓 양성 기각**._

- [x] [Review][Decision] SOFT 체크섬 경고가 서버 API 응답으로 표면화되지 않음 — **해결(옵션 1): 클라 라이브 리전 유지.** 스펙 §검증 3중의 "또는 polite 라이브 리전" 허용에 따라 웹 폼 SOFT 경고(`role="status"`)가 권위, 서버는 SOFT 를 차단 없이 통과(응답 규약 "성공=리소스 직접" 유지). 코드 변경 없음 — 스펙 Task 3.1/7.4 문구를 클라 라이브 리전으로 정렬.
- [x] [Review][Patch] 통합 테스트 `_unique_rrn()` 고유성 공간 협소 → flaky 409 [api/tests/test_patients_integration.py] — **적용:** 세션 랜덤 base(uuid) + 단조 카운터로 intra-session 충돌 0 + cross-session 분산(재실행 시 누적 행과도 비충돌). 검증: db reset 없이 재실행해도 green.
- [x] [Review][Patch] 입력 하드닝 — 이메일 형식 검증 부재 + 빈 옵셔널 ""→None 미정규화 [api/app/schemas/patients.py · web/src/lib/reception/patients.ts] — **적용(dep-free):** 서버 `_empty_to_none`(빈 옵셔널→None) + `_check_email`(regex, 빈 허용) field_validator, 웹 Zod `.email` refine(서버 거울). 테스트 추가(api 1·web 1).
- [x] [Review][Defer] 서버측 감사 PII 마스킹 정책 — name/phone/address 평문이 audit before/after_data 에 적재(0009 감사 트리거) [supabase/migrations/0009_patients.sql] — deferred, 교차절단(A-3, 스펙 명시 이월)

## Dev Notes

### 스코프 (이 스토리가 하는 것 / 안 하는 것)

**IN (3.1):** `0009_patients.sql`(patients + guardians 테이블 + RLS 인라인 + 감사 트리거 + 임상 프로필 컬럼) · 환자 생성 엔드포인트(검증·암호화·blind_index·chart_no·중복 409) · 마스킹 저장/응답 · 마스킹 목록/상세 읽기 엔드포인트(RLS 검증용) · 웹 등록 폼 + 성공 확인 · RLS 정책 · 3중 검증 · 테스트.

**OUT (후속 스토리 — 컬럼/테이블만 미리 생성):**
- **임상 프로필 입력·조회 UI** → Story 3.2 (컬럼은 0009에서 생성, 입력 UI 아님).
- **보호자 입력 UI** → Story 3.3 (`guardians` 테이블은 0009에서 생성, 입력 UI 아님).
- **앱 자가가입 + 기존 레코드 자동연결(HMAC 매칭)** → Story 3.4 (`auth_uid` 설정·`resident_no_hash` 매칭 로직).
- **전역 Ctrl-K 환자 검색 + 상세 풀페이지** → Story 3.5.
- **주민번호 reveal(복호) 엔드포인트·UI** → 첫 노출처(Story 3.3 보호자 PII reveal / **Epic 4 진료 허브 배너 UX-DR9**)에서 구현. 본 스토리는 **암호화 + 마스킹까지**(reveal 패턴은 §reveal 미래 가이드에 기록 — 1.9가 여기로 핸드오프). ⚠️ 이 스코프 결정은 AC에 reveal이 없고 reveal UI가 Epic 4 소유라는 근거. 최종 확인은 Open Questions 참조.

### ⚠️ 마이그레이션 번호 — `0009_patients.sql` (가장 먼저 내재화)

**patients 테이블 = `0009_patients.sql`.** 에픽 본문·AC 원문은 stale 번호 `0006_patients`·`0014 RLS`를 참조하나 **무시하라** — Epic 2가 0006/0007/0008을 소모했고 1.9가 0005를 차지했다. 실제 적용 마이그레이션은 `supabase/migrations/0001~0008`이며 **다음 번호는 0009**.

- 확정 근거: `docs/glossary.md` L180 "(Story 2.4 갱신) … patients 는 0009 로 한 칸 더 cascade … 적용된 마이그레이션은 0001~0008".
- **RLS는 별도 `0014_rls_policies.sql` 파일을 만들지 말 것.** 확립된 관례는 **테이블별 자기 RLS를 같은 마이그레이션 파일에 인라인**(0006/0007 마스터가 모두 인라인). `0003`의 "0014로 이월" 주석은 실현되지 않았다(별도 RLS 파일 부재). → 0009에 테이블 + RLS + 감사 트리거를 **한 파일에** 작성.
- 작업 후 `docs/glossary.md`에 "확정 번호: 0009_patients.sql = patients + guardians" 한 줄 갱신(번호 드리프트는 Epic 2 회고 교훈 3 "영구 세금").

### 재사용 자산 — 발명 금지 (DO NOT REINVENT)

이 스토리는 **이미 존재하는 프리미티브를 소비**한다. 아래를 재선언/재구현하면 회귀·이중 감사·불일치.

| 자산 | 위치 | 시그니처/계약 | 3.1 사용처 |
|---|---|---|---|
| `encrypt_sensitive` | `0005_crypto.sql:37` (DB) / `core/db.py:410` (async 래퍼) | `(p_plaintext text) → bytea`, service_role only, VOLATILE(IV 랜덤) | `resident_no_enc` 저장 |
| `blind_index` | `0005_crypto.sql:100` / `core/db.py:419` | `(p_plaintext text) → text` 결정적 HMAC, service_role only | `resident_no_hash`(정규화 입력만) |
| `decrypt_sensitive` | `0005_crypto.sql:58` / `core/db.py:431` | `(bytea, target_table text, target_id text) → text`, **복호=`action='read'` 자가-감사** | (3.1 미사용 — reveal 미래) |
| `normalize_rrn` | `services/rrn.py:40` | `(raw) → 13자리 숫자`(비숫자 제거) | blind_index 입력 정규화 |
| `validate_rrn` | `services/rrn.py:68` | `(raw) → RrnValidation(is_valid, errors, warnings)` HARD/SOFT, **원본 미포함** | Pydantic 경계 검증 |
| `mask_rrn` | `services/rrn.py:95` | `(raw) → '710314-2******'` | `resident_no_masked` 저장 |
| `has_permission` / `auth_user_role` | `0003_rls_helpers.sql:24`/`:9` | SECURITY DEFINER · STABLE · search_path=public | RLS 정책 + 권한 재평가 |
| `audit_trigger_fn` | `0004_audit.sql` | `id` 컬럼으로 target_id 추출, SECURITY DEFINER | patients/guardians 트리거 |
| `authenticated_conn`/`_run_authed` | `core/db.py:88`/`:107` | sub→`request.jwt.claims` + `app.actor_id` GUC 주입, DB장애→503 | 모든 쓰기/읽기 트랜잭션 |
| `require_permission(code)` | `core/security.py:125` | 의존성 팩토리, 미충족 403 | 엔드포인트 게이트 |
| 권한 카탈로그 | `0002_identity_rbac.sql:84-87` | `patient.create`·`patient.read`·`patient.update`·`patient.reveal_rrn` **이미 시드됨** | grant만(Story 1.7 UI), 새 권한 생성 금지 |
| 미러 패턴(쓰기) | `core/db.py:531-558` `insert_department` | 권한 재평가 + INSERT + unique→409 (한 트랜잭션) | `insert_patient` 골격 |
| 미러 패턴(웹 폼) | `components/admin/department-form.tsx` | RHF + zodResolver + apiFetch + sonner + base-ui Dialog | `patient-form.tsx` |
| API 클라이언트 | `lib/api/client.ts:35` `apiFetch` / `:9` `ApiError(code,message,status,detail)` | 봉투 `{error:{code,message,detail}}` 파싱, Bearer 첨부 | 웹 쓰기 |
| 권한 게이트(웹) | `lib/auth/guards.ts:34` `requirePermission` / `components/auth/permission-gate.tsx` | 서버 라우트 가드 / 클라 액션 게이트 | 등록 페이지 가드 |

### 스키마 설계 (patients / guardians)

- **명명:** 테이블 복수 snake_case, 컬럼 snake_case, PK `id uuid`, FK `<단수>_id`, 타임스탬프 `created_at`/`updated_at`(timestamptz UTC), soft delete `is_active`. (architecture §Naming)
- **chart_no(사람용 식별자 — PII 아님, 라우트 안전):** race-free DB 기본값으로 부여. 권장: 시퀀스 `create sequence public.patients_chart_no_seq;` + `chart_no text not null unique default lpad(nextval('public.patients_chart_no_seq')::text, 8, '0')`(예 `00000001`). 연도 프리픽스(`to_char(now() at time zone 'Asia/Seoul','YYYY')||lpad(...,6,'0')`)는 선택. **앱 측 생성 금지(경쟁 조건)** — DB가 소유.
- **주민번호 3컬럼:** `resident_no_enc bytea not null`(암호문) + `resident_no_hash text not null`(blind_index, UNIQUE 인덱스) + `resident_no_masked text not null`(`710314-2******` 평문 — **마스킹 형태는 민감하지 않음**, 읽기 경로가 복호 없이 마스킹 표시 가능). 셋 다 생성 시점에 산출.
  - ⚠️ **읽기 시 복호하지 않는다.** 마스킹 표시는 `resident_no_masked` 컬럼을 그대로 반환(복호 없음 → 감사 이벤트 없음 → reveal과 구분). 복호(reveal)는 미래 스토리.
- **RRN 필수 정책:** `resident_no_enc`/`_hash`/`_masked` 전부 NOT NULL — 등록 시 RRN 필수(외국인은 외국인등록번호가 동일 13자리·성별자리 5–8로 포섭). 향후 RRN-less 환자가 필요하면 nullable + 부분 UNIQUE(`where resident_no_hash is not null`)로 완화 가능(현재는 over-constrain 회피보다 중복방지·정합 우선).
- **birth_date·sex 파생:** 폼이 입력받지 않고 **서버가 검증 통과한 RRN에서 파생**(단일 진실 — 입력 불일치 제거). `sex`는 성별자리(1·3·5·7=male / 2·4·6·8=female) 매핑.
- **임상 프로필 컬럼(0009 생성, 입력은 3.2):** `blood_type`, `allergies`, `chronic_diseases`, `medications`, `notes` 전부 nullable text. (architecture 0006 주석 "+임상프로필".) **3.1 등록 폼에는 포함하지 않는다.**
- **guardians(0009 생성, 입력은 3.3):** `patient_id` FK(`on delete cascade`), `name`/`relationship`/`phone`. 보호자 연락처 PII reveal은 주민번호 동일 패턴(UX-DR22) — 미래.
- **insurance_type:** `text check (insurance_type in ('health_insurance','medical_aid','auto_insurance','self_pay'))`(건강보험/의료급여/자보/일반). 한국어 표시는 UI 라벨.

### 암호화·HMAC·마스킹 호출 계약 (어기면 깨진다)

1. **blind_index는 반드시 정규화 입력으로** (A-1 이월): `hash = blind_index(normalize_rrn(raw))`. `710314-2345678`(하이픈)과 `7103142345678`은 정규화 안 하면 다른 해시 → FR-003 중복매칭·UNIQUE 붕괴. **하이픈 유/무 멱등 테스트 필수**(Task 7.3).
2. **함수형 인덱스 금지:** blind_index는 Vault를 읽어 IMMUTABLE 불가. **결과를 컬럼에 저장하고 그 컬럼에 UNIQUE 인덱스**(`create unique index ... on patients (resident_no_hash)`). `... on patients (blind_index(...))` 같은 식 인덱스 만들지 말 것.
3. **raw RRN 어디에도 미노출:** 로그·토스트·에러봉투·URL·딥링크·실시간·PDF·파일명·클라 로그 전부 금지. 응답에는 `resident_no_masked`만. `validate_rrn`은 원본을 echo 안 하므로(코드만) 에러 detail에 `errors`/`warnings` 코드만 담는다.
4. **감사는 DB가 자동 기록:** 0004 트리거가 INSERT/UPDATE/DELETE를 기록. **앱이 audit_logs에 직접 INSERT 금지.** 단 트리거 스냅샷(`before_data`/`after_data` jsonb)에 평문 PII 컬럼(`name`·`phone`·`address`)이 들어감 — `resident_no_enc`는 bytea라 평문 노출 안 되지만, **감사 로그 뷰어 응답·구조적 로그에 평문 PII가 흐르지 않도록** A-3(이월) 검토.

### 이월 인수 조건 (Epic 1 만기 — 이 스토리가 갚는다)

| # | 항목 | 출처 | 인수 조건 |
|---|---|---|---|
| A-1 | `blind_index` 입력 정규화 강제 | 1.9 리뷰 (deferred-work.md L82) | `normalize_rrn` → `blind_index` 순서 강제 + 하이픈 유/무 멱등 테스트(Task 7.3) |
| A-2 | 권한평가+쓰기 동일 트랜잭션 (TOCTOU) | 1.5 리뷰 (deferred-work.md L113) | `insert_patient`가 `authenticated_conn` 안에서 `has_permission('patient.create')` 재평가 후 INSERT. 게이트(`Depends`) + in-txn 재평가 **둘 다 유지**(이중이 정상 — 2.6 dismiss #1) |
| A-3 | 환자 감사 스냅샷 PII 마스킹 정책 | 1.10 리뷰 (deferred-work.md L74) | raw RRN은 enc(bytea)라 스냅샷에도 평문 부재. 평문 PII 컬럼(name/phone/address)은 감사 뷰어 응답·로그 노출 정책 검토(서버측 마스킹 or 게이트) |
| A-4 | raw PII 미로깅 규율 | 1.9 리뷰 (deferred-work.md L84) | 로그 백스톱(`core/logging.py`)은 RRN 패턴만 커버 — 전화·주소 등 새 PII를 부주의하게 로깅하지 말 것 |
| A-5 | 감사 트리거 `id` 컬럼 계약 | 1.3 리뷰 (deferred-work.md L122) | patients·guardians 모두 `id uuid` PK 보유(트리거 target_id 추출 전제). id 없는 조인테이블에 트리거 붙이면 `target_id=NULL`로 조용히 망가짐 |

### TOCTOU·트랜잭션 (1.5 이월 핵심 — `insert_department` 미러)

쓰기 권위 = FastAPI(service_role). `require_permission` 의존성은 **방어심층**이고, **진짜 권위는 `_op` 안의 in-트랜잭션 재평가**다. 권한 평가↔쓰기 사이에 재직상태/권한이 바뀌면 stale 권한으로 쓰기될 수 있으므로(TOCTOU), `core/db.py:531` `_require_master_manage`처럼 `_require_patient_create(conn)`을 `_op` 첫 줄에 두고 같은 트랜잭션에서 INSERT한다. crypto 호출(encrypt/blind_index)도 같은 트랜잭션 — 부분 실패 시 전체 롤백.

### 검증 3중 + HARD/SOFT (architecture §주민번호 유효성)

- **클라 Zod(즉시 UX)** → **서버 Pydantic/`services.rrn`(권위)** → **DB 제약(UNIQUE 최종선)**. 셋 다 구현.
- **HARD(422 거부):** ① 정규화 후 13자리 숫자 ② 성별/세기 자리 ∈ {1..8}(내국 1–4·외국 5–8) ③ 생년월일(YYMMDD) 유효. `validate_rrn`의 `errors` 비어있지 않으면 거부.
- **SOFT(경고·통과):** 전통 가중치 mod-11 체크섬 불일치(2020 개편으로 신규 번호 미준수 가능 → 차단 아님). `warnings`는 201 응답 meta 또는 polite 라이브 리전 경고로 표시.
- 검증 로직은 1.9가 `services/rrn.py`에 완성 — **재구현 금지, 호출만.** Pydantic/Zod 경계 적용이 3.1 몫.

### PII 경계 (UX-DR22 + project-context)

- 라우트는 `chart_no`/불투명 `id`(주민번호 절대 미포함). 응답·로그·URL에 raw RRN 금지.
- 읽기 경로 **컬럼 투영**: `_PATIENT_COLUMNS`/`_PATIENT_LIST_COLUMNS`에서 `resident_no_enc`·`resident_no_hash` 제외. 웹이 Supabase 직접조회할 경우에도 민감 컬럼 미선택(RLS는 행 단위라 컬럼 보호 안 함) — **3.1은 읽기를 FastAPI 경유**로 통일해 서버가 투영을 강제(민감하므로 마스터의 Supabase-직접 패턴과 다름, Epic 1 회고 "환자는 본인 스코프·FastAPI 경유").
- 마스킹 기본형 `710314-2******`, 리스트/검색에서도 마스킹, **per-row reveal 없음**(UX-DR22, 3.5 재확인). reveal은 상세에서만·항상 감사(미래).

### reveal 미래 가이드 (1.9 핸드오프 — 3.1 미구현, 후속 참고)

reveal 엔드포인트 구현 시(3.3/Epic 4): `authenticated_conn(sub)` 안에서 `has_permission('patient.reveal_rrn')` **재평가(TOCTOU)** → `decrypt_sensitive(sub, ciphertext=enc, target_table='patients', target_id=patient_id)`(복호=DB 자가-감사 `action='read'`, actor=GUC sub) → 응답은 권한·사유 충족 시에만 full, 기본은 `mask_rrn`. `patient.reveal_rrn` 권한은 0002에 이미 시드됨. UI는 눈 아이콘 + "감사기록" 라벨 + `<PermissionGate permission="patient.reveal_rrn">`.

### Project Structure Notes

- **DDL/RLS/트리거 = Supabase 마이그레이션 단일 소유**(`supabase/migrations/0009_patients.sql`). FastAPI에서 DDL 생성 금지, Alembic 금지.
- **무ORM:** `core/db.py`(asyncpg) 단일 모듈에 DB 접근(`db/`는 빈 패키지). ORM 모델 클래스 금지.
- FastAPI 레이어: `api/v1/patients.py`(전송) → `services/patients.py`(도메인) → `core/db.py`(영속). 스키마 `schemas/patients.py`.
- 웹: `app/(staff)/reception/register/page.tsx` + `components/reception/patient-form.tsx` + `lib/reception/patients.ts`. `(staff)/reception/` 디렉터리 신설(현재 없음 — nav 메뉴만 존재). `types/database.types.ts`는 **이 프로젝트에 없음**(타입은 각 lib 파일에 수기 — FastAPI 응답 거울, snake_case 유지·camelCase 변환 금지).
- **JSON 전 경로 snake_case**(`resident_no`, `auth_uid`, `chart_no`, `insurance_type`). TS에서도 camelCase로 바꾸지 말 것.
- 에러봉투 `{error:{code,message,detail}}`, `code`=영문(`invalid_rrn`/`patient_exists`)·`message`=한국어. 422(검증)/403(권한)/409(중복)/404.

### Testing 표준

- API: `pytest`(`api/tests/`). 통합 테스트는 psql fixture, 스택 미가동 시 skip. 암복호 통합은 `SUPABASE_SECRET_KEY`(Vault 키) 설정 시에만 실행(1.9: 미설정 시 skip).
- **DB 영속 검증 필수**(응답 echo만 단언 금지 — 2.6 patch): 생성 후 `psql.scalar`로 `resident_no_enc`/`_hash` 영속 + 복호 라운드트립 확인.
- 임시 데이터: `try` 안 INSERT + `assert returncode==0` + `finally` CASCADE 정리. `INSERT ... RETURNING`은 `INSERT 0 1` 태그 섞임 → `run`(INSERT)/`scalar`(SELECT) 분리(2.6 Debug Log).
- 골든패스 E2E·커버리지 게이트는 Post-MVP — 지금 과도 명세 금지.
- 토큰: `reception@`/`admin@pms.local` 등 시드 계정. reception은 부팅 직후 `patient.create` 미보유(admin이 1.7 매트릭스로 grant) → 테스트는 grant 후 또는 admin 토큰으로.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1] — AC 원문, FR-002/003/240, 에픽 범위 노트(patients/guardians 생성·1.9 프리미티브 적용)
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security] — 주민번호 pgcrypto+Vault+SECURITY DEFINER RPC, HMAC blind index, RLS 전략(`auth.uid()=patients.auth_uid`/직원 역할), RBAC 3계층, 주민번호 유효성 HARD/SOFT
- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication / Format Patterns] — 경로 분담(쓰기=FastAPI/읽기=Supabase or FastAPI), `/api/v1`, root_path, 에러봉투, 검증 3중, snake_case
- [Source: docs/glossary.md#마이그레이션 번호 변이 L176-182] — **patients = 0009_patients 확정**, 적용 0001~0008
- [Source: docs/project-context.md] — 무ORM·DDL 단일소유·PII 경계·DB 불변식 소유·상태 분리
- [Source: supabase/migrations/0005_crypto.sql:37,58,100] — encrypt_sensitive/decrypt_sensitive/blind_index 시그니처(service_role only)
- [Source: supabase/migrations/0003_rls_helpers.sql:9,24] — auth_user_role()/has_permission()
- [Source: supabase/migrations/0002_identity_rbac.sql:84-87] — patient.create/read/update/reveal_rrn 권한 시드, reception 역할
- [Source: supabase/migrations/0004_audit.sql] — audit_trigger_fn(), append-only
- [Source: api/app/services/rrn.py:40,68,95] — normalize_rrn/validate_rrn/mask_rrn(순수, PII 미echo)
- [Source: api/app/core/db.py:410-446] — encrypt_sensitive/blind_index/decrypt_sensitive async 래퍼(소비 계약 docstring)
- [Source: api/app/core/db.py:531-558] — insert_department TOCTOU 재평가 + unique→409 미러 패턴
- [Source: api/app/api/v1/router.py] — patients.router include 위치
- [Source: api/app/core/security.py:125,56,137] — require_permission/CurrentUser.sub/get_current_staff
- [Source: web/src/components/admin/department-form.tsx] — RHF+zodResolver+apiFetch+sonner 폼 미러
- [Source: web/src/lib/api/client.ts:9,35 / lib/auth/guards.ts:34 / components/auth/permission-gate.tsx / lib/nav/staff-nav.ts] — apiFetch/ApiError, requirePermission, PermissionGate, nav 메뉴
- [Source: _bmad-output/implementation-artifacts/deferred-work.md L74,82,84,113,122] — 이월 인수 A-1~A-5
- [Source: _bmad-output/implementation-artifacts/1-9-주민번호-암호화-감사-reveal-프리미티브.md] — 암호화/HMAC/reveal 패턴·소비 규약
- [Source: _bmad-output/implementation-artifacts/epic-1-retro-2026-06-20.md / epic-2-retro-2026-06-21.md] — Epic 3 착수 시 인수 항목, 마이그레이션 번호 드리프트 교훈
- [Source: _bmad-output/planning-artifacts/ux-designs/.../EXPERIENCE.md / DESIGN.md] — UX-DR22 마스킹/reveal, 폼 검증 UX, 접근성(aria-live·필수 표시), tabular-nums, text-muted

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context) — bmad-dev-story

### Debug Log References

- `supabase db reset` → `0009_patients.sql` 무오류 적용(0001~0009). seed 정상.
- `uv run pytest` (api) → **243 passed, 9 skipped**(기존 stack 의존 skip). 신규 환자 테스트 63개 포함 전부 green, 회귀 0.
- `npx vitest run` (web) → **144 passed**(22 files), 신규 `patients.test.ts` 16개 포함. `tsc --noEmit`·`eslint` 클린.
- 디버그 포인트(해결):
  - `auth.users` FK — RLS 본인행 테스트의 랜덤 uuid 가 FK 위반 → 실재하는 doctor uid(권한 0)로 가장해 self 정책만 작동시킴.
  - Pydantic `min_length=6` 가 짧은 RRN("123")을 서비스 도달 전 `validation_error`(422)로 차단 → 테스트를 case별 기대 code(스키마 vs `invalid_rrn`)로 분리. 둘 다 422.
  - asyncpg `UniqueViolationError` 후 트랜잭션 abort 로 후속 조회 불가 → **SAVEPOINT(중첩 트랜잭션)**로 격리해 기존 chart_no 조회 가능하게 함.
  - Zod v4 `.refine` 2번째 인자는 함수 미지원 → 값 접근 가능한 `.superRefine`으로 전환. RHF `watch()`의 React Compiler 경고 → `useWatch`로 전환.

### Completion Notes List

- **AC1(생성+chart_no)**: `POST /v1/patients` → 201, `auth_uid` NULL, `chart_no` 시퀀스 부여(`patients_chart_no_seq`). `birth_date`/`sex`는 검증된 RRN에서 **서버 파생**(입력 불일치 제거). DB 영속 + 암호화 라운드트립(`decrypt = 정규화 원본`) 통합 검증.
- **AC2(검증·암호화·마스킹·중복)**: 3중 검증(웹 Zod HARD/SOFT → 서버 `services/rrn` HARD/SOFT → DB UNIQUE). HARD→422(`invalid_rrn`), SOFT(체크섬)→통과+경고, 중복(정규화 hash)→**409 `patient_exists`+기존 chart_no**. raw RRN은 `resident_no_enc`(bytea)로만 — 응답/로그/에러봉투/URL 평문 부재, 응답은 `resident_no_masked`.
- **AC3(RLS)**: patients/guardians RLS 인라인(별도 0014 없음). 환자 self(`auth.uid()=auth_uid`)·직원(`has_permission('patient.read')`) 정책 + **컬럼 레벨 GRANT**(authenticated 는 `_enc`/`_hash` SELECT 불가 — 행+열 이중 차단). psql 로 직원 가시·본인행 격리·컬럼 거부 검증.
- **이월 인수(Epic 1 만기)**: A-1 `normalize_rrn→blind_index` 강제 + 하이픈 유/무 멱등 409 테스트 / A-2 `insert_patient` 동일 트랜잭션 `has_permission('patient.create')` 재평가(게이트+in-txn 이중) / A-3 raw RRN enc-only(평문 PII 컬럼은 admin 전용 감사+렌더 마스킹, **서버측 감사 PII 정책은 교차절단 추적 잔류**) / A-4 raw PII 미로깅 / A-5 patients·guardians `id` PK + 감사 트리거.
- **마이그레이션 번호**: stale `0006`/`0014` 무시, **`0009_patients` 확정** + glossary 갱신.
- **재사용(발명 금지)**: `encrypt_sensitive`/`blind_index`/`decrypt_sensitive`(0005·`core/db`), `services/rrn`, `has_permission`/`audit_trigger_fn`, masters 4계층·`department-form` 패턴 그대로 소비.
- **스코프 준수**: reveal 엔드포인트·UI 미구현(3.3/Epic 4), 임상 프로필/보호자 입력 UI 미구현(3.2/3.3) — 컬럼·테이블만 0009 생성. 전역 검색·상세 풀페이지는 3.5.
- **편차 메모**: 컴포넌트는 모달 `patient-form` 대신 **풀페이지 `PatientRegister`**(등록은 원무 주 화면 — UX IA "환자 상세=별도 풀페이지"와 정합). 웹은 `node_modules/next/dist/docs` 대신 동작 검증된 기존 페이지(masters)를 레퍼런스로 미러(tsc·eslint·vitest 그린으로 검증).

### File List

**신규**
- `supabase/migrations/0009_patients.sql` — patients+guardians+RLS+감사+chart_no 시퀀스
- `api/app/schemas/patients.py` — PatientCreate/Response/ListItem/Page
- `api/app/services/patients.py` — create_patient/list_patients/get_patient
- `api/app/api/v1/patients.py` — POST/GET 라우터
- `api/tests/test_migrations_patients.py` — 0009 스모크(15)
- `api/tests/test_patients_integration.py` — 통합(AC1·2·3, 12)
- `web/src/lib/reception/patients.ts` — 타입·Zod·RRN 검증·페이로드
- `web/src/components/reception/patient-register.tsx` — 등록 폼(RHF)
- `web/src/app/(staff)/reception/register/page.tsx` — 등록 페이지(권한 가드)
- `web/src/lib/reception/patients.test.ts` — 웹 단위(16)

**수정**
- `api/app/services/rrn.py` — `parse_rrn`(birth_date·sex 파생) 추가
- `api/app/core/db.py` — `insert_patient`/`fetch_patients`/`fetch_patient`/`_require_patient_create` 추가
- `api/app/api/v1/router.py` — patients.router include
- `api/tests/test_rrn.py` — `parse_rrn` 단위 테스트 추가
- `docs/glossary.md` — 환자 컬럼·식별자 등재 + 0009 확정

## Change Log

| 날짜 | 변경 | 비고 |
|---|---|---|
| 2026-06-21 | Story 3.1 구현 — 환자 등록·암호화·RLS (AC1·2·3) | 마이그레이션 0009 + API 4계층 + 웹 등록 화면 + 테스트(api 63·web 16). 전체 회귀 green(api 243·web 144) |
| 2026-06-21 | 코드리뷰 — 3레이어 적대 리뷰 + 트리아지 | decision 1(클라 라이브 리전 유지·문구 정렬) + patch 2(테스트 flaky·입력 하드닝) 적용, defer 1(감사 PII), 8 기각(거짓 양성 3 포함). 회귀 green(api 244·web 145). → **done** |

## Open Questions (개발 착수 전 확인 — 차단 아님)

1. **reveal 엔드포인트 스코프:** 본 스토리는 암호화 + 마스킹까지로 잡고 reveal(복호) 엔드포인트·UI는 첫 노출처(3.3 보호자 PII / Epic 4 진료 허브 배너)로 미뤘다. 만약 원무 환자 상세에서 RRN 표시가 3.1에 필요하면, reveal 엔드포인트(`POST /patients/{id}/reveal-rrn`, `patient.reveal_rrn` 게이트 + `decrypt_sensitive` 자가-감사)와 상세 페이지 `<PermissionGate>` 표시 컨트롤을 Task로 추가한다. (1.9가 패턴을 핸드오프했으므로 추가는 저비용.)
2. **chart_no 포맷:** 단순 8자리 zero-pad(`00000001`) vs 연도 프리픽스(`2026000001`). 실제처럼이 목표면 연도 프리픽스가 자연스러우나 운영 정책에 따름.
3. **RRN 필수 여부:** 현재 NOT NULL(등록 시 RRN 필수, 외국인등록번호 포섭)로 설계. 신원미상·무연고 환자 등 RRN-less 케이스가 필요하면 nullable + 부분 UNIQUE로 완화.

---
_Ultimate context engine analysis completed — comprehensive developer guide created._
