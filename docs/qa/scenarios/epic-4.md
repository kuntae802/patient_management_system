# Epic 4: 내원 파이프라인 — 테스트 시나리오

## 에픽 개요

Epic 4는 환자 내원(encounter)의 전 생애주기 파이프라인을 구현한다: **접수(원무) → 대기/호출 → 진찰 시작(의사) → 진료 허브(배너·이력·SOAP·진단) → 진료 완료**. 핵심은 **DB가 상태머신·불변식·감사·권한을 소유**하고, FastAPI는 액션 엔드포인트로 RPC/직접 INSERT를 오케스트레이션하며, 웹은 실시간 구독(Supabase postgres_changes)으로 보드를 갱신한다는 것이다.

상태 어휘 6값(`scheduled`·`registered`·`in_progress`·`completed`·`cancelled`·`no_show`)은 `0010_encounters.sql`의 `enforce_encounter_transition` 트리거가 단일 진실로 강제한다. 전이는 액션 엔드포인트(POST .../register|start-consult|call|complete)로만 발생하며 status PATCH는 없다. 잘못된 전이=`PT409`→409, 미존재=`PT404`→404, 권한 미보유=`42501`→403, 주상병 미지정 완료=`PT422`→422.

### 데모 시드 내원 상태 매핑 (demo_seed.sql — 결정적 UUID)

- 내원 UUID 프리픽스: `00020000-0000-4000-8000-0000000000<NN>` (NN=01~11). 환자=`00010000-...-<NN>`.
- 모든 시드 내원: 진료과 IM(내과), 진료실 R101, 담당의 = doctor(`...a2`), 접수자 = reception(`...a3`).
- **상태별 최종 분포** (db reset + demo_seed 후):
  - **completed (6건)**: e01, e02, e03, e04, e05, e06 — SOAP·진단·수납 finalized 보유.
  - **in_progress (2건)**: e07, e08 — 진찰 시작됨, SOAP/진단 미작성(진료 허브에서 작성 가능 대상).
  - **registered (3건)**: e09, e10, e11 — 대기 중(호출/진찰 시작 가능 대상).
  - visit_type: e01~e04 = reserved, e05~e11 = walk_in.
- 진단 시드: e01~e05 각 주상병 1개, e06 주상병(I10 고혈압)+부상병(E78.5 고지혈증).
- ⚠️ scheduled/cancelled/no_show 내원은 시드에 **없음**(appointments 예약은 별도 — Epic 6 booked/cancelled). encounters 테이블에는 scheduled 행을 만드는 MVP 주체가 없으므로 register/no_show 경로 테스트는 service_role/psql 직접 INSERT로 scheduled 행을 셋업해야 한다.

### 데모 계정 (모든 비번 = Staff1234)

| 계정 | 역할 | Epic 4 관련 권한 | 비고 |
|---|---|---|---|
| reception@pms.local | reception | encounter.register, encounter.read, encounter.call, (+7.4 encounter.complete, +7.9 encounter.cancel) | 접수·호출. ⚠️ 7.4/7.9 시드로 complete/cancel 보유 → complete/cancel 403 baseline 아님 |
| doctor@pms.local | doctor | encounter.read/start/complete, patient.read/reveal_rrn/reveal_contact, medical_record.write/read, diagnosis.attach/read | 진찰·SOAP·진단·완료·reveal |
| nurse@pms.local | nurse | (encounter.* / patient.* / medical_record.* / diagnosis.* 전부 0) | **무권한 baseline(403 검증용)** |
| admin@pms.local | admin | 전권(boot grant) | 전 경로 200 |

---

## 스토리 ↔ FR ↔ 구현 매핑

| 스토리 | 기능 | 커버 FR | 핵심 구현 |
|---|---|---|---|
| 4.1 | 내원 상태머신·전이 RPC (DB 토대) | FR-020(부분), NFR-040, FR-118/119 문서화 | `0010_encounters.sql`: encounters 테이블, `enforce_encounter_transition` 트리거, RPC 5종(register/start_consult/complete/cancel/mark_no_show), 초기상태 가드, RLS(staff=encounter.read·self), 감사 트리거, `PT409`/`PT404` |
| 4.2 | 환자 접수 — 예약·walk-in | FR-020, FR-021, NFR-040 | `POST /encounters`(walk-in 직접 INSERT), `POST /encounters/{id}/register`(RPC), `_map_pg_sqlstate`(PT409→409·PT404→404·42501→403·FK 23503→422), 웹 `/reception/intake`, 활성 환자/진료과 가드 |
| 4.3 | 대기 현황판 — 실시간·다음 호출 | FR-022, FR-023, NFR-002 | `0011_encounter_call.sql`(called_at/call_count/last_called_by·`record_encounter_call` RPC·publication·replica identity full), `GET /encounters`, `POST /encounters/{id}/call`, WaitingBoard, `use-encounters-realtime`, status-badge A3, stale 가드 |
| 4.4 | 진료 대기열·진찰 시작 | FR-030, NFR-040, UX-DR21⑨ | `POST /encounters/{id}/start-consult`(start_consult RPC), 진료 허브 셸 `(staff)/encounter/[encounterId]`, 세션당 활성 내원 1개 가드(`active-session.ts`·`use-active-encounter`), doctor grant + nurse baseline |
| 4.5 | 진료 허브 — 배너·이력·활력·reveal | FR-005, FR-031, FR-032, FR-241/242 | `0012_patient_reveal.sql`(reveal_rrn/reveal_contact RPC·`patient.reveal_contact` 권한), `POST /patients/{id}/reveal-rrn`·`reveal-contact`, `GET /patients/{id}/encounters`, patient-banner(알레르기 can't-miss), patient-context-panel |
| 4.6 | SOAP 진료기록 작성 | FR-040, FR-041, FR-242, NFR-041 | `0013_medical_records.sql`(medical_records 1:N·`medical_record.read`·RLS), `POST/PUT/GET /encounters/{id}/medical-records`, soap-ledger autosave(디바운스·`isActiveEncounter` 가드), 감사 마스킹(`_SENSITIVE_KEY` SOAP 4종 동기) |
| 4.7 | 진단 부착(KCD)·주/부상병 | FR-042, UX-DR12/18 | `0014_encounter_diagnoses.sql`(encounter_diagnoses·부분 unique 2종·`diagnosis.read`·complete_encounter 재정의 주상병 게이트 PT422), 진단 CRUD(POST/PATCH/DELETE/GET), `POST /encounters/{id}/complete`, diagnosis-block(MasterSearchPicker free-text 차단), 422 인라인+포커스 |

---

## 테스트 시나리오

### 그룹 A — 상태머신·전이 무결성 (Story 4.1 / NFR-040)

#### TC-E4-01: 합법 전이 체인 (registered → in_progress → completed)
- **검증**: FR-020·FR-030·FR-042 / Story 4.1·4.4·4.7 / 전이 매트릭스
- **역할/계정**: doctor@pms.local
- **사전조건**: db reset + demo_seed. registered 내원 e09(`00020000-0000-4000-8000-000000000009`) 사용.
- **단계**:
  1. doctor 로그인 → `/doctor/waiting`(진료과 IM 선택) → e09 행의 `진료 시작` 버튼 클릭.
  2. 진료 허브 진입 확인 → 주상병 1개 부착(KCD 검색 → 칩 → "주상병으로 지정") → `진료 완료` 클릭.
- **기대결과**: e09 status `registered`→`in_progress`(consult_started_at·doctor_id=doctor uid 세팅)→`completed`(completed_at 세팅). 각 단계 audit_logs에 action='update' 행 + before/after status 변화 기록.
- **유형**: 정상 · 상태전이

#### TC-E4-02: 역행 전이 차단 (in_progress → registered)
- **검증**: NFR-040 / Story 4.1 / 전이 매트릭스 ⛔
- **역할/계정**: admin@pms.local (DB 직접) 또는 psql
- **사전조건**: in_progress 내원 e07(`...07`).
- **단계**: psql로 `update public.encounters set status='registered' where id='00020000-0000-4000-8000-000000000007';` (전이 트리거가 service_role 직접 update도 차단).
- **기대결과**: `PT409` raise — "invalid encounter transition: in_progress -> registered". UPDATE 실패, 상태 불변.
- **유형**: 상태전이 · 예외

#### TC-E4-03: 건너뛰기 전이 차단 (registered → completed)
- **검증**: NFR-040 / Story 4.1 / 전이 매트릭스 ⛔
- **역할/계정**: doctor@pms.local
- **사전조건**: registered 내원 e10(`...10`).
- **단계**: API로 `POST /v1/encounters/<e10>/complete` 직접 호출(start-consult 건너뜀).
- **기대결과**: 409 `invalid_transition`("잘못된 상태 전이입니다.") — complete_encounter RPC의 `status<>'in_progress'` precondition이 PT409. (단 doctor가 in_progress가 아닌 내원에 complete 시도 시; 만약 진단 0건이면 PT409가 먼저 발화 — 상태 검사가 주상병 게이트보다 선행.)
- **유형**: 상태전이 · 예외

#### TC-E4-04: 종결 상태 재전이 차단 (completed → cancelled / completed → completed)
- **검증**: NFR-040 / Story 4.1 / 종결=이탈 전이 없음
- **역할/계정**: doctor@pms.local
- **사전조건**: completed 내원 e01(`...01`).
- **단계**: `POST /v1/encounters/<e01>/complete` 재호출 (이미 completed).
- **기대결과**: 409 `invalid_transition`. (RPC precondition `status<>'in_progress'`.)
- **유형**: 상태전이 · 예외

#### TC-E4-05: 비정상 초기상태 INSERT 차단
- **검증**: NFR-040 / Story 4.1 / 초기상태 가드 (scheduled|registered만)
- **역할/계정**: service_role/psql
- **사전조건**: 유효 patient_id·department_id.
- **단계**: psql로 `insert into public.encounters (patient_id, department_id, visit_type, status) values (<pid>, <did>, 'walk_in', 'completed');` (그리고 'in_progress', 'cancelled', 'no_show'도 각각).
- **기대결과**: 모두 `PT409` — "invalid initial encounter status". `status='registered'`/`'scheduled'` INSERT만 성공. 성공 시 encounter_no 8자리 zero-pad unique 부여 확인.
- **유형**: 상태전이 · 경계

#### TC-E4-06: 취소 전이 (registered → cancelled, scheduled → cancelled)
- **검증**: FR-118 경로 / Story 4.1 / cancel_encounter RPC
- **역할/계정**: reception@pms.local (encounter.cancel 보유 — 7.9 시드) 또는 admin
- **사전조건**: registered 내원 1건(신규 walk-in으로 생성) + scheduled 내원 1건(psql 직접 INSERT).
- **단계**: `cancel_encounter(<id>, '환자 사정으로 취소')` RPC 호출(또는 향후 엔드포인트). cancel_reason 영속 확인.
- **기대결과**: 두 내원 모두 `cancelled` 전이 성공, cancelled_at·cancel_reason 세팅. **registered→no_show는 PT409**(매트릭스 외), **in_progress→cancelled는 PT409**(매트릭스 외).
- **유형**: 상태전이 · 정상/예외

#### TC-E4-07: 노쇼 전이는 scheduled 에서만
- **검증**: FR-118 경로 / Story 4.1 / mark_no_show
- **역할/계정**: admin@pms.local
- **사전조건**: scheduled 내원(psql INSERT) + registered 내원.
- **단계**: scheduled에 `mark_no_show(<id>)` → 성공. registered에 `mark_no_show` → 차단.
- **기대결과**: scheduled→no_show 성공(no_show_at 세팅). registered→no_show = `PT409`(접수=환자 도착 증명이므로 노쇼 불가).
- **유형**: 상태전이 · 경계

#### TC-E4-08: same-status 재호출 차단 (진료 탈취 방지)
- **검증**: NFR-040 / Story 4.1 review patch / RPC 소스상태 precondition
- **역할/계정**: doctor@pms.local + admin@pms.local (2 의사 시뮬레이션)
- **사전조건**: in_progress 내원 e07(doctor가 시작했다고 가정).
- **단계**: admin이 `start_consult(<e07>)` 재호출 (이미 in_progress).
- **기대결과**: 409 `invalid_transition` — RPC가 `status<>'registered'` precondition으로 차단. **doctor_id·consult_started_at 덮어쓰기 안 됨**(둘째 의사 진료 탈취 차단). 이전 RPC가 same-status를 통과시켜 타임스탬프를 리셋하던 버그가 patch로 해소됨.
- **유형**: 상태전이 · 보안

---

### 그룹 B — 환자 접수 (Story 4.2 / FR-020·FR-021)

#### TC-E4-09: walk-in 즉석 접수 (정상)
- **검증**: FR-021 / Story 4.2 / AC1
- **역할/계정**: reception@pms.local
- **사전조건**: db reset + demo_seed. 시드 환자(예: 차트번호로 검색 가능한 환자).
- **단계**:
  1. reception 로그인 → 좌측 nav "접수"(`/reception/intake`) 진입.
  2. 환자 검색 피커에 이름/차트번호 입력(디바운스 검색) → 결과 행(이름·차트번호·생년월일·주민번호 마스킹·연락처) 확인 → 환자 선택.
  3. 진료과 select에서 IM(내과) 선택(활성 진료과만 노출 확인) → "접수 확정" 클릭.
- **기대결과**: 201 응답. 성공 토스트 "{환자명} 접수 완료 · 내원번호 {encounter_no} · {진료과} 대기" + 결과 카드(encounter_no·status 배지). DB: status=`registered`·visit_type=`walk_in`·**registered_at not null**·**created_by=reception uid**·encounter_no 8자리. 그 진료과 대기열(idx_encounters_dept_status)에 진입.
- **유형**: 정상

#### TC-E4-10: walk-in 접수 — 이중 제출 방지
- **검증**: 중복 접수 1차선 / Story 4.2 review patch (useRef 동기 락)
- **역할/계정**: reception@pms.local
- **사전조건**: intake 화면, 환자·진료과 선택 완료.
- **단계**: "접수 확정" 버튼을 빠르게 더블클릭 / Enter 연타.
- **기대결과**: mutation 진행 중 버튼 disabled + useRef 동기 락으로 둘째 POST 미발사. 내원 1건만 생성(중복 내원 없음).
- **유형**: 경계

#### TC-E4-11: walk-in 접수 — 검증 실패 (필수 누락/잘못된 UUID)
- **검증**: FR-021 / Story 4.2 / AC1
- **역할/계정**: reception@pms.local (또는 admin API 직접)
- **사전조건**: 없음.
- **단계**: API로 `POST /v1/encounters` 본문에서 patient_id 누락 / 잘못된 UUID 형식 / department_id 누락.
- **기대결과**: 422 (Pydantic 검증, PII 미노출). 웹은 필드 에러/canSubmit 차단.
- **유형**: 예외 · 경계

#### TC-E4-12: walk-in 접수 — 미존재 환자 (404)
- **검증**: Story 4.2 / AC3 활성 가드
- **역할/계정**: reception@pms.local
- **사전조건**: 존재하지 않는 patient_id (유효 UUID 형식이나 DB 없음).
- **단계**: `POST /v1/encounters {patient_id: <존재안함>, department_id: <IM>}`.
- **기대결과**: 404 "환자를 찾을 수 없습니다." (db 래퍼의 in-txn `select is_active` None 검사).
- **유형**: 예외

#### TC-E4-13: walk-in 접수 — 비활성(soft-deleted) 환자/진료과 (422)
- **검증**: Story 4.2 / AC3 활성 가드
- **역할/계정**: admin@pms.local (환자/진료과 비활성화 가능)
- **사전조건**: soft-deleted 환자 또는 비활성 진료과.
- **단계**: 비활성 환자로 walk-in 접수 시도.
- **기대결과**: 422 `patient_inactive`(또는 진료과 비활성 422). 내원 미생성.
- **유형**: 예외 · 경계

#### TC-E4-14: walk-in 접수 — 잘못된 room_id (422 FK 백스톱)
- **검증**: Story 4.2 review patch (FK 23503→422)
- **역할/계정**: reception@pms.local (API 직접)
- **사전조건**: 미존재 room_id.
- **단계**: `POST /v1/encounters {patient_id, department_id, room_id: <미존재>}`.
- **기대결과**: 422 `invalid_reference` (FK 위반이 503 오분류되지 않고 422로 백스톱).
- **유형**: 예외 · 경계

#### TC-E4-15: 접수 권한 미보유 차단 (403)
- **검증**: Story 4.2 / AC3 권한 게이트
- **역할/계정**: nurse@pms.local (encounter.register 미보유)
- **사전조건**: nurse 토큰.
- **단계**: `POST /v1/encounters {patient_id, department_id}`.
- **기대결과**: 403 (require_permission('encounter.register') 게이트가 in-txn 재평가 전 차단). 웹에서는 nurse에게 "접수" nav 미노출(roles:["reception"]).
- **유형**: 권한·보안

#### TC-E4-16: 예약 환자 접수 — register_encounter RPC (scheduled → registered)
- **검증**: FR-020 / Story 4.2 / AC2
- **역할/계정**: reception@pms.local
- **사전조건**: scheduled 내원 1건(service_role/psql 직접 INSERT — MVP엔 scheduled 생성 UI 없음).
- **단계**: `POST /v1/encounters/<scheduled_id>/register`.
- **기대결과**: 200 + status=`registered`·registered_at 세팅. 재호출(이미 registered) → **409** `invalid_transition`. 미존재 id → **404**. nurse → **403**.
- **유형**: 정상 · 예외 · 권한

#### TC-E4-17: SQLSTATE→HTTP 매핑 정합성 (공유 인프라)
- **검증**: Story 4.2 / AC2 / `_map_pg_sqlstate`
- **역할/계정**: 단위/서비스 레벨
- **사전조건**: 없음.
- **단계**: register/start/complete/call 각 경로에서 PT409·PT404·42501·PT422·FK23503 발생시켜 매핑 확인.
- **기대결과**: PT409→409 code=`invalid_transition` · PT404→404 · 42501→403 · PT422→422 code=`primary_diagnosis_required` · FK23503→422 code=`invalid_reference` · 기타 sqlstate→503. 에러봉투 `{error:{code,message,detail}}`에 raw PII/임상텍스트 없음.
- **유형**: 경계 · 보안

---

### 그룹 C — 대기 현황판·실시간·호출 (Story 4.3 / FR-022·FR-023)

#### TC-E4-18: 대기 현황판 표시 — 상태 그룹·활성도 순·status-badge A3
- **검증**: FR-022 / Story 4.3 / AC1 / UX-DR6·7
- **역할/계정**: reception@pms.local
- **사전조건**: db reset + demo_seed (e01~e11, IM 진료과).
- **단계**: reception 로그인 → nav "대기 현황판"(`/reception/waiting`) → 진료과 IM 선택.
- **기대결과**: 상태별 그룹 섹션이 활성도 순(in_progress → registered → scheduled → completed → cancelled → no_show)으로 표시. 헤더=점+컬러 상태명+카운트 pill. 종결 섹션(completed/cancelled/no_show)은 접힘+muted(클릭 확장). 각 행 status-badge A3(8px 점+글리프 ○●◐✓✕+상태색 라벨, registered 라벨=status-received-ink, cancelled=line-through). 행 7열(대기번호·환자명+차트·상태·담당의·진료실·접수시각·대기시간·액션). KPI 스트립(총 N명·평균 대기 M분). in_progress 2건(e07·e08), registered 3건(e09·e10·e11), completed 6건 표시.
- **유형**: 정상

#### TC-E4-19: 다음 호출 히어로 — 가장 오래 대기한 미호출 registered
- **검증**: FR-023 / Story 4.3 / AC1
- **역할/계정**: reception@pms.local
- **사전조건**: 대기 보드(registered 다건).
- **단계**: 보드 상단 "다음 호출" 히어로 확인.
- **기대결과**: 다음 호출 대상 = 가장 오래 대기한 미호출 registered 내원(registered_at ASC·called_at 우선, tie-break encounter_no). 히어로 내용 `{encounter_no}번 {patient_name} · {진료과} {진료실} · {waitN}분 대기` + `▶ 호출`. (의사 보드는 "다음 진료" + `진료 시작`.)
- **유형**: 정상

#### TC-E4-20: 환자 호출 + 호출 상태 기록 (중복 방지)
- **검증**: FR-023 / Story 4.3 / AC3 / record_encounter_call
- **역할/계정**: reception@pms.local
- **사전조건**: registered 내원 e09.
- **단계**: e09 행의 `호출` 버튼(또는 히어로 호출) 클릭.
- **기대결과**: `POST /v1/encounters/<e09>/call` → 200. **status 불변(registered 유지 — 호출은 전이 아님)**, called_at 세팅·call_count=1·last_called_by=reception uid. 행에 "호출됨 · {시각} (1회)" muted 표기 + 히어로 다음환자에서 제외. audit_logs에 action='update' 1행. 재호출 시 call_count=2 (재호출=정상 동작).
- **유형**: 정상

#### TC-E4-21: 호출 — mutation 중 disable (중복 호출 1차선)
- **검증**: FR-023 / Story 4.3 / AC3
- **역할/계정**: reception@pms.local
- **사전조건**: registered 내원.
- **단계**: 호출 버튼 더블클릭.
- **기대결과**: per-id 동기 in-flight 락 + disabled. call이 한 번만 발사(call_count 1 증가).
- **유형**: 경계

#### TC-E4-22: 잘못된 상태 호출 차단 (미접수/진행중/종결 → 409)
- **검증**: FR-023 / Story 4.3 / AC3 / record_encounter_call precondition
- **역할/계정**: reception@pms.local (API 직접)
- **사전조건**: in_progress 내원 e07, completed 내원 e01.
- **단계**: `POST /v1/encounters/<e07>/call` 및 `<e01>/call`.
- **기대결과**: 둘 다 409 `invalid_transition`(RPC `status<>'registered'` precondition). 웹은 "이미 진행되었거나 호출할 수 없는 상태입니다." 토스트. 미존재 id → 404. nurse(encounter.call 미보유) → 403.
- **유형**: 상태전이 · 예외 · 권한

#### TC-E4-23: 실시간 갱신 ≤5초 (cross-terminal)
- **검증**: NFR-002 / Story 4.3 / AC2 / postgres_changes
- **역할/계정**: reception@pms.local (단말 A) + doctor@pms.local (단말 B)
- **사전조건**: 두 브라우저/탭에서 같은 진료과(IM) 보드 열기.
- **단계**: 단말 B(doctor /doctor/waiting)에서 registered 내원 e09 `진료 시작` → in_progress 전이. 단말 A(reception /reception/waiting) 관찰.
- **기대결과**: 단말 A 보드가 ≤5초 내 갱신(postgres_changes 구독 수신 → debounce refetch). e09가 registered 그룹에서 in_progress 그룹으로 이동. (실시간 미수신 시 30초 백스톱 폴링이 reconcile.)
- **유형**: 정상 · 실시간 의존성

#### TC-E4-24: 신선도(stale) 가드 — 채널 끊김/정지 시 호출 비활성
- **검증**: NFR-002 / Story 4.3 / AC2 / UX-DR18·21⑪
- **역할/계정**: reception@pms.local
- **사전조건**: 보드 열린 상태에서 네트워크/websocket 차단(개발자도구 offline 또는 realtime 끊기).
- **단계**: 채널 SUBSCRIBED 상태 이탈 또는 lastSyncedAt > FRESH_LIMIT(40s) 경과.
- **기대결과**: stale 배너 노출("연결 지연 · 실시간 갱신 멈춤 · 마지막 {시각} · 표시된 데이터가 최신이 아닐 수 있습니다(호출 가드됨)" + "다시 연결"). 호출·접수·진료시작 버튼 disabled(강제 가드 — 권장 아님). "다시 연결" 클릭 → 재구독 + 즉시 refetch.
- **유형**: 예외 · 실시간 의존성

#### TC-E4-25: 대기 목록 조회 — 필터·denormalized·권한
- **검증**: FR-022 / Story 4.3 / AC1 / GET /encounters
- **역할/계정**: doctor@pms.local, nurse@pms.local
- **사전조건**: db reset + demo_seed.
- **단계**: `GET /v1/encounters?department_id=<IM>` / `&status=registered` / 잘못된 status(`?status=foo`) / nurse 토큰.
- **기대결과**: 200 `{data, meta}` 봉투. denormalized 필드(patient_name·chart_no·department_name·room_name·doctor_name) 포함. raw 주민번호/연락처/`*_enc` 미포함. status 필터 동작. **잘못된/빈 status → 422**(Literal 검증, 무음 빈 보드 방지). nurse(encounter.read 미보유) → 403. page_size 기본 200(le=500), meta.total로 절단 가시화.
- **유형**: 정상 · 경계 · 권한

#### TC-E4-26: 빈 대기 현황판 상태
- **검증**: Story 4.3 / AC1 빈 상태
- **역할/계정**: reception@pms.local
- **사전조건**: 접수 환자 없는 진료과(IM 외 다른 진료과, 예 OS) 선택 또는 db reset 직후 demo_seed 미적용.
- **단계**: 환자 없는 진료과 보드 열기.
- **기대결과**: "오늘 접수된 환자가 없습니다" + `＋ 환자 접수하기`(reception만, intake 링크). 에러 아님.
- **유형**: 경계

---

### 그룹 D — 진찰 시작·진료 허브 셸·세션 가드 (Story 4.4 / FR-030·UX-DR21⑨)

#### TC-E4-27: 진찰 시작 — 의사 진료 대기열에서 (정상)
- **검증**: FR-030 / Story 4.4 / AC1
- **역할/계정**: doctor@pms.local
- **사전조건**: registered 내원 e09 (또는 e10/e11).
- **단계**: doctor 로그인 → `/doctor/waiting`(IM) → e09 행의 `진료 시작`(button-ghost .key teal) 클릭.
- **기대결과**: `POST /v1/encounters/<e09>/start-consult` → 200. status `registered`→`in_progress`·consult_started_at·**doctor_id=doctor uid(호출자)**. 성공 시 진료 허브(`/encounter/<e09>`)로 router.push. 원무 보드에도 실시간 ≤5초 반영.
- **유형**: 정상

#### TC-E4-28: 진찰 시작 — 잘못된 상태 (409)
- **검증**: FR-030 / Story 4.4 / AC1 / NFR-040
- **역할/계정**: doctor@pms.local (API 직접)
- **사전조건**: in_progress e07, completed e01.
- **단계**: `POST /v1/encounters/<e07>/start-consult` (이미 in_progress) 및 `<e01>` (completed).
- **기대결과**: 409 `invalid_transition`(RPC `status<>'registered'` precondition — 재수행·진료 탈취 차단). 미존재 → 404.
- **유형**: 상태전이 · 예외

#### TC-E4-29: 진찰 시작 — 권한 미보유 (403)
- **검증**: FR-030 / Story 4.4 / AC3 RBAC
- **역할/계정**: nurse@pms.local
- **사전조건**: registered 내원.
- **단계**: `POST /v1/encounters/<id>/start-consult` (nurse 토큰).
- **기대결과**: 403 (encounter.start 미보유). nurse는 doctor=권한0의 무권한 baseline 대체 계정.
- **유형**: 권한·보안

#### TC-E4-30: 진료 계속 — in_progress 내원 허브 복귀 (전이 없음)
- **검증**: Story 4.4 / AC2
- **역할/계정**: doctor@pms.local
- **사전조건**: in_progress 내원 e07.
- **단계**: `/doctor/waiting` → e07 행 `진료 계속` 클릭.
- **기대결과**: RPC 호출 없이 `/encounter/<e07>` 진료 허브로 router.push(단순 네비). 상태 불변(in_progress 유지).
- **유형**: 정상

#### TC-E4-31: 의사 보드 역할별 액션 — 호출 버튼 미노출
- **검증**: Story 4.4 / AC1 / UX-DR8 역할 분기
- **역할/계정**: doctor@pms.local
- **사전조건**: 의사 보드(registered·in_progress 내원).
- **단계**: doctor `/doctor/waiting`의 행 액션 셀·히어로 확인.
- **기대결과**: doctor에게는 registered=`진료 시작`·in_progress=`진료 계속`만 노출(못 쓰는 `호출`(403) 버튼 미노출). 히어로 라벨=`다음 진료`·CTA=`진료 시작`. reception 보드는 registered=`호출`·scheduled=`접수`.
- **유형**: 권한·보안

#### TC-E4-32: 진료 허브 진입 + 셸 식별
- **검증**: Story 4.4 / AC2
- **역할/계정**: doctor@pms.local
- **사전조건**: in_progress 내원 e07.
- **단계**: 진료 허브(`/encounter/<e07>`) 진입.
- **기대결과**: 헤더 = `내원 {encounter_no}` + in_progress status-badge + `진료 시작 {시각}` + `← 진료 대기`. 환자 배너 + 3-pane(좌 컨텍스트·중앙 SOAP+진단·우 오더) 표시. URL은 불투명 encounter_id 키(PII 없음, 새로고침 안전).
- **유형**: 정상

#### TC-E4-33: 진료 허브 — 비-in_progress 내원 직접 진입 가드
- **검증**: Story 4.4 review patch P3
- **역할/계정**: doctor@pms.local
- **사전조건**: completed 내원 e01, registered 내원 e09 URL.
- **단계**: `/encounter/<e01>` (completed) 또는 `/encounter/<e09>` (registered) 직접 URL/북마크 진입.
- **기대결과**: 3-pane 진료 화면 대신 안내 "이 내원은 진행중이 아닙니다(현재 {상태}). 진료 화면은 진찰을 시작한 진행중 내원에서만 열립니다." + `진료 대기로`. (활성 진료 placeholder 오표시 방지.)
- **유형**: 경계

#### TC-E4-34: 세션당 활성 내원 1개 가드 — conflict (다른 내원 활성)
- **검증**: UX-DR21⑨ / Story 4.4 / AC2 / localStorage pms.active_encounter
- **역할/계정**: doctor@pms.local
- **사전조건**: in_progress 내원 e07, e08 둘 다 존재.
- **단계**: 탭1에서 `/encounter/<e07>` 진입(활성 점유). 같은 브라우저 탭2에서 `/encounter/<e08>` 진입.
- **기대결과**: 탭2에 conflict 배너 "다른 진료가 이미 열려 있습니다 (내원 {e07_no}). 이 진료를 활성화하면 기존 진료 탭은 보류됩니다." + `이 진료 활성화`(takeOver) 버튼. localStorage `pms.active_encounter`에 e07만 점유.
- **유형**: 경계 · 보안

#### TC-E4-35: 세션 가드 — superseded (다른 탭이 takeOver)
- **검증**: UX-DR21⑨ / Story 4.4 / AC2 / storage 이벤트
- **역할/계정**: doctor@pms.local
- **사전조건**: 탭1=e07 활성, 탭2=e08(conflict 배너).
- **단계**: 탭2에서 `이 진료 활성화`(takeOver) 클릭.
- **기대결과**: 탭2가 e08 점유(claim). 탭1은 storage 이벤트로 superseded 배너(role="alert") "이 진료는 다른 탭에서 활성화되어 보류되었습니다." + `이 진료 다시 활성화`. (이 토대를 4.6 SOAP autosave가 isActiveEncounter()로 소비.)
- **유형**: 보안 · 실시간(크로스탭)

#### TC-E4-36: 세션 가드 — 다른 탭 해제 시 자가복구
- **검증**: Story 4.4 review patch (빈 키 자가복구)
- **역할/계정**: doctor@pms.local
- **사전조건**: 탭1=e07 활성.
- **단계**: 다른 경로로 localStorage `pms.active_encounter` 제거(허브 언마운트 등).
- **기대결과**: 탭1이 storage 이벤트(current===null)에서 재점유(self-recover) — claim 손실/무배너 방지. 4.6 autosave 무음 거부 토대 유지.
- **유형**: 경계

---

### 그룹 E — 진료 허브: 환자 배너·이력·reveal (Story 4.5 / FR-005·031·032·241·242)

#### TC-E4-37: 환자 배너 표시 — 신원·상태·경과
- **검증**: FR-005·031·032 / Story 4.5 / AC1
- **역할/계정**: doctor@pms.local
- **사전조건**: in_progress 내원 e07.
- **단계**: 진료 허브(`/encounter/<e07>`) 진입 → 상시 환자 배너 확인.
- **기대결과**: 배너에 이름·차트번호·나이/성별(birth_date→만나이·sex ko 라벨)·혈액형·보험구분·in_progress status pill·진료 경과(consult_started_at→경과). 3-pane 위에 상시 노출.
- **유형**: 정상

#### TC-E4-38: 알레르기 can't-miss 경고
- **검증**: FR-005 / Story 4.5 / AC3 / UX-DR10
- **역할/계정**: doctor@pms.local
- **사전조건**: allergies가 있는 환자의 in_progress 내원 + allergies 없는 환자 내원.
- **단계**: 각 진료 허브 진입.
- **기대결과**: allergies 비어있지 않으면 배너 상단 `role="alert" aria-live="assertive"` 경고(색 채움+danger 테두리+danger 글리프 AlertTriangle+굵은 "환자 안전 경고" 라벨, **전체 알레르기 텍스트 truncation/더보기 없이 전부 노출**, 색 단독 금지). allergies 미기재면 경고 미노출(빈 경고 없음). ⚠️ 약물 상호작용 교차검증은 Epic 5(5.5) — 4.5 범위 밖.
- **유형**: 정상 · 보안(임상 안전)

#### TC-E4-39: 주민번호 reveal — 권한 게이트 + 감사
- **검증**: FR-241 / Story 4.5 / AC2 / reveal_rrn
- **역할/계정**: doctor@pms.local
- **사전조건**: in_progress 내원(시드 환자, 주민번호 암호화 적재됨).
- **단계**: 배너 민감정보 행에서 주민번호 "표시"(눈 아이콘+"감사기록" 라벨) 클릭.
- **기대결과**: 기본 마스킹(`710314-2******`=resident_no_masked). 클릭 → `POST /v1/patients/{id}/reveal-rrn` → full RRN 인라인 치환 + aria-live="polite" 낭독. 버튼 aria-label에 "조회 시 감사 로그 기록됨". **audit_logs에 action='read' 1행 생성(자가-감사)**. `GET /patients/{id}`는 여전히 마스킹만. **raw RRN은 로그·토스트·에러봉투·URL·실시간 미노출**.
- **유형**: 정상 · 보안

#### TC-E4-40: 연락처 reveal — 신규 권한 + 감사
- **검증**: FR-242 / Story 4.5 / AC2 / reveal_contact
- **역할/계정**: doctor@pms.local
- **사전조건**: in_progress 내원.
- **단계**: 연락처(클라 마스킹 `010-****-3082`) "표시" 클릭.
- **기대결과**: `POST /v1/patients/{id}/reveal-contact` → full phone/address/email. patient.reveal_contact 권한(0012 신규) 게이트. audit_logs에 action='read' 행. raw 연락처 미노출(응답 바디만).
- **유형**: 정상 · 보안

#### TC-E4-41: reveal — 권한 미보유 (403) / 미존재 (404)
- **검증**: FR-241/242 / Story 4.5 / AC2·AC4
- **역할/계정**: nurse@pms.local + doctor@pms.local
- **사전조건**: 유효 환자 + 미존재 patient_id.
- **단계**: nurse로 reveal-rrn/reveal-contact → 403. doctor로 미존재 id → 404.
- **기대결과**: nurse(patient.reveal_rrn/reveal_contact 미보유) → 403. 미존재 환자 → 404. reveal-contact·reveal-rrn 양쪽 대칭(둘 다 404 커버).
- **유형**: 권한·보안 · 예외

#### TC-E4-42: 과거 내원 이력 타임라인 — GET /patients/{id}/encounters
- **검증**: FR-031 / Story 4.5 / AC1
- **역할/계정**: doctor@pms.local
- **사전조건**: 같은 환자에 과거 내원 다건(시드 환자) + 과거 내원 0건 환자.
- **단계**: 진료 허브 좌 컨텍스트 패널 → 과거 내원 이력 섹션.
- **기대결과**: `GET /v1/patients/{id}/encounters` → 최근순(registered_at desc) 타임라인(일자 KST·진료과명·담당의명·상태 status-badge). denormalized 포함, RRN/연락처 비포함. 100건 도달 시 "최근 100건만 표시" 안내(no-silent-cap). 이력 0건 → "과거 내원 이력 없음"(첫 내원). nurse(encounter.read 미보유) → 403.
- **유형**: 정상 · 경계 · 권한

#### TC-E4-43: 좌 컨텍스트 — 빈-상태 섹션(활력·진단 미구축)
- **검증**: FR-032 / Story 4.5 / AC1 데이터 현실
- **역할/계정**: doctor@pms.local
- **사전조건**: in_progress 내원(e07 — SOAP/진단 미작성).
- **단계**: 좌 컨텍스트 패널 활력징후·임상 프로필 섹션 확인.
- **기대결과**: 활력징후 = 명시 빈-상태("활력 미입력 · 간호 활력징후 기록은 Epic 5에서 입력"; **가짜 스파크라인 금지**). 임상 프로필(혈액형·알레르기·기저질환·복용약·특이사항) = 0009/3.2 데이터 읽기전용 표시. 중앙/우 pane은 placeholder 유지(SOAP=4.6 실콘텐츠, 오더=Epic 5).
- **유형**: 정상 · 경계

---

### 그룹 F — SOAP 진료기록 작성 (Story 4.6 / FR-040·041·242)

#### TC-E4-44: SOAP ledger 작성 UI 렌더
- **검증**: FR-040 / Story 4.6 / AC1 / UX-DR11
- **역할/계정**: doctor@pms.local
- **사전조건**: in_progress 내원 e07.
- **단계**: 진료 허브 중앙 작성 영역(SOAP ledger) 확인.
- **기대결과**: 4 파트 S/O/A/P. 각 파트 헤더 행(컬러 배지[S=inprogress·O=primary·A=received-ink·P=done 토큰]+한글 라벨[주관적/객관적/평가/계획]+영문+설명어). 본문 행 textarea(min-height 132px). 포커스/입력 중 좌측 3px teal 액센트+옅은 teal 틴트(음영 비의존). 빈 파트 = 글리프+"비어 있음" 라벨(색 단독 금지). placeholder 가이드("환자의 호소·증상…").
- **유형**: 정상

#### TC-E4-45: SOAP autosave — 첫 저장(POST) + 인디케이터
- **검증**: FR-040 / Story 4.6 / AC2
- **역할/계정**: doctor@pms.local
- **사전조건**: in_progress 내원 e07(SOAP 미작성), 이 탭이 활성 내원 점유.
- **단계**: Subjective에 "두통 3일" 입력 → 1.5s 대기.
- **기대결과**: 저장 전 "변경 시 자동 저장됩니다"(aria-live="polite"). 첫 비어있지-않은 내용에서 `POST /v1/encounters/<e07>/medical-records`(author_id=doctor uid) → "자동 저장됨 · {HH:mm}". 이후 변경은 `PUT`(전체 교체). audit_logs에 create/update 행. raw 임상텍스트 토스트·로그·URL 미노출.
- **유형**: 정상

#### TC-E4-46: SOAP autosave — 스테일 탭 가드 (저장 거부)
- **검증**: FR-040 / Story 4.6 / AC2 / UX-DR21 / isActiveEncounter
- **역할/계정**: doctor@pms.local
- **사전조건**: 탭1=e07 진료 허브에서 SOAP 편집 중인데, 탭2가 다른 내원을 takeOver(탭1 superseded).
- **단계**: 탭1(superseded)에서 SOAP textarea에 입력 → 1.5s.
- **기대결과**: autosave가 매 저장 전 `isActiveEncounter(e07)` 확인 → false면 **저장 거부(POST/PUT 미발사)**. 잘못된 환자의 열린 SOAP에 조용한 덮어쓰기 차단. 허브 상단 superseded 배너가 이미 안내(ledger 무토스트).
- **유형**: 보안(임상 안전) · 경계

#### TC-E4-47: 한 내원 복수 SOAP 기록 (1:N)
- **검증**: FR-041 / Story 4.6 / AC3
- **역할/계정**: doctor@pms.local
- **사전조건**: in_progress 내원, SOAP 기록 1건 작성됨.
- **단계**: "새 진료기록" 버튼 클릭 → ledger 클리어 → 새 내용 입력 → autosave.
- **기대결과**: 같은 내원에 별도 행(POST)으로 적재. `GET /encounters/{id}/medical-records` 길이 2, 최근순. 직전 기록은 읽기전용 이력 목록으로(작성자·시각). autosave는 작성자 스코프(현재 의사 최근 기록) — 타 임상의 기록 덮어쓰기 안 됨.
- **유형**: 정상

#### TC-E4-48: SOAP autosave — 전체 삭제 시 노트 wipe 방지
- **검증**: Story 4.6 review patch (hasContent 가드)
- **역할/계정**: doctor@pms.local
- **사전조건**: 내용 있는 SOAP 기록.
- **단계**: textarea 전체 삭제 후 1.5s 정지.
- **기대결과**: doSave의 hasContent 가드로 빈 내용은 PUT all-null로 덮어쓰지 않음(기존 노트 보존). 빈 파트→빈값 wipe 차단.
- **유형**: 경계 · 안전

#### TC-E4-49: SOAP CRUD 권한·내원 검증
- **검증**: FR-040·041 / Story 4.6 / AC5
- **역할/계정**: doctor@pms.local, nurse@pms.local
- **사전조건**: in_progress 내원, 미존재 내원/기록 id.
- **단계**: POST/PUT/GET medical-records를 doctor·nurse로.
- **기대결과**: doctor → POST 201·PUT 200·GET 200. **nurse → POST/PUT 403**(medical_record.write 미보유)·**GET 403**(medical_record.read 미보유 — 원무·간호가 의사 SOAP 미열람, 최소권한). 미존재 내원 POST → 404. 미존재 record PUT → 404. 빈 문자열 → None 정규화(`""` 미적재).
- **유형**: 권한·보안 · 예외

#### TC-E4-50: 감사 스냅샷 SOAP 마스킹
- **검증**: FR-242·NFR-041 / Story 4.6 / AC4 / mask_snapshot
- **역할/계정**: admin@pms.local (감사 뷰어)
- **사전조건**: SOAP 작성된 내원(예 e01~e06 시드 SOAP).
- **단계**: 관리자 감사 로그 뷰어(1.10)에서 medical_records action='create'/'update' 행의 after_data 확인.
- **기대결과**: subjective·objective·assessment·plan 4종 값이 `●●●● (마스킹됨)`로 가려짐(키는 보존). 비민감 키(encounter_id·author_id·is_active·created_at) 노출. 서버(`services/audit.py _SENSITIVE_KEY`)+웹 거울(`lib/admin/audit.ts SENSITIVE_KEY`) 동기. audit_logs 원본은 append-only 보존(읽기시점 마스킹만).
- **유형**: 보안 · 경계

---

### 그룹 G — 진단 부착(KCD)·주/부상병·완료 게이트 (Story 4.7 / FR-042·UX-DR12/18)

#### TC-E4-51: KCD 진단 부착 — 검색 피커(free-text 차단)
- **검증**: FR-042 / Story 4.7 / AC1 / UX-DR12
- **역할/계정**: doctor@pms.local
- **사전조건**: in_progress 내원 e07(진단 미부착).
- **단계**: 진료 허브 중앙(SOAP 위) 진단 블록 → MasterSearchPicker(`diagnosis-picker`)에 KCD 코드/명칭 부분일치 입력 → 결과 선택.
- **기대결과**: 현재-유효 마스터만(is_active·effective_from≤today≤effective_to), **free-text 입력 차단**(선택만 가능). 선택 시 `POST /v1/encounters/<e07>/diagnoses {diagnosis_id, is_primary:false}` → 코드 칩(KCD 코드+한글명) 추가 + 피커 value=null 리셋. 빈 상태(0건) = "○ 부착된 진단 없음"(글리프+라벨).
- **유형**: 정상 · 보안(데이터 무결성)

#### TC-E4-52: 주/부상병 토글 + 주상병 ≤1 강등
- **검증**: FR-042 / Story 4.7 / AC2 / uq_encounter_diagnoses_primary
- **역할/계정**: doctor@pms.local
- **사전조건**: in_progress 내원에 진단 2건 부착(둘 다 부상병).
- **단계**: 진단A 칩의 "주상병으로 지정" → 진단B 칩의 "주상병으로 지정".
- **기대결과**: 주상병 칩 = status-inprogress 잉크+글리프+"주상병" 라벨(색+글리프+라벨 중복 인코딩). 부상병 = 중립+"부상병". 진단B를 주상병 토글 → **진단A 자동 부상병 강등(동일 트랜잭션)**. GET 시 주상병 정확히 1개. (DB 부분 unique 인덱스가 최종선.)
- **유형**: 정상 · 경계

#### TC-E4-53: 같은 KCD 코드 중복 부착 차단 (409)
- **검증**: FR-042 / Story 4.7 / AC2 / uq_encounter_diagnoses_dup
- **역할/계정**: doctor@pms.local
- **사전조건**: 내원에 진단 J00 부착됨.
- **단계**: 같은 J00 재부착 시도.
- **기대결과**: 409 `diagnosis_already_attached`("이미 부착된 진단입니다."). (단 제거 후 재부착은 허용 — partial unique `where is_active`.)
- **유형**: 예외 · 경계

#### TC-E4-54: 진단 제거 (soft delete) + 재부착
- **검증**: FR-042 / Story 4.7 / AC2
- **역할/계정**: doctor@pms.local
- **사전조건**: 부착 진단 1건.
- **단계**: 칩의 제거(✕) → `DELETE /v1/encounters/{id}/diagnoses/{ed_id}` → 같은 코드 재부착.
- **기대결과**: 204 No Content. GET에서 사라짐(is_active=false). 같은 코드 재부착 성공(소프트 삭제라 unique 충돌 없음). 미존재 ed_id DELETE → 404.
- **유형**: 정상 · 경계

#### TC-E4-55: 진단 부착 — 잘못된 diagnosis_id (422 FK) / 미존재 내원 (404)
- **검증**: FR-042 / Story 4.7 / AC1
- **역할/계정**: doctor@pms.local (API 직접)
- **사전조건**: in_progress 내원 + 미존재 diagnosis_id, 미존재 encounter.
- **단계**: 잘못된 diagnosis_id로 POST / 미존재 내원으로 POST.
- **기대결과**: 잘못된 diagnosis_id → 422 `invalid_reference`(FK 백스톱). 미존재 내원 → 404.
- **유형**: 예외 · 경계

#### TC-E4-56: 주상병 미지정 완료 차단 (422 게이트)
- **검증**: FR-042 / Story 4.7 / AC3 / complete_encounter PT422
- **역할/계정**: doctor@pms.local
- **사전조건**: in_progress 내원 e07. (a) 진단 0건 / (b) 부상병만(is_primary=false) 부착.
- **단계**: `진료 완료` 버튼 클릭(또는 `POST /v1/encounters/<e07>/complete`).
- **기대결과**: 두 경우 모두 **422 `primary_diagnosis_required`** — complete_encounter RPC의 주상병 게이트가 차단. 내원 status 여전히 in_progress(미전이). 웹: 진단 블록(피커)으로 포커스 이동 + `role="alert"` 인라인 "주상병을 1개 지정해야 합니다"(aria-invalid/aria-describedby 연결, 색+글리프+라벨). 토스트 없음(인라인이 안내).
- **유형**: 상태전이 · 예외 · 보안(청구 무결성)

#### TC-E4-57: 주상병 지정 후 완료 성공
- **검증**: FR-042 / Story 4.7 / AC3
- **역할/계정**: doctor@pms.local
- **사전조건**: in_progress 내원 e07, 주상병 1개 부착.
- **단계**: `진료 완료` 클릭.
- **기대결과**: 200 + status `in_progress`→`completed`·completed_at. 웹: clearActiveEncounter(다음 환자 준비) + "진료가 완료되었습니다 · 수납·정산은 후속 단계에서" 완료 카드 + `진료 대기로`. 주상병 지정 시 422 인라인 해제(onPrimaryResolved). ⚠️ sticky flow stepper·수납 핸드오프·신원 확인은 Epic 7.
- **유형**: 정상 · 상태전이

#### TC-E4-58: 진단 CRUD 권한 (403)
- **검증**: FR-042 / Story 4.7 / AC4·AC5
- **역할/계정**: nurse@pms.local
- **사전조건**: in_progress 내원.
- **단계**: GET/POST/PATCH/DELETE diagnoses + POST complete (nurse 토큰).
- **기대결과**: GET → 403(diagnosis.read 미보유 — 원무·간호 진단 미열람, 임상 경계). POST/PATCH/DELETE → 403(diagnosis.attach 미보유). complete → 403(encounter.complete 미보유). 모두 nurse 무권한 baseline.
- **유형**: 권한·보안

#### TC-E4-59: 진단 목록 조회 — 주상병 우선 정렬
- **검증**: FR-031/042 / Story 4.7 / AC4
- **역할/계정**: doctor@pms.local
- **사전조건**: completed 내원 e06(주상병 I10 + 부상병 E78.5 시드).
- **단계**: `GET /v1/encounters/<e06>/diagnoses`.
- **기대결과**: 200. 주상병 우선 → 부착순(is_primary desc, created_at asc, id asc). diagnosis_code·diagnosis_name 마스터 조인 반영. is_primary 정확히 1개 true.
- **유형**: 정상

#### TC-E4-60: 완료 — 권한 미보유 / 잘못된 상태 / 미존재
- **검증**: FR-042 / Story 4.7 / AC3·AC5
- **역할/계정**: nurse@pms.local, doctor@pms.local
- **사전조건**: completed 내원 e01, 미존재 내원, in_progress 내원.
- **단계**: nurse complete → 403. completed 재완료 → 409. 미존재 complete → 404. (상태 검사가 주상병 게이트보다 선행.)
- **기대결과**: nurse → 403(encounter.complete 미보유). 이미 completed → 409 `invalid_transition`(PT409, 주상병 게이트 도달 전). 미존재 → 404.
- **유형**: 권한 · 상태전이 · 예외

---

### 그룹 H — RLS·감사·횡단 보안

#### TC-E4-61: encounters RLS — staff vs self vs anon
- **검증**: NFR-042 / Story 4.1 / AC1
- **역할/계정**: admin(encounter.read), 환자 본인(auth_uid), nurse(encounter.read 미보유), anon
- **사전조건**: 내원 다건 + 환자 포털 계정.
- **단계**: 각 주체로 encounters SELECT(API/Supabase 직접).
- **기대결과**: encounter.read 보유 직원 → 전체 행(RLS staff 정책). 환자 본인(auth_uid 매칭) → 본인 patient_id 내원만(self 정책). nurse(encounter.read 미보유) → staff 정책 false → self 정책만(직원이라 환자 매칭 없음=0행). anon → 0행/거부. service_role → 전체(BYPASSRLS).
- **유형**: 권한·보안

#### TC-E4-62: medical_records RLS — diagnosis/SOAP 임상 경계
- **검증**: NFR-042 / Story 4.6·4.7 / AC4
- **역할/계정**: doctor(medical_record.read/diagnosis.read), reception(encounter.read만), 환자 본인
- **사전조건**: SOAP·진단 있는 내원.
- **단계**: medical_records / encounter_diagnoses SELECT.
- **기대결과**: doctor → 행 수신. **reception(encounter.read 보유하나 medical_record.read·diagnosis.read 미보유) → 0행**(원무가 의사 SOAP·진단 미열람 — 최소권한 임상 경계). 환자 본인 → 내원→환자→auth_uid 경로로 본인 기록만(포털 Epic 8 토대).
- **유형**: 권한·보안

#### TC-E4-63: 전이 감사 append-only + actor 정확성
- **검증**: FR-118/119 문서화 / Story 4.1 / AC3
- **역할/계정**: doctor@pms.local (전이 수행) + admin(감사 조회)
- **사전조건**: registered 내원.
- **단계**: doctor가 start_consult → complete. admin이 audit_logs 조회.
- **기대결과**: 각 전이마다 audit_logs에 target_table='encounters'·target_id=<id>·action='update' 행. actor_id=전이 수행자 uid(start=doctor). before_data·after_data status 차이. INSERT(walk-in)는 action='create'. append-only(수정/삭제 불가).
- **유형**: 보안 · 경계

#### TC-E4-64: 대기열 = encounters status (별도 큐 테이블 없음)
- **검증**: FR-022 / Story 4.2·4.3 / 설계
- **역할/계정**: reception@pms.local
- **사전조건**: walk-in 접수 직후.
- **단계**: 접수(INSERT) → 보드 새로고침/실시간.
- **기대결과**: walk-in INSERT(department_id + status='registered')가 곧 그 진료과 대기열 진입(별도 enqueue 액션 없음). idx_encounters_dept_status로 조회. 4.3 보드가 즉시 표시.
- **유형**: 정상 · 경계

---

## FR 커버리지 체크

| 담당 FR | 커버 시나리오 | 비고 |
|---|---|---|
| FR-020 예약환자 접수→'접수'·대기열 등록 | TC-E4-01, 09, 16, 64 | register_encounter RPC(scheduled→registered) + walk-in INSERT 모두 대기열 진입 |
| FR-021 walk-in 즉석접수 | TC-E4-09, 10, 11, 12, 13, 14, 15 | 직접 INSERT, registered_at·created_by 충전, 활성 가드 |
| FR-022 진료과·진료실별 실시간 대기현황·순번 | TC-E4-18, 19, 23, 25, 26, 64 | 상태 그룹·활성도 순·denormalized·실시간 |
| FR-023 다음호출·호출상태 기록(중복/누락 방지) | TC-E4-19, 20, 21, 22 | record_encounter_call(비-전이 마커), call_count, mutation disable |
| FR-030 진료대기열 조회·진찰시작→'진행중' | TC-E4-01, 27, 28, 29, 30, 31, 32 | start_consult RPC, doctor_id=호출자 |
| FR-031 과거 내원·진단·처방·검사 이력 한 화면 | TC-E4-42, 43, 59 | GET /patients/{id}/encounters. 진단/처방/검사 per-visit은 4.7/Epic5 backfill(이력=내원 메타만) |
| FR-032 간호 활력 등 사전입력 확인 | TC-E4-43 | ⚠️ 활력 테이블 미구축(Epic 5/5.6) → 명시 빈-상태 검증만 |
| FR-040 SOAP 작성·저장 | TC-E4-44, 45, 46, 48, 49 | autosave 디바운스·POST/PUT, 스테일 탭 가드 |
| FR-041 한 내원 복수 진료기록(1:N) | TC-E4-47 | encounter_id FK 다행, 작성자 스코프 |
| FR-042 평가(A)에 KCD 진단·주/부 구분 | TC-E4-51~60 | encounter_diagnoses, 부분 unique 2종, 주상병 게이트 |
| FR-005 알레르기 안전경고(can't-miss) | TC-E4-38 | 약물 상호작용은 Epic 5(5.5) — 4.5는 allergies 자유텍스트만 |
| FR-241 주민번호 reveal(권한+감사) | TC-E4-39, 41 | reveal_rrn RPC, decrypt_sensitive 자가-감사 |
| FR-242 연락처 reveal + SOAP 마스킹 | TC-E4-40, 41, 50 | reveal_contact(신규 권한 0012) + medical_records 감사 마스킹 |
| 횡단: 상태머신(역행/건너뛰기/종결 재전이 차단) | TC-E4-02, 03, 04, 05, 08, 28 | enforce_encounter_transition + RPC precondition |
| 횡단: 취소/노쇼 예외 경로 | TC-E4-06, 07 | cancel_encounter·mark_no_show 매트릭스(no_show=scheduled에서만) |
| 횡단: 주상병 없으면 완료 차단(422) | TC-E4-56, 57 | complete_encounter 재정의(PT422) |
| 횡단: 세션 활성 내원 1개 가드 | TC-E4-34, 35, 36, 46 | localStorage pms.active_encounter + storage 이벤트 |
| 횡단: 실시간 구독·신선도 가드 | TC-E4-23, 24 | postgres_changes + stale 배너/버튼 비활성 |
| 횡단: RLS·감사 | TC-E4-61, 62, 63 | staff/self/anon, 임상 경계, append-only |
| 횡단: SQLSTATE→HTTP 매핑 | TC-E4-17 | PT409/PT404/42501/PT422/FK23503 |

**커버리지: 담당 FR 13종(FR-020·021·022·023·030·031·032·040·041·042·005·241·242) + 횡단 8영역 전수 커버. 시나리오 64건.**

---

## 특이점 / 주의점

### 1. 상태머신 전이 매트릭스 (테스트 시 반드시 준수)

```
(INSERT) → scheduled | registered      [그 외 초기상태 = PT409]
scheduled  → registered | cancelled | no_show
registered → in_progress | cancelled
in_progress→ completed
종결(completed·cancelled·no_show) = 이탈 전이 없음(역행 금지)
```
- 모든 잘못된 전이 = `PT409`→409. 전이 트리거는 service_role 직접 update까지 차단(방어심층 최종선).
- RPC 소스상태 precondition이 same-status 재호출도 차단(진료 탈취 방지) — 트리거의 same-status 통과 사각을 RPC가 메움.
- **호출(call)은 전이가 아님** — status 불변, called_at/call_count만 갱신. 재호출=정상(count++).
- **완료(complete)는 상태 검사가 주상병 게이트보다 선행** — completed 내원 재완료 시 PT422가 아니라 PT409.

### 2. 세션 활성 내원 1개 가드 (테스트 환경 의존성)

- 메커니즘 = 브라우저 localStorage `pms.active_encounter` + `window` storage 이벤트(Zustand 미사용·바닐라). **크로스 탭/단말 세션 가드는 같은 브라우저 내에서만 동작**(서버 락 아님).
- 테스트 시 conflict/superseded는 같은 브라우저의 두 탭으로 재현해야 함. 시크릿/다른 브라우저는 localStorage 분리되어 가드 미작동(설계상).
- 이 가드를 4.6 SOAP autosave가 소비(`isActiveEncounter`) — superseded 탭에서 저장 거부. 이것이 잘못된 환자 차팅 방지의 핵심 안전선이며 별도 서버 강제는 없음(by-design).

### 3. 실시간 구독 의존성 (테스트 환경 주의)

- 실시간 = Supabase `postgres_changes`(진료과 필터). encounters는 `0011`에서 supabase_realtime publication + `replica identity full` 등록(코드베이스 최초). **db reset 후 auth/kong 재시작이 필요할 수 있음**(메모리: db reset 후 502/realtime 끊김 → docker restart + 토큰 폴링).
- 실시간 미수신 시 30초 백스톱 폴링이 reconcile하므로 ≤5초 실시간이 안 보여도 결국 갱신됨(테스트 시 둘 구분).
- payload는 비-PII(encounters 행만, 환자명 없음) → 표시 데이터는 FastAPI GET 조인으로 분리(UX-DR22).
- stale 가드는 channelStale 또는 lastSyncedAt>40s 합산. 40s>폴링 30s라 정상 폴링 시 깜빡임 없음.

### 4. 데모 시드의 상태 분포 한계

- 시드에는 **scheduled/cancelled/no_show 내원이 없다**(encounters 테이블 기준). register_encounter(scheduled→registered)·mark_no_show·cancel(scheduled 경로)는 psql/service_role로 scheduled 행을 직접 INSERT해 셋업해야 한다.
- in_progress 내원 e07·e08은 SOAP/진단이 비어 있어 **진료 허브 작성 테스트의 깨끗한 대상**(완료 내원 e01~e06은 SOAP·진단·수납 finalized 보유 — 읽기/이력 테스트용).

### 5. RBAC baseline 이동 주의 (회귀 테스트 정합)

- **무권한 403 baseline = nurse@pms.local** (encounter.* / patient.* / medical_record.* / diagnosis.* 전부 0). doctor는 4.4~4.7에서 권한을 받으므로 더 이상 403 baseline 아님.
- ⚠️ **reception은 complete(7.4)·cancel(7.9) 권한을 시드로 받음** → complete/cancel 403 baseline 아님(nurse만). 시나리오 작성 시 "complete 403"은 nurse로 검증.
- medical_record.read·diagnosis.read는 **신규 권한이라 admin boot grant 재실행 필수**(0012/0013/0014) — `test_admin_role_has_all_permissions` 회귀 방지. db reset 후 admin이 신규 권한 보유 확인.

### 6. 미구현/이월 경계 (테스트 범위 밖 — 오탐 방지)

- 활력징후 실데이터·약물 상호작용 교차검증 = Epic 5(5.6/5.5). 4.5는 빈-상태/allergies 자유텍스트만.
- 진료 완료 후 sticky flow stepper·수납 핸드오프·신원 확인 = Epic 7. 4.7은 최소 완료 액션(되돌릴 수 없음 힌트+disable+422 인라인)만.
- 좌패널 과거 진단/처방/검사 per-visit backfill = 4.7/Epic 5 이월(이력=내원 메타만).
- 동시 전이 낙관적 잠금(If-Match)·is_active 비활성 내원 전이 차단·hard delete 우회 가드·서버측 연락처 마스킹·SOAP 작성 윈도우 잠금 = 전부 명시 이월(deferred). 이들 경로의 "구멍"은 의도된 deferred이지 버그 아님.
- complete_encounter 게이트 TOCTOU(주상병 동시 제거)·동시 주상병 부착 unique 오매핑 = deferred(단일 의사 세션 가드 하 도달성 낮음).
