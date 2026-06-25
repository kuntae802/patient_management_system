# Epic 7: 수납·정산·문서 — 테스트 시나리오

## 에픽 개요

Epic 7은 진료에서 자동발생한 수가(fee_items)를 **수납 건(payments 헤더 + payment_details 라인)으로 집계 → 본인부담 산정 → finalize(결제·내원완료) → 법정 문서 출력(영수증/세부내역서/원외처방전)**까지 이어지는 정산 도메인이다. 핵심 설계 원칙:

- **수가/정산/상태머신 로직은 전부 DB가 소유**(project-context NFR-041). API/web은 호출·표시만, 금액 재계산 금지.
- **2계층 수가 모델**: `fee_items`(임상 적재·0021/5.10) ≠ `payment_details`(수납 집계·0045/7.1).
- **수가 자동발생 = perform 시점에만**: 진찰료=registered→in_progress(start_consult), 검사/영상/처치료=ordered→performed. 처방 발행 시 fee_item 0(약가 없음·원외 약국 소관).
- **finalize 한 트랜잭션 = build_payment → price_payment → finalize_payment → complete_encounter**(원자·중간 실패 롤백).
- **취소·노쇼 수가 미발생은 구조적**: 취소는 진찰 전(scheduled/registered)에서만 가능 → fee_items 구조적 0. 부분수행 정산도 구조적: 미수행(ordered) 오더는 fee_item 0 → build_payment가 자동 제외.
- **문서 = 브라우저 인쇄**(window.print + @media print Batang serif). 인쇄/PDF 직전 `beforeprint` 이벤트가 export 감사 RPC 호출(UX-DR22 "내보내기 자체가 감사 이벤트").
- **권한**: 워크리스트 조회=`payment.read`(doctor+reception), 상세/쓰기=`payment.manage`(reception only), 처방 발급/출력=`prescription.dispense`(reception+admin). nurse는 수납 권한 0.

### 데모 계정 (전부 비밀번호 Staff1234)
| 계정 | 역할 | 수납 관련 권한 |
|---|---|---|
| reception@pms.local | reception | payment.read, payment.manage, encounter.complete, encounter.cancel, prescription.dispense, fee_item.read |
| doctor@pms.local | doctor | payment.read, fee_item.read (manage 없음 — 읽기 전용) |
| nurse@pms.local | nurse | **수납 권한 전무**(403 baseline) |
| admin@pms.local | admin | 전 권한 |

### 데모 시드 상태 (demo_seed.sql)
| 내원 | 환자 | 보험유형 | 최종 상태 | 수납 상태 | 용도 |
|---|---|---|---|---|---|
| e01~e06 | 김영수/이미경/박정호/최수진/정대현/한지영 | 대부분 health_insurance, e05=self_pay | completed | **finalized**(payment_no R-…-01~06·하드코딩 total=copay=paid) | 영수증/세부내역서/처방전 출력 테스트 |
| **e07** | 오세훈 | health_insurance | **in_progress** | **payment 행 없음**(진찰료만) | build→finalize 정상 흐름 테스트 |
| **e08** | 윤서아 | health_insurance | **in_progress** | **payment 행 없음** | **부분수행** 테스트(미수행 x04 영상 + t03 처치 보유) |
| e09/e10/e11 | 임재욱/강민지/송준호 | health_insurance ×2, e11=medical_aid | **registered** | payment 없음 | **취소·노쇼 정산(7.9)** + 선수납(7.8) 테스트 |

⚠️ **시드 finalized 6건(e01~06)은 total==copay==paid 하드코딩 데모값** — 실제 copay 산정(30%/15%/0%/100%·10원 절사)이 아니다. 본인부담 산정 검증은 반드시 e07/e08을 build→price→finalize 하거나 신규 내원을 만들어 확인할 것.

⚠️ **수가 시드 핵심값**: 초진 AA154=17,610 / 재진 AA254=12,590 (둘 다 covered·진찰료). 비급여 항목 = F6310 알레르기검사 8,000 / MM070 핫팩 2,300 / MM151 TENS 3,200 (단 demo_seed엔 비급여 오더 없음 → 비급여 본인부담 100% 검증은 수동 오더 필요). 자보(0% copay)는 문가은(p16)에 내원 신규 생성 필요(demo 내원 없음).

⚠️ **워크리스트 일자 필터** = `created_at`의 KST 날짜(consult 시작이 아님). demo_seed 내원은 v_today(오늘) 생성 → 기본(오늘) 워크리스트에 노출. 과거 날짜 테스트 시 `?date=` 쿼리.

---

## 스토리 ↔ FR ↔ 구현 매핑

| 스토리 | 기능 | 커버 FR | 핵심 구현 |
|---|---|---|---|
| 7.1 | 수납 스키마·수가매핑·초진/재진 동적 | FR-110, FR-116 | 0045_payments(payments·payment_details·payment.read·RLS·CHECK), fee_on_encounter_start 재정의(초진/재진), insert_fee_item 재정의(만료수가 제외) |
| 7.2 | 수납 건 생성·집계 | FR-110 | 0046 build_payment(fee_items→payment_details 멱등·헤더 롤업), payment.manage 권한, `POST/GET .../payment`, 워크리스트 |
| 7.3 | 급여/비급여 구분·본인부담 산정 | FR-111 | 0047 copay_policies(8행)·price_payment(라인 copay/insurer·10원 절사·insurer=차액) |
| 7.4 | 수납 처리·내원 완료 | FR-112 | 0048 finalize_payment(결제 컬럼·payment_no_seq·complete_encounter·finalized_consistency CHECK) |
| 7.5 | 진료비 계산서·영수증 출력 | FR-113 | 0049 clinic_profile·log_payment_document_export, `GET .../receipt`·`POST .../receipt/export`, receipt-document.tsx(3행합계·category 집계) |
| 7.6 | 세부산정내역서 출력 | FR-114 | (마이그 0·7.5 재사용) statement-document.tsx(10열 라인표), document_type='statement' |
| 7.7 | 원외처방전 출력·발급 | FR-115 | 0050 dispense_prescription·log_prescription_document_export·prescription.dispense, orders.py 엔드포인트 3종, prescription-document.tsx |
| 7.8 | 후수납/선수납 정책 | FR-117 | 0051 prepay_payment(누적·billing_type=prepaid)·finalize 재정의(paid=greatest(copay,paid)), `POST .../payment/prepay` |
| 7.9 | 취소·노쇼 정산·수가 미발생 | FR-118 | 0052 settle_cancelled_visit(cancel_encounter+void+refund)·refunded_amount_krw·cancelled_consistency CHECK, `POST .../payment/cancel` |
| 7.10 | 부분수행 정산·오더-내원상태 게이트 | FR-119 | 0053 assert_encounter_orderable+BEFORE INSERT 트리거 3종+perform RPC 재정의, pending_orders_count 배지 |

---

## 테스트 시나리오

### TC-E7-01: 진찰 시작 시 진찰료 자동발생(초진/재진 동적 판정)
- **검증**: FR-116 / Story 7.1
- **역할/계정**: doctor@pms.local(진찰 시작), reception@pms.local(수가 확인)
- **사전조건**: registered 상태 내원(e09 임재욱·health_insurance·과거 완료 내원 없음=초진 후보). 비교용으로 과거 완료 내원이 있는 환자(예 김영수 신규 내원)도 준비.
- **단계**:
  1. doctor 로그인 → 진료 허브에서 e09(임재욱) 진찰 시작(start_consult, registered→in_progress).
  2. reception 로그인 → 수납 워크리스트에서 임재욱 진입 → 수납 상세.
  3. 수납 상세 본 화면 진입 시 자동 build_payment 호출됨을 확인.
- **기대결과**: 임재욱(초진 = 과거 완료 내원 없음) 수납 상세에 `초진진찰료(의원) AA154 17,610원` 라인 1건이 `자동` 마커와 함께 표시. 과거 완료 내원이 있는 환자라면 `재진진찰료(의원) AA254 12,590원`. 총 진료비=진찰료 금액. coverage=급여.
- **유형**: 정상

### TC-E7-02: 검사·처치 수행 시 검사료/처치료 자동발생
- **검증**: FR-116 / Story 7.1
- **역할/계정**: nurse/radiologist(수행), reception(확인)
- **사전조건**: in_progress 내원에 ordered 상태 검사·처치 오더 존재(e08 윤서아: x04 흉부촬영 HA201, t03 네뷸라이저 NA240).
- **단계**:
  1. radiologist → x04(흉부 단순촬영) 수행(perform_examination, ordered→performed).
  2. nurse → t03(네뷸라이저) 수행(perform_treatment_order).
  3. reception → 윤서아 수납 상세 재진입.
- **기대결과**: 수납 상세에 진찰료 + `흉부 단순촬영(1매) HA201 9,030원`(영상료) + `네뷸라이저 NA240 2,800원`(처치료) 추가 집계. 각 라인 `자동` 마커. 미수행이었던 항목이 수행 후 build_payment 재호출로 추가됨(멱등 추가).
- **유형**: 정상

### TC-E7-03: 처방 발행은 수가 미발생(약가 없음)
- **검증**: FR-116(경계) / Story 7.1
- **역할/계정**: doctor(처방 발행), reception(확인)
- **사전조건**: in_progress 내원.
- **단계**:
  1. doctor → 처방 발행(prescription create·issued).
  2. reception → 해당 내원 수납 상세.
- **기대결과**: 처방 발행만으로는 fee_item·payment_details 라인이 **생성되지 않음**(약제비=원외 약국 스코프아웃). 진찰료 등 다른 수행분만 집계.
- **유형**: 경계

### TC-E7-04: 만료·비활성 수가는 신규 적재 제외
- **검증**: FR-116(경계) / Story 7.1
- **역할/계정**: admin(수가 마스터 비활성화), doctor/reception
- **사전조건**: fee_schedules 한 코드의 is_active=false 또는 effective_to가 과거가 되도록 설정(직접 DB 조작 또는 마스터 UI).
- **단계**:
  1. 특정 수가(예 검사료 코드)를 비활성/만료 처리.
  2. 그 수가에 해당하는 오더를 수행.
  3. reception → 수납 상세 확인.
- **기대결과**: 만료/비활성 수가는 fee_items에 적재되지 않음(insert_fee_item이 is_active·effective 윈도우 검증·no-op). 이미 적재된 라인의 스냅샷 금액은 보존(차단 대상은 신규 적재만).
- **유형**: 경계

### TC-E7-05: 수납 워크리스트 — 정산 대상(in_progress)·선수납 대상(registered) 노출
- **검증**: FR-110 / Story 7.2, 7.8
- **역할/계정**: reception@pms.local
- **사전조건**: 오늘 생성된 in_progress 내원(e07/e08)과 registered 내원(e09/e10/e11) 존재.
- **단계**:
  1. reception 로그인 → `/reception/billing`(수납 메뉴).
  2. 워크리스트 행 확인.
- **기대결과**: 헤더 `수납 대상 내원`. registered 내원 = `● 접수 · 선수납 가능`(amber) 칩, in_progress = `◐ 진찰중 · 정산 대상`(neutral) 칩. 각 행에 환자명·차트번호·`내원번호 · 진료과 · 진찰 HH:MM`·예상 총액(Σ fee_items·registered는 0원). 진료과 무관(병원 단위). 정렬=진찰 시작순(registered는 nulls last).
- **유형**: 정상

### TC-E7-06: 수납 건 자동집계 멱등성(재진입 시 중복 적재 없음)
- **검증**: FR-110 / Story 7.2
- **역할/계정**: reception@pms.local
- **사전조건**: 수가가 집계된 draft 수납 건(e07).
- **단계**:
  1. reception → e07 수납 상세 진입(build_payment 1회).
  2. 라인 수·금액 기록.
  3. 목록으로 나갔다 다시 진입(build_payment 재호출).
  4. 그 사이 신규 오더 수행 후 또 재진입.
- **기대결과**: 기존 라인·금액 불변, 중복 라인 0(on conflict do nothing). 3단계에서 재호출해도 동일. 4단계에서 새로 수행된 수가만 추가 집계. 헤더 total/covered/non_covered가 라인 합과 항상 정합.
- **유형**: 정상·경계

### TC-E7-07: nurse는 수납 상세 진입 차단(payment.manage 403)
- **검증**: 권한·보안 / Story 7.2
- **역할/계정**: nurse@pms.local
- **사전조건**: nurse 로그인.
- **단계**:
  1. nurse → `/reception/billing` 직접 URL 접근(워크리스트는 payment.read 필요).
  2. nurse → `/reception/billing/{encounterId}` 직접 URL 접근(payment.manage 필요).
  3. API 직접 호출 `POST /v1/encounters/{id}/payment`(nurse 토큰).
- **기대결과**: 1·2단계 모두 STAFF_HOME으로 리다이렉트(서버 가드 requirePermission). 3단계 API는 **403**(`required_permission: payment.manage`·db has_permission 동일 txn 재평가). build_payment RPC는 service_role 전용이라 직접 호출도 차단.
- **유형**: 권한·보안

### TC-E7-08: doctor는 워크리스트 조회만 가능, 상세(쓰기)는 차단
- **검증**: 권한·보안 / Story 7.1, 7.2
- **역할/계정**: doctor@pms.local
- **사전조건**: doctor는 payment.read 보유, payment.manage 미보유.
- **단계**:
  1. doctor → `/reception/billing` 워크리스트 접근.
  2. doctor → 수납 상세 URL 직접 접근.
  3. API `GET /v1/encounters/{id}/payment`(doctor) vs `POST .../payment`(doctor).
- **기대결과**: 1단계 워크리스트는 조회 가능(payment.read). 2단계 상세는 리다이렉트(payment.manage 필요). 3단계: GET 200(read), POST 403(manage).
- **유형**: 권한·보안

### TC-E7-09: 본인부담 산정 — 건강보험 급여 30% + 10원 절사
- **검증**: FR-111 / Story 7.3
- **역할/계정**: reception@pms.local
- **사전조건**: health_insurance 환자의 draft 수납(e07 오세훈·초진 17,610 또는 재진 12,590).
- **단계**:
  1. reception → e07 수납 상세 진입(build→price 자동).
  2. 헤더 `본인부담금`, `급여`, `비급여`, `공단부담금` 확인.
  3. 라인별 copay 확인.
- **기대결과**: 진찰료 17,610(초진) → copay = floor(17,610×0.300/10)×10 = floor(528.3)×10 → 5,280원(절사). insurer = 17,610 − 5,280 = 12,330. 재진 12,590 → copay = floor(377.7)×10 = 3,770, insurer=8,820. 헤더 copay_amount_krw = Σ라인 copay, insurer = Σ라인 insurer, total = copay + insurer 정합. footnote `건강보험 기준 급여 본인부담률…`.
- **유형**: 정상·경계(절사)

### TC-E7-10: 본인부담 산정 — 의료급여 15%, 자동차보험 0%, 일반(self_pay) 100%
- **검증**: FR-111 / Story 7.3
- **역할/계정**: reception@pms.local
- **사전조건**: medical_aid(송준호 e11·진찰 시작 필요), self_pay(정대현·신규 내원 또는 e05), auto_insurance(문가은 p16·신규 내원) 환자 draft 수납.
- **단계**: 각 보험유형 환자를 진찰 시작 후 수납 상세에서 진찰료(재진 12,590 가정) copay 확인.
- **기대결과**:
  - 의료급여 0.150: copay = floor(12,590×0.150/10)×10 = floor(188.85)×10 = 1,880, insurer=10,710.
  - 자동차보험 0.000: copay = 0(전액 공단), insurer = 12,590(rate<=0 분기).
  - self_pay 1.000: copay = 12,590(전액 본인·rate>=1 분기 절사 미적용), insurer = 0.
- **유형**: 정상·경계

### TC-E7-11: 비급여 항목은 보험유형 무관 본인 전액
- **검증**: FR-111 / Story 7.3
- **역할/계정**: doctor(비급여 오더), reception(확인)
- **사전조건**: health_insurance 내원에 비급여 항목 오더 수행(F6310 알레르기검사 8,000 / MM070 핫팩 2,300 / MM151 TENS 3,200 중 1).
- **단계**:
  1. doctor → 비급여 검사/처치 오더, 수행.
  2. reception → 수납 상세에서 해당 라인 확인.
- **기대결과**: 비급여 라인 = `비급여` 칩(PayChip). copay_rate=1.000 → copay = amount 전액(예 F6310 8,000원 전액 본인부담), insurer=0. 헤더 `비급여` 금액에 합산, `급여`엔 미포함. 건강보험이어도 비급여는 100% 본인부담.
- **유형**: 정상·경계

### TC-E7-12: 급여/비급여 혼합 내원의 헤더 정합성
- **검증**: FR-111 / Story 7.3
- **역할/계정**: reception@pms.local
- **사전조건**: 급여(진찰료·검사료) + 비급여(F6310 등) 혼합 수행된 health_insurance 내원.
- **단계**: 수납 상세에서 헤더 4개 금액(총/급여/비급여/공단) + 본인부담금 확인.
- **기대결과**: 총 = 급여 + 비급여. 급여분 copay=30%·비급여분 copay=100%. 본인부담금 = Σ(급여 copay 10원절사) + Σ(비급여 전액). 공단부담금 = 급여 insurer 합. total = copay + insurer.
- **유형**: 정상

### TC-E7-13: finalize 정상 — payment_no 부여·내원 완료·전액 정산
- **검증**: FR-112 / Story 7.4
- **역할/계정**: reception@pms.local
- **사전조건**: 주상병이 지정된 in_progress 내원의 draft 수납(e07·주상병 확인). e07 진찰료만 있으면 total>0.
- **단계**:
  1. reception → e07 수납 상세.
  2. 결제 수단 토글(카드/현금/계좌이체) 선택.
  3. `결제·내원 완료` 버튼 클릭 → 확인 다이얼로그(`결제·내원 완료 확인`·환자명·차트번호·금액·결제수단·`완료 후 취소할 수 없습니다`).
  4. 확인.
- **기대결과**: 토스트 `결제·내원 완료되었습니다 · 영수증 R-YYYYMMDD-NNNNNN`. payment status=finalized, payment_no 형식 `R-` + KST 8자리 날짜 + `-` + 6자리 제로패딩 시퀀스. paid_amount_krw = copay_amount_krw(전액 정산). 내원 status=completed(complete_encounter). 결제 완료 패널에 영수증번호·결제수단·납부액·결제일시 표시. PaymentStatusBadge `✓ 완료`.
- **유형**: 정상

### TC-E7-14: finalize 멱등/이중결제 차단(409)
- **검증**: FR-112(예외) / Story 7.4
- **역할/계정**: reception@pms.local
- **사전조건**: 이미 finalized 된 수납(e01~e06 또는 TC-13 결과).
- **단계**:
  1. finalized 내원의 수납 상세 진입 → finalize 버튼이 노출되지 않음(결제 완료 패널만).
  2. API 직접 `POST /v1/encounters/{id}/payment/finalize`(이미 finalized).
- **기대결과**: UI는 재finalize 버튼 없음. API는 **409**(invalid_transition·`% -> finalized`·status≠draft). 이중결제·재finalize 구조적 차단(비가역). build_payment도 finalized면 라인 동결.
- **유형**: 예외·경계

### TC-E7-15: 주상병 미지정 내원 finalize 차단(422)
- **검증**: FR-112(예외) / Story 7.4
- **역할/계정**: doctor(주상병 미부착 진찰), reception(finalize 시도)
- **사전조건**: in_progress 내원에 주상병(is_primary) 진단이 없음.
- **단계**:
  1. reception → 해당 내원 수납 상세.
  2. `결제·내원 완료` 시도.
- **기대결과**: **422**(primary_diagnosis_required·complete_encounter의 PT422 게이트). 토스트 `주상병이 지정되지 않았습니다. 의사 진단 완료 후 다시 시도하세요.` 전체 트랜잭션 롤백(payment finalized 안 됨). 의사가 주상병 부착 후 재시도 시 성공.
- **유형**: 예외

### TC-E7-16: 정산 대상 0(수가 없는 내원) finalize 차단(409)
- **검증**: FR-112(경계) / Story 7.4
- **역할/계정**: reception@pms.local
- **사전조건**: total_amount_krw=0인 내원(registered·진찰 전, 또는 수가 미발생 in_progress).
- **단계**:
  1. registered 내원(e09) 수납 상세 진입.
  2. 화면에서 `결제·내원 완료` 버튼 대신 `진찰·수행 후 수가가 산정되면…` 안내 + `내원 취소` 버튼만 노출됨 확인.
  3. API 직접 `POST .../payment/finalize`(total=0).
- **기대결과**: UI는 total=0이면 finalize 버튼 미노출. API는 **409**(`no billable items`·v_total<=0). 빈 내원 결제 차단.
- **유형**: 예외·경계

### TC-E7-17: finalize 멀티스텝 원자성(build→price→finalize→complete 롤백)
- **검증**: FR-112·NFR-041 / Story 7.4
- **역할/계정**: reception@pms.local
- **사전조건**: 주상병 미지정 in_progress 내원(complete_encounter 단계에서 실패 유발).
- **단계**:
  1. finalize 시도 → 422 실패.
  2. 같은 내원의 수납 상태·내원 상태 재확인.
- **기대결과**: finalize 실패 시 payment는 여전히 draft(status·payment_no·finalized_at 변경 안 됨), 내원도 in_progress 유지. build/price가 앞서 실행됐어도 동일 txn 롤백. 부분 finalize 없음(finalized_consistency CHECK도 보장).
- **유형**: 경계

### TC-E7-18: 영수증 출력 — 3행 합계·항목별 금액표·요양기관 정보
- **검증**: FR-113 / Story 7.5
- **역할/계정**: reception@pms.local
- **사전조건**: finalized 수납(e01 김영수 등).
- **단계**:
  1. reception → e01 수납 상세 → `문서 출력 (진료비 계산서·영수증 · 세부산정내역서)` 버튼.
  2. 문서 미리보기 → 탭 `진료비 계산서·영수증` 활성.
  3. 영수증 본문 확인.
- **기대결과**: 제목 `진료비 계산서 · 영수증`(Batang serif). 요양기관 = ○○의원·사업자번호 123-45-67890·요양기관기호 31234567·주소·대표자 박○○·전화 02-123-4567. 환자 = 성명·차트번호·**주민번호 masked만**(`710314-2******`)·진료과·담당의·진료기간·환자구분. 영수증번호=payment_no. **항목별 금액표**: 항목/급여(본인부담금·공단부담금)/비급여/금액합계·category 집계·소계·`본인부담 총액(납부할 금액)`. **납부 정보 3행 합계**: 본인부담 총액 / 이미 납부한 금액 / 납부할 금액(due=copay−paid) + 결제 수단. 발급담당=issued_by_name·발급일자.
- **유형**: 정상

### TC-E7-19: 비-finalized 수납 영수증 출력 차단(409)
- **검증**: FR-113(예외) / Story 7.5
- **역할/계정**: reception@pms.local
- **사전조건**: draft 또는 cancelled 수납(e07 draft).
- **단계**:
  1. draft 수납 상세에는 `문서 출력` 버튼 없음(finalized 패널에만 존재) 확인.
  2. API 직접 `GET /v1/encounters/{id}/payment/receipt`(draft).
- **기대결과**: API **409**(invalid_transition·`정산 완료된 수납 건만 영수증을 출력할 수 있습니다`·status≠finalized). draft/cancelled 영수증 없음.
- **유형**: 예외

### TC-E7-20: 영수증 인쇄 = 감사 이벤트(beforeprint export)
- **검증**: FR-113·UX-DR22 / Story 7.5
- **역할/계정**: reception@pms.local, admin(감사 로그 확인)
- **사전조건**: finalized 수납 영수증 미리보기 열린 상태.
- **단계**:
  1. reception → 영수증 미리보기 → `인쇄 / PDF 저장 (Ctrl P)` 또는 Ctrl+P.
  2. admin → 감사 로그 조회.
- **기대결과**: beforeprint 이벤트가 `POST /v1/encounters/{id}/payment/receipt/export {document_type:"receipt"}` 호출(204). audit_logs에 action='read'·target_table='payments'·after_data `{document_type:"receipt", event:"document_export"}` 기록(우회 불가·DB 소유). document.title=`영수증_{chart_no}`(PII 없음). 버튼 인쇄·PDF·네이티브 Ctrl+P 모두 포착.
- **유형**: 정상·보안(감사)

### TC-E7-21: 세부산정내역서 출력 — 10열 라인표·라인별 본인부담/공단부담
- **검증**: FR-114 / Story 7.6
- **역할/계정**: reception@pms.local
- **사전조건**: finalized 수납(라인이 여러 개인 e03 박정호=진찰료+CBC+HbA1c 권장).
- **단계**:
  1. reception → 수납 상세 → `문서 출력` → 미리보기에서 탭 `세부산정내역서` 클릭.
- **기대결과**: 제목 `진료비 세부산정내역서`. 10열 표: `항목분류·일자·코드·명칭·단가·횟수·일수·금액·본인부담·공단부담`. 일자=진료시작일(KST·전 라인 동일), 일수=1(외래). 라인별 단가/횟수/금액/copay/insurer 표시. tfoot `합계` = Σ금액 / Σ본인부담 / Σ공단부담(라인 파생). 헤더 합계와 라인 합 자기정합.
- **유형**: 정상

### TC-E7-22: 세부산정내역서 인쇄 = 감사(document_type='statement')
- **검증**: FR-114·UX-DR22 / Story 7.6
- **역할/계정**: reception@pms.local, admin
- **사전조건**: 세부산정내역서 탭 활성 상태로 미리보기 열림.
- **단계**: statement 탭 활성에서 인쇄/Ctrl+P → admin 감사 확인.
- **기대결과**: beforeprint export의 document_type가 **활성 탭을 따라** `statement`로 기록(receipt 탭이면 receipt). 영수증과 세부내역서는 상호배타 미리보기(DOM에 .receipt-paper 1개·인쇄 출력 1종). document.title=`세부내역서_{chart_no}`.
- **유형**: 정상·보안

### TC-E7-23: 원외처방전 발급(dispense issued→dispensed)
- **검증**: FR-115 / Story 7.7
- **역할/계정**: reception@pms.local
- **사전조건**: status='issued' 처방 보유 내원(e01 rx01~rx06 전부 issued).
- **단계**:
  1. reception → e01 수납 상세 → `원외처방전` 섹션.
  2. issued 처방 행에 `○ 발행` 배지 + `발급 확정` 버튼 + `출력` 버튼 확인.
  3. `발급 확정` → 확인 다이얼로그(`원외처방전 발급 확인`·환자명·차트·`발급 후 취소할 수 없습니다`) → 확인.
- **기대결과**: `POST /v1/encounters/{id}/prescriptions/{rxId}/dispense` 호출. 토스트 `원외처방전이 발급되었습니다.` 처방 status=dispensed·dispensed_at 세팅. 배지 `✓ 발급`로 변경·`발급 확정` 버튼 사라짐(출력만 남음). 발급자는 감사 actor만(dispensed_by 컬럼 없음).
- **유형**: 정상

### TC-E7-24: 원외처방전 재발급 차단(409)
- **검증**: FR-115(예외) / Story 7.7
- **역할/계정**: reception@pms.local
- **사전조건**: 이미 dispensed 처방.
- **단계**:
  1. UI에서 dispensed 처방에 `발급 확정` 버튼 미노출 확인.
  2. API 직접 `POST .../prescriptions/{rxId}/dispense`(이미 dispensed).
- **기대결과**: API **409**(`% -> dispensed`·status≠issued·PT409). 토스트(UI 경로) `이미 발급된 처방입니다.` 일방향 전이.
- **유형**: 예외

### TC-E7-25: 원외처방전 출력은 finalize 무관(발행 처방만 있으면 출력)
- **검증**: FR-115 / Story 7.7
- **역할/계정**: reception@pms.local
- **사전조건**: **draft 수납 + issued 처방** 있는 in_progress 내원(처방 발행한 in_progress).
- **단계**:
  1. reception → 미finalize 내원 수납 상세.
  2. `원외처방전` 섹션·`출력` 버튼 확인.
  3. 미리보기 + 인쇄.
- **기대결과**: 결제 finalize와 무관하게 처방전 출력·발급 가능(영수증과 결정적 차이 — log_prescription_document_export엔 finalized 게이트 없음). 미리보기에 면허번호(license_no 12345)·질병분류기호(KCD)·요양기관기호·약품 목록(명칭·1회량·1일횟수·총일수·용법)·**약가 없음** 확인. masked RRN만.
- **유형**: 정상·경계

### TC-E7-26: 원외처방전 IDOR — 타 내원 처방 접근 차단(404)
- **검증**: 권한·보안 / Story 7.7
- **역할/계정**: reception@pms.local
- **사전조건**: 두 내원 A·B, B의 처방 id 확보.
- **단계**: `POST /v1/encounters/{A}/prescriptions/{B의 rxId}/dispense` 또는 `/document/export`.
- **기대결과**: **404**(`처방을 찾을 수 없습니다`·_require_prescription_owned·소유 미일치). 존재/비소유 구분 노출 없음(IDOR 차단).
- **유형**: 권한·보안

### TC-E7-27: 처방전 발급/출력 권한 게이트(403)
- **검증**: 권한·보안 / Story 7.7
- **역할/계정**: doctor@pms.local 또는 nurse(prescription.dispense 미보유)
- **사전조건**: doctor는 처방 create는 되지만 dispense 권한 없음.
- **단계**: doctor 토큰으로 `POST .../prescriptions/{rxId}/dispense`, `GET .../prescription-document`, `POST .../document/export`.
- **기대결과**: 전부 **403**(prescription.dispense 필요·router 의존성 + DB RPC has_permission 이중 게이트). UI에서도 권한 없으면 처방 섹션 자체가 숨김.
- **유형**: 권한·보안

### TC-E7-28: 후수납 기본 흐름(선결제 없이 finalize)
- **검증**: FR-117 / Story 7.8
- **역할/계정**: reception@pms.local
- **사전조건**: 선결제 없는 draft 수납(billing_type=postpaid 기본·paid=0).
- **단계**: 선결제 없이 바로 `결제·내원 완료`.
- **기대결과**: paid = greatest(copay, 0) = copay(7.4와 무회귀 동일 동작). billing_type 기본 postpaid. due=0.
- **유형**: 정상

### TC-E7-29: 선수납(선결제 누적·billing_type prepaid)
- **검증**: FR-117 / Story 7.8
- **역할/계정**: reception@pms.local
- **사전조건**: registered(진찰 전) 또는 in_progress draft 수납(e09 registered).
- **단계**:
  1. reception → e09(registered) 수납 상세.
  2. `선결제 (선수납)` 박스 → 금액 입력(예 10,000) → 결제 수단 선택 → `선결제` 버튼.
  3. 확인 다이얼로그(`선결제 확인`·환자명·차트·금액·`진료 후 차액을 정산합니다`) → 확인.
- **기대결과**: `POST .../payment/prepay {amount_krw, payment_method}`. 토스트 `선결제 10,000원이 기록되었습니다.` paid_amount_krw += 10,000(단일 누계), billing_type=prepaid, status 불변=draft(내원 상태 전이 없음). 헤더에 `선수납` 칩·PaymentStatusBadge `◐ 부분`. registered(진찰 전·수가 0)에선 예치금으로 기록.
- **유형**: 정상

### TC-E7-30: 선수납 후 finalize — 차액 정산
- **검증**: FR-117 / Story 7.8
- **역할/계정**: reception@pms.local
- **사전조건**: 선결제 누적된 draft 수납(예 5,000 선납), 진찰 후 copay=5,280 산정.
- **단계**:
  1. 선결제 5,000 받은 내원에서 진찰·수가 발생 → copay 산정.
  2. 수납 상세에서 `납부할 차액` 표시 확인(due=copay−paid).
  3. `결제·내원 완료`(help text `확정 시 차액 {due}원이 결제되고…`).
- **기대결과**: paid = greatest(copay 5,280, 선납 5,000) = 5,280 → 차액 280원 수금·완납. 0048→0051 재정의로 0<선납<copay 시 정확히 차액 수금. finalize 성공.
- **유형**: 정상·경계

### TC-E7-31: 과납(선납>copay) — 표시·플래그(환급은 7.9 이월)
- **검증**: FR-117(경계) / Story 7.8
- **역할/계정**: reception@pms.local
- **사전조건**: copay보다 큰 금액 선결제(예 copay 5,280인데 10,000 선납).
- **단계**:
  1. 과납 상태에서 수납 상세.
  2. `환급 대상 (과납)` 표시(due<0 → -due) 확인.
  3. finalize.
- **기대결과**: due = copay − paid < 0 → UI `환급 대상 (과납)` = 5,280−10,000의 절댓값(또는 표시값). finalize help `확정 시 추가 결제 없이 내원이 완료됩니다(선결제 완납).` paid = greatest(copay, 선납) = 10,000(초과분 보존). finalize 허용(차단 안 함). 실제 환급은 별도(7.9 메커니즘·환급 차단/즉시환급 미채택).
- **유형**: 경계

### TC-E7-32: 선결제 금액 검증(0·음수·상한 1억)
- **검증**: FR-117(경계) / Story 7.8
- **역할/계정**: reception@pms.local
- **사전조건**: draft 수납.
- **단계**:
  1. 선결제 금액 0/음수/비정수 입력 → `선결제` 버튼.
  2. 1억 초과 입력.
  3. API 직접 `POST .../payment/prepay {amount_krw:0}` / `{amount_krw:200000000}`.
- **기대결과**: UI: ≤0/비정수 → 토스트 `선결제 금액을 원 단위 양의 정수로 입력하세요.`·버튼 disabled. 1억 초과 → `선결제 금액은 100,000,000원을 넘을 수 없습니다.` API: Pydantic gt=0·le=100,000,000 → **422**. DB도 amount<=0 → PT409 최종선. int4 overflow 방어.
- **유형**: 경계·예외

### TC-E7-33: 종결 내원 선결제 차단(409)
- **검증**: FR-117(예외) / Story 7.8
- **역할/계정**: reception@pms.local
- **사전조건**: completed/cancelled 내원(finalized 또는 cancelled 수납).
- **단계**: API 직접 `POST .../payment/prepay`(finalized/cancelled).
- **기대결과**: **409**(prepay_payment의 내원상태 가드 — registered/in_progress 외 차단·`invalid encounter state for prepay`; 또는 비-draft payment `invalid payment transition: prepay on %`). 종결 내원에 자금 유입 차단(stale-tab/직접호출 reachable 방어).
- **유형**: 예외

### TC-E7-34: 내원 취소·노쇼 정산 — 수가 미발생(registered 취소)
- **검증**: FR-118 / Story 7.9
- **역할/계정**: reception@pms.local
- **사전조건**: registered 내원(진찰 전·e09/e10/e11). total=0(수가 미발생).
- **단계**:
  1. reception → e10(registered) 수납 상세.
  2. `내원 취소` 버튼(total=0일 때만 노출) → 확인 다이얼로그(`내원 취소 확인`·`취소 시 수가가 발생하지 않습니다. 취소 후 되돌릴 수 없습니다.`) → 확인.
- **기대결과**: `POST .../payment/cancel {reason}`. 토스트 `내원이 취소되었습니다.` 내원 status=cancelled(cancel_encounter registered→cancelled), payment status=cancelled·cancelled_at 세팅. **수가 미발생은 구조적**(진찰 전 fee_items 0). PaymentStatusBadge `✕ 취소`·`취소·노쇼로 종결된 내원입니다. 수가가 발생하지 않습니다.` 패널.
- **유형**: 정상

### TC-E7-35: 선납 후 취소 — 전액 환급
- **검증**: FR-118 / Story 7.9
- **역할/계정**: reception@pms.local
- **사전조건**: registered 내원에 선결제(예 10,000·prepaid) 누적된 draft 수납.
- **단계**:
  1. 선납 10,000 받은 registered 내원 수납 상세.
  2. 버튼이 `내원 취소·환급`(paid>0이므로 ·환급 접미) 확인.
  3. 확인 다이얼로그에 환급 문구(`취소 시 선납 10,000원이 {결제수단}(으)로 환급되고…`) → 확인.
- **기대결과**: 토스트 `내원이 취소되었습니다 · 환급 10,000원`. refunded_amount_krw = paid_amount_krw(전액 환급·원결제수단). paid는 보존(순납부=paid−refunded=0). 취소 패널 `환급액 10,000원 ({결제수단})`. payments_refund_le_paid CHECK 충족.
- **유형**: 정상

### TC-E7-36: in_progress(수가 발생) 내원은 취소 불가(finalize만)
- **검증**: FR-118(경계) / Story 7.9
- **역할/계정**: reception@pms.local
- **사전조건**: in_progress·total>0 내원(e07).
- **단계**:
  1. e07 수납 상세 → `내원 취소` 버튼 미노출(total>0이면 finalize 버튼만) 확인.
  2. API 직접 `POST .../payment/cancel`(in_progress).
- **기대결과**: UI는 total>0이면 취소 버튼 없음. API는 **409**(cancel_encounter가 scheduled/registered만 허용·in_progress 차단·PT409). 진찰 시작된 내원은 수행분 finalize만 가능(부분수행은 구조적).
- **유형**: 경계·예외

### TC-E7-37: 취소 권한 게이트(encounter.cancel 403)
- **검증**: 권한·보안 / Story 7.9
- **역할/계정**: encounter.cancel 미보유 계정(예 payment.manage만 있고 cancel 없는 가상 케이스·또는 doctor)
- **사전조건**: settle는 payment.manage(reception) + encounter.cancel(cancel_encounter 내부 평가) 둘 다 필요.
- **단계**: 적절한 권한 조합 부재 계정으로 `POST .../payment/cancel`.
- **기대결과**: payment.manage 미보유 → 403(_require_payment_manage). encounter.cancel 미보유 → 403(cancel_encounter의 42501). reception은 둘 다 보유해 정상.
- **유형**: 권한·보안

### TC-E7-38: 이미 finalized/cancelled 수납 취소 차단(409)
- **검증**: FR-118(예외) / Story 7.9
- **역할/계정**: reception@pms.local
- **사전조건**: finalized 수납(e01) 또는 이미 cancelled 수납.
- **단계**: API 직접 `POST .../payment/cancel`(finalized/cancelled).
- **기대결과**: **409**(settle의 draft 가드·`invalid payment transition: settle on %`). 비가역 void 차단(방어심층·side-effect 전 평가).
- **유형**: 예외

### TC-E7-39: 부분수행 정산 — 수행분만 청구(미수행=fee 0)
- **검증**: FR-119 / Story 7.10
- **역할/계정**: doctor/nurse/radiologist(일부만 수행), reception(정산)
- **사전조건**: e08 윤서아 = in_progress·진찰료 발생·ordered 상태 x04(흉부촬영 9,030)·t03(네뷸라이저 2,800) 미수행.
- **단계**:
  1. reception → e08 수납 상세.
  2. **부분수행 배너** + pending_orders_count 배지 확인.
  3. 라인 = 진찰료(수행분)만 집계됨 확인.
  4. (선택) t03만 수행 후 재집계 → t03 추가, x04는 여전히 제외.
- **기대결과**: 배너 `⚠ 부분 수행 — 미수행 오더 N건은 청구에서 제외됩니다(수행분만 정산).`(draft & pending>0일 때만). pending_orders_count = 미수행 examinations(ordered) + treatment_orders(ordered) 수(처방 제외). 수납 라인에 x04·t03 없음(미수행=fee_item 0·build_payment 자동 제외). 수행분만 정산. finalize 시 진찰료+수행분만 결제.
- **유형**: 정상

### TC-E7-40: 종결 내원 오더 생성 차단(BEFORE INSERT 게이트 409)
- **검증**: FR-119(보안·정산 변조 방지) / Story 7.10
- **역할/계정**: doctor 또는 API 직접
- **사전조건**: completed/cancelled/no_show 내원(e01 completed·finalized).
- **단계**:
  1. API 직접 검사/처치/처방 INSERT를 종결 내원에 시도(`POST .../examinations` 등).
- **기대결과**: **409**(assert_encounter_orderable·`encounter is terminal, cannot accept orders`·PT409). soft-deleted(is_active=false) 내원도 차단. 정산 종료 후 수가 사후 변조 방지. ⚠️ registered/in_progress(active)는 오더 가능(실 임상 플로우 보존·종결만 차단).
- **유형**: 권한·보안·경계

### TC-E7-41: 종결 내원 오더 수행 차단(perform 게이트 409)
- **검증**: FR-119 / Story 7.10
- **역할/계정**: nurse/radiologist 또는 API 직접
- **사전조건**: 종결 내원에 ordered 잔존 오더(드문 케이스·구조적으론 어려움).
- **단계**: 종결 내원의 ordered 오더에 perform_examination/perform_treatment_order 호출.
- **기대결과**: **409**(perform RPC 내부 assert_encounter_orderable·종결 차단). fee_item 미적재 → 종결 내원 청구액 사후 증가 불가.
- **유형**: 경계·보안

### TC-E7-42: payment_no 형식·유일성 검증
- **검증**: FR-112 / Story 7.4
- **역할/계정**: reception@pms.local
- **사전조건**: 연속 2건 finalize.
- **단계**: 두 내원을 연속 finalize 후 payment_no 비교.
- **기대결과**: 둘 다 `R-YYYYMMDD-NNNNNN`(KST 날짜·6자리 제로패딩). 시퀀스 단조증가(전역·일별 리셋 없음). payment_no UNIQUE(0045)·동시 finalize 충돌 0. 영수증/세부내역서 헤더에 동일 번호.
- **유형**: 정상·경계

### TC-E7-43: 환자 self 영수증 vs 직원 영수증 차이(비-finalized 처리)
- **검증**: FR-113 경계(Epic 8 연계·7.5 조립 재사용) / Story 7.5
- **역할/계정**: 직원(reception) vs 환자 포털 계정
- **사전조건**: draft 수납.
- **단계**:
  1. reception → draft 영수증 `GET .../payment/receipt` → 409.
  2. (Epic 8) 환자 self → 본인 draft 영수증 조회 → 404.
- **기대결과**: 직원 비-finalized = **409**(invalid_transition). 환자 self 비-finalized·타인·미연결 = **404**(존재 비노출·IDOR 일관·draft 비노출). 동일 _assemble_receipt_payload 재사용하되 게이트 다름.
- **유형**: 경계·보안

### TC-E7-44: 결제수단 검증(card/cash/transfer 외 거부)
- **검증**: FR-112(경계) / Story 7.4, 7.8
- **역할/계정**: reception@pms.local 또는 API 직접
- **사전조건**: draft 수납.
- **단계**: API `POST .../payment/finalize {payment_method:"bitcoin"}` 또는 prepay 동일.
- **기대결과**: **422**(Pydantic Literal["card","cash","transfer"] 1차). DB payment_method CHECK 최종선. UI 토글은 3개만 노출.
- **유형**: 경계

### TC-E7-45: 미존재 내원 수납 작업(404)
- **검증**: 예외 / Story 7.2/7.4/7.8/7.9
- **역할/계정**: reception@pms.local
- **사전조건**: 존재하지 않는 encounter UUID.
- **단계**: `POST/GET .../payment`, `.../finalize`, `.../prepay`, `.../cancel`을 임의 UUID로.
- **기대결과**: 전부 **404**(`내원을 찾을 수 없습니다`·db 존재검사). `GET .../payment`(빌드 전)은 `수납 건을 찾을 수 없습니다` 404.
- **유형**: 예외

---

## FR 커버리지 체크

| 담당 FR | 커버 시나리오 | 비고 |
|---|---|---|
| FR-110 자동발생 수가 집계·수납건 생성(헤더+상세) | TC-01, 02, 05, 06 | 워크리스트 + build_payment 멱등 집계 + 라인 스냅샷 |
| FR-111 급여·비급여 구분·본인부담 산정 | TC-09, 10, 11, 12 | 4보험유형×급여/비급여·10원 절사·헤더 정합 |
| FR-112 수납처리·내원 완료 | TC-13, 14, 15, 16, 17, 42, 44, 45 | finalize·payment_no·주상병 게이트·원자성·멱등 |
| FR-113 진료비 계산서·영수증(3행합계) | TC-18, 19, 20, 43 | 항목별 금액표·3행합계·인쇄감사·non-finalized 차단 |
| FR-114 세부산정내역서(라인별) | TC-21, 22 | 10열 라인표·라인 파생 합계·statement 감사 |
| FR-115 원외처방전 출력·발급 | TC-23, 24, 25, 26, 27 | dispense·재발급차단·finalize무관·IDOR·권한 |
| FR-116 수가 자동발생 규칙(매핑) | TC-01, 02, 03, 04 | 진찰 매핑(초진/재진)·검사/처치 직접·처방 미발생·만료제외 |
| FR-117 후수납 기본·선수납 옵션 | TC-28, 29, 30, 31, 32, 33 | postpaid/prepaid·차액정산·과납·금액검증·종결차단 |
| FR-118 취소·노쇼 수가 미발생 | TC-34, 35, 36, 37, 38 | 구조적 미발생·전액환급·in_progress 불가·권한·비가역 |
| FR-119 부분수행 정산 | TC-39, 40, 41 | 수행분만 청구·종결 오더 생성/수행 게이트 |

**누락 없음** — 담당 FR-110~119 전 항목이 정상+예외+경계+권한 시나리오로 커버됨. 추가로 멀티스텝 원자성(TC-17), payment_no 형식/유일성(TC-42), 환자 self 영수증 경계(TC-43)를 보강.
