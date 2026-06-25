# Epic 8: 환자 포털·운영 대시보드·APK — 테스트 시나리오

## 에픽 개요

Epic 8은 PMS의 마지막 에픽으로 **환자-대면 읽기 포털(8.1~8.3)**, **환자 앱 APK 패키징(8.4)**, **관리자 운영 대시보드(8.5)** 5개 스토리로 구성된다. 핵심 성격:

- **8.1~8.3 = 환자 포털(읽기 전용)**: Epic 1~7이 누적한 데이터(내원·진단·처방·검사·수납)를 환자 언어로 비추는 self-read 뷰. 새 임상 데이터 생성 0. 전부 `/patients/me/*` 엔드포인트 + `get_current_patient` 게이트 + `where p.auth_uid = $1`(세션 uid 스코프) + 소유검증→404 패턴.
- **8.4 = Flutter 웹뷰 셸 APK**: 완성된 반응형 웹 포털을 네이티브 셸로 래핑. 마이그·API·web 변경 0. 작업 표면은 `mobile/`에 갇힘.
- **8.5 = 운영 대시보드(관리자)**: clinic-wide 집계(내원·대기·매출·노쇼율), `dashboard.read` 게이트, FastAPI 집계, read-only.

### ⚠️ 코드에서 확인한 핵심 사실 (시나리오 전제)

1. **데모 환자는 auth_uid 미연결** — `supabase/demo_seed.sql`에 auth_uid 삽입이 **전혀 없다**(grep 0건). 환자 20명은 `auth_uid IS NULL` 상태. ⇒ **포털 테스트는 반드시 `/signup`(환자 자가가입) → `/onboarding`(self-link 본인연결) 선행**이 필요. 연결 전 포털은 빈상태/온보딩 유도.
2. **`get_current_patient` 게이트(security.py:163)** — active 직원 5역할이면 **403**. 즉 `admin@pms.local`·`@pms.local` 직원 계정으로는 `/me/*` 포털 엔드포인트 접근 시 403(직원은 포털 라우트 진입 시 web에서 `/home` redirect). 환자 포털은 **직원이 아닌 신규 가입 계정**으로만 검증 가능.
3. **self-link 매칭 키 = blind_index(주민번호) + 성명 일치**(db.py:1308 `link_self_patient`). RRN HARD 검증(체크섬) → 본인인증 시뮬 → `blind_index(normalized_rrn)`로 환자 행 조회 → `_norm_name(target.name) == _norm_name(입력성명)` 일치해야 연결. 1계정=1환자(advisory lock 직렬화).
4. **연결 대상 환자 데이터(demo_seed)**:
   - **환자 01 김영수 / RRN `750314-1234567`** — 내원 e01(완료·감기 J00 주상병·"목감기·코감기" 부연)·처방(타이레놀 1일3회·록소프로펜 1일2회)·finalized 수납 `R-...-01` 4,500원(카드). **포털 풀스택 검증 1순위.**
   - **환자 03 박정호 / RRN `681105-1456789`** — 내원 e03(완료·당뇨 E11.9)·검사 CBC(정상)·HbA1c(주의 flag attention "혈당 조절이 조금 더 필요해요")·finalized 수납 6,700원(현금). **검사 정상/주의 플래그 검증용.**
   - **환자 06 한지영 / RRN `720612-2789012`** — 내원 e06(완료·고혈압 I10+고지혈증 E78.5)·흉부X-ray(정상)·finalized 수납 9,300원(카드). **다중 진단(주상병+부상병)·영상검사 검증용.**
   - **환자 05 정대현 / RRN `850930-1678901`** — 노쇼 예약 2건(ap05/ap06)·내원 e05(완료·인두염). 노쇼 환자 시나리오 참고.
5. **finalized 수납 = e01~e06 (6건)**, 전부 환자 01·02·03·04·05·06. 환자 07~20은 수납 없음(빈 마이탭 검증용).
6. **대시보드 데이터는 `v_today` 상대(demo_seed.sql:43)** — 예약/내원/수납이 `now() KST today` 기준 ±일수 오프셋으로 시드. ⇒ `supabase db reset` + demo_seed 적용 직후 대시보드의 "오늘" 및 최근 추세에 데이터가 보인다. 단 오늘 finalized 수납은 e01~e06 중 completed_at이 오늘인 건만(대부분 과거일). 노쇼 추세는 ap05(-6일)·ap06(-4일)·ap07(-5일)에 분포.
7. **APK 런타임 검증은 이 환경에서 불가** — Android 런타임 화면 없음. 빌드 산출물(`~/patient-portal-app-release-v1.0.0.apk` 43.6MB)·정적 검증(`flutter analyze`/`flutter test`)·`isInternalUrl` 단위 케이스만. 실기기 로그인 round-trip·세션 지속은 사용자 수용 단계.

## 스토리 ↔ FR ↔ 구현 매핑

| 스토리 | 기능 | 커버 FR | 핵심 구현 |
|---|---|---|---|
| 8.1 환자 포털 내 진료내역 | 본인 내원이력 카드(예약·진찰·진단 쉬운말)·신뢰노트·환자 폰셸/탭바 | FR-120, FR-240 | 마이그 0054(`diagnoses.patient_friendly_note`)·`GET /patients/me/encounters`·`fetch_self_encounters`(auth_uid=$1)·`(patient)/records` 화면·visit-history.tsx |
| 8.2 환자 포털 처방·검사 결과 | 카드 펼침 처방(복약 쉬운말)·검사 결과 요약(정상/주의 플래그) | FR-121, FR-240 | 마이그 0055(`examinations.patient_result_summary/flag`)·`GET /me/encounters/{id}/detail`(소유검증→404·findings 미투영)·encounter-detail.tsx·exam-result-badge.tsx |
| 8.3 환자 포털 수납·영수증 | 마이탭 finalized 수납 리스트·영수증 친화요약+법정인쇄 | FR-122, FR-240 | 마이그0·`GET /me/payments`·`GET /me/encounters/{id}/receipt`(소유검증+finalized→404)·`_assemble_receipt_payload`·payment-history.tsx·receipt-detail.tsx·`(patient)/receipts/[encounterId]` |
| 8.4 환자 앱 APK | Flutter 웹뷰 셸 견고화·APK 빌드/배포 | NFR-011 | `mobile/lib/webview_screen.dart`(PopScope·NavigationDelegate)·`url_policy.dart`(`isInternalUrl`)·적응형 아이콘·`~/patient-portal-app-release-v1.0.0.apk` |
| 8.5 운영 대시보드 | 일별 내원·대기·매출·노쇼율 KPI+추세 | FR-230 | `GET /dashboard/operations`(dashboard.read)·`fetch_dashboard_operations`(KST·refunded 차감·divide-by-zero)·`(staff)/admin/dashboard`·operations-dashboard.tsx |

---

## 테스트 시나리오

### ── 그룹 A: 사전조건 / 환자 계정 연결 (포털 전 시나리오의 선행) ──

### TC-E8-01: 환자 자가가입 + 본인연결(self-link) 정상 — 포털 진입 사전조건
- **검증**: FR-001/FR-003(self-link)·Story 8.1~8.3 사전조건
- **역할/계정**: 신규 환자 (브라우저 시크릿창)
- **사전조건**: `supabase db reset` + `demo_seed.sql` 적용. web(:3002)·API(:8060) 기동. 데모 환자 01 김영수(RRN 750314-1234567)는 auth_uid 미연결 상태.
- **단계**:
  1. `/signup` 진입 → 이메일(예: `patient01@test.local`)·비밀번호(`Test1234a`)·비밀번호 확인 입력 → "회원가입" 클릭.
  2. 즉시 세션 발급(enable_confirmations=false) → `/onboarding` 자동 이동 확인.
  3. 온보딩 폼("본인 확인" 제목)에서 이름 `김영수`, 주민등록번호 `7503141234567`(또는 `750314-1234567`) 입력 → "본인 확인하고 연결하기" 클릭.
- **기대결과**: 토스트 "김영수 님, 진료 기록과 연결되었습니다." 후 `/portal` 이동. 이후 `/records`·`/portal`에서 본인 데이터 노출. (DB: patient 01 행 `auth_uid` = 신규 계정 sub.)
- **유형**: 정상

### TC-E8-02: self-link 성명 불일치 → 422 거부(사칭 방지)
- **검증**: FR-003·self-link identity 가드(db.py:1355 `_norm_name`)
- **역할/계정**: 신규 환자(가입 직후, 미연결)
- **사전조건**: 신규 계정 가입·세션 보유, /onboarding.
- **단계**: 이름 `홍길동`(틀림), 주민번호 `7503141234567`(김영수의 것) 입력 → "본인 확인하고 연결하기".
- **기대결과**: 422 `identity_mismatch` → 폼 에러 "입력하신 정보가 기록과 일치하지 않습니다. 병원에 문의해 주세요." 연결 안 됨(환자 행 auth_uid 여전히 NULL).
- **유형**: 권한·보안

### TC-E8-03: self-link 미등록 주민번호 → 404
- **검증**: self-link no_patient_record
- **역할/계정**: 신규 환자(미연결)
- **사전조건**: 가입·세션 보유.
- **단계**: 이름 `테스트`, 주민번호 `9001011234567`(demo_seed에 없는 RRN·체크섬 유효해야 HARD 통과) 입력 → 제출.
- **기대결과**: 404 `no_patient_record` → "등록된 진료 기록이 없습니다. 병원 방문·문의 후 다시 연결해 주세요."
- **유형**: 예외

### TC-E8-04: self-link 잘못된 주민번호 체크섬 → 422 HARD / 또는 soft 경고
- **검증**: RRN HARD 검증(invalid_rrn)·온보딩 soft 경고
- **역할/계정**: 신규 환자(미연결)
- **사전조건**: 가입·세션 보유.
- **단계**: (a) 길이/형식 깨진 RRN(예: `12345`) 입력 → 제출. (b) 체크섬만 어긋난 13자리(2020년+ 발급 시뮬) 입력 → blur.
- **기대결과**: (a) 422 invalid_rrn → "주민등록번호가 올바르지 않습니다."(연결 안 됨). (b) soft 경고 "체크섬이 일치하지 않습니다. 2020년 이후 발급 번호일 수 있어 진행은 가능합니다."(role=status, 제출 차단 아님).
- **유형**: 경계

### TC-E8-05: 1계정=1환자 — 이미 연결된 계정의 재연결 충돌(409)
- **검증**: self-link account_already_linked / already_linked(멱등)
- **역할/계정**: TC-E8-01에서 김영수에 연결된 계정
- **사전조건**: 계정이 이미 환자 01에 연결됨.
- **단계**: (a) `/onboarding` 재진입(직접 URL) → 동일 김영수 정보 재제출. (b) 다른 환자 정보(박정호 681105-1456789) 제출.
- **기대결과**: (a) 200 멱등(`already_linked`) → 정상 토스트·`/portal`. (b) 409 `account_already_linked` → "이 계정은 이미 다른 환자에 연결되어 있습니다."
- **유형**: 권한·보안

### TC-E8-06: 이미 다른 계정이 선점한 환자 → 409 already_linked_other(탈취 차단)
- **검증**: self-link already_linked_other
- **역할/계정**: 두 번째 신규 계정(`patient01b@test.local`)
- **사전조건**: 환자 01이 이미 첫 계정에 연결됨(TC-E8-01).
- **단계**: 두 번째 계정 가입 → /onboarding → 김영수 750314-1234567 제출.
- **기대결과**: 409 `already_linked_other` → "이미 가입·연결된 주민번호입니다."(타 계정이 탈취 불가).
- **유형**: 권한·보안

### TC-E8-07: 직원 계정의 포털/온보딩 접근 차단
- **검증**: get_current_patient 게이트(직원 403)·web 직원 redirect
- **역할/계정**: admin@pms.local / Staff1234 (또는 임의 직원 계정)
- **사전조건**: 직원 로그인.
- **단계**: (a) 직접 URL `/records`·`/portal`·`/receipts/<uuid>`·`/onboarding` 진입. (b) (가능 시) 직원 토큰으로 `GET /patient_management_system/api/v1/patients/me/encounters` 호출.
- **기대결과**: (a) 전부 `/home`으로 redirect(isStaffRole). (b) API 403(get_current_patient가 직원 5역할 차단).
- **유형**: 권한·보안

---

### ── 그룹 B: Story 8.1 — 내 진료내역(내 기록 탭) ──

### TC-E8-08: 내 기록 탭 — 내원 이력 카드 최근순 + 신뢰노트
- **검증**: FR-120 / Story 8.1 AC1·AC2
- **역할/계정**: 김영수 연결 계정(TC-E8-01)
- **사전조건**: 환자 01 연결 완료.
- **단계**: 하단 탭바 "내 기록"(`/records`) 클릭.
- **기대결과**: 상단 "지난 진료 내역 / 최근 진료부터 차례대로 보여 드려요." + 신뢰노트 "김영수 님 본인의 정보만 안전하게 표시됩니다. 다른 사람은 볼 수 없어요." 상시. 연도 캡션 "2026년". 내원 카드: 날짜 "2026. 6. ..(요일)", 상태배지 "완료 ✓", 의사명/내과, 시간 "오후 X:XX 진료". 카드 최근순 정렬.
- **유형**: 정상

### TC-E8-09: 진단 쉬운말 부연 표시 + 폴백
- **검증**: FR-120 / Story 8.1 AC3 (마이그 0054)
- **역할/계정**: 김영수 연결 계정
- **사전조건**: 환자 01 내원 e01(감기 J00 주상병·friendly_note "목감기·코감기").
- **단계**: e01 카드의 "진단" 줄 확인.
- **기대결과**: "진단: 급성 비인두염[J00 name] (목감기·코감기)" 형태 — KCD 진단명 + 괄호 쉬운말. 부연 없는 진단은 진단명만(우아한 폴백).
- **유형**: 정상

### TC-E8-10: 다중 진단 — 주상병만 카드 헤더 표시
- **검증**: Story 8.1 AC3·LATERAL 활성 주상병 1건(is_primary)
- **역할/계정**: 한지영 연결 계정(별도 신규 가입+self-link 720612-2789012)
- **사전조건**: 환자 06 연결(내원 e06: I10 주상병 + E78.5 부상병).
- **단계**: e06 카드 진단 줄 확인.
- **기대결과**: 카드 헤더 진단 = **주상병 고혈압(I10)만**(부상병 고지혈증은 카드 헤더 미표시·is_primary=true 1건만 LATERAL 조인).
- **유형**: 경계

### TC-E8-11: 취소/노쇼 내원 카드 본문 분기(사유 폴백)
- **검증**: Story 8.1 AC4 (코드리뷰 patch — cancel_reason NULL 폴백)
- **역할/계정**: 환자 연결 계정 (취소/노쇼 내원 보유 환자 필요 — demo_seed 내원은 전부 registered+ 진행이라 별도 셋업 또는 신규 데이터)
- **사전조건**: 본인 내원 중 status=cancelled(사유 있음/없음)·no_show 케이스. (demo_seed는 appointment에 노쇼/취소가 있으나 encounter 11건은 취소/노쇼 없음 → 직원이 별도 취소 내원 생성하거나 통합테스트로 대체.)
- **단계**: 취소 카드(사유 有)·취소 카드(사유 NULL)·노쇼 카드 본문 확인.
- **기대결과**: 취소(사유 有)="사유: {cancel_reason}". 취소(사유 NULL)="예약이 취소되었어요." 노쇼(사유 NULL)="방문하지 않은 진료예요." 색 비의존(글리프 ✕ + 라벨). 진단 줄 없음.
- **유형**: 경계

### TC-E8-12: 진단 없는 내원(예정/접수/진료중) — 진단 줄 생략
- **검증**: Story 8.1 AC4
- **역할/계정**: 환자 연결 계정(진료중/접수 내원 보유)
- **사전조건**: status=registered 또는 in_progress 내원(예: 환자 07~11 중 연결한 환자 — e07~e11는 registered/in_progress·진단 미부착).
- **단계**: 해당 카드 확인.
- **기대결과**: 진단 줄 생략, 상태배지 "접수"(●) 또는 "진료 중"(◐). 색 비의존.
- **유형**: 경계

### TC-E8-13: 12시간 KST 시간표기 + 시간 suffix
- **검증**: Story 8.1 AC5 (formatVisitTime·visitTimeSuffix)
- **역할/계정**: 환자 연결 계정
- **사전조건**: 진찰완료/예약/접수 카드 혼재.
- **단계**: 카드 시간 표기 확인.
- **기대결과**: "오후 2:30"(12h·KST·ko-KR). suffix: consult_started_at 有="진료" / reserved="예약" / 그외="접수". (직원 24h와 별개.)
- **유형**: 정상

### TC-E8-14: 빈 상태 — 내원 0건
- **검증**: Story 8.1 AC5 빈상태
- **역할/계정**: 내원 없는 환자 연결 계정(예: 환자 12~16·내원 미생성 환자에 연결)
- **사전조건**: 연결된 환자가 내원 0건.
- **단계**: "내 기록" 탭 진입.
- **기대결과**: "아직 진료 내역이 없어요." (신뢰노트는 상시 유지·크래시 없음).
- **유형**: 경계

### TC-E8-15: 미연결 계정 — 온보딩 유도
- **검증**: Story 8.1 AC5 미연결(/self 404 no_self_patient)
- **역할/계정**: 가입만 하고 self-link 안 한 신규 계정
- **사전조건**: 계정 가입·세션 보유, 환자 미연결.
- **단계**: "내 기록"(`/records`) 진입.
- **기대결과**: 온보딩 유도 — 제목 "내 진료 기록 보기", "진료 기록을 안전하게 보려면 먼저 본인 확인이 필요해요.", CTA "본인 진료기록 연결하기" → `/onboarding`. (GET /patients/self가 404 no_self_patient.)
- **유형**: 예외

### TC-E8-16: RLS self-scope — 타인 데이터 0건
- **검증**: FR-240 / Story 8.1 AC2 (where p.auth_uid=$1)
- **역할/계정**: 김영수 연결 계정
- **사전조건**: DB에 다른 환자 19명 내원 존재.
- **단계**: "내 기록" 목록 카드 수·내용 확인. (API: `GET /me/encounters` 응답에 본인 encounter_no만.)
- **기대결과**: 김영수 본인 내원만(e01) 노출. 타인 내원·진단 0건. 응답에 raw resident_no·연락처·patient_id 미투영(PII 부재).
- **유형**: 권한·보안

---

### ── 그룹 C: Story 8.2 — 처방·검사 결과(카드 펼침) ──

### TC-E8-17: 카드 펼침 → 처방·검사 상세 토글
- **검증**: FR-121 / Story 8.2 AC1
- **역할/계정**: 김영수 연결 계정
- **사전조건**: e01(완료·처방 보유) 카드.
- **단계**: e01 카드의 "처방·검사 결과 보기" 버튼 클릭 → 다시 클릭.
- **기대결과**: 펼침 시 처방 섹션(💊 "처방받은 약")·검사 섹션(🧪 "검사 결과 요약") 표시·버튼 "접기". 재클릭 시 접힘. aria-expanded 토글·≥44px·셰브런 색 비의존. 첫 펼침만 지연 로드(이후 캐시).
- **유형**: 정상

### TC-E8-18: 복약 안내 쉬운말 조립 + 일수 칩
- **검증**: FR-121 / Story 8.2 AC2 (formatDosage)
- **역할/계정**: 김영수 연결 계정
- **사전조건**: e01 처방 = 타이레놀(1일3회·매식후30분·1정·3일)·록소프로펜(1일2회·아침저녁식후·1정·3일).
- **단계**: 펼친 처방 섹션 확인.
- **기대결과**: 약마다 약품명 + 복약안내 "1일 3회, 매 식후 30분, 1정"(저장 한국어 필드 결합·TID 코드 미노출) + 일수 칩 "3일분". 비급여 약은 "비급여" 라벨.
- **유형**: 정상

### TC-E8-19: 검사 결과 요약 + 정상/주의 플래그(색 비의존)
- **검증**: FR-121 / Story 8.2 AC3 (마이그 0055 patient_result_flag)
- **역할/계정**: 박정호 연결 계정(신규가입+self-link 681105-1456789)
- **사전조건**: 환자 03 e03 검사 = CBC(flag normal·"피검사 수치가 모두 정상 범위예요.")·HbA1c(flag attention·"혈당 조절이 조금 더 필요해요...").
- **단계**: e03 카드 펼침 → 검사 섹션 확인.
- **기대결과**: CBC = 검사명 + 요약 + 배지 "✓ 정상"(그린·라벨 병기). HbA1c = 요약 + 배지 "! 주의"(앰버·라벨 병기). 색 + 글리프 + 라벨 중복 인코딩.
- **유형**: 정상

### TC-E8-20: 판독 소견 원문(findings/reading_conclusion) 환자 비노출
- **검증**: FR-121/FR-240 / Story 8.2 AC3 (구조적 차단·findings 미투영)
- **역할/계정**: 박정호 연결 계정
- **사전조건**: e03 HbA1c findings="HbA1c 7.8% — 목표(6.5%) 미달, 약물 조절 필요"(직원용 임상서사).
- **단계**: 검사 섹션 텍스트 전수 확인 + (API) `GET /me/encounters/{e03}/detail` 응답 바디 검사.
- **기대결과**: 화면·응답에 findings("7.8%"·"목표 미달")·reading_conclusion 절대 미노출. 환자는 큐레이션된 patient_result_summary만. fee_schedule_id·*_by·drug_id·ingredient_code도 미투영.
- **유형**: 권한·보안

### TC-E8-21: 검사 결과 미완료/NULL 플래그 폴백
- **검증**: Story 8.2 AC3 (폴백·완료 전 검사)
- **역할/계정**: 환자 연결 계정(완료 전 검사 보유 — 예: 환자 08 e08 흉부X-ray ordered/performed·patient_result NULL)
- **사전조건**: 환자 08 연결(880425-2901234), e08 검사 결과 미완료.
- **단계**: e08 펼침 → 검사 섹션.
- **기대결과**: status≠completed → "아직 결과가 나오지 않았어요." 완료지만 summary NULL → "결과가 확인되었어요. 자세한 내용은 진료받으신 의원에 문의해 주세요." 배지 미표시(flag NULL).
- **유형**: 경계

### TC-E8-22: 처방·검사 0건 내원 — 섹션 폴백
- **검증**: Story 8.2 AC5 빈 상세
- **역할/계정**: 환자 연결 계정(처방·검사 없는 완료 내원)
- **사전조건**: 처방·검사 모두 없는 본인 내원.
- **단계**: 해당 카드 펼침.
- **기대결과**: "이 진료에는 처방·검사 내역이 없어요." 하단 안내노트 "자세한 검사 수치와 진료 기록은 진료받으신 의원에 보관되어 있어요." 상시.
- **유형**: 경계

### TC-E8-23: IDOR — 타인 내원 detail 요청 → 404
- **검증**: FR-240 / Story 8.2 AC5 (소유검증 e.id=$1 and p.auth_uid=$2 → None → 404)
- **역할/계정**: 김영수 연결 계정 토큰
- **사전조건**: 다른 환자 내원 UUID 확보(예: 박정호 e03 UUID `00020000-0000-4000-8000-000000000003`).
- **단계**: `GET /patient_management_system/api/v1/patients/me/encounters/00020000-0000-4000-8000-000000000003/detail` 호출(김영수 토큰).
- **기대결과**: 404 `encounter_not_found`("진료 내역을 찾을 수 없습니다.") — 존재/비소유 구분 노출 금지(존재 200/비존재 404 누설 없음).
- **유형**: 권한·보안

### TC-E8-24: 미연결 계정 detail 요청 → 404
- **검증**: Story 8.2 AC5 미연결
- **역할/계정**: 가입만 한 미연결 계정 토큰
- **사전조건**: 임의 encounter UUID.
- **단계**: `GET /me/encounters/<any-uuid>/detail`.
- **기대결과**: 404(소유 0행 → None). (UI에선 펼침 진입 자체가 미연결 온보딩에 막혀 도달 안 함.)
- **유형**: 권한·보안

---

### ── 그룹 D: Story 8.3 — 수납·영수증(마이 탭) ──

### TC-E8-25: 마이 탭 — finalized 수납 리스트 최근순
- **검증**: FR-122 / Story 8.3 AC1
- **역할/계정**: 김영수 연결 계정
- **사전조건**: 환자 01 finalized 수납 R-...-01 4,500원(카드).
- **단계**: 하단 탭바 "마이"(`/portal`) 진입.
- **기대결과**: 인사 "내 진료비 · 영수증 / 결제를 마친 진료의 영수증을 보여 드려요." + 신뢰노트(결제 버전) 상시. 수납 카드: 날짜(12h KST)·"내과(또는 의원명) · 내과"·"납부 4,500원"·결제수단 "카드"·완료 배지 "✓ 완료"·셰브런 `›`. 카드 탭 → `/receipts/{encounter_id}`. 하단 계정 동작(본인 진료기록 연결·로그아웃) 유지.
- **유형**: 정상

### TC-E8-26: draft·cancelled 수납 제외(finalized만)
- **검증**: Story 8.3 AC4 (pay.status='finalized' 필터·설계결정 ③)
- **역할/계정**: 환자 연결 계정(draft/cancelled payment 보유 환자 — 별도 셋업 또는 통합테스트)
- **사전조건**: 본인 내원에 draft 또는 cancelled payment 존재.
- **단계**: 마이 탭 리스트 확인.
- **기대결과**: finalized만 노출, draft(집계중)·cancelled(취소) 미노출.
- **유형**: 경계

### TC-E8-27: 빈 수납 — "아직 결제 내역이 없어요"
- **검증**: Story 8.3 AC4 빈상태
- **역할/계정**: 수납 없는 환자 연결 계정(환자 07~20 중 연결)
- **사전조건**: 연결 환자 finalized 수납 0건.
- **단계**: 마이 탭 진입.
- **기대결과**: "아직 결제 내역이 없어요." 신뢰노트·계정 동작 유지.
- **유형**: 경계

### TC-E8-28: 미연결 계정 마이 탭 — 온보딩 유도
- **검증**: Story 8.3 AC4 미연결
- **역할/계정**: 미연결 신규 계정
- **사전조건**: 가입·세션, 미연결.
- **단계**: 마이 탭(`/portal`) 진입.
- **기대결과**: 제목 "내 진료비·영수증 보기", "결제 내역을 안전하게 보려면 먼저 본인 확인이 필요해요.", CTA "본인 진료기록 연결하기" → `/onboarding`. (`/me/payments`는 미연결도 200+빈배열이나, /self 404로 UI는 온보딩 유도.)
- **유형**: 예외

### TC-E8-29: 영수증 상세 — 친화 요약(총 진료비/건강보험/내가 낸 금액)
- **검증**: FR-122 / Story 8.3 AC2
- **역할/계정**: 김영수 연결 계정
- **사전조건**: 환자 01 R-...-01 영수증.
- **단계**: 마이 탭 수납 카드 탭 → `/receipts/{e01}`.
- **기대결과**: 뒤로가기 "< 마이로". "진료비 영수증" 제목. 요양기관/진료과/담당의/진료일. "진료 항목" 섹션 = 항목 대분류별 금액("진찰료" 등 category·"기타" 폴백). "총 진료비 {total}원" / "건강보험에서 낸 금액 {insurer}원" / "내가 낸 금액 {paid}원"(강조 primary). 결제수단 "카드 결제". 금액 전부 DB 산정값(클라 산술 금지)·KRW 정수·tabular-nums. 화면에 법정 serif 미사용.
- **유형**: 정상

### TC-E8-30: 영수증 인쇄 — 7.5 법정 서식 재사용(hidden print:block)
- **검증**: FR-122/FR-113 재사용 / Story 8.3 AC3
- **역할/계정**: 김영수 연결 계정
- **사전조건**: 영수증 상세 화면.
- **단계**: "영수증 인쇄·저장" 버튼 클릭 → 브라우저 인쇄 미리보기 확인.
- **기대결과**: `window.print()` 호출. 인쇄 미리보기에는 화면 친화요약은 숨고(`@media print` .receipt-paper) Batang serif 「국민건강보험법」 별지 서식(항목별 금액표·납부 3행)만 출력. `document.title`="영수증_{chart_no}"(PII 없음·이름/주민번호 금지). 인쇄 후 title 복원. 푸터 "「국민건강보험법」 별지 서식의 진료비 계산서·영수증으로 인쇄돼요."
- **유형**: 정상

### TC-E8-31: IDOR — 타인 영수증 → 404
- **검증**: FR-240 / Story 8.3 AC4 (and pat.auth_uid=$2 → None → 404)
- **역할/계정**: 김영수 연결 계정 토큰
- **사전조건**: 박정호 e03 UUID(본인 아님·finalized 존재).
- **단계**: `GET /me/encounters/00020000-0000-4000-8000-000000000003/receipt`(김영수 토큰).
- **기대결과**: 404(비소유 → None → receipt_not_found). 화면 직접 URL `/receipts/{타인uuid}` → "영수증을 찾을 수 없어요."
- **유형**: 권한·보안

### TC-E8-32: 비-finalized 영수증 → 404(직원 409와 분기)
- **검증**: Story 8.3 AC4 (self 비-finalized=404 일원화)
- **역할/계정**: 본인 내원에 draft payment 보유 환자 토큰
- **사전조건**: 본인 내원에 draft(미finalize) payment.
- **단계**: `GET /me/encounters/{draft내원}/receipt`.
- **기대결과**: **404**(직원 `/encounters/{id}/payment/receipt`는 409 invalid_transition이지만 self는 draft 존재 비노출 위해 404 일원화). 화면 "영수증을 찾을 수 없어요."
- **유형**: 권한·보안

### TC-E8-33: 영수증 PII 경계 — raw RRN 미노출, masked만
- **검증**: FR-240 / Story 8.3 AC5
- **역할/계정**: 김영수 연결 계정
- **사전조건**: 영수증 상세·인쇄.
- **단계**: 친화요약 화면·인쇄 서식·API 응답(ReceiptResponse) 전수 확인.
- **기대결과**: 친화요약 화면은 RRN 미표시. 법정 인쇄 재사용분만 masked RRN("750314-1******"). raw resident_no·연락처·_enc/_hash·finalized_by 절대 미투영. 라우트는 encounter_id(불투명 UUID).
- **유형**: 권한·보안

### TC-E8-34: 소프트삭제 내원 영수증 비대칭 차단(코드리뷰 patch)
- **검증**: Story 8.3 코드리뷰 patch (_SELF_RECEIPT_HEADER_SELECT + e.is_active=true)
- **역할/계정**: 본인 소프트삭제 내원 보유 계정 토큰
- **사전조건**: 본인 내원 is_active=false 처리(soft-delete) + 해당 내원 finalized payment.
- **단계**: 리스트(`/me/payments`)와 직접 영수증(`/me/encounters/{soft-deleted}/receipt`) 둘 다 확인.
- **기대결과**: 리스트에 없고(e.is_active 필터) 직접 URL도 404(비대칭 제거·일관).
- **유형**: 경계

### TC-E8-35: self-read 무감사 확인
- **검증**: Story 8.3 AC5 (환자 본인 열람·인쇄 감사 미적재)
- **역할/계정**: 김영수 연결 계정
- **사전조건**: 영수증 열람·인쇄 수행.
- **단계**: 열람/인쇄 전후 audit_logs 테이블 점검(해당 encounter document export 로그).
- **기대결과**: 환자 self 영수증 열람·인쇄는 `log_payment_document_export` 미호출·beforeprint 감사 미부착 → audit_logs 무변화(직원 7.5 내보내기 감사와 분리).
- **유형**: 권한·보안

---

### ── 그룹 E: Story 8.4 — 환자 앱 APK ──

### TC-E8-36: APK 산출물 존재·메타데이터 검증
- **검증**: NFR-011 / Story 8.4 AC1
- **역할/계정**: 빌드 환경(파일 시스템)
- **사전조건**: 8.4 빌드 완료.
- **단계**: `~/patient-portal-app-release-v1.0.0.apk` 존재 확인 + `aapt dump badging` 또는 README 메타 대조.
- **기대결과**: APK 존재(~43.6MB). package=`com.kuntae802.mobile`·versionName 1.0.0·versionCode 1·targetSdk 36·INTERNET 권한·label "환자 포털"·적응형 아이콘. debug 서명(사이드로드).
- **유형**: 정상

### TC-E8-37: 정적분석·셸 단위 테스트 그린
- **검증**: Story 8.4 AC3·Task 8
- **역할/계정**: 빌드 환경
- **사전조건**: `mobile/` Flutter 프로젝트.
- **단계**: `cd mobile && flutter analyze && flutter test`.
- **기대결과**: analyze 경고 0. test 11건 통과(config 스모크 + isInternalUrl 케이스 ≥7: 내부 https/http·baseUrl 자신·외부 도메인·tel·mailto·about:blank·경계 위장 `_x`·userinfo 컨퓨저블).
- **유형**: 정상

### TC-E8-38: 내비 정책 isInternalUrl — 내부/외부 분기
- **검증**: Story 8.4 AC2/AC3 (url_policy.dart isInternalUrl)
- **역할/계정**: 단위 테스트 / 실기기(사용자 수용)
- **사전조건**: baseUrl=`https://kuntae802.mooo.com/patient_management_system`.
- **단계**: 다음 URI 판정: (a) `https://kuntae802.mooo.com/patient_management_system/records`(내부) (b) `https://kuntae802.mooo.com/other_project`(공유호스트 타프로젝트) (c) `http://...`(다운그레이드) (d) `tel:01012345678` (e) `mailto:x@y` (f) `https://google.com` (g) `https://kuntae802.mooo.com/patient_management_system_x`(경계위장).
- **기대결과**: (a) true(navigate). (b)(c)(d)(e)(f)(g) false(prevent) — scheme+host+경로프리픽스 일치 필요·`_x` 위장 제외·http 다운그레이드 차단.
- **유형**: 권한·보안

### TC-E8-39: 하드웨어 뒤로가기 — 웹 히스토리 추종, 루트만 종료
- **검증**: Story 8.4 AC3 (PopScope·canGoBack)
- **역할/계정**: 실기기/에뮬레이터 (사용자 수용 단계)
- **사전조건**: APK 설치·포털 로드.
- **단계**: 여러 화면 이동(예약→내 기록→상세) 후 하드웨어 뒤로가기 반복.
- **기대결과**: 웹뷰 히스토리 역추적(goBack), 루트(첫 화면)에서만 앱 종료(SystemNavigator.pop). 즉시 종료(토이) 아님.
- **유형**: 정상 (런타임 한계 — 사용자 수용)

### TC-E8-40: 로딩 인디케이터·네트워크 오류 재시도
- **검증**: Story 8.4 AC2/AC3 (NavigationDelegate·_ErrorView)
- **역할/계정**: 실기기 (사용자 수용 단계)
- **사전조건**: APK 설치.
- **단계**: (a) 페이지 로드 중 스피너 확인. (b) 비행기모드/도메인 다운 상태로 콜드스타트 → 오류화면 → 비행기모드 해제 → "다시 시도".
- **기대결과**: 로딩 중 중앙 CircularProgressIndicator. 메인프레임 오류 시 _ErrorView(아이콘+한국어 안내+"다시 시도"). "다시 시도"는 `loadRequest(baseUrl)`로 항상 base 재시도(콜드스타트 오프라인 복구·코드리뷰 patch). 흰 화면 없음.
- **유형**: 예외 (런타임 한계 — 사용자 수용)

### TC-E8-41: 로그인·세션 지속(웹뷰 내)
- **검증**: NFR-011 / Story 8.4 AC2
- **역할/계정**: 환자 계정 (실기기 사용자 수용)
- **사전조건**: APK 설치, signInWithPassword(이메일/비번 — OAuth/콜백 없음).
- **단계**: 앱에서 로그인 → 본인 내원·처방·검사·수납 조회 → 앱 종료 후 재실행.
- **기대결과**: 로그인 성공·조회 정상. 앱 재실행 후 세션 지속(Android WebView 쿠키 기본 지속). config baseUrl·additional_redirect_urls·nginx WS 정적 검증 완료.
- **유형**: 정상 (런타임 한계 — 사용자 수용)

### TC-E8-42: 알려진 한계 — window.print() 미동작
- **검증**: Story 8.4 (문서화된 한계)
- **역할/계정**: 실기기 (사용자 수용)
- **사전조건**: APK·영수증 상세.
- **단계**: "영수증 인쇄·저장" 탭.
- **기대결과**: Android WebView 기본 `window.print()` 미동작(README "알려진 한계" 명시·범위 밖). 앱 크래시 없음. (웹 브라우저에선 정상 동작 — TC-E8-30.)
- **유형**: 경계 (문서화된 한계)

---

### ── 그룹 F: Story 8.5 — 운영 대시보드 ──

### TC-E8-43: 대시보드 진입 + 당일 KPI 표시
- **검증**: FR-230 / Story 8.5 AC1
- **역할/계정**: admin@pms.local / Staff1234
- **사전조건**: `supabase db reset` + demo_seed(v_today 기준 데이터). admin은 dashboard.read 보유.
- **단계**: 사이드바 "관리 > 운영/대시보드"(`/admin/dashboard`) 클릭.
- **기대결과**: 제목 "운영 대시보드 / 오늘 내원·대기·매출·노쇼율 현황...". "{KST 오늘} 기준". KPI 카드 6종: 내원 N명·대기 N명·진료중 N명·완료 N명·순수납액 {원}·노쇼율 {%}(상세 "no_show/total건"). 추세 3종(일별 내원·일별 순수납액·일별 노쇼율). 색/음영 비의존(값·라벨 병기). read-only(쓰기 액션 0).
- **유형**: 정상

### TC-E8-44: 권한 게이트 이중 — dashboard.read 미보유 직원
- **검증**: FR-230/FR-240 / Story 8.5 AC1·AC2
- **역할/계정**: dashboard.read 없는 직원(예: 원무/간호 — admin 외)
- **사전조건**: 비-admin 직원 로그인.
- **단계**: (a) 사이드바에 "운영/대시보드" 노출 여부. (b) 직접 URL `/admin/dashboard`. (c) API `GET /v1/dashboard/operations` 직접 호출.
- **기대결과**: (a) 메뉴 미노출(filterNav·roles:["admin"]+dashboard.read). (b) 서버 가드 requirePermission → `/home` redirect(STAFF_HOME). (c) 403 `{error:{code:"forbidden", detail:{required_permission:"dashboard.read"}}}`.
- **유형**: 권한·보안

### TC-E8-45: 미인증 API 호출 → 401
- **검증**: Story 8.5 AC2
- **역할/계정**: 토큰 없음
- **사전조건**: 없음.
- **단계**: `GET /patient_management_system/api/v1/dashboard/operations`(Authorization 헤더 없이).
- **기대결과**: 401(미인증). 봉투 `{error:{code,message,...}}`.
- **유형**: 권한·보안

### TC-E8-46: 순수납액 정확성 — Σ(paid − refunded), KST 일자
- **검증**: FR-230 / Story 8.5 AC3
- **역할/계정**: admin
- **사전조건**: demo_seed finalized 수납 e01~e06(completed_at=과거일 KST). 추세 윈도우 14일.
- **단계**: 추세 "일별 순수납액"의 과거일 막대 값 확인 + (가능 시) DB Σ 대조.
- **기대결과**: 일자별 순수납액 = Σ(paid_amount_krw − coalesce(refunded,0)) where finalized & finalized_at KST 일자. (예: demo_seed 회귀 검증값 06-20 매출 9300·06-22 매출 14900 등 — 클린 reset 기준.) 막대에 수치+일자(MM.DD) 병기.
- **유형**: 정상

### TC-E8-47: refunded 차감 — 환급 시 순수납액 감소
- **검증**: Story 8.5 AC3 (8.5=refunded 첫 리포팅 소비처)
- **역할/계정**: admin + 환급 처리(직원 7.9)
- **사전조건**: finalized 수납 1건에 부분 환급(refunded_amount_krw > 0) 부여.
- **단계**: 환급 전/후 대시보드 해당 일자 순수납액 비교.
- **기대결과**: 순수납액이 환급액만큼 차감 반영(원 finalize 일자에 귀속·데모 단순화). refunded ≤ paid 제약.
- **유형**: 경계

### TC-E8-48: KST 일자 경계 — 23:30 UTC = 익일 KST 귀속
- **검증**: Story 8.5 AC3 (col at time zone 'Asia/Seoul')
- **역할/계정**: admin (또는 통합테스트)
- **사전조건**: finalized_at=23:30 UTC인 수납(=익일 08:30 KST)·registered_at 자정 넘김 내원.
- **단계**: 해당 건이 어느 일자 추세/스냅샷에 귀속되는지 확인.
- **기대결과**: 23:30 UTC 건은 익일 KST 일자에 귀속(매출·내원·노쇼 전부). 스냅샷 completed도 registered_at 코호트로 정렬(내원=대기+진료중+완료 불변식 유지·자정넘김 "완료>내원" 모순 없음·코드리뷰 patch).
- **유형**: 경계

### TC-E8-49: 노쇼율 divide-by-zero — 예약 0인 날 = 0(NaN 아님)
- **검증**: Story 8.5 AC3 (_no_show_rate 분모 0 가드)
- **역할/계정**: admin
- **사전조건**: 추세 윈도우 내 슬롯 도래 0인 날(no_show+completed=0).
- **단계**: 해당 날 노쇼율 확인.
- **기대결과**: 노쇼율 = 0.0(NaN·나눗셈 오류 없음). 분모 = no_show+completed(cancelled·booked 제외).
- **유형**: 경계

### TC-E8-50: 노쇼율 분자/분모 정의 — appointments.status 단일 진실
- **검증**: Story 8.5 AC3
- **역할/계정**: admin
- **사전조건**: demo_seed 노쇼 예약 ap05(-6)·ap06(-4)·ap07(-5)·cancelled ap08(-3)·ap09(-2)·completed ap01~04.
- **단계**: 추세 "일별 노쇼율" 해당 일자 + 당일 노쇼율 검증.
- **기대결과**: 노쇼율 = no_show / (no_show + completed)(scheduled_start KST). cancelled(능동취소)·booked(미도래) 분모 제외. encounters.no_show 아닌 appointments.status='no_show'가 단일 진실(0036). 노쇼율 100%일 때(예: -6일 ap05 단독) rate=1.0.
- **유형**: 정상

### TC-E8-51: 당일 스냅샷 — 내원=대기+진료중+완료 불변식
- **검증**: Story 8.5 AC3 (코드리뷰 patch·registered_at 코호트)
- **역할/계정**: admin
- **사전조건**: demo_seed 당일 내원(e07~e11 registered·일부 in_progress) — registered_at=오늘.
- **단계**: KPI 카드 내원/대기/진료중/완료 합산 확인.
- **기대결과**: 당일 내원(visits) = 당일 registered_at 코호트 중 registered/in_progress/completed. waiting+in_progress+completed가 당일 코호트 현재 상태 합과 정합(불변식). 과거일 질의 시 대기/진료중 ~0 수렴(문서화된 수용 단순화).
- **유형**: 경계

### TC-E8-52: 빈 데이터 — 전부 0/— 안전 렌더
- **검증**: Story 8.5 AC4 빈상태
- **역할/계정**: admin
- **사전조건**: demo_seed 미적용(빈 DB) 또는 데이터 없는 미래 date 쿼리(`?date=2030-01-01`).
- **단계**: 대시보드 진입 / API `?date=2030-01-01`.
- **기대결과**: 모든 KPI 0, 노쇼율 0.0, 추세 막대 0 또는 "표시할 데이터가 없습니다."(누락 일자 0 채움). 크래시·빈 화면 없음.
- **유형**: 경계

### TC-E8-53: days 윈도우 파라미터 경계(1~90 클램프)
- **검증**: Story 8.5 (라우터 Query ge=1 le=90 + 서비스 클램프 방어심층)
- **역할/계정**: admin
- **사전조건**: 없음.
- **단계**: `?days=0`·`?days=200`·`?days=7`·`?days=-5`.
- **기대결과**: days=0/-5 → 422(라우터 ge=1) 또는 서비스 max(1,...) 정규화. days=200 → 422(le=90) 또는 클램프 90. days=7 → 7일 추세. as_of_date·daily_series 길이 = 정규화된 days.
- **유형**: 경계

### TC-E8-54: date 파라미터 신뢰 금지 + 파싱 오류
- **검증**: Story 8.5 AC2/AC3 (서버 KST 오늘 결정·date 파싱)
- **역할/계정**: admin
- **사전조건**: 없음.
- **단계**: (a) date 미지정. (b) `?date=2026-06-20`. (c) `?date=not-a-date`.
- **기대결과**: (a) as_of_date=KST 오늘(서버 결정·클라 신뢰 안 함). (b) 해당 일자 스냅샷·추세. (c) 422(date 파싱 실패).
- **유형**: 경계

### TC-E8-55: 대시보드 PII 부재 + read-only
- **검증**: FR-240/Story 8.5 AC2·AC4
- **역할/계정**: admin
- **사전조건**: 데이터 보유 대시보드.
- **단계**: 화면·API 응답 전수 확인.
- **기대결과**: 집계 수치(count/sum/비율)만. 환자명·차트번호·주민번호 등 PII 응답/URL/로그 미포함. 쓰기/상태전이 액션·POST·mutation 버튼 0(read-only). 금액 KRW 정수·날짜 KST(formatKstDate "2026년 06월 24일")·24h.
- **유형**: 권한·보안

### TC-E8-56: 대시보드 로드 실패 — 에러·재시도
- **검증**: Story 8.5 AC4 (operations-dashboard 에러 처리)
- **역할/계정**: admin
- **사전조건**: API 다운/오류 유발(또는 네트워크 차단).
- **단계**: 대시보드 진입.
- **기대결과**: 로딩 중 스켈레톤(aria-busy). 실패 시 "운영 통계를 불러오지 못했습니다." + "다시 시도" 버튼. 크래시 없음.
- **유형**: 예외

---

## FR 커버리지 체크

| 담당 FR | 커버 시나리오 | 비고 |
|---|---|---|
| FR-120 환자 본인 내원이력(예약·진찰·진단) | TC-E8-08~16 | 카드·진단 쉬운말(0054)·상태분기·빈/미연결·self-scope |
| FR-121 본인 처방·검사결과 | TC-E8-17~24 | 복약 쉬운말·검사 정상/주의(0055)·findings 비노출·IDOR 404 |
| FR-122 본인 수납내역·영수증 | TC-E8-25~35 | finalized 리스트·친화요약·법정인쇄·IDOR·비-finalized 404·무감사 |
| FR-230 관리자 운영현황 대시보드 | TC-E8-43~56 | KPI·추세·KST·refunded·divide-by-zero·권한 이중·빈상태·read-only |
| FR-240 RLS(환자 본인만)·self-read | TC-E8-07,16,20,23,24,31,32,33,44,55 | auth_uid=$1·소유검증→404·findings/PII 차단·직원 403·dashboard 권한 |
| NFR-011 환자 Android APK | TC-E8-36~42 | 빌드 산출물·analyze/test·isInternalUrl·뒤로가기·로딩/오류·세션·print 한계 |
| (사전조건) FR-001/003 signup·self-link | TC-E8-01~06 | 포털 전 시나리오의 선행·매칭(blind_index+성명)·1계정1환자 |

---

## 실행 메모

- **포털 검증 순서**: TC-E8-01(김영수 연결)을 먼저 수행해야 그룹 B/C/D 풀스택 검증 가능. 검사 정상/주의(TC-E8-19)·다중진단(TC-E8-10)·영상검사는 박정호(03)·한지영(06) 별도 가입+self-link 필요(각 환자마다 새 이메일 계정).
- **자동 테스트 매핑**: API 통합테스트 `test_patient_encounters_integration.py`·`test_patient_encounter_detail_integration.py`·`test_patient_payments_integration.py`·`test_dashboard_integration.py`가 self-scope·IDOR·refunded·KST·divide-by-zero를 이미 커버(클린 reset 기준 API 973·web 541 통과). 수동 E2E는 화면 UX·인쇄·APK 셸 위주.
- **db reset 함정(8.2 메모리)**: `supabase db reset` 직후 auth(gotrue)/kong 재시작 윈도우에 502·테스트 대량 skip 발생 가능 — 회귀 아님. docker restart + 토큰 폴링 후 재실행.
- **APK 런타임 한계**: TC-E8-39~42는 Android 실기기/에뮬레이터 필요(이 환경 불가) — 사용자 수용 단계로 표기.
