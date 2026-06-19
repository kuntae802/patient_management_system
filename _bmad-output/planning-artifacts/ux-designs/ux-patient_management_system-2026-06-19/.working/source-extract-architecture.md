# UX Extraction — Architecture Document

Source: `_bmad-output/planning-artifacts/architecture.md` (status: complete, 2026-06-19)
Scope: UX-relevant facts only. Korean terms quoted verbatim. No invention.

---

## 1. Form-factors & surfaces

**Confirmed platforms (NFR-010/011/012, 확정):**
- **직원 데스크톱 웹 (Chromium)** — staff desktop web, Chromium target. The 6 staff roles use this.
- **환자 Android APK** — patient Android app, delivered as APK.
- **백엔드 Supabase / PostgreSQL** — backend (not a UI surface).

**Surface → technology mapping (확정 스택 table):**
- **직원 웹 + 환자 포털 = Next.js 16** (React 19.2, TS, Tailwind 4). One Next app serves both: "직원 6역할 화면(데스크톱) + 반응형 환자 포털." Staff = desktop screens; patient portal = **반응형(responsive)**.
- **환자 모바일 = Flutter 3.44 + webview_flutter 4.x** — "환자 포털(반응형 웹)을 띄우는 얇은 네이티브 셸 → APK. Dart 표면적 최소." It is a **thin native shell loading the responsive web patient portal**, NOT a separate native UI. Future room for "푸시·생체 본인인증(시뮬)" native extension.

**Roles per surface — staff route groups (web/src/app/(staff)/):**
- `reception/` — 접수·대기·수납 (FR-020~023, 110~119)
- `doctor/` — 진료·SOAP·오더·판독 (FR-030~061, 102)
- `nurse/` — 활력·처치 워크리스트 (FR-090~094)
- `radiology/` — 촬영 워크리스트 (FR-100~103)
- `admin/` — RBAC·마스터·스케줄·대시보드·감사 (FR-200~243)
- (auth)/login/ — "분리 프로필 로그인 분기" (split-profile login branch)

**Patient route group (web/src/app/(patient)/):** "반응형 포털(Flutter 웹뷰가 로드)"
- `booking/` — 예약 (FR-010)
- `records/` — 내역·처방·영수증 (FR-120~122)

**Multi-surface implications:**
- "내원 상태머신" engine and worklists are central; reception desk uses a desktop browser (tablet at reception is NOT explicitly mentioned — only Chromium desktop).
- "멀티플랫폼 코드·타입 공유 — 웹/모바일 공통 도메인 모델" (cross-cutting concern #9).
- Patient experience is fundamentally **a responsive web app**, just wrapped in a webview for Android. The portal is "모바일 읽기 경로" (mobile read path) — primarily read-only consumption (records/prescriptions/receipts) + booking.
- route group `(staff)`·`(patient)` are the "청중 경계" (audience boundary).

---

## 2. Named UI system / frontend stack

**Named/mandated UI system (Frontend Architecture > UI·폼):**
- **shadcn/ui (Tailwind 4, 컴포넌트 소유)** — explicitly named. "컴포넌트 소유" = you own the components (copy-in model).
- **TanStack Table (데이터 그리드)** — for data grids.
- **React Hook Form 7 + Zod 4** — forms; Zod is "**Pydantic의 거울**" (mirror of Pydantic).
- **`Intl` ko-KR (날짜·통화 원)** — Intl for ko-KR date/currency (원/KRW).

**State libraries (Frontend Architecture > 상태):**
- 서버 상태 = **TanStack Query v5**; UI 상태 = **Zustand**; 세션 = Supabase 클라이언트.

**Styling/scaffold defaults (Next.js 16):** App Router, TypeScript, **Tailwind CSS 4**, ESLint, Turbopack, React Compiler, `@/*` alias, `src/` structure.

**Routing / basePath / subpath constraints (Infrastructure):**
- Domain: **`kuntae802.mooo.com`**, web subpath: **`/patient_management_system`**.
- **Next.js `basePath=/patient_management_system`**.
- **FastAPI `root_path=/patient_management_system/api`** (behind reverse proxy).
- **Supabase Auth redirect URL · CORS · Flutter 웹뷰 base URL all must reflect this path.**
- Cross-dependency: "서브패스(basePath/root_path) → 전 서피스 + Supabase redirect + APK base URL."
- CORS whitelist: `https://kuntae802.mooo.com`.
- Reverse proxy + Let's Encrypt (TLS). Hosted on **홈 서버 (Docker Compose: web + api)** + Supabase cloud.

**Layout/navigation constraints:**
- App Router **route group** — `(staff)` 역할별 레이아웃 + 미들웨어 가드, `(patient)` 반응형 포털 (same Next app, Flutter webview loads it).
- "**공용 AppShell** + 내원 상태별 next-action 어포던스" — AppShell hosts role nav + next-action.
- "역할 화면은 클라이언트 컴포넌트" (role screens are client components).
- Web component structure: `components/ui/`(shadcn), `components/encounter/`(next-action), `components/<feature>/`. Hooks: `useQueueRealtime`, `useWorklistRealtime`, `usePermissions`. File naming: kebab-case (shadcn convention); components/types PascalCase; hooks `useX`.

---

## 3. Real-time & data-fetch behavior

**Path division (API & Communication Patterns > 경로 분담):**
- **쓰기/명령 (writes/commands) → FastAPI** (`Bearer` token).
- **단순 읽기 (simple reads) → Supabase 직접 (RLS-protected)** using publishable key.
- **복잡 집계·문서 (complex aggregation/documents) → FastAPI.**
- **실시간 (real-time) → Supabase 구독 (subscription).**

**Real-time mechanism:**
- **`postgres_changes`** on 내원·오더 (encounters·orders) tables, with **RLS filters**: "진료과/진료실=대기열 (queue), 직역=워크리스트 (worklist)."
- Integration: "`postgres_changes` 구독 → TanStack Query 캐시 무효화/패치 (`useQueueRealtime` 등)."
- Derived broadcast events named `domain.action` (e.g., `encounter.registered`).
- Freshness target (NFR): "대기열·워크리스트 갱신 ≤5초 (실시간 구독 또는 폴링)." General reads ~2초 target (demo).

**Caching / freshness:** "데모 범위 최소(TanStack Query 클라 캐시 + Supabase 실시간). 별도 캐시 레이어 없음." Cache boundary = client (TanStack Query) only.

**Loading & optimistic-update behavior (Process Patterns > 로딩):**
- TanStack Query `isPending` + **스켈레톤 (skeletons)**.
- "**뮤테이션 중 버튼 비활성**(이중 제출 방지 → 처치 중복방지 FR-093의 UX 1차선)" — disable buttons during mutation to prevent double-submit (this IS the first-line UX defense for treatment de-duplication FR-093).
- "**안전한 곳만 낙관적 업데이트**" — optimistic updates ONLY where safe.

**UI freshness implication:** two read paths (Supabase direct + FastAPI) both return **snake_case JSON** for consistency. Mutations + realtime both trigger TanStack Query invalidation.

---

## 4. State machine & DB-enforced invariants

**State machine = DB enforced (Data Architecture):**
- 내원·오더 상태 enforced by **enum + 전이 검증 트리거/RPC + CHECK** (NFR-040).
- Transition RPCs are **action endpoints**: `register_encounter`, `start_consult`, `complete_encounter`. REST: `POST /encounters/{id}/register`.
- Encounter status enum values (verbatim, English): `scheduled | registered | in_progress | completed | cancelled | no_show`.
- Pipeline (Requirements): 예약→접수→진행중→완료 + 취소/노쇼. "접수는 내원에 흡수." 대기열·순번·호출 (queue / sequence number / call).
- Order lifecycles: 처방(발행→발급), 검사·영상(지시→수행→완료/판독), 처치(지시→수행→완료). "지시자/수행자 FK 분리, **재수행 차단** (re-execution blocked)." Order status vocabulary unified: 지시→수행→완료/판독.
- Cancel/no-show/partial-execution settlement paths are a defined gap to resolve (취소·노쇼·부분수행 정산 경로).

**Auto fee generation (수가 자동발생):**
- DB trigger + 수가매핑 규칙(시드). Reacts to clinical events (진찰/오더 수행 완료/처방 발행) and **원자적 적재** of 수납상세 (billing details). FastAPI handles 수납 finalize + 진료비 문서.

**Audit append-only:**
- 감사로그 (audit_logs): UPDATE/DELETE **REVOKE for all roles including service_role**; INSERT only; trigger SECURITY DEFINER (owner=postgres). Records 변경 전/후 스냅샷 (before/after snapshots).

**RBAC 3 layers (Authentication & Security):**
- **UI 노출 (UX) / FastAPI 명령 강제 (write authority) / RLS 행 강제 (data authority).** DB helper `has_permission(code)` (SECURITY DEFINER). Permission codes are `리소스.동작` (resource.action).
- RLS: patient = owner policy `(select auth.uid()) = 환자.auth_uid` via encounter; staff = role/permission-based.

**What the UI MUST reflect/respect:**
- **Only show allowed next transitions** — "가능한 다음 작업만 제시 (NFR-050)." next-action affordances per encounter status. This is "1급 패턴" (first-class pattern).
- **Permission-gate actions** at UI layer (UI exposure layer of 3-tier RBAC) via `usePermissions` hook; admin page checkbox toggles for RBAC.
- **Immutable records**: audit logs cannot be edited/deleted — UI must treat as append-only/read-only.
- Wrong-transition errors surface as **HTTP 409** ("409(잘못된 전이)"); RBAC denial = **403**; validation = **422**.

---

## 5. Security / PII UX implications

**주민번호 (resident registration number) handling (Authentication & Security):**
- pgcrypto column encryption (`주민번호_hash` / schema `resident_no_enc`, `_hash`). Key in **Vault**; encrypt/decrypt only via service_role SECURITY DEFINER RPC.
- **HMAC blind index** for duplicate matching (FR-003).
- **"화면 마스킹"** — explicit screen masking required.

**주민번호 validation rules (verbatim):**
- "형식 + 생년월일 + 성별/세기 자리(내국 1–4, **외국 5–8 허용**) = HARD" — format + birthdate + gender/century digit (domestic 1–4, **foreigner 5–8 allowed**) is HARD validation.
- "**체크섬 = SOFT(경고, 2020 개편 대비)**" — checksum is SOFT (warning only, due to 2020 reform). Do not block on checksum.
- Validation timing: "클라 Zod (즉시 UX) → 서버 Pydantic (권위) → DB 제약 (최종선)" — 3-tier. FastAPI Pydantic boundary + client pre-check.
- 본인인증 (identity verification, PASS) is **simulated**, separate from RRN validation.

**PII logging (Communication/Process Patterns):**
- "**PII 절대 미기록**(주민번호 등 마스킹)" — never log PII; mask RRN. Anti-pattern: "raw 주민번호 로깅."
- Error handling: "내부정보/PII 노출 금지" — never expose internal info/PII in errors.

**UI implications:** sensitive fields (RRN) must mask by default with controlled reveal; validate format/birthdate/gender-digit hard (block), checksum soft (warn, allow), accept foreigner codes 5–8; never echo raw RRN to logs/toasts/error envelopes; decrypt only through privileged backend path.

---

## 6. Identifiers & i18n

**Identifier language (Implementation Patterns > 식별자 언어):**
- "DB·API·코드 식별자 = 영어 snake_case/표준 케이싱. 한국어는 **UI 라벨·주석·문서·enum 표시명에만**."
- "**영문↔한글 용어집** (glossary) 단일 진실로 유지" — single source of truth. Examples: `encounter=내원, order=오더, fee_item=수가항목, prescription=처방전`. Located at `docs/glossary.md` and PRD glossary extension.

**JSON / DB casing:**
- **JSON 필드 = snake_case** (both read paths — Supabase direct AND FastAPI — return snake_case for consistency).
- Anti-pattern: "DB/JSON에 camelCase 혼용 · 한국어 식별자 즉흥 도입."

**Locale & formatting (Format Patterns):**
- 전면 한국어 UI (NFR-052) — fully Korean UI.
- "한국어 단일 + `Intl` (i18n 프레임워크 없음)" — single Korean locale, Intl only, NO i18n framework.
- Dates = ISO 8601 (timestamptz, UTC stored → **KST 표시는 `Intl`**).
- Amounts = **KRW 정수(원, 소수 없음)** — KRW integer, no decimals.
- Error `code` = machine-readable; **`message` = 한국어** (Korean user-facing message).
- TS variables/functions = camelCase in code (but data/JSON stays snake_case).

**Implications for copy layer:** UI labels are a Korean presentation layer over English snake_case identifiers/enums. enum 표시명 (display names) map English enum values (e.g., `in_progress`) to Korean labels. Korean copy must follow the glossary one-to-one. Error toasts are Korean (`message`); machine `code` stays English.

---

## 7. Explicit UI/UX/frontend statements (verbatim)

- NFR 사용성: **"단계별 \"다음 할 일\" 명시, 역할 범위 내 완결, 전면 한국어"** — *리뷰: 가관측 조건으로 환원 필요(D-3).*
- Frontend Architecture: **"\"다음 할 일\" 가이드 = 1급 패턴: 공용 AppShell + 내원 상태별 next-action 어포던스(가능한 다음 작업만 제시, NFR-050)."**
- Frontend Architecture > UI·폼: **"shadcn/ui(Tailwind 4, 컴포넌트 소유) + TanStack Table(데이터 그리드) + React Hook Form 7 + Zod 4(Pydantic의 거울). `Intl` ko-KR(날짜·통화 원)."**
- Frontend Architecture > 구조·라우팅: **"App Router route group — `(staff)` 역할별 레이아웃 + 미들웨어 가드, `(patient)` 반응형 포털(같은 Next 앱, Flutter 웹뷰가 로드)."**
- Frontend Architecture > 상태: **"서버=TanStack Query v5, UI=Zustand, 세션=Supabase 클라이언트."**
- Frontend Architecture > 성능·i18n: **"Next 16 기본(Turbopack·React Compiler·코드분할), 역할 화면은 클라이언트 컴포넌트, 한국어 단일 + `Intl`(i18n 프레임워크 없음)."**
- Process Patterns > 로딩: **"TanStack Query `isPending` + 스켈레톤. 뮤테이션 중 버튼 비활성(이중 제출 방지 → 처치 중복방지 FR-093의 UX 1차선). 안전한 곳만 낙관적 업데이트."**
- Process Patterns > 에러 처리: **"웹은 Error Boundary + TanStack Query 에러 상태 + 한국어 토스트. 내부정보/PII 노출 금지."**
- RBAC 3계층: **"UI 노출(UX) / FastAPI 명령 강제(쓰기 권위) / RLS 행 강제(데이터 권위)."**
- 주민번호: **"화면 마스킹."**
- NFR 보안: **"개인정보 표준의 \"형태\"만 모사(공식 인증 범위 밖)."**
- Key Strengths: **"멀티서피스 경로 분담이 명확(쓰기=FastAPI / 조회=Supabase / 실시간=구독)."**
