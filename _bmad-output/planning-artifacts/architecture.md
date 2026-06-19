---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-patient_management_system-2026-06-18/prd.md
  - _bmad-output/planning-artifacts/briefs/brief-patient_management_system-2026-06-18/brief.md
  - _bmad-output/brainstorming/brainstorming-session-2026-06-17-05-00.md
  - _bmad-output/planning-artifacts/prds/prd-patient_management_system-2026-06-18/research-domain.md
  - _bmad-output/planning-artifacts/prds/prd-patient_management_system-2026-06-18/reconcile-schema.md
  - _bmad-output/planning-artifacts/prds/prd-patient_management_system-2026-06-18/reconcile-brief.md
  - _bmad-output/planning-artifacts/prds/prd-patient_management_system-2026-06-18/review-adversarial-general.md
  - _bmad-output/planning-artifacts/prds/prd-patient_management_system-2026-06-18/review-rubric.md
workflowType: 'architecture'
project_name: 'patient_management_system'
user_name: 'Player_kt'
date: '2026-06-18'
lastStep: 8
status: 'complete'
completedAt: '2026-06-19'
---

# Architecture Decision Document — 환자 관리 시스템 (Patient Management System)

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements (70 FRs / 18 그룹).**
PRD는 외래 한 줄기를 지시→수행→정산까지 끊김 없이 커버하며, FR이 내원 상태 흐름을 따라 묶여 있다. 아키텍처적으로 의미 있는 묶음:

- **신원·인증·등록 (FR-001~006, 210~215):** 분리 프로필(직원=`사용자`.id=auth uid / 환자=`환자`.auth_uid nullable), 로그인 시 uid 소속 테이블로 분기. DB 기반 RBAC(역할 N:M 권한, `리소스.동작` 코드), 관리자 페이지 체크박스 토글. → **인증·인가가 모든 화면의 전제(Phase 1).**
- **내원 파이프라인 (FR-020~032, §4):** 예약→접수→진행중→완료 + 취소/노쇼. 접수는 내원에 흡수. 대기열·순번·호출. → **내원 상태머신 엔진.**
- **임상 기록 (FR-040~042):** SOAP, 한 내원 1:N 진료기록, A(KCD 진단)↔P 연계. → **진료기록·진단 연결.**
- **오더 생명주기 (FR-050~052, 060~061, 070, 080~081, 090~103):** 처방(발행→발급), 검사·영상(지시→수행→판독→완료), 처치(지시→수행→완료). 지시자/수행자 FK 분리, 재수행 차단. → **오더 유형별 상태머신 + 워크리스트.**
- **정산 (FR-110~119, 200~203):** 수가 자동발생 → 수납(헤더+상세) → 표준 「진료비 계산서·영수증」·「세부산정내역서」. 마스터-디테일 + 수가/약품/진단 마스터. → **수가 자동발생 엔진 + 문서 생성(가장 어려운 도메인).**
- **예약·스케줄 (FR-010~016, 220~221):** 동적 가용 슬롯 계산(근무−예외−기예약), 더블부킹 차단, 노쇼 카운트, SMS 리마인더(시뮬). → **슬롯 계산 + 알림.**
- **환자 포털 (FR-120~122):** 본인 내역 조회(RLS 강제). → **모바일 읽기 경로.**
- **운영·보안 횡단 (FR-230, 240~243):** 대시보드, RLS, pgcrypto+Vault, 감사로그.

**Non-Functional Requirements (17 NFRs).**
- **플랫폼(확정):** 직원 데스크톱 웹(Chromium), 환자 Android APK, 백엔드 Supabase/PostgreSQL.
- **성능:** 일반 조회 ~2초 목표(데모 기준), 대기열·워크리스트 갱신 ≤5초(실시간 구독 또는 폴링) — *리뷰: 숫자/측정모수 보강 필요(D-1/D-2).*
- **보안·프라이버시:** TLS, Supabase Auth, 최소권한 RBAC, 개인정보 표준의 "형태"만 모사(공식 인증 범위 밖).
- **데이터 무결성:** 상태 전이 규칙 강제(역행·건너뛰기 방지), 트랜잭션 원자성(수납 등), 감사로그 append-only.
- **사용성:** 단계별 "다음 할 일" 명시, 역할 범위 내 완결, 전면 한국어 — *리뷰: 가관측 조건으로 환원 필요(D-3).*
- **확장성:** 내원 허브로 향후 입원 갈래 수용.

### Scale & Complexity

- **Primary domain:** Full-stack — 데스크톱 웹(직원) + Android 앱(환자) + Supabase(PostgreSQL/Auth/Storage/Realtime) 백엔드.
- **Complexity level:** Medium-High. 화면 수가 아니라 (a) 다중 상태머신 무결성, (b) 수가 자동발생 규칙 엔진, (c) 다층 보안(RLS+RBAC+pgcrypto+audit)에 난도 집중.
- **Estimated architectural components (~16 논리 컴포넌트):** 인증·세션·라우팅 분기 / RBAC 권한 평가 / RLS 정책 레이어 / 내원 상태머신 / 오더 생명주기 엔진 / 수가 자동발생 엔진 / 수납·표준문서 생성 / 마스터 데이터 관리 / 예약·슬롯 계산 / 실시간 대기열·워크리스트 / 감사로그 파이프라인 / 암호화(pgcrypto+Vault) / 영상 스토리지 / 알림(SMS 시뮬) / 직원 웹앱(6역할) / 환자 모바일앱.

### Technical Constraints & Dependencies

**확정 제약(PRD 명시):**
- Supabase(PostgreSQL) 백엔드·인증·스토리지 — NFR-012.
- 직원 데스크톱 웹(Chromium) / 환자 Android APK — NFR-010/011.
- pgcrypto 주민번호 암호화, 키는 Supabase Vault(코드·DB에 키 미보관) — FR-241.
- RLS 본인/역할별 강제 — FR-240. TLS, Supabase Auth — NFR-020/021.
- 전면 한국어 UI·표준 출력 문서 — NFR-052.

**시뮬레이션 처리(실연동 범위 밖):** SMS 리마인더, 본인인증(PASS), 결제(PG), 보험청구(EDI), 약국 처방 전송, 검사 외부 의뢰. → 실연동 대신 **연결 가능한 이음매(seam)**로 설계.

**아키텍처가 결판낼 미결 결정(다운스트림 이월분):**
1. 수가 자동발생 트리거 매트릭스(상태전이 이벤트 → 수가 규칙) — *소유: 아키텍처(치명).*
2. 내원·오더 상태 전이표 + 취소/노쇼/부분수행 정산 경로 — NFR-040의 "정의된 규칙" 실체화.
3. 비즈니스 로직 강제 위치 — DB(제약·트리거·RPC) vs 앱 vs Edge Function.
4. 마스터 유효기간(발효/만료) 컬럼 — FR-201이 스키마를 앞서감.
5. 감사로그 append-only 강제 메커니즘 — service_role 우회 차단 포함.
6. 선수납/후수납 정책 플래그, 환자 임상 프로필 입력/조회 경로.

### Cross-Cutting Concerns Identified

1. **인증·인가** — 분리 프로필 + DB RBAC + RLS의 3중 결합(권한 단일 진실 = DB).
2. **상태 무결성** — 내원·오더 전이 강제(역행/건너뛰기/재수행 차단)를 DB가 보증.
3. **수가 자동발생** — 임상 이벤트를 정산으로 잇는 규칙 엔진. 수납 도메인 전체가 의존.
4. **감사·추적성** — 전 작업 횡단 append-only 로그(변경 전/후 스냅샷).
5. **암호화·키 관리** — pgcrypto + Vault, 중복 탐지용 결정적 암호화 여부(FR-003 매칭).
6. **트랜잭션 원자성** — 수납 생성 등 다단계 작업.
7. **실시간성** — 대기열·워크리스트 갱신(Realtime vs 폴링).
8. **마스터 무결성** — soft delete + 유효기간 + 과거 기록 참조 보존.
9. **멀티플랫폼 코드·타입 공유** — 웹/모바일 공통 도메인 모델.
10. **한국어 표준 문서 생성** — 진료비 계산서·세부산정내역서 서식 준수.

## Starter Template Evaluation

### Primary Technology Domain

Full-stack, 폴리글랏 멀티서피스 — 관리형 데이터/인증(Supabase) + Python 애플리케이션 레이어(FastAPI) + React 웹(Next.js, 직원앱 + 환자 포털) + 얇은 네이티브 셸(Flutter 웹뷰, 환자 APK). 사용자 확정: 과제뿐 아니라 **실무 감각 습득**을 동기로 FastAPI·Flutter(웹뷰 셸) 유지.

### 스타터 철학 (왜 미니멀 공식 스캐폴드인가)

무거운 올인원 SaaS 스타터(구독·결제·다국어가 딸린 템플릿)는 이 과제의 평가 포인트(RBAC·RLS·26테이블 스키마·상태머신·수가 자동발생을 *내가 설계·구현*)를 대신 처리해버려 손해다. 따라서 각 서피스를 **공식 미니멀 스캐폴드로 시작하고 Supabase·도메인 로직을 직접 얹는다.** 참고용으로 연구할 만한 통합 템플릿: `Razikus/supabase-nextjs-template`(Next+Supabase+RLS, 채택은 아님).

### 확정 스택 & 역할 분담

| 레이어 | 기술 (현재 버전, 2026-06) | 역할 |
|---|---|---|
| 데이터/인증/스토리지 | **Supabase** (Postgres, Auth ES256/JWKS, Storage, Realtime) | 시스템 오브 레코드. **RLS + 수가 자동발생 트리거 + 상태 전이 제약 + 감사 트리거**를 DB가 강제(보안 테제 유지). 스키마 단일 소유. |
| 애플리케이션 | **FastAPI** + uv + `fastapi[standard]` (Python 3.13) | 복잡한 다단계 명령(수납 트랜잭션·진료비 문서 PDF·시뮬 연동 이음매 SMS/PG/EDI·관리자 작업) 오케스트레이션. Supabase JWT(JWKS) 검증 + RBAC 확인. |
| 직원 웹 + 환자 포털 | **Next.js 16** (React 19.2, TS, Tailwind 4) | 직원 6역할 화면(데스크톱) + 반응형 환자 포털. 명령은 FastAPI로, 실시간 구독(대기열·워크리스트)·단순 조회는 Supabase 직접(RLS 보호). |
| 환자 모바일 | **Flutter 3.44 + webview_flutter 4.x** | 환자 포털(반응형 웹)을 띄우는 얇은 네이티브 셸 → APK. Dart 표면적 최소. 추후 푸시·생체 본인인증(시뮬) 등 네이티브 확장 여지. |

> **RLS 태도(확정):** FastAPI는 `service_role`을 쓰되 RLS를 **방어심층으로 유지**하고, 본인 데이터 경계(환자=본인만)는 FastAPI가 JWT 주체로 강제 + DB RLS가 이중으로 막는다. 클라이언트 직접 읽기/Realtime 경로는 RLS가 1차 방어.

### 스키마·마이그레이션 소유권 (중요)

DDL·RLS·트리거·pgcrypto는 **Supabase CLI 마이그레이션**(`supabase/migrations/*.sql`)이 단일 소유한다. FastAPI는 DDL을 만들지 않으며 **Alembic을 쓰지 않는다**(스키마 이중 소유 방지). TS 타입은 `supabase gen types typescript`로 DB에서 생성해 웹이 소비한다(DB↔프론트 타입 자동 동기화).

### 버전관리 & 워크플로우 (사용자 확정)

- **모노레포 1개**를 GitHub 리포로 관리(아래 구조). 사용자 선호: **개발 중 단계별 커밋**.
- 첫 구현 스토리(init)에 `git init` + GitHub 원격 + 초기 커밋 포함.
- 이후 의미 있는 단위(스키마 마이그레이션 / 인증 코어 / 진료 코어 …)마다 커밋. 커밋·푸시는 승인 시 수행.
- CI(GitHub Actions로 마이그레이션·린트·타입체크)는 추후 DevOps 결정 단계에서 확정.

### 권장 리포 구조 (모노레포)

```
hospital-pms/                 # git 리포 (GitHub)
├── supabase/          # supabase init — migrations, seed, RLS, functions, pgcrypto
├── api/               # FastAPI (uv) — app/{main,dependencies,routers,services,internal}
├── web/               # Next.js 16 — 직원앱 + 환자 포털
├── mobile/            # Flutter 웹뷰 셸 (patient APK)
└── docs/              # 산출물(brief/prd/architecture)
```

### 초기화 명령 (현재 검증, 2026-06)

```bash
# 0) 리포
git init                              # 모노레포 루트, GitHub 원격 연결

# 1) 데이터 레이어 (heart) — Supabase 로컬 스택 + 마이그레이션
supabase init
supabase start                        # 로컬 Postgres/Auth/Storage (Docker)

# 2) 애플리케이션 — FastAPI (uv 권장)
uv init api && cd api
uv add "fastapi[standard]" "pyjwt[crypto]" supabase httpx
uv run fastapi dev app/main.py
cd ..

# 3) 직원 웹 + 환자 포털 — Next.js 16 (TS/Tailwind/App Router 기본)
npx create-next-app@latest web --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd web && npm i @supabase/supabase-js @supabase/ssr && cd ..

# 4) 환자 모바일 — Flutter 웹뷰 셸
flutter create mobile
cd mobile && flutter pub add webview_flutter && cd ..
```

### 각 스캐폴드가 제공하는 결정

- **Next.js 16:** App Router, TypeScript(기본), Tailwind CSS 4, ESLint, Turbopack 번들러, React Compiler, `@/*` alias, `src/` 구조.
- **FastAPI(uv):** pyproject.toml + uv.lock 재현성, `app/` 표준 구조(routers/dependencies/internal), `fastapi dev` 핫리로드, `fastapi[standard]`(uvicorn·pydantic·httpx 포함).
- **Flutter:** 표준 프로젝트 + `webview_flutter`(시스템 웹뷰 백엔드), Android API 24+ 타깃.
- **Supabase:** 로컬 개발 스택(Docker), `supabase/migrations` 버전관리, `gen types`로 TS 타입 생성, 신규 `publishable`/`secret` 키 체계(레거시 키 2026말 폐기).

**Note:** 위 초기화(git + 4개 스캐폴드)는 **첫 구현 스토리**로 잡는다(코드 작성 전 토대 고정).

## Core Architectural Decisions

### Decision Priority Analysis

**Critical (구현 차단 — 먼저 확정):** Postgres(Supabase) · 상태머신 DB 강제 · 수가 자동발생 메커니즘 · Supabase Auth(JWKS) · RBAC/RLS 전략 · 주민번호 암호화 · API 경로 분담 · 데이터 접근(하이브리드/무ORM) · 호스팅·노출.
**Important (구조 형성):** 이월 스키마 갭 해소 · 감사 append-only 강제 · 프론트 상태/UI 라이브러리 · 실시간 통합 · CI/CD · 마스터 시드.
**Deferred (Post-MVP):** rate limiting · APM/Sentry · 수평 확장 · CI 자동배포 게이트 · Supabase 셀프호스팅.

### Data Architecture

- **DB / 마이그레이션:** Postgres(Supabase 클라우드). DDL·RLS·트리거·pgcrypto는 **Supabase CLI 마이그레이션 단일 소유**(Alembic 미사용). 26테이블 베이스라인.
- **상태머신 = DB 강제:** 내원·오더 상태를 enum + **전이 검증 트리거/RPC + CHECK**로 강제(NFR-040). 전이 RPC 목록(예: `register_encounter`, `start_consult`, `complete_encounter`).
- **수가 자동발생 = DB 트리거 + 수가매핑 규칙(시드):** 임상 이벤트(진찰/오더 수행 완료/처방 발행)에 반응해 수납상세를 **원자적 적재**. 행위→수가코드는 **수가매핑 규칙 + 시드**로 외부화. FastAPI는 수납 finalize·진료비 문서 담당.
- **검증 전략 = 3계층:** DB 제약(진실 원천) + Pydantic(FastAPI 경계) + 생성 TS 타입(웹).
- **캐싱:** 데모 범위 최소(TanStack Query 클라 캐시 + Supabase 실시간). 별도 캐시 레이어 없음.
- **이월 스키마 갭 해소(아키텍처 소유):** ① 마스터 3종 발효/만료 컬럼(FR-201) ② 환자 임상 프로필(알레르기·복용약 등) 입력/조회 경로 ③ 알림로그(SMS 시뮬 발송이력) ④ 선/후수납 정책 플래그 ⑤ 오더 상태 어휘 통일(지시→수행→완료/판독) ⑥ 취소·노쇼·부분수행 정산 경로.

### Authentication & Security

- **인증:** Supabase Auth(ES256/**JWKS**). 분리 프로필 신원(직원=`사용자`.id=uid / 환자=`환자`.auth_uid). FastAPI는 JWKS로 `aud=authenticated` 검증.
- **주민번호:** pgcrypto 컬럼 암호화(키는 **Vault**, 암복호는 service_role 한정 SECURITY DEFINER RPC) + **HMAC blind index(`주민번호_hash`)**로 중복 매칭(FR-003). 화면 마스킹.
- **주민번호 유효성 규칙:** 형식 + 생년월일 + 성별/세기 자리(내국 1–4, **외국 5–8 허용**) = HARD; **체크섬 = SOFT(경고, 2020 개편 대비)**. FastAPI Pydantic 경계 + 클라 사전체크. (본인인증 시뮬과 별개)
- **RBAC 3계층:** UI 노출(UX) / FastAPI 명령 강제(쓰기 권위) / RLS 행 강제(데이터 권위). DB 헬퍼 `has_permission(code)`(SECURITY DEFINER).
- **RLS 전략:** 환자=소유 정책(`(select auth.uid()) = 환자.auth_uid`, 내원 경유), 직원=역할/권한 기반(SECURITY DEFINER 헬퍼로 조인 RLS 회피), `authenticated` 명시. service_role(FastAPI) 우회.
- **감사 append-only:** 감사로그 테이블 UPDATE/DELETE를 **모든 역할(service_role 포함) REVOKE**, INSERT만; 트리거는 SECURITY DEFINER(owner=postgres).
- **세션·API 보안:** `@supabase/ssr` 쿠키 세션 → FastAPI에 `Bearer` 첨부. CORS 화이트리스트(`https://kuntae802.mooo.com`), TLS(리버스 프록시), rate limiting 데모 최소, 시크릿 서버 전용.

### API & Communication Patterns

- **경로 분담:** 쓰기/명령 → **FastAPI**; 단순 읽기 → **Supabase 직접(RLS)**, 복잡 집계·문서 → FastAPI; 실시간 → **Supabase 구독**.
- **REST 규약:** `/api/v1`, FastAPI 자동 OpenAPI, 상태 전이는 액션 엔드포인트(`POST /encounters/{id}/register`).
- **에러 표준:** `{ error: { code, message, detail } }` — 422(검증)/403(RBAC)/409(잘못된 전이)/404/500.
- **실시간:** `postgres_changes`(내원·오더), RLS 필터(진료과/진료실=대기열, 직역=워크리스트).
- **데이터 접근(하이브리드, 무ORM):** 불변식=DB(트리거·제약·RPC) / 오케스트레이션=FastAPI Python(서비스 계층) / 단순 조회=Supabase. asyncpg·SQLAlchemy Core + RPC, Storage·Auth-admin은 supabase-py. 타입은 Pydantic + 생성 TS 타입(ORM 스키마 모델 없음).

### Frontend Architecture

- **상태:** 서버=TanStack Query v5, UI=Zustand, 세션=Supabase 클라이언트.
- **UI·폼:** shadcn/ui(Tailwind 4, 컴포넌트 소유) + TanStack Table(데이터 그리드) + React Hook Form 7 + Zod 4(**Pydantic의 거울**). `Intl` ko-KR(날짜·통화 원).
- **구조·라우팅:** App Router route group — `(staff)` 역할별 레이아웃 + 미들웨어 가드, `(patient)` 반응형 포털(같은 Next 앱, Flutter 웹뷰가 로드).
- **실시간 통합:** `postgres_changes` 구독 → TanStack Query 캐시 무효화/패치(`useQueueRealtime` 등).
- **"다음 할 일" 가이드 = 1급 패턴:** 공용 AppShell + 내원 상태별 next-action 어포던스(가능한 다음 작업만 제시, NFR-050).
- **성능·i18n:** Next 16 기본(Turbopack·React Compiler·코드분할), 역할 화면은 클라이언트 컴포넌트, 한국어 단일 + `Intl`(i18n 프레임워크 없음).

### Infrastructure & Deployment

- **호스팅:** **홈 서버(Docker Compose: `web` Next.js + `api` FastAPI)** + **Supabase 클라우드 관리형**(앱이 연동). 환자 APK = `flutter build apk`, 웹뷰는 공개 도메인 로드.
- **노출·TLS·경로:** **리버스 프록시**(기존 방식) + Let's Encrypt. 도메인 **`kuntae802.mooo.com`**, 웹 서브패스 **`/patient_management_system`**.
  - **Next.js `basePath=/patient_management_system`**, **FastAPI `root_path=/patient_management_system/api`**(프록시 뒤), **Supabase Auth redirect URL**·**CORS**·**Flutter 웹뷰 base URL** 모두 이 경로 반영.
- **환경:** 개발=Supabase 로컬(Docker), 데모=클라우드 링크. **publishable/secret 키**, `.env` 서피스별, 시크릿 커밋 금지(웹엔 `NEXT_PUBLIC_` publishable만).
- **CI/CD:** GitHub Actions(self-hosted runner on 홈서버 또는 push→`git pull && docker compose up -d`) + lint·타입체크·마이그레이션 체크.
- **로깅·스케일:** FastAPI 구조적 로깅 + 플랫폼 로그 + 도메인 감사로그(Sentry 옵션). **Stateless FastAPI**(JWT) → 단일 인스턴스 데모, 확장 여지.
- **마이그레이션·시드:** Supabase CLI 단일 소유, `seed.sql`로 마스터 시드(EDI 수가·약품·KCD·진료과·진료실).
- **스토리지:** 영상자료 = Supabase Storage 버킷 + 서명 URL + RLS, DB엔 경로만.

### Decision Impact Analysis

**구현 순서(브레인스토밍 Phase와 정렬):**
0. **Init** — git + 4 스캐폴드(supabase/api/web/mobile), basePath/root_path/프록시 설정.
1. **인증 코어** — 사용자·역할·권한·역할_권한, RLS 헬퍼, 감사 트리거, 분리 프로필; FastAPI 인증·RBAC; Next 인증 셸.
2. **진료 코어** — 내원 상태머신 + 전이 RPC, SOAP 진료기록, 진단(KCD).
3. **처방·검사** — 오더 생명주기, 검사·장비, **수가 트리거 가동 시작**.
4. **예약·간호** — 동적 슬롯 계산, 활력징후·처치오더/기록, 환자 포털.
5. **원무 마무리** — 수납·수가매핑·표준 진료비 문서(PDF), 대시보드·감사 조회.

**교차 의존성:**
- 상태머신(DB) ← 전이 RPC(FastAPI) ← next-action(프론트).
- 수가 트리거(DB) ← 수가매핑 시드; 수납 finalize(FastAPI) → 진료비 문서.
- RBAC(역할_권한 DB) → RLS 헬퍼 + FastAPI 권한 의존성 + UI 게이팅.
- 생성 TS 타입 ↔ 웹; Zod ↔ Pydantic 거울.
- 서브패스(basePath/root_path) → 전 서피스 + Supabase redirect + APK base URL.

## Implementation Patterns & Consistency Rules

### 식별자 언어 (Identifier Language)
- **DB·API·코드 식별자 = 영어 snake_case/표준 케이싱.** 한국어는 UI 라벨·주석·문서·enum 표시명에만.
- **영문↔한글 용어집**을 단일 진실로 유지(예: encounter=내원, order=오더, fee_item=수가항목, prescription=처방전). 신규 식별자는 이 표에 등재 후 사용. (PRD 용어집 확장)

### Naming Patterns

**Database (Postgres):**
- 테이블 = 복수 snake_case(`patients`, `encounters`, `encounter_diagnoses`). 컬럼 snake_case.
- PK `id` UUID(`gen_random_uuid()`). FK `<참조단수>_id`(`patient_id`). 사람용 번호는 별도(`chart_no`, `encounter_no`).
- 타임스탬프 `created_at`/`updated_at`(timestamptz, UTC 저장). soft delete `is_active`.
- enum = Postgres enum 타입 `<entity>_status`(값은 영어: `scheduled|registered|in_progress|completed|cancelled|no_show`).
- 인덱스 `idx_<table>_<cols>`, RPC `snake_case` 동사(`register_encounter`), 트리거 `trg_<table>_<action>`, 헬퍼 `has_permission()`.

**API (FastAPI REST):**
- 복수 리소스 `/api/v1/encounters`, 경로 파라미터 `{id}`, 쿼리 snake_case.
- **JSON 필드 = snake_case**(중요: Supabase 직접 조회도 snake_case라, 두 읽기 경로의 일관성). 상태 전이는 액션 엔드포인트 `POST /encounters/{id}/register`.

**Code:**
- Python: 함수·변수·모듈 snake_case, 클래스 PascalCase(Pydantic `EncounterCreate`), 상수 UPPER_SNAKE.
- TypeScript: 변수·함수 camelCase, 컴포넌트·타입 PascalCase, 훅 `useX`, 파일 kebab-case(shadcn 관습).
- Dart(셸): lowerCamelCase, 파일 snake_case.

### Structure Patterns
- **모노레포**: `supabase/` `api/` `web/` `mobile/` `docs/`.
- `api/app/`: `core/`(config·security·db), `api/v1/`(routers), `schemas/`(pydantic), `services/`(도메인), `db/`(쿼리·rpc 호출). 테스트 `api/tests/`.
- `web/src/`: `app/(staff|patient)/`, `components/ui/`(shadcn), `components/<feature>/`, `lib/`, `hooks/`, `types/database.types.ts`(생성). 테스트 co-located `*.test.tsx`.
- `supabase/`: `migrations/`, `functions/`, `seed.sql`.
- 컴포넌트는 **기능(feature) 단위** + 공용 `ui/`.

### Format Patterns
- **성공 응답 = 리소스/배열 직접**. 페이지네이션 목록 = `{ data: [...], meta: { page, page_size, total } }`.
- **에러 = `{ error: { code, message, detail } }`** + HTTP 상태(422/403/409/404/500). `code`는 기계용, `message`는 한국어.
- 날짜 = ISO 8601(timestamptz, UTC 저장 → KST 표시는 `Intl`). 금액 = KRW 정수(원, 소수 없음). 불리언 true/false. null 명시.

### Communication Patterns
- **실시간**: Supabase `postgres_changes`(테이블 단위) 우선. 파생 broadcast 이벤트는 `domain.action`(`encounter.registered`).
- **상태(웹)**: TanStack Query 키 = 배열(`['encounters', id]`, `['worklist', role]`), 불변 업데이트, 뮤테이션·실시간 시 무효화. UI 전역상태는 Zustand 슬라이스.
- **로깅**: 구조적 JSON(level + request_id). **PII 절대 미기록**(주민번호 등 마스킹). 도메인 감사로그는 별개.

### Process Patterns
- **에러 처리**: FastAPI 예외 핸들러가 도메인 예외 → 봉투+상태 매핑. 웹은 Error Boundary + TanStack Query 에러 상태 + 한국어 토스트. 내부정보/PII 노출 금지.
- **로딩**: TanStack Query `isPending` + 스켈레톤. **뮤테이션 중 버튼 비활성**(이중 제출 방지 → 처치 중복방지 FR-093의 UX 1차선). 안전한 곳만 낙관적 업데이트.
- **인증 흐름**: Supabase 세션(쿠키) → 미들웨어 가드 → `Bearer` → JWKS 검증. 갱신은 `@supabase/ssr`.
- **검증 타이밍**: 클라 Zod(즉시 UX) → 서버 Pydantic(권위) → DB 제약(최종선). 3중.

### Enforcement Guidelines
**모든 구현은 MUST:**
- 영문 식별자 + 용어집 등재 / JSON·DB는 snake_case / 에러 봉투 통일 / PII 미로깅·마스킹 / 검증 3중 / 시크릿 서버 전용.
- 도구: **Ruff**(Python), **ESLint+Prettier**(TS), Dart analyzer. **생성 TS 타입 = 계약**. 본 섹션 + `project-context.md`가 에이전트 규칙. CI가 게이트.

**Anti-patterns(금지):**
- DB/JSON에 camelCase 혼용 · 한국어 식별자 즉흥 도입 · 응답마다 제각각 래퍼 · raw 주민번호 로깅 · 클라만 검증 · service_role 키 클라 노출.

## Project Structure & Boundaries

### Complete Project Directory Structure

```
hospital-pms/                         # git 리포(GitHub), 모노레포 루트
├── README.md
├── docker-compose.yml                # 홈서버 배포: web + api (리버스 프록시가 앞단)
├── .gitignore  /  .env.example
├── .github/workflows/ci.yml          # lint·typecheck·migration check (self-hosted runner)
│
├── docs/                             # 기획 산출물
│   ├── brief.md  prd.md  architecture.md
│   ├── glossary.md                   # 영문 식별자 ↔ 한글 용어 (단일 진실)
│   └── project-context.md            # AI 에이전트 규칙(패턴 요약) — step-08 산출
│
├── supabase/                         # 데이터 레이어 (스키마 단일 소유)
│   ├── config.toml
│   ├── migrations/                   # 순번 SQL: DDL·RLS·트리거·함수·pgcrypto
│   │   ├── 0001_extensions.sql       # pgcrypto, gen_random_uuid, (vault)
│   │   ├── 0002_identity_rbac.sql    # users, roles, permissions, role_permissions
│   │   ├── 0003_rls_helpers.sql      # auth_user_role(), has_permission() [SECURITY DEFINER]
│   │   ├── 0004_audit.sql            # audit_logs + 트리거 + append-only GRANT 회수
│   │   ├── 0005_masters.sql          # departments, rooms, drugs, diagnoses(KCD), fee_schedules(+effective/expiry)
│   │   ├── 0006_patients.sql         # patients(+임상프로필, resident_no_enc/_hash), guardians
│   │   ├── 0007_encounters.sql       # encounters(status enum+CHECK) + 전이 RPC
│   │   ├── 0008_clinical.sql         # medical_records(SOAP), encounter_diagnoses
│   │   ├── 0009_orders.sql           # prescriptions(+details), examinations, equipment, treatment_orders
│   │   ├── 0010_nursing.sql          # nursing_records, vital_signs
│   │   ├── 0011_scheduling.sql       # appointments, doctor_schedules, doctor_time_offs
│   │   ├── 0012_billing.sql          # payments(+details), fee_mappings + 수가 자동발생 트리거
│   │   ├── 0013_notifications.sql    # notification_logs (SMS 시뮬)
│   │   └── 0014_rls_policies.sql     # 테이블별 RLS 정책
│   ├── functions/                    # Edge Functions(필요 시; 대부분 FastAPI가 담당)
│   ├── seed.sql                      # 마스터 시드(EDI 수가·약품·KCD·진료과·진료실) + 샘플
│   └── storage.sql                   # 영상자료 버킷 + 정책
│
├── api/                              # FastAPI (uv) — 오케스트레이션
│   ├── pyproject.toml  uv.lock  Dockerfile  .env.example
│   ├── app/
│   │   ├── main.py                   # FastAPI(root_path=/patient_management_system/api)
│   │   ├── core/
│   │   │   ├── config.py  security.py(JWKS·권한 의존성)  db.py(asyncpg pool)
│   │   │   ├── supabase.py(Storage·Auth admin)  errors.py(예외→봉투)  logging.py(PII 마스킹)
│   │   ├── api/v1/
│   │   │   ├── router.py
│   │   │   ├── patients.py  encounters.py  orders.py  nursing.py
│   │   │   ├── billing.py  scheduling.py  masters.py  admin.py  dashboard.py
│   │   ├── schemas/                  # Pydantic(요청·응답, snake_case)
│   │   ├── services/                 # 도메인: billing_service, document_service(진료비 PDF),
│   │   │                             #         rrn(주민번호 검증·HMAC), notification_service(SMS 시뮬),
│   │   │                             #         encounter_service(전이 RPC 래핑)
│   │   ├── db/                       # 명시적 쿼리·RPC 호출
│   │   └── internal/                 # 시드·관리 보조
│   └── tests/                        # pytest (unit·integration)
│
├── web/                              # Next.js 16 (직원앱 + 환자 포털)
│   ├── package.json  next.config.ts(basePath)  tsconfig.json  Dockerfile  .env.example
│   ├── src/
│   │   ├── middleware.ts             # 세션·역할 가드(staff/patient 분기)
│   │   ├── app/
│   │   │   ├── layout.tsx  globals.css
│   │   │   ├── (auth)/login/         # 분리 프로필 로그인 분기
│   │   │   ├── (staff)/
│   │   │   │   ├── layout.tsx        # AppShell + 역할 내비 + next-action
│   │   │   │   ├── reception/        # 접수·대기·수납 (FR-020~023, 110~119)
│   │   │   │   ├── doctor/           # 진료·SOAP·오더·판독 (FR-030~061, 102)
│   │   │   │   ├── nurse/            # 활력·처치 워크리스트 (FR-090~094)
│   │   │   │   ├── radiology/        # 촬영 워크리스트 (FR-100~103)
│   │   │   │   └── admin/            # RBAC·마스터·스케줄·대시보드·감사 (FR-200~243)
│   │   │   └── (patient)/            # 반응형 포털(Flutter 웹뷰가 로드)
│   │   │       ├── booking/          # 예약 (FR-010)
│   │   │       └── records/          # 내역·처방·영수증 (FR-120~122)
│   │   ├── components/ui/(shadcn)  components/encounter/(next-action)  components/<feature>/
│   │   ├── hooks/                    # useQueueRealtime, useWorklistRealtime, usePermissions
│   │   ├── lib/                      # supabase client, api client(fetch+Bearer), queryKeys, formatters(Intl)
│   │   └── types/database.types.ts   # supabase gen types (계약)
│   └── tests/                        # co-located *.test.tsx + e2e
│
└── mobile/                           # Flutter 웹뷰 셸 (환자 APK)
    ├── pubspec.yaml                  # webview_flutter
    ├── lib/ main.dart  webview_screen.dart  config.dart(base URL)
    └── android/                      # API 24+, 인터넷 권한, 아이콘
```

### Architectural Boundaries

- **API 경계:** 외부=웹/모바일 → `/patient_management_system/api/v1/*`(쓰기·복잡조회). 별도 외부 노출 없음. 내부=FastAPI services → DB(RPC/쿼리). Auth 경계=JWKS 검증 의존성(`core/security`). Storage 경계=supabase-py 서명 URL.
- **컴포넌트 경계(웹):** route group `(staff)`·`(patient)`이 청중 경계. AppShell이 역할 내비·next-action 호스트. 서버상태(TanStack Query) ↔ UI상태(Zustand) 분리. 실시간은 훅으로 격리.
- **서비스 경계(api):** `api/v1`(전송) → `services`(도메인 오케스트레이션) → `db`(영속). 불변식은 DB(트리거/RPC)가 소유, 서비스는 호출·조립.
- **데이터 경계:** 스키마=Supabase migrations 단일 소유. 쓰기=FastAPI(service_role) + DB 강제. 읽기=웹이 RLS로 직접 or FastAPI. 캐시 경계=클라(TanStack Query)뿐.

### Requirements → Structure Mapping

| FR 그룹 | DB | API | Web |
|---|---|---|---|
| 신원·RBAC (001~006, 210~215) | 0002/0003/0006 | `admin.py`,`patients.py`,`core/security` | `(auth)`,`(staff)/admin`,`middleware` |
| 예약·스케줄 (010~016, 220~221) | 0011 | `scheduling.py` | `(patient)/booking`,`(staff)/admin` |
| 접수·대기 (020~023) | 0007 | `encounters.py` | `(staff)/reception` |
| 진찰·SOAP·진단 (030~042) | 0007/0008 | `encounters.py` | `(staff)/doctor` |
| 오더·간호·방사선 (050~103) | 0009/0010 | `orders.py`,`nursing.py` | `doctor`,`nurse`,`radiology` |
| 수납·문서 (110~119) | 0012 | `billing.py`,`services/document` | `(staff)/reception` |
| 환자 포털 (120~122) | (읽기) | reads / Supabase 직접 | `(patient)/records` |
| 마스터·통계 (200~203, 230) | 0005 | `masters.py`,`dashboard.py` | `(staff)/admin` |
| 보안 (240~243) | 0003/0004/0014/0006 | 횡단(security·logging·errors) | 횡단(가드·마스킹) |

### Integration Points & Data Flow

- **내부 통신:** 웹 → FastAPI(`Bearer`, 명령) · 웹 → Supabase(publishable, 조회·실시간) · FastAPI → Postgres(service, 트랜잭션/RPC) + supabase-py(Storage·Auth admin) · Flutter → 웹(https 웹뷰).
- **외부 연동(시뮬 이음매):** SMS(`notification_service`+`notification_logs`), 본인인증(인증 흐름 시뮬), 결제(기록만), EDI/약국 전송(범위 밖, 자리만).
- **데이터 흐름(골든 패스):** 환자 예약(웹/Supabase) → 원무 접수(웹→FastAPI→`register_encounter` RPC→DB) → 대기열 실시간(Supabase→웹) → 의사 SOAP·오더(웹→FastAPI→DB, **수가 트리거**) → 간호·방사선 수행(워크리스트 실시간) → 원무 수납 finalize(FastAPI→진료비 PDF) → 전 과정 **감사 트리거** 기록.

### File Organization Patterns

- **설정:** 서피스별 `.env`(+루트 `.env.example`), 시크릿 비커밋. `next.config.ts`(basePath), `main.py`(root_path), `docker-compose.yml`(배포).
- **소스:** 기능 단위 + 공용(`ui/`, `core/`). DB 로직은 `supabase/migrations`에 집중(앱은 호출).
- **테스트:** Python `api/tests/`(pytest), 웹 co-located `*.test.tsx` + `e2e/`.
- **자산:** 영상=Supabase Storage(경로만 DB), 정적=각 앱 `public/`.

### Development Workflow Integration

- **개발:** `supabase start`(로컬 DB) + `uv run fastapi dev`(api) + `npm run dev`(web). 모바일은 웹뷰 URL만 가리킴.
- **빌드:** web `next build`(standalone) → Docker, api Docker(uv), mobile `flutter build apk`.
- **배포:** 홈서버 `docker compose up -d`(web+api) ← 리버스 프록시(`/patient_management_system`), Supabase는 클라우드 링크.

## Architecture Validation Results

### Coherence Validation ✅

- **기술 호환성:** Supabase(Postgres) + FastAPI(asyncpg·supabase-py·PyJWT/JWKS) + Next 16/React 19/Tailwind 4/shadcn/TanStack/Zod·RHF + Flutter 웹뷰 — 전부 2026-06 현재 버전으로 상호 호환 검증.
- **패턴 일관성:** snake_case JSON이 DB·Supabase·FastAPI 전 경로에서 통일(두 읽기 경로의 정합 근거). 영문 식별자+용어집, 에러 봉투, RLS+RBAC+audit 일관.
- **구조 정합:** 모노레포가 결정을 지지 — `supabase/`가 스키마 단일 소유, 마이그레이션 순번이 Phase와 정렬, 경계 명확. 모순 없음(하이브리드 데이터 접근·이중 읽기 경로는 의도된 관리 복잡도로 문서화됨).

### Requirements Coverage Validation ✅

- **FR 커버리지:** 70 FR 18그룹 모두 구조에 매핑(§Requirements→Structure). 적대적 리뷰·정합성 갭이 아키텍처 결정으로 해소됨:
  - **DEC-1(수가 자동발생)** → DB 트리거 + 수가매핑 규칙(*메커니즘* 확정. 시드 *내용*은 다운스트림).
  - **L-1/L-2(상태·정산 경로)** → 상태머신 DB 강제 + 취소/노쇼/부분수행 정산 경로(스키마 갭 ⑥) + 오더 상태 어휘 통일(⑤).
  - **S-1(환자 임상 프로필)** → 스키마 갭 ② 입력/조회 경로.
  - **D-4(감사 append-only)** → GRANT 회수 + SECURITY DEFINER 트리거.
  - **L-5(주민번호 매칭)** → HMAC blind index. **CONFLICT-2(마스터 유효기간)** → 갭 ①. **CONFLICT-3(SMS 로그)** → 갭 ③.
- **NFR 커버리지:** 플랫폼·보안·무결성·확장성 강하게 충족. **성능(NFR-001/002)·사용성(050/051)**은 데모 목표치 수준으로 *주소화*되며, 측정 가능한 임계·프로토콜은 다운스트림(적대적 D-1~D-3은 PRD/스토리 소유).

### Implementation Readiness Validation ✅

- **결정 완전성:** Critical 결정 전부 버전과 함께 문서화. 패턴·일관성 규칙 enforceable(Ruff/ESLint/생성 타입/project-context).
- **구조 완전성:** 구체적 트리(마이그레이션 0001~0014, api/web/mobile 파일)·경계·통합점 명시.
- **패턴 완전성:** 명명·구조·포맷·통신·프로세스 + anti-pattern까지.

### Gap Analysis Results

- **Critical(구현 차단):** 없음 — 어려운 메커니즘(수가/상태/보안)은 전부 결정됨.
- **Important(다운스트림 소유, 명시 추적):**
  1. **수가 매핑 시드 내용**(행위·진단 → EDI 수가/약가 코드) — *메커니즘 확정, 내용 미작성*. 소유: 시드/원무 에픽 착수 전.
  2. **한국 청구 단순화 선**(초진/재진·가산·정액제 등 어디까지) — 적대적 R-1. 소유: 수납 에픽.
  3. **상태 전이표 full matrix**(전이 가능 쌍·취소 가능 시점) — DB 강제로 결정, 행렬은 `0007` 작성 시.
  4. **테이블별 RLS 정책 세부** — 전략 확정, `0014` 작성 시.
- **Nice-to-have:** CI 강화·Sentry·rate limiting·골든패스 E2E 하니스(전부 Post-MVP).

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed (데모 목표치 수준, 측정 프로토콜은 다운스트림)

**Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION (16/16 체크, Critical 갭 없음. Important 갭은 다운스트림 소유로 명시 추적).
**Confidence Level:** High.

**Key Strengths:**
- 불변식(상태머신·수가·감사·RLS)을 **DB가 강제** → 보안·무결성 테제가 견고.
- 적대적 리뷰의 critical/high 항목을 아키텍처 차원에서 선제 해소.
- 도구 시대형 데이터 레이어(무ORM·생성 타입·스키마 단일 소유).
- 멀티서피스 경로 분담이 명확(쓰기=FastAPI / 조회=Supabase / 실시간=구독).

**Areas for Future Enhancement:**
- 수가 매핑 시드 + 청구 단순화 선 작성 / 측정 가능 NFR 목표·프로토콜 / 골든패스 E2E / CI 강화·관측성.

### Implementation Handoff

**AI Agent Guidelines:** 본 문서의 결정·패턴·구조·경계를 정확히 준수. 모든 아키텍처 질문은 이 문서를 기준으로. 식별자는 영문+용어집, JSON/DB는 snake_case, 검증 3중, PII 마스킹.

**First Implementation Priority:** **Init 스토리** — `git init` + GitHub 원격 + 4 스캐폴드(supabase/api/web/mobile) + basePath/root_path/리버스 프록시 설정. → 이후 Phase 1 인증 코어.
