---
baseline_commit: e4bc175d996b5f6b2c19398dd63b93fc4a75083e
---

# Story 1.5: FastAPI 인증·RBAC 강제 (JWKS + 권한 의존성)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **백엔드 개발자**,
I want **FastAPI가 Supabase JWT(JWKS)를 검증하고 `has_permission` 기반 권한 의존성을 모든 명령 엔드포인트에 강제하기를**,
so that **쓰기/명령의 권위가 서버에서 보장된다(UI 게이트와 무관하게).**

이 스토리는 **Epic 1 "인증 코어"의 백엔드 권위 계층**이다. RBAC 3계층(① UI 노출=웹 / ② **명령(쓰기) 강제=FastAPI** / ③ 행 강제=RLS) 중 **가운데 층**을 구현한다. 1.3이 만든 DB 프리미티브(`users`/`roles`/`permissions`/`role_permissions`, `has_permission(code)`·`auth_user_role()` SECURITY DEFINER, `audit_logs` 트리거)와 1.4가 발급하는 Supabase 세션 JWT 위에, FastAPI가 ① JWKS로 토큰을 검증하고 ② `has_permission(code)` 기반 권한 의존성을 명령 엔드포인트에 강제하며 ③ `{error:{code,message,detail}}` 에러 표준·snake_case OpenAPI를 일관 적용한다. 1.6(미들웨어·UI 게이트)·Epic 4~7의 모든 쓰기 엔드포인트가 이 위에 올라간다.

**보안 경계는 1.5(+RLS)이며 UI가 아니다** — So that 절의 "UI 게이트와 무관하게"가 이 경계를 명시한다.

[Source: epics.md#Story-1.5 L429-447; architecture.md#RBAC-3계층 L186; project-context.md L57·L59]

---

## Acceptance Criteria

> 출처: epics.md L437-447 (BDD 원문). FR-213(쓰기 권위) 충족. 401·DB 룩업 디테일은 아키텍처/본 스토리 결정으로 보강(§비자명 설계 결정).

**AC1 — JWKS 토큰 검증 (인증)**
**Given** 클라이언트가 `Bearer` 토큰을 첨부할 때
**When** FastAPI가 JWKS로 서명·`aud=authenticated`를 검증하면
**Then** 유효 토큰만 통과하고, 만료/위조 토큰은 **401**로 거부된다.

**AC2 — 권한 의존성 강제 (FR-213 쓰기 권위)**
**Given** 권한이 필요한 명령 엔드포인트에서
**When** 사용자의 역할 권한을 `has_permission(code)`로 확인하면
**Then** 권한 없는 요청은 `{error:{code,message,detail}}` 봉투와 함께 **403**으로 거부된다.

**AC3 — API 표준 일관성 (snake_case · 에러 코드)**
**Given** `/api/v1` 라우터에서
**When** OpenAPI 문서를 생성하면
**Then** JSON 필드가 **snake_case**이고 에러 표준(**422/403/409/404/500**, +401)이 일관 적용된다.

### 추가 검증(완료 정의)

- **AC4 (DB 권한 평가 — 단일 진실):** 권한 의존성은 권한 로직을 Python에서 재구현하지 않고 DB의 `has_permission(code)`(또는 동등 평가)를 호출한다. 휴직·퇴사 직원(`employment_status != 'active'`)은 권한이 무효이며(헬퍼 내장 필터), 직원 판정은 **5역할 집합**(`reception`/`doctor`/`nurse`/`radiologist`/`admin`, `patient` 제외)이다.
- **AC5 (감사 actor 주입 — 계약):** FastAPI(service_role)는 DB 세션에 **검증된 UUID 형태의 JWT `sub`**를 `request.jwt.claims`·`app.actor_id` GUC로 주입한다(쓰기 트랜잭션의 감사 actor 정확성·`auth.uid()` 해석의 전제). 미주입 시 감사 actor가 NULL이 된다.
- **AC6 (무PII 오류):** 인증/권한 실패 메시지·로그에 토큰·`sub`·이메일·원문 Supabase 오류를 노출하지 않는다(범용 한국어 `message` + 영문 기계용 `code`).
- **AC7 (회복력):** JWKS 키는 캐싱하고(매 요청 fetch 금지), JWKS 엔드포인트·DB 일시 장애는 전면 500이 아니라 깔끔한 **401/503**으로 폴백한다. 필수 env(`SUPABASE_JWKS_URL`·`SUPABASE_DB_URL`) 미설정은 **부팅 시 fail-fast**.
- **AC8 (테스트 가능):** 단위 테스트로 JWKS 검증(유효/만료/위조/`aud` 불일치)·권한 의존성(통과/403)·에러 봉투 형태를 커버. 부트스트랩 admin 계정 실제 JWT로 `GET /api/v1/auth/me` 200 + 무토큰 401 통합 실증. **골든패스 E2E는 Post-MVP**(과도 명세 금지).
- **AC9 (품질 게이트):** `uv run ruff check`·`uv run ruff format --check`·`uv run pytest` 통과. DDL/Alembic/ORM 모델 클래스 미생성(스키마 단일 소유 유지).

---

## Tasks / Subtasks

> 커밋·푸시는 **승인 시에만**. JSON 필드·DB 식별자는 **snake_case**(camelCase alias 금지). 에러 `message`는 한국어, `code`는 영문. **불변식(권한·상태머신)은 DB가 소유 — Python에서 재구현 금지**(호출·조립만).

- [x] **Task 1 — 설정 승격: pydantic-settings + fail-fast (AC7, deferred-work)**
  - [x] `api/pyproject.toml` — `pydantic-settings` 추가(`uv add pydantic-settings`). 테스트용 `pytest-asyncio` 추가(`uv add --dev pytest-asyncio`). 그 외 라이브러리 임의 추가 금지(`pyjwt[crypto]`·`httpx`·`supabase` **이미 설치됨**).
  - [x] `api/app/core/config.py` — 현재 `os.getenv` 스텁 `_Settings`를 **`pydantic_settings.BaseSettings`로 승격**. 필드: `supabase_jwks_url`(**필수**), `supabase_db_url`(**필수**), `supabase_secret_key`(선택·미설정 시 경고), `supabase_jwt_aud`(기본 `"authenticated"`), `supabase_jwt_iss`(선택), `api_root_path`(기본 유지), `cors_origins`(CSV 파싱 유지). `model_config = SettingsConfigDict(env_file=".env")`. 필수값 누락 시 **부팅에서 즉시 실패**(불투명 런타임 실패 방지). [deferred-work.md → 1.5]
  - [x] ⚠️ `SUPABASE_SECRET_KEY`(service_role/secret)는 **토큰 검증용이 아니다** — DB/Admin·supabase-py용 서버 전용 시크릿. **클라 노출·로그 금지**(§D-5). [project-context.md L82·L83]

- [x] **Task 2 — asyncpg 풀 + 인증 DB 세션 헬퍼 (AC4·AC5)**
  - [x] `api/app/core/db.py` — `SUPABASE_DB_URL`로 **asyncpg 풀** 생성/종료(FastAPI `lifespan`에서 startup/shutdown). 풀은 `app.state` 또는 모듈 싱글턴. (SQLAlchemy Core는 후속 쿼리에서, 1.5는 풀 + 권한 평가만.)
  - [x] `authenticated_conn(sub, ip=None)` **async 컨텍스트매니저** — 커넥션 획득 → 트랜잭션 시작 → `select set_config('request.jwt.claims', $1, true)`(JSON `{"sub":"<uid>","role":"authenticated"}`) + `select set_config('app.actor_id', $1, true)`(`<uid>`), 선택 `app.actor_ip`. `set_config(...,true)` = 트랜잭션 로컬(=`SET LOCAL`). 이것이 모든 후속 쓰기 엔드포인트가 상속할 **표준 "인증된 DB 세션"** 토대.
  - [x] ⚠️ `sub`는 **반드시 검증된 UUID 문자열**만 주입 — 비-UUID 주입 시 감사 트리거 `::uuid` 캐스트가 터져 트랜잭션 전체가 abort(자가-DoS, 1.3 P8). JWT `sub`는 UUID이나 방어적으로 형식 확인. [§D-3; 1-3 산출물 P8]
  - [x] ⚠️ DDL 생성·Alembic·ORM 모델 클래스 **금지**. `db.py`는 풀 + 명시 쿼리/RPC 호출만. [project-context.md L48·L77]

- [x] **Task 3 — JWKS 검증 의존성 (AC1·AC6·AC7)**
  - [x] `api/app/core/security.py` — `pyjwt`의 **`PyJWKClient(settings.supabase_jwks_url)`** 모듈 싱글턴(키 캐싱, 매 요청 fetch 금지). `Authorization: Bearer <token>` 추출 → `get_signing_key_from_jwt` → `jwt.decode(token, key, algorithms=["ES256"], audience=settings.supabase_jwt_aud, options={"require":["exp","sub","aud"]})`. iss는 설정 시 검증.
  - [x] `get_current_user` 의존성 → `CurrentUser`(Pydantic: `sub: UUID`, `email`, `aud`, 만료 등 비민감 클레임). `jwt.ExpiredSignatureError`·`InvalidAudienceError`·`InvalidTokenError`·`PyJWKClientError`·헤더 부재 → **401**(`AuthError`). JWKS 네트워크 장애는 **503**으로 폴백(전면 500 금지, 1.4 C2 정신).
  - [x] ⚠️ **토큰으로 RBAC 역할을 판단하지 말 것** — 커스텀 access token hook 미설치라 토큰엔 RBAC 역할/권한이 **없다**. 토큰 `role` 클레임은 Postgres 역할(`authenticated`)이지 RBAC 역할이 아님. 역할·권한은 항상 **DB 룩업**(`sub` → `users.role_id → roles.code`). [§D-1; 1-3/1-4 산출물]
  - [x] ⚠️ `PyJWKClient.get_signing_key_from_jwt`는 동기(첫 fetch는 blocking) → async 의존성에서 `anyio.to_thread.run_sync`로 감싸거나 캐시 워밍 고려(주석 명시).

- [x] **Task 4 — 권한 의존성 + 직원 의존성 (AC2·AC4)**
  - [x] `require_permission(code: str)` **의존성 팩토리** — `get_current_user` → `authenticated_conn(sub)`에서 `SELECT public.has_permission($1)` 평가(GUC로 `auth.uid()` 해석되므로 **DB 함수 재사용 = 단일 진실**). false → **403**(`ForbiddenError`, 봉투 `code="forbidden"`). [§D-2]
  - [x] `get_current_staff` 의존성 — `SELECT public.auth_user_role()` → NULL이거나 `patient`면 직원 아님 → **403**. 반환값 = 역할 코드(직원 5역할). 직원 전용 엔드포인트용. [§D-4]
  - [x] ⚠️ 권한 코드는 1.3 시드 **권한 카탈로그(23개)** 문자열만 사용(`patient.read`·`encounter.register`·`payment.process`·`audit.read`·`rbac.manage`·`user.manage`·`master.manage`·`dashboard.read` 등). **새 코드 임의 생성 금지**(에픽별 마이그레이션이 확장). [§Dev Notes 권한 카탈로그]
  - [x] ⚠️ 권한 캐시를 서버에 두지 말 것(캐시 경계=클라 TanStack Query뿐). 매 요청 DB 평가. [architecture.md L178·L381]

- [x] **Task 5 — 에러 봉투 + 예외 핸들러 (AC3·AC6)**
  - [x] `api/app/core/errors.py` — `AppError` 베이스(`code:str`·`message:str`·`detail`·`status_code`) + 서브클래스: `AuthError`(401, `code="unauthenticated"`), `ForbiddenError`(403, `code="forbidden"`), `ConflictError`(409, `code="conflict"`), `NotFoundError`(404). 봉투 = `{"error":{"code","message","detail"}}`.
  - [x] `init_error_handlers(app)` — `app.add_exception_handler`로: `AppError`→봉투, `RequestValidationError`→**422**(`code="validation_error"`, `message` 한국어, `detail`=필드 오류), `StarletteHTTPException`→봉투, 미처리 `Exception`→**500**(`code="internal_error"`, **내부정보·PII·스택 비노출**). `message`=한국어 / `code`=영문 기계용. [architecture.md L195·L268-270·L278]
  - [x] ⚠️ raw 주민번호·토큰·이메일·`sub`를 로그·`detail`·`message`에 노출 금지. [project-context.md L82·L84]

- [x] **Task 6 — main.py 배선 + 인증 증명 라우터 (AC1·AC2·AC3)**
  - [x] `api/app/main.py` — `lifespan`으로 asyncpg 풀 생성/종료. `init_error_handlers(app)` 호출. `/health` 유지(무인증). CORS·`root_path` 유지.
  - [x] `api/app/api/v1/auth.py` (NEW) — **증명/유틸 엔드포인트**: `GET /api/v1/auth/me`(의존성 `get_current_user`+`get_current_staff` → `{sub, role, is_staff, employee_no?, name?}` snake_case). 토큰 없음/무효 → 401. (선택) `require_permission`을 시연하는 가드 엔드포인트 1개. 라우터를 `router.py`에 include. **실제 도메인 엔드포인트(patients/encounters…)는 Epic 3+ 소유 — 여기선 인증·권한 토대 + 증명만.**
  - [x] ⚠️ Pydantic 응답 모델은 **snake_case 필드**(camelCase `alias_generator` 추가 금지) → OpenAPI가 snake_case 보장(AC3). [project-context.md L51; architecture.md L253]

- [x] **Task 7 — 단위·통합 테스트 (AC8)**
  - [x] **단위**(`api/tests/`, Supabase 불필요): EC 키쌍으로 로컬 ES256 토큰·미니 JWKS를 만들어 `PyJWKClient`를 monkeypatch → ① 유효 통과, ② 만료(`exp` 과거)→401, ③ `aud` 불일치→401, ④ 서명 위조→401. `require_permission`은 `app.dependency_overrides`/DB 평가 mock으로 ⑤ true→200, ⑥ false→403. ⑦ 에러 봉투 형태(`error.code`/`message`/`detail`) 검증.
  - [x] **통합**(`supabase start` 시만, 미기동 시 skip — conftest 패턴 상속): 로컬 token endpoint(`/auth/v1/token?grant_type=password`)로 `admin@pms.local`/`Staff1234` ES256 JWT 획득 → `GET /api/v1/auth/me` 200·`role="admin"`·`is_staff=true`. 무토큰 → 401.
  - [x] ⚠️ **403 통합 테스트의 닭-달걀:** 현재 직원은 admin(23권한 전부)뿐 → 자연스러운 403 불가. 권장: `supabase/seed.sql` dev 부트스트랩에 **권한 0인 비-admin 직원**(예: `doctor@pms.local`, role=`doctor` — 1.7 전까지 grant 0) 1명 추가 → 임의 `require_permission`이 403 산출(401/403/200 매트릭스 완성). 대안: 단위 테스트의 dependency_override로 403 보장. [§D-8]
  - [x] ⚠️ GoTrue gotcha(1.4): 로컬 token endpoint 오답 시 HTTP 400. 부트스트랩 계정은 `auth.identities` 행 필요·토큰 컬럼 `''` 채움(이미 seed에 반영).

- [x] **Task 8 — (선택) web env fail-fast 동봉 (deferred-work)**
  - [x] `deferred-work.md`가 1.5 env 하드닝에 **web `NEXT_PUBLIC_*` fail-fast**를 묶었음(`web/src/lib/supabase/{client,server,proxy}.ts`의 `process.env.X!`). 저비용이면 `web/src/lib/env.ts` 스키마 검증 동봉. **스코프 확장 우려 시 deferred 유지 가능**(1.5 핵심=API 인증). 결정·기록만 남길 것. [deferred-work.md → 1.5]

- [x] **Task 9 — 검증 + 문서 (AC9)**
  - [x] `uv run ruff check`·`uv run ruff format --check`·`uv run pytest` 통과. 통합은 `supabase start` 후 부트스트랩 토큰으로 수동 1회 확인.
  - [x] 신규 식별자 없음 예상(권한 코드는 1.3 카탈로그 소비). 새 식별자 발생 시 `docs/glossary.md` 등재. [project-context.md L70]

- [x] **Task 10 — 커밋 제안(승인 대기)**
  - [x] 의미 단위 커밋 초안(예: `feat(api): pydantic-settings 설정·fail-fast`, `feat(api): asyncpg 풀·인증 DB 세션`, `feat(api): JWKS 검증·has_permission 권한 의존성·에러 봉투`, `test(api): 인증·RBAC 단위/통합`). **푸시는 승인 후.**

### Review Findings

_코드 리뷰 2026-06-20 — 3레이어(Blind Hunter · Edge Case Hunter · Acceptance Auditor). **Acceptance Auditor: AC1~9 전부 SATISFIED, 위반 0**(라이브 DB·ruff·40 테스트 독립 재현). 아래는 헌터가 발견한 회복력·일관성·테스트 결함. decision-needed 0 · patch 9 · defer 2 · dismiss 5._

**Patch (수정 가능 — 명확)**

- [x] [Review][Patch] 인증 후 malformed 클레임(non-UUID `sub`·빈/비정상 `aud`) → 500 대신 **401** 매핑 [api/app/core/security.py `get_current_user`] — `CurrentUser(sub=claims["sub"])`의 Pydantic `ValidationError`/`aud[0]` `IndexError`가 `_decode_token` try 밖에서 발생해 `_unhandled_handler`→500. "malformed→401" 계약(AC1) 위반. 구성 블록을 try/except로 감싸 `AuthError`로. (blind+edge)
- [x] [Review][Patch] `PyJWKClient` **timeout** 추가 [api/app/core/security.py `_get_jwks_client`] — urllib 기본 무timeout → JWKS 호스트가 연결 후 정지(slowloris/hung upstream) 시 요청이 무한 행, anyio 스레드풀(기본 40) 고갈로 연쇄 행. 503도 아닌 hang. `timeout=5` 등 지정. (edge M4)
- [x] [Review][Patch] DB 풀 미초기화·asyncpg 런타임 오류 → 500 대신 **503** [api/app/core/db.py `fetch_*`] — `get_pool()` `RuntimeError`·`asyncpg.PostgresError`/`InterfaceError`·`asyncio.TimeoutError`(풀 고갈·연결 끊김·DB 재시작)가 `_unhandled_handler`→500. AC7("DB 일시 장애→503")과 `ServiceUnavailableError` 클래스 의도 미달(현재 503은 JWKS만). DB 헬퍼를 503으로 매핑. (edge H1+H2)
- [x] [Review][Patch] `fetch_staff_identity`가 `employment_status` 필터 없이 `users` 직접 조회 → 퇴사/휴직자 `/auth/me` 불일치 [api/app/core/db.py] — `role`은 `auth_user_role()`(active만)로 `None`이나 `employee_no`/`name`은 그대로 노출(토큰은 ≤1h 유효). `role is None`이면 프로필도 비노출하도록. (edge H3)
- [x] [Review][Patch] `actor_ip` GUC 데드 와이어링 제거 [api/app/core/db.py `authenticated_conn`] — `set_config('app.actor_ip',…)`를 감사 트리거가 읽지 않고 `audit_logs.ip_address`는 항상 NULL. 미참조 파라미터가 "IP 감사 중"으로 오인 유발. IP 감사는 트리거 변경과 함께 후속 추가 — 지금은 데드 와이어 제거. (edge L2+auditor C1)
- [x] [Review][Patch] `validate_runtime` 경고 추가 [api/app/core/config.py] — ① `jwt_issuer`가 None(비표준 JWKS URL+`SUPABASE_JWT_ISS` 미설정 → iss 검증 무음 비활성)일 때 경고, ② `cors_origins`에 `*` + `allow_credentials=True`일 때 경고. (blind H1+edge M1+M2)
- [x] [Review][Patch] `_http_exception_handler`가 4xx에서 프레임워크/라우터 `detail` 누출 [api/app/core/errors.py] — 알려진 상태(404 등)에서 영문 "Not Found" 또는 향후 민감 detail이 그대로 노출(>=500만 차단). "code=영문·message=한국어·내부정보 비노출" 계약(AC3/AC6) 위반. 알려진 상태코드는 표준 한국어 메시지 강제. (blind L2+edge M6)
- [x] [Review][Patch] 테스트 보강(커버리지 illusion 해소) [api/tests/*] — 단위 JWKS 테스트가 `_resolve_signing_key`를 monkeypatch로 우회해 **실 JWKS 해석·503 매핑·except 순서**가 미테스트(통합은 스택 down 시 skip). 추가: non-UUID `sub`→401, wrong `iss`→401, `_resolve_signing_key`의 `PyJWKClientConnectionError`→503/`DecodeError`→401, `get_current_staff`(직원 통과·patient/None→403), 프레임워크 404→봉투. (blind M2+M3+edge T1+T2+auditor C3)
- [x] [Review][Patch] 스토리 Completion Notes 테스트 수 정정 [story] — "단위 18 + 통합 6 + 기존 16"은 오집계(실: 신규 단위 13 + 통합 6 + 기존 21 = 40). (auditor)

**Defer (이월)**

- [x] [Review][Defer] 권한평가와 쓰기가 별도 트랜잭션 [api/app/core/db.py] — `require_permission`이 자체 `authenticated_conn`(GUC)으로 평가하고, 후속 쓰기 엔드포인트는 별도 트랜잭션을 열어야 감사 actor가 붙음 → 평가↔쓰기 사이 권한/재직상태 변경 TOCTOU. 1.5는 쓰기 없음(RLS 백스톱). **쓰기 엔드포인트 도입 에픽(3+)에서 "권한평가+쓰기를 한 트랜잭션에" 가이드.** (blind L3+auditor C2) — deferred
- [x] [Review][Defer] `validate_runtime` URL 형식 미검증 [api/app/core/config.py] — 비어있지 않은 malformed URL(스킴 누락 등)은 통과 → 첫 인증 요청에서 503/타임아웃(부팅 fail-fast 부분적). DB는 부팅 시 풀 연결로 이미 fail-fast. CI 강화(Post-MVP) 시 URL 스킴 검증. (edge M3) — deferred

---

## Dev Notes

### 의존성·기술 스택 (대부분 설치됨 — 추가는 명시된 것만)

| 항목 | 버전/위치 | 비고 |
|---|---|---|
| Python | **3.13** (`.python-version`, `requires-python>=3.13`) | uv |
| `fastapi[standard]` | `>=0.137.2` (설치됨) | uvicorn·pydantic·starlette 포함 |
| `pyjwt[crypto]` | `>=2.13.0` (**설치됨**) | JWKS 검증(`PyJWKClient`)·ES256. cryptography 포함 |
| `httpx` | `>=0.28.1` (설치됨) | 통합 테스트 토큰 획득·(필요시) JWKS fetch |
| `supabase` | `>=2.31.0` (설치됨) | 향후 Storage·Auth admin(1.5 핵심 아님) |
| `asyncpg` | **미설치 — Task 2에서 추가** | DB 풀(`uv add asyncpg`). 아키텍처 확정 스택 |
| `pydantic-settings` | **미설치 — Task 1에서 추가** | `.env` 로딩·fail-fast |
| `pytest` | `>=9.1.1` (dev, 설치됨) | `testpaths=["tests"]` |
| `pytest-asyncio` | **미설치 — Task 7에서 추가(dev)** | async 의존성 테스트 |
| `ruff` | `>=0.15.18` (dev, 설치됨) | line-length 100, select E/F/I/UP/B |

> ⚠️ `asyncpg`는 아키텍처 확정 스택(무ORM 하이브리드의 드라이버)이나 스캐폴드에 아직 없음 → Task 2에서 추가(스펙 내 승인 라이브러리). 그 외 새 라이브러리 임의 추가 금지.

[Source: api/pyproject.toml; architecture.md L197·L143; project-context.md L34]

### 인증 흐름 (아키텍처 확정)

```
web 로그인(1.4) → @supabase/ssr 쿠키 세션(ES256 JWT)
  → 명령/쓰기 시: web이 Authorization: Bearer <access_token> 첨부
  → [1.5] FastAPI 의존성 get_current_user: JWKS로 서명·aud=authenticated·exp 검증 → sub 추출
  → [1.5] require_permission(code): authenticated_conn(sub)에서 SELECT has_permission(code) → 403 게이트
  → 쓰기 트랜잭션: SET LOCAL request.jwt.claims + app.actor_id (감사 actor)
  (단순 조회는 web이 Supabase 직접 RLS, 실시간은 구독 — FastAPI 경유 아님)
```

[Source: architecture.md L106·L186·L193·L280; project-context.md L57·L59]

### JWT에 무엇이 있고 없는가 (zero-guessing — D-1의 근거)

- **토큰에 있음:** `sub`(=auth uid, UUID), `aud="authenticated"`, `email`, `role="authenticated"`(Postgres 역할 — **RBAC 역할 아님**), `exp`, `iss`, `app_metadata`(provider만), `user_metadata`(빈 객체).
- **토큰에 없음 → DB 룩업 필수:** 직원 RBAC 역할(`roles.code`), 권한 코드, 직원 여부, `employment_status`.
- **이유:** 커스텀 access token hook 미설치(`config.toml`의 `[auth.hook.custom_access_token]` 주석 처리). 마이그레이션에 auth hook 함수 없음.

[Source: supabase/config.toml(hook 비활성); supabase/seed.sql(raw_app_meta_data); 1-3/1-4 산출물]

### 1.3이 만든 RBAC 프리미티브 (1.5가 소비 — 정확한 시그니처)

- **`public.users`**(직원): `id uuid PK references auth.users(id)`(=auth uid), `employee_no`, `name`, `role_id uuid NOT NULL references roles(id)`(단일 역할 N:1), `license_type check in ('doctor','radiologist')`, **`employment_status not null default 'active' check in ('active','on_leave','terminated')`**. 직원 행 부재 = 비직원(환자/외부).
- **`public.roles`**: `code text UNIQUE` — 시드 6종 `reception`·`doctor`·`nurse`·`radiologist`·`admin`·`patient`. **`patient`는 직원 아님**.
- **`public.permissions`**: `code text UNIQUE`(`<resource>.<action>`), `resource`, `action`. **`role_permissions`** = N:M.
- **`public.has_permission(perm_code text) RETURNS boolean`** [`sql STABLE SECURITY DEFINER SET search_path=public`] — `role_permissions⋈permissions`를 `role_id=(select role_id from users where id=(select auth.uid()) and employment_status='active')`로 평가. **`auth.uid()` 의존 → service_role 연결에선 NULL → GUC 주입 필요(§D-2).**
- **`public.auth_user_role() RETURNS text`** [동일 속성] — active 직원의 `roles.code`, 비직원 = NULL.
- 두 함수 모두 `GRANT EXECUTE TO authenticated, service_role`.
- **`public.audit_logs`** + `audit_trigger_fn()`: actor 캡처 우선순위 `nullif(current_setting('app.actor_id', true),'')::uuid` → fallback `auth.uid()`. **append-only 삼중 강제**(RLS deny·REVOKE UPDATE/DELETE·BEFORE 트리거 RAISE). 트리거 부착 = `roles`·`permissions`·`role_permissions`·`users`. **절대 audit_logs UPDATE/DELETE 금지.** 조회 게이트 = `has_permission('audit.read')`.

[Source: supabase/migrations/0002_identity_rbac.sql·0003_rls_helpers.sql·0004_audit.sql; 1-3 산출물]

### 권한 카탈로그 (1.3 시드 23개 — require_permission 인자)

```
patient.read · patient.create · patient.update · patient.reveal_rrn
encounter.register · encounter.start · encounter.complete
medical_record.write · diagnosis.attach · prescription.create
examination.order · treatment.order · treatment.perform · vital.record
appointment.read · appointment.create · appointment.cancel
payment.process · master.manage · dashboard.read
user.manage · rbac.manage · audit.read
```

> ⚠️ **현재 `admin`에만 23권한 전부 grant**(부트스트랩). 타 역할(reception/doctor/…) grant는 **Story 1.7(권한 매트릭스 UI)**이 채움 → 1.5 시점엔 비-admin 직원은 사실상 권한 0. 통합 테스트는 admin으로만 권한 통과 검증 가능(403 테스트는 §D-8).

[Source: supabase/migrations/0002_identity_rbac.sql; 1-3 산출물]

### 비자명 설계 결정 (DISASTER 방지 — 반드시 준수)

- **D-1 (JWT는 RBAC 역할을 담지 않음 — DB 룩업 필수):** 커스텀 access token hook 미설치 → 토큰엔 `sub`/`aud`/`exp`만 권위 있고 **RBAC 역할·권한은 없다**. FastAPI는 JWKS로 인증 검증 후 **`sub`로 DB를 조회**해 역할·권한을 해석한다. 토큰 `role` 클레임(`authenticated`)을 RBAC 역할로 오인하지 말 것. [§JWT에 무엇이…]
- **D-2 (service_role 연결의 `auth.uid()`=NULL — GUC로 함수 재사용):** `has_permission()`/`auth_user_role()`는 내부에서 `auth.uid()`를 쓰는데, FastAPI는 **service_role 연결**이라 `auth.uid()`가 NULL → 그냥 호출하면 항상 false/null. **권장: `authenticated_conn`에서 `SET LOCAL request.jwt.claims='{"sub":"<uid>",...}'`를 설정한 뒤 `SELECT has_permission($1)` 호출** → `auth.uid()`가 sub로 해석되어 **DB 함수를 그대로 재사용**(권한 로직 단일 진실, 아키텍처 "불변식은 DB 소유, 서비스는 호출만"). 대안(직접 sub-파라미터 동등 쿼리)은 로직 중복·드리프트 위험 → 비권장. 동등 쿼리를 쓸 경우 **`and employment_status='active'` 필터 누락 금지**(휴직/퇴사자 권한 누수). [architecture.md L380; 1-3 D-3]
- **D-3 (감사 actor 주입 계약):** 쓰기 트랜잭션마다 `SET LOCAL app.actor_id='<sub>'`(검증된 UUID) + (권장) `request.jwt.claims`를 설정해야 감사 트리거가 actor를 정확히 기록한다. 미설정 시 actor=NULL. **비-UUID 문자열 주입 금지** — 트리거 `::uuid` 캐스트 실패가 원본 쓰기 트랜잭션 전체를 abort(자가-DoS, 1.3 P8). [1-3 산출물 §D-3·P8]
- **D-4 (직원 판정 = 5역할 집합, patient 제외):** `auth_user_role()` 반환이 non-null이어도 `patient` 역할이면 직원 아님(1.4 C1 버그 재발 금지). 직원 = `{reception,doctor,nurse,radiologist,admin}`. [1-4 Review C1]
- **D-5 (비대칭 JWKS 검증 — SECRET_KEY로 검증 금지):** 토큰은 Supabase **공개 JWKS(ES256)**로 검증(`PyJWKClient`). `SUPABASE_SECRET_KEY`(service_role/secret)는 **DB·Admin용 서버 시크릿**이지 토큰 검증 키가 아니다 — HS256 대칭 검증을 시도하지 말 것. 검증 항목: 서명 + `aud="authenticated"` + `exp`(+ iss 설정 시). [architecture.md L101·L183·L189; project-context.md L82]
- **D-6 (스코프 경계 — UI/매트릭스/계정관리 제외):** 1.5 = **FastAPI 명령(쓰기) 권위**만. **미들웨어 RBAC·UI 노출 게이트(`usePermissions`)는 1.6**, **권한 매트릭스 토글 UI(FR-211)는 1.7**, **직원 계정·재직상태 관리(FR-214/215)는 1.8**이 소유 — 만들지 말 것. 1.4의 스톱갭 라우트 가드는 보안 경계가 아니므로 **의존하지 말고** 모든 명령 엔드포인트에서 `require_permission`을 독립 강제. [epics.md#Story-1.6/1.7/1.8; 1-4 Resolution]
- **D-7 (DB 풀 최소 도입):** 1.5가 `core/db.py` asyncpg 풀 + `authenticated_conn` 헬퍼를 **도입**한다(권한 평가에 DB 접근 필수). 단 도메인 쿼리·서비스 패턴은 만들지 않음 — **풀 생명주기 + GUC 주입 인증 세션**이라는 재사용 토대만(후속 에픽이 그 위에 쿼리를 얹음). [architecture.md L197·L262·L333]
- **D-8 (403 테스트 닭-달걀):** 권한 0 직원이 없어 자연 403 불가 → ① 권장: dev 부트스트랩에 비-admin 직원(role=`doctor`, grant 0) 추가해 401/403/200 매트릭스 완성, ② 보장: 단위 테스트 dependency_override로 403 케이스. seed 변경은 dev-only 부트스트랩 확장(1.4 패턴 상속). [§Task7; 1-4 §Task7]

### 보안·PII 경계 (엄수)

- **무PII 오류(AC6):** 인증/권한 실패의 `message`는 범용 한국어("인증이 필요합니다"·"권한이 없습니다"), `code`는 영문 기계용. **토큰·`sub`·이메일·원문 Supabase/DB 오류를 봉투·로그·`detail`에 노출 금지.** 500은 내부정보·스택 비노출. [project-context.md L71·L84; architecture.md L278]
- **시크릿 서버 전용:** `SUPABASE_SECRET_KEY`·`SUPABASE_DB_URL`은 서버 전용 — 응답·로그·클라 노출 금지. publishable만 클라. [project-context.md L82]
- **방어심층·환자 스코핑(전방위 원칙):** FastAPI는 service_role로 **RLS를 우회**하므로, 환자 대상 엔드포인트에선 **JWT `sub`(세션 uid)로 본인 경계를 직접 강제**해야 한다(클라 제공 `patient_id` 미신뢰 = IDOR 방지). 단 **환자 테이블·엔드포인트는 Epic 3/8 소유** — 1.5는 이 원칙을 의존성·문서로 확립하되 환자 엔드포인트를 구현하지 않는다. RLS는 클라 직접 경로의 1차 방어로 별도 유지. [architecture.md L106·L187; project-context.md L84]
- **append-only 감사:** `audit_logs`를 UPDATE/DELETE하지 말 것(트리거가 RAISE). 앱 발신 `read`/`login` 이벤트는 service_role로 직접 INSERT만. [1-3 산출물]

### 상태 관리·경로 분담 (엄수)

- **쓰기=FastAPI(service_role) / 단순조회=Supabase 직접(RLS) / 실시간=구독.** 1.5는 쓰기/명령 권위 층만. 서버측 권한 캐시 없음(캐시 경계=클라 TanStack Query). [project-context.md L59; architecture.md L178·L381]
- **상태 전이는 액션 엔드포인트**(`POST /encounters/{id}/register`, status PATCH 아님) — 1.5는 토대만, 실제 전이는 후속 에픽. 잘못된 전이=409는 에러 표준에 포함(핸들러 준비). [project-context.md L57]

### Project Structure Notes

- 수정/생성 파일:
  - `api/app/core/config.py` (UPDATE — pydantic-settings·fail-fast)
  - `api/app/core/db.py` (UPDATE — asyncpg 풀·`authenticated_conn`)
  - `api/app/core/security.py` (UPDATE — JWKS 검증·`get_current_user`·`require_permission`·`get_current_staff`)
  - `api/app/core/errors.py` (UPDATE — `AppError` 계층·`init_error_handlers`)
  - `api/app/main.py` (UPDATE — lifespan 풀·에러 핸들러 등록·인증 라우터 include, `/health` 보존)
  - `api/app/api/v1/auth.py` (NEW — `GET /auth/me` 증명 + require_permission 시연)
  - `api/app/api/v1/router.py` (UPDATE — auth 라우터 include)
  - `api/pyproject.toml` (UPDATE — asyncpg·pydantic-settings·pytest-asyncio)
  - `api/tests/test_auth_jwks.py`·`test_rbac_permission.py`·`test_errors.py` (NEW — 단위), `test_auth_integration.py` (NEW — 통합, supabase 시만)
  - `supabase/seed.sql` (UPDATE — 선택: 비-admin dev 부트스트랩 직원, §D-8)
  - (선택) `web/src/lib/env.ts` (NEW — §Task8, deferred 유지 가능)
- 보존(깨면 안 됨): `/health` 엔드포인트(compose healthcheck 의존)·`root_path=/patient_management_system/api`·CORS 설정·`Dockerfile`/`docker-compose.yml`(api 서비스 env·포트 8060→8000·healthcheck). `tests/conftest.py`의 `psql` fixture·supabase-start skip 패턴 **상속**(통합 테스트가 재사용). `tests/test_migrations_identity.py`(1.3 검증) 유지.
- 네이밍: Python `snake_case`(함수·모듈)·`PascalCase`(Pydantic). 라우터 파일 `api/v1/<resource>.py`. `/api/v1` prefix. JSON·쿼리 snake_case.
- **스키마 단일 소유:** DDL은 Supabase 마이그레이션만. FastAPI는 DDL 생성 금지(Alembic·ORM 금지). [project-context.md L48·L72·L77; architecture.md L262·L330-345]

[Source: architecture.md L328-345(api 구조)·L378-381(경계); api/ 스캐폴드 현황]

### 이전 스토리 인텔리전스 (상속)

- **1.1:** api 스캐폴드(`app/{core,api/v1,schemas,services,db,internal}`·`tests/`), `pyproject.toml`(`fastapi[standard]`·`pyjwt[crypto]`·`httpx`·`supabase`·pytest·ruff), `Dockerfile`(uv·포트 8000)·`docker-compose.yml`(api `8060:8000`·healthcheck `/health`·env 주입)·`.env.example`(`SUPABASE_DB_URL`·`SUPABASE_JWKS_URL`·`SUPABASE_SECRET_KEY`·`API_ROOT_PATH`·`CORS_ORIGINS`). `core/{security,db,errors,logging}.py`는 **TODO 스텁**(1.5가 채움).
- **1.3:** RBAC 스키마·`has_permission()`·`auth_user_role()`·`audit_logs`/트리거(0002~0004). **`has_permission`/`auth_user_role` 행동 테스트는 1.5 통합으로 명시 이월**(1.3은 user 무시드). `SET LOCAL app.actor_id` 감사 계약·비-UUID 캐스트 자가-DoS(P8).
- **1.4:** Supabase Auth 로그인·ES256 JWT·`@supabase/ssr` 세션·분기(`auth_user_role()`). dev 부트스트랩 **`admin@pms.local`/`Staff1234`**(uid `000000a1-0000-4000-8000-0000000000a1`, role=admin·23권한). GoTrue NULL-token gotcha·token endpoint 400 패턴. `patient` 역할 직원 오분류 버그(C1)·Auth 장애 fail-safe(C2) 교훈.
- **공통 규율:** 커밋·푸시 승인 시에만. JSON snake_case. dev 구동 `supabase start` + `uv run fastapi dev` + `npm run dev`.

[Source: 1-1·1-3·1-4 산출물; deferred-work.md; api/ 스캐폴드]

### 현재 api/ 스캐폴드 상태 (요약)

- ✅ 구현: `main.py`(FastAPI·`root_path`·CORS·`/health`·v1 라우터 include), `config.py`(os.getenv 스텁), `api/v1/router.py`(빈 라우터), `tests/{conftest,test_health,test_migrations_identity}.py`.
- ❌ TODO 스텁(1.5가 채움): `core/security.py`·`core/db.py`·`core/errors.py`·`core/logging.py`(주석만).
- ❌ 빈: `schemas/`·`services/`·`db/`·`internal/`(`__init__.py`만).
- env: `.env`는 gitignore(개발자 수동 생성), `.env.example`에 변수명 정의됨.

[Source: api/ 디렉터리 인벤토리]

### 테스트 (이 스토리 범위)

- **단위(pytest):** JWKS 검증(유효/만료/위조/aud 불일치 — 로컬 EC 키·미니 JWKS monkeypatch), 권한 의존성(통과/403 — dependency_override), 에러 봉투 형태. 브라우저·실 Supabase 불필요.
- **통합(pytest, `supabase start` 시만 — 미기동 skip):** 부트스트랩 admin 토큰으로 `GET /auth/me` 200, 무토큰 401, (부트스트랩 비-admin 추가 시) 403.
- **이월:** 골든패스 E2E 하니스·커버리지 게이트 = Post-MVP(과도 명세 금지). 역할별 grant(reception/doctor/…)는 1.7 후 충실해짐. [project-context.md L63-65]

### References

- [Source: epics.md#Story-1.5 L429-447] — AC 원문(JWKS·has_permission 403·snake_case/에러표준)
- [Source: epics.md#Epic1 L317-321; #Story-1.6/1.7/1.8 L449-510] — 에픽 목표·다운스트림 분담(스코프 경계)
- [Source: architecture.md L101-102·L183·L280] — Supabase ES256/JWKS·aud=authenticated·인증 흐름
- [Source: architecture.md L186·L232·L380-381] — RBAC 3계층·has_permission(SECURITY DEFINER)·불변식 DB 소유
- [Source: architecture.md L106·L187·L193] — service_role+RLS 방어심층·읽기/쓰기 경로 분담
- [Source: architecture.md L195·L268-270·L278] — 에러 봉투·HTTP 코드·예외 핸들러·PII 비노출
- [Source: architecture.md L197·L262·L328-345·L378] — 무ORM 하이브리드·api 디렉터리·core/security 경계
- [Source: project-context.md L48·L51·L57·L59·L82·L84] — 무ORM·snake_case·액션 엔드포인트·경로 분담·시크릿/PII 경계
- [Source: supabase/migrations/0002·0003·0004*.sql] — users/roles/permissions/role_permissions·has_permission·auth_user_role·audit
- [Source: supabase/config.toml; supabase/seed.sql] — auth hook 비활성(토큰 무RBAC)·부트스트랩 admin 계정
- [Source: 1-3-...db.md; 1-4-...auth.md; deferred-work.md] — 감사 actor 계약·P8·C1/C2 교훈·env fail-fast 이월
- [Source: api/pyproject.toml·main.py·core/*.py·tests/*] — 스캐폴드 현황(CREATE vs UPDATE)

---

## Dev Agent Record

### Context Reference

- 실행 환경: Supabase 로컬 스택 기동(`supabase start` — DB `:54322`, API `:54321`, Studio `:54323`). 0001~0004 마이그레이션 적용(users·RBAC·감사). 로컬 키는 `supabase status`.
- 핵심 DB 계약: `SELECT public.has_permission('<code>')`·`SELECT public.auth_user_role()` — service_role 연결에선 `request.jwt.claims` GUC(`sub`)로 `auth.uid()`를 해석시킨 뒤 호출. 쓰기는 `app.actor_id` GUC 동반.
- 부트스트랩: `admin@pms.local`/`Staff1234`(role=admin·23권한). 403 테스트용 비-admin은 §D-8.
- 추가 의존성(이 스토리): `asyncpg`·`pydantic-settings`·`pytest-asyncio`(dev).

### Agent Model Used

claude-opus-4-8[1m] (Claude Opus 4.8, 1M context) — BMad dev-story 워크플로

### Debug Log References

- **사전 실측(가정 금지):** 로컬 JWKS 엔드포인트 = ES256 EC P-256(`kid` 매칭), admin 토큰 `aud=authenticated`·`iss=http://127.0.0.1:54321/auth/v1`·`role=authenticated`·`sub=000000a1…a1`. → D-1/D-5 확정.
- **GUC 재사용 실증:** `set_config('request.jwt.claims', '{"sub":…}', true)` 주입 후 `auth.uid()` 해석 → `auth_user_role()='admin'`·`has_permission('rbac.manage')=true`. DB 함수 단일 진실 재사용 경로(D-2) 검증.
- **🐛 회귀 발견·수정(실 HTTP 스모크가 포착):** 위조 토큰 `eyJ….fake.sig`가 처음엔 **500**. 원인 = `PyJWKClient.get_signing_key_from_jwt`가 `jwt.DecodeError`(PyJWTError 계열, `PyJWKClientError` 아님)를 던져 `_resolve_signing_key` 누수. 단위 테스트는 `_resolve_signing_key`를 monkeypatch로 우회해 못 잡음. → 수정: connection 오류(503) 먼저 잡고 나머지 `jwt.PyJWTError`를 401로 폴백. 통합 회귀 테스트(`test_forged_token_returns_401`) 추가.
- **실 HTTP 스모크(uvicorn :8099, .env 없이 기본값 부팅):** lifespan `validate_runtime`(SECRET_KEY 경고)·풀 생성 정상. 무토큰 `/v1/auth/me`→401 · admin→200(snake_case 신원) · admin `/v1/auth/check`→200 · doctor(권한0)→403 봉투 · 위조→401.
- **검증 게이트:** `ruff check` All passed · `ruff format --check` 24 files formatted · `pytest` **48 passed**(신규 단위 21 + 통합 6 + 기존 health/migrations 21 — 코드리뷰 후속이 단위 8 추가). OpenAPI 검증: `MeResponse` snake_case·HTTPBearer 스킴·`/v1/auth/*` 노출·`/health` 무인증.

### Completion Notes List

구현 요약 — FastAPI 인증/RBAC 권위 계층: JWKS(ES256) 검증 의존성 + `has_permission(code)` 권한 의존성 + 단일 봉투 에러 표준 + pydantic-settings fail-fast + asyncpg 풀(GUC 인증 세션).

**AC 충족:** AC1✅(JWKS 검증: 유효 통과·만료/위조/aud불일치/누락/malformed→401) · AC2✅(`require_permission`→403 봉투, FR-213) · AC3✅(OpenAPI snake_case + 에러표준 401/403/404/409/422/500/503) · AC4✅(DB `has_permission` 재사용·`employment_status=active` 내장·직원 5역할) · AC5✅(`request.jwt.claims`+`app.actor_id` GUC 주입) · AC6✅(무PII 오류·422 input 비노출·500 내부 비노출) · AC7✅(JWKS 캐싱 `cache_jwk_set`·401/503 폴백·부팅 fail-fast) · AC8✅(48 테스트) · AC9✅(ruff·pytest, DDL/Alembic/ORM 무).

**구현 결정 준수:** D-1(토큰 무RBAC→DB 룩업) · D-2(GUC로 DB 함수 재사용, 로직 미재구현) · D-3(`app.actor_id` UUID만 주입, `authenticated_conn`) · D-4(직원 5역할, `patient` 제외) · D-5(공개 JWKS 검증, `SECRET_KEY`로 검증 안 함) · D-6(UI/매트릭스/계정관리 미구현) · D-7(풀+`authenticated_conn` 토대만, 도메인 쿼리 무) · D-8(seed에 권한0 `doctor@pms.local` 추가 → 401/403/200 통합 매트릭스).

**해소·이월:** deferred-work의 API `SUPABASE_*` fail-fast ✅해소(pydantic-settings+`validate_runtime`). **Task 8(web `NEXT_PUBLIC_*` env fail-fast)는 결정상 재이월** — 1.5는 백엔드 범위라 web `lib/env.ts`는 1.6(web 작업)으로 이월(deferred-work 갱신). 증명 엔드포인트 `GET /v1/auth/{me,check}`는 영구 제공(web 신원 확인·권한 시연에 재사용). 실 도메인 명령(POST)은 Epic 3+가 `require_permission`을 적용.

**비자명 메모:** `PyJWKClientConnectionError ⊂ PyJWKClientError ⊂ PyJWTError`라 except 순서 중요(connection→503 먼저, 나머지 PyJWTError→401). `ruff format`이 기존 `conftest.py`·`test_migrations_identity.py`를 포맷 정규화(로직 무변경, `-w` diff로 확인).

### File List

- `api/app/core/config.py` (UPDATE — pydantic-settings 승격·`validate_runtime` fail-fast·`cors_origins_list`/`jwt_issuer`)
- `api/app/core/db.py` (UPDATE — asyncpg 풀 lifecycle + `authenticated_conn`(GUC 주입) + `fetch_has_permission`/`fetch_user_role`/`fetch_staff_identity`)
- `api/app/core/security.py` (UPDATE — JWKS `PyJWKClient` 검증·`get_current_user`·`require_permission`·`get_current_staff`·`STAFF_ROLES`·`CurrentUser`)
- `api/app/core/errors.py` (UPDATE — `AppError` 계층(Auth/Forbidden/NotFound/Conflict/ServiceUnavailable)·`init_error_handlers`(401/403/404/409/422/500/503 봉투·422 detail 위생))
- `api/app/main.py` (UPDATE — `lifespan`(검증+풀)·`init_error_handlers`·`cors_origins_list`, `/health` 보존)
- `api/app/api/v1/auth.py` (NEW — `GET /auth/me`·`GET /auth/check`(require_permission 시연)·`MeResponse` snake_case)
- `api/app/api/v1/router.py` (UPDATE — auth 라우터 include)
- `api/pyproject.toml` (UPDATE — asyncpg·pydantic-settings·pytest-asyncio + `asyncio_mode=auto` + ruff `extend-immutable-calls`)
- `api/uv.lock` (UPDATE — 신규 의존성 잠금)
- `api/tests/test_auth_jwks.py` (NEW — JWKS 검증 단위 6)
- `api/tests/test_rbac_permission.py` (NEW — 권한 의존성 단위 2)
- `api/tests/test_errors.py` (NEW — 에러 봉투 단위 5)
- `api/tests/test_auth_integration.py` (NEW — 실 토큰·DB 401/403/200 + 위조→401 통합 6)
- `api/tests/conftest.py` (UPDATE — ruff format 정규화, 로직 무변경)
- `api/tests/test_migrations_identity.py` (UPDATE — ruff format 정규화, 로직 무변경)
- `supabase/seed.sql` (UPDATE — dev 부트스트랩 `doctor@pms.local`(role=doctor·권한0) 추가, 명단 루프化)
- `_bmad-output/implementation-artifacts/deferred-work.md` (UPDATE — API `SUPABASE_*` fail-fast ✅해소·web env 재이월 기록)

## Change Log

| 날짜 | 변경 | 작성 |
|---|---|---|
| 2026-06-20 | Story 1.5 구현 — JWKS(ES256) 검증 의존성·`has_permission` 권한 의존성·직원 게이트, 단일 에러 봉투(401/403/404/409/422/500/503)·pydantic-settings fail-fast·asyncpg 풀(GUC `request.jwt.claims`+`app.actor_id` 인증 세션)·증명 라우터(`/v1/auth/me`·`/check`). dev 부트스트랩 doctor 계정 추가. 실 HTTP 스모크로 위조토큰 500→401 회귀 수정(DecodeError 폴백). ruff·pytest 40 통과·OpenAPI snake_case 검증. Status → review | dev-story (Opus 4.8) |
| 2026-06-20 | 코드 리뷰(3레이어) 후속 — patch 9건 적용: 클레임 비정상(non-UUID sub·빈 aud)→401·DB 장애→503·`PyJWKClient` timeout·`fetch_staff_identity` 퇴사자 프로필 비노출·`actor_ip` 데드와이어 제거·iss/CORS 경고·4xx 한국어 봉투 강제·테스트 8 보강(503/non-UUID/iss/staff/404)·테스트수 정정. defer 2(권한평가↔쓰기 트랜잭션·URL 검증) → deferred-work. dismiss 5(H4 오탐 등). ruff·pytest **48 통과**·실 HTTP 404 한국어 봉투 확인. Status → done | code-review (Opus 4.8) |
