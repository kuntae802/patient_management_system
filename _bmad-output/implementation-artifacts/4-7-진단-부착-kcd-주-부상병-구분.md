---
baseline_commit: 6ce6bd096a62200def30ae904432b9542e131cd6
---

# Story 4.7: 진단 부착 (KCD) · 주/부상병 구분

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **의사(doctor)**,
I want **진료 허브의 진단 블록(SOAP 위, UX-DR12)에서 KCD-8 진단을 검색 피커로만 부착하고(free-text 차단) 각 진단을 주상병/부상병으로 구분하며, 주상병 없이는 진료 완료가 422로 차단되기를**,
so that **진단이 표준 코드로 일관되게 기록되어 처방·검사·수가의 근거가 되고(FR-042·FR-051), 정산·청구의 필수 전제인 주상병이 누락된 채 내원이 종결되지 않는다(임상·청구 무결성).**

## Acceptance Criteria

1. **AC1 — KCD 진단 부착(검색 피커·free-text 차단) (FR-042, UX-DR12):** 진료 허브(진행중 `in_progress` 내원)의 **중앙 작성 영역, SOAP ledger 위**에 **진단 블록(diagnosis-block)** 이 렌더된다. 의사는 **재사용 `MasterSearchPicker`(kind="diagnosis")** 로 KCD-8 진단을 **검색·선택만** 할 수 있고(코드/명칭 부분일치·**현재-유효 마스터만**[`is_active`·`effective_from≤today≤effective_to`]·**free-text 입력 차단**), 선택 시 `encounter_diagnoses` 에 행이 부착(`POST`)된다. 부착된 진단은 **코드 칩**(KCD 코드 + 한글명)으로 표시되며, 빈 상태(부착 0건)는 색만이 아니라 글리프/라벨("부착된 진단 없음")로도 표시한다(저가 임상 모니터 강건성).

2. **AC2 — 주/부상병 토글(구분 저장·주상병 ≤1 DB 불변식) (FR-042):** 각 부착 진단은 **주/부상병 토글**로 주진단·부진단이 **구분 저장**(`is_primary`)되며, 칩은 주/부상병을 **색 + 글리프 + 라벨**로 중복 인코딩한다(주상병 칩 = `status-inprogress` 잉크·"주상병" 라벨). **한 내원의 활성 주상병은 최대 1개**(DB 부분 unique 인덱스가 최종선) — 다른 진단을 주상병으로 토글하면 기존 주상병이 **동일 트랜잭션에서 부상병으로 강등**된다. **같은 KCD 코드의 중복 부착은 409로 차단**되고, 부착 진단은 **제거(soft delete)** 할 수 있다.

3. **AC3 — 주상병 미지정 완료 422 게이트 + 인라인 포커스 (UX-DR12·UX-DR18, NFR-051):** 진료 완료를 시도할 때 **주상병(`is_primary=true`)이 1개도 없으면** `complete_encounter` RPC 가 **422 로 차단**한다(DB 최종선 — `PT422`→422 `primary_diagnosis_required`). 웹은 422 수신 시 **진단 블록(검색 피커)으로 포커스를 이동**하고 **`aria-invalid`/`aria-describedby` 연결된 인라인 메시지 "주상병을 1개 지정해야 합니다"** 를 표시한다(UX-DR18). 주상병이 지정되어 있으면 완료가 성공해 내원이 `completed` 로 전이된다. ⚠️ **완료 액션은 본 스토리에선 최소 구현**(되돌릴 수 없음 힌트 포함한 단순 "진료 완료" 트리거) — **sticky flow stepper·수납 핸드오프·신원 확인 = Epic 7(수납)** 명시 이월.

4. **AC4 — 진단 목록 조회·권한·RLS·감사 (FR-031 근거, NFR-042·NFR-051):** 한 내원의 부착 진단을 **KCD 코드/명칭 조인** 목록으로 조회(`GET`)할 수 있다(주상병 우선·부착순). 부착(`POST`)·주상병 토글(`PATCH`)·제거(`DELETE`)는 **`diagnosis.attach`(기존 0002 권한)**, 조회는 **신규 `diagnosis.read`(0014)** 로 게이트되며, RLS 는 **staff=`has_permission('diagnosis.read')`·환자 self=내원→환자→`auth_uid`** 이중(방어심층)으로 강제한다. 모든 부착/토글/제거는 **감사 트리거(0004)** 로 자동 기록된다. ⚠️ **감사 마스킹 변경 없음**: `encounter_diagnoses` 는 자유텍스트 건강 컬럼이 없고 `diagnosis_id` 는 FK(불투명 UUID, `patient_id`·`encounter_id` 와 동일 취급) → `_SENSITIVE_KEY` 무변경(4.6 SOAP 와의 핵심 차이).

5. **AC5 — doctor 권한 활성화 + 회귀 0 (RBAC, NFR-051):** doctor 역할이 시드에서 **`diagnosis.attach`(0002 기존) + `diagnosis.read`(0014 신규) + `encounter.complete`(0002 기존)** 를 보유해 진단 부착·조회·완료 골든 패스가 가동된다(4.6 까지 doctor 는 diagnosis·complete 권한 0). 신규 권한 `diagnosis.read` 는 **0014 admin boot grant 재실행**(누락 시 `test_admin_role_has_all_permissions` 회귀)으로 카탈로그/매트릭스 정합을 유지한다. 무권한 baseline 계정 **`nurse@pms.local`(EMP0004)** 로 부착·조회·완료가 **403** 임이 검증되고, doctor 의 부착·주상병 토글(강등)·중복 409·목록 조회·주상병 게이트(422)·완료 성공이 신규 테스트로 커버되어 **회귀 0**(기존 encounter/medical_record/patient 테스트 무영향 — 비중첩 권한)을 보장한다.

## Tasks / Subtasks

> **읽기 우선(필수):** 착수 전 §"기존 코드 읽기(UPDATE)" 의 파일을 **완독**한다. 특히 `web/AGENTS.md` 경고 — 이 Next.js(16)/React(19.2)는 학습 데이터와 다를 수 있으니 클라이언트 컴포넌트·`useEffect`(로드)·이벤트 핸들러 작성 전 `node_modules/next/dist/docs/` 관련 가이드를 확인한다. 이 스토리는 **신규 마이그레이션 1건(0014 — `encounter_diagnoses` 테이블 + `diagnosis.read` 권한 + RLS + 감사 트리거 + 부분 unique 인덱스, 그리고 `complete_encounter` 재정의[주상병 게이트])** + API(진단 CRUD 4 엔드포인트 + 완료 1 엔드포인트 + `PT422` 매핑) + 웹 진단 블록·완료 최소 액션 + 시드 grant + glossary 갱신 + 회귀 테스트다. **⚠️ 스코프 경계(엄수, §결정 6)**: 완료 후 **수납·sticky 액션바·flow stepper·신원 확인**=Epic 7 / **처방↔진단 연결(FR-051)**·오더=Epic 5 / **과거 내원 진단 타임라인(FR-031 좌패널 backfill)**=이월 / 활력=Epic 5(5.6). 본 스토리 = 현재 내원의 진단 부착·구분·완료 게이트만.

- [x] **Task 1 — DB: `encounter_diagnoses` 테이블 마이그레이션 `0014_encounter_diagnoses.sql` (AC1, AC2, AC4, AC5)**
  - [x] 1.1 신규 `supabase/migrations/0014_encounter_diagnoses.sql`. 헤더 주석: Story 4.7 / FR-042 / UX-DR12·UX-DR18. 의존: 0002(permissions·`diagnosis.attach`·`encounter.complete` 기존·`has_permission` via 0003), 0004(`audit_trigger_fn`), 0007(diagnoses KCD 마스터 FK), 0010(encounters FK·`complete_encounter` 재정의 대상). **식별자 영문 snake_case · timestamptz=UTC · soft delete=`is_active`**. ⚠️ **실제 다음 순번 = 0014**(0013=medical_records 가 마지막; glossary §185 의 계획상 `0014_rls_policies.sql` 은 미실현이라 0014 가용).
  - [x] 1.2 **테이블 `public.encounter_diagnoses`**(glossary §35 "내원진단" 표준명): `id uuid primary key default gen_random_uuid()` · `encounter_id uuid not null references public.encounters(id)` · `diagnosis_id uuid not null references public.diagnoses(id)`(KCD 마스터 — free-text 금지의 근거) · `is_primary boolean not null default false`(주/부상병) · `recorded_by uuid not null references public.users(id)`(부착 의사) · `is_active boolean not null default true`(soft delete) · `created_at timestamptz not null default now()` · `updated_at timestamptz not null default now()`. ⚠️ **건강민감 자유텍스트 컬럼 없음**(진단명은 `diagnoses` 마스터 조인으로 읽기시점 합성 — 감사 스냅샷엔 `diagnosis_id` FK 만 유입 → 마스킹 불요, §결정 4). 인덱스: `idx_encounter_diagnoses_encounter_id`(encounter_id), `idx_encounter_diagnoses_diagnosis_id`(diagnosis_id).
  - [x] 1.3 **DB 불변식 = 부분 unique 인덱스 2종**(불변식 DB 소유, §결정 2): ① `create unique index uq_encounter_diagnoses_primary on public.encounter_diagnoses (encounter_id) where is_primary and is_active;` — **활성 주상병 ≤1/내원**(주상병 토글 시 기존 강등의 최종선). ② `create unique index uq_encounter_diagnoses_dup on public.encounter_diagnoses (encounter_id, diagnosis_id) where is_active;` — **같은 KCD 코드 활성 중복 부착 차단**(제거 후 재부착은 허용 — partial `where is_active`).
  - [x] 1.4 **신규 권한 `diagnosis.read`**(진단 조회 — 최소권한 경계, §결정 3·4.6 `medical_record.read` 미러): `insert into public.permissions (code,name,resource,action) values ('diagnosis.read','진단 조회','diagnosis','read') on conflict (code) do nothing;`. (⚠️ **`diagnosis.attach` 는 0002:92 에 이미 존재 — 재삽입 금지**. 쓰기는 기존 권한 소비.) **admin boot grant 재실행**(0013:42~48 패턴 미러): `insert into role_permissions select r.id,p.id from roles r join permissions p on p.code='diagnosis.read' where r.code='admin' on conflict do nothing;` — ⚠️ **필수**(0002 admin cross-join 은 0014 신규 권한 미포함 → 누락 시 `test_admin_role_has_all_permissions` 회귀).
  - [x] 1.5 **권한 posture**(민감 reveal 컬럼 없음 → 테이블 단위 GRANT, 0013:50~54 미러): `revoke all on public.encounter_diagnoses from anon, authenticated;` · `grant select, insert, update, delete on public.encounter_diagnoses to service_role;`(쓰기=FastAPI service_role 경유) · `grant select on public.encounter_diagnoses to authenticated;`(RLS 적용 하 읽기).
  - [x] 1.6 **RLS(방어심층, 0013:56~76 미러)**: `alter table public.encounter_diagnoses enable row level security;`. ① **staff** `encounter_diagnoses_select_staff` for select to authenticated using `(select public.has_permission('diagnosis.read'))` — ★ 신규 `diagnosis.read`(의사·관리자만 — 원무·간호 미열람, 임상 경계·§결정 3). ② **환자 본인** `encounter_diagnoses_select_self` for select to authenticated using `exists(select 1 from public.encounters e join public.patients p on p.id=e.patient_id where e.id=encounter_diagnoses.encounter_id and p.auth_uid=(select auth.uid()))`(포털 Epic 8 토대 — `medical_records_select_self` 동형). **쓰기 정책 없음**(쓰기=service_role 직접만).
  - [x] 1.7 **감사 트리거 부착**(0004 `audit_trigger_fn` 재사용, 신규 함수 0): `drop trigger if exists trg_encounter_diagnoses_audit on public.encounter_diagnoses;` · `create trigger trg_encounter_diagnoses_audit after insert or update or delete on public.encounter_diagnoses for each row execute function public.audit_trigger_fn();`. ⚠️ 테이블에 `id` 컬럼 존재 = target_id 계약 충족(0004:63). 부착=create·토글/강등/제거=update 감사 행(action CHECK 통과).

- [x] **Task 2 — DB: `complete_encounter` 주상병 게이트 (0014 재정의) (AC3)**
  - [x] 2.1 **0014 에서 `complete_encounter` 함수 재정의**(`create or replace function public.complete_encounter(p_encounter_id uuid)` — 0010:164~190 본문을 복사한 뒤 게이트 1개 추가; 마이그레이션 forward-only 라 0010 버전을 0014 가 대체). ⚠️ **반드시 `encounter_diagnoses` 테이블 생성(Task 1) 뒤에 정의**(함수가 해당 테이블 참조). 권한 게이트(`has_permission('encounter.complete')` 42501)·`PT404`·`PT409`(소스 상태 `<>'in_progress'`) **전부 보존**.
  - [x] 2.2 **주상병 게이트 추가**: `PT409`(상태) 검사 통과 후 · `update ... set status='completed'` 직전에 삽입 —
    ```sql
    if not exists (
      select 1 from public.encounter_diagnoses
      where encounter_id = p_encounter_id and is_primary = true and is_active = true
    ) then
      raise exception 'primary diagnosis required: %', p_encounter_id using errcode = 'PT422';
    end if;
    ```
    `PT422` = 신규 커스텀 SQLSTATE(코어 미사용 'PT' 클래스 — 0010 `PT404`/`PT409` 동류, 충돌 없음). 주석에 "주상병(is_primary) 미지정 완료 차단(FR-042·UX-DR18), 4.7 신설" 명시.
  - [x] 2.3 **`supabase db reset`** 로 0001~0014 + seed 재적용. psql 스모크(docker exec, service_role/owner = FastAPI 모사): walk-in 내원 생성 → `select start_consult(...)`(in_progress) → `select * from complete_encounter('<eid>')` → **`PT422`(주상병 없음)** 확인; `insert into encounter_diagnoses(encounter_id,diagnosis_id,is_primary,recorded_by) values(...,true,...)` 후 `complete_encounter` → 성공(completed) 확인. 두 진단을 is_primary=true 로 강제 INSERT → **`uq_encounter_diagnoses_primary` unique 위반** 확인. `set role authenticated`(nurse uid 주입) → `diagnosis.read` 미보유로 `select * from encounter_diagnoses` 0행(RLS staff 차단) 확인 후 `reset role`.

- [x] **Task 3 — API: 진단 CRUD 4 엔드포인트 + 완료 엔드포인트 + `PT422` 매핑 (AC1~AC5)**
  - [x] 3.1 `api/app/core/db.py` `_map_pg_sqlstate`(48~63)에 **신규 case 추가**: `case "PT422": return AppError("주상병을 1개 지정해야 합니다.", code="primary_diagnosis_required", status_code=422)`(4.2 이후 **첫 신규 SQLSTATE 매핑**). 기존 PT409/PT404/42501 보존. 주석에 "PT422=주상병 미지정 완료(4.7)" 추가.
  - [x] 3.2 `api/app/core/db.py` 진단 래퍼(전부 `_run_authed(sub)` 안 — GUC 주입·권한 재평가·감사·RLS 일관; `insert_medical_record` 1756~1874 패턴 미러). 컬럼 상수 `_ENCOUNTER_DIAGNOSIS_COLUMNS`(조인) = `ed.id, ed.encounter_id, ed.diagnosis_id, d.code as diagnosis_code, d.name as diagnosis_name, ed.is_primary, ed.recorded_by, ed.is_active, ed.created_at, ed.updated_at`(from `encounter_diagnoses ed join diagnoses d on d.id=ed.diagnosis_id`):
    - `_require_diagnosis_attach(conn)`(`_require_medical_record_write` 동형): `if not bool(await conn.fetchval("select public.has_permission('diagnosis.attach')")): raise ForbiddenError(detail={"required_permission":"diagnosis.attach"})`. TOCTOU 차단.
    - `attach_diagnosis(sub, *, encounter_id, diagnosis_id, is_primary, recorded_by) -> asyncpg.Record`: `_op` 안에서 ① `_require_diagnosis_attach` ② **내원 존재 선검사**(`select true from encounters where id=$1` → 미존재 `NotFoundError`→404) ③ `is_primary` 면 **기존 활성 주상병 강등**(`update encounter_diagnoses set is_primary=false, updated_at=now() where encounter_id=$1 and is_primary and is_active`) ④ `insert into encounter_diagnoses(encounter_id,diagnosis_id,is_primary,recorded_by) values($1,$2,$3,$4) returning id` → 그 id 로 `_ENCOUNTER_DIAGNOSIS_COLUMNS` 조인 SELECT 반환. 예외: `asyncpg.UniqueViolationError`(`uq_encounter_diagnoses_dup`) → `ConflictError("이미 부착된 진단입니다.", code="diagnosis_already_attached")`(→409); `asyncpg.ForeignKeyViolationError`(잘못된 diagnosis_id/encounter_id) → `AppError("참조 대상이 올바르지 않습니다(진단·내원).", code="invalid_reference", status_code=422)`(walk-in/medical_record 백스톱 선례 — `_map_pg_sqlstate` 미매핑 FK 503 오분류 방지). ③·④ 는 단일 `_run_authed` 트랜잭션 = 강등+삽입 원자성(부분 unique 가 최종선).
    - `set_diagnosis_primary(sub, *, encounter_id, ed_id, is_primary) -> asyncpg.Record`: `_require_diagnosis_attach` → `is_primary` 면 기존 주상병 강등(`... where encounter_id=$1 and is_primary and is_active and id<>$2`) → `update encounter_diagnoses set is_primary=$1, updated_at=now() where id=$2 and encounter_id=$3 and is_active=true returning id` → 조인 SELECT 반환; row 없으면 `NotFoundError("내원진단을 찾을 수 없습니다.")`→404.
    - `remove_diagnosis(sub, *, encounter_id, ed_id) -> None`: `_require_diagnosis_attach` → `update encounter_diagnoses set is_active=false, updated_at=now() where id=$1 and encounter_id=$2 and is_active=true returning id`; row 없으면 404. (soft delete — 부분 unique 가 `where is_active` 라 제거 후 재부착·동일코드 재사용 허용.)
    - `fetch_encounter_diagnoses(sub, encounter_id) -> list[asyncpg.Record]`: `select {_ENCOUNTER_DIAGNOSIS_COLUMNS} ... where ed.encounter_id=$1 and ed.is_active=true order by ed.is_primary desc, ed.created_at asc, ed.id asc`(주상병 우선·부착순·결정적 타이브레이커).
    - `call_complete_encounter(sub, encounter_id) -> asyncpg.Record`(`call_start_consult` 1282~ 동형): `select * from public.complete_encounter($1)` → 단일 행(`assert row is not None` — RPC 가 not-found 를 PT404, 주상병 없음을 PT422 raise). `_map_pg_sqlstate` 가 PT404→404·PT409→409·**PT422→422**·42501→403 자동 변환(신규 try/except 불요).
  - [x] 3.3 `api/app/schemas/encounters.py`(snake_case 유지):
    - `class DiagnosisAttach(BaseModel)`: `diagnosis_id: UUID` · `is_primary: bool = False`(POST 본문).
    - `class DiagnosisPrimaryUpdate(BaseModel)`: `is_primary: bool`(PATCH 본문).
    - `class EncounterDiagnosisResponse(BaseModel)`: `model_config=ConfigDict(from_attributes=True)` + `id`·`encounter_id`·`diagnosis_id`·`diagnosis_code: str`·`diagnosis_name: str`·`is_primary: bool`·`recorded_by`·`is_active`·`created_at`·`updated_at`(`MedicalRecordResponse` 스타일·조인 컬럼).
  - [x] 3.4 `api/app/services/encounters.py`(`_to_medical_record` 패턴 미러): `attach_diagnosis`·`set_diagnosis_primary`·`remove_diagnosis`·`list_encounter_diagnoses`·`complete_encounter` 서비스 5종 + `_to_encounter_diagnosis(row)` 헬퍼. `attach_diagnosis(sub, encounter_id, payload)` → `db.attach_diagnosis(sub, encounter_id=encounter_id, diagnosis_id=payload.diagnosis_id, is_primary=payload.is_primary, recorded_by=sub)`(★ recorded_by=sub). `complete_encounter(sub, encounter_id)` → `_to_encounter(await db.call_complete_encounter(sub, encounter_id))`(EncounterResponse).
  - [x] 3.5 `api/app/api/v1/encounters.py` 의존성(모듈 로드 시 1회, 기존 `require_*` 옆): `require_diagnosis_attach = require_permission("diagnosis.attach")` · `require_diagnosis_read = require_permission("diagnosis.read")` · `require_encounter_complete = require_permission("encounter.complete")`. 라우트:
    - `GET "/{encounter_id}/diagnoses"` → `list_encounter_diagnoses(... user=Depends(require_diagnosis_read)) -> list[EncounterDiagnosisResponse]`(직접 배열 — small sub-collection, `GET medical-records` 선례).
    - `POST "/{encounter_id}/diagnoses"` → `attach_diagnosis(encounter_id, payload: DiagnosisAttach, user=Depends(require_diagnosis_attach)) -> EncounterDiagnosisResponse`(201). docstring: 진단 부착·주상병 시 기존 강등·미존재 내원 404·중복 409·FK 422.
    - `PATCH "/{encounter_id}/diagnoses/{ed_id}"` → `set_diagnosis_primary(... payload: DiagnosisPrimaryUpdate, user=Depends(require_diagnosis_attach)) -> EncounterDiagnosisResponse`(주상병 토글). 미존재 404.
    - `DELETE "/{encounter_id}/diagnoses/{ed_id}"` → `remove_diagnosis(... user=Depends(require_diagnosis_attach))`(204 No Content). 미존재 404.
    - `POST "/{encounter_id}/complete"` → `complete_encounter(encounter_id, user=Depends(require_encounter_complete)) -> EncounterResponse`(전이 액션 엔드포인트 — `start-consult` 동형). docstring: in_progress→completed·주상병 없음 422·잘못된 전이 409·미존재 404. ⚠️ **라우트 충돌 없음**(기존 `/{id}/register|call|start-consult|medical-records` 와 메서드·하위경로 상이).

- [x] **Task 4 — Web: 진단 블록 + 진단 lib + 완료 최소 액션 + 허브 배선 (AC1, AC2, AC3)**
  - [x] 4.1 `web/src/lib/encounters/diagnoses.ts`(신규 — `medical-records.ts` 패턴): 타입 `EncounterDiagnosis`(snake_case: `id`·`encounter_id`·`diagnosis_id`·`diagnosis_code`·`diagnosis_name`·`is_primary`·`recorded_by`·`is_active`·`created_at`·`updated_at`) · `fetchEncounterDiagnoses(encounterId): Promise<EncounterDiagnosis[]>`(GET) · `attachDiagnosis(encounterId, body:{diagnosis_id,is_primary}): Promise<EncounterDiagnosis>`(POST) · `setDiagnosisPrimary(encounterId, edId, is_primary): Promise<EncounterDiagnosis>`(PATCH) · `removeDiagnosis(encounterId, edId): Promise<void>`(DELETE) · `completeEncounter(encounterId): Promise<Encounter>`(POST `/complete`). `apiFetch` 패턴(client.ts). **전 경로 snake_case**.
  - [x] 4.2 `web/src/components/encounters/diagnosis-block.tsx`(신규, `"use client"`): props `{ encounter: Encounter, today: string, primaryError: boolean, onPrimaryResolved: () => void }`. 동작:
    - **로드(마운트)**: `fetchEncounterDiagnoses(encounter.id)`(soap-ledger/patient-banner 의 `useCallback`+`useEffect`+error/skeleton 미러). 상태 = 부착 진단 배열.
    - **검색-부착(AC1)**: `<MasterSearchPicker kind="diagnosis" today={today} multiple={false} value={selected} onValueChange={...} />`(`@/components/ui/master-search-picker` 재사용 — free-text 차단·현재유효 마스터). ⚠️ **단일 선택 어더 패턴**: 선택(`MasterPickerItem`) → `attachDiagnosis(encounter.id,{diagnosis_id:item.id,is_primary:false})` → 성공 시 칩 목록에 추가 + **피커 value=null 리셋**(다음 부착 준비). (피커 기본 multiple-칩은 주/부상병 토글·서버동기를 못 하므로 단일 어더 + 커스텀 칩이 UX-DR12 충실 — §결정 5. 피커 입력에 안정적 DOM id[예 `id="diagnosis-picker"`] 부여 → AC3 포커스 타깃.) 중복(409) → sonner 토스트 "이미 부착된 진단입니다".
    - **커스텀 칩 + 주/부상병 토글(AC2)**: 각 부착 진단 = 칩(코드 + 한글명 + **주/부상병 배지** + 토글 버튼 + 제거 ✕). 주상병 배지 = `status-inprogress` 토큰(`border-status-inprogress/40 bg-status-inprogress/12 text-status-inprogress` — soap-ledger 배지 매핑 미러) + 글리프 + "주상병" 라벨; 부상병 = 중립 토큰 + "부상병"(**색 단독 금지**·UX-DR20). 토글 → `setDiagnosisPrimary(encounter.id, ed.id, !ed.is_primary)` → 성공 시 목록 갱신(기존 주상병 강등 반영 = refetch 또는 로컬 반영). 제거 → `removeDiagnosis` → 목록에서 제거. 빈 상태(0건) = 글리프/"부착된 진단 없음" 라벨.
    - **주상병 미지정 인라인(AC3)**: `primaryError` true 면 피커 하단에 `role="alert"` 인라인 메시지 "주상병을 1개 지정해야 합니다"(`text-status-cancelled` 토큰 + 글리프) 표시 + 피커에 `aria-invalid="true"` + `aria-describedby` 연결 + **`useEffect`로 피커 input 포커스 이동**(`document.getElementById("diagnosis-picker")?.focus()` 또는 ref). 주상병이 부착/토글되면 `onPrimaryResolved()` 호출(상위가 `primaryError` 해제).
  - [x] 4.3 `web/src/components/encounters/consultation-workspace.tsx`(신규, `"use client"` — 중앙 작성 영역 조합·완료 게이트 상태 소유): props `{ encounter: Encounter, today: string }`. 렌더 = `<DiagnosisBlock encounter today primaryError onPrimaryResolved />`(SOAP 위) → `<SoapLedger encounter />` → **완료 최소 액션**(하단). `primaryError` state 소유. `handleComplete`: `completeEncounter(encounter.id)` → ① 422 `primary_diagnosis_required`(ApiError code) → `setPrimaryError(true)`(DiagnosisBlock 가 포커스+인라인) ② 성공 → `clearActiveEncounter(encounter.id)`(active-session — 다음 환자 준비) + 완료 상태 반영(예: `router.refresh()`/안내 — 허브 in_progress 가드가 비-in_progress 화면 표시) ③ 409/404 → sonner 토스트. **완료 버튼 = 최소**(되돌릴 수 없음 힌트 텍스트 + mutation 중 disable[이중제출 방지]) — sticky flow stepper·수납 핸드오프·신원 확인은 **Epic 7 이월**(§결정 6).
  - [x] 4.4 `web/src/components/encounters/encounter-hub.tsx`(UPDATE): in_progress 분기 **중앙 슬롯(현 164행 `<SoapLedger encounter={encounter} />`) → `<ConsultationWorkspace encounter={encounter} today={today} />` 교체**. **배너·좌 컨텍스트 패널(159~162)·우 오더 placeholder(165~168)·헤더·세션 가드 배너·로드/에러/비-in_progress 가드(138~)는 그대로 보존**(파괴 변경 금지·4.6 보존 원칙). `today` 주입: **서버 페이지(`(staff)/encounter/[encounterId]/page.tsx`)에서 `todayISO()`(`@/lib/admin/masters`) 계산해 `<EncounterHub today={...}>` prop 으로 전달**(masters admin 의 "서버 주입 today=DB 권위" 일관 — master-search-picker.tsx:21). 페이지가 hub 에 prop 전달이 번거로우면 hub 내 `todayISO()` 클라 계산 폴백 허용(유효성 표시 필터·보안 경계 아님). 주석 `// 진단 부착(KCD)은 Story 4.7`(163행)→실콘텐츠 반영 갱신.

- [x] **Task 5 — 시드: doctor 진단·완료 권한 grant (AC5)**
  - [x] 5.1 `supabase/seed.sql` 의 4.6 doctor grant 블록(seed.sql:135~144) 뒤에 **신규 블록 추가**: doctor 역할에 **`diagnosis.attach` + `diagnosis.read` + `encounter.complete`** grant(`join permissions p on p.code in ('diagnosis.attach','diagnosis.read','encounter.complete') where r.code='doctor' on conflict do nothing`). 주석: 진단 부착·조회·진료 완료 = 의사 핵심 직무(Story 4.7) · 1.7 매트릭스 UI 소유(데모/통합테스트 전용·운영 db push 미반영) · 멱등. 상단 계정 주석(seed.sql:15~20 doctor 줄)에 "diagnosis.attach/read·encounter.complete 추가(4.7)" 갱신.
  - [x] 5.2 reception/nurse **무변경**: nurse = 무권한 baseline 유지(diagnosis·complete 둘 다 미보유 → 403). reception 은 진단·완료 권한 미부여(의사 임상 직무 — §결정 3).
  - [x] 5.3 `supabase db reset` 후 psql: doctor=`diagnosis.attach`/`diagnosis.read`/`encounter.complete` + 기존(medical_record·patient·encounter.read/start) true, nurse=`diagnosis.*`/`encounter.complete` false, admin=`diagnosis.read` true(0014 boot grant).

- [x] **Task 6 — Docs: glossary 갱신 (NFR-식별자 일관)**
  - [x] 6.1 `docs/glossary.md`: ① **§35 `encounter_diagnosis` 행 보강**(또는 데이터 모델 표에 `encounter_diagnoses` 테이블·`is_primary` 주상병 플래그·부분 unique 불변식 등재) ② **신규 권한 `diagnosis.read`** 등재(권한 카탈로그 — `diagnosis.attach` 기존 옆) ③ **§231 `complete_encounter(uuid)` 항목 갱신**: "주상병(`is_primary=true`) 미지정 시 `PT422`→422 차단(4.7 게이트)" 추가 ④ **API 엔드포인트 등재**: `GET/POST /encounters/{id}/diagnoses`·`PATCH/DELETE /encounters/{id}/diagnoses/{ed_id}`·`POST /encounters/{id}/complete`(Story 4.7·`encounter_diagnoses`·`diagnosis.attach`/`diagnosis.read`/`encounter.complete` 게이트) ⑤ 마이그 번호 메모: `0014_encounter_diagnoses.sql`(다음 적용=0001~0014). 신규 식별자는 코드 사용 전 등재(project-context 규칙).

- [x] **Task 7 — 테스트: 회귀 baseline + 진단 부착·구분·게이트·완료 (AC1~AC5)**
  - [x] 7.1 **무권한 baseline 재사용**: `api/tests/test_encounters_integration.py` 의 `doctor_token`/`nurse_token`/`admin_token`/`dept_id`/`_create_patient`/`_create_walk_in` 픽스처 재사용. doctor 가 diagnosis·complete 권한 받아도 **기존 encounter/medical_record 회귀(forbidden_without_read/start 등)는 무영향**(비중첩 권한 — 4.4·4.5·4.6 검증 패턴) 확인.
  - [x] 7.2 **진단 부착·구분 경계(신규, integration)**: walk-in → `start-consult`(doctor, in_progress) 전제 후 — ① `POST /v1/encounters/{id}/diagnoses` `{diagnosis_id, is_primary:true}` — doctor → 201 + `diagnosis_code`/`diagnosis_name` 조인 반영·`is_primary=true`; nurse → **403**; 미존재 내원 → 404; 잘못된 diagnosis_id → **422**(FK 백스톱); 같은 코드 재부착 → **409** `diagnosis_already_attached`. ② 두 번째 진단을 `is_primary:true` 부착 → 첫 진단 **강등**(GET 시 첫 진단 `is_primary=false`·둘째 true·**주상병 정확히 1개**). ③ `PATCH .../{ed_id}` `{is_primary:true}` 토글 → 강등 반영; nurse → 403; 미존재 → 404. ④ `DELETE .../{ed_id}` → 204·GET 에서 사라짐; nurse → 403. ⑤ `GET .../diagnoses` — doctor → 200(주상병 우선 정렬); **nurse → 403**(diagnosis.read 미보유).
  - [x] 7.3 **주상병 게이트 + 완료(신규, integration)**: ① in_progress 내원에 **진단 0건**으로 `POST /v1/encounters/{id}/complete`(doctor) → **422** `primary_diagnosis_required`·내원 status 여전히 in_progress(미전이). ② **부상병만**(is_primary=false) 부착 후 complete → **422**(주상병 없음). ③ 주상병 1개 부착 후 complete → **200** + status `completed`·`completed_at` 설정. ④ nurse complete → **403**(encounter.complete 미보유). ⑤ 이미 completed 내원 재완료 → **409**(PT409). ⑥ 미존재 내원 complete → 404.
  - [x] 7.4 **권한 카탈로그 정합 회귀**: `test_admin_role_has_all_permissions`(test_migrations_identity.py) — 0014 admin boot grant 미적용 시 실패 → **db reset 후 통과 확인**. `test_permission_code_format` 은 `diagnosis.read` 통과(자동).
  - [x] 7.5 **Web 유닛(vitest)**: `web/src/lib/encounters/diagnoses.test.ts` — `fetchEncounterDiagnoses`/`attachDiagnosis`/`setDiagnosisPrimary`/`removeDiagnosis`/`completeEncounter` URL·메서드·반환(apiFetch 모킹, `medical-records.test.ts` 패턴). `diagnosis-block.test.tsx`(가능 범위): ① MasterSearchPicker 렌더(kind=diagnosis·items prop 주입으로 Supabase 우회) ② 선택 시 `attachDiagnosis` 호출 + 칩 추가 ③ 주/부상병 배지·토글 렌더·색+글리프+라벨 ④ 빈 상태 "부착된 진단 없음" ⑤ **`primaryError` true 시 인라인 "주상병을 1개 지정해야 합니다" + `aria-invalid` + 피커 포커스**(AC3 핵심). `consultation-workspace.test.tsx`(가능): 완료 422 → `primaryError` 전파. (풀 브라우저 E2E·완료 후 네비게이션 통합 = Post-MVP — 과도 명세 금지, 4.3~4.6 선례.)

## Review Findings

_코드리뷰 2026-06-21 (Blind Hunter / Edge Case Hunter / Acceptance Auditor 3레이어 병렬, 실패 레이어 0). Acceptance Auditor: **AC1~AC5·설계결정 §1~§8·스코프 경계 전부 충족, 위반 0**. 수렴 신호: 동일 내원 진단의 **동시성**(complete 게이트 TOCTOU·동시 주상병 부착)을 Blind·Edge 양쪽이 지적 — 단일 의사 세션 가드(UX-DR21) 하 도달성 낮고 프로젝트 낙관적 잠금 이월 posture(4.5/4.6)와 동류. 분류: patch 1·defer 3·dismiss 9._

- [x] [Review][Patch] `onPrimaryResolved` 인라인 콜백으로 effect 재실행 — 부모(ConsultationWorkspace) 리렌더(완료 클릭·primaryError 변화)마다 새 함수 참조 → DiagnosisBlock `reload→load→effect` 체인 재생성 → 진단 목록 불필요 재조회·깜빡임 [web/src/components/encounters/consultation-workspace.tsx · diagnosis-block.tsx] [blind] — **적용:** 부모가 `handlePrimaryResolved = useCallback(()=>setPrimaryError(false),[])` 로 콜백 안정화(web 269 passed·회귀0).
- [x] [Review][Defer] `complete_encounter` 게이트 TOCTOU — encounters 행만 `for update`, `encounter_diagnoses` 미잠금 → 게이트 통과 직후 동시 주상병 제거/강등 커밋 시 주상병 0개로 완료 가능 [supabase/migrations/0014_encounter_diagnoses.sql complete_encounter] [blind+edge] — deferred, 동시성(같은 내원 2 트랜잭션)·세션당 활성 내원 1개 가드가 완화·낙관적 잠금 교차절단 하드닝(4.6 medical_record PUT 동형).
- [x] [Review][Defer] 동시 주상병 부착 unique 위반 오매핑 + 토글 503 — 동시 2건 `is_primary=true` 부착 시 `uq_primary` 위반이 `diagnosis_already_attached`(409)로 오라벨·`set_diagnosis_primary` 는 unique/FK except 백스톱 없어 동시 토글 충돌 시 503 [api/app/core/db.py attach_diagnosis/set_diagnosis_primary] [blind+edge] — deferred, 비-동시 경로는 강등 선행으로 위반 불가(도달=동시성만)·attach/toggle 에러매핑 대칭화는 동시성 하드닝과 함께.
- [x] [Review][Defer] attach/remove 에 내원 상태 게이트 부재 — 직접 API 로 완료/취소된 내원에도 진단 부착·토글·제거 가능(웹은 in_progress 만 노출) [api/app/core/db.py · api/v1/encounters.py] [blind+edge] — deferred, 4.6 §결정4(작성 윈도우 잠금 deferred·addendum 여지)와 동형 by-design posture·웹 UI 가 in_progress 게이트.

## Dev Notes

### 🎯 핵심 설계 결정 (이 스토리가 새로 확정)

1. **`encounter_diagnoses` 테이블 = 0014(다음 순번) — FK 기반 진단 부착, SOAP 와 분리.** 아키텍처·에픽 본문은 `0008_clinical.sql` 에 `medical_records(SOAP)` + `encounter_diagnoses` 를 **합쳐** 그렸으나(architecture.md §데이터 모델), ① 마이그레이션 번호 드리프트로 **실제 다음 순번은 0014**(0013=medical_records 가 마지막·glossary §185 의 계획 `0014_rls_policies.sql` 미실현) ② 스토리별 마이그레이션 원칙상 **4.6=`medical_records`(SOAP), 4.7=`encounter_diagnoses`(진단)** 분리(0013:8 가 명시 예약). 컬럼 = `encounter_id`·`diagnosis_id`(KCD 마스터 FK — **free-text 금지의 구조적 강제**)·`is_primary`(주/부)·`recorded_by`·`is_active`. **건강민감 자유텍스트 컬럼 없음**(진단명은 마스터 조인 합성).

2. **DB 불변식 = 부분 unique 인덱스 2종(강등은 동일 트랜잭션, 인덱스가 최종선).** "불변식은 DB가 소유"(project-context) 원칙대로 ① **주상병 ≤1/내원**(`unique(encounter_id) where is_primary and is_active`) ② **활성 동일코드 중복 차단**(`unique(encounter_id,diagnosis_id) where is_active`). 주상병 토글/부착(is_primary=true)은 FastAPI db 래퍼가 **같은 `_run_authed` 트랜잭션에서 기존 주상병을 먼저 강등(update is_primary=false) 후 삽입/갱신** → 부분 unique 가 경합·버그의 최종 방어선. soft delete(`where is_active`)라 제거 후 재부착·동일코드 재사용 허용(임상 정정 현실). 이는 상태머신 RPC(register/complete)와 달리 **service_role 직접 INSERT/UPDATE**(4.6 medical_records·walk-in 패턴) — 자유텍스트·단순 부착이라 전이 RPC 불요.

3. **읽기 권한 = 신규 `diagnosis.read`(diagnosis.attach 재사용 기각) — 4.6 `medical_record.read` 미러.** 진단(KCD)은 **건강민감 임상 정보**(환자의 질환을 드러냄). 조회 게이트로 `encounter.read`(원무·간호 보드용)를 재사용하면 원무가 의사 진단을 열람한다(경계 침해). `diagnosis.attach`(쓰기) 재사용은 "읽기=쓰기" 강결합이라 미래 독립 grant(Epic 7 청구 측 진단 조회·읽기전용 임상 뷰)를 막는다. 따라서 0014 가 **신규 `diagnosis.read`** 를 추가하고 RLS staff·API GET 둘 다 게이트로 쓴다(의사·관리자). **대가**: 신규 권한 → **0014 admin boot grant 재실행 필수**(0002 cross-join 후행 권한 미포함 — 0010·0012·0013 함정). **쓰기는 기존 `diagnosis.attach`(0002:92, admin cross-join 보유) 재사용**(부착/토글/제거 전부 attach 권한 — 별도 update/delete 권한 신설 안 함: 부착 권한자 = 자신의 부착 관리 권한자, over-granular 회피).

4. **감사 마스킹 변경 없음 — `encounter_diagnoses` 는 FK 만 유입(4.6 SOAP 와의 핵심 차이).** 4.6 은 SOAP 자유텍스트(`subjective` 등)가 감사 스냅샷에 처음 유입돼 `_SENSITIVE_KEY` 등록(서버+웹 거울)이 필요했다. **4.7 은 다르다**: `encounter_diagnoses` 의 감사 스냅샷 컬럼은 `diagnosis_id`(불투명 UUID FK)·`is_primary`·`recorded_by`·`is_active`·타임스탬프 — **건강 자유텍스트 0**. `diagnosis_id` 는 `patient_id`·`encounter_id` 와 동일한 **FK**라 기존 posture(FK 비마스킹)와 일관 취급한다(진단명은 마스터 조인 시점에만 합성, 감사 원본엔 미적재). glossary §243("encounters 에 PII/건강민감 자유텍스트 컬럼 없음(주호소·진단=4.6/4.7) → 감사 마스킹 집합 변경 불요")이 이 분리를 예고. **∴ `services/audit.py`·`lib/admin/audit.ts` 무변경**(드리프트 가드 불필요) — 단순화.

5. **진단 블록 = MasterSearchPicker 단일-어더 + 커스텀 칩(피커 multiple-칩 기각).** master-search-picker.tsx:22 는 "4.7 진단 주/부상병 multiple" 소비를 예약했으나, **피커의 multiple-모드 칩은 generic(코드+명+제거)** 이라 UX-DR12 의 **주/부상병 배지·토글·강등 서버동기**를 표현 못 한다. 따라서 피커는 **단일 선택 검색-부착 어더**(pick→POST attach→value=null 리셋)로 쓰고, 부착 진단은 **diagnosis-block 의 커스텀 칩**(주상병=status-inprogress 잉크·토글·제거)으로 렌더한다. 피커는 핵심 책임(**free-text 차단 KCD 검색·현재유효 마스터** = AC1)을 그대로 수행. 이 편차는 의도적이며 UX-DR12 충실도를 높인다. `today`(유효성 필터)는 서버 페이지 주입 선호(masters admin 일관)·클라 `todayISO()` 폴백 허용(보안 경계 아님).

6. **완료 게이트는 4.7, 완료 경험(수납·flow stepper)은 Epic 7 — 최소 완료 액션으로 AC3 시연.** AC3("주상병 없이 완료 시도→422→포커스+인라인")은 **완료 트리거가 UI에 있어야** 시연 가능하다. 그러나 UX-DR12 의 "액션 바(sticky flow stepper·진료 완료→수납·되돌릴 수 없음·신원 확인)" 와 4.6 이월("진료 완료→수납 = Epic 7")은 **수납 핸드오프**가 Epic 7 임을 못박는다. 분해: **4.7 = `complete_encounter` 주상병 게이트(PT422) + `POST /complete` 엔드포인트 + 최소 "진료 완료" 버튼(되돌릴 수 없음 힌트·disable·422 인라인)** / **Epic 7 = sticky 액션바·flow stepper·신원 확인·수납 정산 핸드오프**. 완료 성공 시 active-session 정리(다음 환자) + 허브 in_progress 가드가 비-in_progress 화면 표시(Epic 7 이 수납 화면으로 대체). `complete_encounter` 는 0010 본문 보존 + 게이트 1줄 추가로 0014 재정의(forward-only).

### 🔗 이월 인수 (이 스토리에서 청산 / 유지)

- **청산:**
  - `encounter_diagnoses` 미구축(마이그 0001~0013 부재) → **4.7 이 첫 생성**(0014). 4.5 좌패널 "진단 per-visit 빈-상태"·glossary §214 "진단 per-visit 부착은 4.7" 의 부착 경로 가동.
  - `complete_encounter`(0010) 주상병 게이트 부재 → **4.7 이 PT422 게이트 추가**(`complete_encounter` 첫 소비처 = API `POST /complete`). 4.6 이 "complete_encounter 무변경(주상병 게이트는 4.7)" 으로 예약한 항목 청산.
  - `diagnosis.attach`(0002:92, 1.3 부터 카탈로그에 존재하나 미소비) → **4.7 이 첫 소비처**.
  - master-search-picker(2.3) → **4.7 이 임상 측 첫 소비처**(masters admin 외 — picker:22 예약 소비).
- **유지(이 스토리 밖 — 명시 이월):**
  - **수납·sticky 액션바·flow stepper·신원 확인·진료 완료→정산 핸드오프** → Epic 7(수납, §결정 6).
  - **처방↔진단 연결(FR-051·`prescriptions`→`encounter_diagnoses`)·오더 우 pane** → Epic 5. 4.7 우 pane = placeholder 유지.
  - **과거 내원 진단 타임라인(FR-031 좌패널 backfill)** → 이월(4.5 좌패널 빈-상태 유지·본 스토리는 현재 내원 진단만). 좌패널에 과거 진단 표시는 후속(Epic 5/포털 Epic 8 동반 가능).
  - **활력징후 좌패널 실데이터** → Epic 5(5.6). **약물 상호작용 can't-miss** → Epic 5(5.5).
  - **진단 부착 낙관적 동시성(동시 토글 lost-update)·is_active TOCTOU** → 교차절단 하드닝 deferred(4.6 medical_record PUT 동시성·임상 프로필 PUT 과 동류).
  - **진료 허브 URL `/encounter/{date}/{chart_no}` 원문 정합(불투명 id 유지)** → 4.4 이월 유지.

### 🏗️ 아키텍처 준수 · 코드 패턴 (⚠️ 산출물 문구보다 실제 코드 우선)

- ⚠️ **현행 코드 우선**: web 은 **TanStack Query/shadcn/Zustand 미사용** → **Base UI + `useState`/`useEffect`/`useCallback` + `apiFetch` + `sonner`**, `database.types.ts` 미생성(타입 수동·snake_case). 진단 블록 로드도 바닐라 `useEffect`+`useCallback`(soap-ledger·patient-banner 선례 — 신규 데이터훅 금지).
- **JSON 전 경로 snake_case**(TS 도 camelCase 변환 금지) — `EncounterDiagnosis`/요청·응답 `{diagnosis_id,is_primary,diagnosis_code,diagnosis_name,recorded_by}` 전부 snake_case. 변수/함수만 camelCase(`fetchEncounterDiagnoses`·`attachDiagnosis`·`setDiagnosisPrimary`).
- **무ORM**: asyncpg + 직접 SQL(INSERT/UPDATE/SELECT 조인) — `insert_medical_record`·`fetch_medical_records`(조인 컬럼) 동형. 전이(complete)는 **RPC 호출**(`call_start_consult` 동형). ORM 모델·Alembic 금지. 스키마는 0014 마이그레이션 단일 소유(FastAPI DDL 금지).
- **불변식 DB 소유**: 부분 unique 인덱스(주상병 ≤1·중복 차단)·주상병 게이트(complete_encounter RPC)·RLS(`has_permission('diagnosis.read')`·환자 self)·감사 트리거(0004)·권한 평가 모두 **DB 안**. FastAPI `require_permission`·`_require_diagnosis_attach` 는 방어심층 1차선·TOCTOU 재평가. 게이트 로직 Python 재구현 금지.
- **에러 봉투**: `{error:{code,message,detail}}` + HTTP(403 권한/404 미존재/409 중복·전이/**422 주상병 미지정·FK**/503). `code`=영문(`primary_diagnosis_required`·`diagnosis_already_attached`·`invalid_reference`)·`message`=한국어. **SQLSTATE 매핑**: 기존 `_map_pg_sqlstate` 재사용 + **`PT422`→422 신규 1건**(4.2 이후 첫 추가). FK 23503→422 = INSERT try/except 백스톱(walk-in·medical_record 선례).
- **액션/리소스 엔드포인트**: 진단 CRUD = `GET`(목록)·`POST`(부착)·`PATCH`(주상병 토글)·`DELETE`(제거) sub-resource(`/{encounter_id}/diagnoses[/{ed_id}]`). 완료 = `POST /{encounter_id}/complete`(전이 액션 — status PATCH 아님). `/api/v1` prefix·`root_path` 전파·JWKS(`aud=authenticated`)+`require_permission` 의존성(모듈 로드 1회).
- **PII/건강민감 경계(엄수)**: 진단은 **diagnosis_id(FK)+조인 합성**이라 자유텍스트 미유입 → 감사 마스킹 무변경(§결정 4). 라우트=불투명 `encounter_id`/`ed_id`(UUID)·`diagnosis_id`(URL 노출은 마스터 FK 라 PII 아님). 진단명·코드는 **응답 바디로만**(로그·토스트 raw 미노출은 일반 원칙 유지). 실시간 미사용.
- **접근성(UX-DR12·UX-DR18·UX-DR20)**: 주/부상병 = **색 + 글리프 + 라벨** 중복 인코딩(색 단독 금지). 422 = **인라인 메시지 + 진단 필드 포커스 이동 + `aria-invalid`/`aria-describedby`**(AT 낭독). 빈 상태 글리프+라벨. `:focus-visible` 링(전역). `prefers-reduced-motion` 존중. 피커 키보드(화살표·Enter)는 MasterSearchPicker 내장.
- **금액 무관**(완료는 정산 전 단계 — 수가/금액=Epic 7). 날짜=timestamptz UTC→KST(`completed_at` 등 표시 시 `Intl` ko-KR).

### 📦 라이브러리 · 프레임워크 (신규 의존성 0)

- **신규 라이브러리 금지**. MasterSearchPicker(기존 2.3 — Base UI Combobox)·아이콘 lucide(기존 — 칩·토글·제거)·토스트 sonner(기존)·`apiFetch`(기존). 폼 라이브러리 불요(피커 + 바닐라 state).
- ⚠️ **Next.js 16 / React 19.2 — `web/AGENTS.md` 경고**: "This is NOT the Next.js you know." 클라 컴포넌트·`useEffect`(로드)·이벤트 핸들러 작성 전 `node_modules/next/dist/docs/` 확인. 허브는 서버 페이지(가드·`today` 주입)+클라 셸 분리 유지. diagnosis-block·consultation-workspace = `"use client"`.
- **Supabase**: 진단 CRUD·완료는 FastAPI(service_role) 경유(실시간 무관). MasterSearchPicker 는 KCD **마스터**(`diagnoses`)를 Supabase 직접 조회(RLS authenticated select using(true)·참조 데이터). 즉 **마스터 선택=Supabase 직접 / 부착·조회=FastAPI**(이중 경로 아키텍처 일관). 감사·has_permission·전이 RPC 는 기존 DB 자산.

### 📂 파일 구조 (정확 경로)

**신규:**
- `supabase/migrations/0014_encounter_diagnoses.sql` (`encounter_diagnoses` 테이블 + `diagnosis.read` 권한 + admin boot grant + RLS + 감사 트리거 + 부분 unique 2종 + `complete_encounter` 재정의[주상병 게이트])
- `web/src/components/encounters/diagnosis-block.tsx` (진단 블록 — MasterSearchPicker 어더 + 커스텀 칩·주/부상병 토글·422 인라인)
- `web/src/components/encounters/consultation-workspace.tsx` (중앙 작성 조합 — DiagnosisBlock + SoapLedger + 완료 최소 액션·primaryError 소유)
- `web/src/lib/encounters/diagnoses.ts` (`EncounterDiagnosis` 타입 + `fetchEncounterDiagnoses`/`attachDiagnosis`/`setDiagnosisPrimary`/`removeDiagnosis`/`completeEncounter`)

**수정(UPDATE):**
- `api/app/core/db.py` (`_map_pg_sqlstate` PT422 추가 · `_require_diagnosis_attach` · `attach_diagnosis`·`set_diagnosis_primary`·`remove_diagnosis`·`fetch_encounter_diagnoses`·`call_complete_encounter` 래퍼 · `_ENCOUNTER_DIAGNOSIS_COLUMNS`)
- `api/app/services/encounters.py` (`attach_diagnosis`·`set_diagnosis_primary`·`remove_diagnosis`·`list_encounter_diagnoses`·`complete_encounter`·`_to_encounter_diagnosis`)
- `api/app/schemas/encounters.py` (`DiagnosisAttach`·`DiagnosisPrimaryUpdate`·`EncounterDiagnosisResponse`)
- `api/app/api/v1/encounters.py` (GET/POST/PATCH/DELETE diagnoses + POST complete 라우트 + `require_diagnosis_attach`/`require_diagnosis_read`/`require_encounter_complete` 의존성)
- `web/src/components/encounters/encounter-hub.tsx` (중앙 `<SoapLedger>` → `<ConsultationWorkspace today=...>` 교체, 나머지 보존)
- `web/src/app/(staff)/encounter/[encounterId]/page.tsx` (서버 페이지 — `todayISO()` 계산해 hub 에 `today` prop 주입; 폴백 시 미변경)
- `supabase/seed.sql` (doctor `diagnosis.attach`/`diagnosis.read`/`encounter.complete` grant 블록 + 계정 주석)
- `docs/glossary.md` (encounter_diagnoses·is_primary·diagnosis.read·complete_encounter 게이트·진단 API 엔드포인트·0014 등재)
- `api/tests/test_encounters_integration.py` (진단 부착·구분·강등·중복·게이트·완료 신규)
- (신규 웹 테스트) `web/src/lib/encounters/diagnoses.test.ts`·`web/src/components/encounters/diagnosis-block.test.tsx`·(가능 시 `consultation-workspace.test.tsx`)
- `api/tests/test_migrations_identity.py` 영향 없음(통과 확인만 — admin boot grant 정합)

**구조 규칙**: `api/app/{core,api/v1,schemas,services}` · `web/src/{app/(staff),components/<feature>,components/ui,lib,hooks}`. 파일 kebab-case, TS 변수/함수 camelCase·컴포넌트/타입 PascalCase. 마이그레이션 Supabase CLI 단일 소유(0014=다음 순번). 진료 허브 컴포넌트=`components/encounters/`. 진단 도메인 lib=`lib/encounters/`(diagnoses.ts·active-session.ts·medical-records.ts 동거). 마스터 피커=`components/ui/`(공용).

### 📖 기존 코드 읽기 (UPDATE — 착수 전 완독, 현 동작·보존 대상 파악)

1. **`supabase/migrations/0013_medical_records.sql`** — 4.6 의 직전 미러 패턴 **전체**: 신규 권한 insert + **admin boot grant 재실행(33~48)**·테이블/GRANT posture(50~54)·**RLS(56~76: staff=has_permission·self=encounters→patients 조인)**·감사 트리거(82~84)·헤더 의존 주석(8: `encounter_diagnoses`=4.7 예약). **미러**: 0014 권한·RLS·GRANT·감사 전부.
2. **`supabase/migrations/0010_encounters.sql`** — **`complete_encounter`(164~190, 4.7 재정의 대상 — 본문 보존+게이트 추가)**·전이 트리거(65~98)·커스텀 SQLSTATE(PT404/PT409) raise 패턴·status CHECK·감사 트리거(300~302). **보존**: 권한 게이트·PT404·PT409·전이 의미. **추가**: PT422 주상병 게이트.
3. **`supabase/migrations/0007_masters_codes.sql`** — `diagnoses`(KCD 마스터) 스키마(14~26: code·name·effective_from/to·is_active)·RLS(78~80: authenticated select using true)·GRANT(66~68). **FK 대상**(encounter_diagnoses.diagnosis_id→diagnoses.id). **변경 없음**.
4. **`supabase/migrations/0002_identity_rbac.sql`** (`88~114`) — 권한 카탈로그(**`encounter.complete` 90·`diagnosis.attach` 92 존재·`diagnosis.read` 부재**)·admin cross-join(110~114, 후행 권한 미포함 → 0014 보완). **변경 없음**(0014 가 read 권한·grant 추가).
5. **`supabase/migrations/0004_audit.sql`** — `audit_trigger_fn`(26~70: 전체 행 jsonb·target_id=`id`)·action CHECK(create/read/update/delete/login). **재사용**: `trg_encounter_diagnoses_audit`. 부착=create·토글/제거=update 통과.
6. **`api/app/core/db.py`** — `_map_pg_sqlstate`(48~63, **PT422 추가**)·`authenticated_conn`(106~122)·`_run_authed`(125~145)·**`_require_medical_record_write`·`insert_medical_record`·`fetch_medical_records`(1756~1874: service_role 직접·내원 선검사 404·FK 23503→422·조인 컬럼·정렬 타이브레이커)**·**`call_start_consult`(1282~: RPC 호출·assert)**. **미러**: 진단 5 래퍼. **보존**: SQLSTATE 매핑·authed_conn·TOCTOU 재평가.
7. **`api/app/api/v1/encounters.py`** — 현 라우트(POST `""`·`/register`·`/call`·`/start-consult`·**medical-records POST/PUT/GET 129~175**·GET `""`·`/{id}`)·`require_*` 모듈 로드(36~44)·docstring 컨벤션. **보존**: 기존 라우트·게이트. diagnoses 4 + complete 1 라우트 동형 추가.
8. **`api/app/services/encounters.py`** — `create_medical_record`·`list_medical_records`·`_to_medical_record`(117~156)·`start_consult`·`_to_encounter`. **미러**: 진단 서비스 5종·`_to_encounter_diagnosis`.
9. **`api/app/schemas/encounters.py`** — `MedicalRecordWrite`/`MedicalRecordResponse`(106~143, `ConfigDict(from_attributes=True)`·snake_case)·`EncounterResponse`. **미러**: `DiagnosisAttach`·`DiagnosisPrimaryUpdate`·`EncounterDiagnosisResponse`.
10. **`web/src/components/ui/master-search-picker.tsx`** — props(kind·today·multiple·value·onValueChange·items)·Supabase 직접 조회(`fetchCurrentlyValidMasters`)·현재유효 필터·free-text 차단 Combobox·키보드. **소비**: kind="diagnosis"·multiple=false 어더. 주석 22(4.7 예약) 참고. `MasterPickerItem`(masters.ts:249: id·code·name·kind)·`todayISO()`(185).
11. **`web/src/components/encounters/soap-ledger.tsx`** — 클라 컴포넌트 로드(useCallback+useEffect)·토큰 배지 매핑(38~71)·apiFetch 소비·빈 상태 글리프(308~311)·인디케이터 aria-live. **미러**: diagnosis-block 로드·배지·빈 상태.
12. **`web/src/components/encounters/encounter-hub.tsx`** — 셸(로드 37~50·세션 가드 배너·비-in_progress 가드 138~·grid 158·좌패널 159~162·**중앙 SoapLedger 164**·우 오더 165~168). **보존**: 전부. **변경**: 164 → `<ConsultationWorkspace today=...>`·`today` prop 수신.
13. **`web/src/lib/encounters/medical-records.ts` + `active-session.ts`** — apiFetch 도메인 lib 패턴(타입·fetch/create/update)·`clearActiveEncounter`(완료 후 호출). **미러**: diagnoses.ts. **소비**: clearActiveEncounter(완료 성공).
14. **`web/src/lib/admin/masters.ts`** — `MasterPickerItem`·`MasterKind`·`todayISO()`·`fetchCurrentlyValidMasters`·`masterItemLabel`. **소비**: 진단 피커 today·item.id→diagnosis_id.
15. **`api/tests/test_encounters_integration.py`** — 토큰 픽스처(doctor/nurse/admin/reception)·`_create_patient`·`_create_walk_in`·`_insert_scheduled`·start-consult 직접 호출·무권한 baseline(nurse) 403 패턴. **재사용**: 진단·완료 테스트 픽스처.

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — claude-opus-4-8[1m]

### Debug Log References

- `supabase db reset`로 0001~0014 + seed 재적용(0014 clean apply). psql 스모크(트랜잭션·롤백): ① `complete_encounter` 주상병 미지정 → `PT422`("primary diagnosis required") ② 두 번째 주상병 직접 INSERT → `uq_encounter_diagnoses_primary` 위반 ③ 같은 코드 활성 중복 → `uq_encounter_diagnoses_dup` 위반 ④ 주상병 부착 후 완료 → `completed` ⑤ nurse(diagnosis.read 미보유) → encounter_diagnoses 0행(RLS). 권한 grant: doctor=diagnosis.attach/read·encounter.complete, admin=diagnosis.read(boot grant), nurse=0(baseline), admin 누락 권한=0.
- API: `uv run pytest -q` → **390 passed, 9 skipped**(회귀 0). `uv run ruff check .` → clean.
- Web: `npm run test` → **269 passed (37 files)**(회귀 0, master-search-picker 14 무영향). `npx tsc --noEmit` → 0. `npx eslint src` → 0.

### Completion Notes List

설계 §①~⑧ 전부 구현대로 적용. 핵심 사실:
- **DB(0014)**: `encounter_diagnoses`(diagnosis_id KCD FK·is_primary·recorded_by·자유텍스트 0) + 부분 unique 2종(주상병 ≤1·동일코드 중복) + RLS(staff=`diagnosis.read`·self) + 감사 트리거 + `diagnosis.read` 신규 권한·admin boot grant. `complete_encounter` 0014 재정의(0010 본문 보존 + 주상병 게이트 `PT422`, 상태 검사[PT409] 이후 배치 → `test_illegal_transition_wrong_rpc` 등 기존 전이 테스트 무영향).
- **API**: `_map_pg_sqlstate`에 `PT422→422 primary_diagnosis_required`(4.2 이후 첫 신규 SQLSTATE 매핑). 진단 CRUD = service_role 직접(4.6 medical_records 패턴·`_require_diagnosis_attach` TOCTOU·내원 선검사 404·강등 동일 txn·중복 `UniqueViolation`→409·FK 23503→422 백스톱)·완료 = `call_complete_encounter` RPC 래퍼. 엔드포인트 5종(GET/POST/PATCH/DELETE diagnoses + POST complete).
- **회귀 청산(교차절단)**: `complete_encounter` 게이트가 주상병 없이 완료하던 기존 DB 테스트 3건을 깨뜨려, `test_encounters_db.py`에 `_primary_diagnosis_sql` 헬퍼 추가 + `test_legal_transition_chain`·`_seed_to_status(completed)` 2곳에 주상병 부착 삽입(완료 직전). → 회귀 0 복구.
- **Web**: `MasterSearchPicker` 단일 어더(선택→부착·value=null 리셋·multiple-칩이 주/부 토글 못 함, §결정 5) + 커스텀 칩(주상병=status-inprogress 잉크·Star 글리프·토글·제거)·422 인라인(role=alert) + 피커 `aria-invalid`/`aria-describedby` + 포커스 이동. `MasterSearchPicker`에 선택적 `ariaInvalid`/`ariaDescribedby` props 추가(비파괴·UX-DR18). `ConsultationWorkspace`(DiagnosisBlock+SoapLedger+완료 최소 액션·primaryError 소유·완료 성공 시 `clearActiveEncounter`+완료 패널). `encounter-hub` 중앙 `<SoapLedger>`→`<ConsultationWorkspace today=>` 교체(나머지 보존). `today`=서버 페이지 `todayISO()` 주입.
- **감사 마스킹 무변경**(§결정 4·4.6과 핵심 차이): `encounter_diagnoses`는 FK·플래그만 유입(자유텍스트 0) → `services/audit.py`·`lib/admin/audit.ts` 무변경.
- **스코프 경계 준수**: 완료→수납·sticky 액션바·flow stepper·신원 확인=Epic 7 / 처방↔진단 FR-051·오더=Epic 5 / 과거 진단 타임라인 FR-031 좌패널 backfill=이월. 우 오더 pane placeholder 유지.

### File List

**신규:**
- `supabase/migrations/0014_encounter_diagnoses.sql`
- `web/src/components/encounters/diagnosis-block.tsx`
- `web/src/components/encounters/consultation-workspace.tsx`
- `web/src/lib/encounters/diagnoses.ts`
- `web/src/lib/encounters/diagnoses.test.ts`
- `web/src/components/encounters/diagnosis-block.test.tsx`
- `web/src/components/encounters/consultation-workspace.test.tsx`

**수정(UPDATE):**
- `api/app/core/db.py` (`_map_pg_sqlstate` PT422 · `_require_diagnosis_attach` · `attach_diagnosis`·`set_diagnosis_primary`·`remove_diagnosis`·`fetch_encounter_diagnoses`·`call_complete_encounter` · `_ENCOUNTER_DIAGNOSIS_COLUMNS`)
- `api/app/services/encounters.py` (진단 서비스 5종 + `_to_encounter_diagnosis`)
- `api/app/schemas/encounters.py` (`DiagnosisAttach`·`DiagnosisPrimaryUpdate`·`EncounterDiagnosisResponse`)
- `api/app/api/v1/encounters.py` (diagnoses 4 + complete 1 라우트 + `require_diagnosis_attach`/`require_diagnosis_read`/`require_encounter_complete`)
- `web/src/components/ui/master-search-picker.tsx` (선택적 `ariaInvalid`/`ariaDescribedby` props)
- `web/src/components/encounters/encounter-hub.tsx` (중앙 `<ConsultationWorkspace today=>` 교체 + `today` prop)
- `web/src/app/(staff)/encounter/[encounterId]/page.tsx` (`todayISO()` 서버 주입)
- `supabase/seed.sql` (doctor `diagnosis.attach`/`diagnosis.read`/`encounter.complete` grant + 계정 주석)
- `docs/glossary.md` (encounter_diagnoses·diagnosis.read·complete_encounter 게이트·진단 API·0014 등재)
- `api/tests/test_encounters_integration.py` (진단 부착·구분·강등·중복·게이트·완료 신규 14종 + `diagnosis_ids` 픽스처·`_in_progress_encounter` 헬퍼)
- `api/tests/test_encounters_db.py` (`_primary_diagnosis_sql` 헬퍼 + complete 경로 2곳 게이트 충족)

## Change Log

| 날짜 | 변경 | 작성 |
|---|---|---|
| 2026-06-21 | Story 4.7 구현 — encounter_diagnoses(0014)·진단 CRUD/완료 게이트 API·진단 블록/완료 액션 웹·시드·glossary·테스트. API 390 passed·Web 269 passed·회귀 0. Status → review | Amelia(dev) |
