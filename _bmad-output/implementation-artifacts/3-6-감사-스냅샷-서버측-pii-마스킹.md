---
baseline_commit: 59662be
---

# Story 3.6: 감사 스냅샷 서버측 PII·건강민감 마스킹

Status: done

<!-- Note: 회고(epic-3-retro-2026-06-21) 도출 하드닝 스토리 — epics.md 에 없음(2-6 선례). Validation 선택. -->

## Story

As a 관리자(`audit.read` 보유) 겸 시스템,
I want 감사 로그 스냅샷의 환자 식별 PII·건강민감 데이터가 **서버 응답·로그에서 마스킹**되기를,
so that 감사 추적(누가·언제·무엇을 바꿨나)은 보존하되 환자 PII가 `audit_logs`를 통해 평문으로 새지 않는다(UX-DR22·PII 경계, Epic 1→3 이월 청산).

## Acceptance Criteria

1. **AC1 — 서버측 감사 스냅샷 마스킹 (핵심·이월 청산):** `GET /v1/admin/audit-logs` 응답의 `before_data`/`after_data`(jsonb)가 **서버에서 마스킹된 뒤** 반환된다. 현재는 서버가 **원문 jsonb 그대로** 직렬화하고 마스킹은 웹 렌더 계층(1.10)에만 있어, Epic 3에서 patients/guardians 변경이 `audit_logs`에 유입되면서 **API 응답 본문에 평문 PII가 흐른다**(name·phone·address·email·insurance_no + 건강민감). 서버 마스킹을 1차 권위로 추가한다 — 민감 키(아래 AC2 집합)의 값을 `"●●●● (마스킹됨)"`로 치환(중첩 객체/배열 **재귀** 포함, 웹 `maskDeep` 동형). **`audit.read` 게이트는 유지**(마스킹은 그 위 방어심층 — 관리자라도 감사 화면에서 PII 평문 불요).

2. **AC2 — 마스킹 대상에 건강민감 + name 보강 (서버·웹 단일 집합):** 마스킹 키 집합 = **기존**(resident_no·rrn·ssn·password·secret·token·email·phone·address·guardian·`_enc$`·`_hash$`·`_blind_index$`·ciphertext) + **신규**(`name`·`allergies`·`chronic_diseases`·`medications`·`notes`·`insurance_no`). 건강민감 4종은 3.2에서 audit에 처음 유입됐는데 웹 정규식이 **누락**(현재 미마스킹) → 보강. `name`(식별 PII)도 추가. 서버 Python 집합과 웹 `SENSITIVE_KEY` 정규식이 **동일 필드 집합**(거울 — 한쪽만 바꾸면 드리프트). 트레이드오프: roles/permissions 의 `name`(비-PII 라벨)도 마스킹되나 **`code`(안정 식별자)·`actor_name`(행위자 join, 스냅샷 밖)은 비마스킹**이라 감사 가독성 보존(§Dev Notes 결정 D-2).

3. **AC3 — append-only 보존 + 방어심층(서버 권위 + 웹 유지):** 마스킹은 **읽기 시점**(서버 응답 + 웹 렌더)에서만 — 감사 트리거(0004)는 **전체 행 스냅샷을 그대로 저장**(포렌식 무결성·append-only 3중 강제 불변, DDL/트리거 변경 0). 서버 마스킹이 1차 권위, 웹 렌더 마스킹(1.10 `maskSnapshotValue`)은 **방어심층으로 유지**(이중). 비민감 필드(action·target_table·target_id·chart_no·birth_date·sex·is_active·created_at·effective_*·code 등)는 그대로 노출 — diff 가독성 유지. **저장 시점(at-rest) 평문 잔존은 수용 갭으로 명시 기록**(write-side 마스킹/컬럼 암호화는 포렌식 손실·대형 마이그레이션 → 별도 하드닝, §Dev Notes).

4. **AC4 — 구조적 로그 백스톱 전화번호 확장 (방어심층·저위험):** `core/logging.py` `mask_pii` 백스톱에 **전화번호 패턴**을 추가(현재 RRN `\d{6}-\d{7}`만). raw PII 미로깅 규율이 1차선이고 이건 우발 누출 방어심층 — 한국 전화 형식(`01[0-9]-?\d{3,4}-?\d{4}` 등) 보수적 패턴. **과대마스킹 허용**(누출 > 과대마스킹, 기존 RRN 백스톱 주석 정신). 신뢰할 패턴 한계로 이름·주소는 제외(규율 의존 — 기존 deferred-work L113 정신 계승).

> **이월·교차절단 인수 조건(이 스토리에서 확인):** ① **신규 마이그레이션·DDL·권한·라이브러리 0건** — 읽기 시점 마스킹(서버 응답 + 웹)만. 트리거·GRANT·RLS·테이블 불변(0009/0004 재사용). ② **연락처·주민번호 reveal 은 본 스토리 범위 밖** — Story 4.5(진료 허브 배너, UX-DR9·DR22)가 reveal 엔드포인트·UI 를 RRN+연락처 함께 빌드(회고 스코프 결정). 본 스토리는 **감사 노출 표면만** 봉쇄. ③ **A-3 이월 청산** — deferred-work L153/L173(서버측 감사 PII 마스킹, Epic 1부터·3.2 긴급도↑)을 본 스토리가 닫는다. ④ **at-rest 평문 잔존** = 수용 갭(별도 감사-암호화 하드닝 후보, 신설 금지·본 스토리에 명시).

## Tasks / Subtasks

- [x] **Task 1 — 서버측 마스킹 유틸 + 민감 키 단일 집합 (AC1, AC2)**
  - [x] 1.1 `api/app/services/audit.py`(또는 신규 `api/app/core/pii_mask.py`)에 마스킹 유틸 추가: `_SENSITIVE_KEY` 정규식(웹 `SENSITIVE_KEY` 거울 + 신규 키) + `mask_snapshot(data: dict | None) -> dict | None`. 동작: dict 의 각 키가 민감이면 값→`MASK_DISPLAY`("●●●● (마스킹됨)"), 아니면 값이 dict/list 면 **재귀**(웹 `maskDeep` 동형 — 중첩 PII 봉쇄), 스칼라는 그대로. `None` → `None`. 순수 함수(부수효과 없음).
  - [x] 1.2 `MASK_DISPLAY` 문자열은 웹과 **동일**("●●●● (마스킹됨)") — 서버·웹 표시 일관. 민감 키 집합 = AC2 목록(기존 13 + `name`·`allergies`·`chronic_diseases`·`medications`·`notes`·`insurance_no`). 정규식 대소문자 무관(`re.IGNORECASE`).
  - [x] 1.3 `_to_entry`(audit.py L19-21)에서 `model_validate` **전에** `row` 의 `before_data`/`after_data` 를 `mask_snapshot()` 통과: `d = dict(row); d["before_data"] = mask_snapshot(d.get("before_data")); d["after_data"] = mask_snapshot(d.get("after_data")); return AuditLogEntry.model_validate(d)`. (db jsonb 코덱이 이미 dict 디코드 — L20.) 게이트·봉투·셰이프 불변.
- [x] **Task 2 — 웹 마스킹 집합 보강 (건강민감·name) (AC2, AC3)**
  - [x] 2.1 `web/src/lib/admin/audit.ts` `SENSITIVE_KEY` 정규식(L88-89)에 신규 키 추가: `name`·`allergies`·`chronic_diseases`·`medications`·`notes`·`insurance_no`. 서버 집합과 **정확히 일치**(드리프트 0 — 한쪽만 바꾸면 불일치). 주석 갱신(건강민감 유입 반영, "미래 환자 감사" → "환자 감사 유입됨"). `maskDeep`/`maskSnapshotValue` 로직 자체는 불변(집합만 확장).
  - [x] 2.2 웹 렌더 마스킹은 **방어심층으로 유지**(제거 금지) — 서버가 1차 권위지만 이중 안전. `audit-log-detail.tsx` `ValueCell`(Lock 아이콘 + "민감 정보(마스킹)") 불변.
- [x] **Task 3 — 구조적 로그 전화번호 백스톱 (AC4)**
  - [x] 3.1 `api/app/core/logging.py`: `mask_pii` 에 전화번호 패턴 추가(RRN `_RRN_RE` 와 병렬 `_PHONE_RE`). 보수적 한국 휴대폰/유선 패턴(예 `01[016789]-?\d{3,4}-?\d{4}` + 지역번호 형태), 매칭 시 뒤 4자리 마스킹 등. RRN 마스킹과 충돌 없게 순서 주의(RRN 먼저). 과대마스킹 허용. 이름·주소는 미커버(규율 의존 — docstring 명시). **저위험 — 패턴 신뢰도 낮으면 보수적으로**(false positive 허용).
- [x] **Task 4 — 테스트 (AC1, AC2, AC3, AC4)**
  - [x] 4.1 API 단위 `api/tests/test_admin_audit.py` 확장(또는 `test_audit_mask` 신규): `mask_snapshot` 순수 함수 — (a) 민감 키(phone·email·name·allergies·resident_no_enc 등) 값 마스킹, (b) 비민감(action·chart_no·birth_date·sex·code·is_active) 보존, (c) 중첩 dict/list 재귀 마스킹, (d) None→None, (e) 건강민감 4종 마스킹 확인.
  - [x] 4.2 API 통합 `api/tests/test_admin_audit_integration.py` 확장: 환자 생성/임상 갱신으로 audit 행 유입 → `GET /v1/admin/audit-logs`(admin) → 응답 `before_data`/`after_data` 에 **phone·name·allergies 등 마스킹 표시**·평문 부재(`assert "●●●●" in ... / 원본 평문 not in res.text`), 비민감 필드 보존. 스택/`SUPABASE_SECRET_KEY` 미설정 시 skip(기존 패턴). 비-`audit.read`(예 doctor) → 403 유지.
  - [x] 4.3 웹 단위 `web/src/lib/admin/audit.test.ts` 확장: `maskSnapshotValue`/`maskDeep` 이 신규 키(`allergies`·`chronic_diseases`·`medications`·`notes`·`name`·`insurance_no`) 마스킹, 비민감(`code`·`birth_date`) 보존, 중첩 재귀. 서버-웹 집합 일치 회귀(같은 키 목록).
  - [x] 4.4 위생: `uv run ruff check`·`uv run pytest`(api) · `tsc --noEmit`·`eslint`·`vitest run`(web) 클린. 전체 회귀 0.
- [x] **Task 5 — glossary·문서 (AC1~4)**
  - [x] 5.1 `docs/glossary.md`: 감사 PII 마스킹 = **서버측(1차)+웹 렌더(방어심층)** 으로 갱신(현재 "마스킹=web 렌더 계층"을 명시). 신규 식별자 `mask_snapshot`(있으면) 한 줄. at-rest 평문 잔존 수용 갭 메모.

### Review Findings

_코드리뷰 2026-06-21 (Blind Hunter / Edge Case Hunter / Acceptance Auditor 병렬). **Acceptance Auditor: 위반 0** — AC1~4 + 이월 인수 ①~④ + 결정 D-1~D-3 + project-context(snake_case·새 라이브러리 금지·무ORM·3계층) 전부 충족. decision-needed 0 / patch 0 / defer 3 / dismiss 4._

- [x] [Review][Defer] 로그 백스톱 휴대폰 패턴 한계 — `_PHONE_RE`(01x 휴대폰만)가 유선(02-/031-)·점 구분(`010.1234.5678`)·국제(+82)·단어경계 미적용·다중번호 꼬리 1자리 잔존을 못 잡음 [api/app/core/logging.py] — deferred. **AC4 가 명시 스코프(휴대폰만·과대마스킹 선호·방어심층)**, 1차선은 "raw PII 미로깅" 규율. 기존 deferred-work L113(로그 마스킹 패턴 한계)에 통합 — 이름·주소 패턴 확장과 함께. Blind+Edge Med.
- [x] [Review][Defer] 중첩 컨텍스트 `name` 마스킹 부재 — `_mask_value`/`maskDeep` 재귀가 항상-민감 키만 적용, 테이블 인지 `name`은 최상위에서만 → 중첩 dict 안 환자/보호자 name 누출 가능 [api/app/services/audit.py·web/audit.ts] — deferred. **현 스키마 도달 불가**(감사 트리거 `to_jsonb(row)`=평탄 행, 중첩 PII name 컬럼 부재) + 코드 주석에 의도적 엣지 명시. jsonb 중첩 PII 컬럼 도입 시 재검토. Blind High→실질 Low / Edge High→Low.
- [x] [Review][Defer] 서버·웹 마스킹 키 집합 드리프트 가드 부재 — `_SENSITIVE_KEY`(Python)↔`SENSITIVE_KEY`(TS) 수작업 거울, 자동 일치 검증 없음(한쪽만 수정 시 조용히 분기) [api/app/services/audit.py·web/src/lib/admin/audit.ts] — deferred. 현재 양 테스트가 신규 키 전부 커버(가드 역할). Python↔TS 공유 상수 수단 없음 → codegen 또는 계약 테스트는 후속 하드닝. Blind Med(유지보수).

_dismiss 4: ① `address`→`ip_address` 과대매칭 — **false positive**(ip_address는 AuditLogEntry top-level 필드, before/after 스냅샷 밖 → mask_snapshot 미적용, 실제 마스킹 안 됨) ② 부분일치 과대 마스킹 일반(`notes`→`footnotes` 등) — 1.10 fail-closed 설계 계승(over-mask 선호 = under-mask 누출보다 안전, 보안 방향 정합·신규 도입 아님) ③ `resident_no_masked`→●●●● — 의도적 방어심층(이미 마스킹값이라 무해, 테스트 고정) ④ target_table 대소문자/16자리 카드 RRN 오매칭 — 트리거가 canonical lowercase `tg_table_name` 방출·현 데이터 경로 미발현(pre-existing RRN 백스톱 over-mask)._

## Dev Notes

### ⚠️ 먼저 내재화 — 무엇을 하고 / 안 하는가

**이 스토리는 감사 로그의 "노출 표면"만 봉쇄한다.** Epic 1부터 3에픽 미해결인 "감사 스냅샷 평문 PII"(deferred-work L153/L173)를 닫는 **읽기 시점 마스킹** 작업이다. 회고에서 함께 묶였던 **연락처·주민번호 reveal 일관화는 Story 4.5(진료 허브 배너)로 분리**됐다(Project Lead 스코프 결정) — reveal 엔드포인트·UI 가 아직 미구현이고, 4.5 가 RRN+연락처 reveal 을 배너에서 처음 빌드하는 지점이라 거기서 함께 만든다(reveal 이중 빌드 회피). **본 스토리에서 reveal·암호화·새 권한·새 마이그레이션을 만들지 말 것.**

### 스코프 (IN / OUT)

**IN (3.6):** ① 감사 응답 `before_data`/`after_data` **서버측 마스킹**(`services/audit.py` 또는 `core/pii_mask.py` + `_to_entry` 적용) ② 마스킹 키 집합에 **건강민감(allergies·chronic_diseases·medications·notes)·name·insurance_no 보강**(서버·웹 동일 집합) ③ 웹 렌더 마스킹 방어심층 유지 ④ `logging.py` 전화번호 백스톱(저위험) ⑤ 테스트(서버 단위·통합·웹 단위) ⑥ glossary.

**OUT (후속 — 의도적 비포함):**
- **연락처/주민번호 reveal**(엔드포인트·UI·권한·복호) → **Story 4.5**(진료 허브 배너, UX-DR9·DR22). `patient.reveal_contact` 권한 시드·`decrypt_sensitive` 소비·평문 암호화 결정 전부 4.5.
- **write-side(트리거) 마스킹·감사 컬럼 암호화** → at-rest 평문 제거는 포렌식 손실·대형 마이그레이션. 본 스토리는 read-side. at-rest 잔존은 수용 갭(별도 감사-암호화 하드닝 후보).
- **신규 마이그레이션·DDL·권한·라이브러리** → 0건. 0004 트리거·0009 테이블·append-only 불변.
- **이름·주소 로그 백스톱 패턴** → 신뢰할 패턴 부재(규율 의존). 전화번호만 보수적 추가.

### 결정 (Decisions)

- **D-1 (read-side 마스킹):** 마스킹은 **읽기 응답 + 웹 렌더**에서만. 근거: (a) `audit_logs` append-only 3중 강제(0004: RLS deny + GRANT revoke + BEFORE 트리거) — 트리거가 전체 행을 저장해야 "무엇이 바뀌었나"를 보존(감사 본질). (b) write-side 마스킹은 포렌식 데이터 손실 + 신규 트리거 마이그레이션. (c) 기존 설계 의도가 "마스킹=렌더 계층"(schemas/audit.py docstring) — 본 스토리는 이를 **서버 응답까지 확장**(1차 권위 상향). 탐색 결론도 read-side 가 append-only 정합으로 확인.
- **D-2 (`name` 키-기반 마스킹 수용):** 마스킹은 기존 설계대로 **필드명 정규식**(table-agnostic, 재귀). `name` 추가 시 roles/permissions 의 `name`(비-PII 라벨, 예 "관리자")도 마스킹되나 — roles/permissions 는 **`code`(안정 식별자)가 비마스킹**으로 남고, 감사 "누가"는 **`actor_name`**(스냅샷 밖 top-level join 필드, 마스킹 대상 아님)이 전달 → 가독성 보존. table-aware 마스킹(테이블별 키 분기)은 복잡도↑ 대비 이득 작음 → 키-기반 수용. (대안 필요 시 후속.)
- **D-3 (서버·웹 단일 집합):** 두 마스커가 **동일 키 집합**을 써야 드리프트 0(AC2·AC3). 이상적으로 공유 상수지만 Python↔TS 자동 공유 수단 없음 → **양쪽에 동일 목록 + 테스트로 일치 가드**(웹 단위 테스트가 신규 키 전부 커버, 서버 단위도). 한쪽 변경 시 양쪽 갱신 주석.

### 재사용 자산 — 발명 금지 (DO NOT REINVENT)

1.10 감사 뷰어 + 0004 감사 인프라를 **확장**한다(재구현 금지).

| 자산 | 위치 | 계약 | 3.6 사용처 |
|---|---|---|---|
| 웹 `maskSnapshotValue`/`maskDeep`/`SENSITIVE_KEY` | `web/src/lib/admin/audit.ts:88-116` | 필드명 정규식 + 재귀 마스킹, `MASK_DISPLAY`="●●●● (마스킹됨)" | **거울로 서버 이식** + 집합 확장(방어심층 유지) |
| 감사 서비스 `_to_entry`/`list_audit_logs` | `api/app/services/audit.py:19-51` | Record→`AuditLogEntry`, {data,meta} 봉투 | `_to_entry` 에 `mask_snapshot` 삽입 |
| 감사 스키마 `AuditLogEntry` | `api/app/schemas/audit.py` | `before_data`/`after_data: dict|None`, snake_case | 셰이프 불변(값만 마스킹), docstring 갱신 |
| 감사 라우트 `GET /admin/audit-logs` | `api/app/api/v1/admin.py:131-152` | `require_permission("audit.read")` 게이트·페이지네이션 | 불변(서비스가 마스킹) |
| 감사 트리거 `audit_trigger_fn` | `supabase/migrations/0004_audit.sql:39-65` | 전체 행 `to_jsonb` 스냅샷, append-only 3중 강제 | **불변**(write-side 변경 금지) |
| `mask_pii`/`_RRN_RE` 백스톱 | `api/app/core/logging.py:18-28` | 로그 레코드 RRN 마스킹, 과대마스킹 선호 | 전화 패턴 병렬 추가 |
| `audit-log-detail.tsx` `ValueCell` | `web/src/components/admin/audit-log-detail.tsx:22-42` | Lock 아이콘 + "민감 정보(마스킹)" 표시 | 불변(집합만 확장) |

### PII 경계 (project-context + UX-DR22)

- **감사는 admin(`audit.read`)만** + RLS 방어심층 + (신규)**서버 마스킹** + 웹 렌더 마스킹 = 4중. 관리자라도 감사 화면에서 환자 PII 평문은 불요(감사 추적엔 "변경 발생" + 비민감 식별자 + actor 로 충분).
- **마스킹은 값만 — 키는 노출**(어느 필드가 바뀌었나는 보임, 값은 ●●●●). diff(`diffSnapshot`)는 키 기준이라 동작 유지.
- **at-rest**: `audit_logs.before/after` 에 평문 PII 가 여전히 저장됨(read-side 마스킹의 한계). admin-only 접근 + 마스킹된 응답으로 노출은 차단되나 DB 직접 접근 시 평문 — **수용 갭, 명시 기록**(write-side/암호화는 별도 하드닝).
- raw PII 는 로그·toast·에러봉투 금지(기존 규율). 마스킹 표시 문자열만.

### Project Structure Notes

- **무ORM·3계층:** 마스킹은 `services/audit.py`(도메인 매핑 계층)에서 적용 — db 는 SELECT 만(불변), 라우터는 게이트만(불변). 신규 유틸은 `services/audit.py` 모듈 상수/함수 또는 `core/pii_mask.py`(재사용 의도면). DDL 0 — 마이그레이션 폴더 무변경.
- **웹:** `lib/admin/audit.ts` 집합 확장만(컴포넌트 불변). `types/database.types.ts` 없음(수기 타입, snake_case 유지).
- **JSON snake_case·봉투 불변**: `{data, meta}`·`before_data`/`after_data` 키 그대로(값만 마스킹).

### Testing 표준

- API `pytest`: **단위**(`mask_snapshot` 순수 함수 — 민감/비민감/재귀/None/건강민감)는 스택 무관 항상 실행. **통합**(audit 행 유입→GET→마스킹 확인)은 스택·`SUPABASE_SECRET_KEY` 미설정 시 skip(기존 audit 통합 패턴). 평문 부재 단언(`원본 not in res.text`)·마스킹 표시 존재 단언 병행.
- 웹 `vitest`: `audit.test.ts` 확장(신규 키 마스킹·비민감 보존·재귀). 서버-웹 집합 일치는 양쪽 테스트가 같은 키 목록 커버로 가드.
- 골든패스 E2E·커버리지 게이트는 Post-MVP — 과도 명세 금지.

### References

- [Source: _bmad-output/implementation-artifacts/epic-3-retro-2026-06-21.md §6] — 전용 PII·감사 하드닝 스토리 결정(2-6 선례), 감사 서버측 PII/건강민감 마스킹 = Winston/Amelia, Story 4.5 선결(단 reveal 은 4.5 로 분리=create-story 스코프 결정)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:L153,L173] — **A-3 서버측 감사 PII 마스킹**(patients/guardians name/phone/address/email 평문 적재, API 응답·구조적 로그 미마스킹) + **🔺 3.2 긴급도 상승**(건강민감 allergies/chronic/medications/notes 유입) — 본 스토리가 청산
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:L103-L115(1.10 리뷰)] — "before/after 마스킹이 web 렌더 계층 전용 — API 응답·로그엔 jsonb 원문 전송 … Epic 3+ 환자 스냅샷 유입 시 서버측 마스킹 검토"
- [Source: supabase/migrations/0004_audit.sql:39-65,72-114] — `audit_trigger_fn`(전체 행 `to_jsonb` 스냅샷) + append-only 3중 강제(RLS deny·GRANT revoke·BEFORE 트리거) — **write-side 변경 금지 근거**
- [Source: supabase/migrations/0009_patients.sql:24-72,122-133] — patients/guardians 평문 PII 컬럼(name·phone·address·email·insurance_no) + 건강민감(allergies·chronic_diseases·medications·notes) + 감사 트리거 부착(전체 행 스냅샷·resident_no_enc 만 암호문)
- [Source: api/app/services/audit.py:19-51] — `_to_entry`(마스킹 삽입점)·`list_audit_logs`(봉투)
- [Source: api/app/schemas/audit.py:1-36] — `AuditLogEntry`(`before_data`/`after_data: dict|None`)·docstring("마스킹은 web 렌더 계층" → 서버 확장 대상)
- [Source: api/app/api/v1/admin.py:131-152,38] — `GET /admin/audit-logs`·`require_permission("audit.read")` 게이트(불변)
- [Source: api/app/core/db.py:458-461 부근(`fetch_audit_logs`·`_AUDIT_COLUMNS`)] — jsonb 코덱이 before/after 를 dict 로 디코드(마스킹 입력)
- [Source: api/app/core/logging.py:18-44] — `mask_pii`/`_RRN_RE`(RRN 백스톱, 과대마스킹 선호) — 전화 패턴 병렬 추가점
- [Source: web/src/lib/admin/audit.ts:86-116] — `SENSITIVE_KEY` 정규식·`maskDeep`·`maskSnapshotValue`·`MASK_DISPLAY` — 서버 이식 거울 + 집합 확장(건강민감·name 누락 보강)
- [Source: web/src/components/admin/audit-log-detail.tsx:22-42] — `ValueCell`(Lock + "민감 정보(마스킹)") 표시(불변)
- [Source: _bmad-output/planning-artifacts/ux-designs/.../EXPERIENCE.md:L151-153,L192(UX-DR22)] — 안전 임계 라이브 리전·모든 PII reveal=주민번호 동일 게이트+감사(reveal 은 4.5), 감사 화면 PII 차단
- [Source: docs/project-context.md] — PII 경계(로그·URL 금지·감사로그 append-only·raw 미로깅)·무ORM·3계층·JSON snake_case·새 라이브러리 금지
- [Source: _bmad-output/implementation-artifacts/2-6-관리자-영역-보강-...md] — 회고 도출 하드닝 스토리 선례(신규 마이그레이션/권한/라이브러리 0·기존 자산 확장·회귀 가드)
- [Source: _bmad-output/implementation-artifacts/1-10-감사-로그-뷰어-관리자-append-only.md] — 감사 뷰어·렌더 마스킹 원 구현(확장 대상)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context) — bmad-dev-story

### Debug Log References

- `uv run ruff check .` (api) → All checks passed(E501 5건 CJK 폭 → 주석/docstring 축약 + `mask_snapshot` 본문 헬퍼 추출로 해소).
- `uv run pytest -q` (api) → **288 passed, 9 skipped**(이전 281 → 288, +7: mask_snapshot 단위 3·응답 마스킹 1·전화 백스톱 3). 회귀 0.
- `npx vitest run` (web) → **192 passed**(이전 190 → 192). `tsc --noEmit`·`eslint .` 클린.
- 디버그 포인트(해결):
  - **masters 감사 테스트 회귀** — `name` 을 전역 마스킹하니 `test_department_create_update_deactivate_with_audit` 가 깨짐(진료과명 "내과"가 마스킹돼 감사 가독성 손실). → **`name` 테이블 인지 마스킹**으로 전환(`_PII_NAME_TABLES={patients,guardians}`, masters/roles 名 보존). D-2 트레이드오프가 테스트로 실증돼 더 정확한 해법 채택.
  - **기존 테스트 2건 갱신**: 웹 `audit.test.ts`(name 비마스킹 기대 → 테이블 인지로) · api `test_logging_pii.py`(phone 비변형 기대 → 휴대폰 백스톱으로 마스킹). 둘 다 새 동작이 정답이라 단언 갱신.
  - 항상-민감 키(연락처·건강민감·암호)는 전역 유지(1.10 웹이 이미 email/phone 전역 마스킹 — 서버가 이를 미러). `name` 만 테이블 의존이 새 변수였음.

### Completion Notes List

- **AC1(서버측 감사 스냅샷 마스킹)**: `services/audit.py` `mask_snapshot()` + `_to_entry` 에서 응답 직전 `before_data`/`after_data` 마스킹 → `GET /v1/admin/audit-logs` 응답이 더 이상 평문 PII 미노출. 게이트(`audit.read`)·봉투·셰이프 불변. 응답 통합 테스트로 평문 부재 단언.
- **AC2(건강민감·name 보강)**: 항상-민감 집합에 `allergies·chronic_diseases·medications·notes·insurance_no` 추가(서버·웹 동일). `name` 은 **테이블 인지**(patients/guardians) — masters 진료과명·roles 라벨 보존(감사 가독성). 서버 `_SENSITIVE_KEY`+`_PII_NAME_TABLES` ↔ 웹 `SENSITIVE_KEY`+`PII_NAME_TABLES` 거울.
- **AC3(append-only + 방어심층)**: 마스킹은 **읽기 시점만**(서버 1차 + 웹 렌더 방어심층 유지) — 트리거(0004)·테이블·GRANT·RLS 불변(DDL 0). 비민감 필드(chart_no·birth_date·sex·code·is_active) 보존. at-rest 평문 잔존 = 수용 갭(명시).
- **AC4(로그 전화 백스톱)**: `core/logging.py` `mask_pii` 에 휴대폰 패턴(`01[016789]`) 추가, 뒤 4자리 마스킹. RRN 먼저 치환(자릿수 비충돌). 유선·이름·주소는 신뢰 패턴 부재로 제외(규율 의존).
- **이월·교차절단**: ① 신규 마이그레이션·DDL·권한·라이브러리 0건 ② reveal(연락처·주민번호)은 Story 4.5 로 분리(스코프 결정) ③ **A-3 이월(deferred-work L153/L173) 청산** ④ at-rest 평문 = 수용 갭(write-side/암호화는 별도 하드닝).
- **결정**: read-side 마스킹(D-1, append-only 정합) · `name` 테이블 인지(D-2 갱신 — 전역→테이블, masters 회귀가 실증) · 서버·웹 단일 집합(D-3, 테스트로 일치 가드).

### File List

**수정(API):**
- `api/app/services/audit.py` — `mask_snapshot`/`_mask_value`/`_is_sensitive_key`·`_SENSITIVE_KEY`·`_PII_NAME_TABLES` + `_to_entry` 마스킹 적용
- `api/app/core/logging.py` — `mask_pii` 휴대폰 백스톱(`_PHONE_RE`·`_mask_phone`)
- `api/tests/test_admin_audit.py` — mask_snapshot 단위 3(민감/테이블인지/None·재귀) + 응답 마스킹 통합 1
- `api/tests/test_logging_pii.py` — 휴대폰 마스킹 케이스(기존 "phone 비변형" → 마스킹으로 갱신)

**수정(Web):**
- `web/src/lib/admin/audit.ts` — `SENSITIVE_KEY` 집합 보강(건강민감)·`PII_NAME_TABLES` 추가·`maskSnapshotValue` `maskName` 옵션(테이블 인지)
- `web/src/components/admin/audit-log-detail.tsx` — `maskName`(target_table 기반) → `ValueCell` → `maskSnapshotValue` 스레딩
- `web/src/lib/admin/audit.test.ts` — name 테이블 인지·건강민감 마스킹 케이스(기존 name 비마스킹 단언 갱신)

**수정(문서):**
- `docs/glossary.md` — `mask_snapshot`/`SENSITIVE_KEY`/`PII_NAME_TABLES` 등재(서버 1차+웹 방어심층·테이블 인지 name·at-rest 갭·reveal=4.5)

## Change Log

| 날짜 | 변경 | 비고 |
|---|---|---|
| 2026-06-21 | Story 3.6 컨텍스트 생성 — 감사 스냅샷 서버측 PII·건강민감 마스킹 (AC1·2·3·4) | 회고 도출 하드닝(2-6 선례). 스코프: 감사 응답 서버측 마스킹 + 건강민감·name 집합 보강(서버·웹 단일) + 웹 렌더 방어심층 유지 + 로그 전화 백스톱. 마이그레이션·권한·reveal 0건(read-side, append-only 불변). 연락처·주민번호 reveal 은 Story 4.5 로 분리(Project Lead 스코프 결정). A-3 이월(L153/L173) 청산. at-rest 평문 잔존=수용 갭 명시. |
| 2026-06-21 | Story 3.6 구현 — 감사 서버측 PII 마스킹 (AC1·2·3·4) | `services/audit.py` `mask_snapshot`(응답 직전 before/after 마스킹) + 건강민감·`insurance_no` 항상-민감 + `name` 테이블 인지(patients/guardians, masters 회귀로 전역→테이블 갱신) + 웹 `audit.ts` 거울·`audit-log-detail` maskName 스레딩 + `logging.py` 휴대폰 백스톱 + 테스트(api 단위 3·통합 1·로그 3, web name 인지). DDL/권한/reveal 0건. 전체 회귀 green(api 288 passed/9 skipped·web 192·tsc·eslint·ruff). → **review** |
| 2026-06-21 | 코드리뷰 — 3레이어 적대 리뷰 + 트리아지 | Acceptance Auditor 위반 0(AC1~4 + 이월 ①~④ + D-1~D-3 충족). **patch 0**(clear bug 없음) · defer 3(로그 휴대폰 패턴 한계=L113 묶음·중첩 name 마스킹=도달불가 엣지·서버/웹 집합 드리프트 가드) · dismiss 4(address→ip_address false positive·부분일치 over-mask=fail-closed 의도·resident_no_masked 방어심층·target_table 대소문자 미발현). 회귀 green 유지. → **done** |

## Open Questions (개발 착수 전 확인 — 차단 아님)

1. **`name` 마스킹 범위 (D-2):** 키-기반이라 roles/permissions 의 `name`(비-PII)도 마스킹됨(`code`·`actor_name` 은 보존). 수용했으나, 감사 가독성을 더 원하면 table-aware(patients/guardians/users 만 name 마스킹)로 좁힐 수 있음(복잡도↑). **권장: 키-기반 수용**(MVP).
2. **전화번호 백스톱 패턴 강도 (AC4):** 한국 전화 패턴은 false positive(일반 숫자열) 가능. 과대마스킹 허용으로 보수적 적용 권장. 너무 공격적이면 일반 로그 가독성 저하 — 패턴을 휴대폰(`01x`)+명확한 하이픈 형태로 한정할지 확인. (저위험·방어심층이라 보수적이 안전.)
3. **at-rest 평문 처리 (AC3 갭):** read-side 마스킹만으로 충분(admin-only + 마스킹 응답)한가, 아니면 별도 감사-암호화/write-side 하드닝을 추적 이월로 남길까? **권장: 수용 + 이월 기록**(write-side 는 포렌식 손실).
4. **마스킹 유틸 위치:** `services/audit.py` 모듈 함수 vs `core/pii_mask.py`(재사용 의도). 현재 소비처는 audit 하나 → `services/audit.py` 권장(YAGNI), 향후 다른 응답 마스킹 필요 시 승격.

---
_Ultimate context engine analysis completed — comprehensive developer guide created._
