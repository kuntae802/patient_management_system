---
baseline_commit: 1becc304606af7105e52c519341561a3c85152bb
---
# Story 1.10: 감사 로그 뷰어 (관리자, append-only)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 관리자,
I want 감사 로그를 행위자·기간·대상별로 조회·필터링하기를,
so that 민감정보 접근과 주요 작업을 사후 추적·검증할 수 있다.

## Acceptance Criteria

**AC1 (FR-243) — 필터 조회(읽기전용)**
**Given** 관리자 권한(`audit.read`)으로 감사 화면(`/admin/audit-logs`)에서
**When** 행위자·기간·대상 필터를 적용하면
**Then** 해당 감사 로그가 **읽기전용**으로 조회된다(최신순, 페이지네이션). 권한 없는 사용자는 사이드바 항목 미노출 + 엔드포인트 403.

**AC2 (UX-DR22) — 전/후 스냅샷 diff(읽기전용)**
**Given** 특정 감사 항목에서
**When** 상세를 열면
**Then** 변경 전/후 스냅샷이 **읽기전용 diff 뷰어**로 표시되고, **편집·삭제 어포던스가 일절 없다**. 스냅샷에 잠재된 민감 필드는 마스킹된 형태로 표시되며 per-row reveal은 없다.

**AC3 — 감사 포착 범위 검증(인프라 전수)**
**Given** 감사 포착 범위 검증 시
**When** 현재 코드베이스에 배선된 감사 소스(RBAC 변경·직원 계정/재직상태 변경·PII reveal 프리미티브·관리자 본인의 동작)가 발생하면
**Then** 행위자를 구분하지 않고(관리자 본인 포함) **예외 없이 `audit_logs`에 기록**되어 뷰어에서 조회·필터된다. 아직 테이블/기능이 없는 이벤트(내원 상태 전이=Epic 4, 인쇄/내보내기=Epic 7, 환자 reveal 소비처=Epic 3/4)는 **동일 감사 인프라(트리거 부착 / service_role INSERT)에 흘러들어올 경로가 확립**되어 있음을 문서·테스트로 확인한다(신규 계측을 1.10에서 만들지 않는다).

> **AC3 해석(중요·dev agent 필독):** "관리자 본인 조회도 예외 없이"는 **트리거가 actor를 특수 처리하지 않음**(=본인 동작도 기록됨)을 의미한다. 0004 트리거·0005 reveal이 자동 충족한다. **감사 목록을 *브라우징*하는 행위 자체는 감사 대상이 아니다**(PII reveal이 아닌 메타데이터 열람 + RLS `audit.read` 게이트; 매 페이지 열람을 감사하면 무한 자가-로그 노이즈만 발생, 보안 가치 없음). 1.10 뷰어는 스냅샷 내 암호화 PII를 평문 reveal하는 기능을 **구현하지 않으므로**(현재 스냅샷에 암호화 PII 없음 — §Dev Notes 데이터 현황) 새 `read` 이벤트 emit이 불필요하다. 미래에 스냅샷 PII reveal 기능을 추가하면 그 reveal은 `decrypt_sensitive`(자가-감사 `action='read'`) 경유여야 한다.

## Tasks / Subtasks

- [x] **Task 1 — API: 감사 응답 스키마** (AC: 1, 2)
  - [x] `api/app/schemas/audit.py` 신규: `AuditLogEntry`, `AuditLogPage`(`{data, meta}`), `AuditPageMeta`(`page, page_size, total`). 필터는 라우터 쿼리 파라미터로 직접 수신.
  - [x] `AuditLogEntry` 필드 전부 구현(snake_case, `AuditAction` Literal). `ip_address: str | None`(현재 null). email/비밀번호/raw PII 미노출.
- [x] **Task 2 — DB: 감사 조회 쿼리** (AC: 1, 3)
  - [x] `api/app/core/db.py`에 `fetch_audit_logs(...) -> tuple[list[Record], int]` 추가. `_run_authed` 토대 재사용. + jsonb 코덱을 풀 `init`에 등록(`_init_connection` — before/after를 dict로 디코드).
  - [x] `LEFT JOIN public.users`로 actor 이름/사번 해석(INNER 금지). `ip_address::text` 캐스트.
  - [x] WHERE 동적 조립(전달 필터만), 컬럼·연산자=고정 리터럴 / 값만 `$n` 바인딩(SQLi 차단). `order by created_at desc`, limit/offset.
  - [x] `total`은 동일 WHERE의 별도 `count(*)`(무조인).
- [x] **Task 3 — service: 오케스트레이션** (AC: 1)
  - [x] `api/app/services/audit.py` 신규: `list_audit_logs(...) -> AuditLogPage`. `db.fetch_audit_logs` → `AuditLogEntry.model_validate(dict(row))` 매핑 → `{data, meta}` 봉투.
- [x] **Task 4 — API: 라우터 엔드포인트** (AC: 1)
  - [x] `api/app/api/v1/admin.py`에 `require_audit_read = require_permission("audit.read")` + `@router.get("/audit-logs", response_model=AuditLogPage)`. 쿼리 파라미터(actor_id/action/target_table/target_id/date_from/date_to/page(ge=1)/page_size(ge=1,le=200)).
  - [x] 외부 경로 = `/patient_management_system/api/v1/admin/audit-logs`. router.py 이미 admin.router include(변경 불요).
- [x] **Task 5 — web: 타입·메타** (AC: 1, 2)
  - [x] `web/src/lib/admin/audit.ts` 신규: `AuditLogEntry` 타입(FastAPI 거울 snake_case), `ACTION_META`(create/read/update/delete/login — 색+글리프+라벨 3중 인코딩), `TARGET_TABLE_LABELS`+`targetTableLabel`(unknown raw 폴백), `actorLabel`(NULL=시스템·조인미스 폴백), `maskSnapshotValue`(민감 키 denylist), `diffSnapshot`+`DIFF_KIND_META`, `formatAuditTime`(Intl ko-KR KST).
- [x] **Task 6 — web: 페이지 RSC 가드** (AC: 1)
  - [x] `web/src/app/(staff)/admin/audit-logs/page.tsx` 신규: `requirePermission("audit.read", STAFF_HOME)` 후 `<AuditLogViewer />`. users/page.tsx 복제. nav 항목 중복 추가 안 함.
- [x] **Task 7 — web: 뷰어(목록·필터·페이지네이션)** (AC: 1, 3)
  - [x] `web/src/components/admin/audit-log-viewer.tsx` 신규. staff-directory 골격을 **읽기전용**으로 복제(상태변경/생성폼/ConfirmDialog 제거). 스켈레톤·빈상태·오류재시도.
  - [x] 필터 바: action/target_table/actor(`/v1/admin/users` 재사용, 403 시 디그레이드)/기간(date)×2/초기화. 변경 시 page=1 리셋.
  - [x] 목록 `<table>`+`<th scope>`(UX-DR20), 시각(KST tabular-nums)·행위자·동작 배지·대상·상세 버튼. 페이지네이션 이전/다음 + "총 N건 중 a–b". 0건 빈상태. `aria-live` 결과 안내.
- [x] **Task 8 — web: 상세 diff 모달(읽기전용)** (AC: 2)
  - [x] `web/src/components/admin/audit-log-detail.tsx` 신규: base-ui `Dialog`(네임스페이스 import, 포커스 트랩). 전/후 스냅샷 읽기전용 diff(키별 이전→이후, +/−/~ 글리프+색+굵기). create=added/delete=removed/update=changed.
  - [x] `maskSnapshotValue`로 민감 키 마스킹(Lock 아이콘 + "●●●● (마스킹됨)"). 편집/저장/삭제 버튼 없음(닫기만). 모달 1단계.
- [x] **Task 9 — 테스트** (AC: 1, 2, 3)
  - [x] API 통합 `api/tests/test_admin_audit_integration.py`(6 케이스) + API 단위 `api/tests/test_admin_audit.py`(6 케이스, DB 불요). admin 200+봉투·doctor 403·필터·actor 조인·**AC3 RBAC 변경이 actor=admin 으로 기록·조회**·페이지네이션·기간.
  - [x] web 단위 `web/src/components/admin/audit-log-viewer.test.tsx`(5 케이스) — 렌더·필터·diff 모달 읽기전용·**phone 마스킹·raw 미노출**·빈상태·오류재시도.
- [x] **Task 10 — AC3 포착 범위 문서화 + append-only 회귀 가드** (AC: 3)
  - [x] Completion Notes에 포착 범위 매트릭스 기록(§Completion Notes). 미래 이벤트 동일 인프라 부착 경로 확인.
  - [x] `fetch_audit_logs` = `select` + `select count(*)` 전용(INSERT/UPDATE/DELETE 0) — grep 확인. append-only 불변식 미접촉.

### Review Findings (Code Review 2026-06-20)

> 3레이어 적대적 리뷰(Blind Hunter·Edge Case Hunter·Acceptance Auditor). Acceptance Auditor: AC1·2·3 전부 충족, 위반 0. 아래는 Blind/Edge Hunter 제기 항목의 트리아지 결과.

**Patch (수정 대상):**

- [x] [Review][Patch] 중첩 객체·배열 내부 민감값 마스킹 우회 — `maskSnapshotValue`가 최상위 키만 검사하고 `typeof object`는 `JSON.stringify`로 내부를 평문 덤프. **해소: `maskDeep` 재귀 마스킹 추가**(중첩/배열 민감 키 치환) + 단위 테스트 `audit.test.ts` [web/src/lib/admin/audit.ts:maskSnapshotValue]
- [x] [Review][Patch] `action` 쿼리 파라미터 enum 미검증 → 무음 0건 — **해소: `action: AuditAction | None`**(Literal)로 오타·대소문자·빈문자열을 422 반환 [api/app/api/v1/admin.py:list_audit_logs]
- [x] [Review][Patch] 역전 기간(date_from > date_to) 무검증 → 무음 0건 — **해소: 라우터 가드 → 422 `invalid_date_range`** [api/app/api/v1/admin.py:list_audit_logs]

**Defer (이월 — deferred-work.md 기록):**

- [x] [Review][Defer] before/after 마스킹이 web 렌더 계층 전용 → API 응답·로그엔 jsonb 원문 전송 [api/app/schemas/audit.py] — deferred(현재 PII 부재, Epic 3+ 서버측 정책 검토)
- [x] [Review][Defer] offset 페이지네이션 page 상한 부재 → 대용량 시 큰 OFFSET 비용 [api/app/core/db.py:fetch_audit_logs] — deferred(admin 전용 노출 제한, 대량 누적 시 keyset)
- [x] [Review][Defer] date_to 경계 `<=` + 클라 `T23:59:59`(ms 없음) → 23:59:59.x 로그 누락 [api/app/core/db.py · web audit-log-viewer.tsx] — deferred(반열림 구간 권장)
- [x] [Review][Defer] 행위자 필터가 직원목록(user.manage) 의존 → 시스템/환자/삭제 actor 필터 불가 [web/src/components/admin/audit-log-viewer.tsx] — deferred(distinct-actor 전용 소스 검토)

**Dismissed (노이즈/오탐/현재 정확, 5건):** ① 마스킹 substring 매칭 비앵커 — 안전 맥락에선 과다 마스킹이 보수적 정답이고 미존재 키 동의어 과소마스킹은 투기적(재귀 패치가 중첩은 커버). ② 빈문자열 free-text 필터 — web truthy 가드로 미발생, action은 위 패치가 해소. ③ count_sql 무조인 — 현재 필터 전부 `al.*`라 정확하며 주석으로 의도 명시됨. ④ formatAuditTime 잘못된 ISO — 서버가 항상 유효 timestamptz 전송. ⑤ before/after 비-object jsonb → 500 — 모든 writer가 `to_jsonb(row)`/NULL만 생성.

## Dev Notes

> **이 스토리의 핵심:** 감사 뷰어가 필요로 하는 백엔드 인프라는 **이미 전부 깔려 있다** — 권한 키 `audit.read`(0002:106, admin 시드 보유), RLS SELECT 정책(0004:80–95), append-only 삼중 강제(0004), 사이드바 메뉴(staff-nav.ts:84), 감사 트리거(roles/permissions/role_permissions/users)·reveal 자가감사(0005). 1.10은 사실상 **"기존 1.7/1.8 관리자 화면 패턴으로 읽기전용 조회 화면 1개 + 그 조회 엔드포인트"**를 만들고 **AC3 포착 범위를 검증**하는 일이다. 새 라이브러리·새 추상화 도입 금지.

### 🧭 읽기 경로 결정 — FastAPI 경유 (Supabase 직접조회 아님)

감사 조회는 **FastAPI(`GET /v1/admin/audit-logs`, service_role) 경로**로 한다. (1.8 직원 목록과 동형, 1.7 매트릭스 읽기와 다름.) 근거:

1. **actor 이름 해석에 `public.users` 조인 필요** — `audit_logs.actor_id`는 사람이 못 읽는 UUID다. 이름/사번을 보여주려면 `LEFT JOIN public.users`가 필요한데, `users`는 본인행 RLS(0003)라 **authenticated 직접 조회로는 타인 행을 못 읽는다**. service_role(FastAPI)이 RLS를 우회해 조인해야 actor 이름이 나온다. [Source: api/app/core/db.py:319-332 `fetch_staff_list` 동일 사유]
2. **아키텍처가 페이지네이션 목록 봉투 `{data, meta:{page,page_size,total}}`를 규정** — 서버측 페이지네이션이 자연스럽다. [Source: architecture.md §Format Patterns]
3. **`audit.read`는 "민감 권한"**(UX-DR16, epics.md:196) — 명령 권위 게이트 `require_permission('audit.read')`(403)에 적합.

> **사실 정정(혼동 방지):** `audit_logs`에는 SELECT용 RLS 정책이 **존재한다** — `audit_logs_select ... using (has_permission('audit.read'))` + `grant select to authenticated`. [Source: supabase/migrations/0004_audit.sql:80-95] 즉 Supabase 직접조회가 *불가능*해서가 아니라, 위 1·2·3(actor 조인·봉투·민감권한) 때문에 FastAPI를 택한다. 이 RLS SELECT 정책은 **방어심층 2차선으로 유지**된다(service_role 경로 + RLS 이중).

### 🗂️ audit_logs 스키마 (조회 대상 — 정확히 이대로)

[Source: supabase/migrations/0004_audit.sql:8-21]

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `id` | uuid PK | 감사 항목 식별(불투명 id — 상세/라우트에 사용, PII 금지) |
| `actor_id` | uuid (nullable, **FK 미부착**) | 행위자 auth uid. NULL=시스템(GUC 미주입), 환자 uid·삭제된 직원=조인 미스 |
| `action` | text CHECK(`create`/`read`/`update`/`delete`/`login`) | §action 값별 의미 표 |
| `target_table` | text NOT NULL | 대상 테이블명(트리거가 `tg_table_name` 자동 기록 / reveal은 인자) |
| `target_id` | text (nullable) | 대상 행의 id(트리거: `coalesce(after->>'id', before->>'id')`) |
| `before_data` | jsonb (nullable) | 변경 전 스냅샷(create=null, update/delete=old 전체행) |
| `after_data` | jsonb (nullable) | 변경 후 스냅샷(create/update=new 전체행, delete=null) |
| `ip_address` | inet (nullable) | **현재 항상 NULL — 데드 와이어**(db.py:81 `app.actor_ip` 미주입). 뷰어는 표시하되 빈 값 전제 |
| `created_at` | timestamptz | UTC 저장 → KST는 Intl 표시. idx 존재(정렬·기간 필터) |

인덱스: `idx_audit_logs_actor_id`, `idx_audit_logs_target_table`, `idx_audit_logs_created_at` — 필터/정렬이 인덱스를 탄다. [Source: 0004_audit.sql:19-21]

**action 값별 의미·발생 경로:**

| action | 의미 | 발생 경로(현재) |
|---|---|---|
| `create` | 트리거 INSERT | roles/permissions/role_permissions/users INSERT |
| `update` | 트리거 UPDATE | 직원 재직상태 변경(users) 등 |
| `delete` | 트리거 DELETE | RBAC revoke(role_permissions), 행 삭제 |
| `read` | **PII reveal(복호)** | `decrypt_sensitive` 자가감사(0005). **일반 SELECT는 감사 안 함 — reveal만.** 현재 소비처 없음(Epic 3/4) |
| `login` | (의도) 로그인 | **현재 emit 코드 없음 — 갭.** 뷰어는 enum값으로 표시·필터 지원하되, 1.10에서 emit 구현 안 함(로그인은 GoTrue 처리, FastAPI 로그인 엔드포인트 부재) |

현재 가능한 `target_table` 실값: `roles`, `permissions`, `role_permissions`, `users`. (미래 reveal은 `patients` 등 도메인 테이블 추가.) `target_table`은 자유 text이므로 뷰어 라벨맵은 **알려진 값 매핑 + unknown raw 폴백**으로 한다.

### 🔐 actor 캡처 계약 (이미 동작 — 변경 없음)

FastAPI(service_role)는 트랜잭션마다 `authenticated_conn(sub)`이 `set_config('app.actor_id', sub, true)`를 주입한다 → 트리거·reveal이 actor를 정확히 기록(미설정 시 `auth.uid()` 폴백 → NULL). [Source: api/app/core/db.py:74-90] **조회 엔드포인트는 쓰기가 없으므로 actor 주입이 결과에 영향 없지만, `fetch_audit_logs`도 `_run_authed`(=`authenticated_conn`) 토대를 그대로 쓴다**(503 매핑·일관성). 비-UUID sub가 `::uuid`를 터뜨리는 자가-DoS는 `CurrentUser.sub`(Pydantic UUID)가 막는다.

### 📊 AC3 — 감사 포착 범위 매트릭스 (1.10 시점 현황)

[Source: 서브분석 — 0004/0005/db.py/services·epics.md Story 1.10]

| AC가 요구하는 포착 대상 | 1.10 현황 | 근거 |
|---|---|---|
| **RBAC 변경** | ✅ 기록됨 | `trg_roles_audit`·`trg_permissions_audit`·`trg_role_permissions_audit`(0004:118-128). 1.7 grant/revoke가 자동 감사 |
| **파괴적 동작** | ◑ 부분(현존 파괴만) | 현재 존재하는 파괴 = users/role_permissions DELETE → 트리거가 잡음. 환자·진료·수납 삭제는 테이블 부재(Epic 3+) → 미래 |
| **PII reveal** | ✅ 인프라 기록됨(소비처 미래) | `decrypt_sensitive` 자가감사 `action='read'`(0005). reveal 엔드포인트는 Epic 3/4 |
| **상태 전이** | 🔜 미래(N/A) | 내원/진료 상태머신 = Epic 4. 예외: 직원 `employment_status` 전이는 지금도 기록(users UPDATE) |
| **인쇄/내보내기** | 🔜 미래(N/A) | 수납 문서 인쇄 = Epic 7. 감사 뷰어 자체 CSV 내보내기는 1.10 범위 아님 |

→ **AC3 검증의 현실적 형태:** (a) 지금 배선된 소스(RBAC·직원·reveal 프리미티브)가 빠짐없이 audit_logs에 남고 뷰어에서 보이는지 테스트, (b) 미래 5종이 동일 인프라(트리거 부착 또는 service_role INSERT)로 흘러들어올 경로가 확립됐음을 문서화. "관리자 본인 포함 예외 없이"는 트리거가 actor 무차별 기록 → 자동 충족.

### 🧱 따라야 할 구현 패턴 (그대로 복제 — 재발명 금지)

**API (3계층: `api/v1` transport → `services` 오케스트레이션 → `db` 영속):**
- 라우터: `api/app/api/v1/admin.py` — `require_permission(code)` 의존성은 **모듈 로드 시 1회 생성**(`require_audit_read = require_permission("audit.read")`), 엔드포인트에서 `Depends`. [Source: admin.py:27-28, 78-83]
- db: `_run_authed(sub, _op)` 토대 + `conn.fetch(...)`. [Source: db.py:93-103, 319-332]
- service: `Model.model_validate(dict(row))` 매핑. [Source: services/users.py:23-24, 88-90]
- 권한 의존성 팩토리: [Source: api/app/core/security.py:125-134]
- 스키마: 전 필드 snake_case, `Literal`로 CHECK 거울. [Source: api/app/schemas/users.py]
- 에러 봉투 `{error:{code,message,detail}}` — `detail`에 raw PII 금지. [Source: api/app/core/errors.py]

**web (얇은 RSC 셸 + 클라이언트 컴포넌트):**
- 페이지 가드: `await requirePermission("audit.read", STAFF_HOME)`. [Source: web/src/app/(staff)/admin/users/page.tsx, web/src/lib/auth/guards.ts:requirePermission]
- 데이터 페칭: `apiFetch<T>("/v1/admin/audit-logs?...")` — Bearer 자동 첨부, 실패 `ApiError`. **토큰·PII를 로그/toast에 남기지 않는다.** [Source: web/src/lib/api/client.ts]
- 목록 컴포넌트 골격(로딩 null·스켈레톤·빈상태·오류재시도·`<table>`+`<th scope>`·tabular-nums·배지): **`staff-directory.tsx`를 읽기전용으로 복제**. [Source: web/src/components/admin/staff-directory.tsx:24-238]
- 메타/라벨/배지 패턴(색+글리프+라벨, badgeClass): `EMPLOYMENT_STATUS_META`. [Source: web/src/lib/admin/staff.ts:27-46]
- 모달: base-ui `Dialog` **네임스페이스 import**. [Source: web/src/components/admin/staff-create-form.tsx]
- 재사용 컴포넌트: `web/src/components/ui/skeleton.tsx`(`Skeleton`), `web/src/components/shell/empty-state.tsx`(`EmptyState`), 아이콘 `lucide-react`(`ScrollText`은 nav에서 이미 사용).
- 권한 훅(필요 시): `web/src/hooks/use-permissions.ts`(`usePermissions`).

### 🚫 절대 어기면 안 되는 규칙 (보안·PII·회귀)

1. **append-only 불변식** — 뷰어·엔드포인트는 audit_logs에 **SELECT만**. INSERT/UPDATE/DELETE 호출 금지(0004가 RLS deny + GRANT 회수 + BEFORE 트리거로 삼중 차단하지만, 코드가 시도조차 하지 않는다). [Source: 0004_audit.sql:72-114]
2. **스냅샷 PII 마스킹** — `before_data`/`after_data`는 전체행 jsonb다. 현재는 roles/permissions/role_permissions/users만이라 깨끗하지만(users엔 password·email 컬럼 없음 — 0002, schemas/users.py:1-5), **환자 감사(Epic 3+)가 들어오면 스냅샷에 암호문/마스킹 대상이 포함**된다. diff 뷰어가 jsonb를 무비판적으로 덤프하면 미래 PII 누출 표면이 된다 → **`maskSnapshotValue(key, value)` 마스킹 심(seam)을 1.10에서 만들어 둔다**(키 denylist 예: `resident_no`, `*_enc`, `*_blind_index`, `phone`, `email`, `password*`, `*_rrn` — bytea/암호문은 길이만 표시). per-row reveal 없음. [Source: epics.md UX-DR22:202, EXPERIENCE.md PII·감사 패턴]
3. **raw PII 전 채널 금지** — 로그·toast·에러봉투·**URL·딥링크·실시간 페이로드·PDF/파일명·클라 로그** 금지. 감사 항목 식별·필터·상세는 **불투명 id(UUID)**만 URL/쿼리에 사용(chart_no/PII 금지). [Source: project-context.md PII 경계, epics.md UX-DR22:202]
4. **권한 3계층** — UI 노출(nav `requiredPermission`)·명령 권위(FastAPI `require_permission('audit.read')` → 403)·RLS(audit.read) 모두 통과. **UI 게이트는 보안 경계가 아니다** — 최종 차단은 서버. `"audit.read"` 키 문자열은 0002·RLS·nav가 공유 → 바꾸면 동시 붕괴, 그대로 사용.
5. **JSON snake_case 일관** — API/타입 전 경로 snake_case(camelCase 변환 금지). audit_logs 컬럼명 그대로. [Source: project-context.md]
6. **nav 항목 중복 추가 금지** — `/admin/audit-logs`는 staff-nav.ts:84에 이미 있다. 라우트만 그 href에 맞춘다.
7. **에러 = 503 매핑** — DB 일시장애는 `_run_authed`가 503으로(전면 500 금지). 권한 미달 = 403, 검증 = 422.

### 🆕 최신 기술 주의 (Next.js 16)

- **⚠️ `web/AGENTS.md` 강제 규칙:** "This is NOT the Next.js you know — breaking changes. **코드 작성 전 `node_modules/next/dist/docs/`의 관련 가이드를 읽어라.**" App Router·route group `(staff)`·RSC 가드 패턴은 1.6~1.8에서 확립됐으니 그 파일들을 1차 레퍼런스로 삼되, 새 API(예: 라우팅·캐싱 변경)는 node_modules 문서로 확인.
- **base-ui** = 네임스페이스 import만(`import { Dialog } from "@base-ui/react/dialog"`), `import *` 금지. [Source: 1.8 staff-create-form.tsx 패턴]
- **신규 의존성 금지** — TanStack Query·zustand·server-only·shadcn data-table 모두 **미설치 유지**(1.6→1.7→1.8 연속 확정). 단순 로컬 상태 + 네이티브 컨트롤 + `apiFetch`.
- pgcrypto/Vault·암복호는 1.10 범위 외(reveal 소비처는 Epic 3/4). 1.10 뷰어는 스냅샷을 마스킹만 한다.

### 📅 기간 필터 구현 노트

- `created_at`은 timestamptz UTC 저장. 클라 `<input type="date">`(KST 날짜)를 ISO 경계로 변환해 전송: `date_from = ${date}T00:00:00+09:00`, `date_to = ${date}T23:59:59+09:00`. 서버는 `created_at >= date_from and created_at <= date_to`로 단순 필터(서버측 TZ 로직 회피). 표시는 Intl ko-KR(KST). [Source: project-context.md 날짜 규칙, architecture.md]

### Previous Story Intelligence (1.9 · 1.8 · 1.7 · 1.3)

- **1.3(0004 감사 트리거):** `audit_trigger_fn`의 `target_id`는 `coalesce(after->>'id', before->>'id')` — `id` 없는 테이블에 부착 시 NULL. 1.3 소유 4테이블은 전부 `id` 보유 → 무영향. (뷰어는 target_id NULL 케이스를 graceful 표시.) [Source: deferred-work.md:48]
- **1.9(0005 reveal):** `decrypt_sensitive`가 복호 직후 `action='read'` 자가감사(before/after 값 미저장 — PII 경계). 복호 실패 시 abort로 'read' 누락(시도 감사 부재 — by-design, 후속 하드닝). reveal 엔드포인트·소비처는 **현재 없음**(Epic 3/4). [Source: deferred-work.md:7-11, 1-9 Dev Notes]
- **1.8(직원 관리):** `staff-directory.tsx`가 정확히 따라야 할 목록 화면 레퍼런스(로딩 null·스켈레톤·빈상태·오류재시도·`<table>` 시맨틱·tabular-nums·배지·새로고침). 단 1.10은 **읽기전용**이라 select/생성/confirm 제거. [Source: staff-directory.tsx]
- **1.7(RBAC 매트릭스):** `audit.read`가 SENSITIVE_PERMISSIONS에 포함 — 매트릭스 토글 시 확인 다이얼로그 대상. 키 문자열 불변. admin은 전권 시드. [Source: web/src/lib/auth/rbac-matrix.ts]
- **TOCTOU 패턴(이월):** 조회는 쓰기가 없어 무영향. 향후 쓰기 엔드포인트(Epic 3+)는 "권한평가+쓰기 동일 트랜잭션" 가이드. [Source: deferred-work.md:39]

### Git Intelligence

최근 커밋(1becc30·f4c173c·96cf188 = Story 1.9 / 43ccd53·735e3e0 = Story 1.8): 의미 단위 단계별 커밋, **코드/산출물 분리 커밋**, 마이그레이션 순번(0001~0005). 1.10은 새 마이그레이션 불요(읽기 전용 — audit_logs·트리거 이미 존재). 커밋·푸시는 **승인 시에만**(project-context 워크플로 규칙). [Source: git log, project-context.md]

### Project Structure Notes

- API 신규: `api/app/schemas/audit.py`, `api/app/services/audit.py`, `api/app/core/db.py`(함수 추가), `api/app/api/v1/admin.py`(엔드포인트 추가).
- web 신규: `web/src/app/(staff)/admin/audit-logs/page.tsx`, `web/src/components/admin/audit-log-viewer.tsx`, `web/src/lib/admin/audit.ts`.
- 테스트: `api/tests/test_admin_audit_integration.py`(+ 비-DB 단위 `test_admin_audit.py` 선택), `web/src/components/admin/audit-log-viewer.test.tsx`.
- 구조는 `api/app/{core,api/v1,schemas,services}` · `web/src/{app/(staff),components/admin,lib/admin,hooks}` 컨벤션 준수. [Source: project-context.md, architecture.md]

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.10] — 인수기준, FR-243, UX-DR22
- [Source: _bmad-output/planning-artifacts/epics.md:125-126,144,163,196,202] — FR-242/243, NFR-042, append-only, UX-DR16/DR22
- [Source: _bmad-output/planning-artifacts/architecture.md] — 읽기경로 분담, 페이지네이션 봉투, RLS 방어심층, PII 경계, IA(admin)
- [Source: supabase/migrations/0004_audit.sql:8-132] — audit_logs 스키마·트리거·append-only·RLS SELECT(80-95)
- [Source: supabase/migrations/0005_crypto.sql] — decrypt_sensitive 자가감사 action='read'
- [Source: supabase/migrations/0002_identity_rbac.sql:106] — audit.read 권한 시드(admin 보유)
- [Source: api/app/api/v1/admin.py:24-103] — admin 라우터·require_permission 의존성·StaffResponse 패턴
- [Source: api/app/core/db.py:74-103,188-193,319-332] — authenticated_conn·_run_authed·fetch_staff_list
- [Source: api/app/core/security.py:125-134] — require_permission 팩토리
- [Source: api/app/services/users.py:88-90] — list_staff 매핑 패턴
- [Source: api/app/schemas/users.py] — StaffResponse(snake_case·Literal) 패턴
- [Source: web/src/components/admin/staff-directory.tsx] — 목록 화면 골격(읽기전용 복제 대상)
- [Source: web/src/lib/admin/staff.ts:27-46] — 메타/배지 패턴
- [Source: web/src/lib/api/client.ts] — apiFetch·ApiError
- [Source: web/src/lib/auth/guards.ts:requirePermission] — RSC 권한 가드
- [Source: web/src/lib/nav/staff-nav.ts:84] — 감사 로그 nav 항목(이미 존재, /admin/audit-logs·audit.read)
- [Source: web/AGENTS.md] — Next.js 16 변경 경고(코드 전 node_modules 문서)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:7-11,39,48] — 이월(reveal 신뢰경계·실패감사·target_id 계약·TOCTOU)
- [Source: docs/project-context.md] — 전역 규칙(snake_case·PII·RLS·무ORM·신규 의존성 금지)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Opus 4.8, 1M context) — BMad dev-story 워크플로

### Debug Log References

- `uv run ruff check .` → All checks passed
- `uv run pytest -q` → 139 passed, 7 skipped (기존 설정 의존분 — admin 프로비저닝 SECRET_KEY·vault)
- `npx tsc --noEmit` → 0 errors
- `npx eslint` → 0 errors
- `npx vitest run` → 17 files, 79 passed

### Completion Notes List

**구현 요약:** 감사 로그 뷰어를 기존 1.7/1.8 관리자 화면 패턴으로 읽기전용 구현. 백엔드는 FastAPI 3계층(schema→db→service→router) + jsonb 코덱(풀 init), 프런트는 RSC 가드 + 클라이언트 뷰어 + 읽기전용 diff 모달. 새 의존성 0(TanStack/zustand 미도입 유지).

**읽기 경로 = FastAPI**(Supabase 직접조회 아님): actor 이름 `LEFT JOIN public.users`가 users 본인행 RLS 때문에 service_role 필요 + 아키텍처 페이지네이션 봉투 `{data, meta}` + `audit.read` 민감권한. audit_logs SELECT RLS(0004)는 방어심층 2차선 유지.

**페이지네이션 봉투 신설:** 코드베이스 최초의 `{data, meta:{page,page_size,total}}` 목록 봉투(`AuditLogPage`) — 후속 목록의 표준이 됨.

**jsonb 코덱:** before/after 스냅샷(코드베이스 최초 jsonb 읽기)을 위해 asyncpg 풀 `init`에 jsonb 코덱 등록(`_init_connection`) — dict 디코드. 현재 jsonb 쓰기/읽기 경로 부재라 회귀 위험 없음(전체 139 테스트 통과로 확인).

**스냅샷 PII 마스킹 심:** `maskSnapshotValue`(민감 키 denylist: resident_no·rrn·password·email·phone·address·guardian·`*_enc`·`*_hash`·`*_blind_index`·ciphertext)로 표시 단 차단. 현재 스냅샷(roles·permissions·role_permissions·users)엔 PII 부재지만 미래 환자 감사(Epic 3+) 누출 표면을 선제 봉쇄. 리스트는 기본 마스킹·per-row reveal 없음(UX-DR22).

**AC3 — 감사 포착 범위 매트릭스(1.10 시점):**

| 포착 대상 | 현황 | 근거 |
|---|---|---|
| RBAC 변경 | ✅ 기록됨 | 0004 트리거(roles/permissions/role_permissions). 통합 테스트가 grant/revoke→audit 검증 |
| 파괴적 동작 | ◑ 현존 파괴만 | users/role_permissions DELETE 트리거. 도메인 삭제는 Epic 3+ |
| PII reveal | ✅ 인프라 기록(소비처 미래) | 0005 `decrypt_sensitive` 자가감사 `action='read'`. reveal 엔드포인트는 Epic 3/4 |
| 상태 전이 | 🔜 미래(N/A) | 내원 상태머신 Epic 4. (직원 employment_status 전이는 지금도 users UPDATE 로 기록) |
| 인쇄/내보내기 | 🔜 미래(N/A) | 수납 문서 Epic 7 |

→ "관리자 본인 포함 예외 없이"는 트리거가 actor 무차별 기록 → 자동 충족(통합 테스트 `test_admin_own_rbac_change_audited_and_visible`가 actor=admin 검증). 미래 5종은 동일 인프라(트리거 부착 / service_role INSERT)로 흘러든다. **감사 목록 *브라우징*은 감사 안 함**(PII reveal 아님 + 무한 자가-로그 방지). 1.10 뷰어는 스냅샷 PII 평문 reveal 미구현 → 새 `read` emit 불필요.

**append-only 가드:** `fetch_audit_logs`는 `select` + `select count(*)` 전용(INSERT/UPDATE/DELETE 0 — grep 확인). 0004 삼중 강제 불변식 미접촉.

**login 액션:** enum·필터·표시 지원하되 emit은 1.10 범위 외(GoTrue 로그인, FastAPI 로그인 엔드포인트 부재 — 갭, 미래). `ip_address` 컬럼은 현재 항상 NULL(데드 와이어) — 표시하되 빈 값 전제.

### File List

**신규(API):**
- `api/app/schemas/audit.py` — AuditLogEntry·AuditPageMeta·AuditLogPage
- `api/app/services/audit.py` — list_audit_logs(봉투 매핑)
- `api/tests/test_admin_audit.py` — 엔드포인트 단위 테스트(6)
- `api/tests/test_admin_audit_integration.py` — 통합 테스트(6, AC1·2·3)

**신규(web):**
- `web/src/lib/admin/audit.ts` — 타입·메타·마스킹·diff·시간 포맷
- `web/src/app/(staff)/admin/audit-logs/page.tsx` — RSC 권한 가드
- `web/src/components/admin/audit-log-viewer.tsx` — 목록·필터·페이지네이션
- `web/src/components/admin/audit-log-detail.tsx` — 읽기전용 diff 모달
- `web/src/components/admin/audit-log-viewer.test.tsx` — web 단위 테스트(5)

**수정(API):**
- `api/app/core/db.py` — `_init_connection`(jsonb 코덱) + create_pool `init=` + `fetch_audit_logs` + `datetime` import
- `api/app/api/v1/admin.py` — `require_audit_read` + `GET /audit-logs` 엔드포인트 + 관련 import

## Change Log

| 날짜 | 변경 | 작성자 |
|---|---|---|
| 2026-06-20 | Story 1.10 구현 — 감사 로그 뷰어(읽기전용 조회·필터·페이지네이션·전후 스냅샷 diff·PII 마스킹) + 백엔드 조회 엔드포인트·jsonb 코덱. API 12·web 5 테스트 추가. | Amelia (dev) |
| 2026-06-20 | 코드 리뷰 패치 3건 적용 — 중첩/배열 재귀 마스킹(`maskDeep`)·`action` Literal 검증(422)·역전 기간 가드(422). 테스트 +4(API 2·web 2). defer 4·dismiss 5. Status → done. | Code Review |
