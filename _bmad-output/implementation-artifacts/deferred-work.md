# Deferred Work

작업 중·리뷰 중 식별됐으나 현재 스토리 범위 밖으로 미룬 항목. 해당 스토리 착수 시 참조.

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
