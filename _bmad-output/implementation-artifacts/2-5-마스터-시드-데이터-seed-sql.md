---
baseline_commit: d980f60e8b1b4c57dbd2c9ac983602e47031a0b0
---

# Story 2.5: 마스터 시드 데이터 (seed.sql)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 개발자,
I want 데모·개발용 마스터 시드(진료과·진료실·KCD 진단·EDI 수가·약품)를 `supabase/seed.sql`에 **실제처럼 풍부하고 현재-유효한** 데이터로 적재하되, 기존 dev 계정 시드를 회귀시키지 않고 재실행 안전(idempotent)하게 만들기를,
so that 빈 마스터 테이블 대신 실제 코드 위에서 검색 피커·후속 골든 패스(Epic 3~7)가 동작하고, 시연이 믿을 만한 데이터로 굴러간다.

## Acceptance Criteria

> **출처:** epics.md Story 2.5 (AC1·AC2·AC3 = 에픽 원문, 635-645행). AC4~AC6 = 시드를 "운영 가능한 검증 기준"으로 구체화(데이터 현재-유효성·멱등/안전·회귀 가드) — 빈 INSERT 묶음이 아니라 소비처 피커·후속 에픽이 실제로 소비할 수 있는 시드가 되게 한다.

**AC1 (에픽 — 시드 적재):**
**Given** 마이그레이션 0001~0008 적용 후 비어 있는 마스터 테이블에서
**When** `supabase db reset`(= 마이그레이션 후 `seed.sql` 실행)을 수행하면
**Then** `departments`·`rooms`·`diagnoses`·`fee_schedules`·`drugs` 5개 테이블에 EDI 수가·약품·KCD·진료과·진료실 마스터 + 샘플이 적재된다(테이블별 최소 행 수는 Task 본문 참조).

**AC2 (에픽 — 피커가 실제 코드 노출):**
**Given** 시드가 적재된 상태에서
**When** 임상·정산 검색 피커(`fetchCurrentlyValidMasters`, 2.3)나 관리자 목록을 열면
**Then** 시드된 실제 코드가 검색·선택된다. 이를 보장하려면 **모든 시드 코드 행은 "현재 유효"**여야 한다 — `is_active=true` AND `effective_from <= 오늘(2026-06-20)` AND (`effective_to IS NULL` OR `effective_to >= 오늘`). (소비처 술어 = `isCurrentlyValid`, masters.ts:180.)

**AC3 (에픽 — 수가 매핑은 다운스트림):**
**Given** 행위·진단 → EDI 수가 코드 매핑(`fee_mappings`)에 대해
**When** 본 스토리 범위를 정할 때
**Then** **매핑 *내용*은 Epic 7 착수 전 별도 확정**한다(다운스트림 명시 추적). 본 스토리는 `fee_schedules`의 **코드·단가 마스터 행 자체**까지만 시드한다 — 매핑 규칙·`fee_mappings` 테이블은 만들지 않는다(테이블 미존재, Epic 7 스키마).

**AC4 (현실성·범위 — "최대한 실제처럼"):**
**Given** 외래 중소병원 골든 패스를 시연하기에 충분한 폭에 대해
**When** 각 마스터를 시드하면
**Then** 한국 표준 형식의 **실제처럼 그럴듯한** 데이터가 적재된다 — KCD-8 상병코드(영문1+숫자, 예 `I10`/`J00`/`M54.5`), 심평원 행위 분류 형식의 EDI 수가코드 + 현실적 `amount_krw`(KRW 정수), 약품(제품명 + `ingredient_code` 주성분 + `unit` 정/캡슐/mL), 외래 진료과·진료실. 규제 100% 정합이 기준이 아니라 **믿을 만한 시연 데이터**가 기준이다(정확한 심평원 코드·단가는 근사 허용).

**AC5 (멱등·안전 — 재실행/운영 가드):**
**Given** `seed.sql`(이미 dev 계정 블록 보유, 76행)에 마스터 시드를 추가할 때
**When** seed가 두 번 이상 실행되거나(수동 `psql -f` 재적용 포함) 운영 배포 경로를 탈 때
**Then** (a) 마스터 INSERT는 **재실행 안전**(`ON CONFLICT ... DO NOTHING`)하고, (b) 기존 **dev 계정 `do $$` 블록은 무회귀**(앞에 그대로 보존), (c) 운영 안전 불변(seed는 로컬 `db reset`에서만 실행 — `db push`는 seed 미실행) 주석·구조 유지. **`ON CONFLICT (code)` 금지** — 0008이 `code` unique 제약을 `lower(code)` 함수 인덱스로 교체했으므로 `ON CONFLICT (lower(code))` 또는 targetless `ON CONFLICT DO NOTHING`을 쓴다.

**AC6 (회귀 가드 — 스키마·코드 무변):**
**Given** 본 스토리의 모든 변경에 대해
**When** 시드를 추가하면
**Then** (a) **적용된 마이그레이션 0001~0008 편집 금지**, 신규 마이그레이션·DDL·API·UI **신설 0**(순수 데이터 시드), (b) 시드 INSERT가 감사 트리거(0004·0006·0007)를 발화시켜 `audit_logs.actor_id=NULL`로 기록되는 것은 **정상**(append-only·FK 부재 — INSERT 차단 안 함, 별도 처리 불요), (c) 1.x·2.1~2.4의 기존 동작·테스트는 회귀하지 않는다.

> **AC 해석(중요 · dev agent 필독):**
> 이 스토리는 **기능이 아니라 데이터 스토리**다. 5개 마스터 테이블 스키마(0006·0007)·CI unique(0008)·검색 피커(2.3)·관리자 UI(2.1·2.2)·soft delete(2.4)는 **이미 전부 구현·테스트됨**. 본 스토리가 만드는 산출물은 사실상 **`supabase/seed.sql` 하나**(+ 가벼운 시드-존재 검증 테스트 + glossary 한 줄). 새 스키마·새 엔드포인트·새 컴포넌트를 만들지 말 것 — 빈 테이블을 **현재-유효한 현실적 데이터로 채우는 것**이 전부다.
>
> **결정적 함정 3가지:** ① **날짜** — `effective_from`이 미래면 코드가 "pending"이 되어 피커에 안 뜬다(AC2 실패). 반드시 과거 발효(예 `2020-01-01`)·`effective_to=NULL`. ② **ON CONFLICT 추론 대상** — 0008 이후 `code` 컬럼엔 제약이 없다(함수 인덱스 `lower(code)`만). `ON CONFLICT (code)`는 "no unique or exclusion constraint matching" 에러. ③ **FK 순서** — `rooms.department_id → departments.id`. departments를 먼저 INSERT하고, rooms는 `(select id from departments where lower(code)=lower('OS'))` 서브셀렉트로 참조(하드코딩 UUID 관리 회피).

## Tasks / Subtasks

- [x] **Task 1 — seed.sql: 진료과·진료실 시드 (departments, rooms) (AC1·AC4·AC5)** [supabase/seed.sql]
  - [x] 기존 dev 계정 `do $$ ... $$` 블록(22-76행) **뒤에** 마스터 시드 섹션을 추가(앞 블록 절대 수정 금지 — AC5b). 헤더 주석(4-6행)의 "후속 스토리(Story 2.5)가 작성한다" 자리표시를 실제 시드를 가리키도록 갱신(또는 제거).
  - [x] `departments`: 외래 중소병원 진료과 **6~8개**. 예: `IM`(내과)·`FM`(가정의학과)·`OS`(정형외과)·`ENT`(이비인후과)·`PED`(소아청소년과)·`DERM`(피부과). `INSERT INTO public.departments (code, name) VALUES (...) ON CONFLICT (lower(code)) DO NOTHING;` (id·is_active·타임스탬프는 default). `code`는 영문 대문자 일관(0008 CI unique — 케이스 혼용 금지).
  - [x] `rooms`: 진료실 **6~10개**. 진료실은 진료과에 소속(`department_id` 서브셀렉트), 공용 공간(처치실·영상촬영실)은 `department_id=NULL` 허용(스키마상 nullable). 예: `R101`(제1진료실, IM)·`R102`(제2진료실, FM)·`R103`(제3진료실, OS)·`R201`(제4진료실, ENT)·`TRT1`(처치실, NULL)·`XR1`(영상촬영실, NULL). `department_id`는 `(select id from public.departments where lower(code)=lower('IM'))` 패턴 — **departments 시드 다음에 와야 FK 충족**(AC 해석 함정 ③). `ON CONFLICT (lower(code)) DO NOTHING`.
  - [x] 한국어는 `name`(표시명)·주석만, `code`는 영문 snake/대문자(project-context §식별자 언어). 신규 도메인 *식별자* 신설 아님(코드값) → glossary 등재 불요.

- [x] **Task 2 — seed.sql: KCD 진단 시드 (diagnoses) (AC1·AC2·AC4)** [supabase/seed.sql]
  - [x] `diagnoses`: 외래에서 흔한 KCD-8 상병 **18~25개**. `effective_from`은 과거(예 `'2020-01-01'`), `effective_to=NULL`(무기한·현재 유효 — AC2). 컬럼: `(code, name, effective_from, effective_to)` + default(is_active=true·타임스탬프).
  - [x] 현실적 대표 코드(그럴듯하면 충분 — AC4): `J00`(급성 비인두염[감기])·`J02.9`(상세불명 급성 인두염)·`J03.9`(급성 편도염)·`J20.9`(급성 기관지염)·`J30.4`(알레르기비염)·`I10`(본태성 고혈압)·`E11.9`(2형 당뇨병)·`E78.5`(고지질혈증)·`K21.9`(위-식도역류병)·`K29.7`(위염)·`A09`(감염성 위장염)·`M54.5`(요통)·`M25.50`(관절통)·`M75.0`(유착성 관절낭염/오십견)·`L20.9`(아토피피부염)·`L30.9`(피부염)·`N39.0`(요로감염)·`R51`(두통)·`R05`(기침)·`R50.9`(상세불명 발열). (소수점 세분류는 KCD 표기 그대로 문자열.)
  - [x] `effective_from` 미래 금지(AC2 함정 ①). `effective_to >= effective_from` CHECK 충족(NULL이면 자동 통과). `ON CONFLICT (lower(code)) DO NOTHING`.

- [x] **Task 3 — seed.sql: EDI 수가 시드 (fee_schedules) (AC1·AC3·AC4)** [supabase/seed.sql]
  - [x] `fee_schedules`: 외래 골든 패스 행위 **15~25개**(진찰료·검사료·처치료·영상료 구색). 컬럼: `(code, name, amount_krw, category, effective_from, effective_to)`. `amount_krw`는 **KRW 정수**(소수 없음·`>=0` CHECK), 2026년 외래 수준으로 현실적. `category`는 분류 라벨(예 `진찰료`/`검사료`/`처치료`/`영상료`) — nullable이나 채워 두면 후속 그룹핑에 유용.
  - [x] 대표 예(코드·단가는 근사 허용 — AC4): 초진진찰료(의원)·재진진찰료(의원)·일반혈액검사(CBC)·요검사(요화학)·심전도검사·흉부단순촬영(1매)·근육내주사·정맥내주사·단순처치/드레싱·이비인후처치. 코드는 심평원 행위 분류 형식의 그럴듯한 영숫자(예 `AA154`/`AA254` 류)로.
  - [x] **AC3 경계 명시:** 여기서는 **수가 코드·단가 마스터 행만** 시드한다. "행위/진단 → 수가코드" **매핑 규칙·`fee_mappings`는 만들지 않는다**(테이블 미존재 — Epic 7). 급여여부·본인부담·산정특례 컬럼도 미존재(0007이 Epic 7로 이연) → 시드하지 않음. `effective_from` 과거·`effective_to=NULL`(AC2). `ON CONFLICT (lower(code)) DO NOTHING`.

- [x] **Task 4 — seed.sql: 약품 시드 (drugs) (AC1·AC4)** [supabase/seed.sql]
  - [x] `drugs`: 외래 흔한 처방 약품 **15~20개**. 컬럼: `(code, name, ingredient_code, unit, effective_from, effective_to)`. `name`=제품명(한글), `ingredient_code`=주성분코드(9자리 숫자 문자열, 대체조제용·nullable이나 채움), `unit`=`정`/`캡슐`/`mL`/`앰플` 등.
  - [x] 대표 예(그럴듯하면 충분): 아세트아미노펜정500mg(타이레놀)·이부프로펜정·록소프로펜나트륨정·아목시실린캡슐250mg·세파클러캡슐·세티리진정·로라타딘정·암로디핀정5mg·메트포르민정500mg·아토르바스타틴정·판토프라졸정·라베프라졸정·덱사메타손주·생리식염수주·리도카인주. `code`=의약품 표준/보험코드 형식의 그럴듯한 값(대소문자 일관). `effective_from` 과거·`effective_to=NULL`. `ON CONFLICT (lower(code)) DO NOTHING`.

- [x] **Task 5 — 적용·검증 + 시드-존재 테스트 (AC1·AC2·AC5·AC6)** [api/tests/]
  - [x] **로컬 적용:** `supabase db reset`(마이그레이션 0001~0008 재적용 + seed.sql 실행). 에러 없이 완료 + dev 계정 정상 재생성(회귀 가드 AC5b·AC6c). 재실행(`db reset` 2회 또는 `psql -f seed.sql`)해도 멱등(중복 0 — AC5a) 확인.
  - [x] **시드-존재 검증 테스트** 추가: 기존 통합 테스트 하니스 패턴(로컬 스택 미가용 시 `skip`, `psql` fixture로 직접 SQL — 2.4 `test_masters_integration.py` 미러)을 따라 `api/tests/test_seed_masters.py`(또는 기존 마이그레이션/마스터 테스트에 합류) 작성:
    - 5개 테이블 각각 `count(*) >= 기대 최소치`(예 departments≥6·rooms≥6·diagnoses≥18·fee_schedules≥15·drugs≥15) 단언(AC1).
    - 테이블별 대표 코드 1개가 **현재 유효** 단언 — `is_active AND effective_from <= current_date AND (effective_to is null or effective_to >= current_date)`(예 `diagnoses.code='I10'`, `departments.code='IM'`) (AC2).
    - `amount_krw >= 0` 전수, `effective_to is null or effective_to >= effective_from` 전수(스키마 CHECK가 보증하나 시드 회귀 가드로 1건).
  - [x] **과도 명세 금지:** 골든 패스 E2E·웹 피커 E2E는 Post-MVP(project-context §Testing — "지금 과도 명세 금지"). 시드 검증은 **데이터 존재·유효성 수준**에서 멈춘다. 웹 단위 테스트 신규 불요(피커 로직은 2.3에서 이미 커버, 시드는 데이터일 뿐).

- [x] **Task 6 — 문서·정리 (AC3·AC6)** [docs/]
  - [x] `docs/glossary.md`에 시드 정책 한 줄(있으면 갱신): "마스터 시드(진료과·진료실·KCD·EDI수가·약품) = `seed.sql`(Story 2.5). 수가 매핑(`fee_mappings`) 내용은 Epic 7." — **다운스트림 추적(AC3)**. 신규 *도메인 식별자* 신설은 없음(전부 코드값) → glossary 엔티티 표 추가 불요.
  - [x] `deferred-work.md`에 본 스토리가 **닫는** 항목(있으면)·**여전히 이연**하는 항목(`fee_mappings` 매핑 내용 = Epic 7) 반영. 새 deferred는 리뷰 단계에서 findings로 기록.
  - [x] **검증 마감:** `supabase db reset` 클린 + 시드 테스트 GREEN + 기존 API/web 테스트 전부 회귀 없음(2.4 기준 API 199 pass/7 skip · web 122 pass — 시드는 코드 무변경이라 영향 없어야 함). `database.types.ts` 재생성 불요(시드는 스키마 셰이프 무변).
  - [x] 커밋은 의미 단위(승인 시에만 — project-context): `feat(db): 마스터 시드 데이터 seed.sql(진료과·진료실·KCD·EDI수가·약품) (Story 2.5)` 단일 또는 db/test 분리. 산출물·findings·deferred는 done 시 `chore(bmad)` 별도 커밋(2.1~2.4 리듬).

### Review Findings (코드 리뷰 2026-06-21)

> 3레이어 적대적 리뷰(Blind Hunter · Edge Case Hunter · Acceptance Auditor). **Acceptance Auditor: AC1~AC6 strong pass** — 마이그레이션 0001~0008 무편집·신규 DDL/API/UI 0·dev 계정 블록 보존·`fee_mappings` 미누출·전 코드행 현재유효. doctor→IM 배정은 스펙 "선택적 고려" 항목으로 문서화·가드 확인(clean). 분류: decision-needed 0 · patch 3 · defer 2 · dismiss 10.

**Patch (적용 대상 — 신규 시드 테스트 강화):**
- [x] [Review][Patch] 멱등 테스트가 신규 코드 케이스무관 dedup을 직접 증명하도록 강화 — 현재는 이미 시드된 'IM'에 'im'을 재삽입해 "케이스무관 충돌"은 맞게 보지만, 던져버릴 throwaway 코드를 대소문자로 2회 삽입해 count==1을 직접 단언하면 ON CONFLICT 발화를 더 명확히 증명 [api/tests/test_seed_masters.py test_seed_insert_is_idempotent_on_lower_code] (blind+edge+auditor)
- [x] [Review][Patch] `test_seed_no_future_or_inactive_code_rows` 이름↔단언 불일치 — 이름은 "future or inactive"인데 미래발효만 검사. `is_active=false` 시드행도 0건임을 단언하도록 보강(이름과 일치 + AC2 가드 강화) [api/tests/test_seed_masters.py:79] (auditor)
- [x] [Review][Patch] 매핑된 시드 진료실 R102~R106의 department_id NULL 누출 미단언 — 현재 R101→IM·TRT1→NULL만 검사. 서브셀렉트 미스 시 무음 NULL을 잡도록 R101~R106 전부 non-NULL 단언 추가 [api/tests/test_seed_masters.py test_seed_rooms_reference_departments] (blind)

**Defer (기존 이월·하니스 전반 — 본 스토리 범위 밖):**
- [x] [Review][Defer] 의존성 카운트 테스트가 시드 doctor를 차용 — 2.5의 doctor→IM 배정으로 원복 robustness 위험 가중(크래시 시 doctor가 throwaway 진료과에 잔류; 종전엔 NULL 자연상태). 2.4 리뷰에서 이미 deferred(deferred-work.md), 본 스토리가 영향도만 상향. 정식 수정=전용 임시 직원 픽스처(test_masters_integration.py — 본 스토리 File List 밖) [api/tests/test_masters_integration.py test_department_dependents_count] — deferred, 기존 이월(2.4)·영향 가중
- [x] [Review][Defer] 시드 테스트가 seed.sql을 in-test 실행하지 않고 db reset 선행을 전제 — 파일 단위 구문/멱등 오류를 pytest가 자체 포착 못 함(conftest가 db reset 선행을 문서화한 하니스 전반 설계). 본 스토리는 실제 db reset+재실행 멱등으로 운영 검증(Debug Log). 프로젝트 전반 "seed 적용+무에러" 자동화는 별도 하니스 개선 [api/tests/conftest.py · test_seed_masters.py] — deferred, 하니스 전반·project-context "과도 명세 금지"

**Dismissed (노이즈/오탐/의도된 설계, 10):** ① drugs 대표코드 잔존 충돌 = 잔존은 '_' 코드라 9자리 숫자와 불충돌. ② 테스트 f-string SQL = 상수 보간·테스트 전용(코드베이스 일관). ③ `code !~ '_'` 리터럴 = 잔존만 정확히 제외(검증됨). ④ effective_to==today 경계 미시연 = 의도된 무모호 시드, 경계는 masters.ts 단위테스트가 커버. ⑤ `>=`/정확카운트 중복 = `lower(code)` unique 인덱스가 중복을 DB에서 원천차단. ⑥ ingredient_code NULL = 0007 nullable(오탐). ⑦ unit CHECK/enum = text nullable 무CHECK(오탐). ⑧ update users 운영 결합 = seed는 db reset 로컬 전용(`db push` 미실행)·doctor 자체가 DEV ONLY. ⑨ doctor 배정 자체 = 스펙 승인 "선택적 고려"·문서화·가드(clean). ⑩ 데이터 현실성 nit(오구멘틴 표기·데모 약품코드) = AC4 "그럴듯함" 허용 범위.

## Dev Notes

### 핵심 프레이밍 — 데이터 스토리(스키마·코드는 이미 완료)

| 항목 | 상태 | 위치 |
|---|---|---|
| 5개 마스터 테이블 스키마(컬럼·CHECK·FK·RLS·감사 트리거) | ✅ 완료 | 0006(departments·rooms)·0007(diagnoses·fee_schedules·drugs) |
| `lower(code)` CI unique 인덱스(케이스 무관 유일성) | ✅ 완료 | 0008 |
| 검색 피커 + "현재 유효" 필터(`isCurrentlyValid`·`fetchCurrentlyValidMasters`) | ✅ 완료 | 2.3 · masters.ts |
| 관리자 마스터 CRUD UI · soft delete · 참조 무결성 | ✅ 완료 | 2.1·2.2·2.4 · masters-manager |
| seed.sql dev 계정 멱등 블록(`do $$`·`on conflict do nothing`) | ✅ 완료 | seed.sql:22-76 (회귀 금지) |
| **5개 마스터 테이블 = 빈 상태**(관리자 UI 직접 입력만) | ⛔ 갭 → **본 스토리** | seed.sql 마스터 섹션 신설 |

본 스토리는 2.2가 명시 이월한 것이다: *"마스터 시드(seed.sql에 KCD/EDI/약품 코드) = Story 2.5. 2.2는 빈 테이블 + 관리자 UI 직접 입력"*(2-2 Dev Notes:236). 새 발명이 아니라 의도된 후속 — **순수 데이터**.

### 마스터 테이블 스키마 정밀 요약 (시드 INSERT가 반드시 만족할 제약)

> 출처: 0006·0007·0008 직접 분석. 시드는 superuser(db reset)로 실행 → RLS 우회, 감사 트리거는 발화하나 INSERT 차단 안 함.

**`departments`** (0006:9-17): `id uuid PK default gen_random_uuid()` · `code text NOT NULL`(→0008 `lower(code)` unique) · `name text NOT NULL` · `description text` · `is_active bool NOT NULL default true` · `created_at/updated_at timestamptz default now()`. **참조됨:** `rooms.department_id`·`users.department_id`(FK).

**`rooms`** (0006:22-31): 위 + `department_id uuid references departments(id)`(**nullable**, ON DELETE NO ACTION). 시드 순서: departments → rooms.

**`diagnoses`** (0007:15-26): `id uuid PK` · `code text NOT NULL`(→`lower(code)` unique) · `name text NOT NULL` · **`effective_from date NOT NULL`(default 없음 — 반드시 명시)** · `effective_to date`(nullable=무기한) · `is_active bool default true` · CHECK `effective_to is null or effective_to >= effective_from` · 인덱스 `(effective_from, effective_to)`.

**`fee_schedules`** (0007:30-44): 위 진단과 동형 + **`amount_krw integer NOT NULL`(CHECK `>=0`)** · `category text`(nullable). 급여여부·본인부담 컬럼 **미존재**(Epic 7).

**`drugs`** (0007:48-61): 진단과 동형 + `ingredient_code text`(nullable·9자리 관습) · `unit text`(nullable).

**공통(5개 전부):** `code`는 **0008 이후 `lower(code)` 함수 unique 인덱스**만 — 컬럼 제약 없음. `effective_from`은 codes 3종(diagnoses·fee_schedules·drugs)에서 **NOT NULL·default 없음** → 시드에서 반드시 값을 줘야 함. departments·rooms엔 유효기간 컬럼 없음(항상 유효, is_active만).

### 결정적 함정 3선 (이걸 틀리면 AC 실패)

1. **날짜 = 현재 유효 보장(AC2).** 소비처 피커는 `is_active AND effective_from <= today AND (effective_to IS NULL OR effective_to >= today)`로 필터(masters.ts:180-185, today=KST 로컬). `effective_from`이 미래면 "pending" 배지 → 피커 미노출 → AC2 실패. **`effective_from`은 과거 고정**(예 `'2020-01-01'::date`), **`effective_to=NULL`**(무기한)로 둔다. today=2026-06-20.
2. **ON CONFLICT 추론 대상(AC5).** 0008이 `<table>_code_key`(컬럼 unique 제약)를 **drop**하고 `<table>_code_lower_key ON (lower(code))`(함수 인덱스)로 교체. 따라서 `ON CONFLICT (code) DO NOTHING`은 *"there is no unique or exclusion constraint matching the ON CONFLICT specification"* 에러. **`ON CONFLICT (lower(code)) DO NOTHING`**(함수 인덱스 추론) 또는 targetless **`ON CONFLICT DO NOTHING`**(어떤 unique 위반이든 무시 — 시드엔 가장 견고)을 쓴다.
3. **FK 순서·참조(AC1).** `rooms.department_id → departments.id`. departments를 먼저 INSERT한 뒤 rooms는 하드코딩 UUID 대신 `department_id = (select id from public.departments where lower(code) = lower('OS'))` 서브셀렉트로 참조 — UUID 관리 회피 + 선언적. 공용 공간(처치실·영상실)은 `department_id=NULL`.

### 멱등·운영 안전 (AC5 — 기존 패턴 보존)

- 마스터 시드는 dev 계정 `do $$` 블록 **뒤에** 둔다. 앞 블록은 한 글자도 건드리지 말 것(AC5b·AC6c). dev 블록은 자체 멱등(`if not exists`·`on conflict (id) do nothing`)이라 공존 안전.
- 마스터 섹션은 가독성·"하나씩 꼼꼼히" 검토(사용자 선호)를 위해 **테이블별 `INSERT ... VALUES (...), (...), ... ON CONFLICT (lower(code)) DO NOTHING;`** 평문 블록 권장(do-block 변수 불요 — rooms FK만 서브셀렉트). 각 블록 위에 `-- ── 진료과 ──` 류 헤더 주석.
- **운영 안전 불변:** seed.sql은 로컬 `supabase db reset`에서만 실행된다(seed.sql:17-19 주석). `supabase db push`(운영)는 마이그레이션만 — seed 미실행. 따라서 이 데모 데이터는 클라우드에 안 생긴다. 이 안전 주석·전제를 **깨뜨리지 말 것**. `db reset --linked` 절대 금지 경고(19행)도 유지.
- **감사 노이즈는 정상(AC6b):** 시드 INSERT마다 0004/0006/0007 감사 트리거가 발화 → `audit_logs`에 `actor_id=NULL`·`action='create'` 행 생성. `audit_logs.actor_id`는 nullable·FK 부재(0004:5-10 명시 — actor 부재로 원본 쓰기 abort 방지)라 **INSERT를 막지 않는다**. `app.actor_id` GUC를 시드에서 설정하려 하지 말 것(불필요·범위 밖). db reset 시점의 감사 행은 무해.

### 현실성 가이드 (AC4 — "최대한 실제처럼")

사용자 목표는 "과제지만 최대한 실제처럼 상세하게"(메모리 `project-goal-realistic-pms`). 따라서 **빈약한 3~4행이 아니라** 외래 중소병원 시연을 굴릴 폭(Task별 행 수)을 채운다. 단 **규제 100% 정합이 기준은 아니다** — 실제 심평원 KCD/EDI 코드·단가의 *형식과 그럴듯함*이 기준(근사 허용). 도메인 표준 형식:
- **KCD 진단:** 영문1자+숫자(+소수 세분류) — `I10`·`J00`·`M54.5`. 심평원 상병마스터(KCD-8/9, ICD-10 기반).
- **EDI 수가:** 심평원 행위급여목록 분류 형식의 영숫자 코드 + KRW 정수 단가. 외래 진찰료/검사료/처치료/영상료 구색.
- **약품:** 제품명(한글) + `ingredient_code`(주성분 9자리) + `unit`. 건강보험심사평가원 약품마스터 관습(대체조제 = 주성분코드).

도메인 리서치 근거: `prds/.../research-domain.md`(2-2 Dev Notes 참조)·glossary §도메인 엔티티(encounter=내원·order=오더·fee_schedule=수가·diagnosis=진단·drug=약품·department=진료과·room=진료실).

### 권한·감사·RLS·규약 (project-context 강제 — 위반 금지)

- **마이그레이션 단일 소유**(Supabase CLI). **적용된 0001~0008 편집 절대 금지**(마이그레이션 불변성). seed.sql은 마이그레이션이 아니라 데이터 — DDL 한 줄도 넣지 말 것(테이블·인덱스·제약 생성 금지, INSERT만).
- **식별자 영문 snake/대문자, 한국어는 `name`·주석만**(project-context §식별자 언어). 코드값(`I10`·`AA154`)은 도메인 표준이라 glossary 등재 불요. JSON/DB 전 경로 snake_case(시드는 SQL이라 무관하나 컬럼명 snake 그대로).
- **금액 = KRW 정수**(소수 없음 — `amount_krw integer`). 날짜 = `date`(유효기간), timestamptz는 default now() 위임.
- **쓰기 경로 불변식은 DB 소유** — 시드는 DB 직접 INSERT(superuser)라 FastAPI service_role 경로와 무관. 상태머신·수가 자동발생 로직 재구현 금지(여기 전부 무관 — 순수 마스터 데이터).

### Non-goals (이번 스토리에서 하지 않음 — 명시 추적)

- **`fee_mappings`(행위/진단 → 수가코드 매핑) 내용·테이블** — Epic 7 착수 전 확정(AC3·epics.md:158,170,1203). 테이블 자체가 미존재(스키마 없음).
- **수가 자동발생 트리거** — Epic 5.10(`fee_schedules` 행을 소비하는 쪽).
- **급여여부·본인부담·산정특례** 컬럼/값 — 0007이 Epic 7로 이연(컬럼 미존재).
- **환자·내원·예약·오더·수납 시드** — Epic 3~7 데이터(본 스토리는 *마스터*만). 골든 패스 *시나리오 데이터*(환자 이수진 등)는 후속.
- **직원 계정 시드 확장** — 기존 dev 2계정(admin·doctor)만. 신규 직원·소속 배정은 1.8(UI)·deferred. (단 데모 일관성을 위해 dev `doctor`를 시드 진료과에 배정하는 **선택적** 1줄 UPDATE는 *고려 가능* — 아래 "선택적 고려" 참조. 기본 범위엔 미포함.)
- **새 마이그레이션·DDL·API 엔드포인트·웹 컴포넌트** — 0(순수 데이터·테스트·문서만).
- **골든 패스 E2E·웹 피커 E2E·커버리지 게이트** — Post-MVP(project-context §Testing).

### 선택적 고려 (범위 밖이나 데모 일관성 — dev 판단)

- 기존 dev `doctor@pms.local`(uid `...00a2`)은 `department_id`가 NULL이다. 후속 골든 패스(Epic 4 접수·Epic 6 예약)는 "진료과에 소속된 의사"를 전제한다. seed.sql 끝에 `update public.users set department_id = (select id from public.departments where lower(code)=lower('IM')) where id = '000000a2-...';` 한 줄로 데모 의사를 내과에 배정하면 다운스트림 시연이 매끄럽다. **단 1.8의 "직원 소속 배정 UI"가 deferred라 정책상 모호** — 넣는다면 "DEV ONLY·데모 일관성" 주석 + 멱등(`where department_id is null`) 가드. 넣지 않아도 AC1~AC6 충족. dev가 범위 보수성(미포함) vs 데모 완결성(포함) 택일하고 Completion Notes에 결정 기록.

### Project Structure Notes

신규/수정 경로는 전부 기존 구조에 정렬. 신규 디렉터리 0.

- 수정(시드): `supabase/seed.sql`(dev 계정 블록 뒤에 마스터 5종 섹션 추가)
- 신규/수정(테스트): `api/tests/test_seed_masters.py`(또는 기존 마스터/마이그레이션 테스트에 시드-존재 케이스 합류)
- 수정(문서): `docs/glossary.md`(시드 정책 한 줄)·`_bmad-output/implementation-artifacts/deferred-work.md`(fee_mappings 이연 추적)

변이: 마이그레이션 번호는 0001~0008로 고정(본 스토리 신규 마이그레이션 없음). Epic 3 patients는 0009(glossary §마이그레이션 번호 변이 — 확정).

### References

- [Source: epics.md#Story-2.5] — AC1·AC2·AC3 원문(629-645행), "수가 매핑 시드 내용은 Epic 7 착수 전 별도 확정"(645)
- [Source: epics.md:158,170,1203] — 수가 자동발생 = DB 트리거 + 매핑 시드(외부화), 마스터 시드 = seed.sql, 매핑 *내용*은 Epic 7
- [Source: supabase/migrations/0006_masters.sql:9-31,44-72] — departments/rooms 스키마·FK·RLS·감사 트리거
- [Source: supabase/migrations/0007_masters_codes.sql:15-61,66-103] — diagnoses/fee_schedules/drugs 스키마·CHECK·effective dating·감사
- [Source: supabase/migrations/0008_masters_code_ci_unique.sql:20-37] — `lower(code)` 함수 unique 인덱스(ON CONFLICT 추론 대상 = `(lower(code))`)
- [Source: supabase/migrations/0004_audit.sql:5-10,26-70] — 감사 트리거 actor_id NULL 허용(FK 부재·append-only — 시드 INSERT 무차단)
- [Source: supabase/seed.sql:1-21,22-76] — 현 seed 골격(헤더 자리표시 + dev 계정 멱등 블록 = 보존 대상)
- [Source: supabase/config.toml §[db.seed]] — `enabled=true`·`sql_paths=["./seed.sql"]`(db reset 시 마이그레이션 후 실행)
- [Source: web/src/lib/admin/masters.ts:154,169-185,273-274] — `todayISO`(KST)·`codeStatus`·`isCurrentlyValid`·`fetchCurrentlyValidMasters` "현재 유효" 술어(AC2 기준)
- [Source: docs/project-context.md] — 마이그레이션 단일 소유·DDL 금지·식별자 영문·금액 KRW 정수·감사 append-only·과도 테스트 금지
- [Source: docs/glossary.md §도메인 엔티티 · §마이그레이션 번호 변이] — fee_schedule=수가·diagnosis=진단·drug=약품 등 + 0008 확정·patients=0009

### Previous Story Intelligence (2.1 / 2.2 / 2.3 / 2.4)

- **2.1** 이 진료과·진료실 스키마(0006)·관리자 UI·soft delete 토글을 세웠다. 마스터는 전역 참조 데이터(RLS `authenticated SELECT using(true)` — 본인행 마찰 없음). 테이블은 **빈 상태로 두고 UI 입력**으로 설계 → 본 스토리가 데모 데이터를 채운다(충돌 아님, 보완).
- **2.2** 가 코드 마스터 3종(0007) + 유효기간을 추가하고 **"seed.sql에 코드 마스터 시드 추가 금지 — Story 2.5"**(2-2:234-236)로 명시 이월. insert 핸들러는 broad UniqueViolation catch(제약명 비의존). 본 스토리가 그 이월을 해소.
- **2.3** 이 "현재 유효" 판정을 `isCurrentlyValid` 단일 술어 + 서버 today(DB 권위)로 통일. **본 스토리의 모든 코드 행은 이 술어를 통과**해야 피커에 뜬다(AC2 = 시드 날짜 설계의 핵심 제약). 피커 자체는 건드리지 않음(데이터만).
- **2.4** 가 0008 `lower(code)` CI unique를 도입 → 본 스토리 `ON CONFLICT` 추론이 `(lower(code))`여야 하는 직접 원인. soft delete·참조 무결성 완비 → 시드는 그 위에 데이터만 얹는다.
- **공통 테스트 하니스:** 통합 테스트는 로컬 Supabase 스택 미가용 시 `skip`(`admin@pms.local`/`Staff1234`). `psql` fixture로 직접 SQL. 새 시드 검증 테스트도 이 패턴 미러(데이터 존재·유효성 단언, 스택 없으면 skip).

### Git Intelligence (최근 작업 맥락)

최근 커밋은 Story 2.1→2.2→2.3→2.4를 db→api→web 의미 단위로 분리 + 각 done 시 산출물·findings·deferred를 별도 `chore(bmad)`. 본 스토리는 코드 변경이 사실상 seed.sql 하나라 `feat(db): 마스터 시드 데이터 seed.sql (Story 2.5)`(+ 테스트) 단일 커밋이 자연스럽다. done 시 `chore(bmad): Story 2.5 산출물`. 커밋·푸시는 승인 시에만(project-context).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- **RED:** 시드 적용 전 `pytest tests/test_seed_masters.py` → 5 failed(시드 코드 IM·AA154·I10 등 부재)/2 passed(트랜잭션 자족 케이스). 테스트 정당성 확인.
- **적용:** `supabase db reset --local` → 마이그레이션 0001~0008 재적용 + `Seeding data from supabase/seed.sql` 성공(에러 0). ON CONFLICT `(lower(code))` 추론·rooms FK 서브셀렉트·dev 계정 do-block 전부 통과.
- **GREEN:** `pytest tests/test_seed_masters.py` → 7 passed. 실측 카운트 departments=7·rooms=8·diagnoses=22·fee_schedules=18·drugs=17·doctor→IM.
- **멱등:** seed.sql 재실행(이미 시드된 DB) → 5개 마스터 `INSERT 0 0`·`UPDATE 0`·dev `DO`, 카운트 불변(7/8/22/18/17). AC5 실증.
- **회귀:** API 전체 `pytest` → 206 passed/7 skipped(2.4 기준 199 + 신규 시드 7). 깨끗한 시드(잔존 92→7·doctor IM 배정)가 통합 테스트 무회귀. web `vitest` 122 passed/21 files. ruff 클린.

### Completion Notes List

**구현 요약 — 순수 데이터 시드(스키마·코드 무변, 산출물 = seed.sql + 검증 테스트 + glossary):**

- **AC1 (시드 적재):** `supabase/seed.sql` 의 dev 계정 do-block 뒤에 마스터 5종 섹션 추가. `db reset` 시 진료과 7·진료실 8·KCD 진단 22·EDI 수가 18·약품 17 적재(에러 0).
- **AC2 (피커 노출):** 모든 코드 마스터 행 `effective_from='2020-01-01'`·`effective_to=NULL`·`is_active=true` → `isCurrentlyValid` 술어 통과(미래 발효 0건 단언). 검색 피커·관리 목록에 실제 코드 노출.
- **AC3 (매핑 다운스트림):** 수가 *마스터 행*만 시드. `fee_mappings`(행위/진단→수가코드 매핑)·테이블·급여여부 컬럼은 미생성(Epic 7). glossary 에 다운스트림 명시.
- **AC4 (현실성):** KCD-8 형식 상병(I10·J00·M54.5…)·심평원 행위 형식 EDI 코드 + 현실적 KRW 정수 단가·약품(제품명+주성분코드+단위). 외래 중소병원 골든 패스 폭.
- **AC5 (멱등·안전):** `ON CONFLICT (lower(code)) DO NOTHING`(0008 함수 인덱스 추론 — `(code)` 사용 시 에러). dev 계정 블록 무회귀(앞 보존). 운영 안전 주석(로컬 db reset 전용·`db push` 미실행) 유지.
- **AC6 (회귀 가드):** 마이그레이션 0001~0008 무편집·신규 DDL/API/UI 0. 감사 트리거 `actor_id=NULL` 정상(append-only·FK 부재 — INSERT 무차단). 기존 API 199 + web 122 무회귀.

**선택 결정 — DEV 의사 진료과 배정(스토리 "선택적 고려" 항목):** 골든 패스(Epic 4 접수·Epic 6 예약)가 "진료과 소속 의사"를 전제하므로 DEV `doctor@pms.local`(uid …00a2)을 내과(IM)에 배정. **포함 결정** 근거: (a) 데모 완결성·사용자의 "최대한 실제처럼" 목표, (b) 회귀 위험 검증 완료(시드 doctor.department_id=NULL 에 의존하는 테스트 부재 — `test_admin_users.py:55` 는 random uuid mock), (c) 멱등 가드(`where department_id is null`)·DEV ONLY 주석·운영 미영향. 실제 직원 소속 배정 UI 는 Story 1.8/후속(범위 밖).

**범위 준수(Non-goals):** `fee_mappings` 매핑 내용·테이블(Epic 7)·수가 자동발생(Epic 5.10)·급여/본인부담 컬럼(Epic 7)·환자/내원/예약/오더/수납 시드(Epic 3~7)·신규 마이그레이션/API/컴포넌트·E2E 하니스 — 전부 미착수.

**deferred-work.md:** 본 스토리가 *닫는* 기존 deferred 항목 없음(시드 관련 이월 부재). `fee_mappings` 이연은 epics.md + 본 스토리 Non-goals + glossary 에 추적됨. 신규 deferred 는 코드리뷰 단계에서 findings 로 기록(워크플로 규칙) → deferred-work.md 무변경.

### File List

**신규:**
- `api/tests/test_seed_masters.py` — 시드 적재·현재유효·FK·단가·멱등 검증(7 테스트, AC1·AC2·AC4·AC5)

**수정:**
- `supabase/seed.sql` — 마스터 5종 시드(진료과·진료실·KCD 진단·EDI 수가·약품) + 헤더 주석 갱신 + DEV 의사 IM 배정(선택)
- `docs/glossary.md` — §마이그레이션 번호 변이에 Story 2.5 시드 라인(시드 정책·신규 마이그레이션 없음·`fee_mappings`→Epic 7)

### Change Log

| 날짜 | 변경 | 작성 |
|---|---|---|
| 2026-06-20 | Story 2.5 구현 — `seed.sql` 마스터 5종 시드(진료과 7·진료실 8·KCD 22·EDI수가 18·약품 17, 전부 현재-유효) + DEV 의사 IM 배정. 멱등 `ON CONFLICT (lower(code))`. 신규 검증 테스트 7건(RED→GREEN). glossary 시드 라인. 신규 마이그레이션·API·UI 0. API 206 pass/web 122 pass 무회귀. Status → review. | Dev (Amelia) |
| 2026-06-21 | 코드 리뷰 — 3레이어 적대적(Blind·Edge·Acceptance). Acceptance Auditor AC1~6 strong pass(마이그레이션 무편집·신규 DDL/API/UI 0·dev 블록 보존·fee_mappings 미누출). patch 3건(시드 테스트 강화: 멱등 직접증명·이름↔단언 일치·진료실 FK 누출 단언) 적용, defer 2(의존성테스트 doctor 차용·seed in-test 미실행), dismiss 10. 회귀 API 206 pass/web 122 pass·ruff 클린. Status → done. | Code Review |
