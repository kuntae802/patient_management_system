# UX Source Extract — PRD (환자 관리 시스템 / Patient Management System)

> Source: `prds/prd-patient_management_system-2026-06-18/prd.md` (status: final, 2026-06-18)
> Scope: 외래(Outpatient) only, ~26 tables. 6 roles. Staff = 데스크톱 웹; Patient = Android 모바일 앱(APK). Backend = Supabase.
> Design north star (PRD §1): the central design persona is the **신규 직원** (new employee without 암묵지). Every screen is judged by "이 사람이 선배 없이도 제대로 일할 수 있는가" (can this person work correctly without a senior?).

---

## 1. Actors & Roles (RBAC)

PRD states **6역할 (6 roles)** = 직원 5 + 환자 1 (§1, §8.2). Identity is split-profile: 직원 = `사용자` (id = auth uid), 환자 = `환자.auth_uid`; on login the uid's owning table decides staff-vs-patient branch (FR-212).

| Role (verbatim) | Platform | What they do on screens |
|---|---|---|
| **원무 / 접수 (원무 직원)** | 데스크톱 웹 | 환자 레코드 직접 생성 (앱 미사용/전화·방문·고령자, FR-002); 예약 대리 생성·변경·취소 (FR-011); 도착 환자 접수 → 내원 생성·'접수' 상태·대기열 등록 (FR-020); walk-in 즉석 접수 (FR-021); 수납 처리·결제 기록·내원 '완료' 전환 (FR-112); 표준 진료비 계산서·영수증·세부산정내역서 출력 (FR-113~114); 원외처방전 출력·발급 (FR-115); 환자 임상 프로필 입력·갱신 (FR-004). Journey name: 신규 원무 정해린. |
| **의사 (진료의 / 판독의 겸임)** | 데스크톱 웹 | 진료 대기열 조회·진찰 시작 → '진행중' 전환 (FR-030); 과거 이력 타임라인 한 화면 조회 (FR-031); 간호 사전입력(활력징후) 확인 (FR-032); SOAP 작성 (FR-040~041); 진단(KCD) 부착·주/부진단 (FR-042); 약 처방 발행 (FR-050~052); 검사·영상 오더 (FR-060~061); 처치 오더 (FR-070); 영상 판독 소견 기록 → 검사 오더 완료 (FR-102, 판독의 겸임 허용 §8.3); 환자 임상 프로필 조회 (FR-005)·입력 (FR-004). Journey name: 김도현 과장. |
| **간호사** | 데스크톱 웹 | 처치 워크리스트 조회 (FR-090); 활력징후 측정·기록 (혈압·맥박·체온·호흡수·SpO2, FR-091); 지시된 처치 오더 수행 처리 + 처치기록 (수행자·시각·내용) → '수행' 전환 (FR-092); 오더 없는 일상 간호기록 (FR-094); 진단검사(검체) 채취 워크리스트 (FR-061). 재수행 차단됨 (FR-093). Journey name: 신규 간호사 한지우. |
| **방사선사** | 데스크톱 웹 | 촬영 워크리스트 + 대기 목록 조회 (FR-100); 촬영 수행 처리, 영상 스토리지 저장 후 URL만 DB 연결 (FR-101); 검사장비 목록·상태 확인 (FR-103). Journey name: 오민재. |
| **관리자 (원장)** | 데스크톱 웹 | 마스터 관리: 진료과·진료실 (FR-200), 진단(KCD)·수가(EDI)·약품 + 버전/유효기간 (FR-201), soft delete (FR-203); RBAC: 역할-권한 체크박스 토글 (FR-211), 직원 계정 생성·역할·소속과·면허번호 (FR-214), 재직상태 관리·차단 (FR-215); 근무표·휴진/예외 등록 (FR-220~221); 운영 대시보드·통계 (FR-230); 감사로그 조회·필터 (FR-243). Journey name: 최원장. |
| **환자** | Android 모바일 앱 (APK) | 회원가입·본인인증 (FR-001); 진료과·의사·슬롯 조회·예약 (FR-010); 본인 내원 이력(예약·진찰·진단) 조회 (FR-120); 본인 처방·검사결과 조회 (FR-121); 본인 수납·영수증 조회 (FR-122). 본인 데이터만 — RLS 강제 (FR-240). Journey name: 이수진. |

---

## 2. Surfaces / Screens / Feature areas

Derived by grouping FRs. (Staff = web unless noted; Patient = mobile app.)

**Patient mobile app (환자 포털)**
- 회원가입·본인인증 — FR-001 (본인인증은 시뮬레이션, §8.3)
- 예약 (진료과·의사·슬롯 조회·예약) — FR-010
- 본인 내역 조회: 내원 이력/진찰/진단 — FR-120; 처방·검사결과 — FR-121; 수납·영수증 — FR-122

**원무/접수 (staff)**
- 환자 등록·검색 (직접 생성, 앱가입 자동연결, 보호자 정보) — FR-002~003, FR-006
- 환자 임상 프로필 입력·갱신 — FR-004
- 예약 관리 (대리 생성·변경·취소) — FR-011
- 접수 (예약 환자 접수, walk-in) — FR-020~021
- 수납 처리·결제·완료 — FR-112; 진료비 문서 출력 — FR-113~114; 원외처방전 발급 — FR-115; 부분수행 정산 — FR-119

**진료 허브 / 의사 (clinical hub, staff)**
- 진료 대기열 — FR-030
- 진료 화면 (환자 임상 프로필 + 과거 이력 타임라인 + 간호 활력징후 + SOAP + 진단) — FR-005, FR-031~032, FR-040~042
- 처방 작성 — FR-050~052
- 검사·영상 오더 — FR-060~061
- 처치 오더 — FR-070
- 영상 판독 소견 — FR-102

**간호 (staff)**
- 처치 워크리스트 — FR-090, FR-092~093
- 활력징후 기록 — FR-091
- 일상 간호기록 — FR-094
- 검체 채취 워크리스트 — FR-061

**방사선 (staff)**
- 촬영 워크리스트 + 대기 목록 — FR-100
- 촬영 수행·영상 업로드 — FR-101
- 검사장비 목록·상태 — FR-103

**대기/현황 (shared display)**
- 진료과·진료실별 실시간 대기 현황·순번 — FR-022
- "다음 호출 환자" 안내·호출 상태 — FR-023

**관리자 (admin, staff)**
- 마스터 데이터 관리 (진료과·진료실·KCD·EDI수가·약품, 버전/유효기간, soft delete) — FR-200~203
- RBAC 관리 (역할·권한 토글, 직원 계정·프로필·재직상태) — FR-210~215
- 근무표·휴진/예외 관리 — FR-220~221
- 운영 통계·대시보드 — FR-230
- 감사로그 조회·필터 — FR-242~243

**예약 엔진 (system, surfaces in 원무/환자 예약 screens)**
- 가능 슬롯 노출 (근무표·휴진 반영) — FR-012; 더블부킹 차단 — FR-013; SMS 리마인더(시뮬/로그) — FR-014; 노쇼 카운트·임계치(기본 2회) 제한 — FR-015; 휴진 재배정·안내 — FR-016

---

## 3. Key journeys / workflows

**UJ-1 — 한 번의 내원, 6역할을 가로질러 (THE golden path / 합격선, §3).** End-to-end across all 6 roles, must run unbroken.
- **Start (예약, 환자):** 이수진 picks 김도현's open slot in app → SMS reminders (3일 전·1일 전).
- **접수 (원무):** 정해린 finds 수진 in 예약 목록 → 접수 → 내원 '접수' status → 정형외과 대기열. System tells next-call patient (no memorizing 순번).
- **진료·오더 (의사) — climax / clinical hub:** 김 과장 sees 과거 이력 + (간호가 잰) 활력징후 + 임상 프로필 **on one screen** → SOAP, assessment(A) + 진단(KCD) → orders 어깨 X-ray, 소염제, 물리치료 → each order '지시' to its 직역.
- **수행 (간호·방사선):** 한지우 takes 물리치료 from 처치 워크리스트, records 수행 (already-done can't re-click → 중복 방지). 오민재 shoots X-ray, image to storage (URL in DB), 김 과장 writes 판독 → 검사 오더 완료.
- **수납 (원무):** 진찰·수행 끝나면 수가 자동 적재 → 수납 건 생성. 정해린 후수납 정산 → 진료비 계산서·영수증·세부산정내역서 출력, 원외처방전 발급 → 내원 '완료'.
- **End (운영, 관리자):** 최원장 grants 한지우 권한, views 오늘 내원·매출·노쇼 현황, checks 민감정보 접근 in 감사로그.
- **Patient close-loop:** 수진 views 진료·처방·영수증 in her app (본인 데이터만, RLS).

**Order lifecycle workflow (§4, FR-080) — by type:**
- 처방(약): 발행 → 발급 (원외 약국 조제, 시스템 내 수행자 없음).
- 검사·영상: 지시 → 수행 → 판독/결과 기록 → 완료.
- 처치: 지시 → 수행 → 완료.
- All record 지시자·수행자·시각.

**예약 workflow (FR-010~016):** 슬롯 조회 → 예약 (환자 self or 원무 대리) → 더블부킹 차단 → SMS 리마인더 → (no-show tracked, 임계치 제한) / (휴진 시 영향 예약 표시·재배정).

**수납 workflow (FR-110~119):** 수가 자동발생 (진찰 시 진찰료 / 오더 수행완료 시 검사·처치·영상 / 처방 발행 시 약제비) → 수납 건 생성 → 급여/비급여·본인부담 산정 → 결제 기록 → 완료 → 문서 출력. 후수납 기본 / 선수납 옵션 (FR-117); 취소·노쇼 = 수가 미발생 (FR-118); 부분수행 = 수행분까지 정산 (FR-119).

**Onboarding-as-design-goal:** new employee completes core task first week with no senior, guide-only completion (§8.1, NFR-051).

---

## 4. Entities & data to display

**Hub entity = 내원 (Encounter)** — one visit; states 예약→접수→진행중→완료 (+취소/노쇼). Pipeline center (§2, §4).

**On the 진료 화면 (clinical hub) — high content density, one-screen aggregation (FR-031~032, FR-005):**
- 환자 임상 프로필: 혈액형·알레르기·기저질환·복용약·특이사항 (FR-004)
- 간호 활력징후: 혈압·맥박·체온·호흡수·SpO2 (FR-091)
- 과거 이력 (내원·진단·처방·검사결과) as **타임라인/요약** (FR-031)
- SOAP record (주관적·객관적·평가·계획); 한 내원 1:N (FR-040~041)
- 진단: KCD 선택, 주진단/부진단 (FR-042)

**처방전 (FR-050):** 헤더 + 상세 라인 (약품·용량·횟수·일수·용법). 동일성분 중복 경고 (FR-052).

**오더:** type, 지시자·수행자·시각, status. Routes to role-specific 워크리스트 (FR-061, 080).

**Lists / worklists (table/queue density):**
- 진료과·진료실별 실시간 대기 현황·순번 + "다음 호출 환자" (FR-022~023)
- 진료 대기열 (FR-030)
- 처치 워크리스트 (FR-090); 촬영 워크리스트 + 대기 목록 (FR-100); 검체 채취 워크리스트 (FR-061)
- 검사장비 목록·상태 (FR-103)

**수납 (수납 헤더 + 상세 라인, FR-110):** 수가 항목·횟수·일수·금액; 급여(본인부담/공단부담)·비급여 구분, 본인부담금 (FR-111).

**Standard printed/output documents (Korean, FR-113~115):**
- 「진료비 계산서·영수증」 — 대분류 항목, 급여/비급여 구분, 3-행 합계 (본인부담총액·이미 납부한 금액·납부할 금액).
- 「진료비 세부산정내역서」 — line cols: 항목분류·일자·코드·명칭·단가·횟수·일수·금액·본인부담·공단부담.
- 원외처방전.

**Master data lists:** 진료과·진료실·KCD진단·EDI수가·약품 (with 버전/유효기간) (FR-200~201).

**Admin dashboard (FR-230):** 일별 내원·대기·매출·노쇼율 등 통계.

**Audit log view (FR-242~243):** 행위자·시각·대상·동작, filter by 행위자·기간·대상.

**Patient app:** 본인 내원 이력·진찰·진단 (FR-120), 처방·검사결과 (FR-121), 수납·영수증 (FR-122).

---

## 5. States & validation

**내원 state machine (§4, NFR-040):** `예약(Scheduled)` → `접수(Registered)` → `진행중(In-progress)` → `완료(Completed)`; exceptions `취소(Cancelled)` / `노쇼(No-show)`. Only defined transitions allowed — 역행·건너뛰기 방지 (NFR-040).

**Order sub-lifecycle states (§4, FR-080):** 처방 = 발행→발급; 검사·영상 = 지시→수행→판독/완료; 처치 = 지시→수행→완료.

**Validation / guard rules:**
- 더블부킹 차단; 오버부킹은 정책 설정 시만 허용 (FR-013).
- 노쇼 임계치 기본 2회 초과 시 예약 제한 (FR-015, §8.3 확정).
- 동일성분 중복 처방 경고 (FR-052).
- 이미 수행된 오더 재수행 차단 — 처치 중복·누락 방지 (FR-093). UI must show already-done state.
- 비표준 자유 입력 제한 — 임상·정산 입력은 마스터에서만 선택 (FR-202, single source of truth).
- 가능 슬롯만 노출 (근무표·휴진 반영) (FR-012).
- 권한 없는 기능은 비노출 또는 거부 (FR-213).
- 중복 환자 방지: 원무 생성 환자 ↔ 앱 가입 본인인증 자동 연결 (FR-003).
- 취소·노쇼 = 수가 미발생 종결 (FR-118).
- 주민등록번호 등 민감정보 → encrypted (implies masked display; format validation implied but not explicitly specified as a format rule).

**Empty / loading / async states (implied by NFRs):**
- 대기 현황·워크리스트 갱신 ≤5초 (실시간 구독 또는 폴링) — UI needs live-refresh state (NFR-002).
- 주요 화면 조회 응답 ≤2초 목표 (NFR-001).
- 휴진 등록 시 영향받는 예약을 표시 (재배정 prompt state) (FR-016).

---

## 6. UX-affecting constraints

- **Korean-only UI + outputs (NFR-052):** 모든 UI와 표준 출력 문서는 한국어. All terminology Korean (verbatim terms above).
- **Two platforms:** staff = 데스크톱 웹 (최신 Chromium) (NFR-010); patient = Android 앱 APK (NFR-011). Responsive/desktop-first for staff; mobile-native patterns for patient.
- **PII masking / 민감정보:** 주민등록번호 등 pgcrypto 암호화 저장, key in Supabase Vault (FR-241). Sensitive-info **조회** itself is an audited action (FR-242) → masked-by-default display, reveal as audited event.
- **RLS data-scoping (FR-240, NFR-021):** 환자 본인 데이터만; 직원 역할별. DB-enforced — screens must never show out-of-scope data; success metric = "환자 본인 외 데이터 접근 0".
- **Permission-driven UI (FR-211, FR-213, NFR-051):** features hidden or denied per role permission; admin toggles permissions via checkbox with immediate effect (no code change). Each role completes its core flow within its own screen, no external guidance.
- **Real-time updates (NFR-002):** 대기 현황·워크리스트 5초 이내 refresh (구독/폴링).
- **Next-step guidance is mandated UX (NFR-050):** each clinical-stage screen explicitly presents next possible action(s) for the current 내원 (다음 단계 안내/버튼). This is the core usability principle for the 신규 직원.
- **Notifications/alerts:** SMS reminders 3일 전·1일 전 (simulated/logged in scope, FR-014, §8.3); 휴진 영향 예약 안내 (FR-016); 중복처방·재수행 경고 (FR-052, 093).
- **Print/output:** standard Korean billing documents + 원외처방전 must be print-ready (FR-113~115).
- **Audit visibility (FR-243):** admin-facing audit log browse/filter; append-only (NFR-042).
- **Performance expectation:** ≤2s typical queries on 대기열·진료·수납 (NFR-001, demo-env target).
- **Image handling:** 영상 자료 in storage, only URL in DB (FR-101) — viewer renders from URL.
- **Onboarding-friendliness is the governing design principle** (NFR-050~051, §1): screens must let a new hire finish without a senior.
- **Out of scope (won't appear in UI):** 입원, 실제 EDI 전송, 약국 처방 전송, 검사 외부의뢰 자동화, 실 PG 결제, 실 본인인증/PASS (§8.2~8.3) — these are simulated or absent.

---

## 7. Explicit UI/UX statements

- §1: "모든 화면은 '이 사람이 선배 없이도 제대로 일할 수 있는가'를 기준으로 만든다." Central persona = 신규 직원.
- §1: "6개 역할 화면이 각자의 단계를 규정하며" — role-specific screens define each stage. "직원은 데스크톱 웹, 환자는 모바일 앱(APK)."
- §3 UJ-1 step 3: doctor sees 과거 이력 + 활력징후 + 임상 프로필 **"한 화면에서"** (one-screen aggregation) — explicit layout directive for the clinical hub.
- §3 UJ-1 step 2: "해린은 순번을 외울 필요 없이, 시스템이 알려주는 다음 호출 환자만 부른다" — system-led next-call UX.
- §3 UJ-1 step 5: "베테랑만 알던 코드를 몰라도 시스템이 항목을 채워준다" — system auto-fills items; user need not know codes.
- FR-031: 과거 이력을 **타임라인/요약으로 한 화면에서** 조회 — explicit timeline/summary, single screen.
- FR-211: 역할별 권한을 **체크박스로 토글** (코드 수정 없이 즉시 반영) — explicit control widget.
- FR-213 / NFR-051: 권한 없는 기능은 **비노출 또는 거부**; 핵심 업무 플로우는 역할별 화면에서 **외부 안내 없이 완결**.
- NFR-050: 각 진료 단계 화면은 현재 내원에 대해 **다음 수행 가능한 작업을 명시적으로 제시(다음 단계 안내/버튼)**.
- NFR-052: 모든 UI와 표준 출력 문서는 한국어로 제공.
- FR-113~114: exact printed-document layouts specified (calc/receipt = 대분류 + 급여/비급여 + 3-행 합계; detail statement = specified line columns).
- §8.1 카운터 지표: pipeline/master enforcement must not slow veterans' per-case time or push them to workarounds/free-text — UX must keep enforcement fast and not over-burden input (기록 누락·형식적 입력 risk).
