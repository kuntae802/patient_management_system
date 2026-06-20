---
baseline_commit: 43ccd53f1e3b840b7a5280fde42509695a05415a
---

# Story 1.9: 주민번호 암호화 · 감사 reveal 프리미티브

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 보안 담당 개발자,
I want pgcrypto 암호화·Vault 키·복호 RPC·HMAC blind index·감사 reveal 패턴을 **재사용 가능한 제네릭 프리미티브**로 세우기를,
so that 이후 환자 주민번호 등 민감정보가 일관된 보안 경로로만 다뤄진다.

> **⚠️ 스코프의 본질 — 먼저 읽으세요.** 이 스토리는 **프리미티브(토대)** 다. 환자(`patients`) 테이블·`resident_no_enc/_hash` 컬럼·reveal **UI**·reveal **엔드포인트**는 만들지 않는다 — 그것들은 엔티티가 온라인되는 **Epic 3**(환자 등록)·**Epic 4**(진료 허브 배너 UX-DR9)에서 이 프리미티브를 **소비**한다(에픽 범위 노트: "RLS 헬퍼·감사 트리거·암호화 프리미티브는 여기서 토대를 놓고, 테이블별 RLS·주민번호 컬럼 적용은 해당 테이블을 만드는 에픽에서 수행 — 엔티티는 필요할 때만 생성"). [Source: epics.md#Epic-1 범위 노트, epics.md#Story-3.1]
> 본 스토리가 만드는 것: **제네릭 암복호/HMAC DB 함수 + Vault 키 + 자가-감사 복호 + 주민번호 검증/마스킹 순수 함수 + PII 로그 마스킹 백스톱 + 테스트**. "환자 주민번호"는 이 함수들의 **첫 소비처(미래)** 일 뿐, 지금 데이터는 없다.

## Acceptance Criteria

(epics.md Story 1.9 원문 — 본 스토리의 계약)

1. **(AC1) 암호화 프리미티브 활성화** — `0001_extensions.sql`이 pgcrypto·`gen_random_uuid`를 이미 활성화한 상태에서, **새 마이그레이션이 Supabase Vault를 활성화**하면 암호화 프리미티브가 준비된다. (FR-241) — pgcrypto/`gen_random_uuid`는 **재활성화·0001 편집 금지**(마이그레이션 불변성). [Source: prd.md#FR-241, 0001_extensions.sql:8-9]
2. **(AC2) 암복호 RPC + HMAC blind index** — service_role 한정 SECURITY DEFINER **암호화·복호 RPC + HMAC blind index 함수**를 만들면, 키는 코드·DB에 **평문으로 없고**(Vault 보관), HMAC 해시로 **중복 매칭**이 가능하다(FR-003 토대). [Source: prd.md#FR-241, prd.md#FR-003, architecture.md:184]
3. **(AC3) 권한 게이트 reveal = 감사 이벤트** — 민감정보 reveal(복호) 요청이 발생할 때 권한 게이트 reveal 패턴(눈 아이콘+"감사기록" 접근가능 라벨, UX-DR9·UX-DR22 — **패턴 확립**, UI는 Epic 4)을 적용하면, **복호 조회 자체가 감사 이벤트('read')로 기록**되고, raw 값은 **로그·토스트·에러 envelope·URL·실시간 페이로드에 절대 노출되지 않는다**(마스킹·미로깅). (FR-242 "민감정보 조회 감사") [Source: prd.md#FR-242, epics.md#UX-DR9, epics.md#UX-DR22]

### AC별 검증 가능한 완료 기준(이 스토리에서 실제 충족할 것)

- **AC1** → `0005_crypto.sql`이 Vault 시크릿(암호화 키·HMAC 키)을 **gen_random_bytes로 생성·Vault에 보관**(평문 키가 마이그레이션 파일에 없음). pgcrypto/`gen_random_uuid` 가용성 확인(0001 재사용).
- **AC2** → `encrypt_sensitive`·`decrypt_sensitive`·`blind_index` 3개 **제네릭** SECURITY DEFINER 함수. `service_role`만 EXECUTE(authenticated/anon REVOKE). 암호화→복호 라운드트립 성공, `blind_index`는 **결정적**(같은 입력 → 같은 해시).
- **AC3** → `decrypt_sensitive` 호출이 `audit_logs`에 `action='read'` 행을 **원자적으로 INSERT**(actor=`app.actor_id`, target_table/target_id 기록, **값은 미저장**). raw 주민번호가 로그에 들어가도 마스킹 필터가 레닥션. `mask_rrn` → `710314-2******`.

## Tasks / Subtasks

- [x] **Task 1 — 마이그레이션 `0005_crypto.sql`: Vault 활성화 + 키 보관 (AC1)**
  - [x] 1.1 헤더 주석(스토리·FR·설계 근거), 멱등(`create ... if not exists` / `where not exists`) — 기존 `0001~0004` 스타일 계승. [Source: 0004_audit.sql:1-2, 0002_identity_rbac.sql:1-2]
  - [x] 1.2 **`supabase_vault` 확장 가용성 확인** — 로컬 스택에서 `vault.create_secret`/`vault.decrypted_secrets` 사용 가능 여부를 `supabase start` 후 검증(Dev Notes §Vault 리스크). 필요 시 `create extension if not exists supabase_vault;`를 **방어적**으로 추가하되, 관리형 확장 충돌 시 제거.
  - [x] 1.3 **암호화 키 시크릿** 생성: `pms_pii_enc_key` = `encode(extensions.gen_random_bytes(32),'hex')` → `vault.create_secret(<key>, 'pms_pii_enc_key', '<설명>')`. **`where not exists (select 1 from vault.secrets where name='pms_pii_enc_key')`** 로 멱등(평문 키가 파일에 없음 = FR-241 충족; 환경별 키 자동 생성). [Source: WebFetch Supabase Vault docs — create_secret(secret,name,desc)]
  - [x] 1.4 **HMAC 키 시크릿** 생성: `pms_pii_hmac_key`(별도 32바이트, 위와 동일 멱등 패턴). 암호화 키와 분리(키 용도 격리).
  - [x] 1.5 `gen_random_uuid`(PG17 core)·pgcrypto(0001) 가용성은 **주석으로 명시**(재선언 금지 — 0001 불변).
- [x] **Task 2 — 제네릭 암복호 RPC `encrypt_sensitive` / `decrypt_sensitive` (AC2·AC3)**
  - [x] 2.1 `encrypt_sensitive(plaintext text) returns bytea` — `pgp_sym_encrypt(plaintext, <vault enc key>)`. SECURITY DEFINER, owner=postgres, **`set search_path = public`**, VOLATILE(IV 랜덤). vault는 **스키마 한정**(`vault.decrypted_secrets`)으로 참조. [Source: 0003_rls_helpers.sql:4-5 search_path 패턴]
  - [x] 2.2 `decrypt_sensitive(ciphertext bytea, p_target_table text, p_target_id text) returns text` — `pgp_sym_decrypt(...)` + **자가-감사**: `insert into public.audit_logs(actor_id, action, target_table, target_id) values (<actor>, 'read', p_target_table, p_target_id)`. **값(before/after)은 절대 미저장**. actor = `app.actor_id` GUC를 **UUID 형식 검증 후 캐스트**(0004 자가-DoS 가드 재사용), 미설정 시 `auth.uid()` 폴백. [Source: 0004_audit.sql:47-56 actor 캡처·UUID 가드]
  - [x] 2.3 **권한 posture**: `revoke all on function ... from public, anon, authenticated;` + `grant execute on function ... to service_role;` — 직접 클라 호출 차단(방어심층, FastAPI service_role 경유만). [Source: 0002_identity_rbac.sql:60-66, 0004_audit.sql:94-96]
- [x] **Task 3 — HMAC blind index `blind_index` (AC2, FR-003 토대)**
  - [x] 3.1 `blind_index(plaintext text) returns text` — `encode(extensions.hmac(plaintext, <vault hmac key>, 'sha256'),'hex')`. **결정적**(같은 입력 → 같은 해시 = 중복 매칭). SECURITY DEFINER, search_path, service_role only.
  - [x] 3.2 **주석으로 사용 계약 명시**: `blind_index`는 vault(테이블)를 읽으므로 **IMMUTABLE 불가 → 함수형 인덱스(`ON t (blind_index(x))`) 금지**. 소비처(Epic 3)는 **결과를 컬럼(`resident_no_hash`)에 저장 + 컬럼 UNIQUE 인덱스**로 중복 매칭. 호출자는 **정규화된** 입력(하이픈·공백 제거)을 전달(정규화 = `services/rrn`, 본 함수는 입력 그대로 HMAC).
- [x] **Task 4 — FastAPI `services/rrn.py`: 주민번호 검증·정규화·마스킹 순수 함수 (AC3 마스킹)**
  - [x] 4.1 `normalize_rrn(raw: str) -> str` — 하이픈·공백 제거 → 13자리 숫자.
  - [x] 4.2 `validate_rrn(raw) -> RrnValidation` — **HARD**(형식 6+7자리 숫자 / 생년월일 YYMMDD 유효 / 성별·세기 자리 ∈ {1..8}: 내국 1–4·외국 5–8) = 거부, **SOFT**(전통 가중 mod-11 체크섬 불일치) = **경고(통과)**. [Source: architecture.md:185]
  - [x] 4.3 `mask_rrn(raw) -> str` — `710314-2******`(생년월일 6 + 성별자리 1 노출, 뒤 6자리 마스킹). [Source: epics.md#UX-DR9 "710314-2******"]
  - [x] 4.4 **엔드포인트·patients 의존 금지** — 순수 함수만(테이블 없음). Pydantic 경계 적용은 Epic 3에서. 한국어 에러 메시지·`code` 영문.
- [x] **Task 5 — DB RPC 얇은 래퍼(`core/db.py`) — 프리미티브를 앱에서 호출 가능하게 (AC2·AC3)**
  - [x] 5.1 `encrypt_sensitive(sub, plaintext)` · `blind_index(sub, plaintext)` · `decrypt_sensitive(sub, ciphertext, target_table, target_id)` — 기존 `_run_authed`/`authenticated_conn` 패턴으로 RPC 호출(GUC actor 주입 → `decrypt_sensitive` 자가-감사 actor 캡처). [Source: api/app/core/db.py:74-121 authenticated_conn·fetch_has_permission 패턴]
  - [x] 5.2 DB 장애 → 503 매핑(`_run_authed` 재사용). reveal **엔드포인트는 미생성**(소비처 Epic 3/4 — Dev Notes §소비 가이드).
- [x] **Task 6 — `core/logging.py`: PII 마스킹 백스톱 필터 (AC3 "raw 미로깅")**
  - [x] 6.1 RRN 패턴 정규식 레닥션 `logging.Filter`(예: `\d{6}-?\d{7}` → 마스킹) + 앱 로거에 부착. raw 주민번호가 우발적으로 로그에 들어가도 레닥션(방어심층). [Source: architecture.md:275, project-context.md L82-84]
  - [x] 6.2 **레이어 규칙**: `core/`는 `services/` import 금지 → RRN 정규식·마스킹은 core에서 자급(필터 자체 정규식). 구조적 JSON 로거는 **최소 골격**(request_id 상관관계는 과도구현 금지 → deferred). [Source: deferred-work.md(로깅 상세는 본 스토리 범위 밖)]
- [x] **Task 7 — glossary 등재 (식별자 영문 snake_case)**
  - [x] 7.1 `encrypt_sensitive`/`decrypt_sensitive`/`blind_index`(함수, SECURITY DEFINER) + Vault 시크릿 `pms_pii_enc_key`/`pms_pii_hmac_key` + `mask_rrn` 포맷을 `docs/glossary.md`에 추가. `resident_no` 행은 이미 존재(L55) — 보강만. [Source: docs/glossary.md:49-55, 103-110]
- [x] **Task 8 — 테스트 (단위 + 통합, skip 패턴)**
  - [x] 8.1 **단위(스택 불요)** `api/tests/test_rrn.py` — `validate_rrn` HARD/SOFT 케이스(정상·외국 5–8·잘못된 생년월일·형식 오류·체크섬 경고), `normalize_rrn`, `mask_rrn`(`710314-2******`).
  - [x] 8.2 **단위** PII 로그 마스킹 — RRN 포함 로그 레코드가 마스킹되는지.
  - [x] 8.3 **통합(supabase 가동 시, 미가동 skip)** `api/tests/test_migrations_crypto.py` — Vault 시크릿 존재, 3개 함수 존재, **암호화→복호 라운드트립**, `decrypt_sensitive` 후 `audit_logs`에 `action='read'`+actor+target 행 생성(**값 미저장 확인**), `blind_index` 결정성, **service_role-only**(authenticated/anon EXECUTE 거부), **평문 키가 어느 마이그레이션 파일에도 없음** 정적 검사. [Source: deferred-work.md:41 skip 패턴, api/tests/conftest.py]
  - [x] 8.4 `supabase db reset` 2회(멱등) + `supabase db lint` 0 경고. [Source: 1-3 Dev Notes 멱등·lint 게이트]

### Review Findings

_코드리뷰(2026-06-20, Blind Hunter·Edge Case Hunter·Acceptance Auditor 3중). Acceptance Auditor: **AC1/AC2/AC3 전부 PASS**, 스펙 위반 없음._

- [x] [Review][Patch] Vault 키 NULL 가드 부재 — 키 부재 시 `pgp_sym_encrypt`/`hmac`가 NULL 반환 = 암호화 조용한 누락(실증). 3개 함수에 `if v_key is null then raise` [supabase/migrations/0005_crypto.sql]
- [x] [Review][Patch] PII 로그 백스톱이 숫자-인접/공백 구분 시 raw RRN 누출(`\b` 경계 한계) — 백스톱은 과대마스킹 선호로 강화 [api/app/core/logging.py:78]
- [x] [Review][Defer] decrypt actor/target = service_role GUC 신뢰(위조 가능) — deferred, 0004 감사 계약과 동일 신뢰 경계(by-design·회귀 아님) [supabase/migrations/0005_crypto.sql]
- [x] [Review][Defer] `blind_index` 입력 정규화 미강제 — deferred, 제네릭 프리미티브라 정규화는 소비처(Epic 3) 책임(문서화됨) [supabase/migrations/0005_crypto.sql]
- [x] [Review][Defer] 복호 실패 시 'read' 감사 누락 — deferred, 실패는 미노출(AC3 위반 아님)·침입탐지용 후속 강화 [supabase/migrations/0005_crypto.sql]
- [x] [Review][Defer] 로그 백스톱이 RRN만 커버(주소·연락처 미마스킹) — deferred, 최고위험 구조적 PII 우선·범위 [api/app/core/logging.py]
- [x] [Review][Defer] 래퍼 통합테스트가 append-only `audit_logs` 행 누적 — deferred, db reset 정리·테스트 위생 [api/tests/test_crypto_wrappers_integration.py]

## Dev Notes

### 이 스토리의 핵심(LLM이 틀리기 쉬운 지점 — 먼저 내재화)

1. **프리미티브 ≠ 환자.** `patients` 테이블·`resident_no_enc/_hash` 컬럼·reveal UI·reveal 엔드포인트는 **만들지 않는다**(Epic 3/4). 만드는 것은 **제네릭 함수 3개 + Vault 키 + RRN 순수함수 + PII 로그 마스킹**. 함수는 "주민번호 전용"이 아니라 **모든 PII(연락처·주소 등) 공용**(UX-DR22 "모든 PII reveal 일관 게이트")이라 이름이 `*_sensitive`/`blind_index`로 제네릭하다.
2. **0001 편집 금지.** pgcrypto·gen_random_uuid는 `0001_extensions.sql`에 이미 있다(0001 주석이 "Vault·암복호 RPC는 1.9가 **별도 마이그레이션**으로 추가"라고 명시). 0001을 재선언/수정하지 말고 **새 `0005_crypto.sql`** 을 만든다(마이그레이션 불변성). [Source: 0001_extensions.sql:1-15]
3. **권한·감사 인프라는 이미 있다 — 재사용.** `patient.reveal_rrn`(권한)·`audit_logs.action='read'`(CHECK)·`app.actor_id`(GUC 계약)가 1.3/1.8에서 이미 깔려 있다. **새로 만들지 말 것.** [Source: 0002_identity_rbac.sql:87 / 0004_audit.sql:11 / glossary.md:98,110]
4. **복호 = 감사는 DB가 강제.** AC3 "복호 조회 **자체**가 감사 이벤트"를 만족하려면 `decrypt_sensitive` 내부에서 audit INSERT(자가-감사) → 개발자가 깜빡할 수 없게 한다(방어심층). app-emitted read(glossary L98)의 **강한 형태** — chokepoint가 RPC라 우회 불가.
5. **raw 값은 어디에도 안 남긴다.** audit_logs에 복호 값을 저장하지 말 것(actor·target만). 로그·토스트·에러봉투·URL·실시간 페이로드 전부 금지. 마스킹 필터는 백스톱. [Source: project-context.md L83-84]

### 🔑 마이그레이션 번호 결정 — `0005_crypto.sql` (변이/주의)

- **결정:** 본 스토리는 `supabase/migrations/0005_crypto.sql`을 만든다.
- **근거:** 현재 존재하는 마이그레이션은 `0001~0004`뿐. 0004 다음 순번은 **0005**. crypto는 `audit_logs`(0004)·pgcrypto(0001)에 의존하므로 그 뒤여야 한다.
- **⚠️ 아키텍처 맵과의 변이:** `architecture.md:309-315`의 계획 맵은 `0005_masters`·`0006_patients`로 번호를 예약했으나, 그 마이그레이션들은 **아직 존재하지 않는다**(Epic 2/3). 1.9가 0005를 차지하면 계획상 **masters→0006·patients→0007 …로 한 칸 밀린다**. 이는 1.3이 Vault를 0001에 접지 않고 "별도 마이그레이션"으로 미룬 결정의 정직한 귀결이다(맵의 번호는 *계획*, 적용된 마이그레이션이 아님). **Story 3.1의 "0006_patients" 인용은 향후 0007로 재조정**(그 스토리 생성 시) — 본 스토리에서 architecture.md를 수정하지 않는다(범위 밖). [Source: architecture.md:309-315 vs 0001 주석, epics.md#Story-3.1]
- 파일명 후보: `0005_crypto.sql`(권장, 한 단어 도메인 — `0004_audit.sql` 스타일). 대안 `0005_encryption.sql`.

### 🔐 Vault — 실제 메커니즘과 리스크(구현 차단 가능 — 먼저 검증)

- **API(확정):** `vault.create_secret(secret text, name text, description text)` → uuid. 복호 조회 = `select decrypted_secret from vault.decrypted_secrets where name = '...'`. [Source: WebFetch supabase.com/docs/guides/database/vault]
- **패턴(아키텍처 정합):** Vault는 **키를 보관**, 컬럼 암호화는 **pgcrypto**가 수행. 즉 `pgp_sym_encrypt(plaintext, <vault에서 읽은 키>)`. (Vault TCE로 PII를 직접 보관하지 않는다 — per-row HMAC 인덱싱·대량 컬럼에 부적합.) [Source: architecture.md:184 "pgcrypto 컬럼 암호화(키는 Vault, 암복호는 service_role 한정 SECURITY DEFINER RPC)"]
- **평문 키 회피(FR-241):** 키를 마이그레이션 파일에 **literal로 쓰지 말 것**. `encode(extensions.gen_random_bytes(32),'hex')`로 **DB 안에서 생성** → Vault에 저장. 멱등 가드(`where not exists`)로 `supabase db reset` 시 dev는 재생성(데이터도 초기화되어 무해), prod는 1회 생성 후 유지.
- **⚠️ 로컬 가용성 리스크(반드시 검증):** Supabase 로컬 CLI 스택에서 `supabase_vault` 확장/`vault.decrypted_secrets`가 기본 활성인지 **`supabase start` 후 직접 확인**(`select * from vault.decrypted_secrets limit 1;`). 공식 문서는 로컬 활성 여부를 명시하지 않음. 미활성 시: (a) `create extension if not exists supabase_vault;` 방어적 추가, (b) `config.toml`의 `# [db.vault]` 섹션 검토. **검증 결과를 Completion Notes에 기록**하고, 막히면 사용자에게 보고. [Source: config.toml:56-57 `# [db.vault]` 주석 상태]
- **SECURITY DEFINER(owner=postgres)** 함수는 `vault` 스키마 접근권이 있다(postgres 소유). `set search_path = public`이므로 vault는 **스키마 한정** 참조.

### 📦 SECURITY DEFINER 함수 작성 — 확립된 규칙(엄수)

기존 `0003_rls_helpers.sql`/`0004_audit.sql`이 확립한 패턴을 **그대로** 따른다:

- `language plpgsql`(또는 분기 없으면 `sql`) + `security definer` + **`set search_path = public`**(search_path 하이재킹 방지; Supabase 린트 `0011_security_definer_*`). [Source: 0003_rls_helpers.sql:4-5,13-14]
- 함수 생성 후 **`grant execute ... to service_role;`** + 그 외 역할 **revoke**(0002의 posture). authenticated/anon은 직접 호출 불가 — 방어심층.
- actor 캡처(자가-감사 시): 0004의 **UUID 형식 검증 후 캐스트** 가드를 복제 — 비-UUID `app.actor_id`가 `::uuid` 캐스트를 터뜨려 호출 트랜잭션을 abort시키는 자가-DoS 방지. [Source: 0004_audit.sql:47-56]

참조 골격(개발자 재작성 — 정확성 본인 책임, 스타일만 예시):

```sql
-- 0005_crypto.sql — PII 암복호 프리미티브(Vault 키 + pgcrypto) + HMAC blind index + 자가-감사 복호
-- Story 1.9 / FR-241(암호화·Vault 키), FR-003(HMAC 매칭 토대), FR-242(민감정보 조회 감사).
-- 제네릭(주민번호 전용 아님 — 모든 PII 공용, UX-DR22). 키는 Vault, 코드·DB에 평문 없음.
-- 의존: 0001 pgcrypto(extensions), 0004 audit_logs(action 'read').

-- ── Vault 키(환경별 자동 생성, 평문 키 파일 미포함) ──
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),
         'pms_pii_enc_key', 'pgcrypto symmetric key for PII columns (resident_no 등)')
where not exists (select 1 from vault.secrets where name = 'pms_pii_enc_key');
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),
         'pms_pii_hmac_key', 'HMAC key for PII blind index (dedup matching, FR-003)')
where not exists (select 1 from vault.secrets where name = 'pms_pii_hmac_key');

-- ── 암호화(service_role only) ──
create or replace function public.encrypt_sensitive(p_plaintext text)
returns bytea language plpgsql security definer set search_path = public as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'pms_pii_enc_key';
  return extensions.pgp_sym_encrypt(p_plaintext, v_key);
end $$;

-- ── 복호 + 자가-감사(복호 = 감사 이벤트, AC3) ──
create or replace function public.decrypt_sensitive(
  p_ciphertext bytea, p_target_table text, p_target_id text)
returns text language plpgsql security definer set search_path = public as $$
declare v_key text; v_actor uuid; v_actor_txt text; v_plain text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'pms_pii_enc_key';
  v_plain := extensions.pgp_sym_decrypt(p_ciphertext, v_key);
  -- actor: app.actor_id(검증된 UUID) → auth.uid() 폴백 (0004 가드 복제)
  v_actor_txt := nullif(current_setting('app.actor_id', true), '');
  v_actor := coalesce(
    case when v_actor_txt ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         then v_actor_txt::uuid end, auth.uid());
  insert into public.audit_logs(actor_id, action, target_table, target_id)
    values (v_actor, 'read', p_target_table, p_target_id);  -- 값(before/after) 절대 미저장
  return v_plain;
end $$;

-- ── HMAC blind index(결정적 — 중복 매칭) ──
create or replace function public.blind_index(p_plaintext text)
returns text language plpgsql security definer set search_path = public as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'pms_pii_hmac_key';
  return encode(extensions.hmac(p_plaintext, v_key, 'sha256'), 'hex');
end $$;
-- 주의: vault(테이블) 읽으므로 IMMUTABLE 불가 → 함수형 인덱스 금지.
--       소비처(Epic 3)는 결과를 컬럼에 저장 + 컬럼 UNIQUE 인덱스로 매칭.

-- ── 권한 posture(직접 클라 호출 차단 — service_role 경유만) ──
revoke all on function public.encrypt_sensitive(text)            from public, anon, authenticated;
revoke all on function public.decrypt_sensitive(bytea,text,text) from public, anon, authenticated;
revoke all on function public.blind_index(text)                  from public, anon, authenticated;
grant execute on function public.encrypt_sensitive(text)            to service_role;
grant execute on function public.decrypt_sensitive(bytea,text,text) to service_role;
grant execute on function public.blind_index(text)                  to service_role;
```

> 위 SQL은 **스타일·접근 예시**다. `pgp_sym_decrypt` 반환 타입(text/bytea)·`hmac` 인자 위치·vault 컬럼명(`decrypted_secret`) 등은 **로컬 스택에서 직접 검증**하고, 실패 시 공식 문서/`\df`로 시그니처 확인 후 조정한다.

### 🔁 FastAPI 소비 패턴(본 스토리는 래퍼+테스트까지, 엔드포인트는 Epic 3/4)

- 기존 `authenticated_conn(sub)`이 `app.actor_id`를 주입하므로, `decrypt_sensitive`를 그 안에서 호출하면 자가-감사 actor가 정확히 잡힌다. [Source: api/app/core/db.py:74-90]
- **미래 reveal 엔드포인트(Epic 3/4) 가이드**(여기서 구현 X, 문서화만): `authenticated_conn` 안에서 **`has_permission('patient.reveal_rrn')` 재평가**(TOCTOU 차단 — deferred-work.md:31 패턴) → `decrypt_sensitive(ciphertext,'patients',patient_id)` → 응답은 **`mask_rrn` 적용 후 반환**(full 값은 별도 권한+사유 시에만, UX-DR22). [Source: deferred-work.md:31, glossary.md:131 동일 트랜잭션 패턴]
- 래퍼는 `_run_authed`로 DB 장애 → 503 매핑(전면 500 금지). [Source: api/app/core/db.py:93-103]

### 주민번호 검증 규칙(정확히)

[Source: architecture.md:185]
- **HARD(거부):** ① 형식 = `\d{6}-?\d{7}`(정규화 후 13자리 숫자) ② 생년월일 = 성별자리로 세기 결정(1·2→1900s, 3·4→2000s, 5·6→외국1900s, 7·8→외국2000s) + `YYMMDD` 유효(월 01–12, 일 유효) ③ 성별·세기 자리 ∈ {1..8}.
- **SOFT(경고·통과):** 전통 가중치 mod-11 체크섬 불일치 — 2020 개편으로 신규 번호가 체크섬을 안 따를 수 있어 **차단 아님**(경고만).
- 검증은 `services/rrn`(FastAPI Pydantic 경계) + 클라 사전체크(Epic 3). 본 스토리는 **순수 함수**만(경계 적용 X).

### Previous Story Intelligence (1.3·1.5·1.7·1.8에서 계승)

- **마이그레이션 멱등·lint:** `create ... if not exists`/`create or replace`, `supabase db reset` 2회 무오류, `supabase db lint` 0경고가 1.3의 완료 기준. [Source: 1-3]
- **감사 actor GUC 계약:** 쓰기 트랜잭션마다 `set local app.actor_id`(검증된 UUID). 비-UUID 주입 = 자가-DoS. `authenticated_conn`이 이미 보장. [Source: api/app/core/db.py:11-12,83-89]
- **동일 트랜잭션 권한평가+쓰기(TOCTOU):** 1.7 `set_role_permission`·1.8 `insert_staff_profile`가 `authenticated_conn` 안에서 `has_permission` 재평가 후 쓰기. 미래 reveal 엔드포인트도 동일. [Source: api/app/core/db.py:124-185,214-274, deferred-work.md:31]
- **service_role posture:** 신규 객체는 auto-expose off → 명시적 GRANT 필요(`config.toml` auto_expose 주석). 함수도 동일. [Source: 0002_identity_rbac.sql:57-66, config.toml:19-24]
- **테스트 skip 패턴:** 스택 미가동 시 통합 테스트는 `pytest.skip`(관대 CI). 1.9 통합 테스트도 동일 `conftest.py` 픽스처 사용. [Source: deferred-work.md:41, api/tests/conftest.py]
- **1.3 deferred — id 컬럼 계약:** `audit_trigger_fn`은 테이블 트리거용(`id` 추출). 1.9 `decrypt_sensitive`는 트리거가 아니라 **명시적 INSERT**(target_id를 인자로 받음)라 이 함정과 무관 — target_id를 정확히 넘기면 됨. [Source: deferred-work.md:40]

### Git Intelligence(최근 작업 패턴)

- 최근 커밋: 1.8(직원 계정 관리) — `feat(api)`/`feat(web)`/`chore(bmad)` 3분할 커밋, 코드리뷰 findings·deferred-work 동반. 1.9도 **api/db 중심**(web 없음 — UI는 Epic 4) → `feat(db)`+`feat(api)` 분할 예상. 산출물(스토리·findings·deferred)은 별도 `chore(bmad)`.
- `auto-commit-after-review` 메모리: 코드리뷰 done 시 자동 커밋(코드/산출물 분리). [Source: git log, memory]

### 최신 기술 참고(2026-06 검증)

- **Supabase Vault:** Transparent Column Encryption, `vault.decrypted_secrets` 뷰(`decrypted_secret` 컬럼)로 SQL에서 on-the-fly 복호. `vault.create_secret(secret,name,description)`. 로컬 스택 활성 여부는 docs 미명시 → **직접 검증 필수**(Vault 리스크 섹션). pgsodium은 deprecation 경로 — **pgsodium 쓰지 말 것**(Vault + pgcrypto 사용). [Source: WebFetch supabase.com/docs/guides/database/vault, WebSearch 2025]
- **pgcrypto:** `pgp_sym_encrypt/pgp_sym_decrypt`(무결성 포함 대칭) 권장 > `encrypt()`(raw AES, 무결성 없음). `hmac(data, key, type)`로 blind index. 확장은 `extensions` 스키마(0001). [Source: 0001_extensions.sql:11-15]

### Project Structure Notes

- **신규 파일:**
  - `supabase/migrations/0005_crypto.sql` (Task 1–3)
  - `api/app/services/rrn.py` (Task 4 — architecture가 명명한 `services/rrn` [Source: architecture.md:341])
  - `api/tests/test_rrn.py`, `api/tests/test_migrations_crypto.py` (Task 8)
- **수정 파일:**
  - `api/app/core/db.py` (Task 5 — RPC 래퍼; 기존 `_run_authed` 패턴 옆에 추가. 대안: architecture의 `api/app/db/`가 의도된 home이나 1.5–1.8이 `core/db.py`를 일관 사용 → **`core/db.py` 권장**(분산 방지). [Source: architecture.md:343 vs 실제 관행])
  - `api/app/core/logging.py` (Task 6 — 현재 TODO 스텁 [Source: api/app/core/logging.py:6])
  - `docs/glossary.md` (Task 7)
- **명명:** DB/함수/시크릿 = 영문 snake_case. Python = snake_case. JSON 필드(미래 응답) = snake_case(camelCase 금지). [Source: project-context.md L48-51]
- **변이/충돌:** ① 마이그레이션 번호 0005(위 §결정 — 아키텍처 맵 한 칸 시프트). ② reveal **UI/엔드포인트 부재**는 의도된 스코프(에픽 범위 노트) — AC3는 DB 프리미티브+패턴 확립으로 충족, 눈 아이콘 UI는 Epic 4 UX-DR9.

### Testing Standards

- Python: `pytest`(`api/tests/`), 단위(스택 불요) + 통합(`supabase start` 필요, 미가동 skip). [Source: architecture.md:345, project-context.md L63]
- 통합 검증 = 라운드트립·자가-감사 행·결정성·service_role-only·평문 키 부재 정적검사. 골든패스 E2E·커버리지 게이트는 Post-MVP(과도 명세 금지). [Source: project-context.md L65]
- 검증 3중(클라 Zod → 서버 Pydantic → DB 제약) 경계 반영 — 단, 1.9는 DB+순수함수라 Zod/Pydantic 경계는 Epic 3에서. [Source: project-context.md L64]

### References

- [Source: epics.md#Story-1.9] — AC 원문, 프리미티브 프레이밍
- [Source: epics.md#Epic-1 범위 노트(L321)] — 프리미티브 vs 엔티티 적용 경계
- [Source: epics.md#Story-3.1(L651-667)] — 소비처(0006/0007_patients가 `_enc/_hash`+프리미티브 적용)
- [Source: epics.md#UX-DR9, #UX-DR22] — 마스킹 `710314-2******`·reveal 게이트·PII 경계·감사
- [Source: prd.md#FR-241/FR-003/FR-242] — 암호화·Vault 키 / HMAC 매칭 / 민감정보 조회 감사
- [Source: architecture.md:184-185] — 주민번호 암호화·유효성 규칙
- [Source: architecture.md:309-315] — 마이그레이션 맵(번호 변이 근거)
- [Source: architecture.md:341,343-345] — services/rrn·db/·tests 위치
- [Source: 0001_extensions.sql] — pgcrypto 활성·1.9 별도 마이그레이션 명시·0001 불변
- [Source: 0002_identity_rbac.sql:83-107] — `patient.reveal_rrn` 권한 이미 시드·GRANT posture
- [Source: 0003_rls_helpers.sql:4-5] — SECURITY DEFINER search_path 규칙
- [Source: 0004_audit.sql:11,26-70,94-96] — audit_logs action 'read'·actor 캡처·UUID 가드·append-only
- [Source: api/app/core/db.py:74-121] — authenticated_conn·_run_authed·RPC 호출 패턴
- [Source: api/app/core/logging.py] — PII 마스킹 TODO 스텁
- [Source: docs/glossary.md:49-55,93-110] — resident_no·audit action·GUC 계약·헬퍼
- [Source: deferred-work.md:31,40,41] — TOCTOU 동일 트랜잭션·id 컬럼 계약·skip 패턴
- [Source: WebFetch supabase.com/docs/guides/database/vault] — Vault create_secret/decrypted_secrets API
- [Source: config.toml:15,56-57] — extensions search_path·`[db.vault]` 주석 상태

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Opus 4.8, 1M context)

### Debug Log References

- **Vault 리스크 사전 검증(구현 차단 가능 최대 리스크 해소):** 로컬 스택에서 `supabase_vault` 0.3.1 설치 확인(`vault.secrets`/`vault.decrypted_secrets` 존재, `create_secret(secret,name,description)` 시그니처 일치, `decrypted_secret` 컬럼 존재). pgcrypto 함수는 전부 `extensions` 스키마 → 함수 내 스키마 한정 호출. `create extension` 불요(관리형 사전 설치).
- **SQL 사전 실증(롤백 트랜잭션):** encrypt→decrypt 라운드트립·blind_index 결정성/충돌·service_role EXECUTE 허용·authenticated 거부·복호 자가-감사(audit_logs 'read' 1행, actor/target 정확, before/after NULL) 전부 green 확인 후 마이그레이션 작성.
- **db reset:** 0001~0005 + seed 클린 적용. **db lint: No schema errors found**(SECURITY DEFINER search_path 충족).
- **멱등성:** 0005 재적용 → 오류 0·`create_secret` 0 rows(`where not exists` 가드 작동)·시크릿 각 1개·함수 정상.
- **전체 스위트:** 124 passed, 7 skipped(기존 `test_admin_users_integration` — `SUPABASE_SECRET_KEY` 미설정, 본 스토리 무관), 0 failed. ruff check All checks passed.

### Completion Notes List

- **AC1 충족:** `0005_crypto.sql` 이 Vault 시크릿 2종(`pms_pii_enc_key`·`pms_pii_hmac_key`)을 `gen_random_bytes(32)` 로 **DB 안에서 생성·Vault 보관**(마이그레이션 파일에 평문 키 0 — `test_migration_has_no_plaintext_key` 정적 검사로 강제). pgcrypto/`gen_random_uuid`는 0001 재사용(편집 0).
- **AC2 충족:** `encrypt_sensitive`·`decrypt_sensitive`·`blind_index` **제네릭** SECURITY DEFINER 함수(search_path=public), **service_role 한정**(authenticated/anon REVOKE). 키는 Vault `decrypted_secrets` 로만 조회. `blind_index` 결정적(중복 매칭, FR-003 토대) — IMMUTABLE 불가 주석으로 소비처 계약(컬럼+UNIQUE) 명시.
- **AC3 충족:** `decrypt_sensitive` 가 복호 시 `audit_logs` 에 `read` 이벤트를 **원자적 자가-기록**(actor=`app.actor_id`, target_table/target_id, **값 미저장**) → "복호=감사"를 DB가 강제(우회 불가). raw 미노출: `mask_rrn`(`710314-2******`) + `PiiMaskingFilter` 로그 백스톱(lifespan 부착).
- **스코프 준수:** patients 테이블·`resident_no` 컬럼·reveal UI/엔드포인트 **미생성**(에픽 범위 노트 — Epic 3/4 소비). 본 스토리는 재사용 프리미티브 + 검증/마스킹 순수함수 + 라운드트립/자가감사 검증까지.
- **마이그레이션 번호 결정:** `0005_crypto.sql` 채택 → 아키텍처 계획 맵의 `0005_masters`·`0006_patients` 는 0006·0007 로 한 칸 시프트(계획 번호는 예약, Epic 2/3 스토리 생성 시 재조정). glossary 에 변이 노트 기록.
- **확립 패턴 계승:** SECURITY DEFINER+search_path(0003), actor UUID 가드(0004 자가-DoS 방지 복제), `authenticated_conn`/`_run_authed`(1.5·1.8), conftest skip 픽스처(1.3). 신규 라이브러리 0.

### File List

**신규(api/db):**
- `supabase/migrations/0005_crypto.sql` — Vault 키 + encrypt_sensitive·decrypt_sensitive(자가감사)·blind_index + GRANT posture
- `api/app/services/rrn.py` — 주민번호 normalize/validate(HARD·SOFT)/mask 순수함수
- `api/tests/test_rrn.py` — rrn 단위(26)
- `api/tests/test_migrations_crypto.py` — 마이그레이션 통합 스모크(7: 라운드트립·자가감사·service_role-only·평문키 부재)
- `api/tests/test_crypto_wrappers_integration.py` — db.py 래퍼 asyncpg 경로 통합(1: bytea·GUC actor)
- `api/tests/test_logging_pii.py` — PII 로그 마스킹 단위(8)

**수정:**
- `api/app/core/db.py` — encrypt_sensitive·decrypt_sensitive·blind_index async 래퍼 추가
- `api/app/core/logging.py` — PII 마스킹 필터(스텁 → 구현)
- `api/app/main.py` — lifespan 에 `configure_logging()` 백스톱 부착
- `docs/glossary.md` — 암복호 프리미티브·Vault 시크릿·rrn·PII 마스킹·번호 변이 노트 등재

## Change Log

| 날짜 | 변경 | 비고 |
|---|---|---|
| 2026-06-20 | Story 1.9 구현 — 암복호 프리미티브(0005) + rrn 순수함수 + db 래퍼 + PII 로그 마스킹 + glossary | 42 신규 테스트(단위 34/통합 8), 회귀 0, db lint 0, ruff 0. 상태 → review |
| 2026-06-20 | 코드리뷰 3중(AC1/2/3 PASS). Patch 2건 적용: ① Vault 키 NULL 가드(조용한 암호화 누락 → 명시 예외) ② PII 로그 백스톱 과대마스킹(숫자·공백 인접 raw 누출 차단). Defer 5·Dismiss 4 | 127 passed/7 skip, ruff 0, db lint 0. 상태 → done |
