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
