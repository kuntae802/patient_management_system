---
baseline_commit: 65a489089c0226e7c18dc6bbea93716e3c5bf345
---

# Story 1.7: RBAC 권한 매트릭스 (관리자)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **관리자/원장**,
I want **역할별 권한을 매트릭스 화면에서 체크박스로 토글하기를**,
so that **코드 수정·재배포 없이 즉시 접근 정책을 바꿀 수 있다.**

> **에픽 맥락:** Epic 1 = 플랫폼 기반·신원·접근 통제. 이 스토리는 **RBAC 3계층의 "관리(쓰기) 표면"** 을 세운다 — 1.6이 권한을 *읽어* UI를 게이트했다면, 1.7은 관리자가 권한 grant를 *쓴다*. 이것이 **web→FastAPI 최초의 인증 쓰기 호출**이며, 동시에 첫 도메인 명령 엔드포인트다. 토글 1회 = `role_permissions` INSERT(grant)/DELETE(revoke) 1건이고, **0004 감사 트리거가 변경을 자동 기록**한다(FastAPI가 actor를 주입할 때만 정확). 부트스트랩상 admin만 전권을 갖고 나머지 4역할은 권한 0개(0002)이므로, **이 화면이 켜져야 비로소 타 역할이 기능 접근을 얻는다** — 후속 에픽 데모의 전제.

---

## Acceptance Criteria

> 출처: `_bmad-output/planning-artifacts/epics.md:469-489` (Story 1.7 BDD) · `epics.md:196`(UX-DR16) · `epics.md:199-200`(UX-DR19·20) · `epics.md:109,268`(FR-211).

**AC1 — 매트릭스 표시(읽기·시각 인코딩)**
- **Given** `rbac.manage` 권한을 가진 관리자가 `/admin/permissions`에서
- **When** 권한 매트릭스를 열면
- **Then** **행=권한(DB `permissions` 카탈로그 전수, `resource`별 그룹 헤더) × 열=직원 5역할**(reception·doctor·nurse·radiologist·admin; **`patient` 역할 제외**)이 렌더되고, 허용=**teal 채움+✓ 글리프**, 차단=**빈 셀**, **admin 열=고정(🔒, 전체 허용·변경 불가)** 으로 표시된다. 스티키 헤더·스티키 첫 열, 음영/틴트 단독 의존 금지(모니터-강건 색+글리프). (UX-DR16)

**AC2 — 비민감 권한 즉시 토글 + 자동 감사**
- **Given** 비민감 권한 셀(admin 열 제외)에서
- **When** 토글하면
- **Then** **저장 버튼 없이 즉시 적용**(FastAPI `PUT` 호출 → `role_permissions` grant/revoke)되고, autosave 인디케이터("변경사항 자동 저장됨 · {시각}", aria-live polite)가 갱신되며, **변경이 감사 로그에 자동 기록**된다(0004 트리거, actor=관리자). 실패 시 셀 상태가 롤백되고 한국어 오류가 안내된다. (FR-211)

**AC3 — 민감 권한 토글 = 확인 단계 필수**
- **Given** 민감 권한(현 카탈로그: **주민번호 열람 `patient.reveal_rrn` · 권한 매트릭스 관리 `rbac.manage` · 감사 로그 조회 `audit.read`**)에서
- **When** 토글하면
- **Then** **권한명 + 대상 역할을 명시한 확인 다이얼로그**를 거친 뒤에만 적용·감사된다. ⚠"민감" pill(색+라벨)만으로는 게이트가 아니며, 다이얼로그 취소 시 변경되지 않는다. 다이얼로그는 포커스 트랩·초기 포커스·닫을 때 포커스 복원을 지킨다. (UX-DR16·UX-DR19)

**AC4 — 시맨틱·키보드·접근성**
- **Given** 매트릭스가 렌더될 때
- **When** 키보드·스크린리더로 조작하면
- **Then** `<table>` + `<th scope>`(행·열 헤더 연결, 셀 접근가능명 = **"{역할} — {권한} — 허용/차단"**)이고, **2D 화살표 키 모델(roving-tabindex, Tab 순회 금지)** 로 셀 간 이동하며, admin 열 셀은 "고정 — 변경 불가"로 낭독된다. `:focus-visible` 포커스 링 상시. (UX-DR19·UX-DR20)

**AC5 — 보안 경계(쓰기 권위) 횡단**
- **Given** 토글 쓰기가 일어날 때
- **When** 권한·대상이 검증되면
- **Then** 쓰기는 **반드시 FastAPI(service_role) 경유**로만 수행되고(클라/authenticated 직접 쓰기 불가 — 0002가 authenticated에 SELECT만 grant), 엔드포인트는 `require_permission('rbac.manage')`로 403 게이트하며, **권한평가와 쓰기를 동일 트랜잭션**에서 수행한다(TOCTOU 차단). **admin 역할 대상 grant/revoke는 서버가 거부**(409, 자가-락아웃 방지). `service_role`/`secret` 키는 클라 번들에 절대 없다.

---

## Tasks / Subtasks

> ⚠️ **착수 전 필독 (순서대로):**
> 1. `docs/project-context.md` 전 규칙 — 특히 §Framework-Specific Rules(상태 분리·쓰기=FastAPI/조회=Supabase), §Critical Don't-Miss Rules(service_role 클라 노출 금지·PII).
> 2. `web/AGENTS.md` — **"This is NOT the Next.js you know."** Next 16은 훈련데이터와 다르다. 클라 코드 전 `web/node_modules/next/dist/docs/`의 해당 가이드(async `cookies()`·`Link`) 확인. 임의 추정 금지.
> 3. 본 스토리 §Dev Notes 전체 — 특히 "매트릭스 데이터 진실"·"FastAPI 쓰기 엔드포인트"·"web→FastAPI 최초 호출".

- [x] **Task 1 — FastAPI: RBAC grant 쓰기 엔드포인트 (`api/app/api/v1/admin.py`)** (AC: 2, 3, 5)
  - [x] 1.1 `api/app/api/v1/admin.py` 신설: `router = APIRouter(prefix="/admin", tags=["admin"])`. `PUT /admin/rbac/grants` 엔드포인트. 의존성 = `require_permission("rbac.manage")`(모듈 로드 시 1회 생성). 외부 경로 = `/patient_management_system/api/v1/admin/rbac/grants`. [Source: §FastAPI 쓰기 엔드포인트]
  - [x] 1.2 요청 Pydantic 모델 `GrantUpdate { role_code: str, permission_code: str, granted: bool }`(snake_case). 응답 `GrantResult { role_code, permission_code, granted, changed: bool }`.
  - [x] 1.3 `api/app/api/v1/router.py`에 `admin.router` include 추가(`from app.api.v1 import admin` + `api_router.include_router(admin.router)`).
  - [x] 1.4 검증/거부 규칙: `role_code == 'admin'` → **409 `role_locked`**(custom 한국어 메시지, 자가-락아웃 방지); `role_code == 'patient'` → 422 `invalid_target`(매트릭스 역할 아님); 미존재 role_code/permission_code → 404 `not_found`. 에러는 전부 `AppError` 서브클래스/`AppError(...)`로 봉투 통일. [Source: §FastAPI 쓰기 엔드포인트, errors.py]

- [x] **Task 2 — DB 접근: 동일 트랜잭션 권한평가+쓰기 (`api/app/core/db.py`)** (AC: 2, 5)
  - [x] 2.1 `set_role_permission(sub, role_code, permission_code, *, granted) -> bool` 추가. `authenticated_conn(sub)`(GUC 주입 트랜잭션) **하나 안에서**(`_run_authed` 재사용): ① `has_permission('rbac.manage')` 재평가 → False면 `ForbiddenError`(TOCTOU 차단, deferred 1.5 해소); ② admin/patient 가드(`role_locked` 409 / `invalid_target` 422); ③ role_code/permission_code → id 해석(미존재 → `NotFoundError`); ④ `granted` → `INSERT ... ON CONFLICT (role_id, permission_id) DO NOTHING` / not granted → `DELETE`. 반환 = 실제 변경 여부(`status.split()[-1] > 0`). [Source: db.py:68-84 authenticated_conn, deferred-work.md:13]
  - [x] 2.2 INSERT/DELETE는 0004 `trg_role_permissions_audit`가 자동 감사 → **앱은 감사 INSERT를 직접 하지 않는다**(actor는 `app.actor_id`로 이미 주입됨). [Source: 0004:126-128, db.py:83]
  - [x] 2.3 DB 장애는 기존 `_run_authed` 매핑(503)과 일관 — 단일 op 콜백을 `_run_authed`로 실행(권한평가+쓰기 동일 트랜잭션). AppError(403/404/409/422)는 `_run_authed`가 잡지 않아 그대로 봉투로 전파. [Source: db.py:33-34,87-97]

- [x] **Task 3 — FastAPI 테스트 (단위 + 통합)** (AC: 2, 3, 5)
  - [x] 3.1 단위 `api/tests/test_admin_rbac.py`: `dependency_overrides[get_current_user]` + `monkeypatch db.set_role_permission`/`db.fetch_has_permission`로 분기 격리 — 200(grant/revoke·멱등 changed false), 403(비 rbac.manage), 409(admin), 422(patient·body 누락), 404(미존재 코드). [Source: test_rbac_permission.py 패턴]
  - [x] 3.2 통합 `api/tests/test_admin_rbac_integration.py`(로컬 스택 없으면 skip): admin 토큰으로 `reception`에 `patient.read` grant→changed true→재호출 changed false→`role_permissions` 행·`audit_logs` create(actor=admin EMP0001) psql 검증→revoke 복원·audit delete. admin→409, patient→422, 미존재→404, doctor→403. **로컬 스택 가동 상태로 실제 통과 확인.** [Source: test_auth_integration.py 패턴, conftest psql fixture]

- [x] **Task 4 — web→FastAPI 인증 클라이언트 (`web/src/lib/api/client.ts`)** (AC: 2, 5) `[web 최초의 백엔드 호출 인프라]`
  - [x] 4.1 `web/src/lib/env.ts`에 `NEXT_PUBLIC_API_BASE_URL`(z.url) 추가 + `.env.example`/`.env.local`에 등재(dev=`http://localhost:8000`). `vitest.config.ts`의 테스트용 공개 env에도 주입. [Source: §web→FastAPI 최초 호출, env.ts]
  - [x] 4.2 `web/src/lib/api/client.ts` 신설: `apiFetch<T>(path, init)` — 브라우저 supabase 클라 `getSession()`의 `access_token`을 `Authorization: Bearer`로 첨부, `${env.NEXT_PUBLIC_API_BASE_URL}${path}` 호출, `{error:{code,message,detail}}` 봉투 파싱→실패 시 `ApiError(code,message,status,detail)`. 세션 부재→`no_session`, 네트워크 실패→`network_error`. [Source: §web→FastAPI 최초 호출, supabase/client.ts]
  - [x] 4.3 단위 테스트 `client.test.ts`: 성공 JSON·Bearer·절대 URL, 세션 부재(401), 봉투 파싱(409 role_locked), 네트워크 실패. fetch·getSession `vi.fn` mock.

- [x] **Task 5 — 매트릭스 데이터 fetch + RSC 가드 페이지** (AC: 1, 5)
  - [x] 5.1 `web/src/lib/auth/rbac-matrix.ts` 신설: `fetchPermissionMatrix(supabase)` — Supabase **직접 조회**(authenticated SELECT, 0003)로 `roles`(patient 제외, MATRIX_ROLE_ORDER)·`permissions`(전수, resource→code 정렬)·`role_permissions`(roles/permissions 코드 임베드) → `{ roles, permissions, grants: string[] }`. 코드 snake_case 유지. 타입·`SENSITIVE_PERMISSIONS`·`RESOURCE_LABELS`·`grantKey`·`resourceLabel` 동거. [Source: §매트릭스 데이터 진실, 0003:55-65]
  - [x] 5.2 `web/src/app/(staff)/admin/permissions/page.tsx`(RSC) 신설: `requirePermission('rbac.manage', STAFF_HOME)` 가드 → `fetchPermissionMatrix()` → `<PermissionMatrix initial={...}>`. 빌드 시 `ƒ /admin/permissions` 동적 라우트 확인. [Source: guards.ts, deferred-work.md:9]
  - [x] 5.3 `requirePermission` fallback/staff 정책을 §Dev Notes·glossary에 명문화(부모 layout이 staff 보장 → fallback=STAFF_HOME, staff 재확인 불요).

- [x] **Task 6 — 권한 매트릭스 컴포넌트 (`components/admin/permission-matrix.tsx`)** (AC: 1, 2, 4)
  - [x] 6.1 `"use client"` 컴포넌트: initial props로 grants `Set` 로컬 보관(useState). **시맨틱 `<table>`** + `<thead>`(역할 `<th scope="col">`) + `resource` 변경 시 그룹 헤더 행 + 권한 행(첫 셀 `<th scope="row">`=권한명). 스티키 헤더(`sticky top-0`)·첫 열(`sticky left-0`) 토큰 기반 재현. [Source: mockups/key-rbac-matrix.html, §매트릭스 UI]
  - [x] 6.2 체크박스 셀=네이티브 `<button>`: 허용=`bg-primary`+✓, 차단=빈 박스, admin=`bg-primary/60`+`Lock`+`cursor-not-allowed`. 접근가능명 `aria-label="{역할} — {권한} — 허용/차단/고정·변경불가"`, 비-admin `aria-pressed`, admin/in-flight `aria-disabled`. [Source: UX-DR16·20]
  - [x] 6.3 `RESOURCE_LABELS`로 그룹 헤더 라벨·카운트. 권한 행 라벨=`permissions.name`(DB 한글). 열 헤더에 역할별 grant 수.
  - [x] 6.4 민감 권한 행에 ⚠"민감" pill(status-received 앰버+라벨)+좌측 인셋 액센트. `SENSITIVE_PERMISSIONS`(현 3종) 소비. [Source: §매트릭스 데이터 진실]
  - [x] 6.5 컴포넌트 테스트: 5열(patient 제외)·그룹 헤더·admin 열 lock(aria-disabled)·민감 pill·접근가능명.

- [x] **Task 7 — 토글 동작: 즉시 적용 · 낙관적 갱신 · 롤백 · 민감 확인** (AC: 2, 3)
  - [x] 7.1 셀 핸들러: ① 민감 권한이면 `ConfirmDialog` 오픈(권한명+대상 역할 명시), 취소 시 중단; ② 낙관적 grants 갱신 + 셀 in-flight `pending`(이중 제출 방지); ③ `apiFetch('/v1/admin/rbac/grants', PUT {role_code,permission_code,granted})`; ④ 성공→autosave(aria-live polite "변경사항 자동 저장됨 · {시각}"); ⑤ 실패→롤백 + sonner 오류 토스트(봉투 한국어 message). [Source: §매트릭스 UI, sonner.tsx]
  - [x] 7.2 확인 다이얼로그 `components/admin/confirm-dialog.tsx`: **base-ui `AlertDialog`**(포커스 트랩·복원·Esc 내장), 버튼 [취소, 부여/회수] 순(안전 기본 포커스), 1단계 모달. 카피 행동 지향("'{권한명}' 권한을 '{역할명}'에 부여/회수하시겠습니까?…"). [Source: EXPERIENCE.md:69, UX-DR19]
  - [x] 7.3 컴포넌트 테스트: 비민감 즉시 호출(body 검증), 민감=다이얼로그 경유 후 호출, 실패 시 롤백+토스트.

- [x] **Task 8 — 2D 화살표 키보드 모델(roving-tabindex)** (AC: 4)
  - [x] 8.1 셀 roving-tabindex: `focusPos` 1개 셀만 `tabIndex=0`, 나머지 `-1`. `Arrow*`로 2D 이동(`cellRefs` 격자 focus), `Home/End`=행 양끝. Tab은 매트릭스 1회 진입/이탈(전 셀 Tab 순회 없음). admin 열 셀도 포커스 도달·"고정 변경 불가" 낭독, 토글 비활성. `onFocus`로 roving 동기화. [Source: UX-DR19, epics.md:489]
  - [x] 8.2 `:focus-visible` 포커스 링(`focus-visible:outline-ring`) 상시. (키보드 활성화는 네이티브 button click=Enter/Space.)

- [x] **Task 9 — 글로서리·문서 정합** (AC: 횡단)
  - [x] 9.1 `docs/glossary.md`에 신규 식별자 등재: `set_role_permission`·`PUT /v1/admin/rbac/grants`(api), `apiFetch`/`ApiError`·`fetchPermissionMatrix`·`PermissionMatrix`·`ConfirmDialog`·`SENSITIVE_PERMISSIONS`/`RESOURCE_LABELS`/`MATRIX_ROLE_ORDER`(web), `NEXT_PUBLIC_API_BASE_URL`(env). resource→한글 맵·읽기/쓰기 권위 메모.
  - [x] 9.2 `requirePermission` fallback/staff 정책 확정 메모(deferred-work.md:9 해소): `(staff)` 하위 admin 라우트는 부모 layout이 staff 보장 → fallback=`STAFF_HOME`, staff 재확인 불요.

- [x] **Task 10 — 회귀·통합 검증** (AC: 전체)
  - [x] 10.1 무회귀: 1.5 인증/권한(`test_auth_integration.py`·`test_rbac_permission.py`)·1.6 web(사이드바·게이트·env·permissions) 전부 녹색. 사이드바 "권한"→`/admin/permissions`(staff-nav.ts:81 `rbac.manage` 게이트) 빌드 등록 확인.
  - [x] 10.2 `api`: `uv run ruff check`(클린) + `uv run pytest`(**61 passed**). `web`: `eslint`(0) + `tsc --noEmit`(0) + `vitest`(**63 passed**) + `next build`(성공, `ƒ /admin/permissions`).
  - [x] 10.3 통합 테스트가 셀프 검증 시나리오를 실 스택으로 자동 수행(grant→changed→멱등→audit create actor=admin→revoke→audit delete). 로컬 Supabase 가동 상태로 실제 통과.

### Review Findings (코드 리뷰 2026-06-20)

> Blind Hunter · Edge Case Hunter · Acceptance Auditor 3개 병렬 적대적 리뷰. **하드 AC 위반 0.** 0 decision-needed · 4 patch · 2 defer · 9 dismissed. 신규 `apiFetch` 인프라(후속 에픽 재사용)·매트릭스 데이터 fetch 견고화에 집중.

**Patch (수정 완료 2026-06-20):**
- [x] [Review][Patch] `fetchPermissionMatrix`가 3개 쿼리의 `error`를 버려 transient/RLS 실패 시 빈 매트릭스(전부 '차단')를 진실처럼 렌더 — `permissions.ts` 선례처럼 fail-closed(에러 surface). 관리자가 거짓 '전부 차단'을 보고 재grant 위험 [web/src/lib/auth/rbac-matrix.ts:fetchPermissionMatrix] **해결: 각 쿼리 `error` 검사→첫 에러 시 throw(RSC fail-loud). 테스트 추가(`rbac-matrix.test.ts`).**
- [x] [Review][Patch] `apiFetch` 헤더 정규화 — `...init?.headers`가 마지막 스프레드라 호출자가 `Authorization`을 덮어쓸 수 있고 `Headers`/튜플배열 형태 시 `Content-Type`/`Authorization` 소실. `new Headers()`로 정규화 후 auth를 마지막에 set [web/src/lib/api/client.ts] **해결: `new Headers(init?.headers)` 흡수 후 Authorization 마지막 set·Content-Type 미지정 시만. 테스트 추가(덮어쓰기 불가).**
- [x] [Review][Patch] `apiFetch` 비-봉투/비-JSON 에러 응답이 `code:"error"`+범용 메시지로 뭉개짐 — prod nginx 502/504 HTML 등. 봉투 부재 시 `code=http_<status>`로 진단성 부여 [web/src/lib/api/client.ts] **해결: `code ?? \`http_${status}\``. 테스트 추가(http_502).**
- [x] [Review][Patch] 이중 제출 가드(`pending.has(key)`)가 렌더 스냅샷 상태에 의존 → 빠른 더블클릭이 재렌더 전 둘 다 통과(가드 무력). `useRef<Set>` 기반 동기 in-flight 가드로 교체(시각 `pending` 상태는 유지) [web/src/components/admin/permission-matrix.tsx:applyToggle] **해결: `inFlight = useRef<Set>` 동기 가드 추가, `pending` 상태는 렌더용으로 유지.**

**Defer:**
- [x] [Review][Defer] `apiFetch`가 빈/204 본문에 `null`을 `T`로 반환 — 현 엔드포인트는 항상 본문 반환·현 호출부는 결과 미사용이라 무영향. 미래 204/빈본문 엔드포인트 계약 정의 시 확정 [web/src/lib/api/client.ts] — deferred, 잠재
- [x] [Review][Defer] `web/.env.example`가 `.gitignore`로 미추적(1.1 선재) — 신규 `NEXT_PUBLIC_API_BASE_URL`을 디스크 예시엔 추가했으나 템플릿이 버전관리에 없어 신규 기여자에 전파 안 됨. `.gitignore`에 `!.env.example` 네거티브 추가 검토 [web/.gitignore] — deferred, pre-existing

**Dismissed (노이즈·오탐·타처리, 9건):** ① 단위테스트 `db.fetch_has_permission` mock 대상 불일치 주장 → 오탐(`security.py:129`가 실제 그 경로) ② `status.split()[-1]` 파싱 취약 → 고정 INSERT/DELETE는 asyncpg가 항상 숫자 tail 반환(미발화) ③ 확인 다이얼로그 stale `next` → 모달 백드롭이 배후 상호작용 차단 ④ AC3 포커스 복원 미구현 주장 → base-ui `restoreFocus`/`finalFocus` 기본이 직전 포커스(셀)로 복원 ⑤ `changed:false` 시 낙관적 드리프트 → PUT-to-desired-state 의도 ⑥ 실패 후 `savedAt` 잔존 → 토스트가 실패 전달·`savedAt`은 마지막 성공 시각으로 정확 ⑦ `ApiError` status:0/code "error" 매직값 → 분기 소비처 없음(의도된 sentinel) ⑧ 빈 매트릭스 키보드 도달불가 → 0002가 항상 23권한·5역할 시드(퇴화 상태) ⑨ `MATRIX_ROLE_ORDER` 외 역할 드롭 → 문서화된 의도(patient 제외·신규 역할은 명시 추가)

---

## Dev Notes

### 🎯 이 스토리의 본질 (한 줄)
관리자가 **역할×권한 매트릭스**에서 체크박스를 토글 → **web가 FastAPI로 인증 쓰기 호출**(최초) → FastAPI가 동일 트랜잭션에서 권한 재평가 후 `role_permissions`를 grant/revoke → **0004 트리거가 자동 감사**. 읽기는 Supabase 직접(1.6 패턴), 쓰기는 FastAPI(service_role) 권위. admin 열은 잠금(자가-락아웃 방지).

---

### 🧬 매트릭스 데이터 진실 (반드시 데이터 구동 — 하드코딩 금지)

⚠️ **"6도메인 22개"는 illustrative 수치다.** UX-DR16·EXPERIENCE.md·목업은 22개/6그룹으로 그렸으나, **실제 DB 카탈로그(0002 시드)는 23개 권한 / 15개 resource**다. 매트릭스는 **`permissions` 테이블이 반환하는 것을 그대로 렌더**한다(미래 에픽이 카탈로그를 확장하면 자동 반영). 목업의 권한 이름("환자 등록/수정" 병합·"수가 조회"·"수가 조정"·"환자 삭제")을 복제하지 말 것 — 그중 일부(`patient.delete`·수가 조정)는 **아직 카탈로그에 없다**.

**열 = 직원 5역할** (표시 순서 고정, `patient` 제외):

| 순서 | role.code | role.name(한글) |
|---|---|---|
| 1 | `reception` | 원무과 |
| 2 | `doctor` | 의사 |
| 3 | `nurse` | 간호사 |
| 4 | `radiologist` | 방사선사 |
| 5 | `admin` | 관리자 **(🔒 고정)** |

> `patient` 역할은 매트릭스에서 제외(환자 권한은 포털 RLS 스코프이지 직무 RBAC 매트릭스가 아님). web `fetchPermissionMatrix`가 `code != 'patient'`로 필터.

**행 = 권한 23개, `resource`별 그룹.** `resource → 한글 도메인 라벨` 맵(그룹 헤더용, UI 라벨이므로 프론트 상수 — "한국어는 UI 라벨" 규칙):

| resource | 한글 도메인 | 권한 수 | 권한 코드(=`permissions.name`) |
|---|---|---|---|
| `patient` | 환자 | 4 | patient.read(환자 조회)·patient.create(환자 등록)·patient.update(환자 정보 수정)·**patient.reveal_rrn(주민번호 열람)🔶** |
| `encounter` | 내원/접수 | 3 | encounter.register(접수)·encounter.start(진찰 시작)·encounter.complete(내원 완료) |
| `medical_record` | 진료기록 | 1 | medical_record.write(진료기록 작성) |
| `diagnosis` | 진단 | 1 | diagnosis.attach(진단 부착) |
| `prescription` | 처방 | 1 | prescription.create(처방 발행) |
| `examination` | 검사·영상 | 1 | examination.order(검사·영상 오더) |
| `treatment` | 처치 | 2 | treatment.order(처치 오더)·treatment.perform(처치 수행) |
| `vital` | 활력징후 | 1 | vital.record(활력징후 기록) |
| `appointment` | 예약 | 3 | appointment.read(예약 조회)·appointment.create(예약 생성)·appointment.cancel(예약 취소) |
| `payment` | 수납 | 1 | payment.process(수납 처리) |
| `master` | 마스터 | 1 | master.manage(마스터 관리) |
| `dashboard` | 대시보드 | 1 | dashboard.read(운영 대시보드 조회) |
| `user` | 직원 계정 | 1 | user.manage(직원 계정 관리) |
| `rbac` | 권한 | 1 | **rbac.manage(권한 매트릭스 관리)🔶** |
| `audit` | 감사 | 1 | **audit.read(감사 로그 조회)🔶** |

> 🔶 = **민감 권한**(현 카탈로그). `SENSITIVE_PERMISSIONS = new Set(['patient.reveal_rrn','rbac.manage','audit.read'])` — 프론트 상수, **확장 가능**(미래 `patient.delete`·수가 조정·`user.manage`가 온라인되면 추가). AC3의 "환자 삭제·수가 조정"은 아직 코드 부재라 현 매트릭스에 미표시. **그룹 헤더 라벨은 `resource`로 매핑하되, 권한 행 라벨은 `permissions.name`(DB 한글)을 신뢰**(맵 누락 resource는 resource 코드 폴백).

**부트스트랩 현실:** 0002가 **admin에게만 23권한 전부** grant, 나머지 4역할=권한 0. 매트릭스 첫 진입 시 admin 열만 전부 ✓, 나머지는 빈 셀이 정상. 이 화면에서 관리자가 채워 넣는다. [Source: 0002:109-114]

---

### 🔌 FastAPI 쓰기 엔드포인트 (쓰기 권위 + 동일 트랜잭션 + 자동 감사)

**왜 FastAPI인가(직접 쓰기 불가):** 0002:60-66이 authenticated에 신원/RBAC 테이블 **SELECT만** grant, INSERT/UPDATE/DELETE는 service_role만. 게다가 감사 actor는 FastAPI `authenticated_conn`이 `app.actor_id`를 주입해야 정확히 기록된다(0004 트리거 계약, 1.5 D-2/D-3). → **쓰기는 FastAPI 단일 경로.** [Source: 0002:60-66, db.py:68-84, 0004:24-56]

**엔드포인트:** `PUT /api/v1/admin/rbac/grants` (외부 `/patient_management_system/api/v1/admin/rbac/grants`)
- 의존성: `require_permission("rbac.manage")` → 미보유 403 봉투(OpenAPI·일관성). [Source: security.py:125-134]
- 요청: `{ "role_code": "reception", "permission_code": "patient.read", "granted": true }` (snake_case).
- 응답: `{ "role_code", "permission_code", "granted", "changed": bool }` — `changed`=실제 INSERT/DELETE 발생 여부(멱등: 이미 있는 grant 재요청 → `changed:false`, 감사행 0).

**`db.set_role_permission(sub, role_code, permission_code, granted)` — TOCTOU 차단(deferred 1.5 해소):**
```
authenticated_conn(sub) 한 트랜잭션 안에서:
  1) has_permission('rbac.manage') 재평가 → False면 ForbiddenError
     (require_permission 의존성은 별도 트랜잭션이므로, 쓰기 직전 같은 conn에서 재확인 = 평가↔쓰기 원자성)
  2) role_code → role_id, permission_code → permission_id 해석 (없으면 NotFoundError 404)
  3) role_code == 'admin' → 409 role_locked (자가-락아웃 방지); 'patient' → 409 invalid_target
  4) granted: INSERT INTO role_permissions(role_id, permission_id) VALUES(...) ON CONFLICT (role_id, permission_id) DO NOTHING
     not granted: DELETE FROM role_permissions WHERE role_id=$ AND permission_id=$
  5) return (영향 행 수 > 0)
```
- **감사:** 위 INSERT/DELETE에 0004 `trg_role_permissions_audit`가 자동 발화 → `audit_logs`에 actor(=admin sub)·action(create/delete)·before/after 스냅샷 기록. **앱은 감사 INSERT를 직접 하지 않는다.** [Source: 0004:126-128]
- **에러 봉투:** `role_locked`/`invalid_target`/`not_found`는 `AppError(message="…", code="role_locked", status_code=409, detail={...})` 또는 전용 서브클래스. `message`=한국어, `code`=영문. DB 장애 → 503(기존 `_DB_OUTAGE_ERRORS` 매핑 일관). [Source: errors.py:33-96, db.py:33-34]

⚠️ **admin 거부를 403으로 하지 말 것** — 관리자는 `rbac.manage`를 *가지고 있다*(403="권한 없음"은 오인). admin-lock은 시스템 불변식 위반이므로 **409 `role_locked`**(또는 422)가 정확. UI는 admin 열을 애초에 비활성화하므로 정상 경로에선 호출되지 않음 — 이는 방어심층(직접 호출·DevTools 대비).

---

### 🌐 web→FastAPI 최초 인증 호출 인프라 (이 스토리가 처음 만든다)

현재 web에는 **백엔드 호출 클라이언트가 없다**(1.6까지 전부 Supabase 직접). 1.7이 표준을 세운다(후속 에픽 재사용).

**1) API 베이스 URL(env):** `NEXT_PUBLIC_API_BASE_URL` 신설(`/v1` **미포함**, 클라가 `/v1/...` append).
- dev: `http://localhost:8000` (FastAPI `fastapi dev` — `root_path`는 OpenAPI/프록시용 메타일 뿐, dev 서버는 `/v1/...`를 루트에서 서빙). → `${base}/v1/admin/rbac/grants` = `http://localhost:8000/v1/admin/rbac/grants` ✓
- prod: `https://kuntae802.mooo.com/patient_management_system/api` (nginx가 `/patient_management_system/api`를 스트립 후 FastAPI로 → `/v1/...`). ✓
- `lib/env.ts` Zod에 `NEXT_PUBLIC_API_BASE_URL: z.url(...)` 추가, `.env.example`·`.env.local`·`vitest.config.ts` 동기화. [Source: main.py:58-60, config.py:30, deployment topology 메모]
- ⚠️ **CORS:** `api/app/core/config.py:cors_origins` 기본=`http://localhost:3000,https://kuntae802.mooo.com`. web dev origin이 3000이 아니면(예: 3002) `CORS_ORIGINS` env에 추가해야 프리플라이트 통과(브라우저 교차출처 호출). Bearer는 Authorization 헤더(쿠키 아님), `allow_headers=["*"]`·`allow_methods=["*"]`이라 헤더/메서드는 OK. [Source: main.py:43-49, config.py:32]

**2) Bearer 토큰:** 브라우저 supabase 클라(`web/src/lib/supabase/client.ts:createClient()`)의 `auth.getSession()` → `session.access_token`. publishable 키만 노출(secret/service_role 금지 — 기존 불변). [Source: client.ts:7-12]

**3) `apiFetch<T>(path, init)` (`web/src/lib/api/client.ts`, 클라 전용):**
- getSession으로 토큰 확보(없으면 명확 에러) → `Authorization: Bearer ${token}` + `Content-Type: application/json` 첨부 → `fetch(${env.NEXT_PUBLIC_API_BASE_URL}${path}, ...)`.
- 응답 파싱: 성공(2xx) → `json` 반환; 실패 → 봉투 `{error:{code,message,detail}}`에서 한국어 `message`·`code`·`status`를 담은 **`ApiError`** throw. 봉투 형태가 아니어도(네트워크/502 등) 일반 한국어 메시지로 폴백.
- 🚫 PII 금지: 토큰·sub를 로그·toast에 남기지 말 것(에러는 봉투 message만 노출).

---

### 🖥️ 매트릭스 UI 구현 (RSC 가드 → 클라 컴포넌트)

**라우트:** `web/src/app/(staff)/admin/permissions/page.tsx`(RSC). 사이드바 "권한" 항목이 이미 여기로 링크(`staff-nav.ts:81`, `requiredPermission: 'rbac.manage'`). 1.6 home의 `PermissionGate` 데모도 이 경로로 링크.
- RSC가 `requirePermission('rbac.manage', STAFF_HOME)`로 가드 → `fetchPermissionMatrix(supabase)` → 클라 `<PermissionMatrix initial={...}>`에 전달. **부모 `(staff)/layout`이 이미 staff 보장**하므로 staff 재확인 불요(deferred-work.md:9 정책 확정). [Source: guards.ts:34-49, staff-nav.ts:81]

**시각(목업 충실, `mockups/key-rbac-matrix.html` 참조):**
- 페이지 헤더("권한 관리" + "변경 즉시 적용") + autosave 인디케이터 + 즉시적용/감사 안내 배너 + 범례(허용/차단/고정/민감).
- 패널 안 `.matrix-wrap`(overflow, 스티키 컨텍스트) → `<table>`: thead 역할 헤더(admin 열 강조+🔒 lockchip), resource 그룹 헤더 행, 권한 행.
- **체크 인코딩(모니터-강건):** 허용=`--primary` 채움+✓, 차단=빈 박스+hairline, admin lock=teal-grey 채움+✓+잠금. **음영/틴트 단독 금지.** ~1280px에서 채움+글리프 가독. [Source: mockups CSS, UX-DR20]
- 클리니컬 틸-블루 토큰·Pretendard·Lucide는 1.2 셸에서 상속(재정의 금지). 사이드바는 admin nav(1.6 `filterNav`가 이미 처리).

**상태/Provider 결정 — TanStack Query 여전히 미도입:**
- 매트릭스는 **단일 페이지 로컬 상태**(useState/useReducer)로 충분. 토글=낙관적 로컬 갱신 + `apiFetch` 1콜 + 실패 롤백. 전역 캐시 무효화 불요(관리자가 *타* 역할을 바꿔도 자기 세션 권한엔 무영향; admin 자기 역할은 잠금). 1.6의 "1.7에서 동적 무효화 필요 시 TanStack Query 검토" → **검토 결과: 페이지 로컬 상태로 충분, 미도입**(새 의존성 회피, project-context). 타 직원의 변경 반영은 그들의 다음 로드/재로그인(MVP 수용). [Source: 1-6 §상태/Provider 결정]

---

### ⌨️ 접근성·키보드 (AC4 — 비협상)

- **시맨틱:** `<table>` + 열 `<th scope="col">`(역할) + 행 `<th scope="row">`(권한명). 셀 인터랙티브 요소는 네이티브(`<button>`/`<input type=checkbox>`), `<div onClick>` 금지. 셀 접근가능명 = **"{역할} — {권한} — 허용/차단"**(`aria-label` 또는 `<th>` 연결 + 상태 텍스트). [Source: EXPERIENCE.md:150, UX-DR20]
- **2D 화살표 roving-tabindex:** 매트릭스 안에서 Tab은 1회 진입/이탈만(115셀 Tab 순회 금지). 진입 셀만 `tabIndex=0`, 나머지 `-1`; `Arrow*`로 격자 이동. admin 열 셀도 도달·"고정 변경 불가" 낭독, 토글 비활성. [Source: EXPERIENCE.md:153, UX-DR19]
- **라이브 리전:** autosave="변경사항 자동 저장됨"=polite, 오류 토스트=assertive(sonner). `:focus-visible` 링 상시. `aria-disabled`(admin/lock·in-flight)는 포커스 가능 유지(disabled 속성 아님 — 낭독·학습). [Source: UX-DR20]
- **확인 다이얼로그(민감):** 포커스 트랩·초기 포커스(확인 버튼 아닌 안전 기본)·`Esc` 닫기·닫을 때 포커스 복원. 1단계 모달만. shadcn Dialog(base-ui, `@base-ui/react` 설치돼 있음 → `components/ui/dialog.tsx` 추가) 권장; 미설치 마찰 시 최소 포커스트랩 모달 허용. [Source: EXPERIENCE.md:69,153]

---

### 📂 파일 구조 — 신규/수정 (정확 경로)

**신규(NEW) — api:**
- `api/app/api/v1/admin.py` — `PUT /admin/rbac/grants` (Task 1)
- `api/tests/test_admin_rbac.py` — 단위 (Task 3.1)
- `api/tests/test_admin_rbac_integration.py` — 통합 (Task 3.2)

**신규(NEW) — web:**
- `web/src/lib/api/client.ts` (+ `client.test.ts`) — `apiFetch`/`ApiError` (Task 4) `[api/ 폴더 신설]`
- `web/src/lib/auth/rbac-matrix.ts` (+ test) — `fetchPermissionMatrix` (Task 5.1)
- `web/src/app/(staff)/admin/permissions/page.tsx` — RSC 가드 페이지 (Task 5.2) `[admin/ 라우트 신설]`
- `web/src/components/admin/permission-matrix.tsx` (+ test) — 매트릭스 클라 컴포넌트 (Task 6·7·8) `[components/admin/ 신설]`
- `web/src/components/ui/dialog.tsx` — (shadcn base-ui Dialog 채택 시) 확인 다이얼로그 (Task 7.2)

**수정(UPDATE) — 현 동작 보존 필수:**
- `api/app/api/v1/router.py` — `admin.router` include 추가 [현재: auth만]
- `api/app/core/db.py` — `set_role_permission` 추가(기존 함수·풀·`authenticated_conn` 보존) [현재: 읽기 헬퍼만]
- `web/src/lib/env.ts` — `NEXT_PUBLIC_API_BASE_URL` 추가(기존 3키 보존) [현재: SUPABASE 2키 + BASE_PATH]
- `web/.env.example` · `web/.env.local` · `web/vitest.config.ts` — 새 env 동기화
- `docs/glossary.md` — 신규 식별자 등재 (Task 9)

**디렉토리 규약:** `api/app/{api/v1,core}` · `web/src/{app/(staff),components/<feature>,lib,hooks}`. [Source: project-context.md:72]

---

### 📐 Project Structure Notes

- **정렬:** 신규 파일 모두 규약 디렉토리. `web/src/lib/api/`·`components/admin/`·`app/(staff)/admin/`는 신설(첫 사용). `admin.py`는 architecture가 명시한 도메인 라우터(`admin.py` = RBAC/마스터/스케줄/대시보드/감사). [Source: architecture.md:360,387]
- **변이(variance) 1 — 매트릭스 읽기 = Supabase 직접:** architecture는 모든 쓰기를 FastAPI로 두지만 *읽기*는 RLS 직접 조회 허용(1.6 선례). 매트릭스 카탈로그 읽기(roles/permissions/role_permissions, 전부 authenticated SELECT 정책)는 직접 조회, **쓰기만 FastAPI**. [Source: 0003:55-65, project-context.md:59]
- **변이 2 — TanStack Query 미도입 유지:** 1.6의 보류를 1.7에서 재평가 → 페이지 로컬 상태로 충분, 미도입.
- **deferred 소비:** ① 1.5 "권한평가+쓰기 동일 트랜잭션" 패턴을 `set_role_permission`이 확립(첫 쓰기 엔드포인트). ② 1.6 `requirePermission` fallback/staff 정책 확정(`(staff)` 하위 → STAFF_HOME, staff 재확인 불요). ③ 1.6 `server-only` 패키지 미도입은 유지(여전히 주석 경계; 새 의존성 회피). [Source: deferred-work.md:7,9,13]
- **충돌 없음:** 사이드바·게이트(1.6)·인증 의존성(1.5)·감사 트리거(1.3) 위에 자연 적층. 무회귀.

---

### 🔗 Previous Story Intelligence (1.3 / 1.5 / 1.6)

**1.3 (신원·RBAC 스키마·감사 트리거)** [Source: 0002·0003·0004]
- `role_permissions`(uuid PK, role_id/permission_id FK, `unique(role_id, permission_id)`)에 0004 감사 트리거 부착 → **토글이 자동 감사**. `permissions`(code/name/resource/action)·`roles`(code/name) 카탈로그. [Source: 0002:24-33,118-128]
- 0003: `roles`/`permissions`/`role_permissions` authenticated SELECT(`using(true)`), `users` 본인행만 → **매트릭스 읽기 직접 조회 가능**(1.6과 동일 근거). [Source: 0003:55-70]
- 0004 트리거 actor: `app.actor_id` GUC(FastAPI 주입) → `auth.uid()` 폴백. UUID 형식 검증 후 캐스트(비-UUID self-DoS 방지). [Source: 0004:47-56]

**1.5 (FastAPI 인증·RBAC)** [Source: security.py·db.py·errors.py·auth.py]
- `require_permission(code)`→403, `get_current_user`(JWKS ES256·aud) 확립. **재사용**(중복 정의 금지). [Source: security.py:101-134]
- `authenticated_conn(sub)` = GUC 주입 트랜잭션(`request.jwt.claims`+`app.actor_id`) — **쓰기는 반드시 이 안에서.** `sub`는 검증된 Pydantic UUID(self-DoS 방지). [Source: db.py:68-84]
- 에러 봉투 `{error:{code,message,detail}}`(`AppError` 서브클래스), 422/403/409/404/500/503. `AppError` 핸들러는 `exc.message`(한국어) 직노출 → custom 메시지 가능. [Source: errors.py:33-96,113-117]
- **deferred(1.5 TOCTOU):** "쓰기 엔드포인트 도입 에픽에서 평가+쓰기 동일 트랜잭션" → **1.7이 `set_role_permission`으로 해소.** [Source: deferred-work.md:13]
- 통합 테스트: 실 Supabase 토큰(`admin@pms.local`/`Staff1234`, EMP0001; `doctor@pms.local` 권한 0). 단위: `dependency_overrides`+`monkeypatch db.*`. [Source: test_auth_integration.py, test_rbac_permission.py]

**1.6 (RBAC UI 게이트)** [Source: 1-6-...md, web/src/components·lib·hooks]
- 재사용: `usePermissions(){role,has}` · `PermissionGate`/`LockedAction` · `requireStaff`/`requirePermission(code,fallback)` · `filterNav` · `STAFF_NAV`(`/admin/permissions` 항목 `requiredPermission: rbac.manage`). `fetchUserPermissions`(직접 조회 패턴). [Source: 1-6 File List]
- 노출 모델 확정: 직무 핵심=역할 노출 / 민감·관리=권한 게이트(1.6 코드리뷰 결정). admin 관리 항목만 `requiredPermission` 유지 → **권한 매트릭스가 이 게이트를 실효화**(관리자가 타 역할에 권한 부여 시 그들 메뉴 출현). [Source: 1-6 Review Findings]
- home `PermissionGate`(rbac.manage) → `/admin/permissions` 링크 데모 존재(비-admin 잠금). 1.7이 그 목적지를 구현. [Source: (staff)/home/page.tsx:23-38]
- web env fail-fast(`lib/env.ts` Zod, client/server/proxy 소비). **1.7은 여기에 `NEXT_PUBLIC_API_BASE_URL` 1키 추가.** [Source: env.ts]

---

### 🗒️ Git Intelligence (최근 작업 패턴)
```
65a4890 Story 1.6 산출물 + 코드리뷰 findings·deferred-work + done
aebe414 feat(web): RBAC UI 게이트 — 미들웨어·레이아웃 가드·역할별 셸 노출·권한 밖 액션 잠금
dbd346a Story 1.5 산출물 + 코드리뷰 findings·deferred-work + done
e4921a0 test(api): 인증·RBAC 단위·통합 테스트 + dev 부트스트랩 doctor 계정
fd353f7 feat(api): FastAPI 인증·RBAC 강제 — JWKS·권한 의존성·에러 봉투
```
- 커밋 관습: `type(scope): 한국어 요약`(의미 단위). 1.7은 api·web 양쪽 → `feat(api): RBAC grant 엔드포인트` + `feat(web): 권한 매트릭스` 분리 권장. **커밋·푸시는 사용자 승인 시에만.** [Source: project-context.md:76]
- 1.5가 `e4921a0`에서 dev 부트스트랩 계정(admin/doctor) 시드 → 1.7 통합 테스트가 그대로 소비.

---

### 🧰 Latest Tech / 버전 확정

- **api:** Python 3.13 · `fastapi[standard]` · asyncpg · PyJWT(crypto)/JWKS · pydantic-settings. ORM·Alembic 금지(스키마 단일 소유). 테스트 `pytest`(+`httpx`, `TestClient`). [Source: project-context.md, api 코드]
- **web:** `next 16.2.9`(⚠️ proxy·async cookies — `node_modules/next/dist/docs/` 권위), react 19.2.4, `@supabase/ssr ^0.12`·`@supabase/supabase-js ^2.108`, `zod ^4.4`, `lucide-react ^1.21`, `sonner ^2.0`, `@base-ui/react ^1.6`(shadcn base-nova), tailwind 4. **설치된 shadcn UI:** button·skeleton·sonner뿐 → **dialog는 추가 필요**(table/checkbox는 커스텀 `<table>`/셀로 충분, shadcn data-table 불요). [Source: web/package.json, Explore 조사]
- **미설치 유지:** `@tanstack/react-query`·`zustand`·`server-only`. 1.7은 추가하지 않는다. [Source: 1-6 §Latest Tech]
- 테스트: `vitest ^3.2.6` + `@testing-library/react` + jsdom. co-located `*.test.ts(x)`. Supabase/fetch는 `vi.fn` mock(`permissions.test.ts`·`use-permissions.test.tsx` 선례). [Source: vitest.config.ts, 기존 테스트]

---

### ✅ 검증 시나리오 (수기 셀프체크 — Task 10.3)

> 로컬: `supabase start` + `supabase db reset`(시드) + `uv run fastapi dev`(api, :8000) + `npm run dev`(web). 부트스트랩 admin 계정으로 로그인.

1. **admin 로그인** → 사이드바 "권한" → `/admin/permissions` 진입(가드 통과). 매트릭스 5열(원무/의사/간호/방사선/관리자, patient 없음), admin 열 전부 ✓+🔒, 나머지 빈 셀. (AC1)
2. **비민감 토글:** reception 열 × "환자 조회(patient.read)" 빈 셀 클릭 → 즉시 ✓, autosave 갱신. DB `select * from audit_logs order by created_at desc limit 1` → action=create·target_table=role_permissions·actor=admin. (AC2)
3. **민감 토글:** nurse × "주민번호 열람(patient.reveal_rrn)" 클릭 → **확인 다이얼로그**(권한명+"간호사" 명시) → 취소=무변경 / 확인=적용+감사. (AC3)
4. **admin 열 잠금:** admin 열 셀 클릭/Enter → 변경 안 됨, "고정 변경 불가" 낭독. (AC1·AC4)
5. **키보드:** Tab 1회로 매트릭스 진입 → Arrow로 셀 이동(Tab 순회 안 함) → Enter/Space 토글. (AC4)
6. **서버 권위(방어심층):** doctor 토큰으로 `PUT /v1/admin/rbac/grants` 직접 호출(curl) → 403. admin 토큰 + `role_code:"admin"` → 409 `role_locked`. (AC5)
7. **무회귀:** api `pytest`(1.5) 녹색, web `vitest`(1.6) 녹색, `npm run build` 통과.

---

### References

- [Source: _bmad-output/planning-artifacts/epics.md:469-489] — Story 1.7 BDD 인수기준
- [Source: epics.md:109,268] — FR-211(관리자 체크박스 토글, 즉시 반영)
- [Source: epics.md:196(UX-DR16)·199(UX-DR19)·200(UX-DR20)] — 매트릭스 시각·민감 확인·2D 키보드·시맨틱
- [Source: ux-designs/.../mockups/key-rbac-matrix.html] — 매트릭스 비주얼·체크 인코딩·그룹 헤더·민감 pill·autosave (시각 충실 구현 대상)
- [Source: ux-designs/.../EXPERIENCE.md:69,115,150,153] — 1단계 모달·permission-cell·시맨틱/ARIA·roving 키보드
- [Source: supabase/migrations/0002_identity_rbac.sql:24-33,60-66,83-114] — role_permissions 스키마·authenticated SELECT-only grant·23권한/5역할 시드·admin 전권
- [Source: supabase/migrations/0003_rls_helpers.sql:55-70] — 매트릭스 읽기용 authenticated SELECT 정책·has_permission
- [Source: supabase/migrations/0004_audit.sql:24-56,126-128] — 감사 트리거(actor=app.actor_id)·role_permissions 자동 감사
- [Source: api/app/core/security.py:125-134] — require_permission(403)
- [Source: api/app/core/db.py:68-84] — authenticated_conn(GUC 주입 트랜잭션, 쓰기 토대)
- [Source: api/app/core/errors.py:33-96] — 에러 봉투·AppError 서브클래스(custom 한국어 message)
- [Source: api/app/api/v1/{router.py,auth.py}, api/app/main.py:58-60] — 라우터 등록·/v1 prefix·root_path
- [Source: api/tests/{test_auth_integration.py,test_rbac_permission.py}] — 통합(실 토큰)·단위(override+monkeypatch) 테스트 패턴
- [Source: web/src/lib/{env.ts,supabase/client.ts}, web/.env.example] — env Zod·브라우저 토큰·API URL 추가 지점
- [Source: web/src/lib/{auth/guards.ts,nav/staff-nav.ts}, web/src/hooks/use-permissions.ts, web/src/components/auth/permission-gate.tsx] — 재사용 가드·내비·훅·게이트
- [Source: web/src/app/(staff)/home/page.tsx:23-38] — `/admin/permissions` 링크 데모(목적지=이 스토리)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:7,9,13] — 소비할 deferred 3건(TOCTOU·fallback정책·server-only)
- [Source: docs/project-context.md:56-59,72,82-84] — 상태 분리·쓰기 권위·디렉토리·보안 MUST

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Opus 4.8, 1M context) — bmad-dev-story 워크플로우

### Debug Log References

- `uv run ruff check app/ tests/` → All checks passed (E501 3건 수정 후)
- `uv run pytest -q` → **61 passed** (로컬 Supabase 스택 가동 → 통합 테스트 실제 실행: grant/revoke 사이클·감사 actor 캡처·409/422/404/403 전부 실 DB 검증)
- `npx vitest run` → **63 passed / 14 files** (신규 client·rbac-matrix·permission-matrix + 기존 회귀 env·permissions·guards·sidebar 등)
- `npx tsc --noEmit` → exit 0 · `npx eslint` → exit 0
- `npx next build`(Turbopack) → 성공, `ƒ /admin/permissions` 동적 라우트 등록
- base-ui 함정: `@base-ui/react/alert-dialog`는 ESM에서 `export * as AlertDialog` → `import * as` 가 아니라 `import { AlertDialog }`(네임스페이스)가 정답. `import * as`는 `.AlertDialog` 중첩이 돼 컴포넌트 undefined.

### Completion Notes List

- **FastAPI 쓰기 엔드포인트** `PUT /v1/admin/rbac/grants` + `db.set_role_permission`: 권한 재평가(`has_permission('rbac.manage')`)와 INSERT/DELETE를 **동일 `authenticated_conn` 트랜잭션**에서 수행 → 1.5 deferred TOCTOU 해소(첫 쓰기 엔드포인트가 패턴 확립). 0004 트리거가 자동 감사(앱은 감사 INSERT 미수행). admin 대상=409 `role_locked`(자가-락아웃 방지), patient=422 `invalid_target`, 미존재 코드=404. AppError는 `_run_authed`가 잡지 않아 그대로 봉투 전파.
- **web→FastAPI 최초 인증 호출 인프라** 확립: `NEXT_PUBLIC_API_BASE_URL`(필수 env, `/v1` 미포함) + `apiFetch`/`ApiError`(Bearer 첨부·봉투 파싱). 후속 에픽 재사용 표준.
- **매트릭스 = 데이터 구동**: `permissions` 카탈로그 전수(현 23권한/15 resource) × 직원 5역할(patient 제외, admin 최후미 고정). "22/6도메인"은 illustrative라 미복제. 그룹 헤더=`RESOURCE_LABELS`(UI 라벨 맵), 행 라벨=`permissions.name`(DB 한글).
- **읽기/쓰기 권위 분리**: 매트릭스 읽기=Supabase 직접(authenticated SELECT, 0003·1.6 선례), 토글 쓰기=FastAPI(service_role) — 0002가 authenticated에 SELECT만 grant하므로 직접 쓰기 불가(방어심층).
- **민감 권한**(`patient.reveal_rrn`·`rbac.manage`·`audit.read`) 토글=base-ui `AlertDialog` 확인 단계 필수(포커스 트랩·복원·Esc, 안전 기본 포커스=취소). 비민감=즉시 적용.
- **즉시 적용 UX**: 저장 버튼 없음. 낙관적 grants 갱신 + 셀 `pending` disable(이중 제출 방지) → `apiFetch` → 성공 autosave(aria-live polite)/실패 롤백+sonner 토스트.
- **접근성**: `<table>`+`<th scope=col/row>`, 셀 `aria-label="{역할}—{권한}—허용/차단/고정"`+`aria-pressed`, **2D 화살표 roving-tabindex**(Tab 순회 금지), `focus-visible` 링. admin 열도 포커스 도달·낭독, 토글 비활성.
- **TanStack Query 미도입 유지**(1.6 보류 재평가): 단일 페이지 로컬 상태로 충분, 새 의존성 회피. **deferred 소비**: 1.5 TOCTOU, 1.6 `requirePermission` fallback/staff 정책(STAFF_HOME·staff 재확인 불요) 확정. `server-only`·shadcn dialog 추가 미도입(base-ui AlertDialog 사용).

### File List

**신규(NEW) — api:**
- `api/app/api/v1/admin.py` — `PUT /admin/rbac/grants`
- `api/tests/test_admin_rbac.py` — 단위
- `api/tests/test_admin_rbac_integration.py` — 통합(실 토큰+psql 감사 검증)

**신규(NEW) — web:**
- `web/src/lib/api/client.ts` · `web/src/lib/api/client.test.ts`
- `web/src/lib/auth/rbac-matrix.ts` · `web/src/lib/auth/rbac-matrix.test.ts`
- `web/src/app/(staff)/admin/permissions/page.tsx`
- `web/src/components/admin/permission-matrix.tsx` · `web/src/components/admin/permission-matrix.test.tsx`
- `web/src/components/admin/confirm-dialog.tsx`

**수정(UPDATE):**
- `api/app/core/db.py` — `set_role_permission` 추가 + 에러 클래스 import
- `api/app/api/v1/router.py` — `admin.router` include
- `web/src/lib/env.ts` — `NEXT_PUBLIC_API_BASE_URL` 추가
- `web/.env.example` · `web/.env.local` · `web/vitest.config.ts` — 새 env 동기화
- `docs/glossary.md` — Story 1.7 식별자·정책 등재

## Change Log

| 날짜 | 변경 | 비고 |
|---|---|---|
| 2026-06-20 | Story 1.7 컨텍스트 생성 — RBAC 권한 매트릭스(관리자) 구현 가이드 | ready-for-dev. create-story 워크플로우 |
| 2026-06-20 | Story 1.7 구현 — FastAPI grant 엔드포인트(동일 트랜잭션 권한평가+쓰기·자동 감사) + web→FastAPI apiFetch 인프라 + 데이터 구동 권한 매트릭스(즉시 적용·민감 확인·2D 키보드) | api 61 + web 63 tests·ruff·tsc·eslint·build 통과. Status → review |
| 2026-06-20 | 코드 리뷰(3-레이어 적대적, 하드 AC 위반 0) — patch 4건 적용(매트릭스 fetch fail-loud·apiFetch 헤더 정규화·비봉투 에러 http_status·이중제출 ref 가드) + 테스트 3건 보강, defer 2·dismiss 9 | web 66 tests·api 61·tsc·eslint·build 통과. Status → done |
