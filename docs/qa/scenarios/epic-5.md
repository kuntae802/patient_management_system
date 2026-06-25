# Epic 5: 오더·수행 — 테스트 시나리오

## 에픽 개요
Epic 5는 외래 임상 워크플로의 핵심인 **오더(처방·검사·영상·처치) 발행 → 수행 → 완료/판독 → 수가 자동발생**의 풀 라이프사이클을 구현한다. 의사가 진료 허브(`/encounter/{id}`)의 오더 패널에서 오더를 내고, 간호·방사선·판독의가 각 워크리스트에서 수행/판독하며, 상태 전이가 수가(fee_items)를 자동 적재한다.

핵심 설계 사실(코드 직접 확인):
- **상태머신은 DB가 소유**(테이블별 per-type, 단일 통합 orders 테이블 없음). 처방=issued→dispensed, 검사·처치=ordered→performed→completed. 잘못된 전이·재수행 = SQLSTATE `PT409`(→409). not-found=`PT404`(→404).
- **전이 RPC 3종**(`perform_examination`, `complete_examination`, `perform_treatment_order`)이 `has_permission` 자가 게이트 + 소스상태 precondition(재수행 차단 FR-093의 핵심)을 SECURITY DEFINER로 강제. 오더 *생성*(INSERT)은 RPC 아닌 service_role 직접 쓰기(FastAPI).
- **수가 자동발생**(0021): AFTER UPDATE OF status + WHEN 절 트리거가 정확히 1회 발화. 진찰료=registered→in_progress(start_consult), 검사·영상료=ordered→performed, 처치료=ordered→performed. `unique(source_type, source_id)` + `on conflict do nothing` 멱등. **약제비(처방 발행)는 fee_item 미적재**(drugs에 약가 없음).
- ⚠️ **진찰료 트리거는 Epic 7(0045)에서 재정의됨**: 환자 과거 완료 내원 유무로 초진(AA154/17,610원)/재진(AA254/12,590원) 동적 분기. 5.10의 `encounter_start`(AA254 고정) 매핑은 폴백으로 보존. → Epic 5 진찰료 검증 시 초진/재진 코드를 반드시 구분할 것.
- **알레르기 교차검증**(0016/5.5): 서버 권위(`_allergy_conflicts`)는 환자 `allergies` 자유텍스트를 구분자(`,`·`、`·`·`·`/`·`;`·공백)로 토큰화 후 길이≥2 토큰이 약품명에 **부분 포함**될 때 conflict. **클래스 매칭 불가**(페니실린 ⊄ 아목시실린 = null). 충돌 라인에 `allergy_override_reason` 없으면 → 409 `allergy_conflict`. 클라(`order-safety.ts allergyMatch`)는 동일 알고리즘 거울(즉시 UX).
- **동일성분 중복경고**(FR-052): 클라 측 `ingredient_code` 비교(비차단 amber 인라인). 서버 차단 아님. 데모 약품 17종 ingredient_code 전부 고유 → **같은 약을 두 번 추가**해야 중복 발동.
- **영상 업로드**: Supabase Storage 비공개 버킷(`examination-images`). DB엔 `storage_path`(경로)만, 서명 URL은 조회 시 재생성. 객체 경로 = `{examination_id}/{uuid4}.{ext}`(PII 금지). MIME 화이트리스트(png/jpeg/webp)·최대 50MiB. **촬영 수행(perform)은 영상≥1 강제**(서비스 422 `image_required`, DB CHECK 아님).
- **판독 완료**: 소견(findings) 필수(서비스 422 `findings_required`, DB CHECK 아님 — RPC 공유 인프라 계약 보존), 결론(reading_conclusion) 선택. same-status UPDATE로 소견 기록 후 complete RPC 호출(동일 txn 원자).
- **워크리스트 라우팅**: 검사 `exam_type`이 분기 축 — imaging→방사선 워크리스트(`/radiology/worklist`), lab→간호(검체)는 별도 명시 워크리스트 없음(간호 워크리스트는 처치만 노출). 처치→간호 단일 라우팅(`/nurse/worklist`).

## 데모 계정·권한 매트릭스 (seed.sql 직접 확인)
| 계정 | 역할 | 보유 권한(Epic 5) | 비고 |
|---|---|---|---|
| doctor@pms.local | doctor | prescription.create, examination.order, treatment.order, order.read, examination.complete | examination.perform/treatment.perform **미보유**(수행 403) |
| nurse@pms.local | nurse | order.read, examination.perform, treatment.perform, vital.record, nursing.record | prescription.create/examination.order/treatment.order **미보유**, examination.complete 미보유 |
| radiologist@pms.local | radiologist | order.read, examination.perform | treatment.perform·examination.complete·vital.record 미보유 |
| reception@pms.local | reception | (임상 오더 권한 0) + prescription.dispense(7.7 dev grant) | 발행/조회/수행/판독 전부 403 baseline |
| admin@pms.local | admin | 전 권한 | — |
공통 비밀번호: `Staff1234`.

## 데모 시드 결정적 픽스처 (demo_seed.sql 직접 확인)
- **내원 11건**: e01~e06=completed, e07·e08=in_progress, e09·e10·e11=registered(대기). UUID 프리픽스 `00020000-...`, 접미 2자리=환자 번호.
- **검사**(`00021...`): x01=e03/lab/CBC(C3800,3,500)·**completed**, x02=e03/lab/HbA1c(D2700,6,000)·**completed**, x03=e06/imaging/CXR(HA201,9,030)·**completed**, **x04=e08/imaging/CXR·ordered(미수행)** ← 촬영 워크리스트 노출 대상.
- **처치**(`00022...`): t01=e02/네뷸라이저(NA240,2,800)·performed, t02=e04/정맥점적(KK150,5,500)·performed, **t03=e08/네뷸라이저·ordered(미수행)** ← 간호 워크리스트 노출 대상.
- **처방**(`00023...`): rp01~rp06=issued(e01~e06). 약제비 fee_item 없음(설계).
- **활력**: e01~e08 각 1건. e09~e11 미측정.
- **간호기록**: e02(t01연결), e04(t02연결), e07(오더없음 일상기록).
- **수가 발화 상태**: 진찰료 e01~e08(8건·전이 발화), 검사·영상료 x01·x02·x03(3건), 처치료 t01·t02(2건). x04·t03은 미수행 → 수가 미발생(부분수행 정산 검증 대상).
- **환자 알레르기**: p08 윤서아=`계란`, **p09 임재욱=`페니실린계 항생제(두드러기 과거력)`**, p18 조아인=`땅콩`. ⚠️ p09 알레르기 텍스트는 토큰화해도 `페니실린계`·`항생제` 등이 약품명에 부분일치 안 함(아목시실린엔 '페니실린' 문자열 없음) → 데모 약품으로는 자연 409 미발생. **알레르기 409 데모는 환자 allergies를 약품명 토큰과 일치하도록 수정/생성하거나, allergen='아목시실린' 같은 직접 토큰 환자로 테스트**.
- **장비**: XR-01(제1일반촬영기·available), XR-02(제2일반촬영기·available), US-01(초음파진단기·available).
- **수가 마스터**: AA154 초진17,610 / AA254 재진12,590 / C3800 CBC3,500 / D2700 HbA1c6,000 / HA201 흉부촬영9,030 / NA240 네뷸라이저2,800 / KK150 정맥점적5,500.

---

## 스토리 ↔ FR ↔ 구현 매핑
| 스토리 | 기능 | 커버 FR | 핵심 구현 |
|---|---|---|---|
| 5.1 | 오더 생명주기 스키마·상태머신·전이RPC | FR-080, FR-081(근거), FR-093(DB), NFR-040 | 0015 (equipment·prescriptions·prescription_details·examinations·treatment_orders + enforce_*_transition 트리거 + perform_examination/complete_examination/perform_treatment_order RPC) |
| 5.2 | 처방 발행·중복경고 | FR-050, FR-051, FR-052 | orders.py `POST/GET /encounters/{id}/prescriptions`, db `insert_prescription`(헤더+상세 원자), 클라 `prescription-panel`·`ingredient_code` 비교 |
| 5.3 | 검사·영상 오더 | FR-060, FR-061 | orders.py `POST/GET /encounters/{id}/examinations`, db `insert_examination`(exam_type lab/imaging), 클라 `examination-panel` |
| 5.4 | 처치 오더 | FR-070 | orders.py `POST/GET /encounters/{id}/treatment-orders`, db `insert_treatment_order`, 클라 `treatment-panel` |
| 5.5 | 오더 패널·알레르기 교차검증·누락0 디텍터 | FR-052(보강), UX-DR13/21② | 0016 (coverage_type·allergy_override_reason), db `_allergy_conflicts`(409), 클라 `order-panel`·`order-safety.ts`·pay-chip·예상수가 프리뷰 |
| 5.6 | 간호 활력징후 기록 | FR-091, FR-032 | 0017 vital_signs(6항목·최소1·범위CHECK), nursing.py `POST/GET /encounters/{id}/vitals`·`GET /nursing/vitals-worklist`, 클라 `vitals-page` |
| 5.7 | 처치 수행·재수행 차단·일상 간호기록 | FR-090, FR-092, FR-093, FR-094 | 0018 nursing_record(content·nursing.record 권한), nursing.py `perform`·`POST /encounters/{id}/nursing-records`·`GET /nursing/worklist`, db `call_perform_treatment_order` |
| 5.8 | 방사선 촬영·영상 업로드·장비 | FR-100, FR-101, FR-103 | 0019 examination_images + Storage 버킷, radiology.py 업로드/수행/워크리스트/장비, db `call_perform_examination`(영상≥1·장비검증) |
| 5.9 | 영상 판독·검사 완료 | FR-102 | 0020 findings·reading_conclusion 컬럼, radiology.py `GET /radiology/reading-worklist`·`POST /examinations/{id}/complete`, db `call_complete_examination` |
| 5.10 | 수가 자동발생 트리거 | FR-081, FR-116, NFR-040 | 0021 fee_mappings·fee_items·insert_fee_item·트리거 3종(fee_on_encounter_start/examination_performed/treatment_performed) |

---

## 테스트 시나리오

### TC-E5-01: 처방전 발행 정상 흐름(헤더+상세 원자 생성)
- **검증**: FR-050 / FR-051 / Story 5.2
- **역할/계정**: doctor@pms.local
- **사전조건**: in_progress 내원 e07(p07 오세훈) 진료 허브 접속(`/encounter/<e07 id>`).
- **단계**:
  1. 우측 오더 패널 "처방" 탭 선택.
  2. "약품 코드·명칭 검색" 피커에서 `645100250`(타이레놀) 검색·선택 → 드래프트 라인 추가.
  3. 라인에 용량=1, 횟수="1일 3회", 일수=3, 용법="매 식후 30분" 입력.
  4. "근거 진단(선택)"은 e07에 진단 없으면 "— 없음 —" 유지(있으면 선택해 FR-051 검증).
  5. "처방 발행" 클릭.
- **기대결과**: 201 + 토스트 "처방전을 발행했습니다." / 발행 처방 목록에 "발행" 배지·시각·약품명·용법 요약·pay-chip "급여"·"오더 doctor명 · 수행 약국 대기" 노출. `prescriptions.status='issued'`, `prescription_details` 1행. **fee_items에 약제비 미적재**(약가 없음).
- **유형**: 정상

### TC-E5-02: 처방 근거 진단 연결(FR-051) + 타 내원 진단 차단
- **검증**: FR-051 / Story 5.2
- **역할/계정**: doctor@pms.local
- **사전조건**: 진단이 부착된 완료 내원(예 e01, 진단 J00 감기)이 아닌 새 in_progress 내원에서 검증하려면, 먼저 진료 허브에서 진단을 1건 부착(SOAP/진단 영역) 후 처방.
- **단계**:
  1. e07에 진단 1건 부착(또는 진단 보유 내원 사용).
  2. 처방 탭에서 약품 추가 → "근거 진단(선택)"에서 해당 진단 선택 → 발행.
  3. (직접 API) 다른 내원의 `encounter_diagnosis_id`를 body로 `POST /encounters/<e07>/prescriptions` 호출.
- **기대결과**: (2) 201, `encounter_diagnosis_id` 저장. (3) 422 `invalid_diagnosis_reference`("이 내원의 진단이 아닙니다") — FK만으론 소속 미보증, 동일 txn 검증.
- **유형**: 정상 + 예외

### TC-E5-03: 동일성분 중복 처방 경고(FR-052·비차단)
- **검증**: FR-052 / Story 5.2·5.5
- **역할/계정**: doctor@pms.local
- **사전조건**: 진료 허브 처방 탭. 데모 약품 ingredient_code 전부 고유 → **같은 약 두 번 추가**로 검증.
- **단계**:
  1. 처방 탭에서 타이레놀(`645100250`) 추가 → 라인1.
  2. 같은 타이레놀을 다시 검색·추가 → 라인2.
- **기대결과**: 라인2(또는 동일 ingredient_code 후행 라인)에 amber 인라인 경고 "동일 성분 중복 — 확인 후 발행"(role="alert"). **"처방 발행" 버튼은 활성 유지**(비차단). 발행 시 201 정상(서버 차단 없음). null ingredient_code 약품(없음·데모) 추가 시엔 경고 미표시.
- **유형**: 경계(비차단 경고)

### TC-E5-04: 알레르기 교차검증 — 409 차단 후 오버라이드 사유로 발행
- **검증**: UX-DR21② / Story 5.5 / FR-050
- **역할/계정**: doctor@pms.local
- **사전조건**: 알레르기 토큰이 약품명에 부분일치하는 환자 필요. ⚠️ 데모 p09(페니실린계 항생제)는 토큰 '페니실린'이 '아목시실린'에 미포함 → 자연 미발동. 검증 위해 **환자 allergies를 `아목시실린`(또는 `타이레놀`)으로 설정한 내원** 준비(admin 환자 편집 또는 db 직접).
- **단계**:
  1. 해당 환자 내원 처방 탭에서 매칭 약품(아목시실린 `612200180`) 추가.
  2. 라인에 red 알레르기 경고("환자 알레르기 약품 — "아목시실린". 발행하려면 사유 입력") + "오버라이드 사유" 입력란 표시 확인. "처방 발행" 버튼 비활성("알레르기 사유 입력 필요").
  3. 오버라이드 사유 없이 직접 API `POST /encounters/{id}/prescriptions` 호출.
  4. UI에서 오버라이드 사유 입력("과거 부작용 경미·대체불가") 후 발행.
- **기대결과**: (2) 버튼 비활성. (3) 409 `allergy_conflict`("환자 알레르기 약품입니다. 발행 사유를 입력하세요.") + detail.conflicts에 drug_id/drug_name/allergen. (4) 201 발행, conflict 라인만 `allergy_override_reason` 저장(비-conflict 라인은 NULL), 감사 마스킹 대상. 응답엔 override 미노출.
- **유형**: 권한·보안 + 상태전이(차단)

### TC-E5-05: 클래스 매칭 한계(정직한 한계·페니실린 ⊄ 아목시실린)
- **검증**: Story 5.5 알레르기 메커니즘 한계
- **역할/계정**: doctor@pms.local
- **사전조건**: p09 임재욱(allergies="페니실린계 항생제(두드러기 과거력)") 내원.
- **단계**: 처방 탭에서 아목시실린(`612200180`) 추가.
- **기대결과**: 알레르기 경고 **미표시**, 발행 가능(409 없음). 토큰 '페니실린'·'항생제'가 '아목시실린캡슐250밀리그람'에 부분일치 안 함(클래스 매칭 부재 = 설계상 정직한 한계). 클라/서버 동일 결과. *(주의: 이는 버그가 아니라 구조화 알레르겐 부재로 인한 의도된 한계.)*
- **유형**: 경계

### TC-E5-06: 검사 오더 생성 — lab(진단검사)
- **검증**: FR-060 / FR-061 / Story 5.3
- **역할/계정**: doctor@pms.local
- **사전조건**: in_progress 내원 e07 진료 허브.
- **단계**:
  1. 오더 패널 "검사"(lab) 탭 선택.
  2. "행위 코드·명칭 검색"에서 `C3800`(CBC) 검색·선택.
- **기대결과**: 즉시 오더 생성(드래프트 없음·선택=오더). 201. 목록에 "지시" 배지·시각·`C3800 일반혈액검사(CBC)`·pay-chip "급여"·금액 3,500·"오더 doctor명 · 수행 대기". DB `examinations.exam_type='lab'`·`status='ordered'`. **lab은 방사선 워크리스트 미노출**(imaging만), 간호 워크리스트도 처치만 노출 → lab 검체 수행은 검사 단건 perform 경로(검체=examination.perform).
- **유형**: 정상

### TC-E5-07: 영상 오더 생성 — imaging
- **검증**: FR-060 / FR-061 / Story 5.3
- **역할/계정**: doctor@pms.local
- **사전조건**: in_progress 내원 e07 진료 허브.
- **단계**: 오더 패널 "영상"(imaging) 탭 → `HA201`(흉부촬영) 선택.
- **기대결과**: 201, "지시" 배지·금액 9,030. DB `exam_type='imaging'`·`status='ordered'`. **방사선 촬영 워크리스트(`/radiology/worklist`)에 즉시 노출**(오늘·imaging·ordered·활성내원). 라우팅 분기 확인.
- **유형**: 정상 + 상태전이(라우팅)

### TC-E5-08: 처치 오더 생성
- **검증**: FR-070 / Story 5.4
- **역할/계정**: doctor@pms.local
- **사전조건**: in_progress 내원 e07 진료 허브.
- **단계**: 오더 패널 "처치" 탭 → `NA240`(네뷸라이저) 선택.
- **기대결과**: 201, "지시" 배지·금액 2,800. DB `treatment_orders.status='ordered'`. **간호 워크리스트(`/nurse/worklist`)에 즉시 노출**(pending_treatment_count 증가·단일 라우팅·exam_type 분기 없음).
- **유형**: 정상 + 상태전이(라우팅)

### TC-E5-09: 잘못된 fee_schedule_id / 미존재 내원 (검사·처치 공통)
- **검증**: Story 5.3·5.4 예외 경로
- **역할/계정**: doctor@pms.local (직접 API)
- **단계**:
  1. `POST /encounters/<유효 e07>/examinations` body `fee_schedule_id`=무작위 UUID, exam_type="lab".
  2. `POST /encounters/<유효 e07>/examinations` body `exam_type`="xray"(허용값 아님).
  3. `POST /encounters/<무작위 UUID>/examinations` 유효 body.
- **기대결과**: (1) 422 `invalid_reference`("참조 대상이 올바르지 않습니다(검사 행위)") — FK 23503 백스톱. (2) 422 Pydantic Literal 검증(lab/imaging만). (3) 404("내원을 찾을 수 없습니다"). 처치 오더도 동형(invalid_reference 처치 행위).
- **유형**: 예외

### TC-E5-10: 오더 발행/조회 권한 게이트(403)
- **검증**: Story 5.2~5.4 권한·보안
- **역할/계정**: reception@pms.local, nurse@pms.local (직접 API 또는 메뉴 부재)
- **단계**:
  1. reception 토큰으로 `POST /encounters/{id}/prescriptions`, `/examinations`, `/treatment-orders`.
  2. reception 토큰으로 `GET /encounters/{id}/prescriptions` 등 조회.
  3. nurse 토큰으로 `POST .../prescriptions`(발행).
  4. nurse 토큰으로 `GET .../prescriptions`(조회).
- **기대결과**: (1) 403(prescription.create/examination.order/treatment.order 미보유). (2) 403(order.read 미보유=원무 제외 최소권한). (3) 403(nurse는 order.read만·create 없음=read-yes/create-no). (4) **200**(nurse는 order.read 보유). 직무 baseline 비중첩 검증.
- **유형**: 권한·보안

### TC-E5-11: 활력징후 기록 — 6항목 부분 측정
- **검증**: FR-091 / Story 5.6
- **역할/계정**: nurse@pms.local
- **사전조건**: `/nurse/vitals` 접속. 좌측 "오늘 활성 내원" 워크리스트에서 e09/e10/e11(registered·미측정) 또는 e07/e08 선택.
- **단계**:
  1. 좌측에서 미측정 내원(예 e09 임재욱) 선택.
  2. 우측 폼에 수축기=130, 이완기=85, 맥박=78만 입력(나머지 공백=부분 측정).
  3. "활력징후 기록" 클릭.
- **기대결과**: 201 + 토스트 "활력징후를 기록했습니다." 미측정 항목은 NULL 저장. "최근 활력" 목록 갱신. 워크리스트의 "최근 활력"이 "미측정"→측정 시각으로 변경. `vital_signs` 1행, recorded_by=nurse.
- **유형**: 정상 + 경계(부분 입력)

### TC-E5-12: 활력 — 비정상치 하이라이트 + 최소1개 강제 + 범위 검증
- **검증**: FR-091 / Story 5.6 경계
- **역할/계정**: nurse@pms.local
- **단계**:
  1. 체온에 39.5 입력 → 정상범위(36.0~37.5) 밖 → 입력란 danger(빨강) 하이라이트 확인(표시만·차단 아님).
  2. 모든 항목 공백 상태 → "활력징후 기록" 버튼 비활성(hasAnyVital=false).
  3. (직접 API) `POST /encounters/{id}/vitals` body 전부 null → 422.
  4. (직접 API) `body_temp`=99(범위 30~45 밖) → 422.
  5. (직접 API) `spo2`=120(범위 50~100 밖) → 422.
- **기대결과**: (1) danger 하이라이트, 기록은 가능(임상 범위는 표시 레이어). (2) 버튼 비활성. (3) 422 "활력징후를 최소 1개 이상 입력"(Pydantic model_validator·DB CHECK vital_signs_at_least_one 백스톱). (4)(5) 422(Field 범위·DB 범위 CHECK 백스톱).
- **유형**: 경계 + 예외

### TC-E5-13: 활력 워크리스트 조회 범위(오늘·활성내원)
- **검증**: Story 5.6 AC3
- **역할/계정**: nurse@pms.local
- **단계**: `/nurse/vitals` 좌측 워크리스트 확인.
- **기대결과**: 오늘(KST) `registered`·`in_progress` 활성 내원만(완료 e01~e06 제외, e07/e08 in_progress + e09~e11 registered 노출). 각 행에 환자명·차트번호·진료과·"최근 활력 {시각/미측정}"·상태 배지. created_at 오름차순. **완료/취소 내원 미노출**.
- **유형**: 경계

### TC-E5-14: 활력 조회 권한(의사·간호 양쪽 read)
- **검증**: FR-032 / Story 5.6 권한
- **역할/계정**: doctor@pms.local, nurse@pms.local, reception@pms.local
- **단계**: 각 토큰으로 `GET /encounters/{id}/vitals`.
- **기대결과**: doctor 200(encounter.read), nurse 200(vital.record). reception 403(둘 다 미보유). 의사 진료 허브 좌 컨텍스트 패널(FR-032)에서 활력 표시 검증.
- **유형**: 권한·보안

### TC-E5-15: 처치 수행 정상(ordered→performed) + 처치기록 첨부
- **검증**: FR-090 / FR-092 / Story 5.7
- **역할/계정**: nurse@pms.local
- **사전조건**: `/nurse/worklist`. 좌측 "수행 대기 처치"에 t03(e08 윤서아·네뷸라이저·ordered) 노출.
- **단계**:
  1. 좌측에서 e08(윤서아·"미수행 1" 배지) 선택.
  2. 우측 처치 라인(네뷸라이저·지시)에서 content="네뷸라이저 10분 시행, 호흡음 호전" 입력.
  3. "수행" 클릭.
- **기대결과**: 200 + 토스트 "처치를 수행 처리했습니다." 라인이 "수행 완료"(CheckCircle·status-done)로 잠김·수행 버튼 사라짐·"오더 doctor · 수행 nurse · 시각". `treatment_orders.status='performed'`·performed_by=nurse. content 입력 시 연결 `nursing_record`(treatment_order_id 부착) 생성. **처치료 수가 fee_item 자동 적재**(t03 NA240 2,800·source_type=treatment·source_id=t03).
- **유형**: 정상 + 상태전이 + 수가 발화

### TC-E5-16: 처치 재수행 차단(FR-093·PT409→409)
- **검증**: FR-093 / Story 5.7 / NFR-040
- **역할/계정**: nurse@pms.local
- **사전조건**: 이미 performed인 처치(t01 또는 TC-E5-15 직후 t03).
- **단계**:
  1. UI: 이미 수행 완료된 처치는 "수행 완료" 잠김 상태로 버튼 없음(UX-DR21⑤).
  2. (직접 API) `POST /encounters/<e02>/treatment-orders/<t01>/perform`(이미 performed).
- **기대결과**: (1) UI에 수행 버튼 부재. (2) 409 `invalid_transition`(소스상태 선검사·RPC PT409 백스톱). performed_by/at 덮어쓰기 차단. **수가 중복 미적재**(트리거 발화 없음 + unique 멱등).
- **유형**: 상태전이(차단)

### TC-E5-17: 처치 수행 권한(403) + 미존재 오더(404)
- **검증**: Story 5.7 권한·예외
- **역할/계정**: doctor@pms.local(treatment.perform 미보유), nurse
- **단계**:
  1. doctor 토큰으로 `POST /encounters/{id}/treatment-orders/{id}/perform`.
  2. nurse 토큰으로 무작위 order_id perform.
  3. nurse 토큰으로 다른 내원의 order_id를 잘못된 encounter_id와 함께 perform.
- **기대결과**: (1) 403(doctor=order-yes/perform-no 역전 baseline). (2) 404("처치 오더를 찾을 수 없습니다"·경로 정합 선검사). (3) 404(내원-오더 불일치).
- **유형**: 권한·보안 + 예외

### TC-E5-18: 일상 간호기록(오더 없음·FR-094)
- **검증**: FR-094 / Story 5.7
- **역할/계정**: nurse@pms.local
- **사전조건**: `/nurse/notes` 접속. 좌측 활성 내원 선택.
- **단계**:
  1. e07(오세훈) 선택 → "간호기록 내용"에 "내원 안내·낙상 예방 교육 시행" 입력 → "간호기록 저장".
  2. (직접 API) content 공백(" ")으로 `POST /encounters/{id}/nursing-records`.
- **기대결과**: (1) 201 + 토스트 "간호기록을 남겼습니다." 목록 갱신(treatment_order_id=NULL·일상기록). 워크리스트 "간호기록 N건" 증가. (2) 422 Pydantic min_length(strip)·DB CHECK nursing_record_content_not_blank 백스톱. content는 감사 마스킹 대상(자유 서사).
- **유형**: 정상 + 예외

### TC-E5-19: 일상 간호기록 권한(nursing.record 게이트)
- **검증**: Story 5.7 권한
- **역할/계정**: doctor@pms.local(nursing.record 미보유), reception
- **단계**: doctor/reception 토큰으로 `POST /encounters/{id}/nursing-records`.
- **기대결과**: 403(doctor=nursing.record 미보유, reception=권한 0). nurse만 작성 가능. 조회(`GET .../nursing-records`)는 order.read∨nursing.record → doctor 200(order.read), reception 403.
- **유형**: 권한·보안

### TC-E5-20: 간호 워크리스트 라우팅·뱃지(처치 vs 간호기록)
- **검증**: FR-090 / Story 5.7
- **역할/계정**: nurse@pms.local
- **단계**:
  1. `/nurse/worklist`(처치) — pending_treatment_count>0 내원만 강조.
  2. `/nurse/notes` — 전체 활성 내원.
- **기대결과**: 처치 워크리스트는 t03(e08) 노출·"미수행 N" 배지·oldest_pending_ordered_at 기반 "지연 {mins}분" 표시. notes는 전 활성 내원·"간호기록 N건". 둘 다 `/nursing/*` 네임스페이스(encounters/{id} 흡수 회피). 완료 내원 미노출.
- **유형**: 경계

### TC-E5-21: 촬영 영상 업로드 정상(Storage·서명URL)
- **검증**: FR-101 / Story 5.8
- **역할/계정**: radiologist@pms.local
- **사전조건**: `/radiology/worklist`(또는 `/radiology/upload`). 좌측 "촬영 대기 영상검사"에 x04(e08 윤서아·흉부촬영·ordered) 노출.
- **단계**:
  1. x04 선택 → 우측 CapturePanel.
  2. 파일 입력에 유효 PNG/JPEG 영상 1장 업로드.
- **기대결과**: 201, 썸네일 3열 그리드에 영상 표시(서명 URL). 좌측 워크리스트 "영상 N" 배지 증가. DB `examination_images` 1행(storage_path=`<x04 id>/<uuid>.png`·content_type·file_size·uploaded_by=radiologist). **버킷에 실파일 저장 확인**(비공개). signed_url은 매 조회 재생성(DB 미저장).
- **유형**: 정상 + 인프라(스토리지)

### TC-E5-22: 영상 업로드 검증(MIME·용량·빈파일·lab·잠금)
- **검증**: FR-101 / Story 5.8 예외
- **역할/계정**: radiologist@pms.local (직접 API/curl)
- **단계**:
  1. PDF/GIF 등 비허용 MIME 업로드.
  2. 50MiB 초과 파일.
  3. 0바이트 빈 파일.
  4. lab 검사(x01)에 영상 업로드.
  5. 이미 performed인 imaging(x03)에 영상 업로드.
- **기대결과**: (1) 422 `invalid_mime`("지원하지 않는 영상 형식"·PNG/JPEG/WEBP). (2) 422 `file_too_large`(Content-Length 조기 거부 또는 읽은 길이 권위). (3) 422 `empty_file`. (4) 422 `not_imaging`("영상검사 오더가 아닙니다"). (5) 409 `examination_locked`("이미 촬영 수행된 검사"·ordered 동안만 업로드). 실패 시 Storage orphan 객체 보상 삭제(best-effort).
- **유형**: 예외 + 경계

### TC-E5-23: 촬영 수행 — 영상≥1 강제 + 장비 배정
- **검증**: FR-101 / Story 5.8
- **역할/계정**: radiologist@pms.local
- **사전조건**: x04(e08·ordered). TC-E5-21에서 영상 1장 업로드 완료 상태.
- **단계**:
  1. 영상 0장 상태에서 "촬영 수행" 시도 → 버튼 비활성(title "영상을 1장 이상...").
  2. (직접 API) 영상 0장 검사에 `POST /examinations/{id}/perform`.
  3. 영상 1장 업로드 후 장비 드롭다운에서 "XR-01 · 제1일반촬영기" 선택 → "촬영 수행".
  4. 장비 미배정("장비 미배정")으로도 수행 시도.
- **기대결과**: (1) 버튼 비활성. (2) 422 `image_required`("촬영 영상을 1장 이상 업로드해야 수행"). (3) 200 + 토스트 "촬영을 수행 처리했습니다." `status='performed'`·performed_by=radiologist·equipment_id=XR-01(same-status UPDATE로 배정). (4) 장비 NULL 허용 수행. **영상료 수가 fee_item 자동 적재**(x04 HA201 9,030·source_type=examination).
- **유형**: 정상 + 경계 + 수가 발화

### TC-E5-24: 촬영 재수행 차단 + 잘못된 장비
- **검증**: FR-093 / Story 5.8 예외
- **역할/계정**: radiologist@pms.local (직접 API)
- **단계**:
  1. 이미 performed인 x03(또는 TC-E5-23 직후 x04) 재수행 `POST /examinations/{id}/perform`.
  2. ordered인 검사 수행 시 equipment_id=무작위/비활성 UUID.
- **기대결과**: (1) 409 `invalid_transition`(소스상태 선검사·RPC PT409 백스톱). (2) 422 `invalid_equipment`("장비가 올바르지 않습니다"·미존재/비활성). 수가 중복 미적재.
- **유형**: 상태전이(차단) + 예외

### TC-E5-25: 촬영 워크리스트 권한·범위
- **검증**: FR-100 / Story 5.8
- **역할/계정**: radiologist@pms.local, doctor@pms.local, reception
- **단계**:
  1. radiologist `/radiology/worklist`.
  2. doctor·reception로 `GET /radiology/worklist`.
- **기대결과**: (1) 오늘 imaging·ordered·활성내원만(x04 노출·x03은 performed→미노출·lab 미노출). FIFO(ordered_at asc). image_count 배지. "지연 {mins}분"(30분 임계). (2) doctor 403(examination.perform 미보유)·reception 403. *(주의: doctor는 order.read만 보유 → 워크리스트는 perform 게이트라 403.)*
- **유형**: 권한·보안 + 경계

### TC-E5-26: 장비 목록·상태 조회(FR-103)
- **검증**: FR-103 / Story 5.8
- **역할/계정**: radiologist@pms.local, doctor@pms.local
- **단계**: `/radiology/equipment` 또는 `GET /equipment`.
- **기대결과**: 활성 장비 3종(XR-01·XR-02·US-01) 코드순·상태(available/in_use/maintenance) 표시. 게이트 order.read → radiologist·doctor·nurse 200, reception 403. 촬영 수행 드롭다운에서 비-available 장비는 disabled.
- **유형**: 정상 + 권한·보안

### TC-E5-27: 판독 완료 정상(performed→completed·소견 기록)
- **검증**: FR-102 / Story 5.9
- **역할/계정**: doctor@pms.local (판독의 겸임)
- **사전조건**: `/doctor/radiology`(판독 워크리스트). 좌측에 TC-E5-23에서 performed된 x04(또는 reset 직후엔 x04는 ordered→먼저 촬영 수행 필요) 노출.
- **단계**:
  1. 판독 대기(performed) 검사 선택 → 우측 ReadingPanel.
  2. 썸네일(서명 URL) 표시 확인.
  3. "판독 소견 *"에 "양측 폐야 청명, 활동성 병변 없음" 입력, "판독 결론(선택)"에 "정상" 입력.
  4. "판독 완료" 클릭.
- **기대결과**: 200 + 토스트 "판독을 완료했습니다." `status='completed'`·completed_by=doctor·findings/reading_conclusion 저장(same-status UPDATE 후 complete RPC·동일 txn). 워크리스트에서 제거. **수가 추가 미적재**(검사료는 performed 시점 이미 발생·completed는 무발화). findings/reading_conclusion 감사 마스킹.
- **유형**: 정상 + 상태전이

### TC-E5-28: 판독 — 빈 소견 차단 + 재완료/미수행 차단 + lab 차단
- **검증**: FR-102 / Story 5.9 예외
- **역할/계정**: doctor@pms.local (직접 API/UI)
- **단계**:
  1. ReadingPanel에서 소견 공백 → "판독 완료" 버튼 비활성(title "판독 소견을 입력해야...").
  2. (직접 API) findings=""(공백) `POST /examinations/{id}/complete`.
  3. ordered(미수행) 검사에 complete 호출.
  4. 이미 completed인 x03에 complete 재호출.
  5. lab 검사(x01)에 complete 호출.
- **기대결과**: (1) 버튼 비활성. (2) 422 `findings_required`("판독 소견을 입력해 주세요"·서비스 강제·DB CHECK 아님). (3) 409 `invalid_transition`(performed 아님). (4) 409 `invalid_transition`(재완료 차단·RPC PT409). (5) 422 `not_imaging`. reading_conclusion 공백 → NULL 정규화.
- **유형**: 예외 + 상태전이(차단)

### TC-E5-29: 판독 워크리스트 권한(examination.complete 게이트)
- **검증**: FR-102 / Story 5.9 권한
- **역할/계정**: doctor@pms.local, radiologist@pms.local, nurse
- **단계**:
  1. doctor `/doctor/radiology`.
  2. radiologist·nurse로 `GET /radiology/reading-worklist`.
- **기대결과**: (1) 200, 오늘 imaging·performed·활성내원·미판독만(FIFO performed_at). "판독 지연 {mins}분". (2) **radiologist 403**(examination.complete 미보유·perform만)·nurse 403. 판독은 의사 전속. *(영상 조회 `GET /examinations/{id}/images`는 order.read라 radiologist·doctor·nurse 200 = 판독의가 영상 재사용.)*
- **유형**: 권한·보안

### TC-E5-30: 영상 조회·서명 URL 재생성
- **검증**: FR-101 / Story 5.8·5.9
- **역할/계정**: doctor@pms.local, radiologist, reception
- **단계**: `GET /examinations/{x03 id}/images` 두 번 호출.
- **기대결과**: order.read 보유(doctor/radiologist/nurse) 200·reception 403. 응답에 signed_url(storage_path 비노출). 두 호출의 signed_url은 매번 재생성(DB 미저장). 검사 미존재 시 빈 목록(404 아님·조회 관용).
- **유형**: 권한·보안 + 경계

### TC-E5-31: 수가 자동발생 — 진찰료(초진/재진 동적·registered→in_progress)
- **검증**: FR-116 / FR-081 / Story 5.10 (+ Epic 7 0045 재정의)
- **역할/계정**: doctor@pms.local (진료 시작) + fee_item 조회(fee_item.read=doctor·reception)
- **사전조건**: registered 내원 e09(p09 임재욱·과거 완료 내원 없음=첫방문) / 과거 완료 내원 있는 환자의 새 내원.
- **단계**:
  1. e09 진료 허브에서 "진료 시작"(start_consult·registered→in_progress).
  2. `fee_items`(또는 수납 화면) 조회.
  3. 과거 completed 내원 보유 환자(예 p01·e01 완료)의 새 registered 내원을 진료 시작.
- **기대결과**: (1)(2) e09에 진찰료 fee_item 1건 — **초진 AA154 17,610원**(첫방문·encounter_start_initial 매핑). source_type=encounter·source_id=encounter_id·quantity=1·coverage covered·category 진찰료. (3) **재진 AA254 12,590원**(encounter_start_repeat). 트리거 1회 발화·unique 멱등. *(데모 시드 e01~e08은 이미 in_progress 전이로 진찰료 발화됨.)*
- **유형**: 상태전이 + 수가 발화(핵심)

### TC-E5-32: 수가 자동발생 — 검사료·영상료(ordered→performed)
- **검증**: FR-116 / Story 5.10
- **역할/계정**: nurse/radiologist(수행) + 조회
- **단계**:
  1. lab 검사(예 새 CBC 오더) 검체 수행(examination.perform) 또는 imaging 촬영 수행.
  2. fee_items 조회.
- **기대결과**: 수행 시점에 fee_item 적재 — CBC 3,500(C3800·검사료) / 흉부촬영 9,030(HA201·영상료). source_type=examination·source_id=examination_id·unit=amount=quantity*unit. **ordered 시점엔 미적재**(수행 완료 시만·FR-116). 데모 x01·x02·x03은 이미 적재됨, x04는 TC-E5-23 수행 후 적재.
- **유형**: 상태전이 + 수가 발화

### TC-E5-33: 수가 자동발생 — 처치료(ordered→performed)
- **검증**: FR-116 / Story 5.10
- **역할/계정**: nurse@pms.local (수행) + 조회
- **단계**: 처치 오더(t03 등) 수행 후 fee_items 조회.
- **기대결과**: 처치료 fee_item 적재(네뷸라이저 2,800·NA240·처치료·source_type=treatment). 데모 t01·t02 적재됨, t03은 TC-E5-15 수행 후 적재.
- **유형**: 상태전이 + 수가 발화

### TC-E5-34: 수가 — 약제비 미발생(처방 발행) 확인
- **검증**: FR-116 경계 / Story 5.10
- **역할/계정**: doctor + 조회
- **단계**: 처방 발행(TC-E5-01) 후 해당 내원 fee_items에서 약제비 검색.
- **기대결과**: **약제비 fee_item 0건**(drugs에 약가 컬럼 부재 → 5.10 미포함·설계 명시). 처방 발행은 fee_item 무발화. (원외처방전 발급은 별개·Epic 7.7.)
- **유형**: 경계(의도된 미구현)

### TC-E5-35: 수가 멱등성·중복 방지(트리거 1회·재시도)
- **검증**: FR-116 / NFR-040 / Story 5.10
- **역할/계정**: admin/직접 DB
- **단계**:
  1. 동일 검사를 수행→(불가능한)재수행 시도(TC-E5-24 차단됨) — 수가 1건 유지.
  2. (DB) 같은 source_type/source_id로 insert_fee_item 재호출 시도(트리거 외 직접은 authenticated EXECUTE 회수됨).
  3. fee_item amount 정합 확인(amount_krw = quantity * unit_amount_krw).
- **기대결과**: (1) unique(source_type, source_id) + on conflict do nothing → 중복 0. (2) `insert_fee_item`은 PUBLIC/authenticated EXECUTE 회수(SECURITY DEFINER 위조 적재 차단). (3) fee_items_amount_calc CHECK(0045) 충족.
- **유형**: 상태전이 + 권한·보안

### TC-E5-36: fee_item 조회 권한(fee_item.read)
- **검증**: Story 5.10 권한
- **역할/계정**: doctor·reception(보유), nurse(미보유)
- **단계**: 각 토큰으로 fee_items 조회(수납/대시보드 경유 또는 직접).
- **기대결과**: doctor·reception 200(fee_item.read), nurse 403. fee_mappings는 전역 참조(authenticated 전체 SELECT). 환자는 본인 내원 fee_items만(RLS self·Epic 8).
- **유형**: 권한·보안

### TC-E5-37: 오더 패널 통합 뷰 — pay-chip·예상수가·누락0 디텍터(5.5)
- **검증**: UX-DR13 / UX-DR21⑥ / Story 5.5
- **역할/계정**: doctor@pms.local
- **사전조건**: 검사·처치·처방 오더가 섞인 내원(예 e08: x04 imaging ordered + t03 처치 ordered) 진료 허브.
- **단계**:
  1. 오더 패널 탭별 카운트 배지 확인(처방 N·검사·영상·처치).
  2. 각 오더의 pay-chip(급여/비급여) 확인.
  3. "예상 수가" 프리뷰("자동 산정" 배지·총액·"급여 X · 비급여 Y" + "검사·영상·처치 기준. 진찰료·약가·본인부담은 수납에서").
  4. 30분 이상 미수행 ordered 오더 있을 때 amber 배너 "지연 미수행 오더 {n}건" + 라인별 "지연 {mins}분".
- **기대결과**: 카운트·pay-chip·예상수가 정확(coverage_type 마스터 기반). 예상수가는 검사·영상·처치만 합산(진찰료/약가 제외). 누락0 디텍터(오래된 미수행) 표시.
- **유형**: 정상 + 경계(표시 로직)

### TC-E5-38: 상태머신 무결성 — 역행·건너뛰기·잘못된 초기상태 차단(DB 최종선)
- **검증**: NFR-040 / Story 5.1
- **역할/계정**: admin/직접 DB(service_role)
- **단계**:
  1. examinations에 `status='completed'`로 직접 INSERT(잘못된 초기상태).
  2. ordered→completed 직접 UPDATE(건너뛰기).
  3. performed→ordered 직접 UPDATE(역행).
  4. dispensed 처방을 issued로 UPDATE(역행).
- **기대결과**: 전부 SQLSTATE `PT409`(enforce_act_order_transition / enforce_prescription_transition 트리거가 service_role·직접 UPDATE까지 봉쇄·최종 백스톱). INSERT는 ordered/issued만 허용. same-status UPDATE(비-상태 컬럼)는 통과(equipment_id·findings 갱신).
- **유형**: 상태전이(DB 불변식)

### TC-E5-39: 검사 lab 검체 수행(간호·examination.perform)
- **검증**: FR-060/061 / Story 5.3·5.8
- **역할/계정**: nurse@pms.local (examination.perform 보유)
- **사전조건**: lab 검사(예 새 CBC ordered) 존재.
- **단계**: lab 검사에 `POST /examinations/{id}/perform`(영상 없이).
- **기대결과**: ⚠️ **확인 필요 항목**: `call_perform_examination`는 `exam_type != 'imaging'` 시 422 `not_imaging`을 raise하고, imaging일 때만 image_required 검증. 즉 **lab 검사는 이 perform 경로로 수행 불가**(422 not_imaging) — lab 검체 수행 UI 경로가 별도 존재하는지/lab 수가 발생 경로가 어떻게 트리거되는지 갭 검증 대상. demo_seed의 lab x01/x02는 직접 UPDATE로 performed→completed 전이(수가 발화). → **테스트로 lab 검사의 실 수행 UI/엔드포인트 부재 여부를 명시 확인**.
- **유형**: 예외 + 갭 검증 (⚠️주의 항목)

### TC-E5-40: 오더-내원상태 게이트(종결 내원에 오더 차단·Epic 7 0053)
- **검증**: 횡단(Story 7.10) — Epic 5 오더 생성과 상호작용
- **역할/계정**: doctor@pms.local
- **사전조건**: completed 내원(e01~e06).
- **단계**: 완료된 내원(예 e01)에 검사/처치 오더 생성 또는 처방 발행 시도.
- **기대결과**: ⚠️ Epic 7(0053) `assert_encounter_orderable` 게이트가 종결/soft-deleted 내원의 오더 INSERT를 차단(BEFORE INSERT 트리거·in_progress/registered만 허용). → **종결 내원 오더 시 차단 확인**(데모 처방이 registered 단계에서 발행된 이유). Epic 5 단독 시점엔 게이트 없었으나 현 통합 상태에선 차단. *(이 시나리오는 Epic 5 오더가 현 통합 빌드에서 어떻게 동작하는지 확인.)*
- **유형**: 상태전이(횡단 게이트)

---

## FR 커버리지 체크
| 담당 FR | 커버 시나리오 | 비고 |
|---|---|---|
| FR-050 약품마스터 처방 발행(헤더+상세) | TC-E5-01, 03, 04 | drug_id FK only·free-text 차단·용량/횟수/일수/용법 |
| FR-051 처방-진단(A) 연결 | TC-E5-02 | 타 내원 진단 422 검증 포함 |
| FR-052 동일성분 중복처방 경고 | TC-E5-03 | 클라 ingredient_code·비차단·같은약 2회 |
| FR-060 진단검사·영상검사 오더('지시'·지시의사) | TC-E5-06, 07, 09 | exam_type lab/imaging·fee_schedule FK·status ordered |
| FR-061 워크리스트 라우팅(영상→방사선/검체→간호) | TC-E5-07, 08, 25, 39 | imaging 라우팅 확인·lab 수행 경로 갭(TC-39) |
| FR-070 처치 오더('지시'·간호 워크리스트) | TC-E5-08, 09, 20 | 단일 라우팅 |
| FR-080 오더 유형별 생명주기(지시자·수행자·시각) | TC-E5-01, 06, 08, 15, 23, 27, 38 | ordered_by/performed_by/completed_by·시각 |
| FR-081 확정진단·수행오더=수가 근거 | TC-E5-31~33, 35 | 트리거 발생원 |
| FR-090 처치 워크리스트 조회 | TC-E5-20 | pending_treatment_count |
| FR-091 활력징후 기록(6항목) | TC-E5-11, 12, 13 | 부분측정·최소1·범위CHECK |
| FR-092 처치 수행→수행상태 | TC-E5-15 | content 연결 nursing_record |
| FR-093 재수행 차단 | TC-E5-16, 24, 28, 38 | PT409→409·처치/촬영/판독 |
| FR-094 오더없는 일상 간호기록 | TC-E5-18, 19 | treatment_order_id NULL |
| FR-100 촬영 워크리스트·대기목록 | TC-E5-25 | imaging·ordered·FIFO |
| FR-101 촬영 수행·영상 스토리지·URL DB연결 | TC-E5-21, 22, 23, 30 | Storage 버킷·storage_path·서명URL·영상≥1 |
| FR-102 판독소견→검사오더 완료 | TC-E5-27, 28, 29 | findings 필수·performed→completed |
| FR-103 검사장비 목록·상태 | TC-E5-26, 23 | 3종·available 게이트 |
| FR-116 수가 자동발생 규칙 | TC-E5-31(진찰), 32(검사·영상), 33(처치), 34(약제비 미발생), 35(멱등) | 시점별 전수 |
| FR-032 진료 허브 활력 컨텍스트 | TC-E5-14 | encounter.read 조회 |
| NFR-040 상태전이 무결성 | TC-E5-16, 24, 28, 35, 38 | DB 트리거 백스톱·멱등 |

추가 권한·보안 전수: TC-E5-10(오더 발행/조회 403), 14(활력), 17(처치수행 403/404), 19(간호기록), 25(촬영), 29(판독), 30(영상), 36(fee_item).
