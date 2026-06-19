---
project_name: 'patient_management_system'
user_name: 'Player_kt'
date: '2026-06-19'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'code_quality_rules', 'workflow_rules', 'critical_dont_miss_rules']
existing_patterns_found: 0
source: 'architecture.md §Implementation Patterns & Consistency Rules (그린필드 — 코드 패턴 0, 규칙은 아키텍처에서 도출)'
status: 'complete'
rule_count: 23
optimized_for_llm: true
---

# Project Context for AI Agents

_이 파일은 AI 에이전트가 이 프로젝트의 코드를 구현할 때 반드시 따라야 할 핵심 규칙·패턴을 담는다. LLM이 놓치기 쉬운 비자명한(unobvious) 디테일에 집중한다. 충돌 시 우선순위: 본 파일 = 아키텍처 결정의 요약·강제 레이어._

---

## Technology Stack & Versions

> 출처: `_bmad-output/planning-artifacts/architecture.md` (확정 스택, 2026-06 기준 상호 호환 검증). **새 라이브러리 임의 추가 금지** — 아키텍처 결정 우선.

**서피스·레이어:**

| 레이어 | 기술 (버전) | 역할 |
|---|---|---|
| 데이터/인증/스토리지 | **Supabase** — Postgres / Auth(ES256·JWKS) / Storage / Realtime | 시스템 오브 레코드. RLS·수가 트리거·상태 전이 제약·감사 트리거를 **DB가 강제**. 스키마 단일 소유. |
| 애플리케이션 | **FastAPI** + uv + `fastapi[standard]` (Python 3.13) | 다단계 명령 오케스트레이션(수납 트랜잭션·진료비 PDF·시뮬 이음매). JWKS 검증 + RBAC. |
| 직원 웹 + 환자 포털 | **Next.js 16** (React 19.2, TS, Tailwind 4) | 직원 6역할(데스크톱) + 반응형 환자 포털. |
| 환자 모바일 | **Flutter 3.44** + `webview_flutter` 4.x | 반응형 웹을 띄우는 얇은 네이티브 셸 → APK. |

**프론트엔드 라이브러리:** shadcn/ui(컴포넌트 소유) · TanStack Query v5(서버상태) · Zustand(UI상태) · TanStack Table(그리드) · React Hook Form 7 + Zod 4(Pydantic의 거울) · `Intl` ko-KR(날짜·통화).

**데이터 접근(무ORM 하이브리드):** asyncpg · SQLAlchemy **Core**(ORM 모델 ❌) + RPC 호출 · supabase-py(Storage·Auth admin) · PyJWT/JWKS. 타입 = Pydantic + 생성 TS 타입.

**스키마 소유권:** DDL·RLS·트리거·pgcrypto = **Supabase CLI 마이그레이션**(`supabase/migrations/*.sql`) 단일 소유. **Alembic 미사용**(스키마 이중 소유 금지). TS 타입은 `supabase gen types typescript`로 DB에서 생성(= 계약).

**툴체인:** Ruff(Python) · ESLint + Prettier(TS) · Dart analyzer. 생성 TS 타입 = 계약. CI(GitHub Actions)가 게이트.

**배포:** 홈서버 Docker Compose(`web`+`api`) + Supabase 클라우드 관리형. 리버스 프록시 + Let's Encrypt. 도메인 `kuntae802.mooo.com`, 서브패스 `/patient_management_system`(Next `basePath` · FastAPI `root_path=/patient_management_system/api` · Supabase Auth redirect · CORS · Flutter 웹뷰 base URL 전부 반영).

## Critical Implementation Rules

> LLM이 기본값으로 틀리기 쉬운 비자명(unobvious) 규칙 중심. 출처 = `architecture.md §Implementation Patterns & Consistency Rules`.

### Language-Specific Rules

- **Python(FastAPI):** 함수·변수·모듈 `snake_case`, 클래스 `PascalCase`(Pydantic `EncounterCreate`), 상수 `UPPER_SNAKE`. 데이터 접근은 **asyncpg + SQLAlchemy Core + RPC** — **ORM 모델 클래스 금지**, **Alembic 금지**(스키마 단일 소유 = 마이그레이션).
- **TypeScript:** 변수·함수 `camelCase`, 컴포넌트·타입 `PascalCase`, 훅 `useX`, 파일 `kebab-case`(shadcn 관습). `types/database.types.ts`는 **생성물(계약)** — 손으로 수정 금지, 마이그레이션 후 `supabase gen types`로 재생성.
- **Dart(셸):** `lowerCamelCase`, 파일 `snake_case`. 표면적 최소.
- ⚠️ **비자명 핵심:** **JSON 필드는 전 경로에서 `snake_case`** — TS에서도 camelCase로 바꾸지 말 것. 이유: Supabase 직접 조회가 snake_case를 반환하고 두 읽기 경로(FastAPI/Supabase)가 일관해야 함.

### Framework-Specific Rules

- **Next.js 16:** App Router, route group `(staff)`/`(patient)` + 미들웨어 가드. `basePath=/patient_management_system`가 **모든 라우팅·자산·redirect에 전파**(누락 시 로그인/실시간/딥링크 깨짐). 역할 화면은 클라이언트 컴포넌트.
- **상태 분리(엄수):** 서버상태=**TanStack Query v5**(키=배열 `['encounters', id]`·`['worklist', role]`, mutation·실시간 시 invalidate), UI상태=**Zustand** 슬라이스, 세션=Supabase 클라이언트. **서버 데이터를 Zustand에 넣지 말 것.**
- **FastAPI:** `/api/v1`, **상태 전이는 액션 엔드포인트**(`POST /encounters/{id}/register` — status PATCH 아님). `root_path=/patient_management_system/api`. 모든 명령에 JWKS 검증(`aud=authenticated`) + `has_permission()` 의존성.
- **실시간:** `postgres_changes` → TanStack Query 캐시 invalidate(`useQueueRealtime`/`useWorklistRealtime`), 신선도 ≤5초, 초과 시 쓰기 가드.
- ⚠️ **비자명 핵심:** **불변식은 DB가 소유**(트리거·RPC·제약) — 상태머신·수가 로직을 Python/TS에서 재구현하지 말 것. FastAPI는 오케스트레이션·호출만. **쓰기=FastAPI(service_role) / 단순조회=Supabase(RLS) / 실시간=구독**.

### Testing Rules

- Python: `pytest`(`api/tests/`, unit·integration). 웹: co-located `*.test.tsx` + `e2e/`.
- 검증은 **3중**: 클라 Zod(즉시 UX) → 서버 Pydantic(권위) → DB 제약(최종선). 테스트도 이 경계를 반영.
- 골든 패스 E2E 하니스·커버리지 게이트는 **Post-MVP**(아키텍처 명시). 지금 과도 명세 금지.

### Code Quality & Style Rules

- **린트:** Ruff(Python) · ESLint+Prettier(TS) · Dart analyzer. **생성 TS 타입 = 계약**(CI 게이트).
- **식별자 언어:** DB·API·코드 = 영문 snake_case. 한국어는 UI 라벨·주석·enum 표시명·문서만. **신규 식별자는 `docs/glossary.md` 등재 후 사용**(예: encounter=내원, order=오더, fee_item=수가항목).
- **포맷:** 성공=리소스/배열 직접, 목록=`{data:[...], meta:{page,page_size,total}}`. 에러=`{error:{code,message,detail}}` + HTTP(422 검증/403 권한/409 전이/404/500), `code`=기계용 영문·`message`=한국어. 날짜=ISO 8601(timestamptz UTC 저장→KST는 `Intl`). 금액=**KRW 정수**(소수 없음).
- **구조:** 기능 단위 + 공용 `ui/`/`core/`. `api/app/{core,api/v1,schemas,services,db,internal}` · `web/src/{app/(staff|patient),components/ui,components/<feature>,lib,hooks,types}`.

### Development Workflow Rules

- **모노레포** + 의미 단위(스키마/인증/진료/…) **단계별 커밋**. Story 1.1에서 `git init`+원격. **커밋·푸시는 승인 시에만.**
- **마이그레이션:** Supabase CLI 단일 소유, 순번 `0001~0014`. **FastAPI에서 DDL 생성 금지.**
- **개발 구동:** `supabase start` + `uv run fastapi dev` + `npm run dev`. 모바일은 웹뷰 URL만.

### Critical Don't-Miss Rules (Anti-patterns · Security · Gotchas)

- 🚫 **금지:** DB/JSON camelCase 혼용 · 즉흥 한국어 식별자 · 응답마다 제각각 래퍼 · **raw 주민번호 로깅** · 클라만 검증 · **service_role 키 클라 노출**.
- 🔒 **보안 MUST:** RLS는 service_role(FastAPI) 사용에도 **방어심층으로 유지**(환자 본인 경계 = FastAPI JWT 주체 + DB RLS 이중). **감사로그 append-only**(`audit_logs` UPDATE/DELETE 절대 금지). pgcrypto 키는 **Vault만**. 주민번호 = 암호화 + HMAC blind index + 마스킹, **reveal = 권한 게이트 + 감사 이벤트**.
- 🔒 **PII 경계:** raw 주민번호/PII는 로그·토스트·에러봉투·**URL·딥링크·실시간 페이로드·PDF/파일명·클라 로그**에 금지. 라우트=`chart_no`/불투명 id. 실시간 select-list는 민감 컬럼 제외. 환자 포털=세션 uid 스코프(클라 제공 patient_id 미수용).
- ⚙️ **상태/안전:** 정의된 전이만(잘못된 전이=409, 역행·건너뛰기 없음). **mutation 중 버튼 disable**(이중 제출=처치 중복방지 1차선), 재수행 차단은 상태머신이 최종선(FR-093).

---

## Usage Guidelines

**AI 에이전트용:**

- 코드 구현 **착수 전 이 파일을 읽는다**. 모든 규칙을 문서 그대로 따른다.
- 모호하면 **더 제한적인 옵션**을 택한다(특히 보안·PII).
- 상충 시 우선순위: 본 파일 = 아키텍처 결정의 강제 요약. 세부는 `architecture.md`·`epics.md` 참조.
- 새 패턴이 생기면 이 파일을 갱신하고, 신규 식별자는 `docs/glossary.md`에 먼저 등재한다.

**사람용:**

- 이 파일을 린하게 유지(에이전트가 놓치기 쉬운 비자명 규칙만). 당연한 조언은 넣지 않는다.
- 기술 스택·패턴이 바뀌면 갱신. 주기적으로 점검해 시대에 뒤진 규칙 제거.
- 무거운 정책 본문이 아니라 "도로 규칙(rules of the road)" 수준으로.

Last Updated: 2026-06-19
