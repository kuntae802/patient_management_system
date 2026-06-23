# Deferred Work

작업 중·리뷰 중 식별됐으나 현재 스토리 범위 밖으로 미룬 항목. 해당 스토리 착수 시 참조.

## Deferred from: code review of 3-6-감사-스냅샷-서버측-pii-마스킹 (2026-06-21)

> 3레이어 적대 리뷰. Acceptance Auditor: 위반 0(AC1~4 + 이월 ①~④ + D-1~D-3 충족). patch 0, dismiss 4(false positive·의도적 fail-closed·방어심층·미발현), 아래는 defer.

- **로그 백스톱 휴대폰 패턴 한계** [api/app/core/logging.py `_PHONE_RE`] — 휴대폰(01x)만 마스킹, 유선(02-/031-)·점 구분(`010.1234.5678`)·국제(+82)·단어경계 미적용·다중 번호열 꼬리 1자리 잔존을 못 잡는다. AC4 가 명시 스코프(휴대폰만·과대마스킹 선호·방어심층)했고 1차선은 "raw PII 미로깅" 규율이라 수용. **기존 L113(로그 마스킹 백스톱이 RRN만 커버)과 동일 묶음** — 전화·이름·주소 패턴 확장을 로그 마스킹 하드닝에서 일괄(신뢰할 패턴 한계 고려).
- **감사 스냅샷 중첩 `name` 마스킹 부재** [api/app/services/audit.py `_mask_value` · web/src/lib/admin/audit.ts `maskDeep`] — 재귀 경로는 항상-민감 키만 적용하고 테이블 인지 `name`은 최상위에서만 마스킹 → 중첩 dict 안의 환자/보호자 name 은 평문 잔존. **현 스키마 도달 불가**(감사 트리거 `to_jsonb(row)`=평탄 단일행, 중첩 PII name 을 담는 jsonb 컬럼 부재)이고 코드 주석에 의도적 엣지로 명시. 환자/보호자 행에 **중첩 PII(예 임상 이력 jsonb·연락처 배열)** 가 도입되는 스토리에서 재귀에 테이블 컨텍스트 전달(또는 nested name 도 마스킹)로 닫는다.
- **서버·웹 마스킹 키 집합 드리프트 가드 부재** [api/app/services/audit.py `_SENSITIVE_KEY`/`_PII_NAME_TABLES` · web/src/lib/admin/audit.ts `SENSITIVE_KEY`/`PII_NAME_TABLES`] — 두 집합이 수작업 거울(한쪽만 수정 시 조용히 분기). 서버가 1차 권위라 TS-only 수정은 무효, Python-only 회귀는 누출. 현재 양 테스트가 신규 키 전부 커버해 가드 역할을 하나 자동 일치 검증은 없음. 일괄 해결: 공유 상수 codegen(예 단일 JSON→Py/TS 생성) 또는 계약 테스트(양 집합 비교). 마스킹 정책이 더 분화될 때 도입.

## Deferred from: code review of 3-5-전역-환자-검색-ctrl-k-커맨드-팔레트 (2026-06-21)

> 3레이어 적대적 리뷰. Acceptance Auditor: 위반 0(AC1~4 + 이월 ①~③ + D-1~D-3 충족). patch 4건(ILIKE 와일드카드 이스케이프·디바운스 정착 전 Enter stale 가드·검색 잘림 안내·aria-activedescendant 가드) 처리, dismiss 3, 아래는 defer.

- **검색 매칭·정렬 튜닝(짧은 숫자 노이즈 + 한글 정렬 컷오프)** [api/app/core/db.py `fetch_patients`] — (a) `q="010"` 같은 짧은 자릿수가 거의 모든 연락처에 부분일치(국내 휴대폰 전부 010 시작), 이름에 숫자가 섞이면 `digits` 가 전화번호 OR 조건을 항상 추가해 결과 노이즈 확대 — 연락처 검색 최소 자릿수 하한(예 4자리) 가드 부재. (b) 검색 정렬 `name asc` 가 DB 콜레이션/유니코드 정규화(NFC/NFD)에 의존해 한글 정렬이 흔들리면 상위 N 컷오프에 영향. **검색 품질 튜닝**(min-digit 임계·정렬 정규화·필요 시 trigram 인덱스)으로 일괄 — phone 성능 인덱스(스토리 D-1 이월)와 같은 검색-하드닝 묶음 후보. 패치(와일드카드 이스케이프·잘림 안내)로 1차 영향 완화됨.
- **한글 IME 조합 중 Ctrl K / Esc** [web/src/components/shell/patient-search-command.tsx] — IME on(한글 조합 중)이면 `e.key` 가 "Process"라 전역 `Ctrl K` 가 안 먹을 수 있고, Esc 1회는 조합 취소만 소비(팔레트 닫기 2회 필요). `isComposing`/조합 상태 미고려. 한국어 사용자 빈도 높은 단축키 UX 엣지 — **키보드 단축키 하드닝**(전역 단축키 IME 안전 처리)에서 일괄.
- **입력 비운 직후 200ms 마스킹 결과 잔존** [web/src/components/shell/patient-search-command.tsx] — 빈 입력 클리어가 디바운스 setTimeout 안이라 입력을 모두 지운 직후 200ms 동안 이전(마스킹) 검색 결과가 화면에 남음(닫으면 즉시 초기화). 마스킹 PII·200ms·활성 사용 중이라 영향 경미 — 빈 입력 즉시 클리어는 팔레트 UX 폴리시에서.
- **`apiFetch` 가 `AbortError` 를 `network_error` 로 변환(암묵 결합)** [web/src/lib/api/client.ts · patient-search-command.tsx] — 디바운스 abort 시 `apiFetch` 가 `AbortError` 를 잡아 `ApiError("network_error")` 로 재throw → 컴포넌트 catch 가 에러 종류가 아니라 `controller.signal.aborted` 로 분기해 정상 동작(버그 아님). 다만 향후 `apiFetch` 가 abort 를 자체 resolve 로 바꾸면 깨질 수 있는 암묵 결합 — `apiFetch` 에 abort 1급 처리(예: AbortError 그대로 throw 또는 명시 무시)를 도입할 때 함께 정리.

## Deferred from: code review of 3-4-환자-앱-자가가입-기존-레코드-자동-연결 (2026-06-21)

> 3레이어 적대적 리뷰. Acceptance Auditor: PASS-WITH-FINDINGS(AC1~4 + 이월 인수 ①~⑤ + PII 경계 위반 0). patch 3건(동시성 advisory lock·`_norm_name` NFC·onboarding 사문 분기) 처리, dismiss 9, 아래는 defer.

- **self-link / get_self `is_active`(soft-delete) 미필터** [api/app/core/db.py `link_self_patient`·`fetch_self_patient`] — 자가연결·`GET /self` 가 `where resident_no_hash=$1`/`where auth_uid=$1` 로만 매칭하고 `is_active` 를 거르지 않아, 비활성(soft-deleted) 환자 레코드도 연결·조회된다. 단 **현재 환자 비활성화 플로우가 없어 도달 불가능한 잠재 항목**이고, 이는 **이미 L23(3.2 리뷰 "환자 GET/UPDATE `is_active` 미필터")이 통합 추적 중인 항목과 동형**(`fetch_patient`·`update_patient_clinical_profile` 도 미필터). 단독으로 self-link 만 필터하면 읽기 경로 불일치 → 환자 soft-delete/병합 기능 도입 스토리에서 GET·UPDATE·self-link 일관 정책(404 또는 read-only)으로 일괄 처리. **신규 항목 신설 없이 L23 범위에 self-link 경로 추가 확인.**
- **공개 가입 RRN 존재/성명 오라클 + self-link 레이트리밋 부재** [api/app/api/v1/patients.py `self_link` · supabase/config.toml] — `enable_signup=true` 재활성으로 가입한 환자가 `POST /self-link` 로 임의 주민번호를 탐침하면 상태코드(404 `no_patient_record` / 422 `identity_mismatch` / 409 `already_linked_other`)로 (a) 해당 RRN 의 환자 등록 여부와 (b) 성명 일치 여부를 열거할 수 있다(누가 이 병원 환자인지 confidentiality 오라클). 시뮬 본인인증 + 성명 단독 가드라 표적(성명 보유) 공격은 미차단. config 기본 레이트리밋(`sign_in_sign_ups=30`/5분) 외 self-link 전용 throttle·연속 실패 잠금·캡차·이메일 확인이 없다. **스펙 Dev Notes §본인인증=시뮬 seam + 위협 모델 / Open Questions #5 / 이월 인수 ⑤에 이미 명시적으로 기록된 갭**(은폐 아님). 일괄 해결처: **보안 하드닝 스토리**(self-link 전용 레이트리밋 + 연속 실패 잠금 + 이메일 확인 활성 검토) 또는 실 본인인증(PASS) 연동(RRN 소유의 암호학적 증명이 성명 가드를 대체). 실 PASS 도입 시 `services/identity.simulate_identity_verification` seam 이 교체점.

## Deferred from: code review of 3-3-보호자-정보-기록 (2026-06-21)

> 3레이어 적대적 리뷰. Acceptance Auditor: AC1~3 + 이월 인수 3건 위반 0. patch 3건(datalist id 중복·삭제 더블서밋·update_guardian 422 테스트) 처리, dismiss 6, 아래는 defer.

- **TOCTOU 재평가 전용 테스트 부재** [api/app/core/db.py `insert_guardian`/`update_guardian`/`delete_guardian`] — guardian 쓰기 3개가 `_op` 안에서 `_require_patient_update(conn)` in-txn 재평가(권한 평가↔쓰기 레이스 차단)를 수행하나, 이를 격리 검증하는 전용 테스트가 없다(통합 테스트는 라우터 게이트 403 만 확인). 재평가 자체는 구현·동작 확인됨(Acceptance Auditor). **2.1 리뷰의 프로젝트 전역 defer "in-tx 재평가·일부 분기 전용 테스트 부재"와 동형** — 권한 revoke 레이스 시뮬레이션(db 직접 호출 또는 grant 회수 후 호출)으로 in-txn 재평가가 실제 차단함을 단언하는 전용 케이스를 동시성 하드닝 묶음에서 일괄 추가.

## Deferred from: dev of 3-3-보호자-정보-기록 (2026-06-21)

> Story 3.3 가 보호자 CRUD 를 구현하면서 에픽 AC2/UX-DR22(보호자 연락처 reveal = 주민번호 동일 게이트+감사)와 현 구현 선례의 충돌을 노출. **사용자 결정: 선례 미러 + reveal 이월.** 코드 변경 없이 아래로 이월.

- **🆕 연락처 PII reveal 일관화 (교차절단)** [api/app/api/v1/patients.py · core/db.py · schemas/{patients,guardians}.py · web/src/components/reception/{patient-detail,patient-guardians}.tsx] — UX-DR22/EXPERIENCE.md L192 는 "연락처·주소·보험·보호자 **모든 PII reveal = 주민번호 동일 권한 게이트+감사**"를 일관 규칙으로 요구한다. 그러나 현 구현은 **주민번호(resident_no)에만** reveal(암호화+마스킹+`decrypt_sensitive` 자가-감사)을 적용하고, **환자 phone/address/email + 보호자 phone 은 평문·`patient.read` staff 직접조회**(마스킹·reveal 게이트 미적용)다. 근거: (a) 평문 컬럼 SELECT 에는 `decrypt_sensitive` 같은 깨끗한 read-감사 훅이 없고(앱의 audit_logs 직접 INSERT 금지=트리거 전용, SELECT 미발화), (b) 연락처용 reveal 권한 미시드(`patient.reveal_rrn`만 존재), (c) 환자 phone 평문 노출 + 보호자 phone 만 게이트하면 일관성 붕괴(보호자가 환자보다 더 보호되는 모순). **전 연락처 PII(환자+보호자)를 한 번에 통일하는 교차절단** — 3.3 한 스토리에서 풀지 않고 이월. **UX-DR22 미충족 갭으로 명시 기록**(은폐 아님). 일괄 해결처: 전용 감사·reveal 하드닝 스토리 또는 Epic 4 진료 허브 배너(UX-DR9). 그 스토리에서 **메커니즘 확정** — (옵션1) 평문 phone 암호화(신규 마이그레이션 + decrypt_sensitive 자가-감사 재사용) vs (옵션2) 평문 자가-감사 RPC + 신규 reveal 권한(`patient.reveal_contact` 류) 시드.
- **A-3 감사 PII (계속 추적 — 중복 신설 안 함)** [supabase/migrations/0009_patients.sql guardians 감사 트리거] — guardian INSERT/UPDATE/DELETE 가 `audit_logs.before/after_data` 에 `name`/`phone`(평문 식별 PII)을 적재한다. 이는 이미 본 파일 L153(3.1 리뷰) "patients/**guardians** 의 평문 PII 컬럼(name/phone/address/email)"이 통합 추적 중인 항목이므로 **신규 항목을 만들지 않고 확인만** 한다(guardian 은 건강민감 데이터 아님 → 3.2 같은 긴급도 상승 불요). 서버측 감사 PII 마스킹 정책은 L153 단일 항목에서 처리.

## Deferred from: code review of 3-2-환자-임상-프로필-입력-조회 (2026-06-21)

> 3레이어 적대적 리뷰. Acceptance Auditor: AC1~AC3 + 이월 인수 clean pass(위반 0). patch 1건(blood_type select 중복 defaultValue) 처리, dismiss 7, 아래는 defer.

- **감사 스냅샷에 임상(건강민감) 데이터 평문 적재** [supabase/migrations/0009_patients.sql 감사 트리거] — 임상 프로필 UPDATE 가 `audit_logs.before/after_data` 에 `allergies`·`chronic_diseases`·`medications`·`notes`(건강민감)를 평문 적재. **A-3 교차절단의 연속**(전 PII 테이블) — 이미 본 파일 L144 "서버측 감사 PII 마스킹 정책"에 통합 추적 중이며 이 스토리에서 긴급도 갱신함. 중복 항목이므로 L144 에서 단일 처리(Epic 3 회고 또는 전용 감사-하드닝 스토리).
- **환자 GET/UPDATE 가 `is_active`(soft-delete) 미필터** [api/app/core/db.py `fetch_patient`·`update_patient_clinical_profile`] — 비활성(soft-deleted) 환자도 조회·임상 갱신 가능. 단 **현재 환자 비활성화 플로우가 없어**(Epic 3 범위 밖) 도달 불가능한 잠재 항목이고, GET 미필터는 3.1 기존 동작(이번 변경이 도입한 회귀 아님). 환자 soft-delete/병합 기능 도입 스토리에서 GET·UPDATE 일관 정책(404 또는 read-only) 결정.
- **임상 프로필 PUT 낙관적 동시성 부재(lost update)** [api/app/core/db.py `update_patient_clinical_profile`] — 전체 교체 PUT 에 버전/`If-Match`/`updated_at` 검사 없어 동시 편집 시 last-writer-wins 로 조용히 덮어씀. `update_department` 등 masters 와 **동일 패턴**이고, 낙관적 잠금(409)은 UX-DR 상 Epic 4+ stateful 임상/정산 쓰기의 교차절단 관심사. 프로필 편집은 MVP 에서 허용 가능 — 전역 낙관적 동시성 도입 시 함께 처리.
- **`blood_type` DB 어휘 외 값 방어 부재** [web/src/lib/reception/patients.ts `bloodTypeLabel`·patient-detail.tsx select] — DB 에 CHECK 가 없어(의도적) 어휘 외 값이 저장되면 `bloodTypeLabel` 이 그대로 echo 하고 select 는 매칭 옵션이 없어 저장 시 초기화될 수 있음. 단 앱은 **모든 쓰기에서 어휘 강제**(Pydantic Literal + Zod)라 어휘 외 값은 DB 직접쓰기로만 유입 가능. 외부 환자 데이터 벌크 임포트 도입 시 방어적 표시 폴백 추가 검토.

## Deferred from: code review of 2-6-관리자-영역-보강-직원-배정-웹-하드닝 (2026-06-21)

> 3레이어 적대적 리뷰. Acceptance Auditor: AC1~AC7 clean pass. patch 3건(users 페이지 결합 해소·임시직원 시드 진단성·생성 DB 검증) 처리, 아래는 defer.

**웹 에러 UX(fail-loud/silent-empty 비대칭 — 근원 공통):**
- **마스터 전체-실패 시 과소-신호** [web/src/components/admin/masters-manager.tsx] — `fetchMasters` 부분 강등(AC4)으로 단일 테이블 실패가 화면 전체를 다운시키지 않게 됐으나(개선), **5개 테이블 전부 실패** 시 활성 탭만 배너가 뜨고 비활성 탭은 카운트 `0`으로 표시돼 관리자가 "데이터 없음"으로 오독→이미 존재하는 마스터를 재생성할 위험. 후속 폴리시: 탭 라벨에 에러 표식(글리프) + 에러 탭의 카운트 배지 억제(또는 전부-실패를 fatal 로 승격). AC4 핵심(부분 강등)은 충족 — 이는 엣지 폴리시.
- **앱 전역 `error.tsx` 라우트 경계 부재** [web/src/app] — 서버측 `throw`(예: `fetchDepartments`·`fetchMasters` 의 fail-loud)가 Next 전역 default 에러 페이지로 직행하고, empty-degrade 는 무음이다. 스코프·재시도형 에러 UI(라우트별 `error.tsx`)라는 중간 지대가 전무. 본 스토리가 노출한 비대칭의 근원 — 관리자 라우트군에 `error.tsx` 도입을 프로젝트 전반 하드닝으로 검토(2.6 의 users-page patch 는 그 한 인스턴스의 응급 처치).

## Deferred from: code review of 2-5-마스터-시드-데이터-seed-sql (2026-06-21)

> 3레이어 적대적 리뷰. Acceptance Auditor: AC1~AC6 strong pass(마이그레이션 무편집·신규 DDL/API/UI 0·dev 블록 보존·fee_mappings 미누출·전 코드행 현재유효). patch 3건(시드 테스트 강화)은 처리, 아래는 defer.

- **의존성 카운트 테스트의 시드 doctor 차용 — 2.5로 영향 가중** [api/tests/test_masters_integration.py test_department_dependents_count] — 2.5가 DEV doctor를 내과(IM)에 배정하면서, 이 테스트가 doctor를 임시 throwaway 진료과로 재배정 후 `try/finally`로 IM을 복원한다. 크래시/타임아웃이 try~finally 사이에 발생하면 doctor가 throwaway(소프트삭제) 진료과를 가리킨 채 잔류(종전엔 NULL이 자연상태라 무해). `supabase db reset`이 유일 복구. 2.4 리뷰의 "원복 robustness"와 동일 항목 — 2.5가 영향도만 상향. 정식 수정: 시드 doctor를 `emp` 선택에서 제외하고 전용 임시 직원 픽스처 생성(트랜잭션 격리). (기존 2.4 deferred 항목과 통합 관리.)
- **시드 테스트가 seed.sql을 in-test 실행하지 않음(db reset 선행 전제)** [api/tests/test_seed_masters.py · api/tests/conftest.py] — 테스트는 db reset로 적재된 결과 상태를 단언할 뿐, seed.sql 자체의 구문/ON CONFLICT/FK 오류를 pytest가 자체 포착하지 않는다(conftest가 "db reset 선행"을 전제로 문서화한 하니스 전반 설계와 일치). 본 스토리는 실제 db reset + 재실행 멱등으로 운영 검증(Debug Log). 프로젝트 전반 개선안: seed.sql을 in-test로 적용하고 무에러+멱등을 단언하는 하니스(모든 마이그레이션/시드 테스트에 적용). project-context "과도 명세 금지"로 현 단계 defer.

## Deferred from: code review of 2-4-마스터-비활성-soft-delete-참조-무결성 (2026-06-20)

> 3레이어 적대적 리뷰. Acceptance Auditor: AC1~AC7 clean pass·규칙/Non-goals 준수. decision-needed 1·patch 1 은 처리, 아래는 defer.

**프로젝트 전역 하드닝(2.1/2.2 와 공통):**
- **단일 `pendingId` 다중행 경합(마스터 매니저 재확인)** [web/src/components/admin/masters-manager.tsx] — Story 2.4 가 추가한 `openDepartmentConfirm` 의 `finally setPendingId(null)` 가 무조건 실행돼, dependents 조회 await 중 사용자가 다른 행/탭 항목을 토글하면 늦게 끝난 finally 가 무관한 행의 pending 을 조기 해제하고(깜빡임) 두 번째 `setConfirm` 이 첫 다이얼로그를 덮어쓸 수 있다. 데이터 손상 아님(드문 UI 경합). 2.1/2.2 deferred 의 "per-row pending Set" 전역 패턴과 동형 — 일괄 개선 시 마스터 매니저 dependents 경로도 함께(조회 id 와 현재 id 비교 후에만 해제).

**테스트 하드닝:**
- **의존성 카운트 테스트 시드 원복 robustness** [api/tests/test_masters_integration.py test_department_dependents_count] — 재직 직원 1명을 테스트 진료과로 임시 배정 후 `try/finally` 로 원복하나, restore `psql.run` 자체가 실패하면 시드 직원의 `department_id` 가 테스트용 진료과를 가리킨 채 남는다(`supabase db reset` 으로만 정리). UUID 보간이라 SQL 인젝션 위험은 없음. 후속: 트랜잭션 래핑 또는 전용 비시드 직원 픽스처로 격리.

**데이터 품질(2.4 CI unique 후속):**
- **`lower(code)` unique 의 공백·유니코드 정규화 부재** [supabase/migrations/0008_masters_code_ci_unique.sql · api/app/schemas/masters.py `_Stripped`] — `lower(code)` 함수 인덱스 + 양끝 trim 만으로 대소문자 무관 유일성을 보장하나, 내부 공백 차이(`"OR THO"` vs `"ORTHO"`)·합성/분해 유니코드(NFC)·로케일 케이스폴딩(터키어 dotless-i 등) 경계는 별개 행으로 통과한다. 마스터 코드가 사실상 ASCII 영숫자이고 스펙이 code 정규식을 강제하지 않아(의도된 유연성) 실무 위험은 낮음. 엄격화를 원하면 `regexp_replace`+`normalize()` 기반 표현식 인덱스 또는 입력 정규식 강제 검토.

## Deferred from: code review of 2-3-마스터-검색-피커-자유-입력-제한 (2026-06-20)

> 3레이어 적대적 리뷰. Acceptance Auditor: AC1~3·MUST·Non-goals 충족·2.2 이월 해소 검증(ACCEPTED). patch 2건은 수정 적용. 아래는 defer 항목.

**프로젝트 전역 하드닝(에러 복구):**
- **피커 로드 에러 시 영구 비활성·재시도 부재** [web/src/components/ui/master-search-picker.tsx] — `disabled={disabled || loadError != null}` + `<p role="alert">`로 fail-loud하나, 재시도 버튼·자동 재조회가 없어 일시 네트워크 장애 시 전체 remount(페이지 새로고침)로만 복구. itemsProp 주입 경로는 무영향(loadError 미설정). 프로젝트 전역 fail-loud·무재시도 패턴(2.1 deferred "토글 실패 시 재조회/재조정 부재"와 동형) — 에러 복구 하드닝 묶음에서 일괄 처리(retry + 자동 재조회).

## Deferred from: code review of 2-2-코드-마스터-관리-kcd진단-edi수가-약품-버전-유효기간 (2026-06-20)

> 3레이어 적대적 리뷰. Acceptance Auditor: AC1~4 충족·MUST·Non-goals 준수(차단성 위반 없음). patch 2건은 수정 적용. 아래는 Edge Hunter defer 항목.

**Story 2.3(재사용 검색 피커)에서 다룰 항목:**
- ~~**`codeStatus`/`isCurrentlyValid` today = 브라우저 로컬 시간**~~ **[✅ 해소 — Story 2.3, 2026-06-20]** — "현재 유효" 판정을 **서버 today 단일 권위로 통일**. (a) 피커(`MasterSearchPicker`)는 `today`를 **필수 prop**(서버 주입, 브라우저 시계 기본값 제거)으로 받아 `fetchCurrentlyValidMasters`가 SQL(`is_active`·`effective_from<=today`·`effective_to is null or >=today`)로 1차 필터 + 컴포넌트가 `isCurrentlyValid(item, today)`로 동일 술어 방어 필터. (b) 관리화면(`/admin/masters` RSC)이 서버 `todayISO()`를 계산해 `MastersManager → 코드 마스터 테이블 → CodeStatusBadge(codeStatus(row, today))`로 주입 → 배지와 피커가 **같은 today** 공유(자정 경계·비-KST 불일치 제거). `MastersManager` `today` 미주입 시 클라 `todayISO()` 폴백(하위호환). [web/src/lib/admin/masters.ts · web/src/components/ui/master-search-picker.tsx · web/src/components/admin/masters-manager.tsx · web/src/app/(staff)/admin/masters/page.tsx]

**프로젝트 전역 하드닝(2.1과 공통):**
- **`fetchMasters` 단일 실패점 확대(2→5 테이블)** [web/src/lib/admin/masters.ts] — `Promise.all` + 첫 에러 throw(의도된 fail-loud). 코드 마스터 3종 추가로 단일 테이블 오류가 관리화면 전체를 다운시킬 표면이 2.5배 확대. 대량화 또는 부분 강등이 필요해지면 per-table 에러 처리(정상 탭은 표시, 실패 탭만 에러)로 검토. 현재는 2.1 fail-loud 패턴 유지.
- **단일 `pendingId` 다중행 동시 토글** [web/src/components/admin/masters-manager.tsx] — 비활성은 ConfirmDialog로 직렬화되나 활성 복귀(즉시 실행)는 연속 클릭 시 첫 행 pending UI가 소실(요청은 in-flight). 2.1 deferred-work에 이미 기록된 전역 패턴 — per-row pending Set으로 일괄 개선 시 마스터 매니저도 함께 적용.

## Deferred from: code review of 2-1-진료과-진료실-마스터-관리 (2026-06-20)

> 3레이어 적대적 리뷰 결과. Acceptance Auditor clean pass(AC1~4 충족). 아래는 Blind/Edge Hunter defer 항목.

**Story 2.4(참조 무결성 심화)에서 다룰 항목:**
- **진료실→비활성 진료과 신규 배정 API 미차단** [api/app/core/db.py insert_room/update_room] — FK는 존재만 검증하고 `is_active`는 검사 안 함. UI 피커는 활성 진료과만 노출하나(스펙이 "신규 선택 제외"를 소비처 피커에 위임), API 권위 레벨에서 비활성 마스터로의 신규 배정을 막으려면 `is_active` 검사 추가. Story 2.4 참조 무결성 범위.
- **진료과 비활성 시 의존성 경고/재배정 부재** [web masters-manager.tsx ConfirmDialog] — 비활성 처리 시 그 진료과를 참조하는 진료실·직원 수를 세어 경고하거나 재배정을 유도하는 흐름이 없다. AC2(참조 보존)는 충족되나(행·명칭 유지), 운영 UX로는 "3개 진료실·5명 직원이 아직 참조 중" 경고가 바람직. 2.4 참조 무결성/UX.
- **진료실 목록 비활성 소속 진료과 미표기 + departmentLabel 폴백 문구** [web masters-manager.tsx · lib/admin/masters.ts] — 진료실 폼 select는 비활성 진료과에 "(비활성)" 접미사를 붙이나 목록 테이블은 이름만 표시. `departmentLabel`의 "(삭제된 진료과)" 폴백은 hard-delete 부재(soft delete만 + FK)로 정상 경로에서 비도달이며 도달 시 오해 소지(절단/RLS 아티팩트). 2.4 UI 명확성 polish 시 비활성 마커 추가 + 폴백 문구를 "(미상)" 류로.
- **code 대소문자 구분 unique** [supabase/migrations/0006_masters.sql] — `code`가 `text unique`라 `ORTHO`/`ortho`/`Ortho`가 별개로 공존(409 미발생). 스펙이 엄격 정규식을 강제하지 않아 의도된 유연성이나, 코드 일관성을 원하면 `citext` 또는 `lower(code)` unique 인덱스로 정규화 검토. 2.4 마스터 데이터 품질.

**PATCH 시맨틱(외부 API 소비처 등장 시):**
- **마스터 PATCH = 전체 교체** [api/app/schemas/masters.py · api/app/core/db.py] — `DepartmentUpdate`/`RoomUpdate`의 옵셔널 필드가 기본값 `None`이고 `update_*`가 무조건 `set description=$`/`set department_id=$` 실행 → partial 페이로드(예: `{name}`만)가 description/department_id를 NULL로 만든다. 현재 유일 소비처인 web 폼은 항상 전체 필드를 전송하므로 무영향. 외부 API 소비처가 생기면 partial-merge(미전송 필드 보존) 시맨틱 또는 PUT/PATCH 계약 명세 확정 필요.
- **set_*_active 멱등 미보장(감사 노이즈)** [api/app/core/db.py set_*_active] — 동일 상태로 재토글 시 동일 before/after의 감사 `update` 행이 누적된다. UI는 반대 액션만 노출해 차단하나 API 직접호출은 가능. 상태가 실제 바뀔 때만 쓰도록(`where ... and is_active is distinct from $`) 가드하되 멱등 성공(404 회피) 처리 검토.

**프로젝트 전역 하드닝(1.7/1.8과 공통):**
- **낙관적 동시성 부재(lost update)** [api/app/core/db.py update_*] — `where id=$1`만으로 갱신, `updated_at` 선행조건/ETag 없음 → 두 관리자가 같은 행을 편집하면 last-write-wins(409 없음). 1.7 매트릭스·1.8 직원관리와 동일한 전역 패턴. 동시성 하드닝 묶음에서 일괄 처리.
- **단일 `pendingId` 다중행 동시 토글** [web masters-manager.tsx] — 한 행 토글 중 다른 행 토글 시 첫 행 pending이 해제되어 이중제출 여지. staff-directory(1.8)와 동일 패턴 → 일괄 개선 시 per-row pending Set 으로.
- **토글 실패 시 재조회/재조정 부재** [web masters-manager.tsx applyActive] — 실패 시 toast만, UI/DB 발산은 수동 재로드로만 복구. 1.8과 동일.
- **fetchMasters 페이지네이션/limit 부재** [web/src/lib/admin/masters.ts] — `.range()/.limit()` 없음 → soft-delete 누적으로 PostgREST max-rows(≈1000) 초과 시 무음 절단. 마스터는 소수라 당장 무해(1.10 audit offset defer와 동형). 대량화 시 keyset/limit + "더 보기".
- **TOCTOU 재평가·일부 분기 전용 테스트 부재** [api/tests] — in-tx `_require_master_manage`(권한 revoke 레이스)·update_room-bad-dept 전용 단위 케이스 없음. 통합 테스트와 1.7/1.8 정황으로 커버, 전용 케이스는 후속.

## Deferred from: code review of 1-10-감사-로그-뷰어-관리자-append-only (2026-06-20)

- **before/after 마스킹이 web 렌더 계층 전용 — API 응답·로그엔 jsonb 원문 전송** [api/app/schemas/audit.py] — 스펙이 마스킹을 렌더 계층으로 의도했고 현재 스냅샷(roles·permissions·role_permissions·users)엔 PII 부재라 무영향. Epic 3+ 환자 스냅샷이 audit_logs에 들어오면 FastAPI 응답 본문·구조적 로그에 평문 PII가 흐를 수 있으므로, 그 시점에 **서버측 마스킹 또는 reveal 권한 게이트 응답 정책**을 검토(decrypt_sensitive reveal 패턴과 정합).
- **offset 페이지네이션 page 상한 부재 → 대용량 시 큰 OFFSET 비용** [api/app/core/db.py:fetch_audit_logs] — `page: ge=1` 상한 없음, `offset=(page-1)*page_size`. 감사 조회는 admin(`audit.read`) 전용이라 노출이 제한되고 Postgres bigint 범위 내라 현재 실害 없음. 감사 로그가 대량 누적되면 keyset(seek) 페이지네이션 또는 합리적 상한 검토.
- **date_to 경계가 `<=` + 클라이언트 `T23:59:59`(ms 없음) → 23:59:59.x 로그 누락** [api/app/core/db.py · web/src/components/admin/audit-log-viewer.tsx] — 종료일의 마지막 1초 미만 timestamptz 로그가 제외됨. 반열림 구간(`created_at < 익일 00:00`)이 정석. 경계 정밀도가 중요해지면 전환.
- **행위자 필터가 직원목록(`/v1/admin/users`, user.manage)에 의존** [web/src/components/admin/audit-log-viewer.tsx] — 시스템/환자/삭제된 직원 actor로는 필터 불가(목록 표시는 actorLabel로 안전 보존). `audit.read`만 가진 전용 감사 역할은 드롭다운이 비는 디그레이드. 향후 **distinct-actor 전용 소스**(user.manage 비의존)로 분리 검토.

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

## Deferred from: code review of 3-1-환자-레코드-생성-원무-직접-등록-암호화-rls-적용 (2026-06-21)

- **서버측 감사 PII 마스킹 정책** [supabase/migrations/0009_patients.sql 감사 트리거 / api/app/schemas/audit.py] — patients/guardians 의 평문 PII 컬럼(`name`/`phone`/`address`/`email`)이 0004 제네릭 감사 트리거를 통해 `audit_logs.before_data`/`after_data` jsonb 에 평문으로 적재된다. raw 주민번호는 `resident_no_enc`(bytea)로만 들어가 평문 부재(안전)지만, 나머지 평문 PII 는 그대로 스냅샷됨. 현재 방어: `audit.read` 권한 게이트 + 뷰어 렌더 마스킹(1.10). 미해결: API 응답 본문·구조적 로그 레벨의 서버측 마스킹 또는 reveal 권한 게이트 응답 정책. **교차절단**(전 PII 테이블 영향, A-3 이월의 연속) — 환자 PII 가 처음 audit 에 유입되는 시점이라 정책 결정이 필요. Epic 3 내 또는 전용 감사-하드닝 스토리에서 처리 권장.
  - **🔺 긴급도 상승 (Story 3.2, 2026-06-21):** 임상 프로필 갱신(`PUT /patients/{id}/clinical-profile`)이 `audit_logs` 스냅샷에 **건강민감 데이터**(`allergies`·`chronic_diseases`·`medications`·`notes`)를 처음으로 유입시킨다(기존 name/phone/address/email 평문 PII 에 더해). 일반 식별 PII보다 민감도가 높은 의료정보가 audit before/after 에 평문 적재되므로 서버측 마스킹/게이트 정책 결정의 우선순위가 올라감. 3.2 는 교차절단이라 범위에 넣지 않고 defer 유지 — **Epic 3 회고 또는 전용 감사-하드닝 스토리에서 우선 처리 권장.**

## Deferred from: code review of 4-1-내원-상태머신-전이-rpc-db (2026-06-21)

- **soft-delete(`is_active`) 미반영** [supabase/migrations/0010_encounters.sql] — 전이 트리거·RLS 정책·INSERT 가드 어디도 `is_active`(또는 참조 `patients`/`departments` 의 `is_active`)를 보지 않는다. 비활성 환자/폐과에 신규 내원 생성 가능, soft-delete 된 내원에도 전이 RPC 동작, RLS self/staff 정책이 비활성 행 노출. patients 0009 의 "is_active 미필터" 이월과 동일 교차절단 — soft-delete 플로우 전용 스토리에서 일괄 처리(스토리 Dev Notes 명시 이월).
- **환자 포털 컬럼 노출** [supabase/migrations/0010_encounters.sql] — `encounters_select_self` + 테이블 단위 `grant select to authenticated` 로 환자가 본인 내원의 전 컬럼(`cancel_reason` 자유텍스트·`doctor_id`/`created_by` 내부 직원 uuid·내부 타임스탬프)을 Supabase 직접조회로 끌어갈 수 있다. patients(0009)는 컬럼 GRANT 로 민감 컬럼을 제외했으나 encounters 는 staff/self 가 동일 `authenticated` 역할이라 컬럼 GRANT 로 분리 불가 → 포털 소비처(Epic 8)가 FastAPI 컬럼 투영 또는 전용 뷰로 환자노출 컬럼 화이트리스트 적용.
- **walk-in `registered_at`·`created_by` 미충전** [supabase/migrations/0010_encounters.sql] — walk-in 내원은 4.2 가 `register_encounter` RPC 미경유로 직접 INSERT(status='registered') 하므로 `registered_at`(대기시간·NFR-002 메트릭 근거)·`created_by`(접수 직원)가 NULL 로 남는다. 4.2 walk-in 생성 로직이 INSERT 시점에 두 컬럼을 채워야 함(handoff). 4.1 이 트리거로 자동 stamp 하지 않은 것은 트리거=검증·RPC=데이터stamp 책임 분리 때문.
- **hard delete(service_role) 상태머신 우회** [supabase/migrations/0010_encounters.sql] — `grant delete to service_role` + 전이 트리거가 DELETE 미처리(`audit_logs` 의 block-mutation 트리거 같은 가드 없음)로 종결되지 않은 내원의 물리삭제가 가능. patients 0009 와 동일 posture(child FK RESTRICT 가 보호)이나 encounters 는 자식 테이블(오더 Epic5·임상 4.6·수납 Epic7)이 아직 없어 현재 무방비. 자식 테이블 도래 시 RESTRICT FK 로 자연 보호되거나, 필요 시 hard-delete 차단 트리거 도입. 교차절단.
- **`cancel_reason` 자유텍스트 감사 유입(드리프트 가드)** [supabase/migrations/0010_encounters.sql] — `cancel_reason` 은 운영 사유(저민감) 의도지만 자유텍스트라 호출자가 PII/임상 내용을 넣으면 `audit_logs` before/after 에 평문 적재되고, 3.6 마스킹 집합은 encounters 를 비민감으로 간주해 마스킹하지 않는다. 민감 내용 유입이 판명되면 server `services/audit.py`+web `audit.ts` 마스킹 집합에 `encounters.cancel_reason` 등재(동시), 또는 4.2/4.4 에서 코드화 사유 enum/입력검증으로 자유텍스트 차단.
- **동시성·전이쌍 전수·service_role role 컨텍스트 테스트 부재** [api/tests/test_encounters_db.py] — `for update` 의 동시 전이 직렬화 검증 0건, 6×6 전이쌍 중 8쌍만 표본, 테스트가 `set local role` 없이 postgres 슈퍼유저 컨텍스트로 RPC 호출(RPC EXECUTE grant·service_role 운영 경로·NULL uid 케이스 미검증). has_permission 게이트는 role 무관하게 GUC 로 평가되어 권한 테스트 자체는 유효. 동시성 하드닝 묶음(낙관적 잠금 등)과 함께 보강 — 스토리 명시 이월.

## Deferred from: code review of 4-2-환자-접수-예약-walk-in (2026-06-21)

- **walk-in 활성 검사 TOCTOU(SELECT is_active→INSERT 비원자)** [api/app/core/db.py insert_walk_in_encounter] — 환자/진료과 `is_active` 선검사와 INSERT 사이에 `for update` 잠금이 없어, 그 틈에 커밋된 동시 soft-delete 는 SELECT 스냅샷에 안 보이고 INSERT 는 `is_active` FK 가 아니라 그대로 성공한다. 생성경로 best-effort 가드는 충족하나 원자적 보장은 아님(patients 0009 동일 패턴). is_active 하드닝 일괄 이월 — 활성 환자만 허용하는 부분 FK/트리거를 DB 측에 두거나 행 잠금.
- **동일 환자 중복 walk-in 가드 부재(서버)** [api/app/core/db.py · supabase/migrations/0010_encounters.sql] — "1 환자 = 1 미종결 내원" 유니크 제약/가드가 없어 같은 환자를 동시/연달아 walk-in 접수하면 둘 다 `registered` 행을 만들어 같은 대기열에 중복 진입(현황판 중복 노출). Story 4.2 Open Q4 의 명시 결정(미차단·운영정책 확정 후 별도). 클라 1차선=이중제출 ref 락(4.2 적용). 운영정책 확정 시 부분 유니크 인덱스(`where status in ('scheduled','registered','in_progress')`) 또는 생성 RPC 가드.
- **room_id 비활성/타 진료과 소속 무검증** [api/app/core/db.py insert_walk_in_encounter] — room_id 가 FK 존재만 하면(=rooms 행이 있으면) `is_active=false`(폐쇄 진료실)이거나 `department_id` 가 접수 진료과와 불일치해도 그대로 배정된다(department 는 활성 검사, room 은 미검사·미존재만 422 백스톱). 진료실 배정·검증은 Story 4.4/대기 현황판 소유(4.2 는 미배정 NULL 이 정상). 4.4 가 room 배정 시 활성+진료과 일치 검증.
- **토큰 만료(401) 접수 실패 UX — 재인증 흐름 없음** [web/src/components/reception/patient-intake.tsx · web/src/lib/api/client.ts] — `apiFetch` 가 세션 없으면 `ApiError("no_session", 401)` throw → catch 의 `else` 분기로 토스트만 뜨고 자동 리다이렉트·재인증 없음(데이터 유실은 없음). 교차절단(전 화면의 apiFetch no_session 처리와 일관) — 만료 경로 UX 통일 묶음에서 처리(미들웨어/인터셉터 재인증 유도).
- **검색 결과 RESULT_LIMIT(20) 초과 시 21번째+ 환자 선택 불가** [web/src/components/reception/patient-intake.tsx PatientPicker] — 상위 20명만 표시+"더 정확히 입력" 안내(처리됨)하나, 동명이인·동일생년 다수로 검색어를 더 좁힐 수 없는 케이스는 21번째 이후 환자를 접수 화면에서 선택할 경로가 없다. Story 3.5 전역검색의 페이지네이션 부재가 4.2 로 전파 — 검색 하드닝 묶음(서버 검색 페이지네이션/정렬)에서 해소.

## Deferred from: code review of 4-3-대기-현황판-실시간-다음-호출 (2026-06-21)

- **`on_date` 가 `created_at` 기준 → 예약(Epic 6) 환자가 예약일 보드에 미표시** [api/app/core/db.py fetch_encounters] — 대기 현황판 일자 필터가 `(created_at at time zone 'Asia/Seoul')::date = on_date` 다. walk-in 은 `created_at≈registered_at`(같은 날) 이라 정상이나, **예약(scheduled) 내원은 예약일 이전에 미리 생성**되므로(Epic 6 appointments) `created_at`(생성일) 버킷에 들어가 예약 당일 보드에서 누락되고 생성일 보드에 잘못 노출된다. MVP 엔 appointments 생성 경로가 없어(0010 `reservation_id` FK 미존재·Epic 6 이월) 미발현. **Epic 6(예약) 이 appointments·예약일 컬럼을 만들 때 보드 일자 필터를 예약/방문일 기준으로 전환**(또는 `coalesce(visit_date, created_at::date)` 류). 주인 스토리=Epic 6.
- **`onDate` "오늘" 앵커가 자정 넘어 미갱신(상시 로비 디스플레이)** [web/src/components/encounters/waiting-board.tsx] — `onDate` 가 마운트 시 `todayKST()` 로 1회 캡처되고 어떤 타이머도 갱신하지 않아, 대기판을 로비 모니터에 켜둔 채 KST 자정이 지나면 계속 "어제" 를 조회한다(헤더 라벨도 "오늘"→어제 날짜로 바뀌나 자동 보정 없음). Low — 자동 전진은 "사용자가 특정 날짜를 핀했다" 의도와 모호(스테퍼로 과거 날짜 탐색 중일 수 있음)하므로 의도(follow-today) 추적이 필요. 별도 follow-up(상시 디스플레이 모드 도입 시).

## Deferred from: code review of story-4.4 (2026-06-21)

- **start_consult/허브 로드가 `is_active=false` 무시** [supabase/migrations/0010_encounters.sql `start_consult` · api/app/core/db.py `fetch_encounter`] — soft-deleted(`is_active=false`) 내원도 `status='registered'` 이면 start_consult 로 in_progress 전이되고 허브에서 열린다(전이 RPC precondition 은 status 만 검사, fetch_encounter 는 is_active 무필터). 보드 목록은 `e.is_active` 필터하므로 비노출이나 직접 API/URL 로 도달 가능. **기존 전이 RPC 공통 posture**(0010 의 register/start/complete/cancel/no_show 전부 is_active 무검사)·soft-delete UI 부재라 미발현 — Epic 4.2 is_active TOCTOU 이월과 동일 묶음. soft-delete 스토리 또는 전이 RPC 일괄 is_active 가드에서 처리.
- **doctor "다음 진료" 히어로 정렬이 `called_at`(원무 개념) 기준** [web/src/components/encounters/waiting-board.tsx · lib/reception/encounters.ts `nextCallCandidate`] — 의사 보드의 "다음 진료" 히어로가 `nextCallCandidate`(미호출 우선)를 재사용. 의사 관점 "다음 볼 환자"는 '가장 오래 대기/이미 호출된' 환자 우선이 더 자연스럽다. Low UX(항상 유효한 startable registered 행 반환·표에서 모든 행 직접 시작 가능). 의사 전용 정렬 헬퍼가 필요해지는 스토리에서 정제.
- **진료 계속(onResume) stale/status 가드 없음** [web/src/components/encounters/waiting-board.tsx] — `진료 계속` 버튼은 `runAction` 미경유 단순 `router.push`(isStale·status 무가드). 네비게이션 전용이라 허브 로드가 자가보정하며, 허브 status-aware 패널(4.4 코드리뷰 Patch 3) 적용 후 비-in_progress 는 정확히 표시. Low.
- **진료 허브 back-link `/doctor/waiting` 하드코딩** [web/src/components/encounters/encounter-hub.tsx] — 허브 페이지 게이트가 `encounter.read`(reception 도 보유)라 reception 이 직접 URL 로 허브 도달 시 back-link 가 의사 보드를 가리킨다. reception UI 진입 경로 없음(원무 보드는 호출/접수만)·허브=의사 진입 화면이라 Low. 허브가 role 을 인지하거나 referrer 기반 back 으로 개선 가능.

## Deferred from: code review of 4-5-진료-허브-환자-배너-과거-이력-활력-컨텍스트 (2026-06-21)

- 감사 'read' 이벤트가 RRN reveal 과 연락처 reveal 을 구분하지 못함(action/target_table/target_id 동일). 1.9 `decrypt_sensitive` 의 'read' 관례 + 0004 action CHECK(create/read/update/delete/login)가 신규 action 을 불허하므로 구분하려면 CHECK 변경(별도 스코프). 감사 granularity 향상 시 처리.
  - **🟢 부분 개선(Story 7.5 — 2026-06-24):** 문서 내보내기 감사(`log_payment_document_export`·0049)는 `audit_logs.after_data` jsonb 에 `{document_type, event:'document_export'}` 를 적재해 reveal 과 구분 가능(action 'read'·target_table 은 공유). 동일 패턴을 reveal(RRN/연락처)에도 적용하면 action CHECK 변경 없이 granularity 확보 가능 — 감사 granularity 하드닝 시 reveal RPC 에도 after_data 태깅 도입 검토.
- soft-deleted(is_active=false) 환자도 `reveal_rrn`/`reveal_contact`·`fetch_patient` 로 조회 가능(is_active 미검사). 기존 전이 RPC(0010)·fetch_patient 전부 동일 posture, soft-delete UI 부재. 4.2/4.4 의 is_active TOCTOU 이월과 통합 처리.
- 진료 허브 배너/좌패널의 by-id 로드(`patient-banner`·`patient-context-panel`)가 fetch abort·patientId 변경 시 state 초기화 부재 → 환자 전환 시 stale/오환자 데이터 순간 노출 가능. patient-detail.tsx 등 코드베이스 전반의 동일 패턴 — AbortController/mounted-ref/즉시 리셋 교차절단 하드닝으로 일괄 처리.
- reveal 후 재마스킹 토글 부재(한 번 "표시"하면 영구 노출). UX-DR9 transient reveal+감사는 충족(접근 감사됨). 재마스킹/타임아웃 토글은 어깨너머 노출 완화 nice-to-have.
- `ageFromBirthDate` 주석("KST 무관")과 실제 동작(로컬 타임존 의존) 불일치. KST 배포에선 정상이나 비-KST 환경 경계일 off-by-one 가능 — 명시적 UTC 파싱으로 정정 시 처리.
- 과거 내원 이력의 예약(scheduled) 내원이 registered_at NULL → created_at 표시·nulls-last 정렬(예약일 미표시). 예약일 표시·정렬은 Epic 6(appointments) 소관(4.3 on_date=created_at defer 와 동일).

## Deferred from: code review of story-4.6 (2026-06-21)

- **PUT 전체 교체 낙관적 잠금 부재(lost update)** [api/app/core/db.py `update_medical_record`] — SOAP autosave PUT 가 버전/`updated_at`/`If-Unmodified-Since` 검사 없이 4 파트를 전부 덮어써, 동시 작성자(같은 내원·`medical_record.write` 보유)가 서로의 노트를 last-writer-wins 로 조용히 덮어쓴다. **임상 프로필 PUT 동시성 부재(deferred-work 기존 항목)와 동형 교차절단**이며 §6 의 "서버 author 강제 비적용"은 의도된 설계. 세션당 활성 내원 1개 가드가 동일 브라우저 케이스를 완화. 전역 낙관적 동시성(409) 도입 스토리에서 일괄 처리.
- **`update_medical_record` 가 `is_active`(soft-delete) 미검사** [api/app/core/db.py] — 읽기(`fetch_medical_records`)는 `is_active=true` 필터하나 UPDATE 는 미필터 → soft-deleted 기록도 갱신·부활 가능. medical_records soft-delete/삭제 플로우가 아직 없어 **도달 불가능한 잠재 항목**(patients GET/UPDATE is_active 미필터 deferred 와 동형). soft-delete 기능 도입 시 GET·UPDATE 일관 정책으로 처리.
- **superseded 탭 SoapLedger 편집 가능 유지·재활성화 후 자동 재저장 없음** [web/src/components/encounters/soap-ledger.tsx · encounter-hub.tsx] — 다른 탭이 활성 내원을 점유하면 이 탭의 autosave 는 `isActiveEncounter()` 로 거부되나, ledger 는 계속 편집 가능하고 ledger 자체엔 "보류 중" 표시가 없다(허브 상단 superseded 배너+재활성화 버튼이 1차 신호). 재활성화(takeOver) 후엔 키 입력 전까지 누적분이 재저장되지 않음. 안전속성(오환자 쓰기 차단)은 충족 — ledger 레벨 표시·재활성화 시 재저장은 MVP nice-to-have.
- **전부-빈(all-null) POST 가 서버에서 빈 medical_records 행 생성** [api/app/services/encounters.py · api/app/core/db.py `insert_medical_record`] — 웹은 patch 후 `hasContent` 가드로 빈 저장을 막으나 직접 API `POST {}` 는 빈 행을 만든다. 스키마가 partial(4 파트 옵셔널) 허용 의도·유일 소비처=웹. 필요 시 서버측 all-empty 거부(422) 방어심층 추가.
- **`fetch_medical_records` limit 200 무신호 절단** [api/app/core/db.py] — 한 내원 SOAP 기록 200건 초과 시 오래된 기록이 무신호로 누락(4.5 의 no-silent-cap 안내와 불일치). 한 내원 200 기록은 **도달 불가능**(4.5 의 100 은 환자 평생 내원이라 더 도달 가능) — 절단 안내/페이지네이션은 도달 가능 시점에 추가.
- **"새 진료기록" 이 미저장 편집을 flush 없이 폐기** [web/src/components/encounters/soap-ledger.tsx `handleNewRecord`] — 디바운스 창(1.5s) 내 미저장 입력 후 "새 진료기록" 클릭 시 직전 입력이 유실. 스펙 명시 동작("활성 기록 초기화·미저장 초안")이고 patch 후 autosave 신뢰도 향상 — 필요 시 전환 전 flush.
- **full-bleed `-mx-4`(좌우 테두리 없는 열린 캔버스) 미적용 — 카드 박싱** [web/src/components/encounters/soap-ledger.tsx] — UX-DR11 은 SOAP 섹션을 "테두리 없는 열린 캔버스(대비 강조)"로 요구하나 구현은 rounded 카드. 기능적 요소(1열 ledger·hairline·S/O/A/P 배지·132px·focus teal 액센트·"비어 있음" 빈상태) 전부 충족 — "열린 캔버스 vs 카드"는 Low 시각 충실도. 3-pane 일관성과의 균형은 UX 후속에서.
- **SOAP 쓰기 서버측 status 게이트 없음** [api/app/core/db.py `insert_medical_record`/`update_medical_record`] — §4 설계결정대로 작성 윈도우 잠금(완료 후 addendum 만)은 deferred·웹이 in_progress 게이트. 비-in_progress/inactive 내원에 직접 API 작성이 가능(by-design). 완료 후 정정 정책 확정 시 status 기반 윈도우 도입.

## Deferred from: code review of 4-7-진단-부착-kcd-주-부상병-구분 (2026-06-21)

- **`complete_encounter` 게이트 TOCTOU** — `complete_encounter` RPC 는 `encounters` 행만 `for update` 로 잠그고 주상병 존재 검사(`encounter_diagnoses`)는 잠그지 않는다. 게이트 통과 직후 동시 트랜잭션이 유일 주상병을 soft-delete/강등하고 커밋하면 주상병 0개인 채 `completed` 로 전이될 수 있다. 완화: 세션당 활성 내원 1개 가드(UX-DR21)·의사 단독 소유. 향후 게이트에 `encounter_diagnoses` 행 잠금(advisory/SELECT … FOR UPDATE) 추가 = 낙관적 잠금 교차절단 하드닝(4.6 medical_record PUT lost-update 와 동류). [supabase/migrations/0014_encounter_diagnoses.sql]
- **동시 주상병 부착 unique 오매핑 + 토글 503** — `attach_diagnosis` 의 `except UniqueViolationError` 는 모든 unique 위반을 `diagnosis_already_attached`(409)로 단정 → 동시 2건 `is_primary=true` 부착의 `uq_encounter_diagnoses_primary` 위반이 "이미 부착된 진단"으로 오라벨된다. `set_diagnosis_primary` 는 unique/FK except 백스톱이 전혀 없어 동시 토글 충돌 시 `_map_pg_sqlstate` 미매핑 → 503 폴백(attach 와 비대칭). 비-동시 경로는 강등 선행으로 위반 불가(도달=동시성만). 향후 `constraint_name` 으로 uq_primary↔uq_dup 구분 + 토글 백스톱 대칭화. [api/app/core/db.py attach_diagnosis/set_diagnosis_primary]
- **attach/remove 내원 상태 게이트 부재** — 진단 부착/토글/제거 엔드포인트에 내원 status 가드가 없어 직접 API 호출 시 완료/취소된 내원에도 진단을 수정할 수 있다(웹 UI 는 in_progress 만 노출). 4.6 §결정4(SOAP 작성 윈도우 잠금 deferred — 완료 후 addendum 여지)와 동형 by-design posture. 향후 진료 완료 후 진단 잠금(addendum 전용)을 도입할지 결정. [api/app/core/db.py · api/app/api/v1/encounters.py]

## Deferred from: code review of 6-1-근무표-휴진-예외-관리-db-관리자 (2026-06-21)

- **스케줄 수정/재활성 시 의사 재직·진료과/진료실 활성 재검증 부재** — `update_doctor_schedule` 는 변경된 FK 만, `set_doctor_schedule_active` 재활성은 FK 활성 검사를 전혀 하지 않는다(insert 만 `_assert_*_assignable` 전수). 퇴사(employment≠active) 의사나 비활성 진료과/진료실을 가리키는 스케줄이 active 로 남거나 재활성될 수 있고, 6.2 슬롯 계산이 이를 예약 가능 슬롯으로 전개할 위험. 현 posture 는 `update_room` AC3(변경분만 검사·현 값 유지 허용) + masters `set_*_active`(재활성 시 미검증) 선례와 **코드베이스 전반 일관**(소프트삭제 posture). EXCLUDE 겹침은 재활성 시 재검증됨(457·334 catch). **해소 경로=6.2 슬롯 계산이 `users.employment_status='active'` 조인으로 자연 필터**(가장 적절) 또는 6.1 이 set_active/update 에 employment 재검증 추가(masters 패턴 이탈 비용 동반). 주인 스토리=6.2. [api/app/core/db.py update_doctor_schedule·set_doctor_schedule_active]
- **비활성 확인 다이얼로그·토스트 의사명 `(미상)` 강등** — 의사 목록(`fetchSchedulingDoctors` 마운트 조회)이 로드 전이거나 `doctorsError` 로 실패하면 비활성 확인 다이얼로그·성공 토스트의 의사명이 `(미상)` 으로 표기된다. 동작은 id 기반이라 정상이고 `doctorsError` 배너가 별도 안내하나, 파괴적 확인 라벨의 신원 약화. cosmetic. 향후 의사 미로딩 시 요일·시각만으로 폴백하거나 로드 전 행 액션 비활성 고려. [web/src/components/admin/schedule-manager.tsx]
- **통합 lifecycle 테스트 try/finally 정리 부재** — `test_schedule_lifecycle_with_audit` 는 말미 `_deactivate` 로 재실행 안전을 확보하나 try/finally 가 없어, 중간 assert 실패 시 weekday=6 active 행이 잔존해 다음 실행의 생성을 409 로 오염시킬 수 있다(db reset 이 표준 격리라 미발현). 정리를 fixture/finally 로 이전. [api/tests/test_scheduling_integration.py]

## Deferred from: code review of 5-1-오더-생명주기-스키마-상태머신-db (2026-06-22)

- **same-status 직접 UPDATE 가 attribution 컬럼을 상태전이 없이 덮어쓰기 가능** [supabase/migrations/0015_orders.sql `enforce_prescription_transition`·`enforce_act_order_transition`] — 전이 트리거의 `new.status = old.status → return new` 분기는 비-상태 컬럼 편집을 통과시킨다(0010 same-status posture 계승). 그 결과 service_role 직접 `UPDATE examinations SET performed_by=<x>, performed_at=now() WHERE status='performed'`(status 불변)이 트리거를 통과해 **수행자/완료자·시각(`performed_by`/`_at`·`completed_by`/`_at`)을 재기록**할 수 있다. RPC 의 소스상태 precondition(재수행 차단 FR-093)은 RPC 경로만 보호하고 직접 UPDATE 는 막지 못한다. 마이그 헤더의 "direct update·service_role 까지 봉쇄" 문구는 *status 전이*에 한정 — attribution 불변성은 미보장. **해소 경로**: 전역 낙관적 잠금/attribution 동결 트리거(Epic 4→5 결정으로 앱-레벨 낙관적 잠금 계속 이월) 도입 시 함께. 현재 service_role(FastAPI) 신뢰 경계 안이라 미발현. encounters 0010·medical_record/encounter_diagnoses PUT lost-update 와 동류 교차절단.

- **`complete_treatment_order` RPC 부재 → treatment `completed` 는 ungated 직접 UPDATE 로만 도달** [supabase/migrations/0015_orders.sql] — CHECK·`enforce_act_order_transition` 은 `performed→completed` 를 허용하나 sanctioned writer(RPC)는 `perform_treatment_order`(→performed)까지만. 따라서 treatment 를 `completed` 로 보내는 유일 경로는 권한 게이트·소스상태 precondition 없는 service_role 직접 UPDATE. 스펙 §220 이 의도적으로 이월(0010 `scheduled` 예약 어휘 동형). **해소 경로**: 처치 완료 동작이 필요한 스토리(또는 Epic 7)가 `complete_treatment_order` RPC + 권한 추가. 그 전까지 프로덕션 경로는 `treatment_orders.status='completed'` 를 직접 쓰지 않아야 함.

- **신규 FK 의 active/effective 마스터 불변식 DB 미강제** [supabase/migrations/0015_orders.sql 전 FK] — `drug_id`/`fee_schedule_id`/`equipment_id`/`encounter_id`/`encounter_diagnosis_id` FK 는 행 존재만 검증하고 `is_active`/`effective_to` 는 보지 않는다(0007 마스터는 soft-delete + 유효기간). 결과: (a) 비활성·만료된 약품/수가로 오더 생성 가능, (b) 라이브 오더가 참조하는 마스터가 soft-delete 될 수 있음. "현재 유효 마스터" 불변식은 전적으로 앱 레이어(5.2/5.3/5.4 `_require_*` + 활성 검사)에 위임 — DB 권위 레벨엔 부재. walk-in `insert_walk_in_encounter` is_active TOCTOU·is_active soft-delete 일관정책 이월과 **동일 묶음**. 해소 경로: 활성-only 부분 FK/트리거를 DB 측에 두는 전역 is_active 하드닝 스토리.

- ~~**`issued→dispensed` 전이 권한 게이트 부재**~~ **✅ 해소(Story 7.7·0050)** [supabase/migrations/0015_orders.sql → 0050_prescription_dispense.sql] — 처방 발급 전이가 트리거는 허용하나 권한 체크·전용 RPC 가 없던 갭. 7.7 이 `dispense_prescription(uuid)` RPC(SECURITY DEFINER·`has_permission('prescription.dispense')` 자가 게이트·소스상태 issued 선검사·`dispensed_at`·재발급 PT409) + `prescription.dispense` 권한(reception+admin·admin 부트 grant 재실행) 신설로 청산. 발급=명시적 액션 엔드포인트(`POST .../prescriptions/{id}/dispense`)로만 도달·비가역 1방향. per-action 권한 모델 정합.

- **`_assert_sqlstate` 가 SQLSTATE 클래스만 비교(메시지 미비교)** [api/tests/test_orders_db.py] — 여러 코드 경로가 `PT409` 를 던진다(트리거 초기상태 가드·전이 매트릭스·RPC 소스상태 precondition). 테스트는 SQLSTATE 클래스만 단언하므로, 실패가 *다른* PT409 경로로 이동하는 회귀(예: RPC precondition 제거됐으나 트리거 매트릭스가 잡음)를 구분하지 못할 수 있다. `test_encounters_db._assert_sqlstate` 계승 패턴(코드베이스 전반 동형). **보강 경로**: 에러 메시지 substring 단언 추가 또는 re-perform 후 `performed_by` 보존 단언(같은 묶음=위 attribution 불변성). 현 커버리지는 동작은 검증(PT409 발생)하되 발생원은 미특정.

## Deferred from: code review of 6-2-동적-가용-슬롯-계산 (2026-06-21)

- **슬롯 계산이 선택 진료과 미필터** [api/app/services/scheduling.py·api/app/core/db.py `fetch_doctor_schedules_for_weekday`] — `GET /scheduling/slots` 는 `doctor_id+date` 만 받아 의사의 **모든** 요일 근무 블록(진료과 무관)을 슬롯화한다. `doctor_schedules.department_id` 는 블록별(의사가 다중 진료과 커버 가능, 0030:27)이고 `bookable-doctors` 는 `users.department_id`(주 진료과)로만 필터 → (a) 다중과 의사 선택 시 타과 슬롯 노출, (b) 부차 진료과 블록만 가진 의사는 그 진료과 필터에 미노출. 스토리상 슬롯=doctor+date 스코프·진료과별 집계=6.5(진료과→의사→날짜 흐름) 소유. 데모(단일과 의사) 무영향. 해소: 슬롯 엔드포인트에 `department_id` 옵션 필터 추가(6.3 캘린더/6.5 환자앱이 IA 확정 시).

- **completed·in_progress 예약이 자기 슬롯 미차단** [supabase/migrations/0031_appointments.sql EXCLUDE·db.py `fetch_booked_appointments_in_range`] — 더블부킹 EXCLUDE·슬롯 차감 모두 `status='booked'` 만 본다. `completed`(도착·진료완료)/향후 `in_progress` 예약은 슬롯을 비우고 EXCLUDE 도 막지 않는다. 6.2 엔 예약 전이 경로 부재로 `completed` 도달 불가(전이 RPC=6.3/6.4)·완료 예약 슬롯은 과거→`past` → 실무 영향 미미. 6.3/6.4 가 booking→completed 전이 추가 시 "점유 슬롯=booked∪completed(∪in_progress)" 차감/EXCLUDE 확장 여부 결정(특히 당일 조기 완료된 미래 슬롯 재예약 방지).

- **부분 진료과 로드 실패 UX** [web/src/components/scheduling/slot-availability.tsx `loadRefs`] — `Promise.all` 의 Supabase 진료과 조회 실패 시 에러 배너 + 빈 진료과 picker 가 공존하고 재시도 affordance 가 없다(`allDoctors` 는 정상 로드 가능 → 어느 호출 실패인지 불명확). 엣지·저영향. 해소: 자원별 부분 강등 + 재시도 버튼(masters fetchMasters 부분 강등 패턴).

## Deferred from: code review of 5-2-처방-오더-발행-중복-경고 (2026-06-22)

- **오더 발행 시 마스터·내원 상태 미검증** [api/app/core/db.py `insert_prescription`] — 처방 발행은 `drug_id` FK 존재만 검사(23503→422)하고 약품 `is_active`/effective 윈도우, 내원 `status`(완료/취소), 내원 `is_active`(soft-delete)를 재검증하지 않는다. 웹 `MasterSearchPicker` 는 currently-valid drug 만 노출하고 허브는 `in_progress` 에서만 렌더(UI 1차선)하나, 직접 API·stale 탭은 우회 가능. 기존 sibling posture(`attach_diagnosis`·`insert_medical_record` 동형) + "FK active/effective DB 미강제"(5.1 defer③·walk-in is_active TOCTOU 묶음) + "오더-by-내원상태 게이트 이월"(4.6 §결정4) 자세 계승 → 5.2 가 drug 에 대해 새로 노출하는 동일 갭. 해소: 발행 직전 동일 txn 에서 drug active/effective·내원 status/is_active 재검증(`insert_walk_in_encounter` 의 patient/dept active 가드 미러) → 422/409. 마스터 불변식 일관 정책 스토리에서 일괄 처리 권장.
## Deferred from: code review of 6-3-예약-캘린더-더블부킹-차단 (2026-06-22)

- **서버 슬롯-윈도우 검증 부재** [api/app/core/db.py `insert_appointment`·services/scheduling.py] — `create_appointment`/`insert_appointment` 는 `scheduled_start` 가 의사의 활성 근무블록 내·30분 슬롯 정렬·휴진 아님·available(미예약) 인지 검증하지 않는다(환자/의사/진료과 active + EXCLUDE 더블부킹만). 결과: 근무외/비정렬/과거 시각 예약이 API 로 생성 가능하고, 캘린더 `_build_doctor_column` 은 근무 슬롯에만 overlay 하므로 그런 예약은 **invisible**(EXCLUDE 만 슬롯 점유). 6.3 UI 는 available 슬롯만 클릭 가능해 실제 흐름은 안전 → 직접 API/6.4 추가 write 경로 대비 방어심층 갭. 해소: 6.4(원무 대리 생성·변경)가 슬롯-bookable 서버 검증 추가(compute_available_slots 재사용으로 scheduled_start 가 available 슬롯인지 확인). 과거 시각 거부는 6.3 코드리뷰 patch 로 부분 청산.

- **점심 band 라벨 휴리스틱 부정확** [web/src/components/scheduling/appointment-calendar.tsx CalendarGrid] — 공유 시간축의 gap>slot_minutes 를 일률 "점심시간 · 예약 불가"로 라벨한다. 단일 의사 데모(12:30–14:00 점심)는 정확하나, 다중 의사 상이 점심/오후만 근무/중간 휴진 시 비-점심 gap 도 "점심시간"으로 오라벨. 점심 명시 컬럼·정밀 모델 = 스토리 §스코프 이월. 해소: 점심을 doctor_schedules 의 명시 break 로 모델링하거나 band 라벨을 중립("근무 외")으로.

- **다중 슬롯 예약 overlay "render once" 가드 부재** [api/app/services/scheduling.py `_build_doctor_column`] — 한 예약을 겹치는 모든 base 슬롯에 반복 overlay. 6.3 은 전부 `start+30분` slot-aligned 라 1:1(무해)이나, 6.4 가변 길이/전이 예약 시 한 예약이 여러 confirmed 셀로 중복 렌더. 해소: 6.4 가 슬롯-소유(start-equality) 또는 multi-slot 연속 표기 추가.

- **환자 교차-의사 더블부킹 미차단** [supabase/migrations/0031 EXCLUDE·db.py insert_appointment] — 더블부킹 EXCLUDE 는 `doctor_id`+시간만(같은 환자가 동시간 2명 의사에게 예약 가능). 단일 의사 외래 흐름 범위 밖·환자-레벨 충돌 미명세. 필요 시 환자-시간 부분 제약 또는 앱-레벨 검사.

## Deferred from: code review of 5-3-검사-영상-오더 (2026-06-22)

- **오더-by-내원상태 게이트 부재** [api/app/core/db.py `insert_examination`] — `insert_examination` 은 내원 존재만 선검사(404)하고 `status`(완료/취소)·`is_active`(soft-delete)를 보지 않아 종결/취소 내원에 API 직접 호출 시 검사·영상 오더가 생성된다. 진료 허브 UI 는 `in_progress` 에서만 패널을 렌더(1차선)하나 직접 API·stale 탭은 우회. 5.2 처방(`insert_prescription`)·4.6 §결정4 와 동일 "오더-by-내원상태 게이트=이월" posture 의 검사·영상 연장. 해소: 오더 직전 동일 txn 에서 내원 status/is_active 재검증(→409/422). 마스터·내원 불변식 일관 정책 스토리에서 처방과 함께 일괄 처리 권장.
- **fee_schedule active/effective 서버 검증 부재** [api/app/core/db.py `insert_examination`] — 오더 생성은 `fee_schedule_id` FK 존재만 검사(23503→422)하고 EDI 행위의 `is_active`/effective 윈도우(`effective_from`/`effective_to`)를 재검증하지 않는다. 웹 `MasterSearchPicker(kind=fee_schedule)` 는 `today` 로 currently-valid 행위만 노출(UI 1차선)하나 직접 API·피커 로드 후 만료까지의 race 는 폐지/미발효 EDI 코드로 오더 생성 가능 → 수가 청구(5.10) 시점 무효. 5.2 "[Defer] 오더 발행 시 마스터 미검증(drug is_active/effective)" 선례의 fee_schedule 연장(동일 sibling posture). 해소: 오더 직전 동일 txn 에서 fee_schedule active/effective 재검증(→422). 마스터 불변식 일관 정책 스토리에서 drug·fee_schedule 일괄 처리 권장.

## Deferred from: code review of 6-4-원무-대리-예약-생성-변경-취소 (2026-06-22)

- **[청산됨·Story 6.8] reschedule 가 다른 진료과 의사로 변경 시 `appointment.department_id` 미동기화** [api/app/core/db.py `reschedule_appointment`] — ✅ **6.8 이 청산**(휴진 재배정이 cross-doctor reschedule 을 실 경로로 열며): `reschedule_appointment` 가 **의사 변경 시** department_id 를 새 의사 home 진료과(`users.department_id`)로 동기화(option b)·**같은 의사면 불변**(다중 진료과 의사 회귀 차단). 통합 테스트 `test_reschedule_other_doctor_syncs_department`·`test_reschedule_same_doctor_keeps_department` 가드. ⚠️ **잔여 이월**: "새 의사가 그 진료과를 실제 진료(doctor_schedules 멤버십)하는지" 서버 검증(option a `_assert_doctor_in_department`)은 별개 — 6.8 은 department_id 정합(고아 방지)만 보장하고, web UI 가 같은 진료과 피커(`bookable-doctors(department_id)`)로 제한해 멤버십 위반은 미도달(아래 `department_id↔doctor_id 정합 서버 백스톱` 항목과 통합 관리).

## Deferred from: code review of 5-4-처치-오더 (2026-06-22)

- **fee_schedule active/effective 서버 검증 부재** [api/app/core/db.py `insert_treatment_order`] — 처치 오더 생성은 `fee_schedule_id` FK 존재만 검사(23503→422)하고 EDI 처치 행위의 `is_active`/effective 윈도우를 재검증하지 않는다(`insert_examination`/`insert_prescription` 동일 posture). 웹 `MasterSearchPicker` 가 `today` 로 currently-valid 행위만 노출(UI 1차선)하나 직접 API·피커 로드 후 만료 race 는 우회. **이 갭은 이미 추적됨** — "신규 FK 의 active/effective 마스터 불변식 DB 미강제"(5.1 defer③ 항목)가 `drug_id`/`fee_schedule_id` 등 전 FK 와 `5.2/5.3/5.4 _require_*` 를 명시. 별도 해소 불요(마스터 불변식 일관 정책 스토리에서 drug·fee_schedule 일괄). 5.4 는 처치에 대해 동일 갭을 잇는다(신규 위험 0).

## Deferred from: code review of 6-5-환자-앱-예약 (2026-06-22)

- **`department_id`↔`doctor_id` 정합 서버 백스톱 부재** — `insert_self_appointment`/`insert_appointment`(api/app/core/db.py) 가 의사·진료과를 각각 독립 active 검증만 하고 둘의 소속 관계를 검증하지 않는다. 정상 UI 흐름(진료과 선택→해당 진료과 active 의사만 로드)에선 도달 불가·API 직접 호출 또는 웹 stale 상태(의사 목록 race)에서만 도달. **6.4 cross-department reschedule defer 와 동형의 기존 공백**(6.5 가 신규로 만든 것 아님). 교차-의사/진료과 정합 가드 착수 시(예: `_assert_doctor_in_department`) 직원·환자 예약·reschedule 경로에 일괄 적용. 출처: code review edge M4.
- **날짜 칩 레일 per-date 가용성 미반영** — `web/src/components/scheduling/patient-booking.tsx:buildDateChips` 가 오늘부터 14일 칩을 전부 활성으로 렌더(비근무일·종일 경과·일요일 포함). 누르면 빈-상태("예약 가능한 시간이 없어요")로 안전하나 시행착오를 강요. per-date 휴진/마감 배지는 **N일 일괄 가용성 사전계산**(배치 가용성 엔드포인트)이 필요해 스펙 단계에서 명시 이월. 6.2/6.3 의 슬롯 사전계산 defer 와 동일선상. 출처: code review edge L2/L3.

## Deferred from: code review of 5-5-오더-패널-알레르기-교차검증-누락-0-디텍터 (2026-06-22)

- **feePreview/PayChip coverage fail-open 분류** — `web/src/lib/encounters/order-safety.ts feePreview` · `order-item-meta.tsx PayChip` 가 `coverage_type !== "non_covered"` 면 전부 급여로 분류·라벨. 현재 DB CHECK 2상태(covered/non_covered)라 안전하나, 선별급여/부분급여 등 제3 상태(Epic 7) 추가 시 명시 분기 필요(미분기 시 조용히 급여 오분류). coverage enum 확장 스토리에서 일괄.
- **OrderPanel `Promise.all` all-or-nothing 로드** — `web/src/components/encounters/order-panel.tsx reload` 가 처방·검사·처치 3종을 `Promise.all` 로드 → 한 유형 fetch 실패 시 전체 패널 에러(통합 전 개별 패널 독립 degrade 대비 변화). 통합 패널 카운트·수가 프리뷰 일관성(부분 데이터=오카운트 회피) 트레이드오프. 유형별 부분 degrade 필요 시 per-fetch try/catch + 부분 표시로 전환.
- **reload 실패 시 stale + 성공 토스트** — `order-panel.tsx load`(내부 catch·재throw 안 함) + 자식 패널 `await onReload(); toast.success()` 구조상, create 성공 후 reload 실패 시 목록·카운트·프리뷰 미갱신인데 success 토스트가 뜨고 에러 무표시(에러 화면 조건=전체 null). 다음 상호작용에 자가 보정. stale 시 "새로고침" affordance·loadError 비차단 배너 노출 = UX 하드닝.
- **누락 0 디텍터 `nowMs` 정적 고정** — `order-panel.tsx` 가 `nowMs` 를 reload 시점에만 갱신(타이머 없음·과도 타이머 지양 설계). 패널을 장시간(30분+) 열어두면 새 fetch/액션 전까지 임계 갓 넘긴 미수행 오더가 "지연" surface 안 됨. 표시 전용 근사 — 디텍터 실시간성 요구 시 setInterval(예 60s) 또는 visibility 기반 갱신 도입.
- **알레르기 클라 1차선 patient stale/null degrade** — `encounter-hub.tsx fetchPatient` 가 hub 마운트 시 1회 로드(`catch→null`). 환자 로드 실패 또는 진료 중 외부에서 알레르기 수정 시 클라 `allergyMatch` 가 stale → 경고/사유 게이트 누락. **서버 `insert_prescription` 이 발행 시점 DB 재조회·409 차단으로 안전 보존**(클라 1차선만 degrade). patient=null 시 "알레르기 점검 불가" 인디케이터·환자 갱신 동기 = enhancement.
- **seed coverage_type 멱등 재시드 한계** — `supabase/seed.sql` fee_schedules/drugs INSERT 가 `on conflict (lower(code)) do nothing` + `0016` default `covered` → 비-reset 재시드 또는 운영(이미 마스터 적재) DB 에서 신규 coverage_type 미반영(비급여 의도 행이 covered 고착). **프로젝트 보편 seed 패턴**(전 마스터 동일·dev 표준 = fresh `supabase db reset`)·Story 5.5 Task 2 문서화 → 신규 위험 0. 운영 마스터 coverage 데이터 마이그(UPDATE) = Epic 7 수납 도메인.

## Deferred from: code review of 5-6-간호-활력징후-기록 (2026-06-22)

- **워크리스트가 자정 넘긴 in_progress 내원 누락** [api/app/core/db.py `fetch_vitals_worklist`] — "오늘 활성 내원"을 `(created_at at time zone 'Asia/Seoul')::date = today` 로 정의 → 전날 접수 후 당일까지 `in_progress` 로 남은 내원이 워크리스트에서 사라진다(상태는 활성인데 날짜가 자름). **4.3 대기 현황판·`fetch_encounters` 의 `on_date`=created_at KST 동일 posture**(시스템 전반 "오늘" 정의 일관) — 신규 위험 0. 외래는 당일 완결 전제. 해소: 활성 상태(registered/in_progress)를 날짜 무관 포함하거나 "오늘 + 미완료 이월" 옵션 추가 시 4.3 과 함께 일괄.
- **활력 조회 효율(직렬 권한 왕복·상관 서브쿼리·인덱스)** [api/app/core/security.py `require_any_permission`·db.py `fetch_vitals_worklist`] — `require_any_permission` 이 권한 코드마다 별도 `await db.fetch_has_permission`(최대 2 왕복·핫패스 진료 허브 좌 패널) → 단일 `has_permission(any)` 으로 합칠 수 있음. 워크리스트 `latest_vital_recorded_at` 는 내원행마다 상관 서브쿼리 + `(encounter_id, recorded_at)` 복합/부분 인덱스 부재(현 `idx_vital_signs_encounter_id`·`_recorded_at` 단독만). 당일 외래 규모 무해 — 워크리스트 대형화 시 LATERAL/그룹 조인 + 복합 인덱스.
- **웹 `parseField` 정수 필드 무경고 절단** [web/src/components/nurse/vitals-input-form.tsx] — systolic 등 정수 필드에 `Number.parseInt("120.5")=120`·`parseInt("12abc")=12` 침묵 절단. `aria-invalid`/`isAbnormal` 이 절단값 기준이라 입력↔강조 어긋날 수 있음. **서버 Pydantic int 가 비정수 422 최종 차단**·number input `step=1` 1차선이라 보안/데이터무결성 영향 없음(Low UX). 해소: 정수 입력 거부/반올림 정책 확정 시.
- **혈압 셀 한쪽만 null 표시 모호** [web/src/components/encounters/vitals-display.tsx] — 수축/이완 중 하나만 측정 시 `120/—` 표시 + `bpAbnormal=systolic||diastolic` 으로 셀 전체 danger·sr-only 는 동일 "(정상범위 밖)" → 어느 값이 이상인지 구분 소실. 표시 전용·임상 판단 보조이므로 Low. 해소: 혈압을 수축/이완 분리 셀 또는 비정상 항목 명시.
- **`vitals-page` 활력 조회 실패를 빈 배열로 강등** [web/src/components/nurse/vitals-page.tsx `loadVitals`] — `catch { setVitals([]) }` 가 403(권한 회수)·네트워크·500 을 전부 "측정된 활력징후가 없습니다"(데이터 부재)와 시각적으로 동일 취급 → 간호사가 기존 활력 없다고 오인 가능. 워크리스트 본체는 별도 에러 배너 보유·재측정은 정상 흐름(매 측정 새 행)이라 임상 영향 미미(Low). 해소: 로드 실패 시 에러 인디케이터 분리.
## Deferred from: code review of story-6.6 (2026-06-22)

- **skipped(연락처 없음) 리마인더 영구 재발송 불가** — `notification_logs.UNIQUE(appointment_id, reminder_kind)` + `insert_notification_log` 의 `ON CONFLICT DO NOTHING` 때문에, 동의했으나 연락처 없는 예약이 한 번 `skipped` 로그를 남기면 이후 환자 연락처가 보정돼도 재실행은 duplicate 처리(append-only=UPDATE 불가)되어 끝내 발송되지 않는다. **멱등 "단순 1회" + 재시도 이월(스펙 명시)** 의 귀결이며 `skipped` 기록 자체는 AC3(은폐 없음) 의도. 재시도/skipped 승격이 필요하면: 부분 UNIQUE(`where status='simulated'`) + skipped 별도 dedup, 또는 별도 재발송 큐(다채널·재시도와 함께 후속).
- **예약 변경(reschedule) 후 새 날짜 재-리마인더 미발화** — reschedule 가 `appointment_id`·`status='booked'` 유지하고 `scheduled_start` 만 바꾸므로, 원 날짜에 이미 발송된 로그가 같은 `(appointment_id, reminder_kind)` 슬롯을 점유 → 새 날짜의 D-3/D-1 디스패치가 ON CONFLICT 로 묵살. **스펙 명시 이월**("예약 변경 후 재-리마인더=이월·멱등 UNIQUE 가 단순 1회·1채널 보장"). 변경 시 해당 예약 로그 무효화 또는 reschedule_count 를 UNIQUE 키에 포함하는 설계가 필요.
- **비활성 환자/폐과 예약에도 리마인더 발화** — `fetch_reminder_due_appointments` 의 `join patients`/`join departments` 에 `is_active` 필터가 없어, 예약 후 환자 soft-delete(`patients.is_active=false`) 또는 진료과 비활성화 시에도 booked 예약이면 시뮬 발송된다. 예약 생성(`insert_appointment` patient_active 검사)·도착접수와 달리 dispatch 는 active 재검증 안 함. Low(booked 예약이 진실원·body 비-식별)·예약 생명주기 일관성(상위 데이터) 소관. 필요 시 조인에 `p.is_active and d.is_active` 추가.

## Deferred from: code review of story-5.7 (2026-06-22)

- **워크리스트 KST 자정 누락** [api/app/core/db.py `fetch_nursing_worklist`] — `(e.created_at at time zone 'Asia/Seoul')::date = $1`("오늘 KST") 필터 때문에 전날 접수·당일 미완료(in_progress)·미수행 처치 보유 내원이 00:00 KST 에 워크리스트에서 빠진다. FR-090/UX-DR21 ⑥("처치 누락 0 디텍터")를 부분 약화. 4.3 대기현황판·5.6 활력 워크리스트와 동일한 코드베이스 전반 "오늘 KST" posture 의 계승 — 자정 넘긴 활성 내원 carry-over 는 워크리스트 일관 정책 스토리에서 일괄(예: `status='in_progress' OR created KST today`).
- **지연 디텍터 `nowMs` 1회 고정** [web/src/components/nurse/treatment-worklist-page.tsx] — `setNowMs(Date.now())` 가 마운트 effect 1회만 실행 → 화면 장기 노출 시 "지연 N분" 배지가 임계 교차해도 갱신 안 됨. order-panel·waiting-board 의 "로드 시점 nowMs" 동일 posture. 해소 시 `setInterval(60s)` + cleanup 으로 주기 갱신(세 화면 일괄).
- **`loadRecords` 에러 → 빈 목록 강등** [web/src/components/nurse/nursing-notes-page.tsx] — catch 가 403/네트워크/500 을 전부 "작성된 간호기록이 없습니다"로 강등(로드 실패와 데이터 부재 시각 동일·중복 기록 유인). 5.6 `loadVitals` 동일 Low UX(deferred). 워크리스트 본체는 별도 에러 처리.
- **오더-by-내원상태 게이트 부재** [api/app/core/db.py `call_perform_treatment_order`·`insert_nursing_record`] — perform RPC 는 오더 status(ordered) 만 검사하고 내원 status(완료/취소)·is_active 를 보지 않아, 종결/취소 내원의 ordered 처치를 직접 API 로 수행/기록할 수 있다(UI 는 active 내원만 노출 1차선). 5.2~5.6·deferred-work(276/289) 동일 "오더-by-내원상태 게이트=이월" posture. 해소: 수행/기록 직전 동일 txn 에서 내원 status/is_active 재검증(→409/422). 마스터·내원 불변식 일관 정책 스토리에서 일괄.

## Deferred from: code review of story-5.8 (2026-06-22)

- **영상 MIME 매직바이트 미검증** [api/app/services/radiology.py:58-65] — 업로드 MIME 화이트리스트·확장자가 클라 선언 `content_type` 만 신뢰(실제 바이트 시그니처 미검사). 임의 바이트를 `image/png` 라벨로 저장 가능. 비공개 버킷+서버 발급 단기 서명 URL+`<img>` 렌더(SVG 스크립트 비실행)로 악용 표면 제한·코드베이스에 매직바이트 검사 선례 없음. 해소 시 `imghdr`/시그니처 스니프(공통 업로드 헬퍼로).
- **서명 URL 1건 실패 시 전체 목록 503** [api/app/services/radiology.py:88-93] — `list_examination_images` 가 `[await _to_image_response(r) for r in rows]` → 한 객체의 `create_signed_url` 가 빈 응답이면 503 으로 전체 GET 실패(유효 영상까지 숨김). 서명은 경로 기반이라 유효 행은 실패 거의 없음(드문 견고성). 해소 시 per-image try/except + null 서명 URL 강등(스키마 optional 화 동반).
- **장비 배정 시 status(available) 미강제** [api/app/core/db.py:378-392] — `call_perform_examination` 가 `is_active` 만 검사하고 `status`(available/in_use/maintenance)는 미검사 → 점검중/사용중 장비도 직접 API 로 배정 가능(웹 `<option disabled>` 가 1차선). 스펙은 `is_active` 만 요구·`equipment.status`=상태머신 아님(0015)·배정이 장비 상태를 바꾸지 않음. 장비 가용성 정책 강화 시 `status='available'` 조건 추가.
- **웹: 업로드 중 검사 전환 레이스** [web/src/components/radiology/capture-panel.tsx] — `handleFiles` 가 클로저 `examinationId` 로 순차 업로드 중 사용자가 다른 검사 선택 시, 남은 파일이 이전 검사로 업로드되고 패널은 새 검사를 표시(abort/ref 가드 없음). 저빈도(업로드 빠름)·복잡도. 해소 시 AbortController 또는 examinationId ref 가드.
- **웹: 서명 URL 만료(5분) 시 깨진 썸네일** [web/src/components/radiology/capture-panel.tsx] — `<img src={signed_url}>` 에 `onError` 폴백·만료 재서명 없음 → 캡처 패널 5분 초과 노출 후 재요청 시 깨진 이미지. UX 견고성·스펙 외. 해소 시 `onError → loadImages()` 재서명 루프.

## Deferred from: code review of 5-10-수가-자동발생-트리거-가동 (2026-06-23)

- **만료·비활성 fee_schedule 도 그대로 수가 적재(유효기간 미검사)** [supabase/migrations/0021_billing.sql `insert_fee_item`] — 적재 헬퍼가 `select * into v_fee from fee_schedules where id = p_fee_schedule_id` 로 `id` 만 룩업 → `is_active`·`effective_from`·`effective_to` 미검사(Edge Case Hunter 실 DB 실증: AA254 를 `effective_to=어제`/`is_active=false` 로 만들어도 12590 적재). 0007 "현재 유효" 계약 위반 → 만료/폐지 EDI 코드가 stale 금액으로 청구될 수 있다. **5.1 defer③ "신규 FK active/effective 마스터 불변식 DB 미강제"의 직접 연장**(5.3·5.4 가 `insert_examination`/`insert_treatment_order` 에 동일 갭 기록·`drug_id`/`fee_schedule_id` 전 FK 묶음). "적재 시점 스냅샷" 의도와 양립 가능하나 "만료 수가 신규 적재 제외"가 정석 → 마스터 불변식 일관 정책 스토리에서 일괄(Epic 7 본인부담 산정 전 결정). Blind+Edge Hunter.
- **종결(completed/cancelled) 내원에 검사·처치 수행 시 수가 적재** [supabase/migrations/0021_billing.sql `fee_on_examination_performed`·`fee_on_treatment_performed`] — 적재 트리거가 examination/treatment 상태머신만 보고 `encounter.status` 를 검사하지 않음(Edge 실증: 내원 completed 후 exam perform → 수가 적재). **기존 "오더-by-내원상태 게이트(완료/취소 내원에 오더 차단)" 이월(5.1~5.9 반복 추적)의 연장**. by-design 개연(FR-119 부분수행=in_progress→completed 후 수행분 정산). 오더-by-내원상태 게이트 정책 스토리에서 일괄. Edge Hunter.
- **`amount_krw = quantity * unit_amount_krw` 불변식 CHECK 없음** [supabase/migrations/0021_billing.sql `fee_items`] — 컬럼 주석은 `amount_krw = quantity * unit_amount_krw` 라 명시하나 CHECK 는 각각 `>= 0` 만 강제. 5.10 은 `quantity` 항상 1(헬퍼가 일관 적재)이라 무영향이나, Epic 7 에서 quantity 가변·직접 UPDATE(service_role) 경로 도입 시 `amount<>quantity*unit` 불일치 행이 막히지 않는다. Epic 7 quantity 도입 시 `check (amount_krw = quantity * unit_amount_krw)` 추가. Blind Hunter.

## Deferred from: code review of 6-8-휴진-시-영향-예약-재배정 (2026-06-23)

- **다중 reschedule 시 재배정 안내(`reschedule_notice`) 재발송 불가** [api/app/services/notification.py `record_change_notice`·supabase/migrations/0035 `UNIQUE(appointment_id, reminder_kind)`] — 같은 예약을 2회 이상 재배정하면 2회차 `reschedule_notice` INSERT 가 멱등 충돌(`ON CONFLICT DO NOTHING`→None)로 드롭 → 환자가 최종 변경 시각을 통지받지 못한다. AC3 "1건 기록"엔 부합하나 실세계 재-재배정 통지엔 한계. **6.6 deferred "reschedule 후 새 날짜 재-리마인더 미발화"와 동일 근원**(notification_logs = append-only by grant·UPDATE 불가·종류별 1건 멱등). 해소: 실 SMS 전환 시 통지 키에 시퀀스/시각 포함하거나 변경통지를 멱등 대상에서 분리. Blind+Edge Hunter.
- **cross-doctor reschedule department_id 동기화가 home 진료과(`users.department_id`) 기준 — 다중 진료과·NULL home 의사 정합 미보장** [api/app/core/db.py `reschedule_appointment`] — 6.8 이 의사 변경 시 새 의사 home 진료과로 department_id 동기화(line294 청산)하나, 의사가 home≠근무 슬롯 진료과(다중 진료과)거나 home=NULL 이면 appointment.department_id 가 실제 슬롯 진료과와 불일치할 수 있다. **현 web UI 는 같은 진료과 피커(`bookable-doctors(department_id)`)로 제한해 미도달·직접 API 만 노출.** **기존 line302 `_assert_doctor_in_department` 멤버십 검증 이월과 동일 근원**(home-dept 기준은 booking 시스템 전반 관례·6.8 가 악화시키지 않음) → 교차-의사/진료과 정합 가드 착수 시 일괄 해소. Blind+Edge Hunter.
- **변경 안내 기록 실패가 best-effort(silent) — 직원 무신호** [web/src/components/admin/affected-appointments-panel.tsx `pick`/`confirm`] — `recordChangeNotice(...).catch(()=>{})` 로 통지 기록 실패 시에도 행이 해소(목록 제거)되어 직원이 환자 미통지를 인지하지 못한다(design decision 6: best-effort·예약 변경은 권위 액션이라 통지 실패가 되돌리지 않음). **통지=시뮬 로그라 현재 저영향.** 실 SMS 게이트웨이 전환 시 통지-실패 인디케이터(토스트/배지)·재시도 필요. Blind Hunter.

## Deferred from: code review of 5-9-영상-판독-검사-오더-완료 (2026-06-22)

- **판독 워크리스트 cross-day/완료내원 미판독 영상 누락** [api/app/core/db.py `fetch_reading_worklist`] — 날짜 필터가 `(e.created_at at time zone 'Asia/Seoul')::date = today` + `e.status in ('registered','in_progress')` 기준 → ① 자정 넘긴(전날 등록·오늘 수행) 영상검사 ② 내원이 completed/cancelled 로 종결된 뒤 남은 미판독(performed) 영상이 판독 워크리스트에서 사라져 읽을 경로가 없다(오더가 performed 에 고착 가능). **스토리 명시 defer**(Story 5.9 Task 3 "5.8 parity — cross-day/완료내원 판독 큐는 defer"). 5.8 `fetch_radiology_worklist` 동일 패턴. 해소: 워크리스트 일자 축을 `ex.performed_at` 기준으로 전환 + 내원 종결과 무관한 "미판독 영상" 전용 큐 노출. Blind+Edge Hunter.
- **판독 지연 배지 nowMs 고정 시계** [web/src/components/doctor/reading-worklist-page.tsx] — `setNowMs(Date.now())` 가 마운트 시 1회만 세팅되고 갱신 안 됨(loadWorklist 재로드 시에도 미갱신) → 화면을 장시간 열어두면 "판독 지연 N분" 배지(UX-DR21 ⑥)가 굳어 실제 경과를 반영하지 못한다. **5.8 `radiology-worklist-page.tsx` 동일 패턴(pre-existing)** — 5.9 신규 결함 아님. 해소(repo-wide): nowMs 를 interval/loadWorklist 시 갱신. Blind Hunter.

## Deferred from: code review of 7-1-수납-스키마-수가-매핑-db (2026-06-23)

> 3레이어 적대 리뷰. Acceptance Auditor: AC1~AC10 SATISFIED·이월 흡수 2건(L344/L346) 정상·경계 준수·High/Med 위반 0. patch 2(copay_rate 범위 CHECK·staff RLS 테스트 격리) 적용. 아래는 defer.

- **만료 분기 진찰료 silent skip·폴백 무치환** [supabase/migrations/0045_payments.sql `insert_fee_item`·`fee_on_encounter_start`] — `fee_on_encounter_start` 이 재진(`encounter_start_repeat`→AA254)을 선택해도 `insert_fee_item` 이 AA254 만료/비활성 시 적재 0(no-op)·다른 분기(초진 AA154)나 레거시로 치환하지 않는다(Edge High). 그러나 이는 **AC4 명세 동작**(만료 수가 신규 적재 제외=정석·만료 코드를 다른 코드로 치환=청구 위조). 시드는 AA154/AA254 둘 다 무기한 유효(effective_to null)라 정상 경로 미발현. 폴백은 분기 매핑 *행 부재* 시에만 발동(만료는 행 존재) → 두 가드(매핑-null 폴백 vs fee-만료 skip)가 다른 레이어라 미합성(Edge Med). **5.10 `insert_fee_item` no-op 설계의 연장** — 관측성(skipped accrual fail-loud 신호) 보강은 마스터 불변식/수납 정합 하드닝에서. Blind+Edge Hunter.
- **동시 첫 내원 2건 → 둘 다 초진(prior-completed exists 레이스)** [supabase/migrations/0045_payments.sql `fee_on_encounter_start`] — `exists(... status='completed')` 판정이 잠금 없음 → 같은 환자 첫 내원 2건 병렬 진찰 시작 시 둘 다 이력 0=초진 적재. **동시성=DB 최종선·이월 지속**(Epic 4 결정 계승) — 단일 외래 walk-in 빈도 낮음. 직렬화 가드(advisory lock 등) 도입 시 일괄. Edge Hunter.
- **payments status↔finalize/cancel 컬럼 일관성 CHECK 부재** [supabase/migrations/0045_payments.sql `payments`] — `status='finalized'` 인데 `finalized_at`/`payment_no` NULL, `cancelled` 인데 `cancel_reason` NULL, `draft` 인데 finalize 컬럼 세팅 등을 막는 partial CHECK 없음. **finalize 전이·결제 기록은 7.4 소관** — 7.4 가 상태 전이 게이트(또는 partial CHECK)로 일관성 강제. Edge Med·Blind Low.
  - **🟢 finalized 부분 해소(Story 7.4 — 2026-06-24):** `0048` `payments_finalized_consistency` CHECK 추가 — `status='finalized'` 면 `payment_no`·`finalized_at`·`finalized_by`·`payment_method` 모두 NOT NULL 강제(부분 finalize 차단). `finalize_payment`(0048)가 전이 게이트로 네 컬럼을 원자 기록. **잔여 이월**: cancelled 컬럼 일관성(`cancelled_at`/`cancel_reason`) CHECK = 7.9(취소 로직 미구현)·draft 가 finalize 컬럼을 갖는 경우 미강제(역방향).
- **header 금액 = Σ(payment_details) 정합 불변식 부재** [supabase/migrations/0045_payments.sql `payments`] — 헤더 6 금액 컬럼(total/covered/copay/insurer…)이 라인 합과 발산 가능(교차테이블 불변식·CHECK 단일테이블 한계). `total = covered+non_covered`, `copay+insurer = covered` 등 미강제. **집계=7.2·본인부담 산정=7.3** 가 채우며 정합 책임. 7.2/7.3 적재 경로에서 재검증 또는 derived 뷰 검토. Edge Med·Blind Low.
  - **🟢 부분 해소(Story 7.2/7.3 — 2026-06-23):** `total=covered+non_covered`는 7.2 `build_payment` 롤업이, 라인 `amount=copay+insurer`·헤더 `total=copay+insurer`는 7.3 `price_payment`(0047)가 적재 경로에서 보증(DB 테스트 단언). **잔여 이월**: 교차테이블 정합을 *제약/트리거/derived 뷰로 강제*하진 않음(적재 경로 보증만) — service_role 직접 UPDATE 시 발산 가능. 또한 fee_item 철회 시 stale payment_detail 동기화(append-only)는 미해소(오더 철회 흐름 정의 시).
- **encounter_id UNIQUE 가 취소 후 재청구 차단** [supabase/migrations/0045_payments.sql `payments`] — `cancelled` payment 가 내원당 1:1 UNIQUE 슬롯을 점유 → 동일 내원 재정산 INSERT 시 23505. **7.9 취소·노쇼 재정산** 이 재청구 시맨틱(취소 행 재사용 vs 부분 unique vs 재오픈) 결정. 현 1:1 은 7.1 의도(외래 1내원=1수납). Edge Hunter.
- **익명 수기 라인 가능(fee_item_id·name·code·fee_schedule_id 전부 nullable)** [supabase/migrations/0045_payments.sql `payment_details`] — 수기 라인(`fee_item_id` null)이 name/code 없이 금액만으로 INSERT 가능 → 영수증(7.5)에 설명 없는 청구 라인. **수기 라인 기능(7.x 가산·노쇼료 7.9)** 도입 시 최소 필드 요건(`name not null or fee_item_id not null` 류) 정의. Edge Hunter.
  - **🟢 확인(Story 7.5 — 2026-06-24):** 영수증(7.5)은 자동 집계 라인만 소비하고 현재 자동 라인은 `build_payment`(0046)이 `fee_schedules` 에서 code/name/category 를 스냅샷 적재하므로 익명 라인 없음(영수증 항목별 금액표는 category 그룹핑·미분류 라인은 "기타"로 안전 처리). 수기 라인 기능(7.x) 도입 시 최소 필드 요건을 같이 정의.
- **late-perform 만료 skip(주문 시 유효·수행 시 만료)** [supabase/migrations/0045_payments.sql `insert_fee_item`] — 검사/처치가 fee 유효일에 주문되고 `effective_to` 이후 수행되면 `perform_*` 트리거의 `insert_fee_item` 이 current_date 기준 만료 판정 → 수행 행위에 0 적재. **AC4 적재 시점 검증 by-design**(주문이 아닌 적재=수행 시점 유효성)·`current_date` TZ 는 0007 "현재 유효" 계약과 일관(Edge 확인). 행위 시점 가격 보존이 필요하면 주문 시점 fee 스냅샷 모델 검토. Edge Low.

## Deferred from: code review of 7-2-수납-건-생성-집계 (2026-06-23)

- **append-only 재집계 — 적재된 fee_item 철회/수정 미반영** [supabase/migrations/0046_payment_aggregation.sql `build_payment`·api/app/core/db.py `fetch_billing_worklist`] — `build_payment`은 `on conflict (payment_id,fee_item_id) do nothing`으로 신규만 추가하고 헤더 롤업은 `payment_details`(스냅샷) 합 → fee_item이 철회/수정되면 stale `payment_details` 라인이 잔존하고 하향 정정이 미반영(과청구 가능). 워크리스트 `estimated_total_krw`(라이브 Σ fee_items)와 상세 화면 총액(frozen payment_details)이 발산. **AC12 ④ 명시 이월**(fee_item 철회 동기화=오더 철회 흐름 정의 시). 현 시스템에 fee_item 제거/취소 흐름이 없어 append-only가 현 도달 상태에서는 정합. 해소: 오더 철회 흐름 도입 시 payment_details 재동기화(soft-delete 라인 또는 재빌드 시 orphan 정리) + 워크리스트/상세 총액 출처 통일.
- **내원 상태 무관 빌드 — cancelled/no_show/soft-deleted 도 draft 수납 생성** [supabase/migrations/0046_payment_aggregation.sql `build_payment`·api/app/core/db.py `build_payment` 존재검사] — `build_payment`은 내원 존재만 검사하고 status/is_active 게이트가 없어 직접 URL로 cancelled·no_show·is_active=false 내원에도 draft 헤더+집계를 생성. **AC12 ① 이월**(취소·노쇼 수가 미발생=Story 7.9). 워크리스트가 in_progress만 노출하여 정상 경로에서는 회피되고 draft는 finalize 전이라 CASCADE 정리 가능. 해소: 7.9에서 종결(cancelled/no_show) 내원 early-return(수가 미발생) + soft-deleted 내원 빌드 차단.
- **React 효과 취소 미적용 — fast-nav 시 stale 응답 노출 가능** [web/src/components/reception/billing-detail.tsx·billing-worklist.tsx] — `load()` await 후 무조건 setState(AbortController/ignore 플래그 없음). 빠른 내원 전환(A→B) 시 A의 느린 응답이 B 마운트 후 도착해 B 화면에 A 데이터를 잠깐 노출하거나 언마운트 후 setState 경고 가능. **기존 코드베이스 전역 패턴**(order-panel·reading-worklist 동형)으로 7.2 고유 결함 아님. 해소: 컨벤션 차원의 cancellation 가드(ignore 플래그/AbortController) 도입 시 일괄 적용.
- **워크리스트 페이지네이션 드리프트 + KST created_at 자정 경계** [api/app/core/db.py `fetch_billing_worklist`] — OFFSET 페이지네이션과 별도 COUNT가 동시 쓰기 중 드리프트 가능(meta.total↔data 행 불일치)·일자 필터가 `created_at` KST라 자정 넘긴 진료는 등록일 기준으로 버킷. fetch_encounters 패턴 미러이고 정산 워크리스트 규모(today·in_progress·page_size 200/500)에서 무시 가능. 해소: 규모 증가 시 keyset 페이지네이션·일자 기준 컬럼 재검토(consult 기준 vs 등록 기준).

## Deferred from: code review of 7-3-급여-비급여-구분-본인부담-산정 (2026-06-23)

> 3레이어 적대 리뷰. Acceptance Auditor: AC1~AC10 SATISFIED·High/Med 0·스코프 누수 0. patch 1(copay_policies 쓰기거부 테스트) 적용. 아래는 defer.

- **copay_policies 행 누락 시 silent 100% 과청구(coalesce 1.0 폴백)** [supabase/migrations/0047_payment_pricing.sql `price_payment`] — 라인 요율 룩업이 `coalesce((select copay_rate from copay_policies where insurance_type=v_insurance_type and coverage_type=...), 1.0)` → 정책 행이 없으면 100% 환자부담으로 silent 적재. 현재 8행(보험유형 4×급여구분 2) 시드 + `insurance_type`/`coverage_type` CHECK 로 **도달불가**이고, 폴백 1.0 은 **의도된 보수적 설계**(미청구 방지). 그러나 `patients.insurance_type` enum 확장(또는 시드 행 삭제) 시 해당 유형의 급여 라인이 전부 silent 100% 과청구된다(로그/알림 없음). 해소: 정책 행 부재 시 `RAISE EXCEPTION`(fail-loud) 또는 NOT NULL inner join 으로 전환 — enum 확장 하드닝 스토리에서. Blind Low·Edge Med.
- **동시 build→price(같은 내원) row-lock 부재** [supabase/migrations/0047_payment_pricing.sql `price_payment`·api/app/core/db.py `build_payment`] — 같은 내원에 동시 `POST .../payment` 2건이 모두 `status='draft'` 가드를 통과해 라인 UPDATE + 헤더 롤업을 수행. change-guard 로 최종 수렴 상태는 정확하나, 두 커밋 사이를 읽는 관찰자는 헤더 copay/insurer ↔ 라인 합의 일시 발산을 볼 수 있다. **7.2 동시성 이월 계승**(DB 최종선·단일 원무·낮은 빈도). 해소: 함수 진입 시 `select ... for update` 로 payment 행 잠금(Epic 4 "동시성=DB 최종선" 이월과 동류). Edge Low.
- **finalize-before-price 시 copay 0 동결** [supabase/migrations/0047_payment_pricing.sql `price_payment` status 가드] — `price_payment` 는 `status≠'draft'` 면 early-return 하므로, 비정상 순서로 price 실행 전에 payment 가 finalized/cancelled 로 전이되면 copay/insurer 가 0 인 채 영속(total>0). 현 흐름은 build→price 가 항상 함께 실행되어 도달불가이나 7.3 자체엔 순서 강제가 없다. **7.4 소관**(finalize 전 price 선행/순서 보장). 해소: 7.4 의 finalize 게이트가 price 완료(또는 build→price 재실행)를 선행 조건으로 강제. Edge Low.
  - **🟢 해소(Story 7.4 — 2026-06-24):** `db.finalize_payment` `_op` 가 `build_payment`→`price_payment`→`finalize_payment` 를 한 트랜잭션으로 호출 — price 가 finalize 직전 항상 재실행되어 신선 산정 보장(draft 라 build/price 동작·finalize 후 status≠draft no-op). 비정상 순서 도달불가.

## Deferred from: code review of 7-4-수납-처리-내원-완료 (2026-06-24)

> 3레이어 적대 리뷰. Acceptance Auditor: AC1~AC10 SATISFIED·스코프 누수 0·미구현 0. patch 2(AC8 web 테스트 placeholder 단언·double_409 불변 단언) 적용. 아래는 defer.

- **finalized_by app.actor_id GUC 미설정 시 NULL→CHECK 위반 롤백(fail-loud 가드 부재)** [supabase/migrations/0048_payment_finalize.sql `finalize_payment`] — `finalized_by = nullif(current_setting('app.actor_id', true),'')::uuid` 가 GUC 부재 시 NULL → `payments_finalized_consistency` CHECK(finalized_by NOT NULL) 위반으로 함수 전체 롤백. **`authenticated_conn`(db.py L114-130)이 항상 `app.actor_id` 세팅**하므로 정상 경로(FastAPI) 미발생이고, CHECK 가 fail-safe(비일관 행 차단). 다만 직접 service_role 호출 시 혼란스러운 CHECK-위반 메시지로 표면화. 해소: 함수 진입 시 actor null 명시 `raise`(친절한 에러). Blind+Edge Med.
- **total=0 빈 내원 ↔ 비-draft 이중결제가 동일 PT409→invalid_transition 메시지로 뭉개짐** [supabase/migrations/0048_payment_finalize.sql `finalize_payment`·web billing-detail.tsx `finalizeErrorMessage`] — 두 서로 다른 PT409 원인(`no billable items` vs `invalid payment transition`)이 동일 errcode → 동일 `invalid_transition` code → 사용자는 "이미 처리되었거나 정산할 수 없는 수납입니다" 만 봄(구분 불가). 정상 경로 미발생(in_progress=진찰료 ≥1·5.10). 해소: 빈 내원에 별도 errcode/메시지 분리. Blind+Edge Low.
- **payments_finalized_consistency CHECK 가 paid=copay 불변식 미강제** [supabase/migrations/0048_payment_finalize.sql `payments` CHECK] — CHECK 는 finalized→payment_no/finalized_at/by/method NOT NULL 만 강제. 설계 결정 ③의 `paid_amount_krw = copay_amount_krw`(전액 정산) 핵심 불변식은 미강제 → service_role 직접 UPDATE 로 `paid=0` 인 finalized 행 생성 가능(미수금인데 완료). deferred-work L366 잔여 클래스(교차컬럼 불변식=적재경로 보증만·제약 미강제). 해소: 적재경로(finalize_payment) 보증 외 derived 뷰/제약 검토. Blind Low.
- **의사 4.7 선완료 후 reception finalize → complete_encounter PT409 결제 영구불가** [supabase/migrations/0048_payment_finalize.sql `finalize_payment` perform complete_encounter] — 의사가 4.7 `POST /encounters/{id}/complete` 로 내원을 먼저 completed 전이하면, 그 내원의 finalize 시 payment 는 draft 라 가드 통과 후 `complete_encounter` 가 비-in_progress PT409 → 결제 불가(데드락). **billing-completes 모델 엣지**: 워크리스트가 in_progress 만 노출 → completed 내원은 billing-detail 미도달(UI 도달 불가)·AC10 완료 모델에 문서화. 해소: 완료 주체 단일화 정책(의사 complete 비활성 또는 finalize 가 completed 도 수용) 시 일괄. Edge(워크리스트 필터로 실질 도달불가).
- **ConfirmDialog confirm 버튼이 finalizing 중 disabled 아님** [web billing-detail.tsx·components/admin/confirm-dialog.tsx] — finalize 트리거(외부) 버튼은 `disabled={finalizing}` 이나 실제 호출은 공유 `ConfirmDialog` 의 confirm 버튼이며 그 버튼은 finalizing 을 모른다(disabled prop 없음). `handleFinalize` 의 `if (finalizing) return` 동기 가드 + React state 비동기 사이 연타 윈도우에 2차 호출 가능. 서버 PT409·성공 시 다이얼로그 닫힘이 최종 방어선. 해소: ConfirmDialog 에 `confirmDisabled` prop 도입(공유 컴포넌트 — 일괄). Blind+Edge Low.
- **동시 finalize — build/price 가 for-update 락 선행 없이 실행** [api/app/core/db.py `finalize_payment` _op] — `_op` 가 finalize_payment(내부 `for update`) 호출 *이전* 에 build_payment/price_payment 를 락 없이 실행 → 동시 finalize 2건이 둘 다 build/price 통과 후 한쪽만 finalize 락 획득(다른쪽 PT409). 두 커밋 사이 관찰자 발산 가능. **7.2/7.3 동시성 이월 계승**(단일 원무·낮은 빈도·DB 최종선)·finalize for-update + status 가드가 이중결제(비가역)는 차단. 해소: build 직전 payment 행 `for update` 선점(7.2/7.3 row-lock 이월과 일괄). Blind+Edge Low.
- **cancelled 상태 수납 상세 진입 시 결제 섹션 빈 화면** [web billing-detail.tsx status 분기] — status 분기가 draft/finalized/null 만 처리 → cancelled 는 null(결제 섹션 전체 미렌더·신원배지만 "취소"·안내 없는 빈 영역). 취소 로직=7.9 소관·워크리스트 in_progress 미노출로 현재 도달 불가. 해소: 7.9 에서 cancelled 안내 패널. Edge Low.

## Deferred from: dev of 7-5-진료비-계산서-영수증-출력 (2026-06-24)

> 설계 결정(사용자 확정·AskUserQuestion 4건): 브라우저 인쇄·시드 1행 clinic_profile·전용 receipt+export 엔드포인트·masked RRN 만. 아래는 스코프 밖으로 미룬 신규 이월.

- **영수증 full RRN reveal 문서 렌더 미구현(masked only)** [web receipt-document.tsx·api fetch_receipt] — 영수증은 `resident_no_masked`(710314-2******)만 렌더하고 full 주민번호 reveal(권한 게이트+감사+사유) 문서 렌더는 미구현(설계 결정 ④). UX-DR22 clinical-safety 권고("문서 full RRN=감사 reveal 이벤트")의 완전 충족은 후속. **연락처 PII reveal 이월(L39 묶음)** 과 동일 클래스 — 전용 reveal-하드닝 스토리에서 문서 full RRN reveal(`reveal_rrn` 재사용 + 문서 내보내기 감사 결합)로 일괄. 인쇄/내보내기 자체는 이미 감사(`log_payment_document_export`).
- **서버측 영수증 PDF 생성 미구현(브라우저 인쇄 채택)** [설계 결정 ①] — `window.print()` + `@media print`(Batang serif)로 인쇄/PDF 저장. 아키텍처 `services/document_service(진료비 PDF)` 언급이나 신규 라이브러리(weasyprint/reportlab)·픽셀 일관성 필요 시 도입(project-context "신규 라이브러리 임의 추가 금지"). 배치 출력(여러 영수증 일괄 PDF)·서버 보관(감사용 PDF 스냅샷)이 요구되면 서버 렌더링 스토리에서.
- **clinic_profile 관리 UI 부재(seed 만)** [supabase/seed.sql·0049 clinic_profile] — 요양기관 정보가 seed 1행으로만 존재(관리자 편집 화면 없음·설계 결정 ②). 운영 중 병원 정보 변경은 DB 직접 UPDATE 필요. 마스터 관리 화면(Epic 2 패턴) 확장 시 clinic_profile CRUD(단일행 편집)를 추가.
- **브라우저 인쇄 파일명 PII 강제 불가(document.title 완화만)** [web billing-detail.tsx beforeprint] — 미리보기 열림 시 `document.title=영수증_{chart_no}`(불투명 식별자)로 브라우저 PDF 기본 파일명을 PII-free 로 설정하나, 사용자가 저장 다이얼로그에서 파일명을 임의 변경(이름 등 입력)하는 것은 막을 수 없다(브라우저 소관). 라우트·문서 제목·title 에 PII 미포함은 보장. 서버측 PDF 도입 시 파일명 완전 통제 가능.

## Deferred from: code review of 7-5-진료비-계산서-영수증-출력 (2026-06-24)

> 3레이어 적대 리뷰. Acceptance Auditor: AC1~AC12 SATISFIED·위반 0·스코프 누수 0. patch 2(소계 자기정합·export finalized 게이트) 적용. 아래는 defer.

- **`due_amount_krw = copay - paid` 음수 방어 부재** [api/app/core/db.py `fetch_receipt`·web receipt-document.tsx] — 납부할 금액을 `copay-paid` 로 산출하나 `max(0,...)`·환급 분기 없음. 7.4 전액정산(`paid=copay` 강제·finalize 후 copay 동결)으로 `due=0` 고정 → **현 스코프 도달불가**. 부분/선수납(7.8)·과오납·취소 환급(7.9)에서 `paid>copay` 가능 시 음수 "납부할 금액"이 법정 영수증에 출력될 수 있다. 해소: 7.8/7.9 에서 음수=환급(별도 표시) vs `max(0)` 정책 결정. Blind Med.
- **클라 내보내기 감사 best-effort(비차단·비발화/복수발화 가능)** [web billing-detail.tsx `beforeprint` 리스너·`exportReceipt` fire-and-forget] — `void exportReceipt(...).catch(()=>{})` + `beforeprint` 는 인쇄를 동기 차단 못 함 → 감사 POST 실패(403/네트워크)해도 인쇄/PDF 진행, 브라우저별 `beforeprint` 비발화/복수발화로 "각 인쇄 1감사" 1:1 미보장(UX-DR22 best-effort 약화). 감사 RPC 는 payment.read 게이트라 정상 사용자 403 비현실적·인쇄 자체는 클라 행위. 해소: **서버측 PDF 생성**(dev of 7-5 이월) 도입 시 export 가 server-authoritative(생성=감사 원자). Blind+Edge Med.
- **clinic_profile 행이 seed.sql 만 적재(마이그 미임베드)** [supabase/migrations/0049_payment_receipt.sql·supabase/seed.sql] — 테이블 DDL 은 0049, 데이터 1행은 seed.sql 분리 → 마이그만 적용하고 seed 미실행한 환경은 `clinic is None` → 모든 영수증 500(fail-loud·AC3 의도). 설계 결정 ②(seed 1행·관리 UI 없음)·프로젝트 배포는 항상 `db reset`(마이그+seed) 실행이라 정상 경로 미발생. 해소: 마이그에 기본 clinic_profile INSERT 임베드(마이그-only 배포 하드닝) 또는 clinic_profile 관리 UI(dev of 7-5 이월) 도입 시 함께. Blind Low.

## Deferred from: dev of 7-6-진료비-세부산정내역서-출력 (2026-06-24)

> 설계 결정(사용자 확정·AskUserQuestion 3건): ① 데이터=receipt 엔드포인트(ReceiptResponse) 재사용 ② UI=문서 탭 토글 ③ 일자=진료일·일수=1. 7.6 은 마이그 0·엔드포인트 0·권한 0·라이브러리 0(7.5 인프라 재사용). 아래는 스코프 밖으로 미룬 신규 이월.
>
> **확인(7.6)**: L371-372 익명 수기 라인→세부내역서(자동 라인 전부 code/name·익명 없음·7.5와 동일) · L407 full RRN 문서 reveal(세부내역서도 masked only·동일 이월 묶음) · dev of 7-5 서버측 PDF(L408)/파일명 PII(L410) 이월은 세부내역서에도 동일 적용(브라우저 인쇄·beforeprint 공유). dev of 7-5 음수 due(L416)는 세부내역서엔 무관(세부내역서는 납부 3행 없음·라인 합만).

- **라인별 임상 일자/일수 미보유(진료일·1 고정)** [supabase/migrations/0021_billing.sql `fee_items`·0045 `payment_details`·web statement-document.tsx] — 세부산정내역서 FR-114 의 "일자·일수" 컬럼을 내원 진료일(`encounter.treatment_started_on`·KST·전 라인 동일)과 1(상수)로 채운다. `fee_items`/`payment_details` 에 라인별 임상 수행 날짜(`created_at`=집계시각)·투약/입원 일수 컬럼이 없기 때문(외래 단일내원 모델·약제비=원외 스코프아웃이라 투약일수 무의미). **다일 진료·입원·다회 방문 청구**가 도입되면 `payment_details`(+`build_payment`·`fee_items`)에 `service_date`·`days` 컬럼 추가(마이그·Epic 5 적재 경로 재작업)해 라인별 실제 일자/일수를 산정. 설계 결정 ③.
- **세부산정내역서 급여/비급여 구분 소계 부재(합계 1행만)** [web statement-document.tsx] — 현재 tfoot 은 전 라인 단일 합계(Σ금액·Σ본인부담·Σ공단부담)만 렌더. 표준 양식 일부는 급여/비급여 구분 소계 또는 항목분류별 중간 소계를 둔다. FR-114 는 "라인별 + 10컬럼"만 요구해 범위 밖(스코프 규율) — 영수증(7.5)의 대분류 집계표가 이미 구분 합계를 제공. 양식 정교화 요구 시 구분/그룹 소계 행 추가.

## Deferred from: dev of 7-7-원외처방전-출력-발급 (2026-06-24)

> 설계 결정(사용자 확정·AskUserQuestion 4건): ① 발급=명시적 "발급 확정" 버튼(인쇄=감사·발급=상태전이 분리·비가역 1방향) ② 권한=`prescription.dispense` 신규(payment.read 재사용 안 함) ③ 진입=수납 화면 처방전 섹션(finalize 무관) ④ 발급자=감사로그 actor만(`dispensed_by` 컬럼 없음). 7.7 은 마이그 1건(0050)·신규 권한 1·라이브러리 0. 0015 처방 상태머신 재사용(재정의 0).
>
> **청산(7.7)**: 위 L263 `issued→dispensed` 전이 권한 게이트 부재(5.1 이월) = `dispense_prescription` RPC + `prescription.dispense` 권한으로 해소.
>
> **확인(7.7)**: full RRN 문서 reveal(L407)=처방전도 masked only(동일 이월 묶음) · dev of 7-5 서버측 PDF(L408)/파일명 PII(L410) 이월은 처방전에도 동일 적용(브라우저 인쇄·beforeprint 감사 공유) · 클라 내보내기 감사 best-effort(L417)=처방전 beforeprint 도 동일 메커니즘(7.7 신규 아님).

- **교부번호 저장 시퀀스 부재(파생 표시)** [web prescription-document.tsx `issueNo`·api fetch_prescription_document] — 원외처방전의 교부번호를 처방 식별자 기반 파생값(`RX-{prescription_id[:8]}`·불투명·PII 없음·결정론적)으로 표시한다. 정식 법정 교부번호는 채번 시퀀스(요양기관·일자별 일련번호, `payment_no_seq`(0048) 류)가 통상이나 외래 데모 스코프엔 과함. **다기관·청구 연동·정식 교부번호 요구 시** `prescription_no_seq` 시퀀스 + `prescriptions.dispense_no` 컬럼(발급 시 채번) 추가(마이그). 현 파생 표시는 단일 요양기관 데모에 충분.
- **처방전 재발급/재인쇄 정책 부재** [supabase/migrations/0050·web billing-detail.tsx] — 발급은 `issued→dispensed` 1방향(0015 트리거가 역행·재전이 PT409 차단). 이미 발급된 처방의 **재발급**(예: 환자 분실 재교부)·발급 취소 경로는 없다. 출력(인쇄)은 발행/발급 무관 자유(인쇄=감사만·상태 무변경)이므로 재인쇄는 가능하나 별도 "재발급" 도장/일련번호 갱신은 미지원. 재발급 정책(새 교부번호·감사 사유) 요구 시 별도 액션·상태 모델 확장. 현 모델=1회 발급(원외 약국 제출).
- **사용기간 상수(교부일로부터 3일 고정)** [web prescription-document.tsx] — 처방전 사용기간을 상수 "교부일로부터 3일"로 표시(한국 표준 처방전 일반값). 실제 사용기간은 처방 의약품·질환·의사 판단에 따라 가변(통상 3~7일·장기처방 별도). 사용기간 정책화(처방 헤더 컬럼 또는 `clinic_profile` 기본값 + 처방별 오버라이드) 요구 시 입력 UI(5.2 처방 발행)·컬럼·문서 렌더 연동. 현 상수는 데모 충분.
- **처방 의사 면허번호 데모 시드값** [supabase/seed.sql 데모 의사 EMP0002 `license_no='12345'`] — 원외처방전 법정 서식의 처방 의료인 면허번호를 데모 의사에 시드값(12345)으로 채운다(처방전이 "—" 없이 완성되도록). 실제 직원 면허 관리 UI(입력·검증)는 스코프 밖(Story 1.8 직원 계정 관리의 확장 후보) — 현재 면허번호는 seed/DB 직접 설정만. 면허번호 미설정 의사의 처방전은 면허번호 "—" 표시(렌더는 정상·법적 완전성만 결여).

## Deferred from: code review of 7-7-원외처방전-출력-발급 (2026-06-24)

> 3레이어 적대적 리뷰(Blind·Edge·Auditor) 결과 patch 0·decision-needed 0·dismiss ~15. AC1~12 전부 SATISFIED·설계 결정 4건 준수. 아래는 by-design/엣지로 미룬 항목.

- **dispense/export RPC·`_require_prescription_owned` 가 `is_active` 미필터** [supabase/migrations/0050_prescription_dispense.sql `dispense_prescription`/`log_prescription_document_export`·api/app/core/db.py `_require_prescription_owned`] — 세 경로 모두 `prescriptions` 존재만 검사하고 `is_active`를 보지 않는다(`fetch_prescription_document` 는 `is_active=true` 만 노출). 소프트삭제(정정)된 처방이라도 직접 API(`POST .../{rid}/dispense`·`.../document/export`)로 `issued→dispensed` 전이·내보내기 감사가 가능하다(전이된 비활성 행은 문서에 안 보임). UI는 활성 처방 id만 surface 하므로 정상 경로 안전·직접 API/stale 탭 엣지. **기존 "오더 is_active/내원상태 게이트 미강제"(deferred dev of 5.2/5.3/5.4: L277/290/299·"마스터·내원 불변식 일관 정책 스토리"로 일괄)와 동일 클래스** → 그 스토리에서 dispense/export 도 함께 `and is_active = true` 가드 추가. Edge Low.
- **처방전 섹션이 build_payment 실패 시 미표시** [web/src/components/reception/billing-detail.tsx] — 처방전 섹션·발급 confirm 이 `payment !== null` 렌더 분기 안에 있어, `build_payment`(load) 실패/스켈레톤 상태에서는 `fetchPrescriptionDocument` 가 성공해도 섹션이 렌더되지 않는다. 설계 결정 ③ "finalize 무관"은 충족(draft payment 에서 노출·테스트됨)이나 "payment 로드 실패" 엣지는 결합. billing-detail 진입 = 수납 워크리스트(fee_items 있는 in_progress 내원)이고 build_payment 는 멱등이라 정상 경로 실패 희귀. 해소: 처방전 섹션을 payment 로드와 독립 렌더(또는 payment 실패 시 fallback). Edge Med(실 도달 낮음).
- **처방 문서 fetch 가 모든 에러를 무음 삼킴** [web/src/components/reception/billing-detail.tsx `loadPrescriptions`] — `try { setPrescriptionDoc(await fetch...) } catch { setPrescriptionDoc(null) }` 가 403(doctor·의도)뿐 아니라 500(`clinic_profile_missing` fail-loud)·네트워크 오류도 삼켜 섹션이 조용히 사라진다. best-effort 보조 fetch·clinic_profile 항상 시드(500=배포 misconfig·receipt 경로 handleOpenReceipt 가 toast 로 노출)이라 영향 낮음. 해소: 403/404만 무음·500은 surface(toast 또는 인디케이터). Blind Med.
