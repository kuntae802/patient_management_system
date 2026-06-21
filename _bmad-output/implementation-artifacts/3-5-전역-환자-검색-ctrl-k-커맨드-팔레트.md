---
baseline_commit: 892a3a8
---

# Story 3.5: 전역 환자 검색 (Ctrl K 커맨드 팔레트)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 직원,
I want 어느 화면에서든 `Ctrl K`로 환자를 이름·차트번호·연락처로 찾기를,
so that 베테랑의 키보드 속도로 환자에 즉시 도달한다.

## Acceptance Criteria

1. **AC1 — 전역 `Ctrl K` 커맨드 팔레트 + 검색 (UX-DR5·UX-DR24):** 직원 셸(`(staff)`)의 **어느 화면에서든** `Ctrl K`(Windows 우선; Mac 개발 편의로 `⌘K`도 방어적 허용 — 표기는 항상 "Ctrl K")로 커맨드 팔레트가 열린다. 팔레트의 검색 입력에 타이핑하면 **이름·차트번호·연락처(phone)** 로 환자가 검색되고, 결과 목록이 렌더된다. 결과 개수 변화는 **`aria-live="polite"`** 영역으로 안내된다("N명 검색됨" / "검색 결과 없음" — PII 미낭독, 개수·상태만). 팔레트는 모달(포커스 트랩 + 열 때 검색 입력에 초기 포커스 + `Esc`/백드롭으로 닫고 닫을 때 트리거로 포커스 복원), 결과 목록은 **키보드 완전 조작**(↑/↓ 이동, `Enter` 선택). 탑바의 기존 `Ctrl K` 자리 버튼(`topbar.tsx`)이 팔레트 트리거가 된다(클릭으로도 열림).

2. **AC2 — 검색 결과에서 환자 선택 → 환자 상세 풀페이지 이동:** 결과에서 환자를 선택(클릭 또는 `Enter`)하면 **환자 상세 풀페이지**(`/patients/{id}` — Story 3.2가 만든 공유 풀페이지)로 이동하고 팔레트가 닫힌다. 이동 식별자는 **환자 `id`(UUID, 불투명·PII 아님)** — `chart_no`/주민번호 같은 식별자를 URL에 노출하지 않는다.

3. **AC3 — 결과의 주민번호 기본 마스킹 + per-row reveal 없음 (UX-DR22) + 오환자 방지 가드레일(임상안전):** 검색 결과 각 행의 주민번호는 **기본 마스킹**(`resident_no_masked`)으로만 표시되고 **per-row reveal 동작은 없다**(reveal=직원이 상세/배너에서 타인 RRN을 권한 게이트로 볼 때 — 목록·검색 표면 아님). 동명이인·차트번호 오타로 인한 **오환자 이동을 줄이기 위해** 각 결과 행은 **이름 + 차트번호 + 생년월일(birth_date) + 마스킹 주민번호 + 연락처**를 식별 단서로 함께 표시한다(임상안전 리뷰 §Ctrl-K disambiguation; "마지막 내원일"은 내원 데이터=Epic 4라 본 스토리 비범위). 검색어(`q`)·결과 PII는 토스트·에러봉투·**클라 로그**에 echo하지 않는다.

4. **AC4 — RBAC 노출 + 권한 강제(방어심층):** 팔레트 트리거(탑바 버튼)와 `Ctrl K` 단축키는 **`patient.read` 권한 보유 직원에게만** 노출된다(`usePermissions().has("patient.read")` — 미보유 시 버튼 미렌더 + 단축키 미등록, 사이드바 RBAC 게이트 선례 동형). API는 이와 무관하게 `require_permission("patient.read")`로 권한을 강제(미보유 → 403; UI 게이트는 dead-403 UX 방지·방어심층). 환자(비직원) 세션에는 직원 셸 자체가 없어 도달 불가.

> **이월·교차절단 인수 조건(이 스토리에서 확인):** ① **신규 마이그레이션 0건** — 검색은 `0009_patients.sql`의 기존 컬럼(`name`/`chart_no`/`phone`)과 `idx_patients_name`(L60)으로 수행. **새 `0010_*.sql` 생성 금지**(다음 번호 0010 = Epic 4, glossary L184). `phone` 검색 인덱스는 미생성(MVP ILIKE 수용, 성능 인덱스는 하드닝 이월 — §결정 D-1). ② **`is_active`(soft-delete) 미필터 유지** — `fetch_patients` 검색도 비활성 미필터(현재 환자 비활성화 플로우 부재 → 도달 불가; 단독 필터 추가 시 `fetch_patient`/`update`와 불일치). 기존 deferred-work L30 범위에 검색 경로 추가 확인(신설 금지). ③ **검색어 PII-in-URL/로그 갭** — `?q=`에 이름·연락처(PII)가 실려 nginx/uvicorn 액세스 로그에 남을 수 있음. 본 스토리는 구조적 로그에 `q` 미기록 + 라우트 PII 부재로 1차 대응, **액세스 로그 스크러빙/`POST` 검색 전환은 보안 하드닝 이월**(§결정 D-2·Open Q #1, 은폐 아님).

## Tasks / Subtasks

- [x] **Task 1 — FastAPI 검색 파라미터 추가 (마이그레이션 없음) (AC1, AC3, AC4)**
  - [x] 1.1 `api/app/api/v1/patients.py` `list_patients`(L79-88): `q: str | None = Query(default=None, max_length=100)` 추가. 시그니처·게이트(`require_patient_read`)·페이지네이션은 유지. `q`를 `patients_service.list_patients(user.sub, q=q, page=page, page_size=page_size)`로 전달. docstring 한 줄 보강("이름·차트번호·연락처 검색 — Story 3.5"). **`q`를 로그/print 하지 말 것**(PII).
  - [x] 1.2 `api/app/services/patients.py` `list_patients`(L73-78): `q: str | None = None` 파라미터 추가 → `db.fetch_patients(sub, q=q, page=page, page_size=page_size)`로 위임. 변환(`_to_list_item`)·반환 셰이프 불변.
  - [x] 1.3 `api/app/core/db.py` `fetch_patients`(L1134-1154): `q: str | None = None` 추가. **`q`가 None/공백이면 기존 동작**(전체 목록 최신순). 비공백이면 `_op` 안에서 WHERE 절 구성:
    - `term = q.strip()` (서비스/라우터에서 이미 trim 가능하나 db에서도 방어).
    - `digits = re.sub(r"\D", "", term)` (연락처 자릿수만 — 하이픈 무관 검색).
    - WHERE: `name ILIKE '%'||$term||'%'` **OR** `chart_no ILIKE $term||'%'`(차트번호=숫자 식별자, 접두 매칭) **OR** (`digits != ''` 일 때) `regexp_replace(coalesce(phone,''),'\D','','g') LIKE '%'||$digits||'%'`. ILIKE 와일드카드 메타문자(`%`/`_`)는 파라미터 바인딩으로 안전(SQL 인젝션 없음)하되, 사용자가 입력한 `%`/`_`를 리터럴로 보려면 `ESCAPE` 또는 `term`의 `%_\` 이스케이프 고려(선택 — MVP는 바인딩만으로 충분).
    - 정렬: 검색 시 `order by name asc, created_at desc`(이름 사전순 — 동명이인 묶임) 또는 기존 `created_at desc` 유지(택1, 일관 정렬이면 무방). `limit $page_size offset $offset` 유지.
    - `total`도 **동일 WHERE**로 count(검색 시 페이지 메타 정확성). 파라미터 인덱스($1/$2/...) 정합 주의.
    - 컬럼 투영 `_PATIENT_LIST_COLUMNS`(L1042) **불변** — `id, chart_no, name, birth_date, sex, resident_no_masked, phone, is_active, created_at`(마스킹·식별 단서 전부 포함, `_enc`/`_hash` 제외). `import re`가 db.py 상단에 있는지 확인(없으면 추가).
  - [x] 1.4 `docs/glossary.md` 확인(신규 DB 식별자 없음): `patient`/`chart_no`/`resident_no_masked`/`patient.read`는 이미 등재. 선택 — `GET /patients?q=`(전역 환자 검색 3.5) 한 줄 메모(라우트 어휘 근거). **새 마이그레이션·컬럼·인덱스 금지**(L184 다음 번호 0010=Epic 4).
- [x] **Task 2 — FastAPI 검색 테스트 (AC1, AC3, AC4)**
  - [x] 2.1 `api/tests/test_patients_integration.py` 확장(신규 파일 불요): 시드/생성한 환자들로 — (a) 이름 부분일치(`q=홍`) → 해당 환자 포함·무관 환자 제외, (b) 차트번호 접두(`q=0000`) → 매칭, (c) 연락처 검색(하이픈 유/무 둘 다 — `q=010-1234`·`q=01012345`) → 동일 매칭, (d) `q` 없음/공백 → 전체 목록(기존 동작 회귀), (e) 무매칭 → `data=[]`·`meta.total=0`, (f) 페이지 메타(`total`)가 검색 필터 반영, (g) **마스킹 검증** — 응답에 `resident_no_masked`만·`resident_no_enc`/`resident_no_hash` 부재, (h) `patient.read` 미보유 토큰 → 403.
  - [x] 2.2 위생: 통합은 스택/`SUPABASE_SECRET_KEY`(blind_index/암복호 Vault 의존) 미설정 시 skip(3.1 패턴). 생성 환자는 `try/finally` 정리(또는 db reset). 검색 단언은 **응답 echo가 아니라 필터 정확성**(포함/제외 집합)으로(2.6 patch 정신).
- [x] **Task 3 — 웹 검색 lib (AC1, AC2, AC3)**
  - [x] 3.1 `web/src/lib/reception/patients.ts`(또는 신규 `lib/patient/search.ts`): `PatientListItem` 타입(snake_case 거울 — `id`·`chart_no`·`name`·`birth_date`·`sex`·`resident_no_masked`·`phone`·`is_active`·`created_at`)과 `PatientPage`(`{data, meta:{page,page_size,total}}`) 타입 추가(기존 `Patient` 상세 타입과 별개·경량). `searchPatients(q: string, signal?: AbortSignal): Promise<PatientListItem[]>` = `apiFetch<PatientPage>(\`/v1/patients?q=\${encodeURIComponent(q)}&page_size=20\`, { signal }).then(r => r.data)`. `encodeURIComponent` 필수(한글·공백). page_size는 팔레트 표시 상한(예 20). **검색어를 `console.log` 하지 말 것**(PII).
  - [x] 3.2 표시 헬퍼(선택): 생년월일 포맷(`Intl` ko-KR 또는 ISO 그대로), 성별 라벨 등 기존 `lib/reception/patients.ts` 헬퍼 재사용(중복 정의 금지).
- [x] **Task 4 — 웹 커맨드 팔레트 컴포넌트 (AC1, AC2, AC3, AC4)**
  - [x] 4.1 `web/src/components/shell/patient-search-command.tsx`(client, 신규): 전역 `Ctrl K` 환자 검색 팔레트. Base UI `Dialog`(`@base-ui/react/dialog` — admin 폼 8곳 선례) 기반. 책임:
    - **트리거 버튼:** 현 `topbar.tsx` L30-41의 검색 자리 버튼 마크업(스타일·`aria-label`·`kbd` "Ctrl K")을 **이 컴포넌트가 렌더**(`Dialog.Trigger` 또는 onClick으로 open). 디자인 토큰·접근성 라벨 보존.
    - **전역 단축키:** `useEffect`로 `document` `keydown` 리스너 등록 — `(e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k"` → `e.preventDefault()` + open 토글. 입력 필드 포커스 중에도 동작(브라우저 기본 Ctrl K 가로채기). 언마운트 시 해제.
    - **모달 본문:** 검색 입력(autofocus — Dialog 초기 포커스) + 결과 리스트. 입력 변경 → **디바운스(예 200ms)** 후 `searchPatients`. 진행 중 이전 요청 `AbortController.abort()`(경쟁 결과 방지). 최소 글자(예 1자) 미만이면 호출 안 함.
    - **결과 렌더(AC3 가드레일):** 각 행 = `이름 · 차트번호 · 생년월일 · 마스킹 주민번호(tabular-nums) · 연락처`. 행은 `<li role="option">`(listbox 패턴) 또는 버튼 — 키보드 ↑/↓로 활성 항목 이동(`aria-activedescendant` 또는 roving), `Enter`=선택. 상태(로딩·결과없음·에러)는 **색 비의존**(아이콘+텍스트).
    - **aria-live:** 결과 개수/상태를 `aria-live="polite"` 영역에 "N명 검색됨"/"검색 결과 없음"/"검색 중…"으로 안내(**PII 미낭독 — 개수·상태만**).
    - **선택 동작:** `useRouter().push(\`/patients/\${item.id}\`)` + 팔레트 close + 입력 리셋. (이동 식별자=UUID.)
    - **닫기:** `Esc`/백드롭 = Base UI Dialog 기본(포커스 복원 내장). 닫을 때 query/결과 state 초기화.
    - **RBAC 게이트:** `usePermissions().has("patient.read")` false면 **트리거·단축키·Dialog 전부 미렌더/미등록**(early return). `usePermissions`는 `PermissionsProvider` 컨텍스트 필요(셸 내부라 보장 — sidebar.tsx L57 선례).
  - [x] 4.2 `web/src/components/shell/topbar.tsx`: L30-41의 정적 placeholder 버튼을 `<PatientSearchCommand />` 렌더로 **교체**(주석 "(실동작 Story 3.5)" → 실동작 반영). import 추가. 나머지 탑바 요소(사이드바 토글·브레드크럼·시계·알림·아바타) 불변. `Search` 아이콘 import가 팔레트 컴포넌트로 이동하면 topbar에서 미사용 import 정리(eslint).
  - [x] 4.3 키보드/포커스 모델 점검: Base UI Dialog의 포커스 트랩·복원·`Esc`는 기본 제공. **복합 위젯 키보드 모델**(UX-DR19·EXPERIENCE L153)은 리스트 ↑/↓/Enter 수준이면 충족(roving-tabindex 또는 `aria-activedescendant`). `master-search-picker.tsx`(Base UI Combobox, L184-289)의 키보드·`Combobox.Status`(aria-live) 패턴을 **참고**(단 Combobox는 "값 선택"용 — 팔레트는 "페이지 이동"이라 Dialog+수동 리스트 권장; Combobox-in-Dialog는 선택지로 가능).
- [x] **Task 5 — 웹 테스트 (AC1, AC2, AC3, AC4)**
  - [x] 5.1 `web/src/lib/.../search.test.ts`(또는 `patients.test.ts` 확장): `searchPatients` URL 구성(`encodeURIComponent`·`page_size`)·응답 `.data` 추출, 타입 매핑(snake_case 유지). `apiFetch` mock.
  - [x] 5.2 `web/src/components/shell/patient-search-command.test.tsx`: (a) `Ctrl K`로 열림(keydown 디스패치), (b) 입력→디바운스→결과 행에 **생년월일·마스킹 주민번호·연락처** 표시(오환자 가드레일), (c) 결과에 **full RRN(마스킹 안 된 13자리) 미표시**, (d) 행 선택 → `router.push("/patients/{id}")`(UUID), (e) `aria-live` 영역에 개수 안내(PII 문자열 미포함), (f) `usePermissions` `patient.read` 미보유 시 트리거 미렌더. `@testing-library/react` + `user-event`. mock: `useRouter`·`usePermissions`·`apiFetch`.
  - [x] 5.3 위생: `tsc --noEmit`·`eslint` 클린. set-state-in-effect 등 선례 예외는 1줄 disable + 사유. 전체 회귀 green(`vitest run`).

### Review Findings

_코드리뷰 2026-06-21 (Blind Hunter / Edge Case Hunter / Acceptance Auditor 병렬). **Acceptance Auditor: 위반 0** — AC1·2·3·4 + 이월 인수 ①~③ + 결정 D-1~D-3 + project-context(PII·snake_case·새 라이브러리 금지) 전부 충족. decision-needed 0 / patch 4 / defer 4 / dismiss 3._

- [x] [Review][Patch] ILIKE 와일드카드(`%`·`_`) 미이스케이프 — `q="%"` 가 `strip()` 후에도 살아남아 검색 경로를 타고 **전 환자 마스킹 PII 반환**(공백-차단 우회), `q="_"` 는 임의 1글자 매칭. 파라미터 바인딩이라 인젝션은 아니나 LIKE 메타문자가 리터럴로 처리 안 됨(docstring "와일드카드 안전" 주장은 부정확) [api/app/core/db.py fetch_patients]. Blind+Edge **Med**.
- [x] [Review][Patch] 디바운스 정착 전 `Enter` 가 stale 결과 선택 — "홍길동" 입력 중 200ms 디바운스 동안 이전 검색어("홍길") 결과가 남아 있을 때 Enter → **현재 입력과 무관한 환자 상세로 이동(오환자 라우팅)**. `settled` 플래그가 있으나 Enter 핸들러가 미검사 [web/src/components/shell/patient-search-command.tsx onInputKeyDown]. Edge **Med**(임상안전).
- [x] [Review][Patch] 검색 결과 silent 잘림 안내 부재 — 상위 20건만 표시·페이지네이션 UI 없음. 동명이인 21명+ 시 21번째 이후 도달 불가인데 "더 정확히 입력" 힌트가 없어 조용히 잘림(임상안전 오환자·누락; 스펙 Open Q #4 "상위 20 + 안내" 중 안내 미구현) [web/src/components/shell/patient-search-command.tsx]. Blind+Edge **High/Med**.
- [x] [Review][Patch] `aria-activedescendant` 가 존재하지 않는 `-opt-undefined` 가리킬 수 있음 — 가드가 `results.length>0` 만 보고 `activeIndex < results.length` 는 안 봄 → 찰나에 활성 옵션 id 가 undefined [web/src/components/shell/patient-search-command.tsx]. Blind+Edge **Low/Med**(a11y).
- [x] [Review][Defer] 짧은 숫자/정렬 매칭 노이즈 — `q="010"` 가 거의 모든 연락처에 부분일치(휴대폰 전부 010), 이름에 숫자가 섞이면 `digits` 가 전화번호 OR 조건을 항상 추가. + 한글 `name asc` 정렬이 콜레이션/NFC 의존이라 상위 20 컷오프 흔들림 [api/app/core/db.py] — deferred. 최소 자릿수 하한·정렬 정규화는 검색 튜닝 결정(패치 #1·#3 으로 영향 완화). Blind+Edge Low.
- [x] [Review][Defer] 한글 IME 조합 중 Ctrl K / Esc — IME on(조합 중)일 때 `e.key` 가 "Process"라 Ctrl K 미동작 가능, Esc 1회는 조합 취소만(팔레트 닫기 2회 필요). `isComposing` 미고려 [web/src/components/shell/patient-search-command.tsx] — deferred. 한국어 IME UX 엣지(키보드 단축키 하드닝에서 일괄). Edge Low.
- [x] [Review][Defer] 입력 비운 직후 200ms 결과 잔존 — 빈 입력 클리어가 setTimeout 안이라 이전 마스킹 결과가 디바운스 동안 잔존(닫으면 즉시 초기화) [web/src/components/shell/patient-search-command.tsx] — deferred. 마스킹 PII·200ms·활성 사용 중이라 영향 경미, 팔레트 UX 폴리시에서. Blind Med→Low.
- [x] [Review][Defer] `apiFetch` 가 `AbortError` 를 `network_error` 로 변환 → catch 가 에러종류 아닌 `signal.aborted` 로 분기(현재 정상) [web/src/lib/api/client.ts·patient-search-command.tsx] — deferred. 버그 아님(동작 검증). 향후 apiFetch 가 abort 를 resolve 로 바꾸면 깨질 암묵 결합만 명시. Edge Med(설계 노트).

_dismiss 3: ① chart_no 부분일치(접두 아님) — Completion Notes 에 의도·정당화 기재(접두의 상위집합, zero-pad gotcha 회피, 누락 0) ② `?q=` 액세스 로그 PII(이름/전화) 미스크러빙 — 스펙 D-2·이월 ③ 에 명시 이월(은폐 아님, mask_pii 백스톱은 RRN만=deferred-work L113) ③ aria-live 중복 — 시각 `<p>`는 live 영역 아님, status div 단일 출처(테스트 selector 로 분리)._

## Dev Notes

### ⚠️ 먼저 내재화 — 마이그레이션 신규 작성 금지 (가장 흔한 실수)

**3.5는 DB 스키마를 바꾸지 않는다.** 검색에 필요한 컬럼(`name`·`chart_no`·`phone`)과 이름 인덱스(`idx_patients_name`, `0009_patients.sql:60`)가 이미 존재한다. glossary L184가 "**다음 마이그레이션(내원 등 Epic 4)은 0010부터**"를 못박았다. 검색 성능용 `idx_patients_phone`을 추가하고 싶더라도 **새 `0010_*.sql`을 만들면 Epic 4 번호와 충돌·드리프트**(Epic 2 회고가 경고한 "영구 세금"). **Task는 SQL WHERE 절 추가이지 DDL이 아니다.** phone 인덱스는 §결정 D-1대로 하드닝 이월.

### 스코프 (이 스토리가 하는 것 / 안 하는 것)

**IN (3.5):** ① `GET /v1/patients`에 **선택 `q` 파라미터** 추가(이름·차트번호·연락처 검색 — 기존 엔드포인트 확장, 신규 라우트/스키마 없음) ② `fetch_patients` WHERE 절(ILIKE name + 접두 chart_no + 자릿수 정규화 phone) + 검색 시 동일 필터 count ③ 웹 **전역 `Ctrl K` 커맨드 팔레트**(Base UI Dialog, 디바운스·abort, 키보드·aria-live, RBAC 게이트) ④ 결과 행 **오환자 방지 단서**(이름·차트번호·생년월일·마스킹 RRN·연락처) ⑤ 선택 → `/patients/{id}` 이동 ⑥ topbar placeholder → 실동작 교체 ⑦ API/웹 테스트.

**OUT (후속 — 의도적 비포함):**
- **신규 마이그레이션·인덱스** → 없음(0009 컬럼·이름 인덱스 재사용; phone 성능 인덱스=하드닝 이월).
- **"빠른 이동·동작"(non-환자 명령)** → UX-DR5는 환자 검색을 **핵심**으로, 빠른 네비/동작을 부가로 둔다. 본 스토리는 **환자 검색만**(에픽 AC 범위). 명령 팔레트(페이지 점프·액션)는 후속 — 과도 구현 금지.
- **마지막 내원일/방문 요약** → 내원 데이터=Epic 4. 오환자 가드레일은 birth_date+마스킹 RRN으로 충족(내원 단서는 Epic 4에서 보강 가능).
- **per-row RRN reveal** → 없음(UX-DR22, AC3). reveal은 상세/배너(Epic 4)·연락처 reveal 하드닝(deferred-work L22)에서.
- **TanStack Query 도입** → 미도입(3.3/3.4 관례). client `useState`+`apiFetch`+수동 디바운스/abort. 새 의존성 금지.
- **`q` 액세스 로그 스크러빙 / POST 검색** → 보안 하드닝 이월(§결정 D-2).
- **`is_active` 필터** → 미적용(deferred-work L30 일관, 비활성화 플로우 부재).
- **실시간/페이지네이션 UI(무한 스크롤)** → 팔레트는 상위 N(예 20)만. 전체 목록 화면은 별도(현재 미존재 — 본 스토리 비범위).

### 결정 (Decisions — 착수 전 확정)

- **D-1 (마이그레이션·인덱스 없음):** 검색은 기존 컬럼 ILIKE. `idx_patients_name`이 이름 검색을 최적화. `chart_no`는 UNIQUE(`0009:26` `text not null unique`)라 인덱스 보유 — 접두 매칭. `phone`은 인덱스 없음 → **MVP ILIKE 수용**(외래 환자 규모=수천 행, 풀스캔 허용). 성능 인덱스(`idx_patients_phone` 또는 `pg_trgm`)는 Epic 4 0010과 묶지 말고 **별도 성능 하드닝 스토리**로(번호 드리프트 회피).
- **D-2 (GET `?q=` 채택, 로그/URL PII 갭 명시 이월):** 기존 `GET /patients` 확장이 REST·일관성상 자연스럽고(목록 응답이 이미 PII 본문 반환), 클라 캐싱·디버깅 단순. 대가: `q`(이름·연락처 PII)가 쿼리스트링 → 액세스 로그 노출 가능. **본 스토리 대응:** (a) FastAPI 구조적 로그에 `q` 미기록(`core/logging.py` 마스킹 백스톱은 RRN만 — deferred-work L113), (b) 라우트·딥링크엔 PII 부재(UUID만). **이월:** nginx/uvicorn 액세스 로그 쿼리스트링 스크러빙 또는 `POST /patients/search`(body) 전환은 **보안 하드닝**(Open Q #1, deferred-work L10 self-link 레이트리밋과 같은 묶음 후보). 은폐 아님 — "최대한 실제처럼"을 위해 갭 문서화 후 MVP 수용.
- **D-3 (컴포넌트=Base UI Dialog, NOT shadcn cmdk):** 에픽/UX 산출물은 "shadcn `Command`"를 언급(EXPERIENCE L139)하나, **실제 코드베이스는 `@base-ui/react`로 표준화**(Dialog 8곳·Combobox 1곳·Button; `cmdk`/shadcn Command 미설치). project-context "**새 라이브러리 임의 추가 금지** — 아키텍처 결정 우선". 따라서 **`cmdk` 도입 금지**, Base UI `Dialog` + 수동 검색/리스트로 구현(키보드·aria-live는 `master-search-picker.tsx` 패턴 참고). 산출물의 shadcn 힌트는 코드베이스 분기로 **대체됨**(기능 동치: 모달 검색 + aria-live + 키보드).

### 재사용 자산 — 발명 금지 (DO NOT REINVENT)

3.1~3.4가 깐 환자/검색/셸 인프라를 **확장**한다. 아래를 재구현하면 회귀·불일치.

| 자산 | 위치 | 계약 | 3.5 사용처 |
|---|---|---|---|
| `GET /patients` + `fetch_patients`/`list_patients` | `api/v1/patients.py:79-88` · `core/db.py:1134-1154` · `services/patients.py:73-78` | service_role(RLS 우회)·마스킹 투영·페이지 봉투·게이트=라우터 | **`q` 파라미터 확장**(신규 엔드포인트 금지) |
| `_PATIENT_LIST_COLUMNS` | `core/db.py:1042-1044` | `id,chart_no,name,birth_date,sex,resident_no_masked,phone,is_active,created_at`(마스킹·식별 단서, _enc/_hash 제외) | 검색 결과 투영(불변 — 오환자 단서 전부 포함) |
| `PatientListItem`/`PatientPage`/`PatientPageMeta` | `schemas/patients.py:141-167` | 경량 마스킹 항목 + `{data, meta}` 봉투 | 검색 응답 셰이프(불변·재사용) |
| `require_patient_read` | `api/v1/patients.py:35` (`require_permission("patient.read")`) | 권한 게이트 403 | 검색 게이트(불변) |
| `_run_authed`/`authenticated_conn` | `core/db.py:88,107` | sub→GUC·RLS 우회 소유자 role·503 매핑 | 검색 트랜잭션(기존 `_op` 골격) |
| `apiFetch`/`ApiError` | `web/src/lib/api/client.ts:35` | Bearer 세션 토큰·봉투 파싱·`signal` 지원 | `searchPatients`(abort 가능) |
| Base UI `Dialog` | `@base-ui/react/dialog` (admin 폼 8곳, 예 `staff-create-form.tsx`) | 포커스 트랩·초기 포커스·Esc/백드롭·복원 내장 | 팔레트 모달 |
| `usePermissions` | `web/src/hooks/use-permissions.ts:9` (sidebar.tsx:57 사용) | `{role, has}` — `PermissionsProvider` 필요 | 트리거·단축키 RBAC 게이트 |
| 탑바 검색 placeholder | `web/src/components/shell/topbar.tsx:30-41` | 스타일·aria-label·`kbd "Ctrl K"` | 트리거로 교체(마크업 보존) |
| 환자 상세 라우트 | `web/src/app/(staff)/patients/[patientId]/page.tsx` | `/patients/{id}`(UUID)·`requirePermission("patient.read", STAFF_HOME)` | 선택 시 `router.push` 목적지 |
| `master-search-picker.tsx` | `web/src/components/ui/master-search-picker.tsx:184-289` | Base UI Combobox 키보드·`Combobox.Status` aria-live·색비의존 상태 | **패턴 참고**(검색·키보드·aria-live·로딩/에러 표시) |
| `lib/reception/patients.ts` `Patient`·헬퍼 | `web/src/lib/reception/patients.ts:20-40` | 상세 타입·표시 헬퍼 | `PatientListItem` 추가(상세와 별개)·헬퍼 재사용 |

### PII 경계 (project-context + UX-DR22 + 임상안전 리뷰)

- **결과 = 마스킹만:** `PatientListItem`은 `resident_no_masked`만(설계상 `_enc`/`_hash`/raw 부재). 팔레트는 마스킹 값 표시·**per-row reveal 없음**(AC3).
- **오환자 가드레일 = PII 노출 아님:** birth_date·마스킹 RRN tail·연락처는 **동명이인 식별 단서**(임상안전 §Ctrl-K disambiguation). 마스킹 RRN은 이미 마스킹·연락처는 평문 컬럼(직원 `patient.read` 범위 — deferred-work L22 연락처 reveal 일관화는 별도 이월, 본 스토리 무변경).
- **라우트·로그 무PII:** 목적지=`/patients/{UUID}`(불투명). `q`(이름·연락처)는 **구조적 로그·클라 로그·토스트·에러봉투에 미기록**. 단 `?q=`는 액세스 로그 가능 → §결정 D-2 이월.
- **aria-live = 개수·상태만:** "N명 검색됨" 식(이름/연락처 낭독 금지). 리스트 항목 자체는 listbox 시맨틱으로 AT가 읽되, 라이브 리전은 카운트만.

### 검색 동작 상세 (정확성·안전)

- **`q` 정규화:** trim. 자릿수만 추출(`\D` 제거)해 phone 비교(하이픈 유/무 동치 — 등록은 자유 형식 저장). 빈/공백 `q` → 전체 목록(회귀 안전). 너무 짧은 `q`(0자)는 클라가 호출 억제.
- **WHERE 매칭:** name=substring ILIKE(부분 일치), chart_no=접두 ILIKE(8자리 zero-pad 숫자 식별자 — `0000` 접두 흔함), phone=자릿수 substring. OR 결합. **파라미터 바인딩**으로 SQL 인젝션·와일드카드 안전.
- **count 정합:** `meta.total`은 **동일 WHERE**로 — 페이지네이션 메타가 검색 결과 기준(팔레트는 page_size 상한만 쓰지만 메타 정확성 유지).
- **경쟁 결과 방지(웹):** 빠른 타이핑 시 이전 요청 abort(`AbortController`) + 디바운스 → 마지막 응답만 반영(stale 결과 깜빡임 방지).
- **정렬:** 검색 결과는 이름 사전순 권장(동명이인 인접) — 단 일관 정렬이면 created_at desc도 무방(택1, 테스트는 집합 단언이라 무영향).

### 키보드·접근성 (UX-DR5·DR19·DR24, EXPERIENCE L139·151·153)

- **전역 `Ctrl K`:** `keydown` 캡처, `preventDefault`(브라우저 기본 가로채기). Windows 우선이나 Mac `⌘K`도 방어 허용. **표기는 항상 "Ctrl K"**(decision-log L80, ⌘ 미표기).
- **모달 = 포커스 트랩 + 초기 포커스(검색 입력) + 닫을 때 복원** — Base UI Dialog 기본 제공(상속 아님·요구사항으로 명시 충족).
- **결과 키보드 완전 조작:** ↑/↓ 활성 이동, `Enter` 선택, `Esc` 닫기. roving-tabindex 또는 `aria-activedescendant`(listbox).
- **상태 색 비의존:** 로딩("검색 중…")·결과없음("검색 결과 없음")·에러("검색 실패 — 다시 시도")를 아이콘+텍스트로(색 단독 금지). aria-live polite.
- **⚠️ 참고(AGENTS.md):** `web/AGENTS.md` — "This is NOT the Next.js you know". Next 16.2.9 + React 19.2 — 라우팅/이벤트 작성 전 `node_modules/next/dist/docs/` 관련 가이드 확인. `useRouter`는 `next/navigation`(App Router).

### 검증 3중 (architecture §검증)

- **클라 Zod**(선택 — 검색은 자유 입력이라 폐쇄어휘 없음; 최소 길이·max만) → **서버 Query 검증**(`max_length=100`) → **DB**(파라미터 바인딩·투영 마스킹). 검색은 쓰기 아님이라 제약은 가벼움(투영·게이트가 핵심).

### Project Structure Notes

- **DDL = Supabase 마이그레이션 단일소유** — 3.5는 DDL 0건(0009 재사용). FastAPI DDL·Alembic 금지. **인덱스 추가도 금지**(D-1).
- **무ORM:** `core/db.py`(asyncpg) `fetch_patients` 확장(기능별 db 파일 금지). 레이어: `api/v1/patients.py`(transport, `q` 쿼리) → `services/patients.py`(도메인) → `core/db.py`(영속·WHERE). 스키마 `schemas/patients.py` 재사용(신규 0건).
- **웹:** `components/shell/patient-search-command.tsx`(신규, 셸 영역) + `topbar.tsx`(교체) + `lib/{reception|patient}/…`(`searchPatients`·`PatientListItem`). `types/database.types.ts` 없음(타입 수기, FastAPI 응답 거울, **snake_case 유지** — TS에서 camelCase 변환 금지).
- **JSON 전 경로 snake_case**(`resident_no_masked`·`chart_no`·`birth_date`·`page_size`). 목록 봉투 `{data, meta:{page,page_size,total}}`. 에러 `{error:{code,message,detail}}`+HTTP(403 권한). 라우트=UUID(불투명).

### Testing 표준

- API `pytest`(`api/tests/`), 통합은 스택·`SUPABASE_SECRET_KEY` 미설정 시 skip(3.1 패턴). 검색 단언은 **필터 정확성**(포함/제외 집합)·마스킹(`resident_no_masked`만)·403·count 정합. 생성 환자 `try/finally` 정리.
- 웹 `vitest`(co-located `*.test.{ts,tsx}`) + `@testing-library/react`/`user-event` + `tsc --noEmit` + `eslint`. mock: `useRouter`·`usePermissions`·`apiFetch`. keydown 디스패치로 `Ctrl K` 검증.
- 골든패스 E2E·커버리지 게이트는 Post-MVP — 과도 명세 금지.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.5] — AC 원문(어느 화면서든 Ctrl K로 이름·차트번호·연락처 검색·결과 aria-live, 선택 시 환자 상세 풀페이지 이동, 결과 RRN 기본 마스킹·per-row reveal 없음), 에픽 범위노트(전역 환자 검색 동작)
- [Source: _bmad-output/planning-artifacts/epics.md#UX-DR5·UX-DR4·UX-DR19·UX-DR24 (L184,185,199,737)] — 커맨드 팔레트(전역 Ctrl K·환자 검색 핵심·결과 aria-live·Ctrl 표기), 탑바 Ctrl K 자리, 키보드 우선 인터랙션(Esc 최상위 모달 닫기·포커스 순서), aria-live 결과 안내
- [Source: _bmad-output/planning-artifacts/ux-designs/.../EXPERIENCE.md:60,139,151,153] — 전역 환자 검색=Ctrl K(이름·차트번호·연락처, 외형과 직교), "shadcn Command 기반·결과 aria-live"(→ D-3 Base UI로 대체), 라이브 리전 정책(polite/assertive), 키보드 완전 조작·모달 포커스 트랩+초기 포커스+복원
- [Source: _bmad-output/planning-artifacts/ux-designs/.../review-clinical-safety.md:43-44,79,127] — **[MEDIUM] Ctrl-K 오환자 이동 가드레일 부재** → 결과에 DOB/마스킹 RRN tail/(마지막 내원) 표시·목적지 신원 재진술; 목록/검색 RRN 마스킹 명시 필요(AC3 가드레일 근거)
- [Source: _bmad-output/planning-artifacts/ux-designs/.../review-accessibility.md:87 · validation-report.md:67] — 커맨드 팔레트 aria-live는 "bright spot"이나 복합 위젯 직접 조작의 대체가 아님(팔레트만으로 충분하다 가정 금지 — 본 스토리는 팔레트 범위)
- [Source: api/app/api/v1/patients.py:79-88,35] — `list_patients`(GET, 페이지 봉투, `require_patient_read`) — `q` 확장점
- [Source: api/app/core/db.py:1042-1044,1134-1154,88,107] — `_PATIENT_LIST_COLUMNS`(마스킹·식별 단서 투영)·`fetch_patients`(WHERE 추가점)·`_run_authed`/`authenticated_conn`(RLS 우회·503)
- [Source: api/app/services/patients.py:73-78] — `list_patients` 서비스(`q` 위임)
- [Source: api/app/schemas/patients.py:141-167] — `PatientListItem`/`PatientPageMeta`/`PatientPage`(검색 응답 셰이프 재사용)
- [Source: supabase/migrations/0009_patients.sql:18-27,33-36,57,59,60,84] — `chart_no`(UNIQUE 시퀀스, 8자리, PII 아님)·`phone`(평문, 인덱스 없음)·`name`/`idx_patients_name`(L60)·`resident_no_hash` UNIQUE — **검색 컬럼/인덱스 존재 확인(재선언·신규 인덱스 금지)**
- [Source: docs/glossary.md:184,210] — 다음 마이그레이션 0010=Epic 4(0001~0009 적용됨, 신규 금지)·환자 PII 경계(마스킹 응답·_enc/_hash GRANT 제외·reveal 첫 노출처 Epic 4)
- [Source: web/src/components/shell/topbar.tsx:30-41 · app-shell.tsx · app/(staff)/layout.tsx] — 탑바 Ctrl K placeholder(트리거 교체점)·AppShell(client)·(staff) 셸 레이아웃
- [Source: web/src/hooks/use-permissions.ts:9 · components/shell/sidebar.tsx:57] — `usePermissions().has(...)` RBAC 노출 게이트 선례(PermissionsProvider 컨텍스트)
- [Source: web/src/app/(staff)/patients/[patientId]/page.tsx] — `/patients/{id}`(UUID) 상세 풀페이지·`requirePermission("patient.read", STAFF_HOME)`(선택 시 목적지)
- [Source: web/src/components/ui/master-search-picker.tsx:184-289 · components/admin/staff-create-form.tsx:4] — Base UI Combobox(키보드·`Combobox.Status` aria-live·색비의존) + Base UI `Dialog` import 선례(팔레트 구현 참고)
- [Source: web/src/lib/api/client.ts:35 · lib/reception/patients.ts:20-40] — `apiFetch`(Bearer·signal)·`Patient` 타입/헬퍼(PatientListItem 추가·헬퍼 재사용)
- [Source: web/package.json:14,20-29 · web/AGENTS.md] — `@base-ui/react` ^1.6.0(컴포넌트 레이어, cmdk 없음)·`shadcn` CLI는 있으나 컴포넌트 미사용·Next 16.2.9/React 19.2 — "This is NOT the Next.js you know"(가이드 확인)
- [Source: docs/project-context.md] — 무ORM·DDL 단일소유·새 라이브러리 금지·JSON snake_case·PII 경계(URL·로그 금지)·RBAC UI 노출(직무 핵심=역할, 게이트는 민감)·상태 분리(서버=apiFetch, UI=useState)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:10,22,30,113] — self-link 레이트리밋(보안 하드닝 묶음 — q 로그 갭 동행 후보)·연락처 PII reveal 일관화(본 스토리 무변경)·환자 GET/UPDATE is_active 미필터(검색 경로 동일 정책)·로그 마스킹 RRN만(q 미기록 근거)
- [Source: _bmad-output/implementation-artifacts/3-4-...-자동-연결.md / 3-2-...-입력-조회.md] — 환자 4계층·재사용 자산·마이그레이션 금지·TanStack Query 미도입·테스트 위생(skip·try/finally·집합 단언)·DB 영속/정확성 검증

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context) — bmad-dev-story

### Debug Log References

- `uv run ruff check .` (api) → All checks passed(E501 3건은 CJK 폭 2 계산 → 변수 추출·docstring 축약으로 해소).
- `uv run pytest -q` (api) → **280 passed, 9 skipped**(기존 SUPABASE_SECRET_KEY 의존 crypto 9 skip). 신규 검색 통합 5 포함, 회귀 0(이전 275 → 280). 로컬 Supabase 스택 가동 중이라 검색 통합이 실 Postgres 에서 실행·검증됨(skip 아님).
- `npx vitest run` (web) → **189 passed**(26 files). 신규 searchPatients 단위 2 + 커맨드 팔레트 컴포넌트 9 포함(이전 178 → 189). `tsc --noEmit`·`eslint .` 클린.
- 디버그 포인트(해결):
  - eslint `react-hooks/set-state-in-effect` — 검색 effect 의 동기 setState 가 지적됨. `loading` 불리언을 제거하고 `searchedTerm`(결과를 만든 검색어) 파생으로 "검색 중" 판정 → 모든 setState 를 setTimeout/promise 콜백(비동기) 안으로 이동(프로젝트 선례: patient-detail/staff-directory "첫 setState 가 await 이후"). disable 없이 해소 + 입력 직후 "결과 없음" 플리커도 제거.
  - 컴포넌트 테스트 "검색 결과 없음" 다중 매칭 — 시각 `<p>`와 aria-live `role=status` 양쪽에 노출 → `findByText(..., { selector: "p" })`로 시각 문구만 한정.
  - 검색 통합 테스트 격리 — 이름 검색은 순수 알파벳 토큰(`_alpha_token`)으로 차트번호/연락처(자릿수) 조건과 분리(무관 토큰 → 0건 단언 안정). 연락처는 고유 8자리로 하이픈 유/무 동치 검증.

### Completion Notes List

- **AC1(전역 Ctrl K 팔레트 + 검색)**: `GET /v1/patients`에 선택 `q` 파라미터 추가(이름 부분일치·차트번호 부분일치·연락처 자릿수 부분일치, ILIKE + `regexp_replace` 정규화, 파라미터 바인딩=인젝션 안전). 웹 `PatientSearchCommand`(Base UI Dialog)가 전역 `Ctrl K`(`window` keydown, `ctrlKey||metaKey`+`preventDefault`)로 열리고 디바운스(200ms)+`AbortController`로 검색. 결과 개수/상태를 `role=status aria-live=polite`로 안내(PII 미낭독 — 개수만). 키보드 완전 조작(↑/↓/Enter, Esc=Dialog).
- **AC2(선택 → 상세 이동)**: 결과 클릭/Enter → `router.push('/patients/{id}')`(UUID=불투명). 팔레트 닫힘+상태 초기화.
- **AC3(마스킹 + per-row reveal 없음 + 오환자 가드레일)**: 결과는 `PatientListItem`(`resident_no_masked`만, `_enc`/`_hash` 부재) — reveal 동작 없음. 각 행에 **이름·차트번호·생년월일·마스킹 주민번호·연락처**를 동명이인 식별 단서로 표시(임상안전 §Ctrl-K disambiguation). 검색어(q=이름·연락처 PII)는 로그/toast 미기록(API·웹 양쪽).
- **AC4(RBAC 노출 + 강제)**: 트리거·단축키는 `usePermissions().has('patient.read')` 보유 시에만 렌더/등록(미보유 → null, 사이드바 게이트 동형). API는 기존 `require_permission('patient.read')` 그대로 강제(미보유 doctor → 403, 통합 검증).
- **이월·교차절단**: ① **신규 마이그레이션 0건** — `idx_patients_name`(0009:60)·`chart_no` UNIQUE·`phone`(평문) 재사용. 새 인덱스/0010 없음(phone 성능 인덱스 이월). ② **`is_active` 미필터 유지** — `fetch_patients` 검색도 비활성 미필터(비활성화 플로우 부재·deferred-work L30 일관, 단독 필터 시 GET/UPDATE 불일치). ③ **q-in-URL/로그 PII 갭** — 구조적 로그 미기록 + 라우트 무PII(UUID)로 1차 대응, 액세스 로그 스크러빙/POST 전환은 보안 하드닝 이월(Open Q #1·deferred-work L10 묶음 후보).
- **재사용(발명 금지)**: 기존 `GET /patients`/`fetch_patients`/`list_patients` 확장(신규 엔드포인트·스키마 0건), `PatientListItem`/`PatientPage` 그대로, `apiFetch`(signal 통과), Base UI `Dialog`(admin 폼 선례·`initialFocus`), `usePermissions`, 탑바 검색 자리 스타일·aria 보존. TanStack Query 미도입(useState+apiFetch).
- **결정(스토리 D-1~D-3 반영)**: 마이그레이션·인덱스 0건(D-1) / `GET ?q=` 확장 + 로그 갭 이월(D-2) / 컴포넌트=Base UI Dialog(cmdk 미도입, D-3). 차트번호 매칭은 스토리의 "접두"에서 **부분일치(contains)로 보강** — 8자리 zero-pad 차트번호를 유효 자릿수("42"→"00000042")로도 찾게(zero-pad gotcha 회피, 더 유용).

### File List

**신규**
- `web/src/components/shell/patient-search-command.tsx` — 전역 Ctrl K 환자 검색 커맨드 팔레트(Base UI Dialog, 디바운스·abort·키보드·aria-live·RBAC 게이트·오환자 단서)
- `web/src/components/shell/patient-search-command.test.tsx` — 컴포넌트 단위 9(Ctrl K 열기·검색 단서·마스킹·선택 이동·aria-live·결과없음·RBAC 게이트)

**수정**
- `api/app/core/db.py` — `import re` + `fetch_patients(q=...)` 검색 WHERE(이름·차트번호 부분일치 + 연락처 자릿수 정규화, 동일 WHERE count)
- `api/app/services/patients.py` — `list_patients(q=...)` 위임
- `api/app/api/v1/patients.py` — `GET /patients` 에 `q` Query 파라미터(이름·차트번호·연락처 검색, PII 로그 미기록)
- `api/tests/test_patients_integration.py` — 검색 통합 5(이름·차트번호·연락처 하이픈 동치·공백 q 회귀·권한 403) + 헬퍼(`_create_named`·`_alpha_token`)
- `web/src/lib/reception/patients.ts` — `PatientListItem`/`PatientPage` 타입 + `searchPatients`(apiFetch, encodeURIComponent, signal)
- `web/src/lib/reception/patients.test.ts` — `searchPatients` 단위 2(URL 구성·signal/pageSize)
- `web/src/components/shell/topbar.tsx` — 정적 검색 placeholder → `<PatientSearchCommand />` 교체(미사용 `Search` import 정리)
- `docs/glossary.md` — 전역 환자 검색/`searchPatients`/`PatientSearchCommand` 등재

## Change Log

| 날짜 | 변경 | 비고 |
|---|---|---|
| 2026-06-21 | Story 3.5 컨텍스트 생성 — 전역 환자 검색 Ctrl K 커맨드 팔레트 (AC1·2·3·4) | 마이그레이션 0건(0009 컬럼·idx_patients_name 재사용, phone 인덱스 이월) + `GET /patients?q=` 확장(이름·차트번호·연락처 ILIKE, 기존 PatientPage/PatientListItem 재사용) + 웹 Base UI Dialog 팔레트(cmdk 미도입·D-3) + 오환자 방지 단서(생년월일·마스킹 RRN·연락처) + RBAC 게이트(patient.read) + 테스트. q-in-URL/로그 PII 갭 명시 이월(D-2), is_active 미필터 유지(L30). |
| 2026-06-21 | Story 3.5 구현 — 전역 환자 검색 (AC1·2·3·4) | `GET /patients?q=`(이름·차트번호 부분일치 + 연락처 자릿수 정규화, 동일 WHERE count) + 웹 `PatientSearchCommand`(Base UI Dialog·전역 Ctrl K·디바운스 200ms·abort·키보드·aria-live·RBAC 게이트·오환자 단서) + topbar 교체 + `searchPatients` lib + 테스트(api 통합 5·web 단위 2+컴포넌트 9). 마이그레이션 0건. 전체 회귀 green(api 280 passed/9 skipped·web 189·tsc·eslint·ruff). 차트번호=부분일치로 보강(zero-pad gotcha 회피). → **review** |
| 2026-06-21 | 코드리뷰 — 3레이어 적대 리뷰 + 트리아지 | Acceptance Auditor 위반 0(AC1~4 + 이월 ①~③ + D-1~D-3 충족). patch 4 적용(① ILIKE 와일드카드 `%`·`_` 이스케이프=전체매칭 우회 차단 ② 디바운스 정착 전 Enter `settled` 가드=오환자 라우팅 방지 ③ 검색 잘림 안내(상위 20 + "더 정확히 입력")=동명이인 누락 방지 ④ `aria-activedescendant` `activeIndex` 범위 가드) + 회귀 테스트(api 와일드카드·web 잘림 안내), defer 4(검색 매칭·정렬 튜닝/IME Ctrl K·Esc/빈입력 200ms 잔존/apiFetch abort 결합 — deferred-work 기록), dismiss 3. 회귀 green(api 281 passed/9 skipped·web 190·tsc·eslint·ruff). → **done** |

## Open Questions (개발 착수 전 확인 — 차단 아님)

1. **검색어 PII 전송 방식 (D-2):** `GET /patients?q=`는 REST·기존 목록 일관성상 채택했으나, `q`(이름·연락처 PII)가 쿼리스트링 → nginx/uvicorn 액세스 로그에 남을 수 있다(project-context "PII는 URL·로그 금지"와 긴장). 본 스토리는 구조적 로그 미기록 + 라우트 무PII로 1차 대응하고, **액세스 로그 스크러빙 또는 `POST /patients/search`(body) 전환을 보안 하드닝으로 이월**(self-link 레이트리밋 묶음 후보, deferred-work L10). **확인:** MVP는 GET ?q= 수용(권장 — 갭 문서화) vs 지금 POST로 갈까?
2. **phone 검색 성능 인덱스:** 외래 규모(수천 행)에선 ILIKE 풀스캔 허용. 데이터 증가 시 `idx_patients_phone`(B-tree, 자릿수 정규화 식 인덱스는 immutable 제약 주의) 또는 `pg_trgm` GIN. **0010=Epic 4 예약이라 본 스토리에서 인덱스 추가 안 함** — 성능 하드닝 스토리/Epic 4 마이그레이션에 묶을지 확인.
3. **명령(non-환자) 팔레트 확장:** UX-DR5는 환자 검색을 핵심으로, "빠른 이동·동작"을 부가로 둔다. 본 스토리는 환자 검색만. 페이지 점프/액션(예 "접수로 이동")을 팔레트에 넣을지는 후속(데모 시나리오에 필요한가?). **권장:** 환자 검색만(에픽 AC 범위) — 명령 확장은 별도.
4. **결과 정렬·표시 상한:** 검색 결과 정렬(이름 사전순 vs 최신순)과 팔레트 표시 상한(현 page_size=20). 동명이인 다수 시 더보기/페이지네이션이 필요한가, 상위 N + "더 정확히 입력" 안내로 충분한가? **권장:** 상위 20 + 안내(MVP).

---
_Ultimate context engine analysis completed — comprehensive developer guide created._
