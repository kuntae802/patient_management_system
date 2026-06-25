# Epic 3: 환자 등록·신원·검색 — 테스트 시나리오

## 에픽 개요

Epic 3은 PMS 신원 도메인의 핵심으로, 환자 레코드의 **생성(원무 직접 등록)·임상 프로필·보호자·앱 자가가입 자동연결·전역 검색·감사 마스킹**을 다룬다. 모든 쓰기는 FastAPI(service_role) 단일 경로로만 수행되며(authenticated 는 patients/guardians 쓰기 권한 0), 권한은 3계층(라우터 `require_permission` 게이트 → DB 동일-트랜잭션 `has_permission` 재평가[TOCTOU 차단] → RLS 방어심층)으로 강제된다. 주민번호(RRN)는 평문 미저장: `resident_no_enc`(pgcrypto 암호문)·`resident_no_hash`(HMAC blind index, UNIQUE 중복차단)·`resident_no_masked`(표시값) 3컬럼으로 분리되며, 복호(reveal)는 권한 게이트 + DB 강제 감사를 동반한다.

### ⚠️ 테스트 전 반드시 알아야 할 환경 특이점 (코드 검증 결과)

1. **`reception@pms.local`는 `patient.create`/`patient.read`/`patient.update` 권한이 전혀 없다(403 baseline).**
   - `seed.sql`에는 reception에 대한 patient.* grant 가 **존재하지 않는다**(0002는 admin만 전권, 4.5 grant는 doctor에게만 `patient.read`/`reveal_rrn`/`reveal_contact`를 준다).
   - 즉, 데모에서 **환자 생성·검색(Ctrl+K)·임상 프로필 입력·보호자 관리는 `admin@pms.local`로만 정상 동작**한다. reception 으로 시도하면 라우트 강등(`STAFF_HOME`) 또는 API 403.
   - 이는 메모리 [PMS 테스트 발견 백로그] Finding#1("원무 patient 권한 시드 누락")과 일치 — **버그 검증 시나리오로 포함**.
   - 과제 지시문의 "reception=환자 생성·검색·임상프로필 입력"은 **현 시드와 불일치**. 실제 가능 역할: admin(전부), doctor(read+reveal만, create/update 없음).

2. **데모 환자 20명은 전원 `auth_uid` = NULL(앱 미연결).** `demo_seed.sql`의 patients INSERT 컬럼 목록에 `auth_uid`가 없고(→NULL), 이후 UPDATE도 없다. 따라서 자가가입(3.4) 테스트는 **항상 미연결 상태에서 출발** → 정상 연결/멱등/충돌 분기를 자연스럽게 검증 가능.

3. **환자 앱 계정은 시드에 없다.** patient role 계정(@pms.local)이 seed.sql에 없음 → 자가가입 테스트는 반드시 `(auth)/signup`에서 신규 이메일/비번으로 가입 후 진행(`enable_confirmations=false` → 즉시 세션).

4. **RRN reveal/contact reveal 동작은 `demo_seed.sql` 적용에 의존.** demo_seed가 `encrypt_sensitive(rrn)`로 암호문을 채워야 복호가 성공한다. seed.sql만 적용하면 환자 0명이라 reveal 대상 없음. 또한 Vault 키는 `db reset` 시 재생성되므로, **암호화 시점(demo_seed 적용)과 복호 시점(reveal)의 키가 동일**해야 함(같은 DB 인스턴스 내에서는 보장).

5. **자가가입 자동연결 매칭 메커니즘**: `link_self_patient`은 입력 RRN을 `normalize_rrn`→`blind_index`로 해시한 뒤 `resident_no_hash`로 매칭. **성명 일치(`_norm_name`: NFC+공백정규화)가 시뮬 시대 사칭방지 1차선**. 연결 대상 `auth_uid`는 항상 JWT `sub`에서만 도출(클라가 patient_id/uid 제공 불가). 같은 sub 동시호출은 `pg_advisory_xact_lock`으로 직렬화.

6. **reveal RRN/contact 버튼은 환자 상세 페이지에 없다** — 진료 허브 배너(`components/encounters/patient-banner.tsx`, Epic 4.5)에 거주. 환자 상세(`/patients/{id}`)는 마스킹 RRN + 평문 연락처만 표시(reveal 없음). API 엔드포인트(`POST /v1/patients/{id}/reveal-rrn|reveal-contact`)는 직접 호출로 검증 가능.

### 데모 계정 권한 매트릭스 (Epic 3 관련, 코드 검증)

| 계정 | role | patient.create | patient.read | patient.update | reveal_rrn | reveal_contact | audit.read |
|---|---|---|---|---|---|---|---|
| admin@pms.local | admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| doctor@pms.local | doctor | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ |
| reception@pms.local | reception | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| nurse@pms.local | nurse | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| radiologist@pms.local | radiologist | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| (자가가입 환자) | patient | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

모든 비밀번호: `Staff1234`.

---

## 스토리 ↔ FR ↔ 구현 매핑

| 스토리 | 기능 | 커버 FR | 핵심 구현 |
|---|---|---|---|
| 3.1 | 환자 레코드 생성(원무 직접 등록·암호화·RLS) | FR-002, FR-003(등록시 중복차단), FR-240, FR-241 | `POST /v1/patients`(`patients.py:132`) → `services.create_patient`(rrn 검증·정규화·마스킹·파생) → `db.insert_patient`(SAVEPOINT+encrypt_sensitive+blind_index+UNIQUE 409); 0009 테이블/RLS/감사; 0005 crypto; web `patient-register.tsx` `/reception/register` |
| 3.2 | 임상 프로필 입력·조회 | FR-004, FR-005 | `PUT /v1/patients/{id}/clinical-profile`(`patients.py:171`) → `update_patient_clinical_profile`(in-txn 재평가, 5필드 PUT 교체); web `patient-detail.tsx`(알레르기 can't-miss 배너) |
| 3.3 | 보호자 정보 기록 | FR-006 | `GET/POST/PUT/DELETE /v1/patients/{id}/guardians`(`patients.py:229~270`) → `services.guardians`; 0009 guardians 테이블/RLS/감사; web `patient-guardians.tsx`(자유텍스트 관계·삭제 확인) |
| 3.4 | 앱 자가가입·기존 레코드 자동연결 | FR-001, FR-003 | `POST /v1/patients/self-link`+`GET /v1/patients/self`(`patients.py:57~76`) → `link_self_patient`(advisory lock·blind_index 매칭·성명 가드·6분기); `identity.simulate_identity_verification`(seam); web `(auth)/signup`+`(patient)/onboarding` |
| 3.5 | 전역 환자 검색(Ctrl+K 커맨드 팔레트) | (UX-DR5·DR24; FR-002 신원조회 보조) | `GET /v1/patients?q=`(`patients.py:144`) → `fetch_patients`(이름/차트/연락처 OR, LIKE 메타이스케이프, 자릿수 정규화); web `patient-search-command.tsx`(topbar 트리거, 디바운스/abort, RBAC 게이트) |
| 3.6 | 감사 스냅샷 서버측 PII 마스킹 | FR-242, FR-243 | `services/audit.mask_snapshot`(필드명 기반 재귀 마스킹, name=테이블의존); `GET /v1/admin/audit-logs`; `core/logging.mask_pii`(RRN+phone 백스톱); web `audit-log-viewer.tsx` 거울 |

---

## 테스트 시나리오

### ───── Story 3.1: 환자 레코드 생성 ─────

### TC-E3-01: 원무 직접 환자 등록 정상 흐름(auth_uid 미설정·chart_no 부여)
- **검증**: FR-002 / Story 3.1 AC1
- **역할/계정**: admin@pms.local (⚠️ reception은 권한 없음 — TC-E3-08 참조)
- **사전조건**: db reset + demo_seed 적용, API:8060·web:3002 기동, admin 로그인
- **단계**:
  1. `/reception/register` 진입 (사이드바 "환자 등록" 또는 직접 URL)
  2. 이름="홍길동", 주민등록번호="900101-1234567"(유효 RRN: 90년대생 남성), 보험유형="건강보험" 입력
  3. (선택) 휴대전화="010-9999-8888", 주소, 이메일="hong@test.com" 입력
  4. "환자 등록" 클릭
- **기대결과**:
  - 토스트 "홍길동 환자가 등록되었습니다. (차트번호 NNNNNNNN)"
  - "환자 등록 완료" 화면에 chart_no(8자리 zero-pad), 이름, 생년월일="1990-01-01"·성별="남"(RRN에서 서버 파생), 마스킹 주민번호="900101-1******", 보험유형 표시
  - DB: patients 행 1개, `auth_uid IS NULL`, `resident_no_enc`(bytea 비어있지 않음), `resident_no_hash`(hex), `resident_no_masked`='900101-1******'
  - "임상 프로필 입력 →" 링크가 `/patients/{id}`로 연결
- **유형**: 정상

### TC-E3-02: 주민번호 HARD 검증 실패 — 422 invalid_rrn (형식·생년월일·성별자리)
- **검증**: FR-002 / Story 3.1 AC2 (HARD 차단)
- **역할/계정**: admin@pms.local
- **사전조건**: `/reception/register` 진입
- **단계** (각 케이스 개별 시도, 클라 Zod 1선 + API 422 방어심층 모두 확인):
  1. 12자리("90010112345") → "주민등록번호 13자리를 정확히 입력하세요"(클라 차단)
  2. 성별자리 9("901231-9234567") → "성별·세기 자리가 올바르지 않습니다"
  3. 존재하지 않는 날짜("900230-1234567", 2월 30일) → "생년월일이 올바르지 않습니다"
  4. 윤년 경계: "000229-3234567"(2000년=윤년, 유효) vs "010229-3234567"(2001년=평년, 무효)
  5. (API 직접) 클라 우회로 위 무효값을 `POST /v1/patients`에 전송 → `422`, code="invalid_rrn", detail.errors에 기계코드(예 invalid_birthdate)만, **원본 주민번호 미포함**
- **기대결과**: HARD 실패는 등록 차단, 에러봉투에 raw RRN echo 없음(PII 경계)
- **유형**: 예외 / 경계

### TC-E3-03: 주민번호 SOFT 경고(체크섬 불일치) — 비차단 등록 가능
- **검증**: Story 3.1 AC2 (SOFT 경고)
- **역할/계정**: admin@pms.local
- **사전조건**: `/reception/register`
- **단계**:
  1. 형식·생년월일·성별자리는 유효하나 체크섬만 틀린 RRN 입력(예 "900101-1234560" — 마지막 자리 조작)
  2. 입력란 아래 경고 관찰 → "체크섬이 일치하지 않습니다. 2020년 이후 발급 번호일 수 있어 등록은 가능합니다." (role="status", 색 비의존)
  3. "환자 등록" 클릭
- **기대결과**: 경고는 표시되나 **등록은 성공**(2020 RRN 개편 대비). 등록 완료 화면 정상.
- **유형**: 경계

### TC-E3-04: 동일 주민번호 중복 등록 — 409 patient_exists(기존 chart_no 안내)
- **검증**: FR-003(등록 시점 중복방지) / Story 3.1 AC2
- **역할/계정**: admin@pms.local
- **사전조건**: demo_seed 적용 → 데모 환자 #01 김영수 RRN="750314-1234567"이 이미 존재
- **단계**:
  1. `/reception/register`에서 이름="아무개", 주민등록번호="750314-1234567"(김영수와 동일), 보험유형 선택
  2. "환자 등록" 클릭
- **기대결과**:
  - 입력란 아래 에러 "이미 등록된 주민등록번호입니다. (기존 차트번호 NNNNNNNN)" (김영수의 chart_no)
  - HTTP 409, code="patient_exists", detail.chart_no=기존값. **원본 RRN 미노출**
  - 새 patients 행 미생성(SAVEPOINT 롤백)
- **유형**: 예외 / 보안

### TC-E3-05: 정규화 동치 RRN의 중복 차단(하이픈 유/무 동일 처리)
- **검증**: FR-003 / Story 3.1 이월① (normalize_rrn→blind_index)
- **역할/계정**: admin@pms.local
- **사전조건**: TC-E3-01에서 "900101-1234567" 등록 완료
- **단계**:
  1. 같은 번호를 하이픈 없이 "9001011234567"로 재등록 시도
- **기대결과**: 409 patient_exists(정규화 후 같은 hash → UNIQUE 충돌). 하이픈 차이가 중복 우회로 작동하지 않음
- **유형**: 경계 / 보안

### TC-E3-06: 직접 API 호출 시 공백 패딩·빈 옵셔널 정규화
- **검증**: Story 3.1 (Pydantic _Stripped / _empty_to_none) — 직접 호출 방어심층
- **역할/계정**: admin 토큰
- **사전조건**: admin access token 확보(예 `supabase.auth.signInWithPassword` 또는 web 세션 토큰)
- **단계**:
  1. `POST /v1/patients` body에 name=" 김검증 "(공백 패딩), phone=""(빈문자), email="bad-email"(형식오류) 전송
- **기대결과**:
  - name 앞뒤 공백 제거되어 저장
  - phone="" → NULL 저장(빈문자 미저장)
  - email 형식 오류 → 422(이메일 형식)
- **유형**: 경계

### TC-E3-07: RLS 본인 격리 — 환자 직접 조회 시 타인 행 차단(FR-240)
- **검증**: FR-240 / Story 3.1 AC3
- **역할/계정**: 자가가입 환자(TC-E3-20에서 연결된 환자 계정)
- **사전조건**: 환자 A가 자가가입+연결 완료(auth_uid 설정). 환자 B는 미연결 데모환자
- **단계**:
  1. 환자 A 토큰으로 Supabase 직접 SELECT(예 PostgREST `/rest/v1/patients?select=*`) 시도
  2. 결과 행 확인
- **기대결과**:
  - 환자 A는 **본인 행만**(auth_uid=A) 조회됨, 타인(B 등) 행 미반환(RLS `patients_select_self`)
  - 응답 컬럼에 `resident_no_enc`/`resident_no_hash` **부재**(컬럼 GRANT 제외 — 0009)
  - anon 토큰으로는 0행(authenticated/anon revoke)
- **유형**: 권한·보안

### TC-E3-08: 권한 미보유 역할의 환자 등록 차단 (reception·nurse 403)
- **검증**: Story 3.1 AC3 (라우터 게이트 + in-txn 재평가)
- **역할/계정**: reception@pms.local, nurse@pms.local
- **사전조건**: 각 계정 로그인
- **단계**:
  1. reception 로그인 후 `/reception/register` 진입 시도 → 서버 가드 `requirePermission("patient.create", STAFF_HOME)` 작동
  2. (API 직접) reception/nurse 토큰으로 `POST /v1/patients` 호출
- **기대결과**:
  - web: STAFF_HOME으로 강등(등록 폼 도달 불가) — ⚠️ **현 시드 버그: 사이드바엔 "환자 등록" 메뉴가 보일 수 있으나 클릭 시 동작 안 됨(메뉴↔권한 불일치, Finding#1)**
  - API: 403, detail.required_permission="patient.create"
  - DB INSERT 미발생
- **유형**: 권한·보안

### TC-E3-09: 감사 스냅샷에 raw 주민번호 평문 부재(이월③ 검증)
- **검증**: Story 3.1 이월③ (감사 PII 경계)
- **역할/계정**: 등록=admin, 감사조회=admin(audit.read)
- **사전조건**: TC-E3-01로 환자 1명 등록(actor=admin)
- **단계**:
  1. `/admin/audit-logs` 진입, target_table=patients·action=create 필터
  2. 방금 등록한 행의 after_data 스냅샷 확인 (DB에서도 `select after_data from audit_logs` 직접 확인)
- **기대결과**:
  - 스냅샷에 `resident_no_enc`는 bytea hex(평문 RRN 아님), `resident_no_masked`='900101-1******'
  - **평문 13자리 RRN이 스냅샷 어디에도 없음**
  - API 응답에서는 name·phone 등이 "●●●● (마스킹됨)"(3.6 서버 마스킹) — TC-E3-31 참조
- **유형**: 보안

---

### ───── Story 3.2: 임상 프로필 입력·조회 ─────

### TC-E3-10: 임상 프로필 5필드 입력·갱신(FR-004)
- **검증**: FR-004 / Story 3.2 AC1
- **역할/계정**: admin@pms.local (patient.update 필요)
- **사전조건**: 데모 환자 #04 최수진(임상필드 전부 NULL) 상세 진입 — Ctrl+K로 "최수진" 검색 후 선택, 또는 `/patients/{id}`
- **단계**:
  1. "임상 프로필" 섹션의 "수정" 버튼 클릭
  2. 혈액형="A-" 선택, 알레르기="페니실린", 기저질환="없음", 복용약="타이레놀", 특이사항="검사 예정" 입력
  3. "저장" 클릭
- **기대결과**:
  - 토스트 "임상 프로필이 저장되었습니다."
  - 조회 모드로 전환, 입력값 표시. 혈액형 미설정 시 "미확인", 빈 필드는 "기록 없음"
  - DB: 5필드 갱신 + `updated_at` 갱신, 감사 트리거 update 기록(actor=admin)
- **유형**: 정상

### TC-E3-11: 혈액형 폐쇄어휘 검증 — 비정상 값 422
- **검증**: Story 3.2 (BloodType Literal)
- **역할/계정**: admin 토큰
- **사전조건**: 환자 1명 존재
- **단계**:
  1. (API 직접) `PUT /v1/patients/{id}/clinical-profile` body에 blood_type="C+"(어휘 밖) 전송
  2. web에서는 select 드롭다운이 8개 ABO+Rh만 제공하므로 직접 호출로 검증
- **기대결과**: 422(blood_type Literal 위반). 자유텍스트 4종은 max_length(allergies/chronic/medications 1000, notes 2000) 초과 시 422
- **유형**: 경계

### TC-E3-12: PUT 전체 교체 의미 — 미전송 필드 NULL화
- **검증**: Story 3.2 AC1 (5필드 PUT 전체 교체)
- **역할/계정**: admin
- **사전조건**: TC-E3-10으로 5필드 모두 채워진 환자
- **단계**:
  1. 수정 폼에서 알레르기만 남기고 나머지(혈액형·기저질환·복용약·특이사항) 비우고 저장
- **기대결과**: 비운 필드가 NULL로 교체(PATCH 부분갱신 아님). 알레르기만 잔존. (clinicalProfilePayload가 빈값→null 전송)
- **유형**: 경계

### TC-E3-13: 알레르기 can't-miss 배너(FR-005·안전 참조)
- **검증**: FR-005 / Story 3.2 AC2
- **역할/계정**: doctor@pms.local (patient.read — 조회 가능, 수정 불가)
- **사전조건**: 데모 환자 #08 윤서아(알레르기="계란") 또는 #09 임재욱("페니실린계 항생제…")
- **단계**:
  1. doctor 로그인, Ctrl+K로 "윤서아" 검색 → 선택
  2. 환자 상세 상단 관찰
- **기대결과**:
  - 알레르기 배너가 danger 스타일(role="alert", aria-live="assertive", 빨강 채움+테두리+굵은 라벨+TriangleAlert 아이콘, 음영 비의존)로 "알레르기 주의" + 내용 표시
  - 알레르기 없는 환자(#01 등)는 중립 "알레르기 기록 없음"
  - doctor는 "수정" 버튼 **미노출**(PermissionGate, patient.update 없음 → "수정 권한 없음")
- **유형**: 정상 / 권한

### TC-E3-14: 임상 프로필 갱신 권한 차단(403)
- **검증**: Story 3.2 AC3 (라우터 게이트 + in-txn 재평가)
- **역할/계정**: doctor@pms.local
- **사전조건**: 환자 상세 진입
- **단계**:
  1. doctor가 "수정" 버튼 클릭 불가(미렌더) 확인
  2. (API 직접) doctor 토큰으로 `PUT /v1/patients/{id}/clinical-profile` 호출
- **기대결과**: API 403 required_permission="patient.update". DB UPDATE 미발생
- **유형**: 권한·보안

### TC-E3-15: 존재하지 않는 환자 임상 프로필 갱신 — 404
- **검증**: Story 3.2 (미존재 → 404)
- **역할/계정**: admin
- **단계**: `PUT /v1/patients/{무작위 UUID}/clinical-profile` 호출
- **기대결과**: 404 "환자를 찾을 수 없습니다."
- **유형**: 예외

---

### ───── Story 3.3: 보호자 정보 기록 ─────

### TC-E3-16: 보호자 추가·조회(1:N)(FR-006)
- **검증**: FR-006 / Story 3.3 AC1·AC3
- **역할/계정**: admin@pms.local (patient.update)
- **사전조건**: 데모 환자 #17 류현우(소아, 기존 보호자 "김미나/모") 상세 진입
- **단계**:
  1. "보호자" 섹션 "보호자 추가" 클릭
  2. 성명="박철수", 관계="부"(datalist 프리셋 또는 자유텍스트), 연락처="010-1111-2222" 입력
  3. "저장"
  4. 두 번째 보호자 추가로 1:N 확인
- **기대결과**:
  - 토스트 "보호자가 추가되었습니다.", 목록에 김미나·박철수 모두 표시(등록순)
  - 관계는 자유텍스트 허용(enum 미강제), 연락처 평문 표시
  - DB guardians 행 생성 + 감사 트리거 insert
- **유형**: 정상

### TC-E3-17: 보호자 수정(PUT 전체 교체)·삭제(확인 단계)
- **검증**: FR-006 / Story 3.3 AC1·AC3
- **역할/계정**: admin
- **사전조건**: TC-E3-16의 보호자 존재
- **단계**:
  1. 보호자 행 "수정" → 연락처만 "010-3333-4444"로 변경, 저장
  2. 다른 보호자 행 "삭제" → ConfirmDialog "…보호자 삭제 확인" 표시 → "삭제" 클릭
- **기대결과**:
  - 수정: 토스트 "보호자 정보가 수정되었습니다.", 값 갱신
  - 삭제: 확인 후 목록에서 제거(hard delete), 토스트 "보호자가 삭제되었습니다.", before_data 스냅샷 감사 기록
- **유형**: 정상

### TC-E3-18: 보호자 IDOR 차단(patient_id 스코프)
- **검증**: Story 3.3 (update/delete patient_id 스코프 = IDOR)
- **역할/계정**: admin 토큰
- **사전조건**: 환자 A의 보호자 G_A, 환자 B(다른 환자) 식별
- **단계**:
  1. (API 직접) `PUT /v1/patients/{B의 id}/guardians/{G_A의 id}` (보호자는 A 소속) 호출
  2. `DELETE /v1/patients/{B의 id}/guardians/{G_A의 id}` 호출
- **기대결과**: 404 "보호자를 찾을 수 없습니다." (WHERE id AND patient_id 0행). G_A 변경/삭제 안 됨
- **유형**: 보안

### TC-E3-19: 보호자 쓰기 권한 차단 + 미존재 환자 404
- **검증**: Story 3.3 AC2
- **역할/계정**: doctor(patient.read만), admin
- **단계**:
  1. doctor 상세 진입 → "보호자 추가" 버튼 미렌더(PermissionGate). 목록 조회는 가능(patient.read)
  2. (API 직접) doctor 토큰 `POST /v1/patients/{id}/guardians` → 403
  3. admin 토큰 `POST /v1/patients/{무작위 UUID}/guardians` → 404(FK 위반 매핑 "환자를 찾을 수 없습니다.")
- **기대결과**: 권한 미보유 403, 미존재 환자 404(존재 누설 회피)
- **유형**: 권한 / 예외

---

### ───── Story 3.4: 앱 자가가입·기존 레코드 자동연결 ─────

### TC-E3-20: 자가가입 + 자동연결 정상 흐름(FR-001·FR-003)
- **검증**: FR-001, FR-003 / Story 3.4 AC1·AC2·AC4
- **역할/계정**: 신규 환자(앱 자가가입)
- **사전조건**: db reset+demo_seed → 데모 환자 #20 백서연 RRN="000630-4012349"·이름="백서연"이 auth_uid=NULL 상태로 존재
- **단계**:
  1. 로그아웃 상태에서 `/signup` 진입(로그인 화면 "회원가입" 링크 또는 직접 URL — 공개 경로)
  2. 이메일="baek.test@example.com", 비밀번호="Abcd1234"(8자+대소+숫자), 확인 입력 → "회원가입"
  3. 즉시 세션 발급 → `/onboarding`(본인 확인) 자동 이동
  4. 이름="백서연", 주민등록번호="000630-4012349" 입력 → "본인 확인하고 연결하기"
- **기대결과**:
  - 토스트 "백서연 님, 진료 기록과 연결되었습니다." → `/portal` 이동
  - API 200, 마스킹 요약(chart_no·name·birth_date·sex·resident_no_masked) 반환
  - DB: #20 행의 `auth_uid` = 신규 sub로 설정, 감사 트리거 update 기록
  - 이후 RLS로 본인 포털 조회 가능(Epic 8)
- **유형**: 정상

### TC-E3-21: 멱등 재연결(이미 본인에 연결됨 → 200)
- **검증**: Story 3.4 AC2 (already_linked 멱등)
- **역할/계정**: TC-E3-20의 연결된 환자
- **사전조건**: 백서연 연결 완료, 같은 세션
- **단계**:
  1. (재진입) `/portal`의 "본인 진료기록 연결" 또는 `/onboarding`에서 같은 RRN+이름 재제출
  2. (또는 API 직접 `POST /v1/patients/self-link` 동일 페이로드 재호출)
- **기대결과**: 200, 같은 마스킹 요약(중복 제출/재시도 안전, outcome="already_linked"). 새 행/이중 연결 없음
- **유형**: 경계

### TC-E3-22: 0건 매칭 — 404 no_patient_record
- **검증**: Story 3.4 AC3 (no_patient_record)
- **역할/계정**: 신규 자가가입 환자(미연결 세션)
- **사전조건**: 신규 가입 계정, 세션 보유
- **단계**:
  1. `/onboarding`에서 DB에 없는 유효 RRN(예 "880815-1234560", 데모환자와 불일치) + 임의 이름 입력 → 제출
- **기대결과**: 404, 화면 내 안내(role="alert") "등록된 진료 기록이 없습니다. 병원 방문·문의 후 다시 연결해 주세요." 연결 안 됨
- **유형**: 예외

### TC-E3-23: 주민번호 일치·성명 불일치 — 422 identity_mismatch(사칭 방지)
- **검증**: FR-003 / Story 3.4 AC3 (성명 가드 1차선)
- **역할/계정**: 신규 자가가입 환자(미연결)
- **사전조건**: 데모 환자 #02 이미경 RRN="820722-2345678" 미연결
- **단계**:
  1. `/onboarding`에서 RRN="820722-2345678"(이미경 것)이되 이름="홍길동"(불일치) 입력 → 제출
- **기대결과**: 422, 안내 "입력하신 정보가 기록과 일치하지 않습니다. 병원에 문의해 주세요." **연결하지 않음**(타인 RRN 도용 차단). #02의 auth_uid 여전히 NULL
- **유형**: 보안

### TC-E3-24: 성명 정규화 매칭(NFC·공백) — 표기 차이 허용
- **검증**: Story 3.4 (`_norm_name` NFC+공백정규화)
- **역할/계정**: 신규 자가가입 환자
- **사전조건**: 데모 환자(예 #14 권나래) 미연결, 신규 세션
- **단계**:
  1. RRN=권나래 것, 이름="  권나래  "(앞뒤+내부 공백 변형) 또는 NFD 분해형 한글로 입력 → 제출
- **기대결과**: 정규화 후 일치 → 정상 연결(200). 공백/유니코드 정규화 차이가 오거부(identity_mismatch) 유발하지 않음
- **유형**: 경계

### TC-E3-25: 이미 다른 계정에 연결된 주민번호 — 409 already_linked_other
- **검증**: Story 3.4 AC3 (계정 탈취 차단)
- **역할/계정**: 환자 B(신규, 미연결)
- **사전조건**: 환자 A가 데모환자 #20과 이미 연결됨(TC-E3-20). 환자 B가 별도 이메일로 신규 가입
- **단계**:
  1. 환자 B 세션에서 `/onboarding`에 #20의 RRN+이름 입력 → 제출
- **기대결과**: 409, 안내 "이미 가입·연결된 주민번호입니다." B 계정에 #20 연결 안 됨
- **유형**: 보안

### TC-E3-26: 이 계정이 이미 다른 환자에 연결됨 — 409 account_already_linked
- **검증**: Story 3.4 AC3 (1 계정 = 1 환자 불변식)
- **역할/계정**: 이미 연결된 환자 A
- **사전조건**: 환자 A가 #20 백서연과 연결됨
- **단계**:
  1. 환자 A 세션에서 `/onboarding`에 **다른** 데모환자(예 #02 이미경)의 RRN+이름 입력 → 제출
- **기대결과**: 409, 안내 "이 계정은 이미 다른 환자에 연결되어 있습니다." (own 행 존재 + hash 불일치 → account_already_linked)
- **유형**: 보안

### TC-E3-27: self-link RRN HARD 검증 실패 — 422 invalid_rrn
- **검증**: Story 3.4 (create_patient 미러 검증)
- **역할/계정**: 신규 자가가입 환자
- **단계**: `/onboarding`에 무효 RRN("123") + 이름 입력 → 제출(클라 차단 + API 422 둘 다)
- **기대결과**: 입력란 "주민등록번호가 올바르지 않습니다." 422 invalid_rrn(원본 미echo)
- **유형**: 예외

### TC-E3-28: 직원 계정의 self-link 차단(403) + onboarding 화면 강등
- **검증**: Story 3.4 AC3 (get_current_patient — 직원 403)
- **역할/계정**: doctor@pms.local(직원)
- **사전조건**: doctor 로그인
- **단계**:
  1. doctor 세션으로 `/onboarding` 직접 진입 시도
  2. (API 직접) doctor 토큰으로 `POST /v1/patients/self-link` 및 `GET /v1/patients/self` 호출
- **기대결과**:
  - web: `auth_user_role`이 staff → `/home`으로 redirect
  - API: 403(get_current_patient가 5직원역할 반전 차단). 직원 uid가 환자 행에 묻히는 것 방지
- **유형**: 권한·보안

### TC-E3-29: GET /patients/self 분기(미연결 404 → 온보딩 유도)
- **검증**: Story 3.4 AC4 (재진입 분기)
- **역할/계정**: 신규 자가가입(미연결) 환자
- **사전조건**: 신규 가입, 아직 self-link 안 함
- **단계**:
  1. (API 직접) `GET /v1/patients/self` 호출
  2. `/portal` 진입 시 "본인 진료기록 연결" 진입점 노출 확인
- **기대결과**: 404 code="no_self_patient"(미연결). 프런트가 온보딩 유도. 연결 후 재호출 시 200 요약
- **유형**: 경계

### TC-E3-30: 동시 self-link 직렬화(advisory lock) — 1 계정 1 환자
- **검증**: Story 3.4 (pg_advisory_xact_lock·auth_uid IS NULL 술어)
- **역할/계정**: 신규 환자(미연결 세션)
- **사전조건**: 같은 sub 토큰, 미연결 데모환자 2명의 RRN 준비
- **단계**:
  1. 같은 토큰으로 서로 다른 RRN 2건의 self-link를 거의 동시에(병렬) 호출
- **기대결과**: 하나만 연결 성공, 다른 하나는 account_already_linked(409). 레이스로 2환자 연결 불가(직렬화). 같은 RRN 더블서밋은 already_linked 멱등
- **유형**: 경계 / 보안

---

### ───── Story 3.5: 전역 환자 검색(Ctrl+K) ─────

### TC-E3-31: Ctrl+K 팔레트 열기 + 이름 검색(UX-DR5)
- **검증**: Story 3.5 AC1
- **역할/계정**: admin@pms.local (patient.read; ⚠️ doctor도 가능, reception 불가)
- **사전조건**: demo_seed 적용(환자 20명), 임의 직원 화면(/home 등)
- **단계**:
  1. `Ctrl+K`(또는 ⌘K) 누름 — 어느 직원 화면에서든
  2. 탑바 검색 버튼 클릭으로도 열림 확인
  3. "김" 입력(디바운스 200ms)
- **기대결과**:
  - 모달 팔레트 열림, 입력에 초기 포커스
  - 김영수·강민지·권나래 등 "김/강/권"… 실제로는 ILIKE '%김%' → 이름에 "김" 포함 행만(김영수). 부분일치 동작
  - 결과 행: 이름 + 차트번호 + 생년월일·성별 + 마스킹 RRN + 연락처(없으면 "—")
  - aria-live "N명 검색됨"(PII 미낭독)
- **유형**: 정상

### TC-E3-32: 차트번호·연락처 검색(자릿수 정규화)
- **검증**: Story 3.5 AC1 (3-필드 OR 검색)
- **역할/계정**: admin
- **단계**:
  1. 차트번호 일부(예 "0000000")로 검색
  2. 연락처 "2345-6701"(하이픈 포함) 및 "23456701"(하이픈 없이) 검색 — 김영수 phone="010-2345-6701"
- **기대결과**:
  - 차트번호 부분일치 동작
  - 연락처: 입력·저장값 모두 비숫자 제거 후 비교 → 하이픈 유/무 동일하게 김영수 매칭(자릿수 부분일치)
- **유형**: 정상 / 경계

### TC-E3-33: LIKE 메타문자 이스케이프(와일드카드 우회 차단)
- **검증**: Story 3.5 (LIKE 메타문자 리터럴화·SQLi 안전)
- **역할/계정**: admin
- **단계**:
  1. 검색어 "%" 입력
  2. 검색어 "_" 입력
- **기대결과**: "%"/"_"가 와일드카드로 해석되지 않고 리터럴로 매칭 → 전체 환자 끌어오기 불가(보통 0건). 공백/와일드카드로 전체목록 우회 차단
- **유형**: 보안 / 경계

### TC-E3-34: 검색 결과 선택 → 환자 상세 이동(UUID URL)
- **검증**: Story 3.5 AC2
- **역할/계정**: admin
- **단계**:
  1. 검색 후 ↑/↓로 행 이동, Enter로 선택(또는 클릭)
- **기대결과**:
  - `/patients/{UUID}`로 이동(URL에 UUID만, chart_no/RRN 미노출), 팔레트 닫힘
  - 디바운스 정착 전(stale) Enter는 무시(searchedTerm≠query) → 오환자 이동 방지
- **유형**: 정상 / 안전

### TC-E3-35: 결과 마스킹 + per-row reveal 없음 + 빈/없음/잘림 상태
- **검증**: Story 3.5 AC3 (UX-DR22 마스킹·오환자 방지)
- **역할/계정**: admin
- **단계**:
  1. 결과 행의 주민번호가 마스킹("YYMMDD-S******")인지, reveal 버튼이 없는지 확인
  2. 매칭 0인 검색어 입력 → "검색 결과 없음"
  3. 빈 입력 → 결과 없음(전체목록 노출 안 함)
  4. (가능시) 20명 초과 매칭 유도 → "상위 20명만 표시…" 잘림 안내
- **기대결과**: 각 행 마스킹 RRN만·per-row reveal 부재. 빈/없음/잘림 상태 텍스트(색 비의존). 동명이인 식별단서(생년월일·연락처) 병행
- **유형**: 경계 / 보안

### TC-E3-36: 검색 RBAC 노출 + API 강제(403)
- **검증**: Story 3.5 AC4 (UI 게이트 + API require_permission)
- **역할/계정**: reception@pms.local·nurse@pms.local(patient.read 없음) vs admin/doctor
- **단계**:
  1. reception/nurse 로그인 → 탑바 검색 버튼·Ctrl+K **미노출/미등록**(usePermissions has("patient.read")=false)
  2. (API 직접) reception 토큰으로 `GET /v1/patients?q=김` 호출
  3. 환자(비직원) 세션은 직원 셸 자체 없음 확인
- **기대결과**:
  - UI: 미보유 직원에게 검색 트리거·단축키 미노출
  - API: 403(방어심층, dead-403 UX 방지). admin/doctor는 정상
- **유형**: 권한·보안

### TC-E3-37: 검색어 PII 비로깅(구조적 로그)
- **검증**: Story 3.5 AC3·이월③ (q PII 미기록)
- **역할/계정**: admin
- **사전조건**: API 로그 접근(docker logs)
- **단계**:
  1. 이름/연락처로 검색 수행 후 API 구조적 로그 확인
- **기대결과**: 구조적 로그에 `q`(이름·연락처 PII) 미기록. (참고: nginx/uvicorn 액세스 로그의 `?q=` PII는 하드닝 이월 — 수용 갭)
- **유형**: 보안

---

### ───── Story 3.6: 감사 스냅샷 서버측 PII 마스킹 ─────

### TC-E3-38: 감사 응답 PII 서버 마스킹(AC1·AC2)
- **검증**: FR-242, FR-243 / Story 3.6 AC1·AC2
- **역할/계정**: admin@pms.local(audit.read — 유일 보유 역할)
- **사전조건**: TC-E3-01/10/16 등으로 patients·guardians 변경 이벤트 생성
- **단계**:
  1. `/admin/audit-logs` 진입, target_table=patients 필터
  2. 환자 create/update 항목의 before_data/after_data 상세 열람
  3. (API 직접) `GET /v1/admin/audit-logs?target_table=patients` 원본 응답 본문 확인
- **기대결과**:
  - 민감 키 값이 "●●●● (마스킹됨)": name, phone, address, email, insurance_no, allergies, chronic_diseases, medications, notes, resident_no_*(_enc/_hash/_masked는 정규식 resident_no 매칭)
  - **비민감 키는 노출**: action, target_table, target_id, chart_no, birth_date, sex, is_active, created_at, blood_type 키 자체(키 보존=diff 가독성)
  - 키는 보존되고 값만 마스킹
- **유형**: 보안

### TC-E3-39: name 마스킹의 테이블 의존성(patients/guardians만)
- **검증**: Story 3.6 AC2 (name=PII 테이블 한정)
- **역할/계정**: admin
- **사전조건**: patients 변경(환자명) + masters 변경(예 진료과/역할 권한 변경 — rbac.manage로 role_permissions 변경) 이벤트
- **단계**:
  1. target_table=patients 항목의 `name` 값 확인
  2. target_table=guardians 항목의 `name` 값 확인
  3. target_table=roles/permissions(또는 masters) 항목의 `name`/`code` 값 확인
- **기대결과**:
  - patients/guardians의 name → 마스킹
  - roles/permissions의 name(비-PII 라벨) → **노출**(감사 가독성 보존), `code` 항상 노출, `actor_name`(조인, 스냅샷 밖)도 노출
- **유형**: 보안 / 경계

### TC-E3-40: 건강민감 데이터(임상 프로필) 감사 마스킹
- **검증**: Story 3.6 AC2 (allergies/chronic/medications/notes 보강)
- **역할/계정**: admin
- **사전조건**: TC-E3-10으로 임상 프로필 update(actor=admin) 이벤트 생성
- **단계**:
  1. 해당 update 항목의 before/after에서 allergies·chronic_diseases·medications·notes 값 확인
- **기대결과**: 4종 건강민감 값 전부 "●●●● (마스킹됨)"(3.2에서 처음 audit 유입된 필드, 정규식 보강 확인)
- **유형**: 보안

### TC-E3-41: 중첩 객체/배열 재귀 마스킹
- **검증**: Story 3.6 AC1 (maskDeep 동형 재귀)
- **역할/계정**: admin
- **사전조건**: 중첩 jsonb 스냅샷이 있는 감사 항목(있으면)
- **단계**: 중첩 구조 안의 민감 키 값 확인
- **기대결과**: 안쪽 dict/list의 민감 키 값도 마스킹(누출 봉쇄). (현 스키마상 중첩 드묾 — 구조 검증 위주)
- **유형**: 보안 / 경계

### TC-E3-42: audit.read 게이트 — 비-admin 403
- **검증**: Story 3.6 AC1 (게이트 유지)
- **역할/계정**: doctor/reception/nurse vs admin
- **단계**:
  1. 비-admin 로그인 → `/admin/audit-logs` 접근 시도
  2. (API 직접) 비-admin 토큰 `GET /v1/admin/audit-logs`
- **기대결과**: 비-admin 403(audit.read 미보유). 마스킹은 그 위 방어심층. admin만 조회 가능
- **유형**: 권한·보안

### TC-E3-43: append-only 보존 — at-rest 스냅샷 원문 유지(수용 갭)
- **검증**: Story 3.6 AC3 (저장 시점 무손실·읽기 시점 마스킹)
- **역할/계정**: DB 직접 접근
- **단계**:
  1. `select before_data, after_data from audit_logs where target_table='patients'` 직접 조회
- **기대결과**: 저장된 jsonb는 **원문 그대로**(name 등 평문, RRN은 enc/masked만) — 마스킹은 API/웹 읽기 시점만. (at-rest 평문 잔존=명시 수용 갭). 단, raw 13자리 RRN은 저장에도 없음(TC-E3-09)
- **유형**: 경계 / 보안

### TC-E3-44: 구조적 로그 백스톱 — RRN+전화번호 마스킹(AC4)
- **검증**: Story 3.6 AC4 (logging.mask_pii)
- **역할/계정**: -
- **사전조건**: API 로그 접근
- **단계**:
  1. RRN/전화번호가 포함될 수 있는 로그 경로 유발(또는 단위테스트 `core/logging`)
- **기대결과**: 구조적 로그에 우발적으로 흐른 RRN(`\d{6}-\d{7}`)·전화번호(`01X-XXXX-XXXX`)가 마스킹(과대마스킹 허용). 이름·주소는 패턴 신뢰 한계로 제외(규율 의존)
- **유형**: 보안

---

### ───── 횡단(Cross-cutting) ─────

### TC-E3-45: RRN reveal 정상 + 자가-감사(FR-241·242)
- **검증**: FR-241, FR-242 / 0012 reveal_rrn(Epic 4.5 엔드포인트지만 Epic 3 암호화 산출물 검증)
- **역할/계정**: doctor@pms.local 또는 admin(patient.reveal_rrn)
- **사전조건**: demo_seed 적용(암호문 채워짐), 데모 환자 #01 김영수
- **단계**:
  1. (API 직접) doctor 토큰 `POST /v1/patients/{#01 id}/reveal-rrn`
  2. `/admin/audit-logs`에서 action=read·target_table=patients·target_id=#01 감사 확인(admin으로)
- **기대결과**:
  - 200, `{resident_no:"7503141234567"}` full RRN(응답 바디 전용)
  - audit_logs에 actor=doctor·action='read' 자동 기록(복호=감사 DB 강제, decrypt_sensitive)
  - **감사 스냅샷에 raw RRN 미저장**(read 이벤트는 before/after 없음)
- **유형**: 정상 / 보안

### TC-E3-46: 연락처 reveal + 자가-감사
- **검증**: FR-242 / 0012 reveal_contact
- **역할/계정**: doctor/admin(patient.reveal_contact)
- **단계**: `POST /v1/patients/{id}/reveal-contact`
- **기대결과**: 200 full phone/address/email, audit 'read' 수동 insert(actor 캡처). 평문 연락처이므로 복호 없음
- **유형**: 정상 / 보안

### TC-E3-47: reveal 권한 차단(403) + 미존재(404)
- **검증**: FR-242 / 0012 has_permission 재평가
- **역할/계정**: reception/nurse(reveal 권한 없음)
- **단계**:
  1. reception 토큰 `POST /v1/patients/{id}/reveal-rrn` → 403(42501 매핑)
  2. admin 토큰 `POST /v1/patients/{무작위 UUID}/reveal-rrn` → 404(PT404 매핑)
- **기대결과**: 권한 미보유 403(RPC 내부 has_permission 재평가), 미존재 404. raw 미echo
- **유형**: 권한·보안

### TC-E3-48: reveal RPC 직접 클라 호출 차단(service_role only)
- **검증**: FR-241 (0005/0012 권한 posture)
- **역할/계정**: 직원/환자 authenticated 토큰(Supabase 직접)
- **단계**: authenticated 토큰으로 PostgREST RPC `reveal_rrn`/`encrypt_sensitive`/`decrypt_sensitive`/`blind_index` 직접 호출 시도
- **기대결과**: 권한 거부(authenticated/anon revoke). 복호·암호화·blind_index는 service_role(FastAPI 경유)만
- **유형**: 보안

### TC-E3-49: 인증 없음/만료/무효 토큰 — 401
- **검증**: 인증 경계(security.py)
- **역할/계정**: 미인증
- **단계**: Authorization 헤더 없이 / 만료·변조 토큰으로 `GET /v1/patients`, `POST /v1/patients`, `POST /v1/patients/self-link` 호출
- **기대결과**: 401(AuthError). 토큰 결함 종류 미노출
- **유형**: 권한·보안

---

## FR 커버리지 체크

| 담당 FR | 커버 시나리오 | 비고 |
|---|---|---|
| FR-001 환자 앱 자가 회원가입(본인인증) | TC-E3-20, TC-E3-27, TC-E3-49 | signUp + onboarding 본인인증 시뮬(seam, 항상통과). 실 PASS 미연동 |
| FR-002 원무 직접 환자레코드 생성(auth_uid 미설정) | TC-E3-01, 02, 03, 06, 08 | ⚠️ 실제 가능 역할=admin(reception 권한 시드 누락=TC-E3-08 버그) |
| FR-003 자동연결(중복방지·blind index 매칭) | TC-E3-04, 05(등록중복), 20, 21, 23, 25, 26, 30(자동연결) | 등록시점 UNIQUE 차단 + self-link blind_index 매칭 양면 |
| FR-004 임상프로필 입력·갱신 | TC-E3-10, 11, 12 | 5필드 PUT 전체 교체, blood_type 폐쇄어휘 |
| FR-005 의사 진료화면 임상프로필 조회 | TC-E3-13 | (상세 풀페이지 조회; 진료 허브 배너 연동=Epic 4) |
| FR-006 보호자 정보 기록 | TC-E3-16, 17, 18, 19 | 1:N CRUD, IDOR 차단, 관계 자유텍스트 |
| FR-240 RLS 본인만 | TC-E3-07, 36(비직원 셸 없음) | patients_select_self / patients_select_staff, 컬럼 GRANT 제외 |
| FR-241 RRN 암호화(Vault·pgcrypto) | TC-E3-01(enc 저장), 45, 48 | resident_no_enc bytea, RPC service_role only |
| FR-242 감사 PII 마스킹 + reveal=감사 | TC-E3-09, 38~43(마스킹), 45, 46, 47(reveal=감사) | 읽기시점 서버 마스킹 1차권위 + 복호=감사 DB강제 |
| FR-243 감사 로그 조회 | TC-E3-38, 42 | audit.read 게이트 + 마스킹 |
| (검색 UX-DR5·DR24) | TC-E3-31~37 | Ctrl+K 팔레트, 3필드 검색, RBAC, PII 비로깅 |
| (인증 경계) | TC-E3-49 | 401 baseline |

총 시나리오: **49건** (정상 14 · 예외/경계 19 · 권한/보안 16, 일부 복합 유형 중복 집계).

---

## 미해결/주의 갭(테스트 중 확인 권장)

1. **reception patient.* 권한 누락(Finding#1)**: 시드 버그로 reception이 환자 생성/검색/임상/보호자 전부 불가(403). 데모 시연 시 admin 계정 사용 필수. (수정 시: seed.sql에 reception→patient.create/read/update grant 추가 필요할 수 있음 — RBAC UI 노출 모델상 직무 핵심 메뉴는 역할로 노출)
2. **데모 환자 전원 auth_uid=NULL**: 자가가입 연결 대상은 풍부하나, "이미 다른 계정에 연결됨"(TC-E3-25) 검증은 먼저 환자 A를 연결해 상태를 만들어야 함.
3. **RRN reveal은 demo_seed 적용 의존**: seed.sql만으로는 환자 0명 → reveal 대상 없음. db reset 후 반드시 demo_seed 적용.
4. **검색어 PII-in-URL**: `?q=`에 PII가 nginx/uvicorn 액세스 로그에 남는 갭은 하드닝 이월(구조적 로그엔 미기록). 액세스 로그 스크러빙은 범위 밖.
5. **at-rest 감사 평문**: audit_logs 저장 jsonb는 원문(name 등 평문, RRN은 enc/masked) — 명시 수용 갭. 마스킹은 읽기 시점만.
