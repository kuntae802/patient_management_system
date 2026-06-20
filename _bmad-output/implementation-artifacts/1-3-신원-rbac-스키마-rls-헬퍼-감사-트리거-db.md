---
baseline_commit: 5952c88f1877e864631e77ea32d9045f0599166a
---

# Story 1.3: 신원·RBAC 스키마 · RLS 헬퍼 · 감사 트리거 (DB)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **백엔드 개발자**,
I want **직원 신원·역할·권한 테이블과 RLS 헬퍼 함수, append-only 감사 트리거를 Supabase CLI 마이그레이션으로 만들기를**,
so that **이후 모든 인증·인가·감사가 DB가 강제하는 단일 진실(single source of truth) 위에서 동작한다.**

이 스토리는 **Epic 1(플랫폼 기반·신원·접근 통제)의 DB 토대**다. 실제 SQL 마이그레이션이 처음으로 작성되는 지점이며(1.1은 `migrations/.gitkeep` 골격만 생성), 이후 1.4(로그인)·1.5(FastAPI RBAC)·1.6(UI 게이트)·1.7(권한 매트릭스)·1.8(직원 계정)·1.9(주민번호 암호화 reveal 감사)·1.10(감사 뷰어)이 모두 여기서 만든 테이블·함수·트리거를 소비한다.

[Source: epics.md#Epic-1 L317-321, #Story-1.3 L385-405]

---

## Acceptance Criteria

> 출처: epics.md L391-405 (BDD 원문). FR-210 / FR-240(헬퍼) / FR-242 / NFR-042 충족.

**AC1 — 신원·RBAC 스키마 (FR-210)**
**Given** 빈 스키마에서
**When** 마이그레이션 `0002_identity_rbac.sql`(`users`, `roles`, `permissions`, `role_permissions`)을 적용하면
**Then** 직원 = `users.id`(= auth uid), 역할 ↔ 권한 N:M(`리소스.동작` 코드)이 생성된다.

**AC2 — RLS 헬퍼 (FR-240 헬퍼)**
**Given** RBAC 테이블이 존재할 때
**When** `0003_rls_helpers.sql`로 `has_permission(code)` · `auth_user_role()`(둘 다 `SECURITY DEFINER`)를 만들면
**Then** RLS 정책이 조인 없이 권한을 평가할 수 있고, 환자/직원 경계의 RLS 토대가 선다.

**AC3 — 감사 append-only (FR-242, NFR-042)**
**Given** 감사 대상 작업이 발생할 때
**When** `0004_audit.sql`로 `audit_logs` + 트리거(`SECURITY DEFINER`, owner=postgres)를 만들고, UPDATE/DELETE를 **service_role 포함 전 역할에서 REVOKE(INSERT만 허용)** 하면
**Then** 행위자·시각·대상·동작과 **변경 전/후 스냅샷**이 기록되고, append-only가 강제된다.

**AC4 — 식별자 규율**
**And** 모든 enum·식별자는 **영문 snake_case**이며 **`docs/glossary.md`에 등재**된다.

### 추가 검증(완료 정의에 포함 — 위 AC의 운영적 해석)

- **AC5(선행 마이그레이션):** `0001_extensions.sql`이 존재하고 `pgcrypto`를 활성화한다(0002의 PK 기본값·다운스트림 1.9 암호화 프리미티브 선행). `supabase db reset`이 0001→0004 순서로 무오류 적용된다. [근거: §결정 D-1]
- **AC6(append-only 실증):** 적용된 DB에서 `UPDATE audit_logs ...` / `DELETE FROM audit_logs ...`를 service_role로 시도하면 **권한 오류로 거부**된다(권리 회수 + RLS 이중).
- **AC7(actor 캡처 계약):** 감사 트리거가 `current_setting('app.actor_id', true)` → `auth.uid()` 순으로 행위자를 캡처한다(service_role 쓰기 경로에서 NULL actor 방지 — §결정 D-3).
- **AC8(멱등성):** 각 마이그레이션은 재실행 안전(`CREATE ... IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`, `CREATE OR REPLACE FUNCTION`)하며 `supabase db lint` 통과.

---

## Tasks / Subtasks

> 커밋·푸시는 **승인 시에만**(project-context.md L76). 의미 단위(마이그레이션별)로 커밋 제안.

- [x] **Task 1 — `0001_extensions.sql` 작성 (AC5)**
  - [x] `supabase/migrations/0001_extensions.sql` 생성. `CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;`
  - [x] 헤더 주석: `gen_random_uuid()`는 PG13+ core(pg_catalog)라 확장 불필요지만, `hmac()`/`digest()`/`pgp_sym_*`는 1.9가 사용하므로 pgcrypto를 여기서 활성화함을 명시. **Vault 활성화 + 암복호 SECURITY DEFINER RPC는 Story 1.9가 별도 마이그레이션으로 추가**(이 파일을 사후 편집하지 말 것 — 마이그레이션 불변성). [§결정 D-1]
  - [x] `config.toml [api] extra_search_path=["public","extensions"]` 이미 설정됨 — 확장은 `extensions` 스키마에 설치(Supabase 관습). [Source: supabase/config.toml L15]

- [x] **Task 2 — `0002_identity_rbac.sql`: 4개 테이블 (AC1, AC4)**
  - [x] `roles`(역할), `permissions`(권한), `role_permissions`(역할_권한 N:M), `users`(직원 프로필) 생성. 컬럼·제약은 §데이터 모델 표를 그대로 따른다.
  - [x] `users.id`는 **기본값 없음** — `REFERENCES auth.users(id) ON DELETE CASCADE`(id = auth uid, 1.8이 채움). [§결정 D-2]
  - [x] **`users.department_id`는 FK 미부착**(plain `uuid` nullable) — `departments`는 `0005_masters`에서 생성되므로 FK는 0005가 추가. 0002에 FK 넣으면 적용 실패. [§결정 D-4 — DISASTER 방지]
  - [x] CHECK 제약: `employment_status IN ('active','on_leave','terminated')`, `license_type IN ('doctor','radiologist')` (nullable).
  - [x] 인덱스: `idx_<table>_<cols>` 규칙(§데이터 모델).
  - [x] **시드(멱등):** 6개 `roles`(reception/doctor/nurse/radiologist/admin/patient) + 권한 카탈로그 + 기본 grant(admin=전체). `INSERT ... ON CONFLICT (code) DO NOTHING`. [§결정 D-5 — 시드 위치·범위]
  - [x] glossary.md에 신규 식별자·enum 값 등재(§glossary 갱신).

- [x] **Task 3 — `0003_rls_helpers.sql`: SECURITY DEFINER 헬퍼 (AC2)**
  - [x] `auth_user_role()` → 현재 로그인 직원의 `roles.code` 반환(직원 아니면 NULL = 환자/비직원 경계). `SECURITY DEFINER`, `SET search_path = public`, `STABLE`.
  - [x] `has_permission(code text)` → boolean. 조인 없이? — 실제로는 `role_permissions⋈roles⋈permissions`를 1회 평가하되 RLS 정책 본문에서 재귀 RLS를 피하기 위해 `SECURITY DEFINER`로 우회. `SET search_path = public`, `STABLE`. [§함수 명세]
  - [x] **Supabase 린트 필수:** 모든 `SECURITY DEFINER` 함수에 명시적 `SET search_path` 필수(search_path 하이재킹 방지, linter `0011_security_definer_*`). [§GOTCHA]
  - [x] 실행 권한: `GRANT EXECUTE ON FUNCTION ... TO authenticated, service_role;`
  - [x] 4개 테이블에 `ENABLE ROW LEVEL SECURITY` + **최소 정책**(authenticated SELECT for `roles`/`permissions`/`role_permissions`; `users`는 본인 행 + service_role). 테이블별 상세·환자 정책은 `0014_rls_policies`로 이월. [§RLS 범위]

- [x] **Task 4 — `0004_audit.sql`: 감사 테이블·트리거·append-only (AC3, AC6, AC7)**
  - [x] `audit_logs` 생성(§데이터 모델 — `actor_id`는 `users`가 아니라 `auth.users(id)` 참조, 환자-actor 수용). [§결정 D-6 — DISASTER 방지]
  - [x] 제네릭 `audit_trigger_fn()`(`SECURITY DEFINER`, owner=postgres, `SET search_path = public`, `plpgsql`): TG_OP→action 매핑, 전/후 `to_jsonb` 스냅샷, `target_id = coalesce(to_jsonb(NEW)->>'id', to_jsonb(OLD)->>'id')`, actor = `coalesce(nullif(current_setting('app.actor_id', true),'')::uuid, auth.uid())`. [§함수 명세]
  - [x] **append-only 강제(이중):** ① RLS 정책 `FOR UPDATE USING (false)` + `FOR DELETE USING (false)`; ② `REVOKE UPDATE, DELETE ON audit_logs FROM authenticated, service_role, anon;` + `GRANT INSERT, SELECT ON audit_logs TO authenticated, service_role;`
  - [x] 1.3 소유 4개 테이블에 트리거 부착: `CREATE TRIGGER trg_<table>_audit AFTER INSERT OR UPDATE OR DELETE ON <table> FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();` (RBAC 변경·직원 계정 변경이 1.7/1.8에서 자동 감사되도록). 다른 엔티티는 각자 마이그레이션에서 부착.

- [x] **Task 5 — glossary.md 갱신 (AC4)**
  - [x] 신규 enum·식별자·GUC 등재(§glossary 갱신 표). 이미 있는 `user/role/permission/role_permission/audit_log`는 비고 보강만.

- [x] **Task 6 — 검증 (AC5·AC6·AC8)**
  - [x] `supabase db reset`로 0001→0004 클린 적용 + 멱등 재적용 확인. `supabase db lint` 통과.
  - [x] `api/tests/`에 마이그레이션 스모크 테스트(테이블·함수·트리거 존재, append-only 거부, 시드 카운트). [§테스트]

- [x] **Task 7 — 커밋 제안(승인 대기)**
  - [x] 마이그레이션 단위 커밋 메시지 초안(예: `feat(db): identity·RBAC 스키마 (0002) + RLS 헬퍼 (0003) + 감사 트리거 (0004)`). **푸시는 승인 후.**

### Review Findings

_코드 리뷰 2026-06-20 — 3레이어 적대적 리뷰(Blind Hunter · Edge Case Hunter · Acceptance Auditor). **Acceptance Auditor: AC1~8 · D-1~6 전부 PASS**(데이터모델·함수·스코프 정합 확인). 아래는 헌터가 발견한 코드 결함._

**Decision-needed (사용자 판단 필요)**

- [x] [Review][Decision] 헬퍼에 `employment_status='active'` 필터 추가? — `has_permission()`/`auth_user_role()`가 직원을 `id=auth.uid()`로만 조회해, `on_leave`/`terminated` 직원도 auth 계정이 살아있으면 역할·권한을 유지(방어심층 공백). 추가하면 휴직/퇴사자 권한이 DB단에서 즉시 차단되나, 휴직자 접근 정책·Story 1.8(재직상태 관리)과 교차 결정. [0003_rls_helpers.sql] (blind)
- [x] [Review][Decision] 감사 append-only를 owner/superuser 경로까지 강화? — 현 강제는 RLS+GRANT REVOKE라 spec 기준(service_role 포함 전 역할 차단, AC6)은 충족하나, 테이블 owner(postgres)/BYPASSRLS 직접 연결은 차단 못 함. 무조건 RAISE하는 BEFORE UPDATE/DELETE 트리거 추가 시 일반 DML 변조를 추가 차단(단 superuser는 트리거 비활성화 가능 — 완전 불변은 DB 범위 밖). [0004_audit.sql] (blind+edge)

**Patch (수정 가능 — 명확)**

- [x] [Review][Patch] [Critical] `app.actor_id` GUC 방어적 캐스팅 [supabase/migrations/0004_audit.sql:633] — 비어있지 않은 비-UUID 값이면 `::uuid` 캐스트가 AFTER 트리거 내부에서 예외 → 감사 대상 모든 INSERT/UPDATE/DELETE 트랜잭션 abort(자가 DoS). `nullif(...,'')`는 빈 문자열만 방어, 폴백 전에 캐스트가 터짐. UUID 형식 검증 후 실패 시 `auth.uid()` 폴백으로. (blind+edge 독립 corroborate)
- [x] [Review][Patch] [High] `audit_logs` 정책·GRANT 강화 [supabase/migrations/0004_audit.sql:656] — ① `authenticated` INSERT(`with check(true)`) 제거(트리거=SECURITY DEFINER owner라 불필요; 임의 actor·action 위조 표면), ② SELECT를 `using(true)` → `has_permission('audit.read')` 게이트(현재 모든 authenticated가 users PII 스냅샷 전체 열람 가능), ③ 명시적 `FOR UPDATE/DELETE USING(false)` deny 정책 추가(Task4 명세 문구 정합). (blind+edge+auditor)
- [x] [Review][Patch] [Medium] append-only 테스트 단언 강화 [api/tests/test_migrations_identity.py:258] — `"denied" in err`가 무관한 `set role` 실패("permission denied to set role")에도 통과 가능. 오류가 `audit_logs` UPDATE/DELETE 권한 거부임을 특정하고 제어 INSERT 성공을 확인. (blind+edge)
- [x] [Review][Patch] [Low] `create schema if not exists extensions;`를 pgcrypto 생성 전에 추가 [supabase/migrations/0001_extensions.sql:391] — 비-Supabase Postgres에서 `extensions` 스키마 부재 시 적용 실패 방지. (edge)
- [x] [Review][Patch] [Low] conftest 컨테이너 매칭을 전체 이름(`supabase_db_patient_management_system`)으로 [api/tests/conftest.py:40] — prefix만 매칭해 동일 호스트의 타 Supabase 프로젝트 DB를 잘못 선택할 수 있음(메모리: 동일 홈서버에 타 프로젝트 존재). (edge)

**Defer (이월 — 현재 비차단)**

- [x] [Review][Defer] 제네릭 `audit_trigger_fn`는 `id` 컬럼 없는 테이블에서 `target_id=NULL` 기록 [0004_audit.sql:643] — 1.3 테이블은 전부 `id` 보유라 무영향. 트리거 재사용(다운스트림 엔티티) 시 `id` 컬럼 계약 문서화/대응. deferred (blind+edge)
- [x] [Review][Defer] 테스트 하니스가 Supabase 스택 미가동 시 fail이 아닌 skip [conftest.py:79] — 관대 CI에서 회귀 은폐 가능. CI 강화(Post-MVP) 시 `REQUIRE_SUPABASE` env 게이트로 skip→fail 전환. deferred (edge)

**검증 중 추가 발견·수정 (P8)**

- [x] [Review][Patch] [Critical] `audit_logs.actor_id` FK 제거 — 패치 검증 중 발견: 유효 UUID지만 `auth.users`에 없는 actor(삭제된 사용자·레이스)면 `actor_id → auth.users` FK 위반으로 원본 쓰기 트랜잭션이 abort(D-3 위반의 FK 경로 재현). 또 `on delete set null`은 행위자 삭제 시 감사기록의 actor를 지워 포렌식을 훼손. → **actor_id를 비정규화 평문 uuid(FK 미부착)로 변경**(정석 감사로그 설계). 검증: 비-UUID·부재-UUID 모두 쓰기 성공 + actor 보존. D-6 → D-6'로 보정. [0004_audit.sql]

**Resolution (2026-06-20):** Decision 2건 모두 "추가" 선택 → patch 전환. **Patch 8건 전부 적용·검증**(`supabase db reset` 무오류 · `supabase db lint` 0 · pytest **21 passed**(+owner 트리거 차단 테스트) · ruff 클린). Defer 2건은 `deferred-work.md` 이월. Dismiss 4건 드롭.

---

## Dev Notes

### 핵심 마이그레이션 맵 (권위)

이 스토리는 아래 4개 파일을 만든다. 번호·소유는 architecture.md L310-323 + `migrations/.gitkeep`이 단일 진실.

| 파일 | 내용 | 본 스토리 |
|---|---|---|
| `0001_extensions.sql` | `pgcrypto` (gen_random_uuid은 core, vault는 1.9) | ✅ 생성 |
| `0002_identity_rbac.sql` | `users`, `roles`, `permissions`, `role_permissions` | ✅ 생성 |
| `0003_rls_helpers.sql` | `auth_user_role()`, `has_permission()` [SECURITY DEFINER] | ✅ 생성 |
| `0004_audit.sql` | `audit_logs` + 트리거 + append-only GRANT 회수 | ✅ 생성 |
| `0005_masters.sql` ~ `0014_rls_policies.sql` | 마스터·환자·내원·… 테이블별 RLS | ❌ 다운스트림 |

[Source: architecture.md#스키마-단일-소유 L308-323; supabase/migrations/.gitkeep]

> **마이그레이션은 번호 순서로 적용된다.** `0002`의 PK 기본값(`gen_random_uuid()`)·다운스트림이 `0001`을 전제하므로 **0001은 반드시 0002보다 먼저 존재**해야 한다. 그래서 본 스토리가 0001을 만든다(§결정 D-1).

### 데이터 모델 (컬럼·제약 — 이대로 작성)

> 출처: brainstorming-session-2026-06-17.md(26테이블 설계) + architecture.md L183-188 + glossary.md. 모든 식별자 영문 snake_case, 컬럼 timestamptz는 UTC 저장.

**`roles` (역할)**

| 컬럼 | 타입 | 제약 | 비고 |
|---|---|---|---|
| `id` | uuid | PK `default gen_random_uuid()` | |
| `code` | text | `UNIQUE NOT NULL` | `reception`/`doctor`/`nurse`/`radiologist`/`admin`/`patient` |
| `name` | text | NOT NULL | 한글 표시명(원무과/의사/간호사/방사선사/관리자/환자) |
| `description` | text | | |
| `created_at` | timestamptz | NOT NULL `default now()` | |
- 인덱스: `idx_roles_code`(UNIQUE 자동).

**`permissions` (권한)**

| 컬럼 | 타입 | 제약 | 비고 |
|---|---|---|---|
| `id` | uuid | PK `default gen_random_uuid()` | |
| `code` | text | `UNIQUE NOT NULL` | `리소스.동작`(예: `patient.read`) |
| `name` | text | NOT NULL | 한글 표시명 |
| `resource` | text | NOT NULL | `patient`/`encounter`/… (glossary 리소스) |
| `action` | text | NOT NULL | `read`/`create`/`update`/`delete`/`manage`/… |
| `created_at` | timestamptz | NOT NULL `default now()` | |
- 인덱스: `idx_permissions_code`(UNIQUE), `idx_permissions_resource_action`.

**`role_permissions` (역할_권한, N:M)**

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | uuid | PK `default gen_random_uuid()` |
| `role_id` | uuid | `NOT NULL REFERENCES roles(id) ON DELETE CASCADE` |
| `permission_id` | uuid | `NOT NULL REFERENCES permissions(id) ON DELETE CASCADE` |
| `created_at` | timestamptz | NOT NULL `default now()` |
- 제약: `UNIQUE(role_id, permission_id)`. 인덱스: `idx_role_permissions_role_id`, `idx_role_permissions_permission_id`.

**`users` (직원 프로필 — 분리 프로필 패턴)**

| 컬럼 | 타입 | 제약 | 비고 |
|---|---|---|---|
| `id` | uuid | **PK, 기본값 없음**, `REFERENCES auth.users(id) ON DELETE CASCADE` | = auth uid. 1.8이 계정 생성 시 채움 |
| `employee_no` | text | `UNIQUE NOT NULL` | 사번 |
| `name` | text | NOT NULL | 직원명 |
| `role_id` | uuid | `NOT NULL REFERENCES roles(id)` | 단일 역할(N:1) |
| `department_id` | uuid | **FK 미부착(0005가 추가)** nullable | 의사·방사선사 소속 진료과 |
| `license_no` | text | nullable | 면허번호 |
| `license_type` | text | `CHECK (license_type IN ('doctor','radiologist'))` nullable | |
| `phone` | text | nullable | 연락처 |
| `employment_status` | text | `NOT NULL default 'active' CHECK (... IN ('active','on_leave','terminated'))` | 재직/휴직/퇴사 |
| `hire_date` | date | nullable | 입사일 |
| `created_at` | timestamptz | NOT NULL `default now()` | |
| `updated_at` | timestamptz | NOT NULL `default now()` | |
- 인덱스: `idx_users_employee_no`(UNIQUE), `idx_users_role_id`, `idx_users_department_id`.
- ⚠️ `users.id`는 `gen_random_uuid()` **기본값을 주지 않는다** — auth uid를 그대로 받는 PK. [§결정 D-2]

**`audit_logs` (감사로그 — append-only)**

| 컬럼 | 타입 | 제약 | 비고 |
|---|---|---|---|
| `id` | uuid | PK `default gen_random_uuid()` | |
| `actor_id` | uuid | nullable, **FK 미부착(비정규화)** | 직원·환자 auth uid 또는 NULL(시스템). FK 제거 = 감사 회복력+삭제 후 보존 [§결정 D-6'] |
| `action` | text | `NOT NULL CHECK (action IN ('create','read','update','delete','login'))` | 트리거는 create/update/delete; read/login은 앱이 INSERT |
| `target_table` | text | NOT NULL | 대상 테이블명 |
| `target_id` | text | nullable | 대상 레코드 id(text — uuid/사람용번호 수용) |
| `before_data` | jsonb | nullable | 변경 전 스냅샷(update/delete) |
| `after_data` | jsonb | nullable | 변경 후 스냅샷(create/update) |
| `ip_address` | inet | nullable | FastAPI가 `app.actor_ip` GUC로 전달(선택) |
| `created_at` | timestamptz | NOT NULL `default now()` | 발생 시각(UTC) |
- 인덱스: `idx_audit_logs_actor_id`, `idx_audit_logs_target_table`, `idx_audit_logs_created_at`.

### 함수·트리거 명세

```text
-- 0003_rls_helpers.sql
auth_user_role() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  → SELECT r.code FROM users u JOIN roles r ON u.role_id=r.id WHERE u.id = auth.uid();
  (직원 아니면 NULL → 환자/직원 경계 판별의 1차 프리미티브)

has_permission(perm_code text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  → SELECT EXISTS(
        SELECT 1 FROM role_permissions rp
        JOIN permissions p ON rp.permission_id=p.id
        WHERE rp.role_id = (SELECT role_id FROM users WHERE id = auth.uid())
          AND p.code = perm_code);

-- 0004_audit.sql
audit_trigger_fn() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public  -- owner=postgres
  → action := create|update|delete (TG_OP)
    before_data := to_jsonb(OLD) (UPDATE/DELETE), after_data := to_jsonb(NEW) (INSERT/UPDATE)
    actor := coalesce(nullif(current_setting('app.actor_id', true),'')::uuid, auth.uid())
    target_id := coalesce(to_jsonb(NEW)->>'id', to_jsonb(OLD)->>'id')
    INSERT INTO audit_logs(...);  RETURN (NEW or OLD);
```

- **`STABLE`**: 헬퍼는 같은 트랜잭션 내 동일 입력에 동일 결과(플래너 최적화·RLS 평가 효율).
- **owner=postgres**: 마이그레이션은 postgres로 실행되므로 함수 owner는 자동 postgres. `SECURITY DEFINER`로 service_role 우회 INSERT가 RLS와 무관히 동작.

### 비자명 설계 결정 (DISASTER 방지 — 반드시 준수)

- **D-1 (0001 소유):** 본 스토리가 `0001_extensions.sql`을 만든다. epics 1.3 AC는 0002~0004만 명시하지만 마이그레이션 번호순 적용상 0001이 선행해야 하고, 1.9 AC의 "Given `0001_extensions.sql`"는 *전제*(이미 활성화됨)로 해석한다. 1.9는 0001을 재생성/편집하지 않고 **Vault + 암복호 RPC를 자기 마이그레이션으로 추가**한다. [epics.md L394·L519; architecture.md L310 "(vault)" 괄호]
- **D-2 (users.id):** `gen_random_uuid()` 기본값 금지. `id`는 auth uid PK, `REFERENCES auth.users(id) ON DELETE CASCADE`. 1.3는 `users` 행을 시드하지 않는다(auth 사용자 없음 — 1.8 책임). 따라서 1.3 테스트는 스키마/시드(roles·permissions)/append-only 위주, `has_permission` 행동 테스트는 사용자·JWT 필요분을 1.5 통합 테스트로 이월.
- **D-3 (actor 캡처 — CRITICAL):** 아키텍처상 **쓰기 = FastAPI(service_role)**. service_role 연결에는 JWT 컨텍스트가 없어 `auth.uid()`가 **NULL**을 반환 → 트리거가 모든 actor를 NULL로 기록하는 재앙. 해결: 트리거는 `current_setting('app.actor_id', true)`를 먼저 읽는다. **계약:** Story 1.5의 FastAPI는 각 트랜잭션 시작에 `SET LOCAL app.actor_id = '<jwt sub uid>'`(선택 `app.actor_ip`)를 설정해야 한다. 1.3는 이 GUC 규약을 확립하고 트리거에 fallback(`→ auth.uid()`)을 둔다. glossary·project-context에 GUC 등재. [architecture.md L106-107·L193]
- **D-4 (departments FK 순번):** `users.department_id`에 **0002에서 FK 부착 금지**(`departments`는 0005 생성). plain `uuid` nullable로 두고 FK는 0005_masters가 `ALTER TABLE ... ADD CONSTRAINT`로 추가. 0002에 넣으면 `relation "departments" does not exist`로 마이그레이션 실패. [architecture.md L314]
- **D-5 (시드 위치·범위):** roles(6) + 권한 카탈로그 + 기본 grant(admin=전체)는 **`seed.sql`이 아니라 `0002` 마이그레이션에 멱등 INSERT로** 넣는다. 이유: ① RBAC 구조 데이터는 스키마와 함께 버전관리되어 reset 없이도 항상 존재, ② `seed.sql`은 임상 마스터(EDI수가·약품·KCD)용 = Epic 2/Story 2.5 소유(seed.sql 헤더 명시). 권한 카탈로그는 **초기 버전**이며 리소스가 온라인될 때 에픽별 확장 가능. 역할별 grant의 관리자 UI(토글)는 **Story 1.7** 소유. [supabase/seed.sql L3-5; epics.md#Story-1.7 L469-489]
- **D-6 / D-6' (감사 actor — 비정규화, FK 미부착):** brainstorm은 `user_id FK→users`였으나 환자 actor를 거부해 부적합. 1차로 `actor_id→auth.users`로 잡았으나, **코드 리뷰 검증에서** 부재 UUID(삭제·레이스)가 FK 위반으로 원본 쓰기를 abort시키고(D-3 위반 재현) `on delete set null`이 행위자를 지워 포렌식을 훼손함을 확인 → **`actor_id uuid`(FK 미부착, 비정규화)** 로 최종 확정. 직원·환자 uid·시스템(NULL) 모두 수용하면서 감사 INSERT가 actor 때문에 깨지지 않고, 삭제 후에도 actor를 보존(정석 감사로그 설계). [glossary.md L17·L19; architecture.md L187]

### RLS 범위 (이 스토리에서 어디까지)

- 4개 테이블에 `ENABLE ROW LEVEL SECURITY`(방어심층 — service_role/FastAPI 쓰기에도 RLS 유지). [project-context.md L83]
- **최소 정책만** 작성: `roles`/`permissions`/`role_permissions` = authenticated SELECT 허용(1.6/1.7 UI 렌더용); `users` = 본인 행 SELECT(`id = auth.uid()`) + service_role 전권. **RLS 켜고 정책 없으면 authenticated에 deny-by-default(안전)** — service_role은 우회.
- **테이블별 상세·환자 소유 정책(`auth.uid()=patients.auth_uid` 등)은 `0014_rls_policies`로 이월**(architecture 미해결 결정 #4: "테이블별 RLS 정책 세부 — `0014` 작성 시"). 본 스토리에서 환자 정책을 만들지 말 것. [architecture.md L447]

### 테스트 (이 스토리 범위)

- 위치: `api/tests/`(pytest, project-context.md L63). DB 검증은 로컬 `supabase start` 스택(Postgres 17, `:54322`) 대상.
- 스모크 검증: ① 0001~0004 클린 적용 + 멱등 재적용(`supabase db reset` 2회), ② 4개 테이블·`audit_logs`·2개 헬퍼·`audit_trigger_fn` 존재, ③ **append-only 거부**(`UPDATE/DELETE audit_logs` → 권한 오류), ④ 시드 카운트(roles=6, permissions≥카탈로그, admin grant 존재), ⑤ 트리거 INSERT 동작(roles INSERT 후 audit_logs에 행 1건), ⑥ `supabase db lint` 통과(SECURITY DEFINER search_path 경고 0).
- ⚠️ `has_permission()`·`auth_user_role()`의 **행동(behavioral) 테스트**는 실제 auth 사용자 + JWT 컨텍스트가 필요 → **Story 1.5 통합 테스트로 이월**(1.3는 users 행을 시드하지 않으므로). 골든패스 E2E·커버리지 게이트는 Post-MVP(과도 명세 금지). [project-context.md L65]

### Project Structure Notes

- 생성/수정 파일:
  - `supabase/migrations/0001_extensions.sql` (NEW)
  - `supabase/migrations/0002_identity_rbac.sql` (NEW)
  - `supabase/migrations/0003_rls_helpers.sql` (NEW)
  - `supabase/migrations/0004_audit.sql` (NEW)
  - `docs/glossary.md` (UPDATE — 신규 식별자·enum·GUC 등재)
  - `api/tests/` (NEW — 마이그레이션 스모크 테스트)
  - `supabase/migrations/.gitkeep` 유지(이미 계획 주석 보유). `supabase/seed.sql`은 **수정하지 않음**(RBAC 시드는 0002로).
- 절대 금지(스키마 단일 소유): FastAPI/Python에서 DDL 생성, Alembic 사용, Supabase Studio GUI로 스키마 수동 편집. DDL·RLS·트리거·pgcrypto는 `supabase/migrations/*.sql`만. [project-context.md L48·L77; architecture.md L108-110]
- TS 타입(`web/src/types/database.types.ts`)은 본 스토리 산출물이 아님 — 마이그레이션 후 `supabase gen types`로 다운스트림 생성(웹이 소비하는 시점). 손으로 만들지 말 것.

### glossary.md 갱신 (등재 후 사용 — AC4)

이미 존재: `user/role/permission/role_permission/audit_log/resident_no`. **추가 등재할 항목:**

| 항목 | 값/시그니처 | 비고 |
|---|---|---|
| role codes | `reception`·`doctor`·`nurse`·`radiologist`·`admin`·`patient` | glossary L20 "6역할" 구체화 |
| `employment_status` (enum/CHECK) | `active`(재직)·`on_leave`(휴직)·`terminated`(퇴사) | users |
| `license_type` (CHECK) | `doctor`(의사)·`radiologist`(방사선사) | users, nullable |
| audit `action` (CHECK) | `create`·`read`·`update`·`delete`·`login` | audit_logs |
| permission code 형식 | `<resource>.<action>` (예: `patient.read`, `rbac.manage`) | resource는 glossary 엔티티명 |
| `has_permission(code)` / `auth_user_role()` | RLS 헬퍼(SECURITY DEFINER) | 헬퍼 규칙 L10 구체화 |
| `app.actor_id` (GUC) | FastAPI가 `SET LOCAL`로 트랜잭션 actor 주입 | 감사 actor 캡처 계약(§D-3) |

### References

- [Source: epics.md#Epic-1 L317-321] — 에픽 목표 + 범위 노트(헬퍼·트리거는 토대, 테이블별 적용은 해당 에픽)
- [Source: epics.md#Story-1.3 L385-405] — 사용자 스토리 + BDD AC 원문(0002/0003/0004 명시)
- [Source: epics.md#Story-1.9 L511-529] — 0001_extensions 전제 + Vault/암복호 RPC 경계
- [Source: architecture.md#마이그레이션-맵 L308-323] — 0001~0014 권위 맵 + 각 파일 내용
- [Source: architecture.md#핵심결정 L183-188] — 분리 프로필·RBAC 3계층·RLS 전략·감사 append-only·pgcrypto 경계
- [Source: architecture.md#네이밍 L244-250] — DB 식별자 규칙(테이블/PK/FK/enum/idx/trg/rpc/helper)
- [Source: architecture.md#RLS태도 L106-107] — service_role + RLS 방어심층
- [Source: architecture.md#미해결결정 L446-447] — 상태전이표=0007, RLS 세부=0014 이월
- [Source: brainstorming-session-2026-06-17.md] — 26테이블 설계(신원·역할·권한·역할_권한·감사로그 컬럼)
- [Source: docs/glossary.md] — 영문↔한글 단일 진실, 엔티티·식별번호·민감정보·enum
- [Source: docs/project-context.md L48·L57·L70·L76·L83-84] — 무ORM/Alembic금지·RBAC·식별자언어·커밋규율·보안MUST·PII경계
- [Source: supabase/migrations/.gitkeep] — 마이그레이션 순번 계획 주석
- [Source: supabase/config.toml L42·L15] — Postgres major_version=17, extra_search_path
- [Source: supabase/seed.sql L3-5] — seed.sql = Epic2/Story2.5 임상 마스터 소유

---

## Dev Agent Record

### Context Reference

이전 스토리 1.1·1.2의 확정 규약(반드시 상속):
- **Supabase 로컬 스택:** Postgres 17(`config.toml major_version=17`), DB `:54322`, Studio `:54323`. `supabase start`/`supabase db reset`로 마이그레이션+seed 적용. [1.1 Dev Notes; config.toml]
- **마이그레이션 디렉토리:** `supabase/migrations/`에 `0001~0014` 순번 계획만 존재(`.gitkeep`), 실제 SQL은 본 스토리가 처음 작성. [1.1 §Task2]
- **키 체계:** 신규 `*_PUBLISHABLE_KEY`/`*_SECRET_KEY` 통일. 키·`.env`는 절대 커밋 금지(gitignored). [1.1 Dev Notes; .env.example]
- **API 연결(다운스트림 1.5):** `core/db.py`는 asyncpg 풀 stub(`# TODO`), `core/security.py`는 JWKS+`has_permission` 의존성 stub(`# TODO(Story 1.5)`). 본 스토리는 이 함수들이 호출할 **DB측 `has_permission`을 만든다**. [api/app/core/db.py·security.py]
- **에러 봉투·snake_case:** `{error:{code,message,detail}}`, JSON 전 경로 snake_case(camelCase 변환 금지). [project-context.md L51·L71]
- **deferred-work 연관:** config 약한 auth 기본값(`minimum_password_length=6` 등)은 **1.4 하드닝** 대상 — 본 스토리는 `config.toml [auth]`를 건드리지 않는다(스키마만). `SUPABASE_*` env fail-fast는 **1.5**. [deferred-work.md]
- **CI:** `.github/workflows/ci.yml`의 `supabase db lint` 게이트는 현재 관대(`|| true`)하나, 본 스토리 마이그레이션은 lint 클린이어야 함. [deferred-work.md]
- **커밋 규율:** 의미 단위 단계별 커밋, **커밋·푸시는 승인 시에만**. [project-context.md L76; 1.1·1.2 패턴]

### Agent Model Used

claude-opus-4-8[1m] (Claude Opus 4.8, 1M context) — BMad dev-story 워크플로

### Debug Log References

- `supabase db reset` — 0001~0004 클린 적용. `.gitkeep` 스킵(정상), pgcrypto already exists 스킵(멱등), `drop ... if exists` 가드의 NOTICE(첫 적용이라 no-op, 정상).
- `supabase db lint` — `{"results":[],"message":"db lint"}` → **스키마 오류·경고 0**(SECURITY DEFINER search_path 충족).
- `uv run pytest` — 신규 19 + 기존 health 1 = **20 passed**(starlette httpx deprecation 경고는 기존, 무관).
- `uv run ruff check tests/` — All checks passed.
- 시드 실측: roles=6, permissions=23, admin grants=23, SECURITY DEFINER 헬퍼=3, 감사 트리거=4.
- 테스트 파싱 수정 1건: 다중 문장 psql 출력의 `ROLLBACK` 커맨드 태그 때문에 카운트 파싱을 숫자 줄 필터로 변경(마이그레이션 로직과 무관, 테스트 하니스 버그).

### Completion Notes List

구현 요약 — 4개 Supabase CLI 마이그레이션 + glossary 갱신 + 스모크 테스트 하니스.

- **0001_extensions.sql**: pgcrypto 활성화(멱등). Vault·암복호 RPC는 Story 1.9 경계로 주석 명시.
- **0002_identity_rbac.sql**: `roles`·`permissions`·`role_permissions`·`users` 4테이블 + 제약/인덱스 + 명시적 GRANT posture(auto_expose off 대응: 쓰기=service_role, 읽기=authenticated SELECT, anon 차단) + 부트스트랩 시드(역할 6 · 권한 카탈로그 23 · admin=전체 grant, 모두 멱등).
  - 설계 결정 준수: `users.id` 기본값 없음 + `auth.users(id)` FK(D-2); `users.department_id` **FK 미부착**(departments=0005, D-4); CHECK(employment_status·license_type).
- **0003_rls_helpers.sql**: `auth_user_role()`·`has_permission(code)` SECURITY DEFINER + `set search_path = public`(하이재킹 방지) + `(select auth.uid())` initplan 패턴. 4테이블 RLS 활성화 + 최소 SELECT 정책(roles/permissions/role_permissions=authenticated, users=본인 행). 환자/테이블별 상세 정책은 0014 이월.
- **0004_audit.sql**: `audit_logs`(actor_id→**auth.users**, 환자-actor 수용 D-6) + 제네릭 `audit_trigger_fn()`(전/후 jsonb 스냅샷, actor=`app.actor_id` GUC→`auth.uid()` 폴백 D-3) + append-only 이중강제(RLS INSERT/SELECT만 + 전 역할 UPDATE/DELETE REVOKE) + 4테이블 트리거 부착.
- **docs/glossary.md**: 역할 코드·employment_status·license_type·audit action enum·헬퍼·`app.actor_id` GUC·권한 카탈로그 정책 등재.

AC 충족: AC1✅(0002) AC2✅(0003) AC3✅(0004) AC4✅(glossary) AC5✅(db reset 0001→0004 무오류·멱등) AC6✅(service_role UPDATE/DELETE 거부 테스트) AC7✅(actor 캡처 계약) AC8✅(db lint 통과·멱등).

이월(다운스트림): `has_permission`/`auth_user_role` 행동 테스트는 auth 사용자+JWT 필요 → Story 1.5 통합 테스트. 테이블별·환자 RLS 정책 → 0014. Vault·암복호 RPC → 1.9. `users.department_id` FK → 0005. FastAPI의 `set local app.actor_id` 주입 → 1.5.

### File List

- `supabase/migrations/0001_extensions.sql` (NEW)
- `supabase/migrations/0002_identity_rbac.sql` (NEW)
- `supabase/migrations/0003_rls_helpers.sql` (NEW)
- `supabase/migrations/0004_audit.sql` (NEW)
- `docs/glossary.md` (UPDATE)
- `api/tests/conftest.py` (NEW)
- `api/tests/test_migrations_identity.py` (NEW)

## Change Log

| 날짜 | 변경 | 작성 |
|---|---|---|
| 2026-06-19 | Story 1.3 구현 — 신원·RBAC 스키마(0002)·RLS 헬퍼(0003)·append-only 감사(0004)·확장(0001) 마이그레이션 + glossary 등재 + 스모크 테스트(20 passed, db lint 0). Status → review | dev-story (Opus 4.8) |
| 2026-06-20 | 코드 리뷰(3레이어) 후속 — patch 8건 적용: actor_id GUC 방어 캐스팅·audit_logs 정책/GRANT 강화·BEFORE RAISE 트리거·헬퍼 active 필터·extensions 스키마 가드·conftest 컨테이너 매칭·테스트 단언 강화·**actor_id FK 제거(검증 중 발견한 자가-DoS)**. 21 passed, lint·ruff 0. Status → done | code-review (Opus 4.8) |
