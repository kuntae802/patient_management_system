---
baseline_commit: dba27b066d61d98bc7ae480293b58b3abe15c0a5
---

# Story 1.4: 분리 프로필 로그인 (Supabase Auth)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **직원 또는 환자**,
I want **내 계정으로 로그인하면 시스템이 직원/환자를 자동 분기해 주기를**,
so that **각자 올바른 서피스로 진입한다.**

이 스토리는 **Epic 1 "인증 코어"의 프론트엔드 진입점**이다. 1.3이 만든 `users` 테이블·`auth_user_role()` 위에 Supabase Auth 로그인을 얹고, `@supabase/ssr` 쿠키 세션을 수립한 뒤 uid 소속(직원=`users` / 비직원=환자)으로 `(staff)`·`(patient)` route group으로 분기한다. 1.5(FastAPI JWKS·권한)·1.6(미들웨어 RBAC 가드·UI 게이트)이 이 위에 올라간다.

[Source: epics.md#Story-1.4 L407-427; architecture.md#Phase1 L223]

---

## Acceptance Criteria

> 출처: epics.md L415-427 (BDD 원문). FR-212 충족.

**AC1 — 로그인 + 세션 + 분기 (FR-212)**
**Given** 로그인 화면에서
**When** 자격 증명으로 Supabase Auth 로그인하면
**Then** `@supabase/ssr` 쿠키 세션이 수립되고, uid 소속(`users` 보유 = 직원 / 미보유 = 환자)으로 분기된다.

**AC2 — 영역 라우팅**
**Given** 직원으로 분기된 경우
**When** 로그인 직후 라우팅되면
**Then** `(staff)` 영역으로, 환자는 `(patient)` 영역으로 이동한다.

**AC3 — 오류 처리(한국어·무PII)**
**Given** 잘못된 자격 증명일 때
**When** 로그인 시도하면
**Then** 한국어 오류 메시지가 표시되고, 오류 envelope/로그에 PII(이메일·토큰 등)가 노출되지 않는다.

**AC4 — 서브패스 정합**
**And** 단축키·시각·서브패스(`basePath`)가 Supabase Auth redirect URL에 정확히 반영된다.

### 추가 검증(완료 정의)

- **AC5(세션 지속):** 로그인 후 새로고침·라우트 이동에도 세션이 유지된다(`@supabase/ssr` 미들웨어 세션 갱신). 로그아웃 시 세션이 제거되고 `/login`으로 돌아간다.
- **AC6(가드):** 미인증 사용자가 `(staff)`/`(patient)` 보호 경로 접근 시 `/login`으로 리다이렉트되고, 인증 사용자가 `/login`·`/` 접근 시 자기 영역으로 리다이렉트된다.
- **AC7(테스트 가능):** 로컬 부트스트랩 테스트 직원 계정으로 로그인→`(staff)` 진입 전 흐름이 실증된다(§결정 D-3). 분기 판정·폼 검증·오류 매핑은 단위 테스트로 커버.
- **AC8(품질 게이트):** `npm run lint`·`tsc --noEmit`·`npm run build` 통과. 생성 TS 타입(`database.types.ts`)을 손으로 만들지 않음.

---

## Tasks / Subtasks

> 커밋·푸시는 **승인 시에만**. JSON 필드·DB 식별자는 **snake_case**(TS에서 camelCase 변환 금지). 모든 화면 라벨 한국어.

- [x] **Task 1 — Supabase 클라이언트 헬퍼 (`@supabase/ssr`)**
  - [x] `web/src/lib/supabase/client.ts` — 브라우저 클라이언트(`createBrowserClient`, `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`).
  - [x] `web/src/lib/supabase/server.ts` — 서버 클라이언트(`createServerClient` + Next 16 `cookies()` 어댑터). RSC/route handler/미들웨어에서 사용.
  - [x] ⚠️ `@supabase/ssr ^0.12`·`@supabase/supabase-js ^2.108` **이미 설치됨** — 추가 설치 금지. publishable 키만 클라(`NEXT_PUBLIC_`), secret 키는 클라 노출 금지. [§기술]

- [x] **Task 2 — 미들웨어: 세션 갱신 + 인증 가드 (AC5·AC6)**
  - [x] `web/src/middleware.ts` — `@supabase/ssr` 표준 `updateSession` 패턴으로 매 요청 쿠키 세션 갱신.
  - [x] 가드: 미인증 + 보호경로(`(staff)`/`(patient)`) → `/login` 리다이렉트. 인증 + `/login`·`/` → 분기 후 자기 영역. **basePath 반영**(리다이렉트 경로에 `/patient_management_system` 전파 — Next가 basePath 자동 적용하나 절대경로 직접 작성 시 주의).
  - [x] `matcher`로 정적자산·`_next` 제외. **역할별(RBAC) 세부 라우트 가드는 Story 1.6 소유** — 여기선 인증 여부만. [§결정 D-2]

- [x] **Task 3 — 로그인 페이지 `(auth)/login` (AC1·AC3)**
  - [x] `web/src/app/(auth)/login/page.tsx` — 이메일·비밀번호 폼(시맨틱 `<form>`/`<input>`/`<button>`). React Hook Form 7 + Zod 4 검증(이메일 형식·필수). `supabase.auth.signInWithPassword`.
  - [x] 오류: 한국어 범용 메시지("이메일 또는 비밀번호가 올바르지 않습니다") — **원문 Supabase 오류·이메일·토큰을 토스트/로그/DOM에 노출 금지**(AC3, PII 경계). 검증 오류는 인라인 + `aria-invalid`/`aria-describedby`, 첫 오류 필드 포커스.
  - [x] 제출 중 버튼 `disabled`(이중 제출 방지). 로딩=스켈레톤/비활성(스피너 금지). 디자인 토큰(teal primary·Pretendard·`:focus-visible` ring) — 1.2 시스템 상속. [§UX]
  - [x] 성공 → Task 4 분기 호출 → 라우팅.

- [x] **Task 4 — 분리 프로필 분기 로직 (AC1·AC2)**
  - [x] `web/src/lib/auth/branch.ts` — 로그인 후 `supabase.rpc('auth_user_role')` 호출. **non-null = 직원**(반환 role code로 추후 랜딩 결정) → `(staff)`; **null = 비직원(환자)** → `(patient)`. [§결정 D-1]
  - [x] 서버 경로(미들웨어/RSC)는 `server.ts` 클라이언트로 동일 RPC 평가. 클라/서버 분기 결과 일관.
  - [x] ⚠️ `auth_user_role()`는 `employment_status='active'`만 직원 인정(1.3 리뷰 패치) — 휴직·퇴사자는 환자 영역으로 분기됨(의도된 동작, 주석 명시).

- [x] **Task 5 — Route group 골격 + 데모 정리 (AC2·AC6)**
  - [x] `web/src/app/(staff)/layout.tsx` — **AppShell**(1.2)을 여기서 렌더(직원 셸). `(staff)/page.tsx` — 최소 랜딩("환영합니다 · {역할}") placeholder. 역할별 서브라우트(reception/doctor/…)는 Epic 4+ 소유.
  - [x] `web/src/app/(patient)/page.tsx` — 최소 환자 포털 placeholder(본 포털은 Epic 8, 환자 레코드는 Epic 3). [§결정 D-1]
  - [x] `web/src/app/page.tsx`(현재 1.2 디자인 데모) — `/`는 분기/`/login` 리다이렉트로 전환. 데모는 제거 또는 `(staff)` 개발용 라우트로 이동(시각 검증 보존하되 `/` 점유 해제). [§결정 D-6]
  - [x] 로그아웃 액션(탑바 아바타 슬롯 연결 or 임시) → `supabase.auth.signOut()` → `/login`.

- [x] **Task 6 — Supabase Auth 하드닝 (deferred from 1.1, AC4)**
  - [x] `supabase/config.toml [auth]`: `minimum_password_length` 6→**8**, `password_requirements`→`lower_upper_letters_digits`. `enable_signup` **false**(직원=1.8 관리자 생성, 환자 셀프가입=Story 3.4가 재활성) — [§결정 D-5]. `additional_redirect_urls`·`site_url`은 이미 basePath 반영(검증만).
  - [x] 클라우드 대시보드 동기화는 문서 주석(로컬 config.toml이 1차). `.env.example` web/api 키 주석 점검. [deferred-work.md 1.1→1.4]

- [x] **Task 7 — 로컬 부트스트랩 테스트 직원 계정 (AC7)**
  - [x] 1.3은 사용자를 시드하지 않음(auth 사용자 부재) → 로그인 실증 불가. **dev 전용 부트스트랩** 작성: 로컬 `auth.users`에 테스트 직원 1명 + `public.users` 프로필(role=admin) 생성하는 스크립트 또는 `supabase/seed.sql`의 **dev 가드 블록**(프로덕션 시드와 분리, 명확히 dev-only 표기). [§결정 D-3]
  - [x] 실제 직원 계정 생성 UI는 **Story 1.8** 소유 — 여기선 테스트용 1계정만. 자격증명은 `.env.example`/README dev 노트에 문서화(시크릿 커밋 금지).

- [x] **Task 8 — web 테스트 인프라 + 단위 테스트 (AC7·AC8)**
  - [x] Vitest + React Testing Library 최소 설정(첫 web 테스트 — `vitest.config.ts`, `package.json` `test` 스크립트, jsdom). [§테스트]
  - [x] 단위 테스트(co-located `*.test.tsx`/`*.test.ts`): ① 분기 util(role non-null→staff, null→patient), ② 로그인 Zod 스키마(이메일·필수), ③ 오류 메시지 매핑(원문→한국어 범용, PII 비노출). **전체 로그인 E2E(브라우저)는 수동 + Post-MVP Playwright**(project-context: 골든패스 E2E=Post-MVP).

- [x] **Task 9 — 검증 + 문서 (AC8)**
  - [x] `npm run lint`·`tsc --noEmit`·`npm run build` 통과. Task 7 부트스트랩으로 수동 로그인→`(staff)` 진입 확인.
  - [x] 신규 식별자 없음 예상(route group은 코드 구조). 새 식별자 발생 시 `docs/glossary.md` 등재.

- [x] **Task 10 — 커밋 제안(승인 대기)**
  - [x] 의미 단위 커밋 초안(예: `feat(web): Supabase 클라이언트·미들웨어 세션`, `feat(web): 분리 프로필 로그인·분기·route group`, `chore(supabase): auth 정책 하드닝`). **푸시는 승인 후.**

### Review Findings

_코드 리뷰 2026-06-20 — 3레이어(Blind Hunter · Edge Case Hunter · Acceptance Auditor). **Acceptance Auditor: AC1~8 · D-1~6 전부 구현 확인**(Critical/High 위반 0). 아래는 헌터가 발견한 resilience·edge·정책 결함._

**Decision-needed**

- [x] [Review][Decision] 비-직원 직접 내비 스톱갭 가드 추가? — proxy는 "로그인 여부"만 검사(D-2: RBAC=1.6)라, 인증된 비-직원이 `/home`(직원 셸)에 URL 직접 접근 가능. 현재 직원 계정만 존재해 미악용이나, 환자 계정 생기는 Epic 3 전 `(staff)/layout`·`(patient)/portal`에 분기 기반 리다이렉트 스톱갭을 둘지(저렴) vs 1.6에 전면 위임. [proxy.ts·(staff)/layout.tsx] (blind+edge H2)
- [x] [Review][Decision] seed.sql 부트스트랩 자격증명(`admin@pms.local`/`Staff1234`) 처리 — seed.sql은 로컬 `db reset`에서만 실행(클라우드 `db push`는 seed 미실행)이라 컨벤션상 안전하나, 평문 자격증명이 버전관리에 들어감. 현행 유지(경고 강화) vs 환경 가드 추가 vs 별도 수동 스크립트 분리. [supabase/seed.sql] (blind High vs auditor Low)

**Patch (수정 가능 — 명확)**

- [x] [Review][Patch] [Med] 분기에서 `patient` 역할을 직원으로 오분류 — `landingPathForRole`이 `role ? staff : patient`라, `users.role_id`가 `patient` 역할이면 non-null→직원 영역. `roles`에 `patient` 존재(1.3 시드). 직원 역할 집합으로 판정하도록 수정. [web/src/lib/auth/branch.ts] (edge C1)
- [x] [Review][Patch] [Med/High] proxy `getUser()` 미들 예외 미처리 — Auth 일시 장애 시 모든 매칭 경로(로그인 포함)가 500 → 전면 장애. try/catch로 fail-safe(로그인 경로=통과, 그 외=/login). [web/src/lib/supabase/proxy.ts] (edge C2)
- [x] [Review][Patch] [Med] 로그인 폼이 `auth_user_role` RPC 오류 무시 — signIn 성공 후 RPC 실패면 role=undefined→직원이 `/portal`로 오라우팅. RPC error 시 `/`(서버 재평가)로. [web/src/app/(auth)/login/login-form.tsx] (blind+edge+auditor F8)
- [x] [Review][Patch] [Med] proxy matcher 누수 — `/api`·`.css/.js/.json/.map` 등 미제외 → 미인증 시 로그인 HTML 반환 + 매 자산에 `getUser()`. api·공통 확장자 제외 + prefetch 제외. [web/src/proxy.ts] (blind+edge M1)
- [x] [Review][Patch] [Med] 리다이렉트 쿠키 옵션 소실 — `redirectPreservingCookies`가 `getAll().set(cookie)`로 복사해 HttpOnly/Secure/SameSite/Max-Age 유실 위험. `cookiesToSet`(옵션 포함)을 추적해 적용. [web/src/lib/supabase/proxy.ts] (blind)
- [x] [Review][Patch] [Low] 오류 매핑 과대 — 403/429를 "비밀번호 오류"로 표기(가입차단·미확인·레이트리밋 오인). `invalid_credentials`/400만 자격증명, 그 외 일반 메시지. [web/src/lib/auth/errors.ts] (blind)
- [x] [Review][Patch] [Low] server.ts 주석 오류 — "lib/supabase/middleware.ts"는 부재(Next 16 proxy.ts). 주석 수정. [web/src/lib/supabase/server.ts] (blind)
- [x] [Review][Patch] [Low] signOut 실패 무시 — 실패해도 무조건 `/login` 리다이렉트 → 세션 잔존 시 다시 앱으로 튕김(공용 PC 프라이버시). error 처리. [web/src/lib/auth/actions.ts] (blind+edge H4)
- [x] [Review][Patch] [Low] seed `v_admin_role` NULL 가드 — admin 역할 미시드 시 `role_id` NOT NULL 위반으로 블록 침묵 중단. `raise exception` 추가. [supabase/seed.sql] (edge M2)
- [x] [Review][Patch] [Low] Zod email `.trim()` 순서 — `z.email().trim()`은 트림 전 검증 → 공백 붙은 붙여넣기 거부. `z.string().trim().pipe(z.email())`. [web/src/lib/auth/schema.ts] (edge L1)

**Defer (이월)**

- [x] [Review][Defer] web `NEXT_PUBLIC_*` env fail-fast 부재(`process.env.X!`) — 미설정 시 불투명 런타임 오류. **Story 1.5 env 하드닝**(1.3 deferred-work의 `SUPABASE_*` fail-fast와 동일 묶음)에 web env 스키마 검증 포함. [client/server/proxy.ts] (blind+edge L2) — deferred

**Resolution (2026-06-20):** Decision 2건 모두 반영(D1=스톱갭 역할 가드 추가 → `(staff)/layout`·`(patient)/portal`이 `isStaffRole`로 교차 리다이렉트; D2=seed 자격증명 현행 유지 + 경고 강화). **Patch 12건 전부 적용·검증**(tsc·eslint 클린 · vitest **14 passed** · `next build` 성공 · `db reset` 부트스트랩 로그인 OK · proxy 가드/`/portal` 게이트 E2E 307 확인). Defer 1건은 `deferred-work.md`(→1.5) 이월. Dismiss 4건 드롭. 분기 판정은 `landingPathForRole`(non-null)→`isStaffRole`(직원 5역할, `patient` 제외)로 보정(D-1').

---

## Dev Notes

### 의존성·기술 스택 (이미 설치 — 추가 금지)

| 항목 | 버전/위치 | 비고 |
|---|---|---|
| `@supabase/ssr` | `^0.12.0` (web/package.json) | 쿠키 세션 — 브라우저+서버 클라이언트 split |
| `@supabase/supabase-js` | `^2.108.2` | Auth·쿼리 |
| Next.js | `16.2.9`, App Router, `basePath`, `output: standalone` | next.config.ts |
| React Hook Form 7 + Zod 4 | **미설치 — 추가 필요** | 폼·검증(Pydantic의 거울). `npm i react-hook-form zod @hookform/resolvers` |
| Vitest + RTL | **미설치 — Task 8에서 설정** | 첫 web 테스트 |

> ⚠️ React Hook Form·Zod는 아키텍처 확정 스택(project-context L32)이나 web에 아직 미설치 → Task 3/8에서 설치(스펙 내 의존성, 승인된 라이브러리). 그 외 새 라이브러리 임의 추가 금지.

[Source: web/package.json; architecture.md L202·L366; project-context.md L32]

### 인증 흐름 (아키텍처 확정)

```
로그인 폼 → supabase.auth.signInWithPassword
  → @supabase/ssr 쿠키 세션 수립
  → 미들웨어가 매 요청 세션 갱신(updateSession)
  → 분기: auth_user_role() RPC → non-null=직원→(staff) / null=환자→(patient)
  → 이후 명령은 FastAPI에 Bearer 첨부(1.5), 단순조회는 Supabase 직접(RLS), 세션=Supabase 클라이언트
```

[Source: architecture.md L189·L201·L280-281 "Supabase 세션(쿠키)→미들웨어 가드→Bearer→JWKS 검증, 갱신은 @supabase/ssr"]

### 비자명 설계 결정 (DISASTER 방지 — 반드시 준수)

- **D-1 (환자 분기 — patients 테이블 부재):** 아키텍처 분기는 `users` vs `patients.auth_uid`이나 **`patients`는 0006(Epic 3)까지 없다.** 따라서 1.4는 **직원 판정(`auth_user_role()` non-null = `users` 행 보유)** 으로 분기하고, **비직원은 일괄 `(patient)` placeholder로** 라우팅한다(현재 실제 환자·자가가입은 없음 — Story 3.4). 환자 측 정밀 판정(`patients.auth_uid`)·포털 실내용은 Epic 3/8에서 보강. `is_patient()` 헬퍼를 만들지 말 것(patients 부재). [epics.md#Epic1-범위노트 L321; architecture.md L315]
- **D-2 (미들웨어 분담):** 1.4 = **세션 갱신 + 인증 여부 가드**(미인증→login, 인증→영역). **역할별(RBAC) 라우트 가드·UI 노출 게이트(`usePermissions`)는 Story 1.6 소유** — 1.4에서 역할 권한 검사를 구현하지 말 것. 단, @supabase/ssr는 세션 지속에 미들웨어가 필수라 미들웨어 파일 자체는 1.4가 만든다(1.6이 확장). [epics.md#Story-1.6 L449-489; architecture.md L350]
- **D-3 (부트스트랩 테스트 계정 — 닭-달걀):** 1.3은 사용자 무시드(auth 사용자 없음), 실제 계정 생성 UI는 1.8. 그 사이 1.4 로그인을 실증하려면 **dev 전용 테스트 직원 1명**이 필요. 로컬 한정 부트스트랩(스크립트 또는 seed.sql dev 가드 블록)으로 `auth.users`+`public.users`(role=admin) 1건 생성. **프로덕션 시드·실계정 생성과 분리, dev-only 명시.** 자격증명은 커밋 금지. [§Task7]
- **D-4 (마이그레이션 무관 — 스키마 재생성 금지):** 1.4는 **DB 마이그레이션을 만들지 않는다.** `users` 테이블·`auth_user_role()`은 1.3이 이미 생성(0002/0003). 분기는 `auth_user_role()` RPC 호출 또는 `users` self-read(RLS `users_select_self`)로. **`0002_auth_tables.sql` 같은 신규 마이그레이션을 만들지 말 것**(스키마 단일 소유·중복). [§1.3 산출물]
- **D-5 (auth 하드닝 범위):** 비밀번호 정책 강화(length 8 + `lower_upper_letters_digits`), **`enable_signup=false`**(직원=1.8 관리자 생성, 환자 셀프가입=3.4가 재활성 시점에 켬). `enable_confirmations`는 로컬 dev false 유지 가능(이메일 인박스 시뮬). redirect URL·site_url은 이미 basePath 반영 — 검증만. 클라우드 대시보드 동기화는 문서. [deferred-work.md; supabase/config.toml L177·L183·L227]
- **D-6 (1.2 데모 페이지 정리):** 현재 `app/page.tsx`는 1.2 디자인 시스템 시각검증 데모(AppShell 렌더). 1.4는 `/`를 인증분기/`/login` 리다이렉트로 전환하고 데모를 제거하거나 `(staff)` 개발용 경로로 이동(검증 가치 보존하되 `/` 비점유). layout.tsx(루트, Pretendard·Toaster)는 보존. [web/src/app/page.tsx; 1.2 산출물]

### 보안·PII 경계 (엄수)

- **무PII 오류(AC3):** 로그인 실패 시 원문 Supabase 오류(이메일 존재 여부 등 계정 열거 단서 포함) 노출 금지 → 범용 한국어("이메일 또는 비밀번호가 올바르지 않습니다"). 이메일·토큰·세션을 토스트·콘솔·에러 envelope·URL에 넣지 말 것. [project-context.md L84]
- **키 경계:** web은 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`(publishable)만. `SUPABASE_SECRET_KEY`/service_role은 **클라 번들 금지**(서버 전용). [project-context.md L82]
- **세션 보안:** `@supabase/ssr` httpOnly 쿠키. 클라가 제공한 patient_id 등 신뢰 금지 — 분기는 **세션 uid 기준**. [project-context.md L84 환자 포털=세션 uid 스코프]
- **검증 3계층:** 클라 Zod(즉시 UX) → (1.5)서버 Pydantic → DB. 1.4는 클라 경계만. [project-context.md L64]

### 상태 관리 (엄수)

- 세션 = **Supabase 클라이언트**(쿠키), 서버상태 = TanStack Query(이 스토리엔 거의 없음), UI상태 = Zustand. **서버 데이터를 Zustand에 넣지 말 것.** 로그인은 mutation 성격 — TanStack Query mutation 또는 직접 호출 후 라우팅. [project-context.md L56]

### Project Structure Notes

- 생성/수정 파일:
  - `web/src/lib/supabase/client.ts`·`server.ts` (NEW)
  - `web/src/middleware.ts` (NEW)
  - `web/src/lib/auth/branch.ts` (NEW)
  - `web/src/app/(auth)/login/page.tsx` (NEW)
  - `web/src/app/(staff)/layout.tsx`·`(staff)/page.tsx` (NEW)
  - `web/src/app/(patient)/page.tsx` (NEW)
  - `web/src/app/page.tsx` (UPDATE — `/` 리다이렉트), 1.2 데모 이동/제거
  - `web/package.json` (UPDATE — RHF·Zod·Vitest·RTL·@hookform/resolvers 추가)
  - `web/vitest.config.ts` (NEW), 단위 테스트 co-located (NEW)
  - `supabase/config.toml` (UPDATE — [auth] 하드닝)
  - 부트스트랩(스크립트 또는 `supabase/seed.sql` dev 블록) (NEW/UPDATE)
- 보존(깨면 안 됨): `next.config.ts` basePath, 루트 `layout.tsx`(Pretendard·Toaster), 디자인 토큰(`globals.css`), AppShell·Sidebar·Topbar 컴포넌트(1.2) — 1.4는 `(staff)/layout.tsx`에서 **소비**(수정 최소). Sidebar의 `usePermissions` 게이트 자리는 **1.6**이 채움(1.4는 정적 유지).
- TS 타입(`web/src/types/database.types.ts`)은 **생성물** — 필요 시 `supabase gen types typescript --local > ...`로 생성(손수정 금지). 1.4 분기에 타입이 필요하면 생성 권장.
- 파일명 kebab-case(shadcn 관습), 컴포넌트 PascalCase, 훅 `useX`. App Router route group은 `(auth)`/`(staff)`/`(patient)`.

[Source: architecture.md L346-373(web 구조)·L256-265(네이밍·구조); 1.2 File List]

### 이전 스토리 인텔리전스 (1.1·1.2·1.3 상속)

- **1.1:** `@supabase/ssr`·`supabase-js` 설치, `next.config.ts` basePath, `.env.example`(NEXT_PUBLIC_SUPABASE_URL/PUBLISHABLE_KEY/BASE_PATH), config.toml auth 약한 기본값(1.4 하드닝 대상). 키 체계 publishable/secret.
- **1.2:** AppShell(사이드바 240/60·탑바 52)·디자인 토큰·Pretendard·공통 상태(스켈레톤·토스트·focus-visible). **AppShell 주석: "인증·RBAC 게이트·route group (staff) 배선 = Story 1.4/1.6 소유"** — 1.4가 `(staff)/layout.tsx`에서 AppShell을 렌더해 이 자리를 채움. Sidebar는 정적 placeholder(usePermissions=1.6).
- **1.3:** `users`(id=auth uid, FK→auth.users), `roles`/`permissions`/`role_permissions`, `auth_user_role()`·`has_permission()`(SECURITY DEFINER), RLS `users_select_self`(authenticated 본인 행 SELECT). **분기는 `auth_user_role()` 호출이 가장 깔끔**(role code 동시 획득, active 직원만 인정). 시드된 6 역할·admin=전체 권한 존재.
- **공통 규율:** 커밋·푸시 승인 시에만. JSON snake_case 전 경로. 한국어 UI. dev 구동 `supabase start`(실행 중) + `npm run dev`.

[Source: 1-1·1-2·1-3 산출물; api/web 스캐폴드]

### 테스트 (이 스토리 범위)

- **단위(Vitest+RTL):** 분기 util(role→영역), 로그인 Zod 스키마, 오류 매핑(무PII). 순수 로직·컴포넌트 렌더 위주(브라우저 불필요).
- **수동 통합:** Task 7 부트스트랩 계정으로 실제 로그인→세션→`(staff)` 진입→로그아웃 흐름 1회 확인(로컬 `supabase start` + `npm run dev`).
- **이월:** 전체 인증 E2E(Playwright)·커버리지 게이트 = Post-MVP(project-context L65, 과도 명세 금지). 역할별 라우트 가드 테스트 = 1.6.

### References

- [Source: epics.md#Story-1.4 L407-427] — AC 원문(분기·라우팅·무PII 오류·basePath)
- [Source: epics.md#Epic1-범위노트 L321; #Story-1.6 L449-489] — patients 지연 생성·미들웨어/RBAC 게이트 1.6 분담
- [Source: architecture.md L183·L189·L201·L280-281] — 분리 프로필·@supabase/ssr 세션·Bearer·인증 흐름
- [Source: architecture.md L346-373] — web 디렉토리(route group·middleware·lib supabase client)
- [Source: architecture.md L106-107·L193] — RLS 태도·읽기/쓰기 경로 분담
- [Source: supabase/config.toml L177·L183·L227; deferred-work.md] — auth 하드닝 대상
- [Source: project-context.md L32·L56·L82·L84] — 스택·상태분리·키 경계·PII 경계
- [Source: 1-3-...db.md] — users·auth_user_role()·RLS users_select_self(소비 대상)
- [Source: web/package.json·next.config.ts·src/app/{layout,page}.tsx·components/shell/*] — 현 스캐폴드 상태

---

## Dev Agent Record

### Context Reference

- 실행 환경: Supabase 로컬 스택 기동 중(`supabase start`, DB `:54322`, API `:54321`, Studio `:54323`). 0001~0004 마이그레이션 적용됨(users·RBAC·감사). 로컬 publishable/secret 키는 `supabase status`로.
- 분기 RPC: `supabase.rpc('auth_user_role')` → `text|null`(active 직원 role code). `has_permission`은 1.5/1.6에서 사용.
- 미설치 의존성(이 스토리에서 추가): `react-hook-form`·`zod`·`@hookform/resolvers`(폼), `vitest`·`@testing-library/react`·`@testing-library/jest-dom`·`jsdom`(테스트).

### Agent Model Used

claude-opus-4-8[1m] (Claude Opus 4.8, 1M context) — BMad dev-story 워크플로

### Debug Log References

- `web/AGENTS.md` 경고대로 `node_modules/next/dist/docs/`를 선독 → **Next 16 breaking change 2건 반영**(아래 Completion Notes).
- Vitest 4파일 11테스트 통과 · `tsc --noEmit` 클린 · `eslint` 클린 · `next build` 성공(Turbopack, proxy=ƒ Proxy 인식, route group 충돌 0).
- 부트스트랩 로그인 검증: token endpoint → ES256 JWT 획득 · `rpc/auth_user_role` → `"admin"` · 오답 → HTTP 400.
- proxy 가드 E2E(dev :3002): 미인증 `/home` → 307 `/patient_management_system/login`(basePath 정확), `/login` → 200.
- `supabase db reset` 재현성: 수정 seed로 fresh reset 후 패치 없이 로그인 OK.

### Completion Notes List

구현 요약 — Next 16 + Supabase Auth 로그인·분리 프로필 분기·세션·route group + auth 하드닝 + dev 부트스트랩 + 첫 web 테스트 인프라.

**🔑 Next 16 breaking change 2건(AGENTS.md 지시로 docs 선독해 발견):**
1. **`middleware.ts` → `proxy.ts`**(v16.0.0, 함수명 `middleware`→`proxy`, Node 런타임 기본). 스펙의 "middleware.ts"는 구명칭 → `web/src/proxy.ts`로 구현. (아키텍처/스펙 문서가 Next 16 이전 작성)
2. **async `cookies()`**(Next 16) — 서버 클라이언트에서 `await cookies()`. RHF+Zod, `z.email()`(Zod 4 top-level)도 docs로 확인.

**🐛 GoTrue 부트스트랩 gotcha:** 수동 `auth.users` 삽입 시 토큰 text 컬럼(`confirmation_token`·`recovery_token`·`email_change*` 등)이 NULL이면 로그인이 500 `"Database error querying schema"`로 실패(GoTrue가 non-nullable string으로 스캔). seed에서 `''`로 채워 해결. `auth.identities` 행도 함께 생성해야 email 로그인 가능. pgcrypto는 `extensions` 스키마라 `extensions.crypt/gen_salt` 한정 호출.

**구현 결정 준수:** D-1(직원=`auth_user_role()` non-null, 비직원→`(patient)`, `is_patient()` 미생성) · D-2(proxy=세션갱신+인증가드만, RBAC 가드는 1.6) · D-3(dev 부트스트랩 admin@pms.local) · D-4(마이그레이션 무관, 1.3 `users`·`auth_user_role()` 소비) · D-5(config 하드닝: min 8·요구사항·signup=false) · D-6(루트 데모 → 분기 리다이렉트).

AC 충족: AC1✅(로그인+ssr세션+분기) AC2✅(`(staff)`/`(patient)` 라우팅) AC3✅(무PII 한국어 오류 — 단위+폼 테스트) AC4✅(basePath redirect 307 확인) AC5✅(proxy 세션갱신·로그아웃) AC6✅(가드 E2E) AC7✅(부트스트랩+11테스트) AC8✅(lint·tsc·build).

이월: 역할별 RBAC 라우트 가드·`usePermissions` 사이드바 게이트 → 1.6. 실제 직원 계정 생성 UI → 1.8. 환자 정밀 분기·포털 실내용 → Epic 3/8. 전체 로그인 E2E(Playwright) → Post-MVP. `database.types.ts` 미생성(이 스토리에 불필요).

### File List

- `web/src/proxy.ts` (NEW — Next 16 proxy, 세션갱신+인증가드)
- `web/src/lib/supabase/client.ts`·`server.ts`·`proxy.ts` (NEW — @supabase/ssr 클라이언트)
- `web/src/lib/auth/branch.ts`·`errors.ts`·`schema.ts`·`actions.ts` (NEW — 분기·무PII오류·Zod·로그아웃)
- `web/src/lib/auth/branch.test.ts`·`errors.test.ts`·`schema.test.ts` (NEW)
- `web/src/app/(auth)/login/page.tsx`·`login-form.tsx`·`login-form.test.tsx` (NEW)
- `web/src/app/(staff)/layout.tsx`·`home/page.tsx` (NEW)
- `web/src/app/(patient)/portal/page.tsx` (NEW)
- `web/src/components/auth/logout-button.tsx` (NEW)
- `web/src/app/page.tsx` (UPDATE — 1.2 데모 → 세션 분기 리다이렉트)
- `web/package.json`·`package-lock.json` (UPDATE — RHF·Zod·@hookform/resolvers·Vitest·RTL·jsdom·plugin-react + test 스크립트)
- `web/vitest.config.ts`·`vitest.setup.ts` (NEW — 첫 web 테스트 인프라)
- `web/.env.local` (NEW, **gitignored — 커밋 안 함**; 로컬 키)
- `supabase/config.toml` (UPDATE — [auth] 하드닝: min_length 8·password_requirements·enable_signup=false)
- `supabase/seed.sql` (UPDATE — dev 전용 부트스트랩 테스트 직원 admin@pms.local)

## Change Log

| 날짜 | 변경 | 작성 |
|---|---|---|
| 2026-06-20 | Story 1.4 구현 — Next 16 proxy 세션·인증가드, Supabase Auth 로그인(RHF+Zod·무PII), 분리 프로필 분기(`auth_user_role()`), `(auth)/(staff)/(patient)` route group, AppShell 배선, auth 하드닝, dev 부트스트랩, 첫 web 테스트(Vitest 11). Next 16 middleware→proxy·async cookies, GoTrue NULL-token gotcha 해결. lint·tsc·build·E2E 가드 통과. Status → review | dev-story (Opus 4.8) |
| 2026-06-20 | 코드 리뷰(3레이어) 후속 — patch 12건 적용: patient 역할 분기 보정·proxy getUser try/catch·로그인 RPC 오류 처리·matcher(/api·자산·prefetch)·리다이렉트 쿠키 옵션 보존·**스톱갭 역할 가드((staff)/(patient))**·오류매핑 403·server 주석·signOut scope:local·seed NULL 가드·Zod trim·seed 경고 강화. vitest 14, tsc·eslint·build·E2E 통과. Status → done | code-review (Opus 4.8) |
