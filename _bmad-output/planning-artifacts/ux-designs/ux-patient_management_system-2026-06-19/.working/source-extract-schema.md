# UX Extraction — DB Schema Brainstorm (Source: brainstorming-session-2026-06-17-05-00.md)

> Scope: 외래(Outpatient) only. ~26 tables + Supabase `auth.users`. Korean 중소병원 환자 관리 시스템 (모바일 APK + 데스크톱 웹). 입원(Inpatient) is explicitly deferred — not in scope.
> 6 화면 분기 (role-based routing): 원무과 · 의사 · 간호사 · 방사선사 · 관리자 · 환자 포털.

---

## 1. Entity Inventory (~26 tables, grouped by domain)

### 환자/프로필 · 사람/인증
- **환자 (Patient)** — 시스템 중심 주체. 차트번호·인적·연락·의료(혈액형/알레르기/기저질환/복용약)·행정(보험/상태). `auth_uid` nullable (포털 가입 환자만).
- **사용자 (User / 직원 프로필)** — Supabase 인증 직원. `id`=auth uid. 사번·이름·`role_id`·`진료과_id`·면허·재직상태.
- **역할 (Role)** — 직원 역할 5종 (reception/doctor/nurse/radiologist/admin). 역할코드·역할명.
- **권한 (Permission)** — 권한코드(`리소스.동작`)·대상리소스·동작(read/create/update/delete).
- **역할_권한 (RolePermission)** — 역할↔권한 N:M 매핑. `(role_id, permission_id)` unique.

### 진료 흐름
- **진료 / 내원 (Encounter)** — ★허브★. 한 내원 1건. 접수(Reception) 흡수 — 대기순번·접수시각 포함. 환자·의사·진료실·진료과 FK.
- **진료기록 (MedicalRecord)** — 진료당 1건. SOAP 형식 (s_주관적호소 / o_객관적소견 / a_평가 / p_계획).
- **진료_진단 (EncounterDiagnosis)** — 진료기록↔진단코드 N:M 연결. `주상병여부`(주/부).

### 처방
- **처방전 (Prescription)** — 진료당 1장(또는 0). 처방유형(원내/원외)·상태·복약지도.
- **처방상세 (PrescriptionDetail)** — 처방전 1:N. 약품_id·1회용량·1일횟수·투약일수·용법·총량(자동계산).

### 검사
- **검사 (Examination)** — 진료당 N건. 검사종류 enum(xray/ct/mri)·검사상태·영상자료(Storage URL)·판독소견. 지시/촬영/판독 FK 3종 분리.
- **검사장비 (Equipment)** — X-ray/CT/MRI 본체. 장비명·종류·모델·설치위치·상태(가동/점검중/폐기).

### 간호
- **처치오더 (TreatmentOrder)** — 의사 지시. 처치종류·지시내용·오더상태(오더→수행완료→취소).
- **처치기록 (NursingRecord)** — 간호사 수행. `처치오더_id` nullable(일상 간호)·수행간호사·수행일시.
- **활력징후 (VitalSign)** — 전용 테이블. 진료당 여러 번 측정(시계열). 혈압/체온/맥박/호흡/SpO2/체중/신장.

### 예약/접수/스케줄
- **예약 (Appointment)** — 사전 예약. 예약상태·예약경로(직원/환자앱)·`진료_id` nullable(노쇼시 미생성).
- **의사근무스케줄 (DoctorSchedule)** — 주간 정기 근무(반복). 요일·시작/종료·점심·예약단위_분.
- **의사일정예외 (DoctorTimeOff)** — 특정일 예외(휴가/수술/학회/병가/공휴일)·종일여부.

### 수가/청구 (수납)
- **수납 (Payment)** — 진료당 1건(헤더). 총진료비/공단부담금/본인부담금·결제상태·결제수단.
- **수납상세 (PaymentDetail)** — 수납 1:N(라인). 수가코드·항목분류·단가·수량·줄별 급여/본인/공단·발생출처.
- **수가마스터 (FeeSchedule)** — EDI수가코드·명칭·항목분류·기준단가·급여구분·사용여부.

### 코드/마스터
- **진료과 (Department)** — 과코드·과명·위치/내선·사용여부.
- **진료실 (Room)** — 호실·진료실명·유형(진료실/검사실/처치실)·층·사용여부.
- **약품 마스터 (Drug)** — 약품코드·약품명·성분명·제형·규격·단가·보험구분·사용여부.
- **진단코드 (Diagnosis)** — KCD/ICD-10 질병코드·진단명(한/영)·분류·사용여부.

### 감사/시스템
- **감사로그 (AuditLog)** — 사용자_id·action(create/read/update/delete/login)·대상테이블·대상_id·`변경전`/`변경후`(jsonb)·ip주소·발생일시.

> `auth.users` (Supabase) — 인증 전용(이메일/비번/세션), 환자·직원 공통. 직접 화면 노출 대상 아님.

---

## 2. Key Relationships — drives detail-page layout & nav depth

### Central hub: 진료 (Encounter) ★
진료 한 건이 거의 모든 임상·정산 데이터를 묶는 spoke 중심. 진료 detail page = the master canvas; all of the following hang off one 진료:
- 진료 (1) ─ 진료기록 (1) ─N:M(진료_진단)─ 진단코드
- 진료 (1) ─ 처방전 (0..1) ─1:N─ 처방상세 ─N:1─ 약품마스터
- 진료 (1) ─< 검사 (N) ─N:1─ 검사장비 / 사용자(지시·촬영·판독)
- 진료 (1) ─< 처치오더 (N) ─1:N─ 처치기록 ─N:1─ 사용자(간호사)
- 진료 (1) ─< 활력징후 (N) ─N:1─ 사용자(간호사)
- 진료 (1) ─ 수납 (0..1) ─1:N─ 수납상세 ─N:1─ 수가마스터

### Patient-rooted (longitudinal)
- 환자 (1) ─< 진료 (N) — 방문 누적 → 환자 진료 이력 타임라인
- 환자 (1) ─< 예약 (N) ─0..1─ 진료 (노쇼/취소면 진료 미생성)

### Identity / RBAC
- auth.users ─1:1─ 사용자(직원) ─N:1─ 역할 ─N:M(역할_권한)─ 권한
- auth.users ─1:1─ 환자(포털, nullable)
- 로그인 분기: uid가 `사용자`에 있으면 직원, `환자`에 있으면 환자 포털

### Master/reference fan-out
- 진료과 ─1:N─ {사용자(의사), 진료실, 예약, 진료}
- 의사(사용자) ─1:N─ {의사근무스케줄, 의사일정예외}
- 사용자 ─1:N─ 감사로그

### Master-detail (header/line) pattern — repeated 3x
처방전/처방상세, 수납/수납상세, (장비-검사). Implies header form + editable line-item grid layouts.

---

## 3. High-Density Display Surfaces (lists/tables/dashboards vs single-record forms)

### List / dashboard / table surfaces (high density)
- **대기 현황판** — `진료상태='접수'` 조회 + `대기순번`·`호출시각`. 실시간 큐(원무/의사 공유). Encounter가 source.
- **환자 진료 이력 타임라인** — 환자 1:N 진료 누적. Reverse-chronological encounter list.
- **활력징후 시계열 그래프** — 한 진료 N회 측정 → 라인 차트(혈압/체온/맥박/SpO2 등).
- **검사 워크플로우 현황판** — `검사상태`(오더→촬영완료→판독완료) 단계별 칸반/리스트. 방사선사·영상의학과 공유.
- **처치오더 큐** — `오더상태`(오더→수행완료) 의사 지시 → 간호사 수행 리스트.
- **예약 캘린더 / 슬롯** — 가용 슬롯 = 근무 − 예외 − 기존예약 (동적 계산, 저장 X). 의사별 일정 그리드.
- **청구/수납 내역** — 수납상세 항목분류별 라인 그리드 + 헤더 합계. 미수납/부분/완료 필터.
- **진료비 계산서·영수증 / 세부산정내역서** — 한국 표준 문서, 수납상세에서 쿼리로 자동 생성(인쇄/출력 뷰).
- **관리자 권한 매트릭스** — 역할 × 권한 체크박스 매트릭스(토글 시 역할_권한 행 add/delete). 관리자 페이지 핵심 화면.
- **마스터 관리 그리드** — 약품/수가/진단코드/진료과/진료실/검사장비: CRUD 가능한 검색·필터 테이블 (시드 데이터 다수).
- **감사로그 뷰어** — 대량 로그 필터/검색(사용자·action·테이블·기간), read-only.
- **처방상세 / 수납상세 라인 에디터** — 편집형 그리드(약·용량·일수 / 항목·단가·수량).

### Single-record detail forms
- **환자 등록/상세 폼** — 인적·연락·의료·행정 다축 폼(마스킹 필드 포함).
- **진료기록 SOAP 폼** — S/O/A/P 4개 텍스트 섹션 + 진단 다중선택.
- **검사 상세** — 정보 + 영상 뷰어(Storage URL) + 판독소견.
- **예약 등록 폼**, **의사 근무 스케줄 설정 폼**, **수납 결제 처리 폼**.

---

## 4. Sensitive / Masked Fields — masking/reveal UX required

- **`주민등록번호_enc`** (환자) — pgcrypto `pgp_sym_encrypt` 암호화 저장. 화면 표시는 **마스킹** `900101-1******`. Reveal은 권한 통제 + 감사 기록 대상. (UI: 기본 마스킹, 권한 있을 때만 reveal 버튼.)
- **`휴대전화`, `주소`, `이메일`** (환자) — PII. 부분 마스킹/접근 통제 검토.
- **`보호자명`, `보호자_연락처`, `보호자_관계`** (환자) — 제3자 PII.
- **`면허번호`** (사용자) — 직원 자격 정보.
- **`보험번호`** (환자) — 행정 식별자.
- **의료 민감정보 전반** — RLS: 환자는 본인 데이터만 조회. 직원은 역할별 접근. → UI는 역할별로 보이는 필드/행이 달라짐(권한 게이팅).
- 비밀번호는 Supabase Auth가 해시 처리 → UI에 평문 노출 없음.

---

## 5. Enumerations & States — badges / filters / state indicators

### Status enums (badge / filter / state-flow UI)
- **진료상태** (Encounter): 예약 / 접수 / 진행중 / 완료 / 취소 — 대기현황·통계의 기반.
- **내원경로** (Encounter): 예약 / 당일접수.
- **진료유형** (Encounter): 초진 / 재진.
- **검사상태** (Examination): 오더 → 촬영완료 → 판독완료 (워크플로우 단계).
- **검사종류** (Examination/Equipment): xray / ct / mri.
- **장비 상태** (Equipment): 가동 / 점검중 / 폐기.
- **처방상태** (Prescription): 발행 / 취소.
- **처방유형** (Prescription): 원내조제 / 원외처방.
- **오더상태** (TreatmentOrder): 오더 → 수행완료 → 취소.
- **예약상태** (Appointment): 확정 / 취소 / 노쇼 / 완료 (노쇼율 통계).
- **예약경로** (Appointment): 직원접수 / 환자앱.
- **결제상태** (Payment): 미수납 / 부분수납 / 수납완료.
- **결제수단** (Payment): 현금 / 카드 / 계좌이체.
- **급여구분** (수납상세/수가마스터/약품): 급여 / 비급여 / 전액본인.
- **항목분류** (수납상세/수가마스터): 진찰료/검사료/영상진단료/주사료/처치료/투약조제료/치료재료/비급여… (그룹 헤더·필터).
- **주상병여부** (진료_진단): 주진단 / 부진단.
- **환자 상태**: 활성 / 비활성.
- **재직상태** (사용자): 재직 / 휴직 / 퇴사.
- **보험유형** (환자): 건강보험 / 의료급여 / 자보.
- **요일** (DoctorSchedule): 월~일.
- **사유** (DoctorTimeOff): 휴가/수술/학회/병가/공휴일.
- **action** (감사로그): create / read / update / delete / login.

### Code/master tables rendered as dropdowns/lookups in UI
- 진단코드 (KCD/ICD-10), 약품 마스터(약품코드), 수가마스터(EDI코드), 진료과(과코드), 진료실(호실), 권한(권한코드 `리소스.동작`).

---

## 6. Derived / Computed / Read-only Data (UI shows, user does not directly edit)

- **수납 헤더 합계** (`총진료비`/`공단부담금`/`본인부담금`) — 수납상세 라인의 SUM. UI: read-only 합계, 라인 변경 시 재계산.
- **처방상세 `총량`** — 1회용량×1일횟수×투약일수 자동계산.
- **진료비 계산서·영수증 / 세부산정내역서** — 수납상세에서 쿼리로 자동 생성되는 표준 문서(출력 전용).
- **가용 예약 슬롯** — 근무 − 예외 − 기존예약, 동적 계산(저장 안 함). UI: 계산된 슬롯만 표시.
- **대기 현황** — `진료상태='접수'` 파생 조회(별도 상태 저장 없음).
- **감사로그** — 시스템 자동 기록, `변경전`/`변경후` jsonb 스냅샷. UI: read-only diff 뷰어.
- **수납상세 `발생출처`+`출처_id`** — 비용이 어느 검사·처치·처방에서 발생했는지 추적 링크(read-only trace).
- **최근방문일** (환자) — 진료 누적으로 갱신되는 파생 필드.
- 통계류: 노쇼율(예약상태), 주상병 기준 집계 등 — 대시보드 read-only.

---

## UX-Critical Takeaways
- **진료(Encounter) detail page는 시스템의 master canvas** — SOAP·처방·검사·간호·활력·수납이 모두 한 화면(또는 탭)에서 spoke로 접근. 정보 밀도·탭 구조 설계의 핵심.
- **6종 role routing** → 같은 데이터도 역할별로 다른 화면/필드 노출(권한 매트릭스가 그 dial).
- **3개의 워크플로우 상태 흐름**(진료상태 / 검사상태 / 오더상태)이 현황판·칸반 UI를 요구.
- **마스킹/리빌 + RLS**가 PII 표시의 기본 규칙.
- **마스터-디테일 라인 에디터 + 자동합계**가 처방·수납 화면의 공통 패턴.
