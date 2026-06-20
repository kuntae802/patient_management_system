# Deferred Work

작업 중·리뷰 중 식별됐으나 현재 스토리 범위 밖으로 미룬 항목. 해당 스토리 착수 시 참조.

## Deferred from: code review of 1-9-주민번호-암호화-감사-reveal-프리미티브 (2026-06-20)

- **decrypt actor/target = service_role GUC 신뢰(위조 가능)** [supabase/migrations/0005_crypto.sql:decrypt_sensitive] — `app.actor_id` GUC·`target_table`/`target_id` 인자를 호출자(service_role=FastAPI)가 주입하므로, DB는 actor·target 무결성을 강제하지 않는다("복호=감사 일어남"은 강제하나 actor *값*의 진위는 아님). 단, 이는 **0004 `audit_trigger_fn`과 동일한 신뢰 경계**(by-design, 1.9가 도입한 회귀 아님). 프로덕션 경로(`authenticated_conn`)는 항상 검증된 sub를 주입. 운영 하드닝 시 actor=호출 주체 일치 검증(예: ciphertext↔target 바인딩) 검토.
- **`blind_index` 입력 정규화 미강제** [supabase/migrations/0005_crypto.sql:blind_index] — 함수가 입력을 그대로 HMAC하므로 `710314-2345678`(하이픈)과 `7103142345678`이 다른 해시 → 소비처가 정규화를 빠뜨리면 FR-003 중복 매칭·UNIQUE가 깨진다. 제네릭 프리미티브라 PII 유형별 정규화를 DB가 알 수 없어 **소비처(Epic 3) 책임**으로 위임(docstring 명시). Epic 3 `0006/0007_patients`에서 `resident_no_hash` 저장 시 `services.rrn.normalize_rrn` 후 `blind_index` 호출을 강제·테스트할 것.
- **복호 실패 시 'read' 감사 누락** [supabase/migrations/0005_crypto.sql:decrypt_sensitive] — `pgp_sym_decrypt`가 손상 ciphertext·키 불일치로 예외를 던지면 audit insert 전에 abort → 실패한 reveal 시도는 감사에 안 남는다. 실패는 아무 값도 노출하지 않으므로 AC3("복호=감사") 위반 아님(정상 경로의 ciphertext는 DB 출처라 유효). 침입탐지 관점의 "시도 감사"가 필요하면 후속에서 `exception` 블록으로 실패도 기록.
- **로그 마스킹 백스톱이 RRN만 커버** [api/app/core/logging.py] — 암복호 함수는 제네릭(모든 PII)이나 로그 마스킹은 주민번호 패턴만 레닥션. 연락처·주소 등은 신뢰할 만한 마스킹 패턴이 없어 제외(최고위험 구조적 PII 우선). 1차 방어는 "raw PII 미로깅" 규율. 후속에서 전화번호 등 추가 패턴 검토.
- **래퍼 통합테스트가 append-only `audit_logs` 행 누적** [api/tests/test_crypto_wrappers_integration.py] — `decrypt_sensitive` 래퍼가 트랜잭션을 커밋하므로 `wrap-smoke` `read` 행이 매 실행 1건씩 잔존(append-only라 정리 불가, `supabase db reset`이 초기화). 정확성엔 무해(고유 sub로 최신 행만 단언)하나 CI 누적 시 감사 카운트 테스트 간섭 가능. 후속에서 전용 격리 DB·주기적 reset 또는 커밋 경로 회피(actor 캡처를 다른 방식 검증) 검토.

## Deferred from: dev of 1-8-직원-계정-재직상태-관리-관리자 (2026-06-20)

- ✅ **1.5 TOCTOU "권한평가+쓰기 동일 트랜잭션" 확장** — 1.7이 단일 DML로 확립한 패턴을 1.8이 **두 시스템(Supabase Auth ↔ Postgres) 오케스트레이션**으로 확장(`services/users.create_staff` = Auth 생성 → DB INSERT + 보상). 첫 외부+DB 복합 명령 + `services/` 계층 첫 사용.
- **GoTrue ban 동기화 실패 재조정 부재** [api/app/services/users.py:change_employment_status] — `admin_set_ban` 실패는 소프트 처리(로깅)되고 DB(접근 권위)는 갱신되나, DB는 차단/복원됐는데 GoTrue ban 상태가 어긋난 드리프트가 남을 수 있다(로그인 표면만). 멱등 재시도는 가능하나 자동 재조정(재시도 큐·주기 동기화)은 없음. 접근은 DB 헬퍼가 이미 차단하므로 안전하나, 운영 하드닝 시 ban 재조정 잡 검토.
- **last-admin 가드 부재** [api/app/core/db.py:update_employment_status] — 자가-락아웃(본인 비활성)은 409로 막지만, admin A가 **다른** 유일 active admin B를 퇴사시켜 active admin 0이 되는 케이스는 막지 않는다. active admin 카운트 가드는 카운트 쿼리 필요 → 후속(현 self-lockout 가드가 흔한 케이스 커버).
- **직원 소속 진료과(department) 배정 UI 부재** [web staff-create-form] — 백엔드는 `department_id`(옵셔널) 수용하나, 진료과 master(Epic 2) 이전이라 생성 폼에 피커 미노출(`users.department_id` FK도 0005_masters에서 추가 예정). Epic 2 이후 직원 진료과 배정 UI 추가.
- **목록 클라 fetch + set-state-in-effect 린트 예외** [web/src/components/admin/staff-directory.tsx] — `users` RLS(본인행)로 RSC 서버 직접조회 불가 → 목록을 클라 `apiFetch`(마운트 effect)로 조회, `react-hooks/set-state-in-effect`를 정당한 예외로 1줄 disable. SSR 서버 apiFetch 인프라(1.1 deferred `API_INTERNAL_URL` + 서버 토큰)를 도입하면 서버 fetch 로 전환 가능(현재 YAGNI).

## Deferred from: code review of 1-8-직원-계정-재직상태-관리-관리자 (2026-06-20)

- **보상 삭제 실패 시 고아 Auth 사용자 재조정** [api/app/core/supabase_admin.py:admin_delete_user] — `admin_delete_user` 가 best-effort(모든 예외 삼킴·로깅만)라, GoTrue create 성공 + DB INSERT 실패 + delete 실패 시 `public.users` 행 없는 **보이지 않는 고아 auth.users**가 남는다. 같은 이메일 재생성은 `email_taken`(409)으로 영구 차단 → 해당 이메일 사용 불가. delete 실패 자체가 드물지만 영향이 영구적. → 고아 스캔/정리 운영 잡 또는 outbox 재시도(ban 재조정과 함께 묶어 검토).
- **임시 비밀번호 최초 로그인 강제 변경** [web staff-create-form · auth flow] — 스토리 결정(관리자 입력 임시비번 + UI 안내)대로 구현됐으나, 첫 로그인 시 변경을 **강제**하는 로직이 없어 관리자가 아는 임시 비밀번호가 무기한 유효할 수 있다(관리자→직원 가장 가능성). → `must_change_password` 플래그 + 미들웨어/온보딩 강제는 보안 하드닝으로 후속.

## Deferred from: code review of 1-7-rbac-권한-매트릭스-관리자 (2026-06-20)

- **`apiFetch` 빈/204 본문 → `null`을 `T`로 반환** [web/src/lib/api/client.ts] — 2xx + 빈 본문 시 `body=null`을 `T`로 캐스트 반환. 현 엔드포인트(`PUT /v1/admin/rbac/grants`)는 항상 `GrantResult` 본문을 반환하고 현 호출부(`permission-matrix.tsx`)는 결과값을 사용하지 않아 무영향. 미래에 204/빈 본문 엔드포인트가 생기면 `await apiFetch<X>()`가 `null`을 `X`로 반환해 호출부 첫 프로퍼티 접근에서 NPE → 그 계약을 정의하는 스토리에서 `undefined` 반환 또는 `empty_body` 에러로 확정.
- **`web/.env.example`가 `.gitignore`로 미추적(Story 1.1 선재)** [web/.gitignore] — `.env*` 패턴이 예시 템플릿까지 무시. Story 1.7이 `NEXT_PUBLIC_API_BASE_URL`을 디스크 `.env.example`에 추가했으나 파일이 버전관리에 없어 신규 기여자 클론 시 필수 env 문서가 전파되지 않음(env.ts의 `z.url` fail-fast로 부팅 실패 가능). → `.gitignore`에 `!.env.example` 네거티브 추가로 템플릿만 추적하도록 검토(웹·api 양쪽). 선재 이슈라 1.7 범위 밖.

## Deferred from: code review of 1-6-...-rbac-ui-게이트 (2026-06-20)

- **(staff)/layout 인증·권한 라운드트립 최적화** [web/src/app/(staff)/layout.tsx] — 매 staff 렌더마다 proxy의 getUser + layout의 `requireStaff`(getUser + `auth_user_role` RPC) + `fetchUserPermissions`(users.role_id select + role_permissions select) = 3~4 왕복. `auth_user_role()`가 이미 users→roles를 조인하는데 `fetchUserPermissions`가 `users.role_id`를 다시 조회(중복). → role+permissions를 한 번에 돌려주는 통합 SECURITY DEFINER RPC, 또는 `requireStaff`가 role_id를 반환해 재사용하면 왕복 절감. 기능 정상, 성능 최적화이므로 MVP 수용.
- **guards.ts server-only 경계 강제** [web/src/lib/auth/guards.ts] — `requireStaff`/`requirePermission`은 `createClient()`→`next/headers cookies()`를 호출하는 서버 전용이나, 경계가 주석뿐이다(`server-only` npm 패키지 미설치). 클라 컴포넌트가 실수로 import하면 빌드가 아니라 런타임에야 실패. → `server-only` 도입 시 import로 빌드타임 차단(새 의존성이라 승인 필요). 스토리가 명시적으로 수용한 트레이드오프.
- **requirePermission fallback/staff 재확인** [web/src/lib/auth/guards.ts] — 기본 `fallback=STAFF_HOME`이 비-staff·미보유 사용자를 staff 영역으로 보내 `requireStaff`와 ping-pong 가능하고, 권한만 확인하고 staff 여부를 재확인하지 않는다. 1.6은 미배선(소비처 없음); 실제 소비처(Story 1.7 `(staff)/admin/*` 보호 라우트) 정의 시 fallback·staff 재확인 정책 확정.

## Deferred from: code review of 1-5-...-fastapi-인증-rbac-강제-jwks-권한-의존성 (2026-06-20)

- **권한평가와 쓰기가 별도 트랜잭션** [api/app/core/db.py] — `require_permission`이 자체 `authenticated_conn`(GUC 주입) 트랜잭션에서 `has_permission`을 평가하고, 후속 쓰기 엔드포인트는 또 다른 `authenticated_conn`을 열어야 감사 actor가 붙는다. 평가↔쓰기 사이에 권한/재직상태가 바뀌면 stale 권한으로 쓰기 실행(TOCTOU). 1.5는 쓰기 엔드포인트가 없어 무영향(RLS가 데이터 권위 백스톱). → **쓰기 엔드포인트 도입 에픽(Epic 3+)에서 "권한평가 + 쓰기를 동일 트랜잭션(authenticated_conn) 안에서 수행"하도록 가이드/패턴 확립.**
- **`validate_runtime` URL 형식 미검증** [api/app/core/config.py] — `SUPABASE_JWKS_URL`/`SUPABASE_DB_URL`이 비어있지 않으면 통과하나, 스킴 누락·오타 등 malformed URL은 부팅을 통과해 첫 인증 요청 시점에 503/연결 타임아웃으로 드러난다(부팅 fail-fast 부분적). DB URL은 부팅 시 asyncpg 풀 연결로 이미 fail-fast. → CI 강화(Post-MVP) 시 URL 스킴/형식 검증 추가.

## Deferred from: code review of 1-4-...-분리-프로필-로그인-supabase-auth (2026-06-20)

- **web `NEXT_PUBLIC_*` env fail-fast 부재** [web/src/lib/supabase/{client,server,proxy}.ts] — `process.env.NEXT_PUBLIC_SUPABASE_URL!`·`..._PUBLISHABLE_KEY!`의 `!` 비-null 단언이 미설정 시 `createBrowserClient/createServerClient`에 `undefined`를 넘겨 불투명 런타임 오류(proxy는 매 요청 throw 위험). 클라용은 빌드타임 인라인이라 빌드 시 누락되면 `undefined` 고정. → ⏸️ **여전히 이월(2026-06-20, Story 1.5 결정 D-8/Task8):** 1.5는 백엔드 인증 범위라 API 측 `SUPABASE_*` fail-fast만 해소했다(아래 1.1 항목 ✅). web env 스키마 검증(`lib/env.ts`)은 스코프 확장 방지 위해 **web 작업 스토리(1.6 미들웨어·UI 게이트)로 재이월**.

## Deferred from: code review of 1-3-...-신원-rbac-스키마-rls-헬퍼-감사-트리거-db (2026-06-20)

- **제네릭 감사 트리거 `id` 컬럼 계약** [supabase/migrations/0004_audit.sql] — `audit_trigger_fn`이 `target_id := coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id')`로 추출 → `id` 컬럼 없는 테이블(복합 PK·자연키 조인테이블)에 재사용 시 `target_id=NULL`로 조용히 기록되어 감사 추적성 상실. 1.3 소유 4테이블은 전부 `id` 보유라 무영향. 트리거를 다운스트림 엔티티에 부착하는 마이그레이션에서 `id` 컬럼 전제를 문서화하거나 전체행 폴백/`TG_ARGV` 키 지정.
- **테스트 하니스 skip→fail 게이트** [api/tests/conftest.py] — Supabase 로컬 스택 미가동 시 마이그레이션 테스트가 fail이 아닌 `pytest.skip` → 관대 CI(`supabase db lint || true` posture)에서 스택 미기동 시 전 테스트가 녹색 skip으로 회귀를 은폐. CI 강화(Post-MVP) 시 `REQUIRE_SUPABASE=1` env로 skip을 fail로 전환.

## Deferred from: code review of 1-2-...-디자인-시스템-토큰-전역-셸-골격 (2026-06-19)

- **버튼 반경 10px vs DESIGN 7px** [web/src/components/ui/button.tsx] — shadcn base-nova 기본 `rounded-lg`(=`--radius-lg` 10px)가 DESIGN.md의 버튼 DEFAULT 7px과 다름. 반경 토큰 스케일(sm5/md8/lg10/xl11/DEFAULT7)은 정의됨(AC3 충족). 버튼 컴포넌트를 `rounded-[var(--radius)]` 등으로 맞추려면 vendor 컴포넌트 수정 필요 → 버튼이 실제 화면에 본격 쓰이는 스토리에서 일괄 정합.
- **접힘 사이드바 카운트 배지 소실** [web/src/components/shell/sidebar.tsx] — 60px 접힘 시 대기 카운트(예: 11)가 라벨·배지와 함께 사라지고 축약 표현(점/툴팁)이 없음. 현재는 정적 placeholder라 무영향. 실데이터·실시간 카운트 도입(Epic 4 대기판) 시 접힘 레일용 배지/도트 보강.
- **내비 placeholder 시맨틱** [web/src/components/shell/sidebar.tsx] — 내비가 do-nothing `<button>`이고 `aria-current="page"`가 비-링크에 부착됨. RBAC 노출 게이트 + 실제 라우트 `<Link>` 전환(Story 1.6) 시 `<a>`/`aria-current` 정합.
- **destructive 버튼 틴트 채움** [web/src/components/ui/button.tsx] — base-nova 기본이 `bg-destructive/10`(틴트)라 danger의 "can't-miss 솔리드" 의도와 다름. DESIGN에 destructive 버튼 스펙 미정의 → 삭제/위험 액션 버튼이 필요한 스토리에서 결정.
- **`--destructive-foreground` 토큰 부재** [web/src/components/shell/topbar.tsx] — 알림 배지가 `text-white` 하드코딩(토큰 우회). 라이트 전용 v1에서 정상 렌더. 대비 조정/일관성 필요 시 `--destructive-foreground` 토큰 도입.
- **한글 폰트 폴백 메트릭(CLS)** [web/src/app/layout.tsx] — `next/font/local`의 `adjustFontFallback` 기본=Arial(라틴)이라 한글 글리프 메트릭과 불일치 → `display:swap` 스왑 시 약간의 reflow. 동일출처 woff2 번들로 로컬 환경에선 거의 즉시 로드되어 완화. 필요 시 한글 메트릭 폴백 정의 검토.

## Deferred from: code review of 1-1-...-init (2026-06-19)

- ✅ **`SUPABASE_*` env fail-fast 없음** [docker-compose.yml] — `SUPABASE_DB_URL`/`JWKS_URL`/`SECRET_KEY`가 미설정이면 `os.getenv → None`으로 조용히 부팅 후, JWKS 검증 시점에 불투명 실패. → **해소(Story 1.5):** `config.py`를 `pydantic-settings`로 승격 + `validate_runtime()`가 lifespan에서 필수값(`SUPABASE_JWKS_URL`·`SUPABASE_DB_URL`) 빈 값을 fail-fast, `SECRET_KEY` 미설정은 경고. asyncpg 풀도 부팅 시 생성 → DB 도달 불가 시 부팅 실패.
- **config.toml auth 약한 기본값** [supabase/config.toml] — `minimum_password_length=6`, `enable_confirmations=false`, `enable_signup=true`, `db.allowed_cidrs=0.0.0.0/0`. `supabase init` 생성 기본값(로컬). → **Story 1.4**(분리 프로필 로그인) 착수 시 auth 정책 하드닝 + 클라우드 대시보드 동기화.
- **`API_INTERNAL_URL` 내부경로 주의** [docker-compose.yml] — SSR 서버사이드 fetch는 컨테이너 내부 `http://api:8000/v1/...`(prefix 없음)로 호출해야 함. 외부 경로(`/patient_management_system/api/v1/...`)와 다르므로 혼동 주의. → **Story 1.4+**(SSR fetch 도입 시).
- **WebView 에러/오프라인/네비게이션 핸들링 없음** [mobile/lib/webview_screen.dart] — `NavigationDelegate` 부재(onWebResourceError·로딩 상태·뒤로가기·오프라인 재시도 없음). 포털 불가 시 빈 화면. → 환자 포털이 라이브된 후(Story 8.x) 하드닝.
- **CI `supabase db lint` 무신호 게이트** [.github/workflows/ci.yml] — `|| true`로 실패를 삼켜 신호 없음(로컬 DB·링크 부재). 골격 단계 의도. → CI 강화는 Post-MVP(아키텍처 명시).
