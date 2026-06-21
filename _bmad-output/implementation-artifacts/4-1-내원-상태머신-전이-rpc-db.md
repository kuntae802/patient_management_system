---
baseline_commit: 4872f003d18464e831b0742caf27e3e4d8df94ea
---

# Story 4.1: 내원 상태머신 · 전이 RPC (DB)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 백엔드 개발자,
I want 내원(encounter) 상태와 전이 규칙을 DB가 강제하도록 만들기를,
so that 역행·건너뛰기·종결상태 재전이 없이 내원 파이프라인(접수→진찰→완료 + 취소/노쇼)의 워크플로우 무결성이 보장되고, 오더(Epic 5)·수납(Epic 7)이 이 상태머신 위에 안전하게 연결된다.

## Acceptance Criteria

1. **AC1 — encounters 허브 테이블 + 상태 어휘(CHECK) + 초기상태 가드 (FR-020, NFR-040, NFR-060):** `0010_encounters.sql`로 `encounters` 테이블을 만들되 상태 컬럼을 **`status text not null default 'registered' check (status in ('scheduled','registered','in_progress','completed','cancelled','no_show'))`** 로 정의하면(⚠️ **`CREATE TYPE ... AS ENUM` 금지** — 이 프로젝트는 전부 text+CHECK, §재사용 자산), 정의된 6개 상태 어휘만 저장된다. **초기상태 가드**(BEFORE INSERT 트리거)로 신규 내원은 `scheduled`(예약, Epic 6) 또는 `registered`(walk-in, MVP)로만 생성되고 `completed`/`in_progress` 등 비정상 초기상태 직접 생성은 차단된다. 테이블은 임상기록(4.6)·오더(Epic 5)·수납(Epic 7)이 매다는 **허브**로서 `id`·`encounter_no`·`patient_id`·`department_id`·전이 타임스탬프를 보유한다(§스키마 설계).
2. **AC2 — 전이 RPC + 전이 강제 트리거(역행·건너뛰기 차단 → 409) (FR-020, NFR-040):** 전이 RPC **`register_encounter`·`start_consult`·`complete_encounter`**(+ `cancel_encounter`·`mark_no_show`)와 **BEFORE INSERT/UPDATE 전이 트리거**(`enforce_encounter_transition`)를 만들면, §전이 매트릭스에 정의된 전이만 허용되고 **역행·건너뛰기·종결상태(completed/cancelled/no_show) 재전이는 SQLSTATE `PT409`로 거부**된다. 이 거부는 소비 계층(4.2/4.4)이 **HTTP 409 `ConflictError`("잘못된 상태 전이입니다.")** 로 매핑한다(매핑 계약은 §에러 계약 — 이 스토리는 DB 레벨에서 `PT409` 발생을 보증, HTTP 변환은 4.2/4.4). 권한 미보유 호출은 RPC 내부 `has_permission()` 게이트가 `insufficient_privilege`(42501)로 차단(→ 403).
3. **AC3 — 취소·노쇼·부분수행 경로 + full transition matrix + 전이 감사 (이월 갭 ⑥, FR-118/119):** 취소(`scheduled|registered`→`cancelled`)·노쇼(`scheduled`→`no_show`) 경로가 상태머신에 명시되고, **부분수행은 신규 상태가 아니라 `in_progress`→`completed` 후 Epic 7이 수행분만 정산(FR-119)** 임이, 취소·노쇼의 **수가 미발생 정산은 Epic 7(FR-118) 소유** 임이 §이월 갭 ⑥에 문서화된다. full transition matrix(§전이 매트릭스)가 확정되고, **INSERT를 포함한 모든 전이가 `trg_encounters_audit`**(0004 `audit_trigger_fn` 재사용)로 actor와 함께 append-only 감사 기록된다.

> **이월 인수 조건(Epic 1~3 만기 — 이 스토리에서 반드시 충족):** ① **마이그레이션 번호 = `0010_encounters.sql`** — 에픽/아키텍처 원문의 stale `0007_encounters` 무시(실제 적용분 0001~0009 다음). 작업 후 `docs/glossary.md` blockquote로 확정(번호 드리프트 = 회고 "영구 세금"). ② 전이 RPC는 **`SECURITY DEFINER` + `set search_path = public`** 이며, RPC 내부 `has_permission()` 게이트가 곧 **동일 트랜잭션 권한 재평가(TOCTOU 차단, 1.5/3.1 이월)** — 쓰기는 service_role(FastAPI)·SECURITY DEFINER RPC만, `authenticated` 직접 쓰기 정책 없음. ③ 감사 트리거 **`id` 컬럼 계약**(encounters PK=`id uuid`) 충족 + **encounters에 raw PII·건강민감 자유텍스트 컬럼을 두지 않음**(주호소·임상기록=4.6 SOAP) → 감사 스냅샷 PII 마스킹(3.6) 드리프트 무유발. 상세는 Dev Notes §이월 인수 참조.

## Tasks / Subtasks

- [x] **Task 1 — DB 마이그레이션 `supabase/migrations/0010_encounters.sql` (AC1, AC2, AC3)**
  - [x] 1.1 파일 헤더(관례): `-- 0010_encounters.sql — encounters(내원 허브) + 상태머신(CHECK·전이 트리거·전이 RPC) + RLS·감사` + `Story 4.1 / FR-020·FR-118·FR-119 / NFR-040(상태 무결성)·NFR-060(허브 확장)` + 의존성 줄(`-- 의존: 0001(gen_random_uuid), 0002(users·encounter 권한 시드), 0003(has_permission), 0004(audit_trigger_fn), 0006(departments·rooms), 0009(patients)`) + **번호 드리프트 ⚠️ 주석**(에픽 `0007_encounters` stale → 실제 0010, 0009 다음).
  - [x] 1.2 `create sequence if not exists public.encounters_encounter_no_seq;` (사람용 내원번호 race-free 부여, `patients_chart_no_seq` 미러).
  - [x] 1.3 `encounters` 테이블 생성(§스키마 설계 컬럼 표 그대로): `id uuid pk default gen_random_uuid()`, `encounter_no text not null unique default lpad(nextval('public.encounters_encounter_no_seq')::text, 8, '0')`, `patient_id uuid not null references public.patients(id)`, `department_id uuid not null references public.departments(id)`, `room_id uuid references public.rooms(id)`, `doctor_id uuid references public.users(id)`, `visit_type text not null check (visit_type in ('walk_in','reserved'))`, `status text not null default 'registered' check (status in ('scheduled','registered','in_progress','completed','cancelled','no_show'))`, `cancel_reason text`(운영 사유·저민감), 전이 타임스탬프 5종(`registered_at`/`consult_started_at`/`completed_at`/`cancelled_at`/`no_show_at` timestamptz, **nullable** — RPC가 기록), `created_by uuid references public.users(id)`, `is_active boolean not null default true`, `created_at`/`updated_at timestamptz not null default now()`. ⚠️ **주호소(chief_complaint)·임상기록 등 PII/건강민감 자유텍스트 컬럼 추가 금지**(4.6 SOAP 소유 — §감사 경계).
  - [x] 1.4 인덱스: `idx_encounters_patient_id`, `idx_encounters_department_id`, `idx_encounters_status`, `idx_encounters_dept_status on public.encounters (department_id, status)`(대기판/대기열 조회·4.3/4.4 소비). (`encounter_no` unique 는 컬럼 default 로 부여됨.)
  - [x] 1.5 **전이 강제 트리거** `enforce_encounter_transition()`(plpgsql, **SECURITY DEFINER 아님** — old/new 비교·raise 만, `audit_logs_block_mutation` 선례) + `create trigger trg_encounters_transition before insert or update on public.encounters for each row execute function ...`. INSERT=초기상태 가드(scheduled|registered만), UPDATE=§전이 매트릭스 강제, 위반 시 `raise exception ... using errcode = 'PT409'`. (§전이 트리거 코드 참조)
  - [x] 1.6 **전이 RPC 5종** 작성(전부 `language plpgsql security definer set search_path = public`, `returns public.encounters`, §전이 RPC 사양): `register_encounter`(scheduled→registered, perm `encounter.register`, set `registered_at`)·`start_consult`(registered→in_progress, perm `encounter.start`, set `consult_started_at` + `doctor_id = (select auth.uid())`)·`complete_encounter`(in_progress→completed, perm `encounter.complete`, set `completed_at`)·`cancel_encounter(p_id uuid, p_reason text)`(scheduled|registered→cancelled, perm `encounter.cancel`, set `cancelled_at`·`cancel_reason`)·`mark_no_show`(scheduled→no_show, perm `encounter.no_show`, set `no_show_at`). 각 RPC: ① `has_permission('<perm>')` 미보유→`insufficient_privilege` raise(403); ② `select ... for update` not found→`PT404` raise(404); ③ `update ... set status=..., <ts>=now(), updated_at=now()` (전이 유효성은 트리거가 최종 강제 — RPC는 매트릭스 재구현 금지); ④ 갱신 행 반환. (§전이 RPC 코드 참조)
  - [x] 1.7 **권한 카탈로그 확장**(0002 컨벤션 — "리소스 온라인 시 에픽 마이그레이션이 확장"): `insert into public.permissions (code, name, resource, action) values ('encounter.read','내원 조회','encounter','read'), ('encounter.cancel','내원 취소','encounter','cancel'), ('encounter.no_show','노쇼 처리','encounter','no_show') on conflict (code) do nothing;` + **admin 부트 grant**(신규 권한만, 0002 cross-join 패턴 멱등). (register/start/complete 는 0002 에 이미 시드 — 재시드 금지. 비-admin grant 는 Story 1.7 매트릭스 UI 소관.)
  - [x] 1.8 **RLS 인라인**(별도 `0014` 파일 금지 — 0006/0009 관례): `alter table public.encounters enable row level security;` + `encounters_select_staff`(`(select public.has_permission('encounter.read'))`) + `encounters_select_self`(patient_id → patients.auth_uid EXISTS, `guardians_select_self` 미러) + **쓰기 정책 없음**(authenticated 직접 쓰기 거부).
  - [x] 1.9 **GRANT posture**(0002 패턴): `revoke all on public.encounters from anon, authenticated;` → `grant select, insert, update, delete on public.encounters to service_role;` → `grant usage on sequence public.encounters_encounter_no_seq to service_role;` → `grant select on public.encounters to authenticated;`(민감 컬럼 없음 → 테이블 단위, RLS 행 게이트) → **`grant execute on function public.<rpc>(...) to authenticated, service_role;`**(5종 — RPC 자체 게이트로 안전 + DB 테스트가 authenticated 로 호출, has_permission 그랜트 선례).
  - [x] 1.10 **감사 트리거 부착**(0004 재사용): `drop trigger if exists trg_encounters_audit on public.encounters; create trigger trg_encounters_audit after insert or update or delete on public.encounters for each row execute function public.audit_trigger_fn();`. (`id` 컬럼 계약 충족 주석.)
- [x] **Task 2 — `docs/glossary.md` 갱신 (AC1, AC3)**
  - [x] 2.1 **마이그레이션 번호 확정 blockquote** 추가: `> (Story 4.1 확정) 0010_encounters.sql = encounters + 상태머신(전이 트리거·RPC) + RLS·감사. 에픽 본문의 0007_encounters 는 stale.`
  - [x] 2.2 신규 식별자 등재(§glossary 갱신 표): 전이 RPC 5종(`register_encounter`/`start_consult`/`complete_encounter`/`cancel_encounter`/`mark_no_show`), 트리거(`trg_encounters_transition`/`trg_encounters_audit`), 함수(`enforce_encounter_transition`), 신규 권한(`encounter.read`/`encounter.cancel`/`encounter.no_show`), 컬럼 식별자(`visit_type`·`doctor_id`·전이 타임스탬프 5종·`cancel_reason`·`created_by`), 시퀀스(`encounters_encounter_no_seq`), 커스텀 SQLSTATE `PT409`/`PT404`. (`encounter_status` 6값·`encounter_no`·`encounter` 엔티티는 이미 등재 — 변경 없음.)
- [x] **Task 3 — DB 레벨 통합 테스트 `api/tests/test_encounters_db.py` (AC1, AC2, AC3)**
  - [x] 3.1 `conftest.py` `psql` 세션 픽스처 재사용(docker exec psql, 미가동 시 skip). 셋업: 시드 진료과(`departments` code `IM`) 사용 + **테스트 환자 1건 생성**(`encrypt_sensitive`/`blind_index` 경유 — `SUPABASE_SECRET_KEY` 설정 시에만, 미설정 시 skip; 3.1 패턴) → `patient_id` 확보. 임시행은 `try`/`finally` CASCADE 정리(2.6 패턴).
  - [x] 3.2 **초기상태 가드(AC1):** `insert ... status='completed'` → `PT409` 실패, `status='registered'`/`'scheduled'` → 성공. `encounter_no` 부여·unique·zero-pad 확인.
  - [x] 3.3 **합법 전이(AC2):** RPC 호출로 scheduled→registered→in_progress→completed 성공 + 각 타임스탬프 기록 확인. `start_consult` 후 `doctor_id` 세팅 확인. (호출 전 `set local role authenticated` + `set_config('request.jwt.claims', ...)` + `set_config('app.actor_id', ...)`.)
  - [x] 3.4 **불법 전이(AC2):** 직접 `update status` 와 잘못된 RPC 양쪽 — scheduled→completed·scheduled→in_progress·registered→completed·in_progress→registered(역행)·completed→cancelled(종결 재전이) → 전부 `PT409`. `psql.expect_error()` + **에러 특정성**(sqlstate `PT409` 또는 "invalid ... transition" 문자열 — `"denied" in err` 류 비특정 단언 금지, 1.3 P3 교훈).
  - [x] 3.5 **취소·노쇼(AC3):** scheduled→cancelled·registered→cancelled(`cancel_encounter`, `cancel_reason` 영속)·scheduled→no_show(`mark_no_show`) 성공. registered→no_show·in_progress→cancelled → `PT409`(매트릭스 외).
  - [x] 3.6 **권한 게이트(AC2):** `encounter.start` 미보유 계정(시드 `doctor@pms.local` — 기본 grant 없음)으로 `start_consult` → `insufficient_privilege`(403 매핑). `admin@pms.local`(전권) → 성공.
  - [x] 3.7 **전이 감사(AC3):** 커밋된 전이 후 `select count(*) from audit_logs where target_table='encounters' and target_id='<id>' and action='update'` ≥1 + `actor_id` = 호출자 uid + `before_data->>'status'` ≠ `after_data->>'status'`. INSERT 는 `action='create'` 기록.
  - [x] 3.8 **RLS 경계(AC1):** `encounter.read` 보유(admin) authenticated → 행 수신; 본인 환자(auth_uid 매칭, doctor uid 가장 — 3.1 FK 함정 회피) → patient_id 경유 본인 내원만; service_role → 전체; anon → 0행/거부.

### Review Findings

_코드리뷰 2026-06-21 (Blind Hunter / Edge Case Hunter / Acceptance Auditor 3레이어 병렬, 실패 레이어 0). 교차검증으로 다수 추측성/저신뢰 항목 기각: Blind 의 "0010 이 admin register/start/complete grant 자급 안 함"(0002 cross-join 이 admin 전권 — 테스트 통과로 확인)·"start_consult auth.uid() NULL → doctor_id NULL"(has_permission 게이트가 NULL uid 를 먼저 403 차단 → 도달 불가)·"service_role GUC 미주입 403"(authenticated_conn 항상 주입 = 의도된 방어)·mark_no_show 의 cancel_reason 오버로드(컬럼 주석이 "취소/노쇼 양용" 문서화)·encounter_no 8자리 오버플로(비현실)·ON DELETE FK(patients soft-delete 선례 동일)·Acceptance Auditor 2건(모두 문서화된 의도적 결정·실효 동등) = 전부 dismiss._

- [x] [Review][Patch] 전이 RPC 5종에 소스 상태 선검사 추가 — 동일상태 재호출이 side-effect 와 함께 성공(NFR-040 재수행 차단 갭) [supabase/migrations/0010_encounters.sql register_encounter/start_consult/complete_encounter/cancel_encounter/mark_no_show] — 전이 트리거의 `if new.status = old.status then return new`(비-상태 컬럼 갱신 허용 목적)가 same-status 를 통과시켜, 이미 `in_progress` 인 내원에 `start_consult` 재호출 시 트리거가 막지 못하고 `doctor_id=auth.uid()`·`consult_started_at=now()` 를 **덮어쓴다**(둘째 의사가 진료를 "탈취"). 5종 모두 동일(재호출이 타임스탬프/cancel_reason 리셋). RPC 는 매트릭스를 트리거에 위임하나 same-status no-op 은 트리거 사각 → **각 RPC 가 `select for update` 후 소스 상태 precondition 을 명시 검사**(불일치 시 PT409)해 재수행·잘못된 상태 호출을 차단. 트리거는 직접 update 백스톱으로 유지. [blind+edge] — **적용(2026-06-21):** RPC 5종에 소스 상태 precondition(register=scheduled·start=registered·complete=in_progress·cancel∈{scheduled,registered}·no_show=scheduled, 불일치→PT409) 추가 + 재호출 거부 테스트(`test_rpc_recall_on_same_status_rejected`) 추가. db reset + 전체 311 passed/9 skipped, ruff clean.
- [x] [Review][Defer] soft-delete(`is_active`) 미반영 — 전이 트리거·RLS·INSERT 가 `is_active` 무시(비활성 환자/폐과 내원 생성·비활성 내원 전이·포털 노출 무차단) [supabase/migrations/0010_encounters.sql] — deferred, 스토리 Dev Notes 명시 이월(patients 0009 동일 패턴·교차절단). [blind+edge]
- [x] [Review][Defer] 환자 포털 컬럼 노출 — `encounters_select_self` + 테이블 단위 `grant select to authenticated` 로 본인 내원의 `cancel_reason`(자유텍스트)·`doctor_id`/`created_by`(내부 uuid) 전 컬럼 노출(컬럼 화이트리스트 부재) [supabase/migrations/0010_encounters.sql] — deferred, 포털 소비처 Epic 8 가 컬럼 투영·제한(스코프 OUT). [blind+edge]
- [x] [Review][Defer] walk-in `registered_at`·`created_by` 미충전 — walk-in 은 4.2 가 직접 INSERT(register_encounter RPC 미경유)하므로 `registered_at`(대기시간 메트릭 근거)·`created_by`(접수 직원)가 NULL [supabase/migrations/0010_encounters.sql] — deferred, 4.2 walk-in 생성이 INSERT 시 충전(handoff). [edge]
- [x] [Review][Defer] hard delete(service_role) 상태머신 우회 — `grant delete to service_role` + 전이 트리거 DELETE 미처리로 종결 안 된 내원 물리삭제 가능(audit_logs 의 block-mutation 같은 가드 없음) [supabase/migrations/0010_encounters.sql] — deferred, patients 0009 선례 동일(child FK RESTRICT 도래 시 보호)·교차절단. [blind+edge]
- [x] [Review][Defer] `cancel_reason` 자유텍스트 감사 유입 — 민감내용 입력 시 audit before/after 에 평문 적재되나 3.6 마스킹 집합은 encounters 를 비민감 처리 [supabase/migrations/0010_encounters.sql] — deferred, 민감 판명 시 마스킹 집합 등재 or 4.2/4.4 코드화 입력검증(드리프트 가드). [edge]
- [x] [Review][Defer] 동시성·전이쌍 전수·service_role role 컨텍스트 테스트 부재 — `for update` 동시 전이 검증 0건, 36쌍 중 8쌍 표본, 테스트가 postgres 슈퍼유저 컨텍스트로 RPC 호출(EXECUTE grant·service_role 경로 미검증) [api/tests/test_encounters_db.py] — deferred, 동시성 하드닝 묶음 명시 이월(has_permission 게이트는 role 무관하게 검증되어 권한 테스트 유효). [edge]

## Dev Notes

### 스코프 (이 스토리가 하는 것 / 안 하는 것)

**IN (4.1, 순수 DB 토대 — 1.3 선례):** `0010_encounters.sql`(encounters 허브 테이블 + 상태 어휘 CHECK + 초기상태 가드 + 전이 강제 트리거 + 전이 RPC 5종 + RLS 인라인 + 감사 트리거 + 신규 권한 시드 + encounter_no 시퀀스 + 인덱스) · `docs/glossary.md` 갱신 · **DB 레벨 pytest 통합 테스트**(psql — 상태머신·권한·감사·RLS) · 에러 계약(`PT409`→409) 문서화.

**OUT (후속 스토리 — 4.1 은 토대만; 소비처가 빌드):**
- **전이 RPC를 호출하는 FastAPI 액션 엔드포인트** `POST /encounters/{id}/register|start-consult|complete|cancel|no-show` + `core/db.py` asyncpg 래퍼 + **`PT409`/`PT404`/`42501` → `ConflictError`/`NotFoundError`/`ForbiddenError` SQLSTATE 매핑** → **Story 4.2**(register, walk-in 생성)·**4.4**(start_consult)·**Epic 7/6**(complete·cancel·no_show). 4.1 은 HTTP 레이어를 만들지 않는다(1.3=DB → 1.5=FastAPI 선례). 매핑 계약은 §에러 계약에 명시.
- **내원 생성 플로우(walk-in INSERT vs reserved)** → **4.2**: 권장 — walk-in 은 service_role 이 `status='registered'` 직접 INSERT(초기상태 가드 통과), reserved(Epic 6)는 `scheduled` 로 생성 후 도착 시 `register_encounter`. `register_encounter` RPC 는 **scheduled→registered 전이** 전용(Open Questions Q1).
- **대기 현황판·실시간·다음 호출** → 4.3(`postgres_changes` 구독·UX-DR6/7/8). **진찰 시작 UI·세션당 활성 내원 1개 가드** → 4.4(UX-DR21⑨). **진료 허브 배너·RRN/연락처 reveal·알레르기 can't-miss** → 4.5. **SOAP·주호소·임상기록** → 4.6.
- **수가 미발생(취소/노쇼) 정산** → Epic 7 FR-118. **부분수행 수행분 정산** → Epic 7 FR-119(7-10). **`reservation_id` FK** → Epic 6. **고위험 비가역 신원확인(완료/취소)** UI → 소비 스토리(UX-DR21⑧).
- **동시 전이 경합 낙관적 잠금(버전/If-Match)** → 이월 유지(회고 4.6 autosave 묶음, deferred-work 낙관적 동시성). 전이 트리거의 현재상태 검증이 부분 방어이나 동시 전이 last-writer-wins 는 본 스토리 범위 밖 — **명시 이월**(은폐 금지, 회고 교훈 #1/#2).

### ⚠️ 마이그레이션 번호 — `0010_encounters.sql` (가장 먼저 내재화)

**encounters = `0010_encounters.sql`.** 에픽 본문(`epics.md:759` "0007_encounters.sql")·아키텍처(`architecture.md:316`)·Gap Analysis(`architecture.md` "행렬은 0007 작성 시")는 전부 **stale 번호 0007** 을 참조하나 **무시하라** — `0007` 은 이미 `masters_codes`(진단·수가·약품)가 차지했고 실제 적용분은 `supabase/migrations/0001~0009`(마지막 `0009_patients`)다. **다음 번호 = 0010.**

- 확정 근거: `docs/glossary.md:185` "다음 마이그레이션(내원 등 Epic 4)은 **0010**부터" + MEMORY(번호 정합 0010_encounters) + Epic 3 회고(번호 드리프트 = "매 에픽 재발 영구 세금", create-story 첫 작업 = 번호 재조정).
- **RLS·전이 트리거·RPC·권한 시드를 전부 `0010` 한 파일에 인라인.** 별도 `0014_rls_policies.sql` 만들지 말 것(0006/0007/0009 전부 자기 RLS 인라인 — `0003` 의 "0014 이월" 주석은 미실현).
- 작업 후 glossary blockquote 로 번호 종결(Task 2.1).

### 재사용 자산 — 발명 금지 (DO NOT REINVENT)

이 스토리는 **이미 깔린 인프라를 소비**한다. 재선언/재구현하면 회귀·이중 감사·불일치.

| 자산 | 위치 | 시그니처/계약 | 4.1 사용처 |
|---|---|---|---|
| `audit_trigger_fn` | `0004_audit.sql:60~` | trigger fn, SECURITY DEFINER, `target_id = coalesce(after->>'id', before->>'id')`, actor=`current_setting('app.actor_id',true)::uuid` ∥ `auth.uid()` | `trg_encounters_audit` 부착(재선언 금지) |
| `audit_logs` 스키마 | `0004_audit.sql` | `actor_id·action(create/read/update/delete/login)·target_table·target_id·before_data·after_data·…` append-only | 전이 감사 검증 |
| `has_permission(text)` | `0003_rls_helpers.sql:24` | `→ boolean`, SECURITY DEFINER·STABLE·`search_path=public`, **active 직원만** | RPC 내부 게이트 + RLS 정책 |
| `auth_user_role()` | `0003_rls_helpers.sql:9` | `→ text`(직원 역할, 비직원 NULL) | (참고 — 본인 경계는 patients.auth_uid) |
| `audit_logs_block_mutation` | `0004_audit.sql` | `raise exception ... using errcode='insufficient_privilege'`, **DEFINER 아님** | 전이 트리거 raise 패턴 선례 |
| 권한 카탈로그 | `0002_identity_rbac.sql:83-107` | `encounter.register`·`encounter.start`·`encounter.complete` **이미 시드됨** | 재시드 금지 — read/cancel/no_show 만 신규 |
| admin 부트 grant | `0002_identity_rbac.sql:110-114` | `roles r cross join permissions p where r.code='admin'` 멱등 | 신규 권한 admin grant |
| `encrypt_sensitive`/`blind_index` | `0005_crypto.sql` / `core/db.py` | RRN 암호화·HMAC, service_role, Vault 키 | 테스트 환자 셋업(키-게이트) |
| `authenticated_conn`/`_run_authed` | `core/db.py:90`/`:107` | sub→`request.jwt.claims`+`app.actor_id` GUC 주입(`set_config(...,true)`), DB장애→503 | (4.2/4.4 가 RPC 호출 시 — 4.1 은 계약만 문서화) |
| `ConflictError`/`NotFoundError`/`ForbiddenError` | `core/errors.py:83`/`:77`/`:69` | 409 "잘못된 상태 전이입니다."(code `conflict`) / 404 / 403, 봉투 `{error:{code,message,detail}}` | §에러 계약(4.2/4.4 매핑 대상) |
| `chart_no` 시퀀스 패턴 | `0009_patients.sql:21,26-27` | `create sequence` + `default lpad(nextval(...)::text, 8, '0')` race-free | `encounter_no` 미러 |
| RLS 미러 | `0009_patients.sql:91-120` | `<t>_select_staff`(has_permission)·`<t>_select_self`(auth.uid EXISTS), 쓰기 정책 부재 | encounters 정책 |
| 감사 트리거 부착 미러 | `0009_patients.sql:122-133` | `trg_<t>_audit after insert or update or delete` | encounters 트리거 |
| psql 테스트 픽스처 | `tests/conftest.py:90~` · `test_patients_integration.py` | docker exec psql, `_as_authenticated()`, `set_config('request.jwt.claims',...)`, begin/rollback | encounters DB 테스트 |
| 시드 계정·진료과 | `supabase/seed.sql` | `admin@pms.local`(전권)·`doctor@pms.local`(encounter 권한 0)·`Staff1234` / 진료과 `IM,FM,OS,…` | 테스트 success/403 + FK |

### 스키마 설계 (encounters)

명명: 테이블 복수 snake_case, PK `id uuid`, FK `<단수>_id`, 타임스탬프 `created_at`/`updated_at`(timestamptz UTC), soft delete `is_active`. **`updated_at` 자동갱신 트리거 만들지 말 것**(이 프로젝트 전례 0 — 쓰기 주체가 `updated_at=now()` 책임). `COMMENT ON` 미사용 → 인라인 `--` 주석.

| 컬럼 | 타입/제약 | 비고 (소유 스토리) |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | 감사 `target_id` 계약 |
| `encounter_no` | `text not null unique default lpad(nextval('public.encounters_encounter_no_seq')::text,8,'0')` | 사람용 내원번호(PII 아님), DB 부여(race-free) |
| `patient_id` | `uuid not null references public.patients(id)` | 본인 RLS 경계 경유. ON DELETE 미지정(RESTRICT — 진료 보존; patients 는 hard delete 없음) |
| `department_id` | `uuid not null references public.departments(id)` | 대기열 그룹핑(4.3) |
| `room_id` | `uuid references public.rooms(id)` | 진료실(선택, 배정 시) |
| `doctor_id` | `uuid references public.users(id)` | 담당의 — `start_consult` 가 `auth.uid()` 로 세팅(4.4 정제) |
| `visit_type` | `text not null check (visit_type in ('walk_in','reserved'))` | 접수 경로(생성 시 4.2 세팅) |
| `status` | `text not null default 'registered' check (status in ('scheduled','registered','in_progress','completed','cancelled','no_show'))` | **상태머신 핵심**(default=walk-in MVP) |
| `cancel_reason` | `text` | 취소/노쇼 운영 사유(저민감 — 임상/PII 자유텍스트 금지) |
| `registered_at`·`consult_started_at`·`completed_at`·`cancelled_at`·`no_show_at` | `timestamptz`(nullable) | 전이 RPC 가 해당 시각 기록(대기시간·NFR-002 메트릭 근거) |
| `created_by` | `uuid references public.users(id)` | 접수 처리 직원 |
| `is_active` | `boolean not null default true` | soft delete 일관성(취소는 도메인 status 로 별도) |
| `created_at`·`updated_at` | `timestamptz not null default now()` | |

> ⚠️ **PII/건강민감 자유텍스트 컬럼(주호소·증상·진단·메모) 추가 금지** — 4.6 SOAP(`medical_records`)·4.7 진단(`encounter_diagnoses`)이 소유. 사유는 §감사 경계(3.6 마스킹 드리프트 방지).
> `reservation_id uuid references public.appointments(id)` 는 **Epic 6**(appointments 테이블 생성 시) ALTER 로 추가 — 4.1 에는 두지 않음(appointments 미존재).

### 상태 전이 매트릭스 (full matrix) — AC3 핵심 산출물 (architecture Gap Analysis #3 소유)

상태: `scheduled`(예약)·`registered`(접수)·`in_progress`(진행중)·`completed`(완료)·`cancelled`(취소)·`no_show`(노쇼). 종결: completed·cancelled·no_show(이탈 전이 없음 — NFR-040 역행 금지).

| From \ To | scheduled | registered | in_progress | completed | cancelled | no_show |
|---|---|---|---|---|---|---|
| **(INSERT)** | ✅ 예약(Epic 6) | ✅ walk-in(4.2) | ⛔ | ⛔ | ⛔ | ⛔ |
| **scheduled** | — | ✅ `register_encounter` | ⛔ | ⛔ | ✅ `cancel_encounter` | ✅ `mark_no_show` |
| **registered** | ⛔(역행) | — | ✅ `start_consult` | ⛔(건너뛰기) | ✅ `cancel_encounter` | ⛔ |
| **in_progress** | ⛔ | ⛔ | — | ✅ `complete_encounter` | ⛔ (△) | ⛔ |
| **completed** | ⛔ | ⛔ | ⛔ | — | ⛔ | ⛔ |
| **cancelled** | ⛔ | ⛔ | ⛔ | ⛔ | — | ⛔ |
| **no_show** | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | — |

- **no_show 는 scheduled 에서만**(접수=환자 도착 증명이므로 registered 이후 노쇼 없음).
- **(△) in_progress→cancelled 기본 불허**: 진찰 시작 후 환자 이탈은 **부분수행 → `completed`** 로 종결하고 Epic 7 이 수행분만 정산(FR-119). "진찰 시작했으나 오더 0건 이탈"을 취소로 보는 정책이 필요하면 Open Questions Q2 에서 재검토(기본 = 불허).
- 매트릭스 변경 시 **트리거 + RPC + 본 표 + 테스트(3.4/3.5)** 를 함께 갱신(단일 진실 = `enforce_encounter_transition` 트리거).

### 전이 트리거 + 초기상태 가드 (`enforce_encounter_transition`)

전이 유효성의 **단일 진실**. SECURITY DEFINER 불요(테이블 미접근·raise 만 — `audit_logs_block_mutation` 선례). RPC 가 매트릭스를 재구현하지 않고 이 트리거에 위임(중복 금지).

```sql
create or replace function public.enforce_encounter_transition()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('scheduled','registered') then
      raise exception 'invalid initial encounter status: %', new.status using errcode = 'PT409';
    end if;
    return new;
  end if;
  if new.status = old.status then           -- 비-상태 컬럼 변경은 통과
    return new;
  end if;
  if not (
    (old.status = 'scheduled'  and new.status in ('registered','cancelled','no_show')) or
    (old.status = 'registered' and new.status in ('in_progress','cancelled')) or
    (old.status = 'in_progress' and new.status = 'completed')
  ) then
    raise exception 'invalid encounter transition: % -> %', old.status, new.status using errcode = 'PT409';
  end if;
  return new;
end; $$;

create trigger trg_encounters_transition
  before insert or update on public.encounters
  for each row execute function public.enforce_encounter_transition();
```

> 이 트리거는 service_role(BYPASSRLS) 쓰기에도 발화 → 직접 `update status` 오용·잘못된 RPC 모두 차단(방어심층, NFR-040 최종선).

### 전이 RPC 사양

5종 전부 `language plpgsql security definer set search_path = public` · `returns public.encounters`. 패턴(예 `start_consult`):

```sql
create or replace function public.start_consult(p_encounter_id uuid)
returns public.encounters language plpgsql security definer set search_path = public as $$
declare v_row public.encounters;
begin
  if not public.has_permission('encounter.start') then               -- 동일 txn 권한 재평가(TOCTOU)
    raise exception 'permission denied: encounter.start' using errcode = 'insufficient_privilege';  -- →403
  end if;
  select * into v_row from public.encounters where id = p_encounter_id for update;
  if not found then
    raise exception 'encounter not found: %', p_encounter_id using errcode = 'PT404';                -- →404
  end if;
  update public.encounters
     set status = 'in_progress', consult_started_at = now(), doctor_id = (select auth.uid()), updated_at = now()
   where id = p_encounter_id
   returning * into v_row;                          -- 전이 유효성은 trg_encounters_transition 이 PT409 로 강제
  return v_row;
end; $$;
```

| RPC | 권한 | 전이 | 세팅 컬럼 |
|---|---|---|---|
| `register_encounter(p_id)` | `encounter.register` | scheduled→registered | `registered_at` |
| `start_consult(p_id)` | `encounter.start` | registered→in_progress | `consult_started_at`, `doctor_id=auth.uid()` |
| `complete_encounter(p_id)` | `encounter.complete` | in_progress→completed | `completed_at` |
| `cancel_encounter(p_id, p_reason text)` | `encounter.cancel` | scheduled\|registered→cancelled | `cancelled_at`, `cancel_reason` |
| `mark_no_show(p_id)` | `encounter.no_show` | scheduled→no_show | `no_show_at` |

- **권한은 RPC 내부 `has_permission()` 자체 게이트**(SECURITY DEFINER 가 RLS 우회 쓰기를 하므로 권한은 RPC 가 책임 = 동일 txn 재평가 = TOCTOU 차단). 4.2/4.4 가 FastAPI `require_permission()` 의존성을 앞단에 더해 빠른 403(방어심층).
- RPC 는 **매트릭스를 재검증하지 않음** — `update` 가 트리거를 발화시켜 `PT409`. (not-found 만 RPC 가 `for update`+`PT404` 로 선제 — 깔끔한 404.)

### 에러 계약 (DB SQLSTATE → HTTP) — 4.2/4.4 가 매핑 구현

| 상황 | DB 신호(4.1 발생) | HTTP(4.2/4.4 매핑) | errors.py 클래스 |
|---|---|---|---|
| 잘못된 전이(역행·건너뛰기·종결 재전이·비정상 초기상태) | `raise ... errcode='PT409'` (asyncpg `e.sqlstate=='PT409'`) | **409** | `ConflictError`(code `conflict`/오버라이드 `invalid_transition`, msg "잘못된 상태 전이입니다.") |
| 대상 내원 없음 | `errcode='PT404'` | 404 | `NotFoundError` |
| 권한 미보유 | `errcode='insufficient_privilege'`(42501) | 403 | `ForbiddenError` |

- **`PT409`/`PT404` = 프로젝트 커스텀 SQLSTATE**(클래스 `PT` = PMS transition, PostgreSQL 코어 미사용 클래스 → 충돌 없음; `409`/`404` = HTTP 니모닉). 메시지에 안정 영문 토큰(`invalid ... transition`/`not found`) 동봉. (이 프로젝트 첫 전이용 에러 신호 — 기존은 `insufficient_privilege` 만 사용. glossary 등재.)
- **4.1 책임**: DB 가 `PT409` 를 정확히 발생시킴을 DB 테스트로 보증. **HTTP 변환은 4.2/4.4** 의 `core/db.py` asyncpg 래퍼(`except asyncpg.PostgresError as e: if e.sqlstate=='PT409': raise ConflictError(...)`)가 구현. `ConflictError`(409, "잘못된 상태 전이입니다.")는 errors.py 에 **이미 이 스토리용으로 존재**.

### 이월 갭 ⑥ — 취소·노쇼·부분수행 (FR-118/119, AC3)

> 출처: `architecture.md:179`(이월 스키마 갭 ⑥ "취소·노쇼·부분수행 정산 경로", L-1/L-2 결정), `epics.md:173`. NFR-040: "취소·노쇼·부분수행 경로는 FR-118~119를 따른다"(`epics.md:142`, `prd.md:242`).

- **취소(`cancelled`)·노쇼(`no_show`)**: 4.1 이 상태·전이·RPC 로 **상태머신에 명시**. **수가 미발생 정산(FR-118)** 은 Epic 7 소유(노쇼 수수료 별도 항목 옵션 포함) — 4.1 은 fee 로직 없음.
- **부분수행(FR-119)**: **신규 상태가 아님**(`encounter_status` 에 partial 없음 — glossary 확인). 일부 오더만 수행 후 이탈 = `in_progress`→`completed` 로 정상 종결, **Epic 7(7-10)이 수행분만 수납·정산**. 4.1 은 이를 §전이 매트릭스 (△) 주석 + 본 절로 문서화(별도 상태 도입 금지).
- 따라서 4.1 의 갭 ⑥ 산출물 = **full transition matrix 확정 + cancel/no_show 경로 빌드 + partial 의 다운스트림 귀속 명시**. 정산(fee/payment) 일체는 Epic 7.

### RLS · 권한 · GRANT posture

- **RLS**(인라인): `encounters_select_staff` = `(select public.has_permission('encounter.read'))`(직원 전체 행) · `encounters_select_self` = patient_id → patients.auth_uid EXISTS(환자 본인 내원, 포털 Epic 8). **쓰기 정책 없음** → authenticated 직접 INSERT/UPDATE/DELETE 거부(쓰기 = service_role/RPC). service_role 은 BYPASSRLS(방어심층으로 RLS 유지, FORCE 안 씀 — 전례 0).
- **신규 권한**: `encounter.read`(조회·RLS 게이트)·`encounter.cancel`·`encounter.no_show` 만 시드(register/start/complete 는 0002 기존). admin 부트 grant 만 0010 에서(비-admin 은 1.7 매트릭스 UI).
- **GRANT**: `revoke all from anon,authenticated` → service_role 전권 + 시퀀스 usage → authenticated `select`(RLS 게이트, 민감 컬럼 없어 테이블 단위) → 전이 RPC 5종 `execute to authenticated, service_role`(RPC 자체 게이트로 authenticated 직접 호출도 권한 검사 통과 필요 → 안전 + DB 테스트가 authenticated 로 호출, `has_permission` grant 선례).

### 감사 · PII/건강민감 경계 (3.6 마스킹 드리프트 가드)

- 모든 전이(INSERT=create, UPDATE=update, DELETE=delete)가 `trg_encounters_audit`(0004 재사용)로 before/after jsonb 스냅샷 + actor 기록. **`id` 컬럼 계약 충족**(트리거가 `id` 로 target_id 추출 — encounters PK=id, deferred-work 계약).
- actor 정확성: 전이가 정확한 actor 로 남으려면 호출 전 `app.actor_id` GUC 세팅 필요 — 4.2/4.4 의 `authenticated_conn`(`core/db.py:90`)이 자동 주입. **DB 테스트는 `set_config('app.actor_id', '<uid>', true)` 수동 세팅**(3.7).
- **PII 경계**: encounters 컬럼은 비-PII(patient_id=FK uuid, encounter_no=비-PII 사람용 번호). **건강민감 자유텍스트(주호소·증상·진단) 컬럼을 두지 않음** → 감사 스냅샷에 건강정보 유입 없음 → 3.6 `mask_snapshot`(`services/audit.py` `_SENSITIVE_KEY`/`_PII_NAME_TABLES`) 키 집합 변경 불요. `cancel_reason` 은 운영 사유(저민감).
- ⚠️ **드리프트 가드(미래)**: 향후 encounters(또는 후속 임상 테이블)에 PII/건강민감 컬럼 추가 시 **server `services/audit.py` + web `audit.ts` 양쪽 마스킹 집합을 동시 등재**(deferred-work: 두 집합 자동 일치 검증 부재 — 한쪽만 고치면 조용히 분기).

### 이월 인수 (상세)

- **① 번호 정합 0010** — §마이그레이션 번호. glossary blockquote 종결.
- **② TOCTOU 차단** — 전이 RPC `has_permission()` 가 SECURITY DEFINER 쓰기와 동일 트랜잭션에서 권한을 재평가(별도 권한조회→쓰기 분리 없음). 4.2/4.4 가 FastAPI 의존성 게이트를 앞단에 추가해도 RPC 게이트가 최종 권위. (deferred-work:159 "권한평가+쓰기 동일 트랜잭션" 패턴 — 3.1/3.3/3.4 선례.)
- **③ 감사 `id` 계약 + PII 경계** — §감사 경계. encounters PK=id, 건강민감 자유텍스트 부재.
- **(이월 유지)** 동시 전이 낙관적 잠금(버전/If-Match)·전이 전용 동시성 테스트·is_active 비활성 환자에 내원 생성 점검(soft-delete 플로우) = 4.1 범위 밖, deferred-work 에 명시 유지(회고 교훈 #1 "교차절단 부채는 주인 스토리로만 청산").

### glossary 갱신 (Task 2)

`docs/glossary.md` 형식: 섹션별 마크다운 테이블, 신규 식별자는 사용 전 등재(project-context 규칙). 추가:
- 마이그레이션 blockquote(Task 2.1).
- `## 함수·RPC — 내원 상태머신 (Story 4.1, 0010_encounters.sql)` 섹션 신설: 전이 RPC 5종(snake_case 동사 — glossary:11 명명규칙)·`enforce_encounter_transition`·트리거 2종.
- 권한 카탈로그에 `encounter.read`/`encounter.cancel`/`encounter.no_show` 추가(기존 encounter.register/start/complete 옆).
- 식별번호/컬럼 섹션에 `visit_type`·`doctor_id`·전이 타임스탬프·`cancel_reason`·`created_by`·시퀀스·커스텀 SQLSTATE `PT409`/`PT404`.
- `encounter_status` 6값·`encounter_no`·`encounter` 는 이미 등재 — **변경 없음**.

### 테스트 표준

- **DB 레벨 통합 테스트**(`api/tests/test_encounters_db.py`) — psql 픽스처(`conftest.py:90~`) 직접 사용. FastAPI 미경유(순수 DB 스토리). 3중 검증 중 **DB 제약(최종선)** 검증에 집중(NFR-040). 골든패스 E2E 는 Post-MVP(아키텍처 명시 — 지금 과도 명세 금지).
- RPC 호출 시 `begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"<uid>","role":"authenticated"}',true); select set_config('app.actor_id','<uid>',true); select public.<rpc>(...); ... rollback;` 패턴. has_permission 평가를 위해 jwt claims 필수.
- **에러 단언 특정성**(1.3 P3): `PT409`/`PT404`/`insufficient_privilege` 는 sqlstate 또는 안정 토큰으로 단언 — `"denied"/"error" in err` 류 비특정 단언 금지(무관 실패에도 통과).
- 테스트 위생(3.1 flaky 교훈): 임시행 `try`+`assert returncode==0`+`finally` CASCADE 정리, 고유 데이터 = 세션 랜덤 base + 단조 카운터(db reset 없이 재실행 green). 환자 셋업 암복호는 `SUPABASE_SECRET_KEY` 설정 시에만(미설정 skip, 1.9/3.1 패턴).
- **회귀 가드**: 마스터·환자 기존 테스트가 깨지지 않아야 함(0010 은 신규 테이블만 추가 — 기존 무영향). `supabase db reset` 후 0001~0010 순차 적용 성공 확인(FK 의존: patients/departments/users 선행 존재).

### Project Structure Notes

- DDL 단일 소유: `supabase/migrations/0010_encounters.sql`(FastAPI DDL·Alembic 금지). 식별자 영문 snake_case(glossary 단일 진실). timestamptz=UTC. soft delete=is_active.
- 4계층 소비(후속): `api/app/api/v1/encounters.py`(액션 엔드포인트, 4.2~) → `services/encounters.py`(전이 RPC 래핑) → `core/db.py`(asyncpg `conn.fetchval("select public.<rpc>($1)")` + SQLSTATE 매핑) → `schemas/encounters.py`. `api/v1/router.py` 에 include 예시 주석 이미 존재. **4.1 은 이 레이어를 만들지 않음**(계약만 §에러 계약/스코프 OUT).
- 무ORM: asyncpg + DB 함수 직접 호출(supabase-py 미사용). JSON snake_case 전 경로.

### References

- [Source: epics.md#Story-4.1] (`_bmad-output/planning-artifacts/epics.md:751-767`) — AC 원문(상태 enum+CHECK, 전이 RPC, 409, 이월 갭 ⑥ full matrix·감사).
- [Source: epics.md#Epic-4] (`:745-749`, `:769-787`) — 에픽 목표·4.2 가 register_encounter 소비.
- [Source: epics.md#FR] (`:93-94 FR-118/119`, `:142 NFR-040`, `:173 이월 갭 ⑥`) · [Source: prd.md] (`:174-175 FR-118/119`, `:242 NFR-040`).
- [Source: architecture.md] (`:175` 상태머신 enum+트리거/RPC+CHECK, `:179` 이월 갭 ⑥, `:194/:253` 액션 엔드포인트·status PATCH 금지, `:195/:269` 에러 봉투 409, `:188` 감사 append-only, `:246-249` 네이밍·enum·RPC·트리거 규칙, `:281` 3중 검증, "Gap Analysis #3" full matrix는 마이그레이션 작성 시 = 4.1 소유).
- [Source: project-context.md] — 불변식 DB 소유·상태머신 Python/TS 재구현 금지·쓰기=FastAPI(service_role)/조회=Supabase/실시간=구독·정의된 전이만(409)·mutation 중 disable·raw PII 미로깅.
- [Source: docs/glossary.md] (`:11` enum/RPC/트리거 명명, `:59-68` encounter_status 6값, `:56` encounter_no, `:185` 마이그레이션 0010 확정).
- [Source: supabase/migrations] — `0002:83-114`(권한 시드·admin grant), `0003`(has_permission), `0004`(audit_trigger_fn·block_mutation·errcode 패턴), `0006`(departments/rooms), `0009:21-133`(시퀀스·RLS·감사 트리거 미러).
- [Source: api/app/core] — `errors.py:69-88`(Forbidden/NotFound/Conflict), `db.py:90-119`(authenticated_conn·app.actor_id 주입·503), `security.py:125`(require_permission).
- [Source: deferred-work.md] — TOCTOU 동일 txn(:159), 감사 `id` 계약(:168), 마스킹 집합 드리프트 가드(:11), 낙관적 동시성(:48).
- [Source: epic-3-retro-2026-06-21.md] — 번호 정합(0010)·교차절단 부채 명시 이월·적대 3레이어 리뷰.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMad dev-story)

### Debug Log References

- 마이그레이션 직접 적용(running db, 0009 위) → exit 0. 스모크: scheduled→registered→in_progress→completed(doctor_id 세팅·감사 3건), 불법 전이/초기상태 가드 = PT409, 권한 거부 = 42501(insufficient_privilege) 전부 확인.
- `supabase db reset`(0001~0010 순차 + seed) → exit 0(FK 의존 patients/departments/users 선행 충족, 순서 정합).
- `uv run pytest tests/test_encounters_db.py` → 22 passed. 전체 스위트 `uv run pytest` → **310 passed, 9 skipped**(기존 admin_users_integration skip, 회귀 0). db reset 후 재실행도 동일 green.
- `ruff check` / `ruff format --check` → clean(E501 5건은 SQL 문자열 분할·docstring 단축으로 해소, noqa 미사용).

### Completion Notes List

- **Task 1 — `0010_encounters.sql`**: encounters 허브 테이블(상태 text+CHECK 6값·초기상태 가드·전이 타임스탬프 5종·encounter_no 시퀀스) + 전이 강제 트리거 `enforce_encounter_transition`(BEFORE INSERT/UPDATE, 매트릭스 단일 진실, 위반=PT409) + 전이 RPC 5종(SECURITY DEFINER + search_path 고정 + has_permission 자체 게이트=동일 txn TOCTOU 재평가, not-found=PT404) + 권한 카탈로그 확장(read/cancel/no_show, admin 부트 grant) + RLS 인라인(staff=encounter.read / self=patient_id→auth_uid / 쓰기 정책 없음) + GRANT posture + 감사 트리거(0004 재사용). CREATE TYPE ENUM 미사용(프로젝트 text+CHECK 관례). `updated_at` 자동 트리거 미생성(전례 0 — 쓰기 주체 책임).
- **Task 2 — `docs/glossary.md`**: 마이그레이션 번호 확정 blockquote(0010, stale 0007 무시) + 내원 상태머신 섹션 신설(RPC 5종·트리거 2종·`enforce_encounter_transition`·신규 권한 3종·컬럼·시퀀스·커스텀 SQLSTATE PT409/PT404 + full transition matrix·쓰기 경로·PII 경계).
- **Task 3 — `api/tests/test_encounters_db.py`**: DB 레벨 22 테스트(초기상태 가드·합법 체인·불법 전이 8쌍 파라미터화·잘못된 RPC·취소/노쇼·매트릭스 외 차단·권한 거부·not-found·전이 감사·RLS staff/self/anon). 전부 `begin/rollback` 격리(커밋·누적·flaky 0).
- **결정 — 테스트 환자 셋업(Task 3.1 대비 개선)**: 스펙은 `encrypt_sensitive` 경유(Vault 키 게이트)를 제안했으나, 기존 RLS 테스트 선례대로 **psql 직접 INSERT(dummy `'\x00'::bytea`·고유 hash)** 로 환자 FK 를 만들어 **Vault 키 의존 제거**(db 컨테이너만 있으면 실행) — AC 의도(FK 대상 확보) 충족하며 더 견고.
- **결정 — `mark_no_show(uuid, text default null)`**: 스펙 표는 `mark_no_show(p_id)`였으나 `cancel_encounter` 와 대칭으로 선택적 사유 파라미터(default null)를 추가(노쇼 사유 기록 여지). 1-arg 호출 호환(테스트 검증).
- **에러 계약/walk-in/SQLSTATE**: Open Questions Q1(register_encounter=scheduled→registered 전용·walk-in INSERT 는 4.2)·Q2(in_progress→cancelled 불허)·Q3(PT409/PT404 커스텀 SQLSTATE) 모두 스토리 권장안대로 구현. HTTP 매핑(asyncpg sqlstate→AppError)·액션 엔드포인트는 4.2/4.4 소비(스코프 OUT 준수).
- **이월 유지**(은폐 아닌 명시): 동시 전이 낙관적 잠금(버전/If-Match)·is_active 비활성 환자 내원 생성 점검 = 4.1 범위 밖, deferred-work 유지.

### File List

- `supabase/migrations/0010_encounters.sql` (신규)
- `api/tests/test_encounters_db.py` (신규)
- `docs/glossary.md` (수정 — 마이그레이션 번호 blockquote + 내원 상태머신 섹션)

## Change Log

| 날짜 | 변경 | 작성자 |
|---|---|---|
| 2026-06-21 | 스토리 생성(create-story, ready-for-dev) — 상태머신 DB 토대, full transition matrix 확정, 이월 갭 ⑥·번호 정합 0010·에러 계약(PT409→409) 인코딩 | create-story |
| 2026-06-21 | 구현 완료(dev-story, review) — `0010_encounters.sql`(테이블·전이 트리거·RPC 5종·RLS·권한·감사) + glossary + DB 테스트 22건. db reset 0001~0010 + 전체 310 passed/9 skipped, ruff clean | dev-story |
| 2026-06-21 | 코드리뷰(3레이어) done — patch 1건 적용(전이 RPC 5종 소스 상태 선검사 = same-status 재호출/진료 탈취 차단, NFR-040) + 재호출 거부 테스트. defer 6건 이월 기록. 전체 311 passed/9 skipped | code-review |

## Open Questions

1. **register_encounter 의 walk-in 처리** — 권장: `register_encounter` = scheduled→registered **전이 전용**(reserved, Epic 6). walk-in(MVP)은 4.2 가 service_role 로 `status='registered'` 직접 INSERT(초기상태 가드 통과·감사 자동). 4.2 가 "register_encounter RPC 경유 일관 적용"(에픽 AC)을 어떻게 충족할지(직접 INSERT vs 생성 RPC `create_walk_in_encounter`)는 4.2 결정. 4.1 은 둘 다 지원하도록 트리거가 INSERT 초기상태(registered)를 허용.
2. **in_progress→cancelled 정책** — 기본 불허(부분수행=completed 후 Epic 7 정산, FR-119). "진찰 시작 후 오더 0건 이탈"을 취소로 보는 운영 정책 필요 시 매트릭스 + 트리거 + RPC 확장(별도 권한 `encounter.cancel` 재사용). 현 결정: 불허.
3. **커스텀 SQLSTATE 표기** — `PT409`/`PT404` 채택(코어 미사용 클래스). 팀이 표준 condition name 선호 시 대안 검토 가능하나, 전이 충돌에 매핑되는 표준 SQLSTATE 부재 → 커스텀이 명확. asyncpg `e.sqlstate` 로 소비.
