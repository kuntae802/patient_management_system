---
baseline_commit: dbd346af42cb1df290fb2fda8e565149a4045d19
---

# Story 1.6: 미들웨어 가드 · 역할별 셸 노출 (RBAC UI 게이트)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **직원(원무·의사·간호사·방사선사·관리자)**,
I want **내 역할 권한에 맞는 메뉴만 보이고 권한 밖 화면에는 진입이 막히기를**,
so that **신규 직원이 자기 일에 집중하고, 권한 밖 기능은 숨기지 않고 "학습적으로" 인지한다.**

> **에픽 맥락:** Epic 1 = 플랫폼 기반·신원·접근 통제. 이 스토리는 **RBAC 3계층 중 'UI 노출 게이트(학습·속도 레이어)'** 를 세운다. 쓰기 권위(FastAPI `require_permission` → 403, Story 1.5 완료)와 데이터 권위(RLS, Story 1.3 토대)는 이미 섰다. **UI 게이트는 보안 경계가 아니다** — 사용자가 DevTools로 버튼을 살려도 FastAPI·RLS가 최종 차단한다. 1.6은 "권한 없는 걸 보여주지 않거나(메뉴), 보여주되 잠그는(액션)" UX 레이어다.

---

## Acceptance Criteria

> 출처: `_bmad-output/planning-artifacts/epics.md:449-467` (Story 1.6 BDD).

**AC1 — 라우트 가드(미인증·역할 경계)**
- **Given** 로그인된 직원 세션에서
- **When** Next 미들웨어(`proxy`)·route group 레이아웃이 세션·역할을 가드하면
- **Then** 미인증 접근은 `/login`으로, 직원/환자 영역 교차 접근은 올바른 홈(`/home`·`/portal`)으로 리다이렉트되고, 권한 없는(역할/권한 미보유) 보호 라우트 직접 URL 접근이 차단된다.

**AC2 — 사이드바 RBAC 노출 게이트(숨김)**
- **Given** 전역 셸(AppShell)이 렌더될 때
- **When** `usePermissions` 훅이 사이드바 항목을 역할·권한으로 평가하면
- **Then** 권한 없는 항목은 **렌더되지 않는다(숨김)** — `display:none`이 아니라 트리에서 제외. 활성 항목은 좌측 teal 액센트 바로 표시되고, 항목은 실제 라우트로 가는 `<Link>`다. (UX-DR4)

**AC3 — 화면 내 권한 밖 액션(잠금·학습)**
- **Given** 화면 내 권한 밖 액션(버튼 등)에 대해
- **When** 사용자가 그 액션을 마주하면
- **Then** `aria-disabled` + 잠금 글리프(⊘) + **한국어 사유**(`aria-describedby`로 연결)가 제공되어, 숨기지 않고 학습을 유도한다. 색만/툴팁만으로 의미를 싣지 않는다(색+글리프+텍스트 중복 인코딩, 403). (UX-DR8·UX-DR18·UX-DR20)

**AC4 — 보안 경계 명료성(횡단)**
- **Given** UI 게이트가 동작할 때
- **When** 권한 없는 사용자가 우회(직접 URL·DevTools)를 시도하면
- **Then** UI 게이트는 막거나 잠그되, **최종 차단은 FastAPI(403)·RLS** 가 수행한다(방어심층). 클라 번들엔 `publishable` 키만 들어가며 `service_role`/`secret` 키는 절대 노출되지 않는다.

---

## Tasks / Subtasks

> ⚠️ **착수 전 필독 (순서대로):**
> 1. `docs/project-context.md` (전 규칙) — 특히 §Framework-Specific Rules, §Critical Don't-Miss Rules.
> 2. `web/AGENTS.md` — **"This is NOT the Next.js you know."** Next 16은 훈련데이터와 다르다. 코드 작성 전 `web/node_modules/next/dist/docs/` 의 해당 가이드(proxy/middleware, async `cookies()`, `Link`, `usePathname`)를 읽어라. 임의 추정 금지.
> 3. 본 스토리 §Dev Notes 전체.

- [x] **Task 1 — web 환경변수 fail-fast (`lib/env.ts`)** (AC: 4) `[deferred-work 재이월 흡수]`
  - [x] 1.1 `web/src/lib/env.ts` 신설: Zod로 `NEXT_PUBLIC_SUPABASE_URL`(url), `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`(min 1), `NEXT_PUBLIC_BASE_PATH`(optional) 검증. 누락/오타 시 명확한 에러 throw(불투명 런타임 오류 대신). `export const env = ...`.
  - [x] 1.2 `web/src/lib/supabase/{client,server,proxy}.ts`의 `process.env.NEXT_PUBLIC_SUPABASE_URL!`·`...PUBLISHABLE_KEY!` 비-null 단언(`!`)을 `env.NEXT_PUBLIC_SUPABASE_URL`로 교체. (클라용은 빌드타임 인라인이므로 `NEXT_PUBLIC_` 접두 유지 — 동적 `process.env[key]` 접근 금지, 인라인 깨짐.)
  - [x] 1.3 단위 테스트: 누락 시 throw, 유효 시 통과 (`lib/env.test.ts`).

- [x] **Task 2 — 권한 데이터 액세스 유틸 (`lib/auth/permissions.ts`)** (AC: 2, 3)
  - [x] 2.1 `fetchUserPermissions(supabase, userId): Promise<string[]>` — **Supabase 직접 조회**(0003이 깔아둔 `authenticated` SELECT 정책 사용). ① `users`에서 본인 `role_id`(RLS `users_select_self`). ② `role_permissions`를 `role_id`로 필터하며 `permissions(code)` 임베드 조회. → `code` 문자열 배열 반환. 비직원(users 행 없음)·예외 → `[]`(안전 디폴트). **DDL 추가·새 마이그레이션 없음** — §Dev Notes "권한 데이터 소스 결정" 참조.
  - [x] 2.2 권한 코드는 `permissions.code`(`<resource>.<action>` snake_case, 0002 시드 23종). TS에서 camelCase 변환 금지(JSON 전 경로 snake_case 규칙).
  - [x] 2.3 단위 테스트: 임베드 응답 형태 → `string[]` 매핑, 빈/에러 → `[]`.

- [x] **Task 3 — PermissionsProvider + usePermissions 훅** (AC: 2, 3)
  - [x] 3.1 `web/src/components/auth/permissions-provider.tsx`(`"use client"`): `{ role, permissions, children }` props를 받아 React Context로 제공. `permissions`는 `Set<string>`으로 보관(O(1) 조회).
  - [x] 3.2 `web/src/hooks/use-permissions.ts`(신규 폴더): `usePermissions()` → `{ role: string|null, has(code: string): boolean }`. Provider 밖 호출 시 명확한 에러. **TanStack Query 미사용**(§Dev Notes "상태/Provider 결정").
  - [x] 3.3 단위 테스트: `has()` true/false, Provider 밖 호출 에러.

- [x] **Task 4 — (staff) 레이아웃 배선: 권한 fetch + 역할 가드 정식화** (AC: 1, 2)
  - [x] 4.1 `web/src/app/(staff)/layout.tsx`(서버 컴포넌트, 기존): 현 스톱갭(`auth_user_role()` → `isStaffRole` → 비직원 `/portal`)을 **정식 가드로 유지**. 추가로 `fetchUserPermissions()`로 권한 목록 fetch.
  - [x] 4.2 `<PermissionsProvider role={role} permissions={perms}>` 로 `<AppShell>`을 감싼다. AppShell·Sidebar가 Context를 소비.
  - [x] 4.3 `auth_user_role()` RPC 실패(`error`)는 권한 결정을 추정하지 말고 `/portal`(또는 `/`)로 안전 강등(로그인 폼의 D-1 패턴과 일관).

- [x] **Task 5 — 라우트 가드 유틸 + 미들웨어 검증** (AC: 1)
  - [x] 5.1 `web/src/lib/auth/guards.ts`(서버 전용): `requireStaff()` — `(staff)/layout`이 쓰는 역할 가드 추출/재사용. `requirePermission(code)` — 서버 컴포넌트/레이아웃에서 특정 권한 없으면 안전 경로로 `redirect`(향후 `(staff)/admin/*` 등 권한별 보호 라우트가 소비할 패턴). 1.6은 **유틸 + 데모**까지(실제 권한별 라우트는 1.7 admin이 소비).
  - [x] 5.2 `web/src/proxy.ts`·`lib/supabase/proxy.ts`(기존): 인증 경계(미인증→`/login`, 인증+로그인경로→`/`)는 **유지**. 역할/권한 가드를 proxy에 넣지 말 것(영역·권한 판별은 RPC 필요 → route group 레이아웃이 담당, §Dev Notes "미들웨어 vs 레이아웃"). matcher는 현행 유지(api·정적자산 제외, prefetch 미적용).
  - [x] 5.3 가드 유틸 단위 테스트.

- [x] **Task 6 — 역할별 내비 설정 (`lib/nav/staff-nav.ts`)** (AC: 2)
  - [x] 6.1 6역할 사이트맵(UX-DR24)을 데이터로 구조화. `type NavItem = { label, icon, href, roles: Role[], requiredPermission?: string }`. 섹션 그룹(운영/환자/정산/관리 등 `caption`) 지원.
  - [x] 6.2 §Dev Notes "역할별 사이드바 메뉴 맵" 표를 그대로 구현. `href`는 `basePath` 없는 앱-내 경로(`/reception/waiting` 등; Next `<Link>`/`basePath`가 자동 전파). 라우트 경로는 향후 에픽이 페이지를 채울 자리 — **여기선 메뉴 정의만**(404 가능, 정상).
  - [x] 6.3 단위 테스트: 역할별 `filterNav(items, role, has)` → 기대 항목 집합.

- [x] **Task 7 — Sidebar 동적 렌더 전환** (AC: 2)
  - [x] 7.1 `web/src/components/shell/sidebar.tsx`: 정적 `primaryNav`(원무 7항목 하드코딩)를 제거하고 `staff-nav.ts` + `usePermissions()`로 **동적 필터**. 규칙: `roles.includes(role)` **그리고**(`requiredPermission` 없거나 `has(requiredPermission)`)인 항목만 렌더.
  - [x] 7.2 `NavButton`을 `<Link>`로 전환(do-nothing `<button>` 폐기, deferred 1.2 해소). 활성 판정 = `usePathname()`이 `item.href`로 시작. `aria-current="page"`는 활성 `<a>`에만(시맨틱 정합). 액센트 바·아이콘·카운트 스타일은 현행 유지.
  - [x] 7.3 푸터의 사용자/역할 표시(현 하드코딩 "정해린·원무")를 Context `role`(+가능 시 이름)로 치환. 이름이 없으면 역할 한글 표시명만.
  - [x] 7.4 접힘(60px) 시 `aria-label`/`title` 유지. 빈 메뉴(권한 0 역할) 시 깨지지 않게(섹션 캡션은 항목 있을 때만 렌더).
  - [x] 7.5 컴포넌트 테스트: admin → 관리 항목 보임, reception → 관리 항목 숨김(미렌더) 등.

- [x] **Task 8 — 권한 밖 액션 컴포넌트 (`PermissionGate`/`LockedAction`)** (AC: 3)
  - [x] 8.1 `web/src/components/auth/permission-gate.tsx`: `requiredPermission` 보유 시 children 렌더, 미보유 시 잠금 표현(`aria-disabled` + `Lock`(lucide `Lock`/⊘) 아이콘 + 한국어 사유 텍스트 + `aria-describedby` 연결). **포커스 가능**(`disabled` 속성 아님 → 학습 유도). 색+글리프+텍스트 중복 인코딩.
  - [x] 8.2 사유 카피는 한국어·행동 지향(예: "이 작업은 '처방 발행' 권한이 필요합니다"). `error.code`는 영문, 사용자 노출 `message`는 한국어 규칙.
  - [x] 8.3 데모 배치: `(staff)/home/page.tsx`에 권한 밖 액션 1개 예시(예: 비-admin에게 잠긴 "권한 관리" 진입 버튼)로 AC3를 가시적으로 검증 가능하게. 과잉 구현 금지(데모 1개).
  - [x] 8.4 컴포넌트 테스트: 보유 → children, 미보유 → aria-disabled+사유+aria-describedby.

- [x] **Task 9 — 글로서리·문서 정합** (AC: 횡단)
  - [x] 9.1 `docs/glossary.md`에 신규 코드 식별자 등재: `usePermissions`, `PermissionsProvider`, `PermissionGate`, `fetchUserPermissions`, (RPC 채택 시) `auth_user_permissions`. (DB·도메인 용어 중심이나 신규 식별자 등재 규칙 준수.)
  - [x] 9.2 권한 데이터 소스로 **RPC를 선택**했다면(§Dev Notes 대안): 새 마이그레이션은 `supabase/migrations/`의 다음 가용 번호(현 0001~0004 → 0005)로 추가하고, `architecture.md`/`glossary.md`의 마이그레이션 번호 계획(0005=masters)이 한 칸 밀린다는 점을 주석/메모로 반영. **기본 권장은 RPC 미추가(직접 조회)** 이므로 보통 이 서브태스크는 불필요.

- [x] **Task 10 — 회귀·통합 검증** (AC: 1, 2, 3, 4)
  - [x] 10.1 기존 1.4 동작 무회귀: 로그인→분기(`landingPathForRole`), 미인증 가드(proxy), staff/patient 교차 가드(`(staff)/layout`·`(patient)/portal/page`)가 여전히 통과. 기존 테스트(`branch.test.ts`·`login-form.test.ts`) 녹색 유지.
  - [x] 10.2 `npm run lint`·`tsc`(typecheck)·`vitest` 통과. ESLint+Prettier 정합.
  - [x] 10.3 셀프 검증 시나리오(§Dev Notes "검증 시나리오") 수기 확인.

### Review Findings (코드 리뷰 2026-06-20)

> Blind Hunter · Edge Case Hunter · Acceptance Auditor 3개 병렬 적대적 리뷰. **Acceptance Auditor: Strong pass**(4 AC·10 Task 충실 구현, 완료 허위 없음). **High 결함 0.** 다수 가설(PostgREST 임베드 형태·redirect never narrowing·basePath strip·빈 섹션 캡션)은 이미 정상 처리 확인됨.

**Decision needed:**
- [x] [Review][Decision] non-admin 역할 사이드바 핵심 항목 가시성 — `0002`가 권한을 admin에게만 grant하므로, `requiredPermission` 게이트가 걸린 항목(reception: 환자 등록·환자 검색·수납 / nurse: 활력징후 입력 등)이 Story 1.7(권한 매트릭스) 전까지 사이드바에서 숨겨진다. 의도된 모델(역할 AND 권한)을 유지할지, 1.7 전까지 데모 가능하도록 조정할지 결정 필요. [staff-nav.ts + supabase/migrations/0002:109-114] **해결(2026-06-20): 옵션 (b) 채택** — 노출 모델을 '직무 핵심=역할 노출 / 민감·관리=권한 게이트'로 확정. reception(환자 등록·검색·수납)·doctor(환자 검색)·nurse(활력징후 입력)의 requiredPermission 제거, admin 관리 항목만 게이트 유지. 진짜 민감 동작은 화면 내 액션 게이트가 담당.

**Patch:**
- [x] [Review][Patch] fetchUserPermissions 에러를 정상 빈 권한과 구분해 로깅 — transient/RLS 에러가 `[]`로 무신호 붕괴(관측성 부재). 동작(`[]` fail-closed)은 유지하되 에러 path에 경고 로그 추가 [web/src/lib/auth/permissions.ts:13,20]
- [x] [Review][Patch] PermissionsProvider useMemo 안정 키 — `permissions` 배열이 매 렌더 새 참조라 memo 무효(전 consumer 재렌더). 정렬+join 키로 안정화 [web/src/components/auth/permissions-provider.tsx:23]
- [x] [Review][Patch] requireStaff '미인증' 테스트 강화 — `/REDIRECT/` 범용 매칭을 `REDIRECT:${PATIENT_HOME}` 특정 타겟 검증으로(다른 케이스와 일관) [web/src/lib/auth/guards.test.ts:49]
- [x] [Review][Patch] requirePermission 미인증 리다이렉트를 LOGIN_PATH로 — AC1('미인증→/login') 정합(현재 PATIENT_HOME) [web/src/lib/auth/guards.ts:38]

**Deferred:**
- [x] [Review][Defer] (staff)/layout 인증·권한 라운드트립 최적화 — getUser + auth_user_role RPC + users.role_id 재조회 등 3~4 왕복(role_id 중복); role+permissions 통합 RPC로 단축 가능. 성능, MVP 수용 [web/src/app/(staff)/layout.tsx] — deferred
- [x] [Review][Defer] guards.ts server-only 경계 강제 — 현재 주석뿐(server-only 패키지 미설치). 클라 import 시 빌드 차단 부재. 의존성 추가 결정 필요 [web/src/lib/auth/guards.ts:8] — deferred
- [x] [Review][Defer] requirePermission fallback/staff 재확인 — 기본 fallback=STAFF_HOME이 비-staff를 staff 영역으로 보낼 수 있고 staff 재확인 없음. 소비처(1.7 admin 라우트) 정의 시 확정 [web/src/lib/auth/guards.ts:34] — deferred

---

## Dev Notes

### 🎯 이 스토리의 본질 (한 줄)
**RBAC 3계층 중 UI 레이어를 세운다:** 권한 데이터를 한 번 읽어(서버) → Context로 제공 → 사이드바는 권한 없는 항목을 **숨기고**, 화면 내 액션은 **잠근다**(학습). **보안 경계가 아니다** — FastAPI·RLS가 최종 권위.

---

### 🏗️ 아키텍처 가드레일 (반드시 준수)

**[Next 16 특수성 — 1순위 함정]**
- ⚠️ 미들웨어 파일은 `middleware.ts`가 **아니라** `web/src/proxy.ts`(함수명 `proxy`, 노드 런타임 기본)다. Next 16 breaking change. `lib/supabase/proxy.ts:updateSession`이 실제 로직.
  [Source: web/src/proxy.ts:5-6, web/src/lib/supabase/proxy.ts:7-8]
- ⚠️ `web/AGENTS.md`: "This is NOT the Next.js you know." → 코드 전 `web/node_modules/next/dist/docs/`의 proxy/`Link`/`usePathname`/async `cookies()` 가이드 확인. 훈련데이터 추정 금지.
- `cookies()`는 **async** (`await cookies()`). [Source: web/src/lib/supabase/server.ts:6-7]
- `basePath=/patient_management_system`는 빌드타임 결정. `<Link href="/reception/waiting">`처럼 **basePath 없는 앱-내 경로**를 쓰면 Next가 자동 전파. proxy redirect도 `nextUrl.clone()`이 basePath 보유 → `url.pathname` 설정만. [Source: web/next.config.ts:3-4, web/src/lib/supabase/proxy.ts:47-54]

**[상태 분리 규칙]** [Source: docs/project-context.md:56]
- 서버상태=TanStack Query / UI상태=Zustand / 세션=Supabase 클라이언트. **서버 데이터를 Zustand에 넣지 말 것.**
- ⚠️ **단, TanStack Query는 현재 web에 미설치**(`@tanstack/react-query` 없음). 본 스토리는 §"상태/Provider 결정"에 따라 **서버 fetch + React Context**로 권한을 제공한다(새 의존성 추가 회피). [Source: web/package.json dependencies]

**[RBAC 3계층]** [Source: epics.md:161, docs/project-context.md:59]
- UI 노출(웹, **이 스토리**) / FastAPI 명령 강제(쓰기 권위, 1.5 완료) / RLS 행 강제(데이터 권위, 1.3 토대). DB 헬퍼 `has_permission(code)`(SECURITY DEFINER). **UI 게이트는 보안 경계가 아니라 학습·속도 레이어.**

**[보안 MUST]** [Source: docs/project-context.md:82-84]
- 🚫 `service_role`/`secret` 키 클라 노출 금지 — 클라는 `publishable` 키만(`createBrowserClient`). [Source: web/src/lib/supabase/client.ts:3-9]
- 🚫 raw 주민번호/PII는 로그·URL·페이로드 금지. (1.6은 PII를 다루지 않음 — Context는 role/permission 코드만, PII 없음.)
- 모호하면 더 제한적인 옵션을 택한다(특히 보안·PII). [Source: docs/project-context.md:94]

---

### 🔑 권한 데이터 소스 결정 (핵심 — 반드시 이 방식)

**결정: Supabase 직접 조회 (DDL/마이그레이션 추가 없음).**

근거: **Story 1.3의 `0003_rls_helpers.sql:53-65`가 이미 의도적으로** `roles`·`permissions`·`role_permissions`에 `authenticated` SELECT 정책을 깔아두었다. 그 주석(L53): *"직원 화면(1.6 셸 게이트·1.7 매트릭스)이 역할·권한 카탈로그를 읽도록 authenticated SELECT."* → **1.6은 직접 조회로 권한을 읽는 것이 아키텍트 의도다.**
[Source: supabase/migrations/0003_rls_helpers.sql:53-70]

**조회 절차** (`fetchUserPermissions`, 서버 컴포넌트에서 `createClient()` 세션으로):
1. 본인 `role_id`: `users`에서 `eq('id', userId)` (RLS `users_select_self`가 본인 행만 허용). [Source: 0003:67-70]
2. 권한 코드: `role_permissions`를 `eq('role_id', roleId)`로 필터하며 `permissions(code)` 임베드. (`role_permissions`·`permissions` SELECT `using(true)` — 카탈로그는 전체 가독, role_id 필터로 본인 것만.) [Source: 0003:59-65, 0002:25-33]
3. → `string[]`(예: `['patient.read','encounter.register',...]`). 비직원/예외 → `[]`.

**권한 코드 카탈로그 (0002 시드, 23종):** [Source: supabase/migrations/0002_identity_rbac.sql:83-107]
```
patient.read patient.create patient.update patient.reveal_rrn
encounter.register encounter.start encounter.complete
medical_record.write diagnosis.attach prescription.create
examination.order treatment.order treatment.perform vital.record
appointment.read appointment.create appointment.cancel
payment.process master.manage dashboard.read user.manage rbac.manage audit.read
```
⚠️ **부트스트랩 현실:** 0002는 **admin에게만 23권한 전부**를 grant했다. reception/doctor/nurse/radiologist는 **현재 권한 0개**(역할별 grant 토글 UI = Story 1.7). [Source: 0002:109-114] → **순수 권한 기반으로 사이드바를 필터하면 admin 외 역할의 메뉴가 텅 빈다.** 아래 "사이드바 메뉴 맵" 모델이 이를 해결한다.

**대안(선택, 비권장):** 라운드트립 1회를 원하면 `auth_user_permissions()` SECURITY DEFINER RPC(`setof text`, active 직원 필터)를 새 마이그레이션으로 추가 가능 — `has_permission`/`auth_user_role` 계열과 동형. 단 (a) DB 마이그레이션 = 스코프 확장, (b) 번호 계획(0005=masters) 충돌 관리 필요. **기본은 직접 조회.** Task 9.2 참조.

---

### 🗂️ 상태/Provider 결정 (TanStack Query 회피 근거)

**결정: 서버 컴포넌트 fetch → `PermissionsProvider`(React Context) → `usePermissions()` 소비.**

- 셸은 이미 **서버 컴포넌트**(`(staff)/layout.tsx`)에서 렌더되고, 거기서 `auth_user_role()` RPC를 부른다(현 스톱갭). [Source: web/src/app/(staff)/layout.tsx:9-15] → 같은 자리에서 권한도 fetch해 Context로 내리면 **첫 페인트부터 정확**(권한 깜빡임·메뉴 플리커 없음).
- architecture는 "usePermissions=TanStack Query 캐시"를 제안하나, **TanStack Query 미설치**이고 권한은 세션 단위 준-정적이다. 새 의존성 추가는 project-context "새 라이브러리 임의 추가 금지" 정신에 반한다. → **RSC fetch + Context가 더 적합.** 이 변이(variance)는 §Project Structure Notes에 기록.
- 1.7(관리자 권한 토글 즉시 반영)에서 동적 무효화가 필요해지면 그때 TanStack Query 도입 검토(후속). 1.6 범위에선 `router.refresh()`/재로그인으로 충분.

---

### 🧭 역할별 사이드바 메뉴 맵 (UX-DR24 사이트맵 → 구현 데이터)

**모델:** `NavItem = { label, icon(Lucide), href, roles: Role[], requiredPermission?: string }`
**렌더 규칙:** `item.roles.includes(currentRole)` **AND** (`!item.requiredPermission || has(item.requiredPermission)`).
- `roles` = IA 가시성(역할이 자기 워크플로우 메뉴를 봄 — 권한 0이어도). `requiredPermission` = **관리/민감 항목에만** 부여하는 추가 게이트(1.7에서 권한 토글 시 동적 출현/소멸). 이 혼합이 UX-DR4 의도("신규 직원이 자기 일에 집중")와 데모 가능성을 모두 충족.

| 역할(role.code) | 홈(랜딩) | 섹션·메뉴 항목(label) | href(앱-내) | requiredPermission |
|---|---|---|---|---|
| `reception` | `/home`* | **운영**: 대기 현황 | `/reception/waiting` | — |
| | | 접수 | `/reception/intake` | — |
| | | 예약 관리 | `/reception/schedule` | — |
| | | **환자**: 환자 등록 | `/reception/register` | `patient.create` |
| | | 환자 검색 | `/reception/search` | `patient.read` |
| | | **정산**: 수납 | `/reception/billing` | `payment.process` |
| | | 문서 출력 | `/reception/documents` | — |
| `doctor` | `/home`* | **진료**: 진료 대기 | `/doctor/waiting` | — |
| | | 판독 | `/doctor/radiology` | — |
| | | **환자**: 환자 검색 | `/doctor/search` | `patient.read` |
| `nurse` | `/home`* | **진료**: 처치 워크리스트 | `/nurse/worklist` | — |
| | | 활력징후 입력 | `/nurse/vitals` | `vital.record` |
| | | 간호기록 | `/nurse/notes` | — |
| `radiologist` | `/home`* | **영상**: 촬영 워크리스트 | `/radiology/worklist` | — |
| | | 영상 업로드 | `/radiology/upload` | — |
| | | 장비 관리 | `/radiology/equipment` | — |
| `admin` | `/home`* | **관리**: 운영/대시보드 | `/admin/dashboard` | `dashboard.read` |
| | | 마스터 | `/admin/masters` | `master.manage` |
| | | 권한 | `/admin/permissions` | `rbac.manage` |
| | | 근무 스케줄 | `/admin/schedule` | — |
| | | 직원 계정 | `/admin/users` | `user.manage` |
| | | 감사 로그 | `/admin/audit-logs` | `audit.read` |
| (전 직원) | | **푸터**: 설정 · 도움말 | `/settings` · `/help` | — |

\* **랜딩 경로 주의:** 현재 직원 공통 랜딩은 `/home`(`STAFF_HOME`)이고 역할별 홈(`/reception` 등)은 **아직 없다**(Epic 4+가 채움). [Source: web/src/lib/auth/branch.ts:6, web/src/app/(staff)/home/page.tsx:4] → 위 표의 역할별 라우트는 **메뉴 정의(자리)** 이며, 클릭 시 404가 정상이다. 1.6은 메뉴 구조·게이트만 책임진다. `landingPathForRole`은 현행(`/home`) 유지(역할별 랜딩 변경은 Epic 4의 몫).
[Source: UX 산출물 EXPERIENCE.md(6역할 사이트맵), epics.md:184(UX-DR4)·204(UX-DR24)]

**아이콘:** Lucide(`lucide-react`). 기존 사이드바가 쓰는 아이콘 재사용(`LayoutDashboard`·`UserPlus`·`CalendarDays`·`UserRoundPlus`·`Search`·`Wallet`·`Printer`·`Settings`·`CircleHelp`) + 필요한 추가 아이콘. [Source: web/src/components/shell/sidebar.tsx:1-12]

---

### 🚦 미들웨어(proxy) vs 레이아웃 가드 — 역할 분담

| 가드 | 위치 | 책임 | 현 상태 |
|---|---|---|---|
| **인증 경계** | `proxy.ts`/`updateSession` | 미인증→`/login`, 인증+로그인경로→`/`. 세션 쿠키 갱신. | ✅ 구현됨 — **유지·무회귀** [Source: proxy.ts:56-61] |
| **영역(staff/patient) 가드** | route group 레이아웃 | 비직원 (staff)→`/portal`, 직원 (patient)→`/home` | ✅ 스톱갭 존재 → **정식 가드로 유지** [Source: (staff)/layout.tsx:12-14, (patient)/portal/page.tsx:12-14] |
| **권한별 라우트 가드** | `lib/auth/guards.ts` 유틸 | `requirePermission(code)` 서버 가드 → 미보유 안전 경로 redirect | 🆕 1.6이 **유틸+패턴** 제공(소비는 1.7 admin) |

⚠️ **proxy에 역할/권한 가드를 넣지 말 것.** 역할은 토큰에 없고 DB RPC(`auth_user_role`)가 필요하다 — 매 요청 RPC는 비용. route group 레이아웃(RSC, 진입 시 1회)이 적합. [Source: api/app/core/security.py:7-9(토큰엔 RBAC 역할 없음), 0003:8-21]

---

### 🔒 권한 밖 액션 패턴 (AC3 상세)

`PermissionGate` 미보유 시 렌더(UX-DR8·18·20):
```
<button type="button" aria-disabled="true" aria-describedby="reason-xyz">
  <Lock aria-hidden /> {라벨}
</button>
<span id="reason-xyz" class="text-muted-foreground text-[12px]">
  이 작업은 '{권한 한글명}' 권한이 필요합니다
</span>
```
- ⚠️ `disabled` 속성이 **아니다** — `aria-disabled`로 **포커스 가능**하게(스크린리더 낭독·키보드 도달 → 학습). [Source: epics.md:188(UX-DR8), 200(UX-DR20)]
- 색만/툴팁만 금지 → 잠금 글리프(색) + 한국어 사유 텍스트(상시 가시) 중복 인코딩. hover 툴팁 단독 금지. [Source: epics.md:198(UX-DR18 403)]
- 권한 한글명은 `permissions.name`(예: `rbac.manage`→"권한 매트릭스 관리"). [Source: 0002:105]

---

### 📂 파일 구조 — 신규/수정 (정확 경로)

**신규(NEW):**
- `web/src/lib/env.ts` — env Zod 검증 (Task 1)
- `web/src/lib/auth/permissions.ts` — `fetchUserPermissions` (Task 2)
- `web/src/lib/auth/guards.ts` — `requireStaff`/`requirePermission` 서버 가드 (Task 5)
- `web/src/lib/nav/staff-nav.ts` — 역할별 내비 설정 + `filterNav` (Task 6)
- `web/src/components/auth/permissions-provider.tsx` — Context Provider (Task 3)
- `web/src/components/auth/permission-gate.tsx` — 권한 밖 액션 (Task 8)
- `web/src/hooks/use-permissions.ts` — `usePermissions` 훅 (Task 3) `[hooks 폴더 신설]`
- 위 각 파일의 co-located `*.test.ts(x)`

**수정(UPDATE) — 현 동작 보존 필수:**
- `web/src/app/(staff)/layout.tsx` — 권한 fetch + Provider 배선(역할 가드 보존) [현재: 스톱갭 역할 가드만]
- `web/src/components/shell/sidebar.tsx` — 정적→동적 필터, `<button>`→`<Link>`, 사용자/역할 Context화 [현재: 원무 7항목 하드코딩·do-nothing button]
- `web/src/components/shell/app-shell.tsx` — (필요 시) Provider 소비 경로. 가급적 layout에서 감싸 변경 최소화 [현재: 정적 셸]
- `web/src/lib/supabase/{client,server,proxy}.ts` — `env` 사용으로 교체 [현재: `process.env...!`]
- `web/src/app/(staff)/home/page.tsx` — AC3 데모 액션 1개 배치 [현재: 랜딩 placeholder]
- `docs/glossary.md` — 신규 식별자 등재

**디렉토리 규약:** `web/src/{app/(staff|patient), components/ui, components/<feature>, lib, hooks, types}`. [Source: docs/project-context.md:72, architecture.md §디렉토리]

---

### Project Structure Notes

- **정렬:** 신규 파일이 모두 규약 디렉토리(`lib/`·`hooks/`·`components/auth/`)에 들어간다. `hooks/`는 신설(첫 훅). `lib/nav/`·`lib/auth/`는 기존 `lib/` 하위 기능 폴더.
- **변이(variance) 1 — 권한 상태 보관:** architecture의 "usePermissions=TanStack Query"를 따르지 않고 **RSC fetch + React Context**로 구현. 근거: TanStack Query 미설치 + 권한은 세션 준-정적 + 셸이 RSC라 첫 페인트 정확성·플리커 제거. 1.7 동적 무효화 시 재평가. (§상태/Provider 결정)
- **변이 2 — 권한 조회 방식:** 전체 권한 목록 RPC 대신 0003이 깔아둔 SELECT 정책으로 **직접 조회**. 근거: 0003:53 아키텍트 의도 + 마이그레이션 무추가(스코프 최소). (§권한 데이터 소스 결정)
- **충돌 없음:** proxy/layout 가드 분담은 현 스톱갭 구조의 자연스러운 정식화. 기존 1.4 가드 흐름 무회귀.

---

### Previous Story Intelligence (1.2 / 1.4 / 1.5)

**1.2 (디자인 시스템·셸 골격)** [Source: 1-2-...md, web/src/components/shell/*]
- AppShell·Sidebar·Topbar는 **정적 골격**. Sidebar L23 주석이 명시: "RBAC 노출 게이트(usePermissions)·실제 라우트 연결은 Story 1.6." → **이 스토리가 그 자리를 채운다.**
- 활성 표시 패턴 확립: 좌측 3px teal 액센트 바(`before:`) + `text-primary-hover` + `bg-primary/10`. 카운트 pill `tabular-nums`. **이 스타일 유지**, 동적화만. [Source: sidebar.tsx:48-74]
- deferred(1.2): "내비 placeholder 시맨틱"(do-nothing `<button>`+비-링크 `aria-current`) → **1.6이 `<Link>`+`aria-current` 정합으로 해소**. "접힘 카운트 배지 소실"은 실데이터(Epic 4) 몫(무시). [Source: deferred-work.md:22-23]

**1.4 (분리 프로필 로그인)** [Source: 1-4-...md, web/src/lib/auth/branch.ts, (staff)/layout.tsx]
- `branch.ts` 확정: `STAFF_ROLES`(5역할), `isStaffRole()`, `landingPathForRole()`, `LOGIN_PATH`/`STAFF_HOME=/home`/`PATIENT_HOME=/portal`. **재사용**(중복 정의 금지). [Source: branch.ts:5-23]
- 로그인 후 분기: `auth_user_role()` RPC → `landingPathForRole`. RPC 실패 시 `/`로 안전 강등(추정 금지). **같은 패턴을 layout 권한 fetch에도 적용.** [Source: login-form.tsx:37-40]
- (staff)/layout 스톱갭·(patient)/portal 역가드 = 1.4 코드리뷰 결정(D-2). **1.6은 이를 정식 가드로 승계**(삭제·약화 금지). [Source: (staff)/layout.tsx:8, deferred-work.md(1.4)]
- deferred(1.4): **web `NEXT_PUBLIC_*` env fail-fast를 명시적으로 "1.6 미들웨어·UI 게이트"로 재이월** → **Task 1로 흡수.** [Source: deferred-work.md:12]

**1.5 (FastAPI 인증·RBAC)** [Source: 1-5-...md, api/app/core/security.py]
- 토큰엔 RBAC 역할/권한 **없음** — 항상 DB 룩업(`auth_user_role`/`has_permission`). 토큰 `role` 클레임은 Postgres 역할(`authenticated`)이지 RBAC 역할 아님. **클라도 동일 전제**(권한은 DB에서). [Source: security.py:7-9, 61]
- `require_permission(code)`→403, `get_current_staff`→비직원 403. **UI 게이트와 독립**으로 쓰기를 강제(방어심층). FastAPI `/auth/me`·`/auth/check`가 증명 엔드포인트. [Source: security.py:125-144, auth.py:43-62]
- TOCTOU/권한평가-쓰기 분리는 Epic 3+ 몫(1.6 무관). [Source: deferred-work.md:7]

---

### Git Intelligence (최근 작업 패턴)

```
dbd346a Story 1.5 산출물 + 코드리뷰 findings·deferred-work + done
e4921a0 test(api): 인증·RBAC 단위·통합 테스트 + dev 부트스트랩 doctor 계정
fd353f7 feat(api): FastAPI 인증·RBAC 강제 — JWKS·권한 의존성·에러 봉투
e4bc175 Story 1.4 코드리뷰 findings·deferred-work + done
af0391f fix(web): patient 분기·proxy 회복력/matcher·로그인 RPC·스톱갭 역할 가드·오류매핑
```
- **커밋 관습:** `type(scope): 한국어 요약`(의미 단위). 1.6은 `feat(web): ...`. **커밋·푸시는 사용자 승인 시에만.** [Source: docs/project-context.md:76]
- `af0391f`가 proxy matcher·스톱갭 역할 가드·오류매핑을 이미 손봤다 → 1.6은 그 위에 쌓되 **회귀 주의**(proxy matcher·redirect 회복력 보존).

---

### Latest Tech / 버전 확정 (web/package.json)

- `next 16.2.9`(⚠️ proxy.ts·async cookies — `node_modules/next/dist/docs/` 권위), `react 19.2.4`, `@supabase/ssr ^0.12.0`, `@supabase/supabase-js ^2.108.2`, `zod ^4.4.3`, `react-hook-form ^7.80.0`, `lucide-react ^1.21.0`, `sonner ^2.0.7`, `@base-ui/react ^1.6.0`(shadcn base-nova), `tailwindcss ^4`.
- **미설치:** `@tanstack/react-query`, `zustand` → 본 스토리는 **추가하지 않는다**(Context로 해결). [Source: web/package.json]
- 테스트: `vitest ^3.2.6` + `@testing-library/react` + `jsdom`. co-located `*.test.tsx` 패턴(기존 `login-form.test.tsx`·`branch.test.ts`). [Source: docs/project-context.md:63]
- Zod 4 사용 중 — env 스키마도 Zod 4 API로. (RHF resolver는 `@hookform/resolvers ^5`.)

---

### ✅ 검증 시나리오 (수기 셀프체크 — Task 10.3)

> 로컬: `supabase start` + `npm run dev`. dev 부트스트랩 계정은 1.5의 doctor 계정 존재(`e4921a0`). admin 계정으로 권한 보유 케이스 확인.

1. **미인증** → 임의 `(staff)` URL 접근 → `/login` 리다이렉트. (proxy, AC1)
2. **직원(admin) 로그인** → `/home` 랜딩 → 사이드바에 admin 섹션(권한·감사 등) 보임(권한 보유). (AC2)
3. **직원(예: doctor, 권한 0)** 로그인 → 사이드바에 doctor 역할 메뉴는 보이되, `requiredPermission` 지정 항목(없으면 전부)·관리 섹션은 **미렌더**(트리에서 제외). (AC2)
4. **비직원/세션 역할 null** → `(staff)` 접근 → `/portal`. 직원 → `/portal` 접근 → `/home`. (AC1, 무회귀)
5. **AC3 데모 액션**: 권한 없는 사용자가 `/home`의 잠긴 액션을 Tab으로 포커스 → 스크린리더가 한국어 사유 낭독, `aria-disabled` 확인, 잠금 글리프+텍스트 가시. (AC3)
6. **보안**: 빌드 번들에 `service_role`/`secret` 키 부재(클라 코드는 `publishable`만). env 누락 시 빌드/런타임 명확 에러(Task 1). (AC4)
7. 기존 `vitest` 스위트 전부 녹색(무회귀).

---

### References

- [Source: _bmad-output/planning-artifacts/epics.md:449-467] — Story 1.6 BDD 인수기준
- [Source: epics.md:161] — RBAC 3계층(UI/FastAPI/RLS), `has_permission`
- [Source: epics.md:184(UX-DR4)·188(UX-DR8)·198(UX-DR18)·200(UX-DR20)·204(UX-DR24)] — 셸·게이트·403·접근성·사이트맵
- [Source: docs/project-context.md:55-59] — Next.js·상태분리·FastAPI·실시간 규칙
- [Source: docs/project-context.md:82-84] — 보안 MUST·PII 경계
- [Source: supabase/migrations/0003_rls_helpers.sql:53-70] — 1.6 직접 조회용 authenticated SELECT 정책(아키텍트 의도)
- [Source: supabase/migrations/0002_identity_rbac.sql:73-114] — 6역할·23권한 카탈로그·admin 전권 부트스트랩
- [Source: api/app/core/security.py:7-9,35,125-144] — 토큰에 RBAC 역할 없음·STAFF_ROLES·require_permission/get_current_staff
- [Source: web/src/proxy.ts, web/src/lib/supabase/proxy.ts] — Next 16 proxy(미인증 가드·matcher·basePath redirect)
- [Source: web/src/app/(staff)/layout.tsx, web/src/app/(patient)/portal/page.tsx] — 영역 가드 스톱갭(정식화 대상)
- [Source: web/src/lib/auth/branch.ts] — STAFF_ROLES·isStaffRole·landingPathForRole(재사용)
- [Source: web/src/components/shell/sidebar.tsx:23] — "RBAC 노출 게이트·라우트 연결은 Story 1.6" 명시 자리
- [Source: web/src/lib/supabase/client.ts] — publishable 키만(클라 안전)
- [Source: web/next.config.ts] — basePath 빌드타임 전파
- [Source: web/AGENTS.md] — Next 16 breaking, node_modules/next/dist/docs 우선
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:12] — web env fail-fast 1.6 재이월
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:22-23] — 내비 시맨틱(Link·aria-current) 해소
- UX 산출물: `_bmad-output/planning-artifacts/ux-designs/ux-patient_management_system-2026-06-19/{DESIGN.md, EXPERIENCE.md}` (UX-DR4 셸·6역할 사이트맵·403 패턴)

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Opus 4.8, 1M context) — bmad-dev-story 워크플로우

### Debug Log References

- `npx vitest run` → **49 passed / 11 files** (신규 + 기존 회귀 포함, `login-form.test.tsx`·`branch.test.ts` 무회귀)
- `npx tsc --noEmit` → exit 0
- `npx eslint` → exit 0
- `npm run build` (Next 16 Turbopack) → exit 0. `/home`·`/portal`·`/` = ƒ Dynamic(cookies/RPC 사용), `/login` = ○ Static, Proxy(Middleware) 인식.
- zod 4 함정: 키 완전 누락 시 `z.string()` 타입 에러가 커스텀 메시지를 가림 → `parseEnv`에서 `issue.path`(변수명)를 메시지에 포함하도록 보정.

### Completion Notes List

- **권한 데이터 소스 = Supabase 직접 조회 채택**(권장안). `0003_rls_helpers.sql:53-65`가 깔아둔 `authenticated` SELECT 정책을 사용 — 새 마이그레이션·RPC **미추가**. 따라서 Task 9.2(RPC 채택 시 번호 정합)는 해당 없음(직접 조회라 DB 변경 0).
- **상태 보관 = 서버 fetch + React Context**. `(staff)/layout`(RSC)이 `requireStaff` → `fetchUserPermissions`로 권한을 읽어 `PermissionsProvider`로 제공. TanStack Query **미도입**(미설치 + 권한은 세션 준-정적, 첫 페인트 정확·플리커 0). architecture의 "usePermissions=TanStack Query"에 대한 의도된 변이(§Project Structure Notes).
- **사이드바 노출 모델 = 역할(IA) AND 권한(requiredPermission)**. 부트스트랩상 admin 외 역할은 권한 0개(0002) → 순수 권한 필터면 메뉴가 텅 빔. 역할로 워크플로우 메뉴를 노출하고, 관리/민감 항목만 `requiredPermission`으로 추가 게이트(1.7 토글로 동적). 권한 0 역할도 자기 무권한 항목은 본다.
- **미들웨어(proxy)는 인증 경계만 유지**(1.4 무회귀). 역할/영역 가드는 route group 레이아웃(`requireStaff`), 권한별 라우트 가드는 `requirePermission` 유틸(1.7 admin이 소비). proxy에 RPC 가드 미투입.
- **deferred-work 2건 해소**: ① web `NEXT_PUBLIC_*` env fail-fast(`lib/env.ts`, Zod, client/server/proxy가 소비) ② 내비 시맨틱(do-nothing `<button>`→`<Link>`, `aria-current` 정합).
- **Next 16 준수**: `proxy.ts`(미들웨어), `<Link className>`(자식 `<a>` 불필요), async `cookies()`, `usePathname`(basePath 제외 앱-내 경로). `experimental.authInterrupts`(`unauthorized()`/`forbidden()`)는 미도입 — 기존 `redirect()` 패턴이 더 단순·안정적이며 설계와 일관.
- **AC3 잠금 글리프**: 스펙의 ⊘를 lucide `Lock` 아이콘으로 구현(아이콘=색, 사유 텍스트=상시 가시, `aria-describedby` 연결, `aria-disabled`로 포커스 가능). `Lock`은 `aria-hidden`(의미는 텍스트가 전달).
- **데모(AC3 가시 검증)**: `(staff)/home`에 `rbac.manage` 게이트 1개 — 비-admin은 잠금+사유, admin은 진입 버튼. 과잉 구현 없음.
- **미적용(범위 밖, 의도)**: `vitest.config.ts`에 테스트용 공개 env 주입(env 모듈 안전 로드용). `app-shell.tsx`는 미수정(Provider는 layout에서 감쌈, Sidebar만 Context 소비).

### File List

**신규(NEW):**
- `web/src/lib/env.ts` · `web/src/lib/env.test.ts`
- `web/src/lib/auth/permissions.ts` · `web/src/lib/auth/permissions.test.ts`
- `web/src/lib/auth/guards.ts` · `web/src/lib/auth/guards.test.ts`
- `web/src/lib/nav/staff-nav.ts` · `web/src/lib/nav/staff-nav.test.ts`
- `web/src/components/auth/permissions-provider.tsx`
- `web/src/components/auth/permission-gate.tsx` · `web/src/components/auth/permission-gate.test.tsx`
- `web/src/hooks/use-permissions.ts` · `web/src/hooks/use-permissions.test.tsx`
- `web/src/components/shell/sidebar.test.tsx`

**수정(UPDATE):**
- `web/src/app/(staff)/layout.tsx` — `requireStaff` + 권한 fetch + `PermissionsProvider` 배선
- `web/src/components/shell/sidebar.tsx` — 정적 → 동적 필터(`filterNav`+`usePermissions`), `<Link>` 전환, 역할 표시
- `web/src/app/(staff)/home/page.tsx` — AC3 데모(`PermissionGate`)
- `web/src/lib/supabase/client.ts` · `server.ts` · `proxy.ts` — `env` 사용으로 교체(fail-fast)
- `web/vitest.config.ts` — 테스트용 공개 env 주입
- `docs/glossary.md` — web RBAC UI 게이트 식별자 등재

## Change Log

| 날짜 | 변경 | 비고 |
|---|---|---|
| 2026-06-20 | Story 1.6 구현 — RBAC UI 게이트(사이드바 동적 노출 + 권한 밖 액션 잠금) + 라우트 가드 + web env fail-fast | 49 tests·tsc·eslint·build 통과. Status → review |
| 2026-06-20 | 코드 리뷰(3-레이어 적대적, High 0) — decision 1(노출 모델: 직무=역할/민감·관리=권한 게이트, 비-admin 직무 항목 requiredPermission 제거) + patch 4(에러 로깅·useMemo 안정키·테스트 강화·미인증 LOGIN_PATH) 적용, defer 3 | 50 tests·tsc·eslint·build 통과. Status → done |
