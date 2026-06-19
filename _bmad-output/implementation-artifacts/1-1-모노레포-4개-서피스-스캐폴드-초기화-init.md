---
baseline_commit: cd78339ef4e364c3f9d434572ebd99c003e6ad88
---

# Story 1.1: 모노레포 · 4개 서피스 스캐폴드 초기화 (Init)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 플랫폼 개발자,
I want 모노레포와 4개 공식 미니멀 스캐폴드(`supabase/`·`api/`·`web/`·`mobile/`)를 초기화하고 서브패스·리버스 프록시·용어집을 설정하기를,
so that 이후 모든 스토리가 **고정된 토대** 위에서 코드를 작성할 수 있다.

## Acceptance Criteria

1. **저장소·루트 토대** — 모노레포 루트에 코드 디렉토리(`supabase/ api/ web/ mobile/`)와 루트 설정 파일(`.env.example`·`docker-compose.yml`·`.github/workflows/ci.yml`)이 존재하고 커밋된다. 시크릿(키·`.env`)은 **절대 커밋되지 않는다**(`.gitignore`로 차단). git 저장소·GitHub 원격·초기 커밋은 이미 존재하므로 **재초기화하지 않고** 단계별로 이어서 커밋한다.
2. **Supabase 데이터 레이어** — `supabase init && supabase start`로 로컬 Postgres/Auth/Storage 스택이 기동하고, `supabase/migrations/`·`seed.sql` 골격과 `config.toml`이 생성된다. (마이그레이션 `0001~0014` 내용은 후속 스토리 소유 — 여기서는 **골격만**.)
3. **FastAPI 애플리케이션** — `uv init` + `uv add "fastapi[standard]" "pyjwt[crypto]" supabase httpx` 후 `uv run fastapi dev`를 실행하면 FastAPI가 `root_path=/patient_management_system/api`로 기동하고 헬스 엔드포인트(`GET /health`)가 200으로 응답한다.
4. **Next.js 직원 웹 + 환자 포털** — `create-next-app`(TS/Tailwind/ESLint/App Router/`src`/`@/*`) + `@supabase/supabase-js @supabase/ssr` 설치 + `next.config.ts`에 `basePath=/patient_management_system` 설정 시, 웹앱이 서브패스에서 정상 렌더된다.
5. **Flutter 환자 셸** — `flutter create mobile` + `webview_flutter` 추가 + base URL을 공개 도메인 서브패스로 설정하면, 웹뷰 셸이 `https://kuntae802.mooo.com/patient_management_system`을 로드하도록 구성된다(`minSdkVersion 24`, 인터넷 권한).
6. **서브패스·프록시·CORS 정합 + 문서 시드** — 리버스 프록시 설정(템플릿)·CORS 화이트리스트(`https://kuntae802.mooo.com`)가 구성되고, **web `basePath` · FastAPI `root_path` · Supabase Auth redirect URL · Flutter 웹뷰 base URL**이 모두 동일 서브패스를 반영한다. `docs/glossary.md`(영문↔한글 용어집)가 시드되고(`docs/project-context.md`는 이미 존재), 모든 신규 식별자는 영문 snake_case다.

## Tasks / Subtasks

- [x] **Task 1 — 저장소·루트 토대 정리 (AC: 1, 6)**
  - [x] git·원격·`.gitignore`·`README.md`가 이미 존재함을 확인하고 **재초기화·재생성하지 않는다**(아래 "현재 상태" 참조). `git status`로 출발점만 확인.
  - [x] 루트 `.env.example` 생성 — 서피스별 변수 키(값 없이 키만): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL`, `SUPABASE_JWKS_URL`, `API_ROOT_PATH=/patient_management_system/api`, `NEXT_PUBLIC_BASE_PATH=/patient_management_system`, `CORS_ORIGINS=https://kuntae802.mooo.com`. **실값·시크릿 금지.**
  - [x] 루트 `docker-compose.yml` 생성 — `web`(Next standalone) + `api`(FastAPI/uv) **2개 서비스만**(Supabase는 클라우드 관리형 → **db 서비스 없음**, 환경변수로 링크). issue_reaction 패턴 차용: `restart: unless-stopped`, 포트 LAN 바인딩 `192.168.219.110:<host>:<container>` — **web `3002:3000`, api `8060:8000`**(110 서버 충돌 회피, 아래 토폴로지 참조). web 컨테이너에 `TZ=Asia/Seoul`(SSR 시각 KST 교정), api 컨테이너에 root_path/CORS 환경변수. SSR 내부통신은 컨테이너 네트워크(`http://api:8000`).
  - [x] `.github/workflows/ci.yml` 골격 생성 — lint(Ruff/ESLint)·typecheck·`supabase db lint`(migration check) 잡 스텁. 강화는 Post-MVP(주석 명시).
  - [x] `.gitignore` 검토 — 이미 4개 서피스를 커버하므로 **갭만 보강**(필요 시 `mobile/android/key.properties`, `*.keystore` 등). 통째로 교체 금지.
- [x] **Task 2 — Supabase 데이터 레이어 스캐폴드 (AC: 2)**
  - [x] 루트에서 `supabase init` → `supabase/config.toml`(project_id=patient_management_system) 생성. 최신 CLI는 빈 `migrations/`·`seed.sql`을 자동 생성 안 함 → 수동 골격 추가.
  - [x] `supabase start`로 로컬 스택 기동 — 10개 컨테이너 healthy(API :54321 · DB :54322 · Studio :54323). ⚠️ CLI 설치 불완전(`supabase-go` 누락) → `~/.local/bin`에 완전 설치로 수정. 54324 일시 충돌은 재시도로 해소.
  - [x] `migrations/.gitkeep`에 `0001~0014` 순번·소유 원칙 명시(실제 SQL은 후속 스토리). `seed.sql`은 헤더 주석만(마스터 시드는 Epic 2/Story 2.5).
  - [x] 로컬 키 체계 실측 — CLI v2.107.0은 **신규+레거시 키 둘 다 발급**(노트 정정). 로컬 키 값은 gitignored `.env`에만, 커밋 금지.
- [x] **Task 3 — FastAPI `api/` 스캐폴드 (AC: 3)**
  - [x] `uv init api --python 3.13` → `uv add "fastapi[standard]" "pyjwt[crypto]" supabase httpx` + dev(`ruff`,`pytest`). FastAPI 0.137.2, supabase 2.31, Python 3.13.
  - [x] `api/app/` 구조 생성: `main.py`, `core/`(config·security·db·errors·logging 스텁 — PII 마스킹·에러 봉투·JWKS 자리), `api/v1/router.py`, `schemas/services/db/internal/`. 아키텍처 §Project Structure 트리 준수.
  - [x] `main.py`에 `FastAPI(root_path=settings.api_root_path)` + CORS(env 화이트리스트) + `GET /health` → `{"status":"ok"}`. 라우터 prefix `/v1`(root_path에 /api 포함 → 외부 `/…/api/v1/*`).
  - [x] `api/Dockerfile`(uv python3.13-slim, `uv sync --no-dev` → `fastapi run`) 생성 — compose 빌드용. `pyproject`에 ruff/pytest 설정.
  - [x] `api/.env.example`·README 생성. **실기동 검증:** `fastapi run` → `/health` **HTTP 200 `{"status":"ok"}`**(부팅 로그 "startup complete"). `ruff check` 통과, `pytest` 1 passed.
- [x] **Task 4 — Next.js `web/` 스캐폴드 (AC: 4)**
  - [x] `create-next-app@latest web --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --yes` → Next 16.2.9 · React 19.2.4 · Turbopack. 중첩 git 미생성(모노레포 감지).
  - [x] `npm i @supabase/supabase-js @supabase/ssr` → ssr ^0.12.0 · supabase-js ^2.108.2.
  - [x] `next.config.ts`에 `basePath`(env 기본 `/patient_management_system`) + `output: "standalone"`. `web/.env.example`(NEXT_PUBLIC_ publishable만).
  - [x] `web/Dockerfile`(node22 멀티스테이지, standalone → `node server.js`, TZ=Asia/Seoul) 생성.
  - [x] **검증:** `npm run build`(Turbopack·TS 통과, standalone 산출) + `npm run lint` 통과. 실기동: `/patient_management_system` **200** · `/` **404** · 자산 `/patient_management_system/_next/…` (basePath 전파 확인).
- [x] **Task 5 — Flutter `mobile/` 웹뷰 셸 (AC: 5)**
  - [x] `flutter create --platforms=android --org com.kuntae802 mobile` → `flutter pub add webview_flutter`(webview_flutter_android 4.13.0). Android 전용 스캐폴드.
  - [x] `lib/config.dart`(`baseUrl=https://kuntae802.mooo.com/patient_management_system`), `lib/webview_screen.dart`(WebViewController·loadRequest), `main.dart`(PmsApp 웹뷰 셸). 기본 카운터 앱·위젯테스트 교체.
  - [x] `android/app/build.gradle.kts`에 `minSdk = 24`(Kotlin DSL), `AndroidManifest.xml`에 `INTERNET` 권한 + label "환자 포털".
  - [x] **검증:** `flutter analyze` No issues found · `flutter test` 1 passed. (APK 빌드는 Android SDK 필요 → Story 8.4, 의도적 보류.)
- [x] **Task 6 — 서브패스·프록시·CORS 정합 + 문서 시드 (AC: 6)**
  - [x] **nginx** 설정 템플릿 `deploy/nginx_patient_management_system.conf` 생성 — 108 `kuntae802` server 블록용 `location`. api(`/…/api/` → 110:8060, **trailing-slash로 prefix strip**) + web(`= /…` 및 `/…/` → 110:3002, WebSocket upgrade). issue_reaction 패턴 차용(X-Forwarded-*·timeout). 108 적용법·**Let's Encrypt는 108 소유** 주석 명시.
  - [x] 서브패스 4개 서피스 정합 교차검증 ✅ — web `basePath`(next.config.ts) · api `root_path`(config.py) · Flutter `baseUrl`(config.dart) · Supabase Auth `site_url`/`additional_redirect_urls`(config.toml, 서브패스 반영하도록 수정).
  - [x] `docs/glossary.md` 시드 — 영문↔한글 도메인 엔티티 30+종 표 + 명명 규칙 + `encounter_status`/오더 생명주기 enum. 신규 식별자 등재 규칙 명시.
  - [x] `README.md` "현재 상태"를 Story 1.1 완료로 갱신(로컬 구동·배포 명령 추가, 기존 내용 보존).
- [x] **Task 7 — 통합 검증 (AC: 1~6)**
  - [x] 4개 서피스 기동 확인 ✅ — api `/health` 200 / web `/patient_management_system` 200·`/` 404 / supabase 10컨테이너 healthy / flutter analyze+test 통과.
  - [x] git 위생 ✅ — `.venv`·`node_modules`·`.next`·`build`·`.dart_tool`·`.env`·`supabase/.branches` 무시, 락파일만 추적, 시크릿/`.env` 추적 0건(86 파일 add 대상).
  - [x] 신규 식별자 영문 snake_case + `docs/glossary.md` 등재 확인(api 패키지·enum·테이블 어휘).
  - [~] 의미 단위 단계별 커밋 — **승인 대기**(메모리 규칙: 커밋·푸시는 승인 시에만). Step 10에서 커밋 계획 제안.

### Review Findings

> 코드 리뷰 (2026-06-19) — Blind Hunter · Edge Case Hunter · Acceptance Auditor 3중 적대적 리뷰. **Patch 4 / Defer 5 / Dismiss 4.** 라우팅 핵심·보안 경계·식별자/no-ORM/no-Alembic 규칙은 전부 PASS.

**Patch (수정 완료):**
- [x] [Review][Patch] web 클라이언트 `NEXT_PUBLIC_*` 빌드타임 누락 → Dockerfile `ARG`+compose `build.args`로 전환(런타임 env 제거) [web/Dockerfile · docker-compose.yml]
- [x] [Review][Patch] CORS 기본값에 `localhost:3000` 누락 → config.py 기본값에 로컬 origin 추가 [api/app/core/config.py]
- [x] [Review][Patch] nginx 정확매치 누락 → `location = /…/api` 308 정규화 추가 [deploy/nginx_patient_management_system.conf]
- [x] [Review][Patch] compose 헬스체크 부재 → api `healthcheck` + web `depends_on: condition: service_healthy` 추가 [docker-compose.yml]

**Defer (후속 스토리 소유):**
- [x] [Review][Defer] `SUPABASE_*` env fail-fast 없음 → None이면 JWKS 불투명 실패 [docker-compose.yml] — Story 1.5(pydantic-settings 승격 시)
- [x] [Review][Defer] config.toml auth 약한 기본값(비번 6·이메일확인 off·signup open·CIDR 0.0.0.0/0) [supabase/config.toml] — `supabase init` 생성 기본값, auth 하드닝 Story 1.4
- [x] [Review][Defer] `API_INTERNAL_URL` 내부경로 주의(내부=`/v1`, 외부=`/…/api/v1`) [docker-compose.yml] — SSR fetch 추가 시(Story 1.4+)
- [x] [Review][Defer] WebView 에러/오프라인/네비게이션 핸들링 없음 [mobile/lib/webview_screen.dart] — 포털 라이브 후 하드닝
- [x] [Review][Defer] CI `supabase db lint`가 `|| true` 무신호 게이트 [.github/workflows/ci.yml] — CI 강화 Post-MVP(아키텍처 명시)

**Dismiss (노이즈/오탐, 4):** CORS credentials+wildcard(명시 origin이라 Starlette 정상 처리)·FastAPI docs URL이 nginx 경유(root_path 정상, health 동작)·패치 스코프(좁힌 diff 산물, 파일은 커밋됨)·tsc/lint 파일 "없음"(실제 커밋됨).

## Dev Notes

### ⚠️ 현재 상태 — 무엇이 이미 있고 무엇을 만들어야 하는가 (재작업 disaster 방지)

환경이 그린필드가 아니다. **이미 존재하므로 재생성·재초기화하지 말 것:**

| 항목 | 상태 | 행동 |
|---|---|---|
| git 저장소 | ✅ 초기화됨, 브랜치 `main` | `git init` **금지** |
| GitHub 원격 `origin` | ✅ `https://github.com/kuntae802/patient_management_system.git` | 재설정 불필요 |
| 초기 커밋 | ✅ `cd78339` (계획 산출물) | 이어서 단계별 커밋만 |
| `.gitignore` | ✅ 4개 서피스 전부 커버(node/python/supabase/flutter·시크릿·`.claude/`) | **갭만 보강**, 통째 교체 금지 |
| `README.md` | ✅ 스택·구조·산출물 문서화 ("코드 디렉토리는 Story 1.1에서 생성") | "현재 상태" 섹션만 UPDATE |
| `docs/project-context.md` | ✅ 존재(에이전트 규칙) | 변경 불필요 |
| `_bmad-output/` | ✅ 계획 산출물 + 본 스토리 | 코드 아님, 손대지 말 것 |

**아직 없으므로 이 스토리에서 생성(NEW):** `supabase/` · `api/` · `web/` · `mobile/` 디렉토리, 루트 `docker-compose.yml` · `.env.example`, `.github/workflows/ci.yml`, `deploy/`(프록시 템플릿), `docs/glossary.md`.

> **모노레포 루트 = 현재 작업 디렉토리** `/home/player_kt/patient_management_system`. 아키텍처 예시의 `hospital-pms/`는 예시 이름일 뿐, 실제 루트는 이 디렉토리다. 새 하위 폴더는 여기에 만든다.

### 관련 아키텍처 패턴·제약 (반드시 준수)

- **스키마 단일 소유:** DDL·RLS·트리거·pgcrypto는 `supabase/migrations/*.sql`이 단독 소유. **Alembic 미사용**, FastAPI에서 DDL 생성 금지. TS 타입은 `supabase gen types typescript`로 DB에서 생성(후속 스토리). [Source: architecture.md §스키마·마이그레이션 소유권]
- **데이터 접근 = 무ORM 하이브리드:** asyncpg + SQLAlchemy **Core** + RPC. **ORM 모델 클래스 금지.** (이 스토리에선 DB 코드 없음 — 구조만 마련.) [Source: project-context.md §Language-Specific Rules]
- **API 경로 분담:** 쓰기/명령=FastAPI(`/api/v1`, 상태 전이=액션 엔드포인트), 단순 조회=Supabase 직접(RLS), 실시간=Supabase 구독. [Source: architecture.md §API & Communication Patterns]
- **JSON 필드 = 전 경로 snake_case** (TS에서도 camelCase 변환 금지 — Supabase 직접 조회와 FastAPI 두 읽기 경로 일관성). [Source: project-context.md ⚠️비자명 핵심]
- **식별자 언어:** DB·API·코드 = 영문 snake_case. 한국어는 UI 라벨·주석·문서만. 신규 식별자는 `docs/glossary.md` 등재 후 사용. [Source: architecture.md §식별자 언어]
- **에러 봉투(후속 적용):** `{error:{code,message,detail}}` + HTTP(422/403/409/404/500), `code`=영문·`message`=한국어. 이 스토리의 `core/errors.py`는 스텁만. [Source: architecture.md §Format Patterns]

### 기술 스택 & 버전 (확정 — 임의 추가 금지)

| 레이어 | 기술/버전 | 스캐폴드 |
|---|---|---|
| 데이터/인증/스토리지 | Supabase (Postgres·Auth ES256/JWKS·Storage·Realtime) | `supabase init` |
| 애플리케이션 | FastAPI + uv + `fastapi[standard]` (Python 3.13) | `uv init` |
| 직원 웹+환자 포털 | Next.js 16 (React 19.2, TS, Tailwind 4) | `create-next-app` |
| 환자 모바일 | Flutter 3.44 + webview_flutter 4.x | `flutter create` |

추가 라이브러리(이 스토리 범위): web `@supabase/supabase-js @supabase/ssr`; api `pyjwt[crypto]` `supabase` `httpx`; mobile `webview_flutter`. [Source: architecture.md §확정 스택, §초기화 명령]

### 초기화 명령 (2026-06 웹 재검증 — 그대로 사용)

```bash
# 0) 저장소 — 이미 존재. git init / remote add 하지 말 것. 검증만:
git status && git remote -v

# 1) Supabase 로컬 스택 (Docker 필요)
supabase init
supabase start                 # 로컬 Postgres/Auth/Storage + 로컬 anon/service_role 키 출력

# 2) FastAPI (uv)
uv init api && cd api
uv add "fastapi[standard]" "pyjwt[crypto]" supabase httpx
uv run fastapi dev app/main.py   # root_path 반영, GET /health 확인
cd ..

# 3) Next.js 16 (Turbopack 기본)
npx create-next-app@latest web --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd web && npm i @supabase/supabase-js @supabase/ssr && cd ..
#   → next.config.ts 에 basePath: "/patient_management_system"

# 4) Flutter 웹뷰 셸
flutter create mobile
cd mobile && flutter pub add webview_flutter && cd ..
#   → android/app/build.gradle: minSdkVersion 24, INTERNET 권한
```

### 🌐 2026-06 최신 검증 — 버전 gotcha (구버전 구현 방지)

- **Supabase 키 체계 (구현 중 확인·정정):** 신규 `sb_publishable_…`(=anon 대체)·`sb_secret_…`(=service_role 대체)가 도입되어 레거시 anon/service_role는 **2026년 말 폐기** 예정. **✅ 실측(CLI v2.107.0, `supabase start`): 로컬 스택이 신규(`sb_publishable_/sb_secret_`)와 레거시(anon/service_role JWT) 키를 *둘 다* 발급**한다(사전 조사의 "로컬은 아직 anon/service만"은 구버전 기준 — 정정). → 로컬·클라우드 모두 신규 명칭(`*_PUBLISHABLE_KEY`/`*_SECRET_KEY`)으로 통일 사용. **로컬 키는 공유 데모 기본값 + 시크릿** → 반드시 gitignored `.env`/`.env.local`에만, 커밋 금지. [Source: supabase.com/docs §Migrating to publishable and secret API keys; 로컬 `supabase status` 실측]
- **Next.js 16:** Turbopack이 **stable·기본 번들러**(`--turbo`/experimental 플래그 불필요). 기본 셋업이 TS·Tailwind·ESLint·App Router·`@/*`를 포함. 선택적으로 `--turbopack --react-compiler` 명시 가능(필수 아님). [Source: nextjs.org/docs/app/getting-started/installation; akoskm.com Next.js 16 Turbopack stable]
- **uv + FastAPI:** `uv add "fastapi[standard]"`(또는 `uv add fastapi --extra standard`) 동치. FastAPI 팀이 uv를 공식 권장. `uv run fastapi dev`로 핫리로드. [Source: docs.astral.sh/uv §Using uv with FastAPI]
- **webview_flutter:** 최신 버전이 Android `minSdkVersion`을 19→**21**로 상향(파괴적), Java 11, 최소 Flutter 3.24/Dart 3.5. 아키텍처 타깃 **API 24+**가 더 높아 안전 — `android/app/build.gradle`의 `defaultConfig.minSdkVersion`을 명시적으로 24로. [Source: pub.dev/packages/webview_flutter_android changelog]

### 서브패스 전파 (단일 누락 = 로그인/실시간/딥링크 파손)

서브패스 `/patient_management_system`를 **4곳 전부**에 반영:

1. **web** — `next.config.ts` `basePath: "/patient_management_system"` (모든 라우팅·자산·redirect 전파).
2. **api** — `FastAPI(root_path="/patient_management_system/api")` (프록시 뒤 OpenAPI·경로 정합).
3. **Supabase Auth** — redirect URL을 `https://kuntae802.mooo.com/patient_management_system/...`로(클라우드 대시보드 설정값 + 코드 상수).
4. **Flutter** — `config.dart` base URL `https://kuntae802.mooo.com/patient_management_system`.
5. **CORS** — FastAPI·Supabase 화이트리스트에 `https://kuntae802.mooo.com`. [Source: architecture.md §Infrastructure & Deployment, project-context.md §Framework-Specific Rules]

### 보안·시크릿 경계 (이 스토리부터 강제)

- **시크릿 커밋 절대 금지.** `.env`는 `.gitignore`로 차단됨(확인만). 커밋되는 건 `.env.example`(키만, 값 없음)뿐.
- **service_role/secret 키는 서버 전용.** 웹엔 `NEXT_PUBLIC_` publishable 키만 노출. [Source: project-context.md 🚫금지, architecture.md §환경]
- **PII 미로깅** 원칙은 지금부터 — `core/logging.py` 스텁도 PII 마스킹 전제로 구조화. (실 로직은 후속.)

### 배포 현실 스코핑 (정직한 경계)

- `supabase start`·`flutter`·Docker는 **로컬 도구 가용성에 의존**. Docker 미가용 환경이면 `supabase init`까지만 수행하고 `supabase start`는 Docker 가용 환경에서 실행(폴백을 커밋 메시지·노트에 명시).
- **🟢 도구 검증 완료(2026-06-19):** supabase CLI 2.107.0 ✅ / Flutter 3.44.2 ✅ / Docker 29.4.0(데몬 실행) ✅ / uv 0.11.7 ✅ / node v24.15 ✅. **Android SDK는 미설치** — 그러나 `flutter create`·`flutter pub add webview_flutter`·build.gradle 수정·`flutter analyze`는 SDK 없이 동작하므로 **이 스토리(1.1)에 영향 없음**. **이 스토리에서 `flutter build apk`를 실행/검증하지 말 것** — APK 빌드(Android SDK 필요)는 Story 8.4 소유. Task 5의 mobile 검증은 `flutter analyze` 통과까지만.
- **Let's Encrypt 실제 인증서 발급은 홈서버 배포 시점 작업**이다. 이 스토리의 AC #6은 "설정이 서브패스를 일관 반영 + 프록시 **설정 템플릿** 커밋"까지이며, 데모 환경에서 실 인증서를 발급하지 않는다. [Source: architecture.md §Infrastructure & Deployment]

### 배포 토폴로지 — nginx(108) + Docker(110) (사용자 확정, issue_reaction 패턴)

사용자 기존 프로젝트와 **동일 패턴**. 참고: `/home/player_kt/issue_reaction_analysis/deploy/nginx_issues.conf` + `docker-compose.yml`.

- **108 서버** = nginx + SSL(Let's Encrypt) 공개 진입점, 도메인 `kuntae802.mooo.com`. `/etc/nginx/sites-enabled/kuntae802`의 `server {}`에 `location` 추가. **TLS 인증서는 108 소유** — 앱 리포는 발급하지 않음.
- **110 서버**(192.168.219.110) = Docker 컨테이너 호스트. 컨테이너 포트를 `192.168.219.110:<host>` LAN 바인딩 → 108 nginx가 프록시.
- **라우팅:** 외부 `…/patient_management_system` → 108 → `110:3002`(web) ; `…/patient_management_system/api` → `110:8060`(api).

| 서비스 | 110 호스트:컨테이너 포트 | 비고 |
|---|---|---|
| web (Next) | **3002**:3000 | basePath `/patient_management_system`, `output:standalone`, TZ=Asia/Seoul |
| api (FastAPI) | **8060**:8000 | root_path `/patient_management_system/api`, 브라우저가 직접 호출(공개 라우팅) |
| (Supabase) | — | **클라우드 관리형, compose에 없음**. 로컬 개발만 `supabase start` |

> **110 포트 충돌 회피:** 이미 사용 중 — issue_reaction 3000, intro-page 3001, tradingview 5174/8040, ira-backend 8050. → PMS는 **web 3002 / api 8060** 확정.

> **issue_reaction과의 차이(중요):** ① PMS는 Supabase 클라우드라 compose에 **db 서비스 없음**(issue_reaction은 pgvector+alembic) ② PMS는 브라우저가 **FastAPI 직접 호출**(Bearer)이라 `/api`도 **공개 라우팅**(issue_reaction backend는 127.0.0.1 내부 전용) ③ web 컨테이너 `TZ=Asia/Seoul`(SSR 시각 KST). [Source: pms-deployment-topology 메모리, issue_reaction_analysis/deploy/]

### Testing standards summary

- 이 스토리는 **토대 스캐폴드**라 도메인 테스트가 없다. 검증 = 각 서피스가 기동/렌더하는지(헬스 200, 서브패스 렌더, `supabase start` 기동, `flutter analyze` 통과).
- 테스트 하니스 골격만 자리: api `pytest`(`api/tests/`), web co-located `*.test.tsx`. **골든패스 E2E·커버리지 게이트는 Post-MVP**(지금 과도 명세 금지). [Source: project-context.md §Testing Rules]
- 검증 3계층(Zod→Pydantic→DB 제약)은 후속 스토리에서 살아남 — 지금은 경계만 마련.

### Project Structure Notes

- 목표 트리는 architecture.md §Complete Project Directory Structure를 **단일 진실**로 따른다(`api/app/{core,api/v1,schemas,services,db,internal}`, `web/src/{app/(staff|patient),components,lib,hooks,types}`, `supabase/{migrations,functions,seed.sql}`).
- 이 스토리에선 **스캐폴드가 만든 기본 구조 + 위 핵심 디렉토리 골격**까지만. 역할별 라우트(`(staff)/reception` 등)·마이그레이션 SQL·서비스 로직은 후속 스토리가 채운다(엔티티는 필요할 때만 생성 원칙).
- **변이(variance):** 아키텍처 트리는 `docs/`에 brief/prd/architecture를 두지만, 실제로는 BMad 산출물이 `_bmad-output/planning-artifacts/`에 있다. `docs/`는 `project-context.md`(존재) + `glossary.md`(이 스토리에서 생성)만 유지한다. README는 이 배치를 이미 반영.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.1] — 스토리 정의·6개 AC 원본
- [Source: _bmad-output/planning-artifacts/architecture.md#Starter-Template-Evaluation] — 확정 스택·초기화 명령·스캐폴드 결정
- [Source: _bmad-output/planning-artifacts/architecture.md#Project-Structure-&-Boundaries] — 모노레포 디렉토리 트리·경계
- [Source: _bmad-output/planning-artifacts/architecture.md#Infrastructure-&-Deployment] — 서브패스·프록시·CORS·키 체계
- [Source: docs/project-context.md#Critical-Implementation-Rules] — 식별자·snake_case·시크릿·PII·검증 규칙
- [Source: https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys] — publishable/secret 키 전환(로컬 CLI는 anon/service 유지)
- [Source: https://nextjs.org/docs/app/getting-started/installation] — Next.js 16 create-next-app(Turbopack 기본)
- [Source: https://docs.astral.sh/uv/guides/integration/fastapi/] — uv + FastAPI 표준 셋업
- [Source: https://pub.dev/packages/webview_flutter_android/changelog] — webview_flutter Android minSdk 21 상향
- [Source: /home/player_kt/issue_reaction_analysis/deploy/nginx_issues.conf, docker-compose.yml] — 사용자 확정 배포 패턴(nginx 108 / Docker 110, LAN 바인딩, X-Forwarded-* 헤더) 참고 원본

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context)

### Debug Log References

- **Supabase CLI 불완전 설치 수정:** `/usr/local/bin/supabase`에 shim만 있고 `supabase-go` 누락 → `start` 실패. v2.107.0 타르볼을 `~/.local/bin`(PATH 우선)에 완전 설치(shim+go)로 해소.
- **54324 일시 충돌:** `supabase start` 첫 시도가 inbucket 포트 충돌로 롤백 → `supabase stop --no-backup` 후 재시도 성공(10컨테이너 healthy).
- **로컬 키 체계 정정:** CLI v2.107.0은 로컬에서 신규(sb_publishable/sb_secret)+레거시(anon/service_role) 키를 **둘 다** 발급(사전조사 정정). 로컬 키는 gitignored `.env`에만.
- **포트 충돌(110 공유 박스):** `next start` 검증이 3000 점유(issue_reaction)와 충돌 → 빈 포트 3009로 검증. 배포 포트는 web 3002/api 8060 확정.
- **api 라우팅:** root_path=/patient_management_system/api + 라우터 prefix `/v1` → 외부 `/…/api/v1/*`. nginx api는 trailing-slash로 prefix strip, web은 basePath 보존.

### Completion Notes List

모노레포 4개 서피스 스캐폴드 + 배포 토대를 세웠다. 전 서피스 기동/렌더 검증 완료.

- ✅ **Supabase**: 로컬 스택 10컨테이너 healthy(API :54321/DB :54322/Studio :54323). migrations/seed 골격(SQL은 후속 스토리). config.toml auth redirect에 서브패스 반영.
- ✅ **FastAPI**: root_path·CORS·`/health`(실기동 200), core/ 스텁(PII 마스킹·에러 봉투·JWKS 자리), ruff+pytest 통과, Dockerfile.
- ✅ **Next.js 16**: basePath(서브패스 200/루트 404 검증)·standalone, supabase 라이브러리, build+lint 통과, Dockerfile.
- ✅ **Flutter**: webview 셸(minSdk 24·INTERNET), analyze+test 통과. (APK 빌드=Story 8.4, Android SDK 보류.)
- ✅ **배포**: docker-compose(web 3002/api 8060, db 없음·Supabase 클라우드), nginx conf(108용), CI 골격, glossary 시드.
- ⚠️ **커밋 미수행** — 메모리 규칙(승인제)에 따라 단계별 커밋은 사용자 승인 후 실행 예정.

### File List

**루트(신규):** `.env.example` · `docker-compose.yml` · `.github/workflows/ci.yml` · `deploy/nginx_patient_management_system.conf`
**루트(수정):** `.gitignore`(Android 서명키) · `README.md`(현재 상태)
**docs(신규):** `docs/glossary.md`
**supabase(신규):** `supabase/config.toml`(auth 수정) · `supabase/.gitignore` · `supabase/seed.sql` · `supabase/migrations/.gitkeep`
**api(신규):** `pyproject.toml` · `uv.lock` · `.python-version` · `README.md` · `.env.example` · `Dockerfile` · `app/main.py` · `app/__init__.py` · `app/core/{__init__,config,security,db,errors,logging}.py` · `app/api/__init__.py` · `app/api/v1/{__init__,router}.py` · `app/{schemas,services,db,internal}/__init__.py` · `tests/{__init__,test_health}.py`
**web(신규, 스캐폴드+편집):** `package.json` · `package-lock.json` · `next.config.ts`(편집) · `Dockerfile` · `.env.example` · `tsconfig.json` · `eslint.config.mjs` · `postcss.config.mjs` · `src/app/{layout.tsx,page.tsx,globals.css}` 외 create-next-app 산출물
**mobile(신규, 스캐폴드+편집):** `pubspec.yaml` · `pubspec.lock` · `lib/{main,config,webview_screen}.dart` · `test/widget_test.dart`(편집) · `android/app/build.gradle.kts`(편집) · `android/app/src/main/AndroidManifest.xml`(편집) 외 flutter create 산출물

### Change Log

| 날짜 | 변경 |
|---|---|
| 2026-06-19 | Story 1.1 구현 — 모노레포 4개 서피스 스캐폴드(supabase/api/web/mobile) + 배포 토대(docker-compose·nginx·Dockerfile·CI) + 용어집 시드. 전 서피스 기동/렌더 검증. Status → review. |
| 2026-06-19 | 코드 리뷰(3중 적대) — Patch 4 적용(NEXT_PUBLIC build args·CORS localhost·nginx 정확매치·compose healthcheck), Defer 5(deferred-work.md), Dismiss 4. 재검증 통과. Status → done. |
