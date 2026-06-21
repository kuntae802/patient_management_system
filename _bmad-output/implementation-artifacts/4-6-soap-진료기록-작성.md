---
baseline_commit: 8c66c7d58d2d15fb05a000e854b4a3efa2f9f1c9
---

# Story 4.6: SOAP 진료기록 작성

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **의사(doctor)**,
I want **진료 허브 중앙 작성 영역의 SOAP ledger(주관적 S·객관적 O·평가 A·계획 P)에 진료기록을 작성하면 입력 중 자동저장되고, 한 내원에 진료기록을 여러 건(1:N) 남길 수 있기를**,
so that **차팅을 멈추거나 "저장" 버튼을 의식하지 않고 표준 SOAP 형식으로 안전하게 기록하며(임상 안전·기록 무손실), 같은 내원의 추가 기록·다른 임상의 기록이 덮어써지지 않는다.**

## Acceptance Criteria

1. **AC1 — SOAP ledger 작성 UI (FR-040, UX-DR11):** 진료 허브(진행중 `in_progress` 내원)의 **중앙 작성 영역**이 **full-bleed 1열 표(ledger)** 로 렌더된다 — 섹션 폭 전체 가로 hairline 으로 행을 나누고 좌우 테두리는 없다(`margin 0 -16px`). 각 파트(S/O/A/P)는 **헤더 행**(컬러 배지 + 한글 라벨 + 영문 + 설명어[무엇을 적나] + 우측 액션 영역) + **본문 행**(입력 textarea, **최소 높이 132px**[`soap-input-min-height` 토큰], `cursor:text`)으로 구성된다. 배지 색은 **토큰**(S=`status-inprogress` · O=`primary` · A=`status-received-ink` · P=`status-done` — 하드코드 hex 금지). 본문 행은 hover 시 `surface-muted` 암시, **포커스/입력 중 = 좌측 3px teal 액센트 + 옅은 teal 틴트(`color-mix(primary 5%, surface)` — 음영 비의존)** 로 "여기 타이핑 가능"을 표시하고, placeholder 는 `text-muted` 가이드("무엇을 적나" 안내 — **단독 의존 금지**, `:focus-visible` 링 + 좌측 액센트가 affordance 의 주력). **빈 파트는 색만이 아니라 글리프/라벨("비어 있음")로도 표시**(저가 임상 모니터 강건성).

2. **AC2 — 입력 중 autosave + polite 인디케이터 + 스테일 탭 가드 (FR-040, UX-DR11·UX-DR21·NFR-050):** 작성 중이면 **디바운스(~1.5s) autosave** 가 트리거되어, **첫 비어있지-않은 내용에서 진료기록 행을 생성**(`POST`)하고 이후 변경은 **전체 교체 갱신**(`PUT`)한다. 성공 시 **"자동 저장됨 · {HH:mm}"** 인디케이터가 **`aria-live="polite"` 라이브 리전**으로 표시된다(저장 전 = "변경 시 자동 저장됩니다"). ⚠️ **세션당 활성 내원 1개 가드(UX-DR21)**: autosave 는 매 저장 전 **`isActiveEncounter(encounterId)`(`lib/encounters/active-session.ts`)를 확인**하고, 이 탭이 활성 내원 락을 잃었으면(다른 탭이 점유 = superseded) **저장을 거부**한다(잘못된 환자의 열린 SOAP 에 조용히 덮어쓰기 방지 — 진료 허브가 이미 superseded 배너를 노출). 실패(403/404/네트워크)는 한국어 토스트(sonner)로 알리되 **raw 임상 텍스트는 로그·토스트·에러봉투·URL 에 미노출**.

3. **AC3 — 한 내원 복수 SOAP 기록(1:N) (FR-041, `0013_medical_records.sql`):** 한 내원에 대해 **진료기록을 여러 건 저장**할 수 있다 — 새 마이그레이션 `0013_medical_records.sql` 의 `medical_records` 테이블(`encounter_id` 1:N)에 각 기록이 별도 행으로 적재된다. ledger 는 **현재 임상의(작성자)의 가장 최근 열린 기록**을 활성 편집 대상으로 로드하고(없으면 새 기록), **"새 진료기록" 액션**으로 같은 내원에 추가 기록을 생성할 수 있다. 같은 내원의 **이전/타 임상의 기록은 읽기전용 이력**으로 보이며(작성자·시각 표시), autosave 는 **작성자 스코프**라 다른 임상의의 기록을 덮어쓰지 않는다. 모든 작성·갱신은 **감사 트리거(0004)** 로 자동 기록된다.

4. **AC4 — 감사 스냅샷의 SOAP 건강민감 텍스트 마스킹 (FR-242, NFR-041, 보안 MUST):** `medical_records` 의 감사 스냅샷에 처음 유입되는 SOAP 자유텍스트(`subjective`·`objective`·`assessment`·`plan`)는 **읽기시점 마스킹(Story 3.6)** 으로 가려진다 — 서버 `services/audit.py` `_SENSITIVE_KEY` 정규식과 **거울인 웹 `lib/admin/audit.ts` `SENSITIVE_KEY`** 양쪽에 4개 컬럼명을 **동시 등록**(한쪽만 바꾸면 드리프트 — 두 파일 주석이 동기 유지를 명시)해, 감사 뷰어·API 본문·구조적 로그에 평문 임상기록이 새지 않는다(diff 가독성을 위해 키는 보존, 값만 `●●●● (마스킹됨)`). `audit_logs` 자체는 append-only 포렌식이므로 원본은 보존된다.

5. **AC5 — doctor 권한 활성화 + 회귀 0 (RBAC, NFR-051):** doctor 역할이 시드에서 **`medical_record.write`(기존 0002 권한) + `medical_record.read`(0013 신규 권한)** 를 보유해 SOAP 작성·조회 골든 패스가 가동된다(4.5 까지 doctor 는 medical_record 권한 0 이었음). 신규 권한 `medical_record.read` 는 **0013 admin boot grant 재실행**(0002 cross-join 은 후행 권한 미포함 → 누락 시 `test_admin_role_has_all_permissions` 회귀)으로 카탈로그/매트릭스 정합을 유지한다. 무권한 baseline 계정 **`nurse@pms.local`(EMP0004)** 로 작성(`medical_record.write` 미보유)·조회(`medical_record.read` 미보유) **403** 이 검증되고, doctor 의 작성·갱신·조회·1:N 성공 + 감사 마스킹이 신규 테스트로 커버되어 **회귀 0** 을 보장한다.

## Tasks / Subtasks

> **읽기 우선(필수):** 착수 전 §"기존 코드 읽기(UPDATE)" 의 파일을 **완독**한다. 특히 `web/AGENTS.md` 경고 — 이 Next.js(16)/React(19.2)는 학습 데이터와 다를 수 있으니 클라이언트 컴포넌트·`useEffect`(로드·디바운스)·이벤트 핸들러 작성 전 `node_modules/next/dist/docs/` 관련 가이드를 확인한다. 이 스토리는 **신규 마이그레이션 1건(0013 — `medical_records` 테이블 + `medical_record.read` 권한 + RLS + 감사 트리거)** + 감사 마스킹 키 동기 + API 3 엔드포인트(POST/PUT/GET) + 웹 SOAP ledger + autosave(스테일 탭 가드) + 시드 grant + 회귀 테스트다. **⚠️ 데이터/스코프 경계(엄수, §결정 5)**: 진단(KCD `encounter_diagnoses`)=4.7 / 오더=Epic 5 / 활력=Epic 5(5.6) / 약물 상호작용=5.5 / 진료 완료 액션바·flow stepper=Epic 7 — 전부 4.6 범위 밖. 중앙 = SOAP ledger 만, 우 오더 pane 은 placeholder 유지.

- [x] **Task 1 — DB: `medical_records` 테이블 마이그레이션 `0013_medical_records.sql` (AC1, AC3, AC5)**
  - [x] 1.1 신규 `supabase/migrations/0013_medical_records.sql`. 헤더 주석: Story 4.6 / FR-040·FR-041 / UX-DR11. 의존: 0002(permissions·role_permissions·`has_permission` via 0003), 0004(`audit_trigger_fn` + action CHECK create/read/update/delete/login), 0009(patients — RLS self 경로), 0010(encounters FK). **식별자 영문 snake_case · timestamptz=UTC · soft delete=`is_active`**.
  - [x] 1.2 **테이블 `public.medical_records`**(glossary §34 표준명): `id uuid primary key default gen_random_uuid()` · `encounter_id uuid not null references public.encounters(id)` · `author_id uuid not null references public.users(id)`(작성 의사) · `subjective text` · `objective text` · `assessment text` · `plan text`(4 파트 전부 nullable — 일부만 채운 기록 허용) · `is_active boolean not null default true` · `created_at timestamptz not null default now()` · `updated_at timestamptz not null default now()`. ⚠️ **컬럼명 = SOAP 영문 4종 고정**(`subjective`/`objective`/`assessment`/`plan` — Task 2 마스킹 키와 정확히 일치해야 함). 인덱스: `idx_medical_records_encounter_id`(encounter_id), `idx_medical_records_author_id`(author_id).
  - [x] 1.3 **신규 권한 `medical_record.read`**(임상 SOAP 조회 — 최소권한 경계, §결정 2): `insert into public.permissions (code,name,resource,action) values ('medical_record.read','진료기록 조회','medical_record','read') on conflict (code) do nothing;`. (⚠️ **`medical_record.write` 는 0002:91 에 이미 존재 — 재삽입 금지**. 쓰기는 기존 권한 소비.) **admin boot grant 재실행**(0010:256~261·0012:27~32 패턴 미러): `insert into role_permissions select r.id,p.id from roles r join permissions p on p.code='medical_record.read' where r.code='admin' on conflict do nothing;` — ⚠️ **필수**(0002 admin cross-join 은 0013 신규 권한을 자동 포함 안 함 → 누락 시 `test_admin_role_has_all_permissions` 회귀). 비-admin grant 는 1.7 매트릭스 UI 소관(데모 grant 는 Task 5).
  - [x] 1.4 **권한 posture**(민감 reveal 컬럼 없음 → 테이블 단위 GRANT, 0010:265~269 미러): `revoke all on public.medical_records from anon, authenticated;` · `grant select, insert, update, delete on public.medical_records to service_role;`(쓰기=FastAPI service_role 경유) · `grant select on public.medical_records to authenticated;`(RLS 적용 하 읽기).
  - [x] 1.5 **RLS(방어심층 — service_role/FastAPI 쓰기에도 유지, 0010:277~293 미러)**: `alter table public.medical_records enable row level security;`. ① **staff** `medical_records_select_staff` for select to authenticated using `(select public.has_permission('medical_record.read'))` — ★ **`encounter.read` 가 아니라 신규 `medical_record.read`**(원무·간호가 의사 SOAP 를 읽지 못하게 — §결정 2). ② **환자 본인** `medical_records_select_self` for select to authenticated using `exists(select 1 from public.encounters e join public.patients p on p.id=e.patient_id where e.id=medical_records.encounter_id and p.auth_uid=(select auth.uid()))`(내원→환자→auth_uid 경로 — 환자 포털 Epic 8 자기 기록 조회 토대). **쓰기 정책 없음**(authenticated INSERT/UPDATE/DELETE 거부 — 쓰기=service_role RPC/직접 INSERT 만, encounters posture 동일).
  - [x] 1.6 **감사 트리거 부착**(0004 `audit_trigger_fn` 재사용, 신규 함수 0): `drop trigger if exists trg_medical_records_audit on public.medical_records;` · `create trigger trg_medical_records_audit after insert or update or delete on public.medical_records for each row execute function public.audit_trigger_fn();`. ⚠️ 테이블에 `id` 컬럼 존재 = 감사 target_id 계약 충족(0004:63). **이 트리거가 SOAP 자유텍스트를 감사 스냅샷에 최초 유입** → Task 2 마스킹이 동반 필수(0010:52~53 가 encounters 자유텍스트를 의도적으로 회피한 이유의 청산).
  - [x] 1.7 **`supabase db reset`** 로 0001~0013 + seed 재적용. psql 스모크(docker exec, **set role 없이 service_role/owner 경로 = FastAPI 모사**): `insert into medical_records(encounter_id,author_id,subjective) values(...)` 성공 + `audit_logs` 에 `action='create' and target_table='medical_records'` 행 생성 확인(after_data 에 subjective 평문 — 마스킹은 읽기시점 Task 2); 같은 행 `update ... set objective=...` → 'update' 감사 행. `select set_config('request.jwt.claims', '{"sub":"<nurse_uid>","role":"authenticated"}', true); set role authenticated; select * from medical_records;` → `medical_record.read` 미보유라 0행(RLS staff 정책 차단) 확인 후 `reset role`.

- [x] **Task 2 — 감사 마스킹: SOAP 자유텍스트 키 등록(서버 + 웹 거울 동기) (AC4)**
  - [x] 2.1 `api/app/services/audit.py` `_SENSITIVE_KEY`(line 26~31) 정규식에 **`subjective|objective|assessment|plan`** 추가(건강민감 그룹 — `allergies|chronic_diseases|medications|notes` 옆). 정규식 단어경계 주의: SOAP 키는 정확한 컬럼명이므로 alternation 에 그대로 추가(`re.IGNORECASE` 유지). 주석(line 25 "건강민감") 에 SOAP 4종 포함 명시.
  - [x] 2.2 **거울 동기(⚠️ 필수 — 한쪽만 바꾸면 드리프트, audit.py:24 / audit.ts:87~88 주석 경고)**: `web/src/lib/admin/audit.ts` `SENSITIVE_KEY`(line 89~90) 정규식에 동일 4종 추가. 서버=1차 권위·웹=방어심층, **두 정규식 문자열은 동일 유지**.
  - [x] 2.3 테스트(Task 6 와 연계): 서버 `test_audit_*` 마스킹 테스트에 `medical_records` before/after 가 SOAP 4종 값을 `●●●●` 로 마스킹·키는 보존·비민감 키(`encounter_id`·`author_id`·`is_active`·`created_at`) 노출 단언. 웹 `audit.test.ts`(line 20 의 키 루프)에 SOAP 4종 추가. ⚠️ **두 테스트가 같은 키 집합을 단언**(드리프트 회귀 가드).

- [x] **Task 3 — API: SOAP 진료기록 CRUD 3 엔드포인트 (AC1, AC2, AC3, AC5)**
  - [x] 3.1 `api/app/schemas/encounters.py` 에 SOAP 스키마(snake_case 유지 — camelCase 변환 금지):
    - `class MedicalRecordWrite(BaseModel)`: `subjective: str | None`·`objective: str | None`·`assessment: str | None`·`plan: str | None` — 각 `Field(default=None, max_length=20000)`(임상기록 장문 허용·DoS 상한). **POST·PUT 공용**(둘 다 4 파트 전체 페이로드). `@field_validator(...,mode="after")` 로 빈 문자열 → None 정규화(직접 API 호출의 `""` 적재 방지, clinical-profile 선례).
    - `class MedicalRecordResponse(BaseModel)`: `model_config = ConfigDict(from_attributes=True)` + `id`·`encounter_id`·`author_id`·`subjective`·`objective`·`assessment`·`plan`·`is_active`·`created_at`·`updated_at`(EncounterResponse 스타일 미러). 비-PII 식별 필드만(임상 텍스트는 reveal 아님 — 권한 게이트로 보호).
  - [x] 3.2 `api/app/core/db.py` 에 래퍼 3종(`insert_walk_in_encounter`(1532~)·`fetch_encounters`(1602~) 패턴 미러, 전부 `_run_authed(sub)` 안 — `authenticated_conn` GUC 주입으로 권한 재평가·감사 actor·RLS 일관):
    - `insert_medical_record(sub, *, encounter_id, author_id, subjective, objective, assessment, plan) -> asyncpg.Record`: ① `_op` 안에서 **encounter 존재·활성 검증**(walk-in 패턴): `select status, is_active from public.encounters where id=$1` → 미존재 `raise NotFoundError("내원을 찾을 수 없습니다.")`(→404). ② `insert into public.medical_records(encounter_id,author_id,subjective,objective,assessment,plan) values($1,...,$6) returning <컬럼>`. FK 위반(23503) try/except → `AppError(code="invalid_reference",status_code=422)` 백스톱(insert_walk_in 선례 — `_map_pg_sqlstate` 미매핑 FK 는 503 오분류). `assert row is not None`. ⚠️ **status 하드 게이트는 두지 않음**(§결정 4 — 작성 윈도우 잠금은 deferred; 웹이 in_progress 에서만 노출).
    - `update_medical_record(sub, *, encounter_id, record_id, subjective, objective, assessment, plan) -> asyncpg.Record`: `update public.medical_records set subjective=$1,objective=$2,assessment=$3,plan=$4, updated_at=now() where id=$5 and encounter_id=$6 returning <컬럼>`(encounter_id 동반 = 경로 일관·교차 내원 갱신 차단). `row is None`(미존재/불일치) → `raise NotFoundError("진료기록을 찾을 수 없습니다.")`(→404). **author 스코프 강제는 미적용**(같은 내원 내 갱신은 권한 보유 의사면 허용 — 작성자 스코프는 웹 UX 가 활성 기록 선택으로 보장; 서버 단 author 강제는 addendum/대리수정 차단이라 over-restrictive). updated_at 갱신 = 감사 'update' 행.
    - `fetch_medical_records(sub, encounter_id) -> list[asyncpg.Record]`: `select <컬럼> from public.medical_records where encounter_id=$1 and is_active=true order by created_at desc limit 200`(최근순·한 내원 기록 수 적음·안전 상한). 페이지네이션 불요.
  - [x] 3.3 `api/app/services/encounters.py` 에 서비스 3종(`_to_encounter` 매핑 패턴 미러):
    - `create_medical_record(sub, encounter_id, payload: MedicalRecordWrite) -> MedicalRecordResponse`: `row = await db.insert_medical_record(sub, encounter_id=encounter_id, author_id=sub, subjective=payload.subjective, ...)` → `_to_medical_record(row)`. ⚠️ author_id = `sub`(작성자 = 호출 의사).
    - `update_medical_record(sub, encounter_id, record_id, payload) -> MedicalRecordResponse`.
    - `list_medical_records(sub, encounter_id) -> list[MedicalRecordResponse]`.
    - `_to_medical_record(row) -> MedicalRecordResponse` 헬퍼(`MedicalRecordResponse.model_validate(dict(row))`).
  - [x] 3.4 `api/app/api/v1/encounters.py` 라우트 + 의존성(모듈 로드 시 1회 생성 — 기존 `require_encounter_*` 옆): `require_medical_record_write = require_permission("medical_record.write")` · `require_medical_record_read = require_permission("medical_record.read")`.
    - `POST "/{encounter_id}/medical-records"` → `create_medical_record(encounter_id: UUID, payload: MedicalRecordWrite, user=Depends(require_medical_record_write)) -> MedicalRecordResponse` (status 201). docstring: SOAP 기록 생성(autosave 첫 저장), 권한 403·미존재 내원 404·FK 422.
    - `PUT "/{encounter_id}/medical-records/{record_id}"` → `update_medical_record(...) -> MedicalRecordResponse`(autosave 전체 교체 — clinical-profile PUT 선례). 권한 403·미존재 기록 404.
    - `GET "/{encounter_id}/medical-records"` → `list_medical_records(encounter_id: UUID, user=Depends(require_medical_record_read)) -> list[MedicalRecordResponse]`(작은 sub-collection → 직접 배열, `GET /patients/{id}/encounters` 선례). ★ 읽기 게이트 = `medical_record.read`(encounter.read 아님 — §결정 2).
    - ⚠️ **라우트 순서**: 기존 정적/액션 경로(`/{encounter_id}/register`·`/call`·`/start-consult`)와 메서드·하위경로가 달라 충돌 없음. `_map_pg_sqlstate`(42501→403·PT404→404) 재사용 — **신규 SQLSTATE 매핑 코드 0**.

- [x] **Task 4 — Web: SOAP ledger 컴포넌트 + autosave(스테일 탭 가드) + 허브 배선 (AC1, AC2, AC3)**
  - [x] 4.1 `web/src/lib/encounters/medical-records.ts`(신규 — 진료 도메인 lib): `MedicalRecord` 타입(snake_case: `id`·`encounter_id`·`author_id`·`subjective`·`objective`·`assessment`·`plan`·`is_active`·`created_at`·`updated_at`, 전부 `string | null` 적절히) · `SoapPart` = `"subjective"|"objective"|"assessment"|"plan"` · `fetchMedicalRecords(encounterId): Promise<MedicalRecord[]>`(GET) · `createMedicalRecord(encounterId, body): Promise<MedicalRecord>`(POST) · `updateMedicalRecord(encounterId, recordId, body): Promise<MedicalRecord>`(PUT). `apiFetch<T>("/v1/encounters/"+id+"/medical-records", {...})` 패턴(client.ts — Bearer 자동·`/v1` 접두는 호출부). **전 경로 snake_case 유지**.
  - [x] 4.2 `web/src/components/encounters/soap-ledger.tsx`(신규, `"use client"`): props `{ encounter: Encounter }`(patient-banner 패턴 — 허브가 내림). 동작:
    - **로드(마운트)**: `fetchMedicalRecords(encounter.id)`(patient-banner.tsx 의 `useCallback`+`useEffect`+error/skeleton 미러). 활성 편집 대상 = **현재 임상의의 가장 최근 기록**(`author_id === 현재 세션 uid`; 세션 uid = `supabase.auth.getSession()` 의 user id — users.id=auth uid 동치). 없으면 **새(미저장) 초안**. 타 임상의·이전 기록 = 읽기전용 이력 목록(작성자·시각, 선택적 펼침).
    - **ledger 렌더(AC1)**: 4 파트 S/O/A/P. 헤더 행 = 토큰 배지(`bg-status-inprogress/12 text-status-inprogress` 등 — DESIGN.md badge-colors 매핑) + 한글(주관적/객관적/평가/계획) + 영문(Subjective/…) + 설명어 + 우측 액션 영역. 본문 행 = `<textarea>` `min-h-[132px]`(또는 `soap-input-min-height` 토큰) `cursor-text`, hover `surface-muted`, **포커스/입력 중 좌측 3px teal 액센트 + 옅은 teal 틴트**(before:left-0 before:w-[3px] before:bg-primary + `bg-[color-mix(...)]` — sidebar.tsx:33 액센트 패턴 미러, 음영 비의존), placeholder `text-muted` 가이드. full-bleed(`-mx-4` 류로 섹션 폭 가로 rule, 좌우 테두리 제거). **빈 파트 = 글리프/"비어 있음" 라벨**(색 단독 금지). `:focus-visible` 링은 전역 globals.css(자동).
    - **autosave(AC2)**: 입력 변경 시 dirty 추적 → **바닐라 `setTimeout`(~1500ms) + cleanup**(use-encounters-realtime.ts·patient-search-command.ts 디바운스 패턴 — 신규 훅 불요). 발화 시 **① `isActiveEncounter(encounter.id)` 확인**(`@/lib/encounters/active-session` — false 면 저장 거부·return, UX-DR21) **② 활성 기록 없고 내용 비어있지 않으면 `createMedicalRecord`(POST)→반환 id 보관 ③ 있으면 `updateMedicalRecord`(PUT)**. 성공 시 저장시각 state 갱신. **인디케이터 = `aria-live="polite"`** div "자동 저장됨 · {HH:mm}"(`toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Seoul"})` — encounter-hub `timeHmKST` 패턴). 저장 전 = "변경 시 자동 저장됩니다". 실패 403/404/네트워크 → sonner 토스트(한국어)·**raw 임상텍스트 미노출**·superseded 면 무토스트(허브 배너가 안내).
    - **새 진료기록(AC3)**: "새 진료기록" 버튼 → 활성 기록 초기화(미저장 초안) + ledger 클리어; 다음 입력이 새 행 POST. 직전 기록은 이력 목록으로 이동.
    - **키보드**: 파트 간 이동은 **Tab/Shift+Tab**(textarea 내부는 화살표가 커서 이동이라 roving-tabindex 부적합 — UX-DR19 "복합 위젯 화살표"는 비-텍스트 위젯[slot-grid·RBAC] 대상, 다중행 텍스트 입력은 표준 Tab 순서 S→O→A→P 가 정석). 논리적 탭 순서·`:focus-visible` 링 보장. (이 편차는 §결정 6 에 근거 명시.)
  - [x] 4.3 `web/src/components/encounters/encounter-hub.tsx`(UPDATE): in_progress 분기의 **중앙 SOAP placeholder `<section>`(현 162~167행)을 `<SoapLedger encounter={encounter} />` 로 교체**. **배너·좌 컨텍스트 패널·우 오더 placeholder(168~171)·헤더·세션 가드 배너(conflict/superseded)·로드/에러/비-in_progress 분기는 그대로 보존**(파괴 변경 금지 — 4.4 Patch3 비-in_progress 가드 유지). grid `md:grid-cols-[280px_1fr_320px]` 중앙 1fr 이 ledger 슬롯(이미 정사이즈).

- [x] **Task 5 — 시드: doctor `medical_record` 권한 grant (AC5)**
  - [x] 5.1 `supabase/seed.sql` 의 doctor grant 블록(seed.sql:121~132, 4.5 블록) 뒤에 **신규 블록 추가**: doctor 역할에 **`medical_record.write` + `medical_record.read`** grant(`join permissions p on p.code in ('medical_record.write','medical_record.read') where r.code='doctor' on conflict do nothing`). 주석: 진료 허브 SOAP 작성·조회 = 의사 핵심 직무(Story 4.6). ★ 프로덕션 런타임 grant 는 1.7 매트릭스 UI 소유(데모/통합테스트 전용 — 운영 db push 미반영). 상단 계정 주석(seed.sql:15 doctor 줄)에 "medical_record.write/read 추가(4.6)" 갱신.
  - [x] 5.2 reception/nurse **무변경**: nurse = 무권한 baseline 유지(회귀 검증 계정 — medical_record.write/read 둘 다 미보유 → 403). reception 은 SOAP 권한 미부여(의사 임상기록 — 원무 직무 아님, §결정 2).
  - [x] 5.3 `supabase db reset` 후 psql: doctor=`medical_record.write`/`medical_record.read`/`encounter.read`/`encounter.start`/`patient.read` true, nurse=`medical_record.*` false, admin=`medical_record.read` true(0013 boot grant).

- [x] **Task 6 — 테스트: 회귀 baseline + SOAP CRUD·1:N·autosave·감사 마스킹 (AC2, AC3, AC4, AC5)**
  - [x] 6.1 **무권한 baseline 확인**: `api/tests/test_encounters_integration.py` 의 기존 `nurse_token`/`nurse_id` 픽스처 재사용(4.4 신설). doctor 가 medical_record.* 를 받아도 **기존 encounter 회귀 테스트(forbidden_without_read/start)는 무영향**(비중첩 권한 — 4.4·4.5 검증 패턴) 확인.
  - [x] 6.2 **SOAP 권한 경계(신규, integration)**: ① `POST /v1/encounters/{id}/medical-records` — doctor → 201 + `author_id`==doctor uid·SOAP 필드 반영; nurse → **403**(medical_record.write 미보유); 미존재 내원 id → 404. ② `PUT /v1/encounters/{id}/medical-records/{rid}` — doctor → 200 + 전체 교체; nurse → 403; 미존재 record → 404. ③ `GET /v1/encounters/{id}/medical-records` — doctor → 200; **nurse → 403**(medical_record.read 미보유). (내원 생성은 reception/admin walk-in 헬퍼 재사용, start_consult 로 in_progress 전이 후 SOAP 작성 — 4.4 헬퍼.)
  - [x] 6.3 **1:N + autosave 의미(신규, integration)**: 같은 내원에 doctor 로 `POST`(기록 1) → `PUT`(기록 1 갱신, 전체 교체 — 일부 필드 None 보냄 → 해당 필드 null 확인) → `POST`(기록 2) → `GET` 길이 2·최근순·각 author_id=doctor·`is_active=true` 확인. 빈 문자열 → None 정규화 단언(`""` 미적재).
  - [x] 6.4 **감사 마스킹(AC4 — 서버 unit + 통합)**: `services/audit.py` 마스킹 단위 테스트에 `mask_snapshot({"subjective":"두통 3일","objective":"BP 140/90","assessment":"고혈압 의증","plan":"암로디핀","encounter_id":"...","author_id":"...","is_active":true}, "medical_records")` → SOAP 4종 `●●●●`·비민감(encounter_id·author_id·is_active) 노출·키 보존 단언. 가능하면 **감사 조회 통합**(admin `GET /v1/admin/audit-logs` 류 — 1.10 뷰어): SOAP 작성 후 감사 행의 after_data SOAP 값이 마스킹됨 확인(서버 1차 권위). 웹 `audit.test.ts`(line 20 키 루프)에 SOAP 4종 추가.
  - [x] 6.5 **권한 카탈로그 정합 회귀**: `test_admin_role_has_all_permissions`(test_migrations_identity.py) — 0013 admin boot grant 미적용 시 실패 → **db reset 후 통과 확인**. `test_permission_code_format` 은 `medical_record.read` 형식 통과(자동). 권한 count 하드코딩 단언 부재 확인.
  - [x] 6.6 **Web 유닛(vitest)**: `web/src/lib/encounters/medical-records.test.ts` — `fetchMedicalRecords`/`createMedicalRecord`/`updateMedicalRecord` URL·메서드·반환. `soap-ledger.test.tsx`(가능 범위): ① 4 파트 배지·라벨·placeholder 렌더 ② 빈 파트 "비어 있음" 표시 ③ autosave 인디케이터 `aria-live="polite"` ④ **`isActiveEncounter` false(superseded) 시 저장 호출 미발생**(active-session 모킹 — UX-DR21 핵심) ⑤ 작성자 스코프(타 author_id 기록은 활성 편집 대상 아님). (실시간·풀 브라우저 E2E·autosave 디바운스 타이밍 통합 = Post-MVP — 과도 명세 금지, 4.3/4.4/4.5 선례.)

## Review Findings

_코드리뷰 2026-06-21 (Blind Hunter / Edge Case Hunter / Acceptance Auditor 3레이어 병렬, 실패 레이어 0). 수렴 신호: **autosave in-flight 중 입력 유실(임상 기록 손실)**이 3레이어 모두 지적. Acceptance Auditor: AC1~AC5·설계결정 §1~§6·스코프 경계 전부 충족, High 위반 0(AC4 마스킹 정밀성·AC5 RBAC/회귀는 별도 검증으로 satisfied). 분류: patch 3·defer 8·dismiss 7._

- [x] [Review][Patch] autosave in-flight 중 입력 유실 + create→update 이중 POST 창 (성공 시 `setDirty(false)` 가 저장 중 들어온 키 입력을 지움·inFlight 충돌 시 재예약 없음) [web/src/components/encounters/soap-ledger.tsx doSave+디바운스 effect] [blind+edge+auditor] — **적용:** `dirty` 플래그 제거 → `lastSavedRef`(직렬화 직전저장값) 비교 기반 디바운스 + `valuesRef`/`activeIdRef`(최신값 ref) + `pendingRef`(저장 중 변경 큐잉 후 finally 에서 `doSaveRef` 로 이어 저장) + create 직후 `activeIdRef` 동기 갱신(이어지는 저장=PUT, 이중 POST 차단). 회귀 테스트 신규(저장 중 입력 → 후속 PUT 최신값 반영·create 1회).
- [x] [Review][Patch] autosave 가 기존 기록을 전부-빈 값으로 덮어쓸 수 있음(update 경로 `hasContent` 가드 부재 — 텍스트 전체 삭제 후 1.5s 정지 시 PUT all-null 로 노트 wipe) [web/src/components/encounters/soap-ledger.tsx doSave] [blind] — **적용:** `doSave` 가 create·update 양쪽에서 `if (!hasContent(snapshot)) return` → 빈 내용은 생성·덮어쓰기 안 함(기존 노트 보존). 빈 파트→빈값으로 노트가 조용히 wipe 되지 않음.
- [x] [Review][Patch] SOAP 기록 정렬 tiebreaker 부재(`order by created_at desc` 단독 → 동일 타임스탬프 시 비결정적·테스트 flake 가능) [api/app/core/db.py fetch_medical_records] [blind+edge] — **적용:** `order by created_at desc, id desc`(id 타이브레이커 — 동일 타임스탬프 결정적 정렬).
- [x] [Review][Defer] PUT 전체 교체에 낙관적 잠금 부재(동시 작성자 lost update) [api/app/core/db.py update_medical_record] — deferred, 교차절단(임상 프로필 PUT 동시성 deferred-work 와 동형)·§6 author 스코프 비강제 by-design·세션당 활성내원 1개 가드가 동일 브라우저 완화. [blind+edge]
- [x] [Review][Defer] `update_medical_record` 가 `is_active` 미검사(soft-deleted 기록도 갱신 가능) [api/app/core/db.py] — deferred, medical_records soft-delete 플로우 부재(도달 불가)·patients GET/UPDATE is_active 미필터 deferred 와 동형. [blind]
- [x] [Review][Defer] superseded 탭에서 SoapLedger 가 편집 가능 유지·ledger 자체 피드백 없음·재활성화 후 자동 재저장 없음 [web/src/components/encounters/soap-ledger.tsx · encounter-hub.tsx] — deferred, 허브가 상단에 superseded 배너+재활성화 버튼 노출(사용자 신호 존재)·안전속성(오환자 쓰기 차단)은 강제됨·ledger 레벨 표시는 nice-to-have. [edge]
- [x] [Review][Defer] 전부-빈 POST 가 서버에서 빈 행 생성(직접 API) [api/app/services/encounters.py · api/app/core/db.py insert_medical_record] — deferred, 웹은 hasContent 가드(patch 후)·스키마가 partial 허용 의도·유일 소비처=웹. [edge]
- [x] [Review][Defer] `fetch_medical_records` limit 200 무신호 절단(4.5 no-silent-cap 와 불일치) [api/app/core/db.py] — deferred, 한 내원 200 기록은 도달 불가(4.5 의 100 은 환자 평생 내원이라 더 도달 가능). [edge]
- [x] [Review][Defer] "새 진료기록" 이 미저장 편집을 flush 없이 폐기 [web/src/components/encounters/soap-ledger.tsx handleNewRecord] — deferred, 스펙 명시 동작("활성 기록 초기화(미저장 초안)")·1.5s 소창·patch 후 autosave 신뢰도 향상. [edge]
- [x] [Review][Defer] full-bleed `-mx-4`(좌우 테두리 없는 열린 캔버스) 미적용 — 카드 박싱(UX-DR11 시각 충실도) [web/src/components/encounters/soap-ledger.tsx] — deferred, 기능적 UX-DR11 요소(1열 ledger·hairline·배지·132px·teal 액센트·빈상태) 전부 구현·"열린 캔버스 vs 카드"=Low 시각. [auditor]
- [x] [Review][Defer] SOAP 쓰기에 서버측 status 게이트 없음(비-in_progress 내원도 직접 API 작성 가능) [api/app/core/db.py] — deferred, §4 설계결정(작성 윈도우 잠금 deferred·웹이 in_progress 게이트). by-design. [edge+auditor]

## Dev Notes

### 🎯 핵심 설계 결정 (이 스토리가 새로 확정)

1. **`medical_records` 테이블 = 0013(다음 순번) — SOAP 4 컬럼 + 1:N, 진단/오더는 별도 스토리.** 아키텍처·에픽 본문은 `0008_clinical.sql` 에 `medical_records(SOAP)` + `encounter_diagnoses` 를 **합쳐** 그렸으나, ① 마이그레이션 번호가 드리프트해 **실제 다음 순번은 0013**(0008=masters_ci_unique·0009=patients·0010=encounters·0011=encounter_call·0012=patient_reveal; glossary §177·185·187·260) ② 스토리별 마이그레이션 원칙상 **4.6 = `medical_records`(SOAP) 만**, `encounter_diagnoses`(주/부상병·`diagnosis.attach`)는 **4.7 소유(별도 0014)** 로 분리한다. SOAP 컬럼 = `subjective`/`objective`/`assessment`/`plan`(전부 nullable — 일부만 채운 기록 허용·실제 차팅 현실). 1:N(FR-041)은 `encounter_id` FK + 다행 적재로 충족.

2. **읽기 권한 = 신규 `medical_record.read`(encounter.read 재사용 기각) — 최소권한·임상 경계.** SOAP 는 **의사의 임상 문서**다. GET 게이트로 기존 `encounter.read`(원무·간호 보드용)를 재사용하면 **원무가 의사 SOAP 를 열람**하게 된다(프라이버시 경계 침해). 따라서 0013 이 **신규 `medical_record.read` 권한**을 추가하고 RLS staff 정책·API GET 둘 다 이를 게이트로 쓴다(의사·관리자만). **대가**: 신규 권한 → **0013 admin boot grant 재실행 필수**(0002 cross-join 은 후행 권한 미포함 — 누락 시 `test_admin_role_has_all_permissions` 회귀; 0010·0012 가 겪은 함정). **쓰기는 기존 `medical_record.write`(0002:91, admin cross-join 으로 이미 admin 보유) 재사용** → 쓰기 측은 신규 권한·boot grant 불요(API 에이전트가 권한 `encounter.write_note` 신설을 제안했으나 **0002 에 이미 `medical_record.write` 가 있어 기각** — 재사용이 정석). 이 프로젝트의 PII/임상 경계 posture(reveal 게이트·mask_snapshot)와 일관된 least-privilege 선택.

3. **감사 마스킹 청산 = SOAP 자유텍스트의 `_SENSITIVE_KEY` 등록(서버 + 웹 동기).** `0010_encounters.sql:52~53` 은 "주호소·증상·진단 등 건강민감 자유텍스트를 encounters 에 두지 않는다 → 감사 스냅샷 건강정보 유입 차단(3.6 마스킹 드리프트 회피)"고 명시했다. **4.6 의 `medical_records` 가 바로 그 자유텍스트의 소유처**다. 감사 트리거(0004)는 전체 행을 스냅샷하므로 **SOAP 평문이 처음으로 `audit_logs` 에 적재**된다(임상 프로필 allergies/notes 가 0009/3.2 에서 그랬듯 — deferred-work §191 이 추적). Story 3.6 의 **읽기시점 마스킹**(`services/audit.py mask_snapshot` 필드명 기반·table-agnostic)이 이를 가리려면 **컬럼명 `subjective|objective|assessment|plan` 을 `_SENSITIVE_KEY` 에 등록**해야 한다 — 서버(1차 권위)와 **웹 거울 `lib/admin/audit.ts SENSITIVE_KEY`**(방어심층) **양쪽 동시**(두 파일 주석이 동기 유지를 경고 — 한쪽만 바꾸면 드리프트). 이는 신규 마스킹 인프라가 아니라 **3.6 패턴의 SOAP 확장**(clinical-profile 건강민감 키와 동형). append-only 원본은 보존, 응답·로그만 마스킹.

4. **쓰기 = service_role 직접 INSERT/UPDATE(RPC 아님) + autosave PUT 전체 교체.** SOAP 는 **상태머신·복잡 불변식이 없는 자유텍스트**라 전이 RPC(register/start_consult)와 달리 **walk-in INSERT 패턴**(service_role 직접 + `_run_authed` + 내원 존재검증 + FK 23503→422 백스톱)이 적합하다. autosave 갱신은 **PUT 전체 교체**(clinical-profile `PUT /clinical-profile` 선례 — ledger 가 4 파트 전부 보유하므로 부분 PATCH 불요). **status 하드 게이트는 두지 않음**: 웹은 in_progress 에서만 ledger 를 노출하지만, 서버가 status='in_progress' 를 강제하면 (미래) 완료 후 addendum/정정을 막는다 → **작성 윈도우 잠금은 deferred**(§이월). 내원 존재(404)·FK(422)만 검증. autosave 는 매 저장이 'update' 감사 행을 만들지만 디바운스(1.5s)+클라 dirty-체크로 노이즈 제한(감사 볼륨 코얼레싱=미래 최적화, §이월).

5. **autosave 스테일 탭 가드 = `isActiveEncounter()` 소비(UX-DR21 청산).** UX-DR21·EXPERIENCE.md:185 는 "세션당 활성 내원 1개, 스테일/비-포그라운드 내원엔 autosave 거부 — 잘못된 환자의 열린 SOAP 에 조용히 저장 방지"를 요구한다. 4.4 가 `lib/encounters/active-session.ts`(localStorage `pms.active_encounter` + `isActiveEncounter()`)와 허브 superseded 배너를 만들며 **"4.6 SOAP autosave 가 isActiveEncounter() 를 소비"** 라고 주석으로 예약했다(active-session.ts:4). **4.6 가 그 소비처**다 — autosave 는 매 저장 전 `isActiveEncounter(encounter.id)` 를 확인하고 false 면 저장을 건너뛴다(허브가 이미 보류 배너 노출). 이는 409 전이 충돌(다른 단말 상태변경)과 **별개**의 안전선(조용한 오환자 차팅 차단).

6. **작성자 스코프(웹) + Tab 키보드(roving-tabindex 편차).** ledger 의 활성 편집 대상 = **현재 임상의의 최근 기록**(타 임상의 기록 덮어쓰기 방지 — 스테일 탭 가드와 동류의 임상 안전; 세션 uid=author_id 매칭, users.id=auth uid 동치). 서버 update 는 author 강제를 두지 않음(같은 내원 내 권한자 갱신 허용 — addendum/대리수정 여지). **키보드**: UX-DR19 는 복합 위젯에 roving-tabindex/화살표를 요구하나, **다중행 textarea 는 화살표가 커서 이동이라 roving 부적합** → SOAP 파트 간은 **표준 Tab 순서(S→O→A→P)** + `:focus-visible` 링 + 좌측 teal 액센트가 정석(roving-tabindex 는 slot-grid·RBAC 매트릭스 등 비-텍스트 2D 위젯 대상). 이 편차는 의도적이며 접근성을 더 잘 만족(Tab=텍스트 입력 위젯의 자연 순회).

### 🔗 이월 인수 (이 스토리에서 청산 / 유지)

- **청산:**
  - SOAP `medical_records` 미구축(마이그 0001~0012 부재) → **4.6 이 첫 생성**(0013). 4.5 좌패널 이력의 "진단·처방 per-visit 빈-상태" 중 SOAP 작성 경로 가동.
  - 감사 SOAP 건강민감 유입(0010:52~53 가 회피·deferred-work §191 추적) → **4.6 이 `_SENSITIVE_KEY` 등록으로 청산**(3.6 마스킹의 SOAP 확장).
  - 4.4 → 4.6: `lib/encounters/active-session.ts:4` 의 "4.6 SOAP autosave 가 isActiveEncounter() 소비" 예약 → 본 스토리가 소비.
  - 4.5 → 4.6: 진료 허브 중앙 SOAP placeholder(encounter-hub.tsx:162~167 "Story 4.6") → 본 스토리가 채움.
- **유지(이 스토리 밖 — 명시 이월):**
  - **KCD 진단 부착(`encounter_diagnoses`·`diagnosis.attach`·주/부상병·주상병 미지정 완료 422 게이트)** → **4.7**(별도 마이그 0014). 4.6 의 `complete_encounter`(0010)는 **무변경**(주상병 게이트는 4.7 이 추가).
  - **오더(처방·검사·처치) 우 pane** → Epic 5. 4.6 우 pane = placeholder 유지.
  - **활력징후 좌패널 실데이터** → Epic 5(5.6). 4.5 빈-상태 유지.
  - **약물 상호작용 can't-miss** → Epic 5(5.5 오더 패널 교차검증).
  - **진료 완료 → 수납 액션바·flow stepper** → Epic 7(수납). 4.6 은 SOAP 작성만(명시 완료는 후속).
  - **SOAP 작성 윈도우 잠금(완료 후 정정=addendum 만)·감사 볼륨 코얼레싱·낙관적 동시성(동시 편집 lost-update)** → 교차절단 하드닝 deferred(§결정 4·deferred-work 임상 프로필 PUT 동시성 항목과 동류).
  - **SOAP 구조화(템플릿·스마트폼·음성)·진료 허브 URL `/encounter/{date}/{chart_no}` 원문 정합(불투명 id 유지)** → 미래/4.4 이월.

### 🏗️ 아키텍처 준수 · 코드 패턴 (⚠️ 산출물 문구보다 실제 코드 우선)

- ⚠️ **현행 코드 우선**: web 은 **TanStack Query/shadcn/Zustand 미사용** → **Base UI + `useState`/`useEffect`/`useCallback` + `apiFetch` + `sonner`**, `database.types.ts` 미생성(타입 수동·snake_case). SOAP ledger 로드·autosave 디바운스도 바닐라 `setTimeout`+cleanup(use-encounters-realtime.ts·patient-search-command.ts 선례 — **신규 디바운스 훅 금지**).
- **JSON 전 경로 snake_case**(TS 도 camelCase 변환 금지) — `MedicalRecord`/요청·응답 `{subjective,objective,assessment,plan,encounter_id,author_id}` 전부 snake_case. 변수/함수만 camelCase(`fetchMedicalRecords`·`createMedicalRecord`·`SoapPart`).
- **무ORM**: asyncpg + 직접 SQL(INSERT/UPDATE/SELECT) — `insert_walk_in_encounter`(service_role 직접 + FK 백스톱) 동형. ORM 모델·Alembic 금지. 스키마는 0013 마이그레이션 단일 소유(FastAPI DDL 금지).
- **불변식 DB 소유**: RLS(`has_permission('medical_record.read')`·환자 self)·감사 트리거(0004)·권한 평가는 **DB 안**. FastAPI `require_permission` 은 방어심층 1차선. 상태머신·감사 Python 재구현 금지.
- **에러 봉투**: `{error:{code,message,detail}}` + HTTP(403 권한/404 미존재 내원·기록/422 FK·검증/503). `code`=영문·`message`=한국어. **SQLSTATE 매핑 재사용**(`_map_pg_sqlstate` 42501→403·PT404→404, db.py:48~63 — **신규 매핑 0**). FK 23503→422 는 INSERT try/except 백스톱(walk-in 선례). **raw 임상텍스트는 detail·로그·토스트 금지**.
- **액션/리소스 엔드포인트**: 쓰기=`POST`(생성)·`PUT`(전체 교체 갱신) sub-resource(`/{encounter_id}/medical-records[/{record_id}]`). 조회=`GET`. `/api/v1` prefix·`root_path` 전파·JWKS(`aud=authenticated`)+`require_permission` 의존성(모듈 로드 시 1회).
- **PII/건강민감 경계(엄수)**: 임상텍스트는 **응답 바디로만**(URL·쿼리·로그·토스트·딥링크·실시간·에러봉투 금지). 라우트=불투명 `encounter_id`/`record_id`(UUID). **감사 스냅샷 = mask_snapshot 마스킹**(AC4). 실시간 미사용(autosave=FastAPI 직접 — 신규 publication 0).
- **접근성(UX-DR20·UX-DR11)**: autosave 인디케이터 `aria-live="polite"`. SOAP 입력 중 좌측 teal 액센트(음영 비의존)·`:focus-visible` 링·빈 파트 글리프+라벨(색 단독 금지)·placeholder 단독 의존 금지·`prefers-reduced-motion` 존중. 422 검증은 인라인+포커스+`aria-invalid`(현 스코프엔 길이 상한 외 강한 검증 적음).
- **금액 무관**(비-정산). 날짜=timestamptz UTC→KST `toLocaleTimeString("ko-KR",{timeZone:"Asia/Seoul",hour12:false})`(허브 `timeHmKST` 재사용 — "자동 저장됨 · 14:32").

### 📦 라이브러리 · 프레임워크 (신규 의존성 0)

- **신규 라이브러리 금지**. 아이콘 lucide(기존 — 저장 인디케이터 `Check`·파트 액션 등), 토스트 sonner(기존), 폼 라이브러리 불요(textarea 직접 + 바닐라 state·autosave). 디바운스=바닐라 `setTimeout`.
- ⚠️ **Next.js 16 / React 19.2 — `web/AGENTS.md` 경고**: "This is NOT the Next.js you know." 클라 컴포넌트·`useEffect`(로드/디바운스)·이벤트 핸들러 작성 전 `node_modules/next/dist/docs/` 확인. 허브는 서버 페이지(가드)+클라 셸 분리 유지(encounter-hub.tsx 는 이미 `"use client"`; soap-ledger 도 클라).
- **Supabase**: SOAP CRUD 는 FastAPI(service_role) 경유 — 실시간 무관. 세션 uid 는 `supabase.auth.getSession()`(작성자 스코프). 감사 트리거·has_permission 은 기존 DB 자산.

### 📂 파일 구조 (정확 경로)

**신규:**
- `supabase/migrations/0013_medical_records.sql` (`medical_records` 테이블 + `medical_record.read` 권한 + admin boot grant + RLS + 감사 트리거 + GRANT)
- `web/src/components/encounters/soap-ledger.tsx` (중앙 SOAP ledger — 4 파트 작성·autosave·스테일 탭 가드·1:N)
- `web/src/lib/encounters/medical-records.ts` (`MedicalRecord` 타입 + `fetchMedicalRecords`/`createMedicalRecord`/`updateMedicalRecord`)

**수정(UPDATE):**
- `api/app/core/db.py` (`insert_medical_record`·`update_medical_record`·`fetch_medical_records` 래퍼)
- `api/app/services/encounters.py` (`create_medical_record`·`update_medical_record`·`list_medical_records`·`_to_medical_record`)
- `api/app/schemas/encounters.py` (`MedicalRecordWrite`·`MedicalRecordResponse`)
- `api/app/api/v1/encounters.py` (POST/PUT/GET medical-records 라우트 + `require_medical_record_write`/`require_medical_record_read` 의존성)
- `api/app/services/audit.py` (`_SENSITIVE_KEY` 에 SOAP 4종 추가)
- `web/src/lib/admin/audit.ts` (`SENSITIVE_KEY` 에 SOAP 4종 추가 — 서버 거울 동기)
- `web/src/components/encounters/encounter-hub.tsx` (중앙 SOAP placeholder → `<SoapLedger>` 교체, 나머지 보존)
- `supabase/seed.sql` (doctor `medical_record.write`/`medical_record.read` grant + 계정 주석)
- `api/tests/test_encounters_integration.py` (SOAP CRUD·1:N·권한 경계 신규)
- `api/tests/test_audit*.py`(또는 services/audit 단위 테스트) (SOAP 마스킹 단언)
- `api/tests/test_migrations_identity.py` 영향 없음(통과 확인만 — admin boot grant 정합)
- `web/src/lib/admin/audit.test.ts` (키 루프에 SOAP 4종)
- (신규 웹 테스트) `web/src/lib/encounters/medical-records.test.ts`·`web/src/components/encounters/soap-ledger.test.tsx`

**구조 규칙**: `api/app/{core,api/v1,schemas,services}` · `web/src/{app/(staff),components/<feature>,lib,hooks}`. 파일 kebab-case, TS 변수/함수 camelCase·컴포넌트/타입 PascalCase. 마이그레이션 Supabase CLI 단일 소유(0013=다음 순번). 진료 허브 컴포넌트는 `components/encounters/`(4.3 신설) 하위. 진료 도메인 lib 는 `lib/encounters/`(active-session.ts 와 동거).

### 📖 기존 코드 읽기 (UPDATE — 착수 전 완독, 현 동작·보존 대상 파악)

1. **`supabase/migrations/0010_encounters.sql`** — encounters 컬럼(28~51)·status CHECK 6값·**RLS 패턴(277~293: staff=has_permission·self=patients 조인)**·GRANT posture(265~269)·신규 권한 insert + **admin boot grant(250~262)**·`complete_encounter`(164~190, **무변경**)·**자유텍스트 회피 주석(52~53 — 4.6 청산 대상)**. **미러**: `medical_records` RLS·GRANT·권한 insert·admin grant. **보존**: complete_encounter(주상병 게이트는 4.7).
2. **`supabase/migrations/0004_audit.sql`** — `audit_trigger_fn`(26~70: 전체 행 jsonb 스냅샷·actor `app.actor_id`→`auth.uid()`·target_id=`id`)·트리거 부착 패턴·**action CHECK(create/read/update/delete/login)**. **재사용**: `trg_medical_records_audit`. SOAP create/update 는 CHECK 통과.
3. **`supabase/migrations/0002_identity_rbac.sql`** (`:83~114`) — 권한 카탈로그(**`medical_record.write` 존재 91·`medical_record.read` 부재**)·admin cross-join(110~114, **후행 권한 미포함** → 0013 보완)·역할 정의. **변경 없음**(0013 이 read 권한·grant 추가).
4. **`supabase/migrations/0009_patients.sql`** — RLS self 패턴(`auth_uid`)·감사 트리거 인라인. **미러**: medical_records self 정책(encounters 조인).
5. **`api/app/core/db.py`** — `_map_pg_sqlstate`(48~63)·`authenticated_conn`(106~122: GUC 주입·set role 없음=service_role)·`_run_authed`(125~145)·**`insert_walk_in_encounter`(1532~1602: service_role 직접 INSERT·내원/환자 활성검증·FK 23503→422 백스톱)**·`fetch_encounters`(1602~)·`_ENCOUNTER_COLUMNS`. **미러**: SOAP 래퍼 3종(insert/update/fetch). **보존**: SQLSTATE 매핑·authed_conn 의미.
6. **`api/app/api/v1/encounters.py`** — 현 라우트(POST `""`·`/register`·`/call`·`/start-consult`·GET `""`·`/{id}`)·`require_encounter_*` 모듈 로드 패턴·docstring 컨벤션. **보존**: 기존 라우트·게이트. medical-records 3 라우트 동형 추가.
7. **`api/app/services/encounters.py`** — `create_walk_in_encounter`·`register_scheduled_encounter`·`_to_encounter`(매핑). **미러**: SOAP 서비스 3종·`_to_medical_record`.
8. **`api/app/schemas/encounters.py`** — `EncounterCreate`(20~25)·`EncounterResponse`(28~54, `ConfigDict(from_attributes=True)`·snake_case). **미러**: `MedicalRecordWrite`·`MedicalRecordResponse`. (clinical-profile `PatientClinicalProfileUpdate` 의 옵셔널 필드·빈→None 검증 패턴 `api/app/schemas/patients.py` 도 참조.)
9. **`api/app/services/audit.py`** (20~70) — **`_SENSITIVE_KEY`(26~31)·`mask_snapshot`(58~)·table-agnostic 필드명 마스킹·`_PII_NAME_TABLES`·웹 동기 경고 주석(24)**. **변경**: 정규식에 SOAP 4종. **보존**: 마스킹 의미·키 보존.
10. **`web/src/lib/admin/audit.ts`** (87~120) — **`SENSITIVE_KEY`(89~90)·`maskDeep`·서버 거울 경고 주석(87~88)**. **변경**: 정규식에 SOAP 4종(서버와 동일 문자열). `audit.test.ts:20` 키 루프 동기.
11. **`web/src/components/encounters/encounter-hub.tsx`** — 현 셸(로드·세션 가드 배너 conflict/superseded·비-in_progress 가드·배너·좌패널·**중앙 SOAP placeholder 162~167**·우 오더 168~171). **보존**: 전부. **변경**: 162~167 → `<SoapLedger encounter={encounter} />`.
12. **`web/src/lib/encounters/active-session.ts`** — **`isActiveEncounter(encounterId)`(64)·`readActiveEncounter`·`claimActiveEncounter`·storage 키 `pms.active_encounter`·주석(4) "4.6 autosave 소비"**. **소비**: autosave 가 `isActiveEncounter` 게이트. **변경 없음**.
13. **`web/src/components/encounters/patient-banner.tsx`** — **현 동작**: `{encounter}` props·`useCallback`+`useEffect`+error/skeleton 로드·`aria-live` 사용(polite reveal·assertive 알레르기). **미러**: soap-ledger 로드·aria-live 패턴.
14. **`web/src/hooks/use-encounters-realtime.ts`**(50~53) · **`web/src/components/shell/patient-search-command.tsx`**(60~88) — **바닐라 `setTimeout` 디바운스 + cleanup 패턴**. **미러**: autosave 디바운스(~1500ms).
15. **`web/src/lib/reception/encounters.ts`**(`Encounter` 타입 22~) · **`web/src/app/globals.css`**(상태 토큰 `--status-inprogress`·`--primary`·`--status-received-ink`·`--status-done`·`soap-input-min-height`) · **`web/src/components/shell/sidebar.tsx`**(33, 좌측 3px teal 액센트 `before:` 패턴). **재사용**: Encounter 타입·SOAP 배지 토큰·액센트.
16. **`api/tests/test_encounters_integration.py`** — 픽스처(`admin_token`/`doctor_token`/`reception_token`/`nurse_token`·`nurse_id`·walk-in/start_consult 헬퍼)·권한 경계 테스트(forbidden_without_*·nurse baseline). **보존**: 격리·결정적 단언. SOAP CRUD·1:N·권한 경계 신규.

### 🎨 UX 스펙 (액션 가능 요약 — 출처 §References)

- **UX-DR11 soap-ledger**(DESIGN.md:141~152·291·EXPERIENCE.md:111): 진료 기록 섹션 = **full-bleed 1열 표**(섹션 폭 전체 가로 rule·좌우 테두리 없음·`margin 0 -16px`). 파트별 = 헤더 행(`{colors.background}` 틴트·S/O/A/P 컬러 배지[S=status-inprogress·O=primary·A=status-received-ink·P=status-done]·한글+영문+설명어·우측 액션) + 본문 행(`cursor:text`·**최소 높이 132px**`{spacing.soap-input-min-height}`·hover `surface-muted`·**포커스/입력 중=좌측 3px teal 액센트 + `color-mix(primary 5%,surface)` 틴트[음영 아님]**·placeholder `text-muted` 가이드[단독 의존 금지]). **빈 파트=글리프/"비어 있음" 라벨**(색 단독 금지).
- **autosave 인디케이터**(EXPERIENCE.md:111·151): "자동 저장됨 · {시각}"·**`aria-live="polite"`**. 명시 완료(진료 완료→수납)는 액션바=Epic 7(4.6 밖).
- **스테일 탭/다중 진료 가드**(EXPERIENCE.md:185·127·130): 세션당 활성 내원 1개·스테일/비-포그라운드 내원엔 **autosave 거부**(잘못된 환자 SOAP 오기록 차단)·포커스 복귀 시 reconcile. 409 전이 충돌과 별개.
- **키보드**(EXPERIENCE.md:153~154): 전 기능 키보드·논리 탭 순서(읽기 순서)·`:focus-visible` 링 항상. SOAP 좌측 teal 액센트는 추가 affordance. (다중행 textarea = Tab 순서 S→O→A→P, roving-tabindex 는 비-텍스트 2D 위젯 — §결정 6.)
- **고밀도 하한**(EXPERIENCE.md:164): 1366×768@125~150% — 3-pane 중앙(작성)이 가장 넓게. 본문 폰트 유지(밀도만 양보).
- **Flow B 의사 진료**(EXPERIENCE.md:221~230): 진료 시작→허브→배너 알레르기+좌패널(4.5)→**중앙 SOAP ledger O행 클릭→좌측 teal 액센트→빠른 기록→autosave 가 이미 저장**(4.6)→(4.7)KCD 진단→(Epic7)완료→수납.
- **거부 — 균일 카드화**(DESIGN.md:265·EXPERIENCE.md:172): SOAP=**테두리 없는 열린 캔버스**로 *대비* 강조(카드 박싱 아님). 진료기록=primary(가장 넓은 작성 공간·강한 본문 대비), 좌/우=quiet.
- **mockup**: `mockups/key-encounter-hub.html`(soap-ledger·diagnosis-block·order-panel — soap-ledger 시각 레퍼런스; diagnosis-block 은 4.7·order-panel 은 Epic5).

### 🧪 테스트 표준

- Python `pytest`(`api/tests/`, unit·integration). 검증 3중: 클라(빈→None·길이 표시) → 서버 `require_permission`+Pydantic(권위) → DB RLS `has_permission`+감사(최종선). 통합은 실 Supabase 토큰(seed 계정) — **db reset 으로 seed·0013 갱신 후 실행**(doctor medical_record grant·admin boot grant·nurse baseline 반영). DB/감사 마스킹은 `mask_snapshot` 단위 + 가능 시 감사 뷰어 통합으로 SOAP 마스킹 단언(서버 1차 권위). **회귀 0 확인**(전체 pytest + vitest). 골든 패스 E2E·풀 브라우저·autosave 디바운스 타이밍 통합 = **Post-MVP**(과도 명세 금지, project-context·4.3/4.4/4.5 선례). 웹 유닛=lib 헬퍼·ledger 렌더/빈 파트/aria-live/**스테일 탭 저장 거부(핵심)**/작성자 스코프 중심.

### Project Structure Notes

- **신규 마이그레이션 1건(0013)** — 다음 순번(0012 다음). 테이블 1 + 권한 1(`medical_record.read`) + RLS + 감사 트리거 + GRANT. `medical_record.write` 는 0002 기존(재삽입 금지). seed=grant 확장.
- 진료 허브 컴포넌트 `components/encounters/`(4.3~4.5 디렉터리) 하위. 진료 lib 는 `lib/encounters/`(active-session.ts 동거). 라우트 `(staff)/encounter/[encounterId]`(4.4, 변경 없음 — 중앙 콘텐츠만 교체).
- nav: 허브는 nav 미등재(진료 시작/계속으로 진입하는 contextual — 4.4 동일).
- 변이 가능 충돌: 없음. 0013 테이블·권한=비파괴(멱등 insert·`if not exists`). seed grant=멱등. soap-ledger·medical-records.ts=신규. 허브=중앙 pane 콘텐츠 교체(파괴 변경 없음·placeholder→실콘텐츠). `_SENSITIVE_KEY` 정규식 확장=마스킹 강화(노출 축소).
- glossary: `medical_record`(§34 테이블 개념 등재됨)·`medical_record.write`(0002)·`encounter.read`(0010) 등재. **신규 `medical_record.read` 권한 + `medical_records` 테이블(컬럼 SOAP 4종) + 엔드포인트 3종 + `MedicalRecordWrite`/`MedicalRecordResponse` 스키마를 `docs/glossary.md` 에 등재**(신규 식별자 규칙 — 등재 후 사용; 4.5 가 코드리뷰 patch 로 reveal 항목 등재한 선례). `subjective`/`objective`/`assessment`/`plan` 컬럼명은 SOAP 표준어(마스킹 키 정합 명시).

### References

- [Source: epics.md#Story-4.6] (`_bmad-output/planning-artifacts/epics.md:845-863`) — AC 원문(중앙 작성 SOAP ledger UX-DR11 full-bleed·teal 액센트·placeholder / autosave "자동 저장됨 · {시각}" polite / 복수 SOAP 1:N `0008_clinical.sql`[stale 번호]·FR-040·FR-041).
- [Source: epics.md#Epic-4-경계·FR] (`:50-52`, `:230-232`, `:745-749`, `:865-883`) — FR-040(SOAP)·FR-041(1:N)·4.7 진단 경계(4.6=SOAP 만, KCD/주상병=4.7)·Epic 4 흐름.
- [Source: prd.md] (FR-040 SOAP 작성·저장 / FR-041 한 내원 1:N 진료기록 / FR-242 민감정보 조회=감사 / NFR-041 건강민감 보호 / NFR-050 next-action·실시간 신선도 / NFR-051 역할 범위 완결 / NFR-060 Encounter 허브 컨텍스트 확장성).
- [Source: architecture.md] (`:34` 임상 기록 SOAP·1:N·A↔P 연계 / `:224` 진료 코어 SOAP·진단 / `:317` `0008_clinical.sql` medical_records[stale 번호→실제 0013] / `:390` 진찰·SOAP `(staff)/doctor` / `:401` 골든 패스 의사 SOAP→DB 감사 트리거 / `:194` 상태/부수효과=액션 엔드포인트 / `:253` 3-pane master canvas).
- [Source: ux-designs/DESIGN.md·EXPERIENCE.md·mockups] — soap-ledger(DESIGN:141~152·291·EXPERIENCE:111)·autosave polite(EXPERIENCE:111·151)·스테일 탭 가드(EXPERIENCE:185·127·130)·키보드(EXPERIENCE:153~154)·고밀도(164)·Flow B(221~230)·열린 캔버스(DESIGN:265·291·EXPERIENCE:172)·토큰 badge-colors(DESIGN:146)·soap-input-min-height(DESIGN:92)·mockup `key-encounter-hub.html`(soap-ledger). .decision-log.md(135~156): v1+SOAP 1열 ledger·full-bleed·입력 affordance·placeholder=보조가이드 확정 이력.
- [Source: 0010_encounters.sql] (`:52-53,164-190,250-293`) — 자유텍스트 회피 주석(4.6 청산 대상)·complete_encounter(무변경)·RLS/GRANT/admin boot grant 패턴(0013 미러).
- [Source: 0004_audit.sql] (`:26-70`) — `audit_trigger_fn`·action CHECK·target_id=id 계약. medical_records 트리거 재사용.
- [Source: 0002_identity_rbac.sql] (`:83-114`) — `medical_record.write` 존재·`medical_record.read` 부재·admin cross-join 후행 권한 미포함(0013 보완).
- [Source: 3-6-감사-스냅샷-서버측-pii-마스킹.md · api/app/services/audit.py · web/src/lib/admin/audit.ts] — `_SENSITIVE_KEY`/`SENSITIVE_KEY` table-agnostic 마스킹·서버↔웹 거울 동기 경고(SOAP 4종 추가 대상).
- [Source: 4-4-진료-대기열-진찰-시작.md · web/src/lib/encounters/active-session.ts] — 진료 허브 셸·`isActiveEncounter()`(autosave 가드)·localStorage `pms.active_encounter`·세션당 활성 내원 1개·doctor grant+nurse baseline 패턴·`_map_pg_sqlstate`/`_run_authed`/insert_walk_in FK 백스톱 재사용.
- [Source: 4-5-진료-허브-환자-배너-과거-이력-활력-컨텍스트.md] — 진료 허브 배너·좌패널(보존)·doctor 권한 grant + nurse 회귀 이관 패턴·glossary 등재 선례·빈-상태 스코프 무결성·clinical-profile PUT 전체 교체 선례.
- [Source: deferred-work.md] (`:48,191,198`) — 임상 프로필 PUT 동시성(SOAP 동시 편집 동류)·감사 건강민감 유입(긴급도 상승·SOAP 청산)·encounters hard-delete(자식 테이블 도래 = medical_records FK RESTRICT 보호).
- [Source: project-context.md] — 불변식 DB 소유·쓰기=FastAPI(service_role)/조회=Supabase·상태/부수효과=액션 엔드포인트·PII/건강민감 경계(로그·실시간·에러봉투 금지·라우트 불투명 id)·JSON snake_case 전 경로·감사 append-only·⚠️실제 코드(Base UI/useState/apiFetch·Zustand/TanStack/shadcn 미사용·database.types 미생성)>문구.
- [실제 코드] — `api/app/core/db.py`(`_map_pg_sqlstate`·`_run_authed`·`authenticated_conn`·`insert_walk_in_encounter`·`fetch_encounters`)·`api/app/api/v1/encounters.py`·`api/app/services/{encounters,audit}.py`·`api/app/schemas/encounters.py`·`web/src/components/encounters/{encounter-hub,patient-banner}.tsx`·`web/src/lib/encounters/active-session.ts`·`web/src/lib/admin/audit.ts`·`web/src/lib/reception/encounters.ts`·`web/src/app/globals.css`·`web/src/hooks/use-encounters-realtime.ts`·`supabase/migrations/{0002,0004,0009,0010}.sql`·`supabase/seed.sql`·`api/tests/test_encounters_integration.py`·`web/AGENTS.md`.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Opus 4.8, 1M context)

### Debug Log References

- `supabase db reset` — 0001~0013 클린 적용 + seed 갱신(doctor `medical_record.write`/`medical_record.read` grant + admin `medical_record.read` boot grant). DB 스모크(docker exec psql): ①권한 — admin/doctor=`medical_record.read`+`write` 보유·nurse/reception=둘 다 미보유 ②`medical_records` 컬럼 구조(SOAP 4종 nullable·encounter_id/author_id NOT NULL) ③RLS=true·정책 2(staff/self)·트리거 `trg_medical_records_audit` ④admin 29/29 전권(boot grant 정합) ⑤실데이터(환자→내원→SOAP): 감사 `create`=1·`update`=1·1:N=2건·`after_data.subjective` 평문(마스킹은 읽기시점) ⑥RLS — nurse(`medical_record.read` 미보유)=0행·doctor=2행. ⚠️ `set role authenticated` 는 트랜잭션 블록 안에서만(BEGIN/ROLLBACK) — RLS GUC 테스트 시 주의.
- API: `uv run pytest` → **375 passed, 9 skipped**(회귀 0; 4.5 baseline 364 → +11: SOAP CRUD/권한경계 8·1:N·빈문자열정규화·감사 + 감사마스킹 단위 1). `uv run ruff check .` 클린(Korean 폭 E501 = ruff 가 East-Asian-Wide 를 폭 2로 계산 → 줄바꿈으로 수정).
- Web: `npx vitest run` → **254 passed**(4.5 baseline 243 → +11: medical-records.test 3·soap-ledger.test 7·audit.test SOAP 1). `tsc --noEmit` 0 errors. `eslint src` 클린(렌더 중 ref 수정 → in-flight 가드를 콜백 내부로 이동). `next build` 성공(`/encounter/[encounterId]` 동적 라우트 유지).

### Completion Notes List

- **DB(0013) — `medical_records` 테이블 + 신규 `medical_record.read` 권한.** `0013_medical_records.sql`: 테이블(encounter_id 1:N·author_id·SOAP 4컬럼 `subjective`/`objective`/`assessment`/`plan` nullable·is_active) + 신규 권한 `medical_record.read`(+ **admin boot grant 재실행** — 0002 cross-join 후행 권한 미포함 함정 회피) + RLS(staff=`medical_record.read`·환자 self=encounters 조인) + GRANT(service_role CRUD·authenticated SELECT) + 감사 트리거(0004 `audit_trigger_fn` 재사용). ⚠️ **쓰기 권한 `medical_record.write` 는 0002:91 기존 재사용**(재삽입·신규 boot grant 불요). 마이그레이션 번호=실제 다음 순번 **0013**(에픽/아키 stale `0008` 무시).
- **감사 마스킹(AC4) — SOAP 자유텍스트 양쪽 등록.** `subjective|objective|assessment|plan` 을 서버 `services/audit.py _SENSITIVE_KEY`(line 28) + **웹 거울 `lib/admin/audit.ts SENSITIVE_KEY`**(line 90) **동시 추가**(드리프트 가드 — 양쪽 테스트 단언). 0013 트리거가 SOAP 평문을 audit 에 최초 유입 → 읽기시점 마스킹이 4 컬럼을 `●●●●` 로(키 보존). 0010:52~53 이 encounters 자유텍스트를 회피한 이유의 청산.
- **API — service_role 직접 INSERT/UPDATE(RPC 아님) + autosave PUT 전체 교체.** `POST /encounters/{id}/medical-records`(생성·`medical_record.write`)·`PUT .../{record_id}`(autosave 전체 교체·write)·`GET .../medical-records`(목록·`medical_record.read` — ★encounter.read 아님). db 래퍼 `insert_medical_record`(내원 존재 선검사 404·FK 23503→422 백스톱·status 게이트 없음 §결정4)·`update_medical_record`(id+encounter_id 일치·미존재 404)·`fetch_medical_records`(최근순·활성). 권한은 INSERT/UPDATE 직전 동일-txn 재평가(`_require_medical_record_write`, TOCTOU). `_map_pg_sqlstate` 재사용 — **신규 매핑 0**. 스키마 `MedicalRecordWrite`(POST·PUT 공용·빈→None)/`MedicalRecordResponse`.
- **Web — `soap-ledger.tsx` + autosave(스테일 탭 가드·작성자 스코프) + 허브 배선.** 신규 `lib/encounters/medical-records.ts`(타입·3 호출) + `components/encounters/soap-ledger.tsx`(full-bleed 1열 ledger·토큰 배지 S=status-inprogress/O=primary/A=status-received-ink/P=status-done·본문 132px·포커스 좌3px teal 액센트+틴트[focus-within, 음영 아님]·placeholder text-muted·빈파트 "비어 있음" 글리프·`aria-live="polite"` "자동 저장됨·{시각}"·1:N 이력[작성자·시각]). autosave=바닐라 `setTimeout`(1.5s) 디바운스 + **매 저장 전 `isActiveEncounter()` 확인 → 스테일 탭 저장 거부(UX-DR21)** + in-flight 가드(이중 POST 방지). 작성자 스코프=활성 기록은 현재 임상의 최근 기록(세션 uid=`getSession().user.id`=author_id, users.id=auth uid 동치). `encounter-hub.tsx` 중앙 placeholder→`<SoapLedger>` 교체(배너·좌패널·우 placeholder·세션가드·비-in_progress 가드 보존).
- **시드 — doctor `medical_record.write`+`medical_record.read` grant**(seed.sql 4.5 블록 뒤 신규 블록·계정 주석 갱신). nurse=무권한 baseline 유지(write/read 둘 다 403 검증)·reception=SOAP 권한 미부여(의사 임상기록 최소권한).
- **회귀 0** — doctor 가 medical_record.* 를 받아도 기존 encounter/patient 회귀 테스트 무영향(비중첩 권한). 신규 권한 1개라 admin boot grant 로 `test_admin_role_has_all_permissions` 정합 유지(29/29).
- **스코프 경계 준수** — `complete_encounter`(0010) 무변경(주상병 게이트=4.7)·`encounter_diagnoses`/KCD=4.7(별도 0014)·오더 우 pane=Epic5 placeholder 유지·활력=Epic5(5.6).

### File List

**신규:**
- `supabase/migrations/0013_medical_records.sql`
- `web/src/components/encounters/soap-ledger.tsx`
- `web/src/lib/encounters/medical-records.ts`
- `web/src/lib/encounters/medical-records.test.ts`
- `web/src/components/encounters/soap-ledger.test.tsx`

**수정:**
- `api/app/schemas/encounters.py` (`MedicalRecordWrite`·`MedicalRecordResponse`)
- `api/app/core/db.py` (`insert_medical_record`·`update_medical_record`·`fetch_medical_records`·`_require_medical_record_write`·`_MEDICAL_RECORD_COLUMNS`)
- `api/app/services/encounters.py` (`create_medical_record`·`update_medical_record`·`list_medical_records`·`_to_medical_record`)
- `api/app/api/v1/encounters.py` (POST/PUT/GET medical-records + `require_medical_record_write`/`require_medical_record_read`)
- `api/app/services/audit.py` (`_SENSITIVE_KEY` 에 SOAP 4종)
- `web/src/lib/admin/audit.ts` (`SENSITIVE_KEY` 에 SOAP 4종 — 서버 거울 동기)
- `web/src/components/encounters/encounter-hub.tsx` (중앙 SOAP placeholder → `<SoapLedger>`)
- `supabase/seed.sql` (doctor `medical_record.write`/`medical_record.read` grant + 계정 주석)
- `api/tests/test_encounters_integration.py` (SOAP CRUD·1:N·권한 경계·감사 신규)
- `api/tests/test_admin_audit.py` (SOAP 마스킹 단위 테스트)
- `web/src/lib/admin/audit.test.ts` (키 루프에 SOAP 4종)
