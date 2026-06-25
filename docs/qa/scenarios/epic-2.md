# Epic 2: 마스터 데이터 관리 — 테스트 시나리오

## 에픽 개요

Epic 2는 PMS의 "단일 진실(single source of truth)" 마스터 데이터 계층이다. 6개 스토리(2.1~2.6)가
조직 마스터(진료과·진료실)와 코드 마스터(KCD 진단·EDI 수가·약품)를 생성·수정·비활성(soft delete)하고,
유효기간(발효/만료)으로 시점 유효성을 관리하며, 재사용 검색 피커로 임상·정산 입력 시 자유 입력을 차단하고,
참조 무결성(비활성 마스터로의 신규 배정 차단·의존성 경고·코드 대소문자 무관 unique)을 데이터·API·UI
끝까지 강제한다. 마지막으로 2.6이 직원 진료과 배정 UI와 누적 웹 부채를 청산한다.

**핵심 아키텍처 결정(코드 확인 완료):**
- **읽기/쓰기 경로 분담:** 마스터 목록 *읽기* = web의 Supabase 직접조회(RLS `authenticated SELECT
  using(true)` — 0006/0007). *쓰기*(생성·수정·비활성) = FastAPI(`master.manage` 게이트 + service_role +
  동일 트랜잭션 권한 재평가 TOCTOU 차단). **단 하나의 예외 GET** = `GET /masters/departments/{id}/dependents`
  (직원 수 카운트가 users RLS 본인행을 넘어야 해서 API로 읽음).
- **soft delete만:** `is_active` 토글이 유일한 "삭제". DELETE 엔드포인트·DML 없음(과거 기록·FK 참조 보존).
- **버전 = effective-dating + audit_logs:** 코드 마스터는 `code` UNIQUE(코드당 1행) + `effective_from`/
  `effective_to` + 감사 변경이력. 별도 version 컬럼 없음.
- **마스터 화면 단일 경로:** `/admin/masters` 한 페이지에 5개 탭(진료과·진료실·진단(KCD)·수가(EDI)·약품).
  사이드바 라벨 = "마스터"(관리 섹션, `master.manage` 게이트, admin만 노출).
- **코드 CI unique(0008):** 5개 마스터 테이블 모두 `lower(code)` 함수 unique 인덱스 → `ORTHO`/`ortho` 공존 차단.
- **검색 피커는 Epic 2에 라이브 화면 없음:** `MasterSearchPicker`(Base UI Combobox)는 2.3이 만든 *재사용
  컴포넌트*이며 Epic 4/5/7에서 소비. Epic 2 범위에서 직접 보이는 곳은 진료실 폼·직원 폼·직원 디렉터리의
  **네이티브 `<select>`** 진료과 피커(피커 컴포넌트 아님)다. 따라서 피커 자체의 free-text 차단·키보드는
  단위 테스트 영역이며, E2E로는 Epic 4/5에서 검증된다. 본 문서는 Epic 2 표면(마스터 CRUD·soft delete·
  참조 무결성·직원 배정)을 전수 커버하고, 피커 계약은 코드/단위 수준으로만 명시한다.

> **시드 주의(코드 확인):** `supabase/seed.sql`은 Story 2.5 명세보다 진화했다. 후속 에픽이 컬럼을 추가해
> `fee_schedules.coverage_type`(급여/비급여), `diagnoses.patient_friendly_note`, `drugs.coverage_type`,
> `clinic_profile`, `fee_mappings`, `equipment`, `doctor_schedules` 등이 함께 시드된다. 아래 시나리오의
> 실제 코드 값은 **현재 seed.sql 그대로**다(진료과 7·진료실 8·진단 22·수가 18·약품 17).

## 스토리 ↔ FR ↔ 구현 매핑

| 스토리 | 기능 | 커버 FR | 핵심 구현(엔드포인트/화면/검증/마이그) |
|---|---|---|---|
| 2.1 | 진료과·진료실 마스터 생성·수정·비활성 + users FK + 감사·RLS | FR-200, FR-203 | 마이그 `0006_masters.sql`(departments·rooms·`users.department_id` FK) · `POST/PATCH /masters/departments[/active]`·`/masters/rooms[/active]` · 화면 `/admin/masters` 탭(진료과·진료실) · `_require_master_manage` TOCTOU · 감사 트리거 `trg_departments_audit`/`trg_rooms_audit` |
| 2.2 | 코드 마스터 3종(KCD·EDI·약품) + 유효기간 + 4상태 배지 | FR-201, FR-203 | 마이그 `0007_masters_codes.sql`(diagnoses·fee_schedules·drugs·effective_from/to·CHECK) · `POST/PATCH /masters/diagnoses`·`/masters/fee-schedules`·`/masters/drugs`[/active] · 탭 3개·`codeStatus` 배지(유효/발효전/만료/비활성)·`amount_krw` 정수 |
| 2.3 | 재사용 검색 피커 · free-text 차단 | FR-202 | 컴포넌트 `master-search-picker.tsx`(Base UI **Combobox**=목록 강제) · "현재 유효" 필터 `fetchCurrentlyValidMasters`/`isCurrentlyValid`(서버 today 주입) · DB/API 변경 0(읽기 전용) · Epic 4/5 소비 |
| 2.4 | 비활성 soft delete · 참조 무결성 심화 | FR-203, FR-200 | 마이그 `0008_masters_code_ci_unique.sql`(`lower(code)` unique×5) · `_assert_department_assignable`(insert_room/update_room 비활성 배정 422 `inactive_department`) · `GET /masters/departments/{id}/dependents`(진료실·직원 카운트) · `departmentLabel` "(비활성)"/"(미상)" 마커 |
| 2.5 | 마스터 시드 데이터 | FR-200~203(데이터) | `supabase/seed.sql` 마스터 5종(7·8·22·18·17, 전부 현재 유효 `effective_from=2020-01-01`·`effective_to=NULL`) · 멱등 `ON CONFLICT (lower(code)) DO NOTHING` · DEV 의사 IM 배정 |
| 2.6 | 직원 진료과 배정(생성·재배정) + 웹 하드닝 | FR-214(일부), FR-203 | `PATCH /admin/users/{id}/department`(`update_user_department`·`user.manage`·`_assert_department_assignable` 재사용) · 직원 생성폼/디렉터리 진료과 select · 다중행 pending Set · `fetchMasters` 부분 강등 · 피커 재시도 버튼 |

---

## 테스트 시나리오

> **공통 사전조건(모든 시나리오):** 로컬은 `supabase db reset`(0001~0008 마이그 + seed.sql) 후 API(:8060)·
> web(:3002) 기동. 클라우드는 https://kuntae802.mooo.com/patient_management_system (데모, 환자 미시드).
> 모든 계정 비밀번호 = `Staff1234`. 마스터 관리 화면 진입 경로 = 로그인 → 좌측 사이드바 "관리" 섹션 →
> "마스터"(`/admin/masters`). 비관리자는 사이드바에 "마스터" 항목 자체가 미노출.

---

### TC-E2-01: 진료과 생성(정상)
- **검증**: FR-200 / Story 2.1
- **역할/계정**: admin@pms.local
- **사전조건**: `/admin/masters` 진입, "진료과" 탭 활성(기본 탭).
- **단계**: 1) "진료과 추가" 버튼 클릭 → 모달 오픈. 2) 코드 `CARD`, 이름 `순환기내과`, 설명 `심장·혈관 외래`
  입력. 3) 저장.
- **기대결과**: 201 성공 toast, 진료과 목록에 `CARD · 순환기내과` 행이 즉시 추가(로컬 상태 머지·코드순
  정렬), 상태 배지 "활성"(색+글리프+라벨 3중). `POST /v1/masters/departments` 호출. 감사 로그(감사 뷰어
  1.10)에 actor=admin, action=create로 기록.
- **유형**: 정상

### TC-E2-02: 진료과 코드 중복 생성 → 409 code_taken
- **검증**: FR-200 / Story 2.1
- **역할/계정**: admin@pms.local
- **사전조건**: 시드에 진료과 `IM`(내과) 존재.
- **단계**: 1) "진료과 추가". 2) 코드 `IM`, 이름 `중복내과` 입력. 3) 저장.
- **기대결과**: 409 `code_taken`. 코드 필드에 인라인 에러("이미 사용 중인 진료과 코드입니다."), 행 미추가.
- **유형**: 예외

### TC-E2-03: 진료과 코드 대소문자만 다른 중복 → 409 (CI unique)
- **검증**: FR-203 / Story 2.4(AC6), Story 2.5
- **역할/계정**: admin@pms.local
- **사전조건**: 시드 진료과 `IM` 존재(0008 `lower(code)` unique 적용).
- **단계**: 1) "진료과 추가". 2) 코드 `im`(소문자) 또는 `Im`, 이름 `소문자내과`. 3) 저장.
- **기대결과**: 409 `code_taken`(대소문자 무관 유일성). 행 미추가. (대문자 원본 케이스는 표시 보존됨.)
- **유형**: 경계

### TC-E2-04: 진료과 코드 공백/빈값 검증 → 422
- **검증**: FR-200 / Story 2.1
- **역할/계정**: admin@pms.local
- **사전조건**: 진료과 추가 모달.
- **단계**: 1) 코드 공란(또는 공백만 `   `), 이름 정상 입력. 2) 저장 시도.
- **기대결과**: 클라 Zod 검증으로 제출 차단(필수). 직접 API 호출 시 `_Stripped`(trim)+`min_length=1`로
  422. 공백만 입력은 trim 후 빈 문자열 → 거부(unique 우회 방지).
- **유형**: 예외·경계

### TC-E2-05: 진료과 수정(이름·설명, code 불변)
- **검증**: FR-200 / Story 2.1
- **역할/계정**: admin@pms.local
- **사전조건**: 시드 진료과 `OS`(정형외과) 존재.
- **단계**: 1) `OS` 행 [수정] → 모달 오픈. 2) 코드 필드가 **disabled**(수정 불가)임을 확인. 3) 이름을
  `정형외과·관절`로, 설명을 `근골격·관절 전문`으로 변경. 4) 저장.
- **기대결과**: `PATCH /v1/masters/departments/{id}` 200, 이름·설명만 갱신, code는 `OS` 유지, `updated_at`
  갱신. 감사 로그에 before/after 스냅샷 기록.
- **유형**: 정상

### TC-E2-06: 존재하지 않는 진료과 수정 → 404
- **검증**: FR-200 / Story 2.1
- **역할/계정**: admin@pms.local
- **사전조건**: 임의 UUID(미존재).
- **단계**: 1) `PATCH /v1/masters/departments/00000000-0000-0000-0000-000000000999`로 직접 호출(name 포함).
- **기대결과**: 404 NotFound.
- **유형**: 예외

### TC-E2-07: 진료과 비활성(soft delete) + 행 보존 + 재활성
- **검증**: FR-203 / Story 2.1(AC2), 2.4(AC1)
- **역할/계정**: admin@pms.local
- **사전조건**: 의존성 없는 진료과 1개(또는 TC-E2-01에서 만든 `CARD`).
- **단계**: 1) 대상 진료과 행 [비활성] 클릭 → ConfirmDialog("…비활성하면 신규 선택에서 제외됩니다. 비활성해도
  과거 기록의 참조는 그대로 유지됩니다. 진행하시겠습니까?"). 2) [비활성] 확인. 3) 상태 배지가 "비활성"으로
  바뀌고 행/명칭은 그대로 보존됨을 확인. 4) 같은 행 [활성] 클릭 → **확인 없이 즉시** 재활성.
- **기대결과**: `PATCH .../active {is_active:false}` → 200, 물리 삭제 없음(행·code·name 보존). 재활성도
  `{is_active:true}` 200. 두 변경 모두 감사 기록.
- **유형**: 정상·경계

### TC-E2-08: 진료과 비활성 시 의존성 경고(진료실·직원 카운트)
- **검증**: FR-203 / Story 2.4(AC4)
- **역할/계정**: admin@pms.local
- **사전조건**: 시드 진료과 `IM`(내과) — 시드에 진료실 `R101`(IM 소속)이 있고 DEV 의사(doctor@pms.local)가
  IM에 배정됨(seed.sql).
- **단계**: 1) "진료과" 탭에서 `IM` 행 [비활성] 클릭. 2) 카운트 선조회(`GET .../IM_id/dependents`) 후
  ConfirmDialog 표시.
- **기대결과**: 다이얼로그 본문에 "현재 N개 진료실 · M명 직원이 이 진료과를 참조 중이며…"(시드 기준
  진료실 1개[R101] · 직원 1명[doctor]). 이는 **경고일 뿐 차단 아님** — 진행하면 비활성됨. 직원 카운트는
  재직(active+on_leave) 기준, 퇴사자 제외.
- **유형**: 정상(경고 경로)

### TC-E2-09: 의존성 카운트 조회 실패 시 fail-soft 폴백
- **검증**: FR-203 / Story 2.4(AC4)
- **역할/계정**: admin@pms.local
- **사전조건**: 진료과 비활성 시도 중 dependents API 일시 실패(네트워크 차단/서버 일시장애 모의).
- **단계**: 1) 진료과 행 [비활성] 클릭(카운트 조회가 실패하도록 유도).
- **기대결과**: 카운트 없이 **일반 비활성 확인 문구**로 폴백(경고는 보조 정보 — 비활성 자체를 막지 않음).
  진행하면 정상 비활성.
- **유형**: 예외(fail-soft)

### TC-E2-10: 진료실 생성(진료과 소속, 정상)
- **검증**: FR-200 / Story 2.1
- **역할/계정**: admin@pms.local
- **사전조건**: "진료실" 탭, 시드 진료과 존재.
- **단계**: 1) "진료실 추가" → 모달. 2) 코드 `R201`, 이름 `제7진료실`, 소속 진료과 select에서 `내과(IM)`
  선택(활성 진료과만 노출). 3) 저장.
- **기대결과**: 201, "소속 진료과" 셀에 `내과` 표시. `POST /v1/masters/rooms` department_id 포함.
- **유형**: 정상

### TC-E2-11: 진료실 생성(무소속, department_id NULL)
- **검증**: FR-200 / Story 2.1
- **역할/계정**: admin@pms.local
- **사전조건**: "진료실" 탭.
- **단계**: 1) "진료실 추가". 2) 코드 `TRT2`, 이름 `제2처치실`, 소속 진료과 = "소속 없음" 선택. 3) 저장.
- **기대결과**: 201, "소속 진료과" 셀은 `—`(공란 표시). department_id=NULL 허용.
- **유형**: 정상·경계

### TC-E2-12: 진료실 생성 — 미존재 진료과 배정 → 422 invalid_department
- **검증**: FR-200, FR-203 / Story 2.1, 2.4
- **역할/계정**: admin@pms.local
- **사전조건**: 미존재 진료과 UUID.
- **단계**: 1) `POST /v1/masters/rooms`로 직접 호출, department_id = 임의 미존재 UUID.
- **기대결과**: 422 `invalid_department`("존재하지 않는 진료과입니다."). `_assert_department_assignable`이
  사전 차단(FK 위반은 백스톱).
- **유형**: 예외

### TC-E2-13: 진료실 생성 — 비활성 진료과 신규 배정 차단 → 422 inactive_department
- **검증**: FR-203 / Story 2.4(AC3)
- **역할/계정**: admin@pms.local
- **사전조건**: 진료과 1개를 먼저 비활성 처리(예: `DERM` 비활성).
- **단계**: 1) `POST /v1/masters/rooms` department_id = 비활성 `DERM`의 id로 직접 호출.
  (UI 피커는 활성만 노출하므로 차단은 API 권위 레벨 검증.)
- **기대결과**: 422 `inactive_department`("비활성된 진료과에는 새로 배정할 수 없습니다."). 행 미생성.
- **유형**: 권한·보안(참조 무결성)

### TC-E2-14: 진료실 소속 변경 → 비활성 진료과로 새 배정 차단(update)
- **검증**: FR-203 / Story 2.4(AC3)
- **역할/계정**: admin@pms.local
- **사전조건**: 활성 진료실 `R105`(소속 PED), 진료과 `DERM`을 비활성 처리.
- **단계**: 1) `PATCH /v1/masters/rooms/{R105_id}`로 department_id = 비활성 `DERM` id, name 동일 전송.
- **기대결과**: 422 `inactive_department`(현 소속과 **다른** 비활성 진료과로의 변경 차단). 소속 미변경.
- **유형**: 권한·보안(참조 무결성)

### TC-E2-15: 진료실 소속 유지 수정 허용(현 소속이 비활성이어도 이름만 변경)
- **검증**: FR-203 / Story 2.4(AC3 예외)
- **역할/계정**: admin@pms.local
- **사전조건**: 진료실이 비활성 진료과 `X`에 소속된 상태(예: R106이 DERM 소속, DERM을 비활성으로 전환).
- **단계**: 1) `PATCH /v1/masters/rooms/{R106_id}`로 department_id = 현 소속(DERM, 비활성) **그대로**,
  name만 `제6진료실(개명)`으로 변경.
- **기대결과**: 200 성공(현 비활성 소속 유지는 허용 — 이탈 강요 금지). 변경분(department_id가 현 값과
  동일)이라 활성 검사 미적용. 이름 갱신됨.
- **유형**: 경계

### TC-E2-16: 진료실 비활성/재활성 + 비활성 소속 마커 표시
- **검증**: FR-203 / Story 2.1, 2.4(AC5)
- **역할/계정**: admin@pms.local
- **사전조건**: 진료과 `OS` 비활성, 진료실 `R103`(OS 소속) 활성.
- **단계**: 1) "진료실" 탭에서 `R103` 행의 "소속 진료과" 셀 확인.
- **기대결과**: 셀에 `정형외과 (비활성)` 마커 표시(`departmentLabel`이 비활성 소속에 "(비활성)" 접미사).
  소속 미해석 시 폴백은 "(삭제된 진료과)"가 아닌 "(미상)". 진료실 자체 비활성 토글도 정상 동작.
- **유형**: 경계(UI 명확성)

### TC-E2-17: 존재하지 않는 진료실 수정/비활성 → 404
- **검증**: FR-200 / Story 2.1
- **역할/계정**: admin@pms.local
- **사전조건**: 미존재 room UUID.
- **단계**: 1) `PATCH /v1/masters/rooms/{미존재}` 또는 `.../active` 호출.
- **기대결과**: 404 NotFound.
- **유형**: 예외

### TC-E2-18: KCD 진단 생성 + 유효기간(정상)
- **검증**: FR-201 / Story 2.2
- **역할/계정**: admin@pms.local
- **사전조건**: "진단(KCD)" 탭.
- **단계**: 1) "진단 추가" → 모달. 2) 코드 `J06.9`, 이름 `상세불명의 급성 상기도감염`, 발효일 `2020-01-01`
  (기본=오늘), 만료일 비움. 3) 저장.
- **기대결과**: 201, 목록에 추가, 상태 배지 "유효"(발효일 과거·만료 없음·활성). `POST /v1/masters/diagnoses`.
- **유형**: 정상

### TC-E2-19: 진단 만료일 < 발효일 → 422
- **검증**: FR-201 / Story 2.2
- **역할/계정**: admin@pms.local
- **사전조건**: 진단 추가 모달.
- **단계**: 1) 코드 `Z00.0`, 이름 `테스트`, 발효일 `2026-06-24`, 만료일 `2026-06-01`(발효보다 빠름). 2) 저장.
- **기대결과**: 클라 Zod refine 즉시 차단 + 서버 Pydantic `_EffectiveRange` model_validator 422("만료일은
  발효일보다 빠를 수 없습니다") + DB CHECK `diagnoses_effective_range`가 최종선. 3중 검증.
- **유형**: 예외·경계

### TC-E2-20: 진단 코드 중복 → 409 code_taken
- **검증**: FR-201 / Story 2.2
- **역할/계정**: admin@pms.local
- **사전조건**: 시드 진단 `I10`(본태성 고혈압) 존재.
- **단계**: 1) "진단 추가". 2) 코드 `i10`(소문자, CI unique 동시 검증), 이름 `중복`, 발효일 과거. 3) 저장.
- **기대결과**: 409 `code_taken`("이미 사용 중인 진단 코드입니다."). 대소문자 무관(0008)으로 `i10`도 충돌.
- **유형**: 예외·경계

### TC-E2-20b: 진단 4상태 시점 배지 검증(유효/발효전/만료/비활성)
- **검증**: FR-201, FR-203 / Story 2.2(AC2)
- **역할/계정**: admin@pms.local
- **사전조건**: 진단 4개 — ① 시드 `I10`(유효) ② 발효일 미래(예 `2030-01-01`)인 신규 ③ 만료일 과거(예
  발효 `2020-01-01`·만료 `2021-01-01`)인 신규 ④ 비활성 처리된 신규.
- **단계**: 1) "진단(KCD)" 탭에서 4개 행의 상태 배지 확인.
- **기대결과**: ① "유효"(status-done) ② "발효 전"(muted) ③ "만료"(amber/warn) ④ "비활성"(cancelled).
  각 배지가 색+글리프+라벨 3중 인코딩(음영 비의존, UX-DR20). 서버 today(KST) 기준 판정.
- **유형**: 경계

### TC-E2-21: EDI 수가 생성 + 금액(KRW 정수)
- **검증**: FR-201 / Story 2.2
- **역할/계정**: admin@pms.local
- **사전조건**: "수가(EDI)" 탭.
- **단계**: 1) "수가 추가" → 모달. 2) 코드 `EE100`, 이름 `데모처치료`, 금액 `15000`, 분류 `처치료`,
  발효일 과거. 3) 저장.
- **기대결과**: 201, "금액(원)" 셀에 `15,000`(천단위 `Intl.NumberFormat('ko-KR')`, tabular-nums, 우측 정렬).
  `POST /v1/masters/fee-schedules`(URL은 하이픈).
- **유형**: 정상

### TC-E2-22: 수가 금액 음수 → 422
- **검증**: FR-201 / Story 2.2
- **역할/계정**: admin@pms.local
- **사전조건**: 수가 추가 모달.
- **단계**: 1) 금액 `-100` 입력(또는 직접 API 호출). 2) 저장.
- **기대결과**: 422(Pydantic `amount_krw Field(ge=0)` + DB CHECK `fee_schedules_amount_nonneg`). `<input
  type="number" min="0">`이 UI에서 1차 차단.
- **유형**: 예외·경계

### TC-E2-23: 수가 금액 상한 초과(int 오버플로) → 422 (503 아님)
- **검증**: FR-201 / Story 2.2(코드리뷰 patch)
- **역할/계정**: admin@pms.local
- **사전조건**: 수가 추가/수정.
- **단계**: 1) 금액 `2147483648`(2^31, PG integer 상한 초과) 입력 또는 직접 API 호출.
- **기대결과**: 422(`Field(le=2_147_483_647)` + zod refine). **503으로 오인되지 않음**(미차단 시 asyncpg
  오버플로가 `_run_authed`에서 ServiceUnavailable로 오매핑되는 결함을 막은 patch 검증).
- **유형**: 경계

### TC-E2-24: 약품 생성(주성분코드·단위)
- **검증**: FR-201 / Story 2.2
- **역할/계정**: admin@pms.local
- **사전조건**: "약품" 탭.
- **단계**: 1) "약품 추가" → 모달. 2) 코드 `699900010`, 이름 `데모정10mg`, 주성분코드 `100001ATB`,
  단위 `정`, 발효일 과거. 3) 저장.
- **기대결과**: 201, 컬럼 코드·이름·주성분코드·단위·발효일·만료일·상태 표시. 주성분/단위 미입력 시 `—`.
  `POST /v1/masters/drugs`.
- **유형**: 정상

### TC-E2-25: 코드 마스터 수정 시 code disabled + 유효기간 갱신
- **검증**: FR-201 / Story 2.2
- **역할/계정**: admin@pms.local
- **사전조건**: 시드 진단 `M54.5`(요통).
- **단계**: 1) `M54.5` [수정] → 모달. 2) 코드 필드 disabled 확인. 3) 만료일을 `2030-12-31`로 설정 후 저장.
- **기대결과**: 200, code 불변, 만료일 갱신, 상태 배지 "유효" 유지(만료일 미래). `PATCH /v1/masters/diagnoses/{id}`.
- **유형**: 정상

### TC-E2-26: 코드 마스터 비활성 후 행·명칭 보존(참조 무결성)
- **검증**: FR-203 / Story 2.2(AC3), 2.4(AC2)
- **역할/계정**: admin@pms.local
- **사전조건**: 시드 약품 `645100250`(타이레놀정500밀리그람) 존재.
- **단계**: 1) 약품 `645100250` [비활성] → ConfirmDialog 확인. 2) 비활성 후 행이 목록에 남고 코드·명칭이
  그대로 표시됨을 확인. 3) 재활성.
- **기대결과**: 물리 삭제 없음, 상태 배지 "비활성"→재활성 시 "유효". authenticated SELECT(RLS)가 비활성 행도
  반환하므로 관리화면·과거기록 참조 시 명칭 정상 표시. soft delete만(DELETE 엔드포인트 부재).
- **유형**: 정상·경계

### TC-E2-27: 비관리자(doctor) 마스터 쓰기 → 403 + 사이드바 미노출
- **검증**: FR-200, FR-201 / Story 2.1~2.2(AC1·RBAC)
- **역할/계정**: doctor@pms.local
- **사전조건**: doctor 로그인. doctor는 `master.manage` 미보유.
- **단계**: 1) 사이드바 "관리" 섹션에 "마스터" 항목이 **미노출**임을 확인. 2) `/admin/masters` 직접 URL
  접근 시도 → `/home`(STAFF_HOME) 강등. 3) `POST /v1/masters/departments` 직접 호출.
- **기대결과**: nav 미노출 + RSC 가드 강등 + API 403(`require_permission("master.manage")`). 평가↔쓰기
  동일 트랜잭션 재평가(TOCTOU).
- **유형**: 권한·보안

### TC-E2-28: 비관리자(nurse) 코드 마스터 쓰기 → 403
- **검증**: FR-201 / Story 2.2(RBAC)
- **역할/계정**: nurse@pms.local
- **사전조건**: nurse 로그인(master.manage 미보유).
- **단계**: 1) `POST /v1/masters/diagnoses`·`/fee-schedules`·`/drugs` 직접 호출. 2) `.../active` PATCH 호출.
- **기대결과**: 전부 403. 모든 마스터 쓰기 엔드포인트가 `Depends(require_master_manage)` 게이트.
- **유형**: 권한·보안

### TC-E2-29: anon(비로그인) 마스터 직접조회 차단
- **검증**: FR-200, FR-203 / Story 2.1~2.2(RLS·GRANT)
- **역할/계정**: 비로그인(anon)
- **사전조건**: 토큰 없음.
- **단계**: 1) Supabase REST로 `departments`·`diagnoses` 등 anon 키 조회 시도.
- **기대결과**: 거부(0006/0007 `revoke all ... from anon` + RLS). authenticated만 SELECT 가능.
- **유형**: 권한·보안

### TC-E2-30: authenticated 직접조회는 비활성·만료 행도 반환(방어심층)
- **검증**: FR-203 / Story 2.2~2.4(AC2·AC3)
- **역할/계정**: doctor@pms.local(또는 임의 직원)
- **사전조건**: 비활성·만료 마스터 행이 섞인 상태.
- **단계**: 1) authenticated 토큰으로 `diagnoses` 직접 SELECT(RLS `using(true)`).
- **기대결과**: 활성+비활성+만료 행이 **전부** 반환됨(관리화면이 편집 위해 봐야 하므로). 신규 선택 제외는
  소비처 피커의 "현재 유효" 필터가 책임(RLS는 필터 안 함).
- **유형**: 경계(방어심층 확인)

### TC-E2-31: users.department_id FK 무결성(미존재 진료과 직원 배정 차단)
- **검증**: FR-200 / Story 2.1(AC4)
- **역할/계정**: admin@pms.local(또는 DB 레벨)
- **사전조건**: 0006이 `users_department_id_fkey` FK 추가.
- **단계**: 1) `update_user_department`(또는 직접 SQL)로 미존재 진료과 UUID를 직원에 배정 시도.
- **기대결과**: API 레벨은 `_assert_department_assignable`로 422 `invalid_department`. DB 레벨은 FK 위반으로
  차단(존재하지 않는 진료과로의 직원 배정 불가).
- **유형**: 권한·보안(참조 무결성)

### TC-E2-32: 마스터 변경 감사 기록 + 감사 뷰어 조회
- **검증**: FR-200, FR-201, FR-203 / Story 2.1~2.2(AC3/AC4)
- **역할/계정**: admin@pms.local
- **사전조건**: 진료과/진단 1건 생성·수정·비활성 완료.
- **단계**: 1) 변경 후 감사 뷰어(`/admin/audit` 또는 1.10 화면)에서 해당 테이블 변경 이력 조회.
- **기대결과**: 생성/수정/비활성 각각 actor=admin, target_id=행 id, before/after 스냅샷이 `audit_logs`에
  자동 기록(0004 `audit_trigger_fn` + 0006/0007 트리거). 앱이 직접 INSERT 하지 않음(트리거 소유).
- **유형**: 정상(감사)

### TC-E2-33: 시드 마스터 적재·현재유효 검증(피커가 실제 코드 노출)
- **검증**: FR-200~203 / Story 2.5(AC1·AC2·AC4)
- **역할/계정**: admin@pms.local
- **사전조건**: `supabase db reset` 직후.
- **단계**: 1) 5개 탭을 차례로 열어 행 수와 대표 코드 확인.
- **기대결과**: 진료과 7(`IM`·`FM`·`OS`·`ENT`·`PED`·`DERM`·`SU`), 진료실 8(`R101`~`R106`·`TRT1`·`XR1`),
  진단 22(`J00`·`I10`·`M54.5`·`E11.9`…), 수가 18(`AA154` 초진진찰료 17,610원·`AA254` 재진 12,590원·`C3800`
  CBC·`HA201` 흉부촬영·`KK054` 근육내주사…), 약품 17(`645100250` 타이레놀·`641603080` 노바스크/암로디핀…).
  전 코드 행 "유효" 배지(effective_from=2020-01-01·effective_to=NULL·is_active=true). 미래 발효·비활성 시드 0건.
- **유형**: 정상

### TC-E2-34: 시드 멱등(재실행 안전)
- **검증**: FR-200~203 / Story 2.5(AC5)
- **역할/계정**: 개발자(로컬)
- **사전조건**: 시드 적재된 로컬 DB.
- **단계**: 1) `supabase db reset` 1회 더 또는 `psql -f supabase/seed.sql` 재실행.
- **기대결과**: 중복 0(카운트 7/8/22/18/17 불변). `ON CONFLICT (lower(code)) DO NOTHING` 발화. dev 계정
  do-block 무회귀(앞 블록 보존). (참고: `ON CONFLICT (code)`였다면 0008 함수 인덱스로 인해 에러 발생 —
  반드시 `(lower(code))`여야 함.)
- **유형**: 경계(멱등·안전)

### TC-E2-35: 시드 진료실 FK 무결성(department_id 서브셀렉트 참조)
- **검증**: FR-200 / Story 2.5(AC1)
- **역할/계정**: 개발자/admin
- **사전조건**: 시드 적재.
- **단계**: 1) `rooms` 조회. `R101`~`R106`의 department_id가 각 진료과에 정확히 매핑되고 `TRT1`·`XR1`은 NULL인지 확인.
- **기대결과**: `R101→IM`·`R102→FM`·`R103→OS`·`R104→ENT`·`R105→PED`·`R106→DERM`, `TRT1`/`XR1`=NULL.
  서브셀렉트 미스로 인한 무음 NULL 없음(매핑 진료실 전부 non-NULL).
- **유형**: 경계

### TC-E2-36: 직원 생성 시 진료과 배정(폼 피커)
- **검증**: FR-214(일부) / Story 2.6(AC1)
- **역할/계정**: admin@pms.local
- **사전조건**: `/admin/users`(직원 계정), 시드 진료과 존재.
- **단계**: 1) "직원 추가"(생성 폼) → 소속 진료과 select(활성 진료과만 + "소속 없음"). 2) `내과(IM)` 선택,
  나머지 필드 입력 후 저장.
- **기대결과**: 직원이 IM 소속으로 생성(`StaffCreate.department_id` 전송, 빈값이면 payload 제외).
  1.8의 "진료과 마스터 구축 후 배정합니다" 보류 주석 자리에 실제 피커 노출.
- **유형**: 정상

### TC-E2-37: 직원 진료과 재배정/해제(디렉터리 인라인 select)
- **검증**: FR-214(일부), FR-203 / Story 2.6(AC2)
- **역할/계정**: admin@pms.local
- **사전조건**: 직원 디렉터리에 직원 존재(예 doctor — IM 소속).
- **단계**: 1) "소속 진료과" 열의 인라인 select에서 `정형외과(OS)`로 변경. 2) 다시 "소속 없음"으로 해제.
- **기대결과**: `PATCH /v1/admin/users/{id}/department`(권한 `user.manage`) 200, 성공 toast("소속 진료과가
  변경되었습니다"). 해제 시 department_id=NULL. `departmentLabel`로 셀 표시. 변경 감사 기록.
- **유형**: 정상

### TC-E2-38: 직원 재배정 — 비활성 진료과 → 422 + 비권한자 403
- **검증**: FR-203, FR-214 / Story 2.6(AC2·AC7)
- **역할/계정**: admin@pms.local(422), doctor@pms.local(403)
- **사전조건**: 진료과 1개 비활성, 직원 존재.
- **단계**: 1) admin이 직원을 비활성 진료과로 재배정 시도(직접 API). 2) 미존재 진료과 UUID로 재배정.
  3) doctor가 `PATCH /v1/admin/users/{id}/department` 호출. 4) 미존재 user_id로 재배정.
- **기대결과**: 1) 422 `inactive_department`(`_assert_department_assignable` 재사용). 2) 422
  `invalid_department`. 3) 403(`user.manage` 미보유). 4) 404. (department_id=NULL 해제는 검증 생략·허용.)
- **유형**: 권한·보안·예외

### TC-E2-39: 마스터 검색 피커 — free-text 차단(컴포넌트 계약)
- **검증**: FR-202 / Story 2.3(AC1)
- **역할/계정**: 임상·원무 직원(컴포넌트 단위/통합)
- **사전조건**: `MasterSearchPicker`(Base UI Combobox). 마스터 시드 존재. (Epic 2엔 라이브 화면 없음 —
  단위 테스트 또는 Epic 4/5 소비 화면에서 E2E 검증.)
- **단계**: 1) 피커 열고 `고혈압` 또는 `I10` 타이핑 → 후보 표시. 2) 목록에 없는 임의 텍스트 `zzz없는코드`
  타이핑. 3) Enter/blur.
- **기대결과**: 1) `I10 · 본태성(원발성) 고혈압` 후보가 검색됨(코드 OR 명칭, 대소문자 무관 부분일치).
  선택 시 `onValueChange`로 식별 필드 전달. 2) `Combobox.Empty`("일치하는 코드가 없습니다. 마스터에 없는
  코드는 입력할 수 없습니다") 표시, **임의 텍스트가 값으로 커밋되지 않음**(onValueChange 미호출).
- **유형**: 권한·보안(단일 진실)

### TC-E2-40: 마스터 검색 피커 — "현재 유효" 필터(만료/발효전/비활성 제외)
- **검증**: FR-202, FR-203 / Story 2.3(AC1·AC2)
- **역할/계정**: 임상 직원(컴포넌트/Epic 4·5 소비)
- **사전조건**: 진단 마스터에 유효 행 + 만료 행 + 발효전 행 + 비활성 행 혼재.
- **단계**: 1) 피커를 열어 후보 목록 확인.
- **기대결과**: `is_active=true AND effective_from <= today AND (effective_to IS NULL OR effective_to >=
  today)`인 행만 노출. 만료·발효전·비활성 행은 피커 후보에서 제외(`fetchCurrentlyValidMasters` SQL 필터 +
  `isCurrentlyValid` 방어 필터, 서버 today 주입). 관리화면(TC-E2-30)과 달리 피커는 유효만.
- **유형**: 경계

### TC-E2-41: 마스터 검색 피커 — 키보드 완전 조작 + aria-live(접근성)
- **검증**: FR-202 / Story 2.3(AC2·UX-DR19·20)
- **역할/계정**: 임상 직원(접근성)
- **사전조건**: 피커 열림.
- **단계**: 1) 마우스 없이 타이핑 → ↓↓로 이동 → Enter로 선택 → Esc로 닫기.
- **기대결과**: 입력 `role=combobox`, 목록 `role=listbox`, 항목 `role=option`, `aria-activedescendant`로
  하이라이트. `Combobox.Status`(aria-live polite)가 "N개 결과" 안내. `:focus-visible` 링. 선택은 색+글리프
  (체크)+텍스트(음영 비의존). Esc 후 포커스 복원.
- **유형**: 정상(접근성)

### TC-E2-42: 마스터 검색 피커 — kind/multiple 재사용 계약
- **검증**: FR-202 / Story 2.3(AC3)
- **역할/계정**: 개발/통합
- **사전조건**: 피커.
- **단계**: 1) `kind="drug"`(주성분·단위 표시) / `kind="fee_schedule"`(금액 `formatKrw` 천단위) /
  `kind="diagnosis"` 전환. 2) `multiple=true`로 진단 다중선택(칩 2개).
- **기대결과**: kind별 보조 정보 표시 차이 + 선택 item이 종류별 식별 필드 담음(진단 `{code,name}`, 약품
  `{code,name,ingredient_code}`, 수가 `{code,name,category,amount_krw}`). multiple=true는 칩 렌더.
- **유형**: 정상(재사용)

### TC-E2-43: 다중행 pending 경합 해소(웹 하드닝)
- **검증**: Story 2.6(AC3)
- **역할/계정**: admin@pms.local
- **사전조건**: 마스터 관리 화면에 여러 행 존재.
- **단계**: 1) 한 행의 활성 토글(또는 진료과 비활성 카운트 조회) 진행 중에 다른 행을 빠르게 토글.
- **기대결과**: 각 행이 독립적으로 disable(`pending: Set<string>`). 한 행의 완료가 다른 행의 pending을
  조기 해제하지 않음. 이중 제출 방지. 직원 디렉터리 재배정도 동일 per-id Set.
- **유형**: 경계(동시성 UI)

### TC-E2-44: 마스터 조회 부분 강등(단일 실패점 제거)
- **검증**: Story 2.6(AC4)
- **역할/계정**: admin@pms.local
- **사전조건**: 5종 마스터 중 1종 조회만 실패하도록 유도(예 한 테이블 권한/네트워크 차단).
- **단계**: 1) `/admin/masters` 진입.
- **기대결과**: 실패한 탭만 에러 배너(`role="alert"`), 정상 4개 탭은 정상 렌더. **첫 에러로 전체 화면
  다운되지 않음**(`fetchMasters`가 per-table error 수집 `{data, errors}`). 전부 성공 시 기존과 동일.
- **유형**: 예외(부분 강등)

### TC-E2-45: 검색 피커 로드 실패 시 재시도
- **검증**: Story 2.6(AC5)
- **역할/계정**: 임상 직원(컴포넌트)
- **사전조건**: 피커의 코드 로드가 첫 시도 실패(`loadError` 설정).
- **단계**: 1) 입력이 비활성(`disabled`)·`role="alert"` 메시지 확인. 2) "다시 시도" 버튼 클릭(재조회 성공
  유도).
- **기대결과**: 페이지 전체 remount 없이 재조회(`reloadKey` 증가) → 성공 시 정상 동작 복구. fail-loud(에러
  중 입력 차단)는 유지하되 복구 경로 추가.
- **유형**: 예외(복구)

### TC-E2-46: 빈 마스터 상태(빈 테이블) UI
- **검증**: FR-200, FR-201 / Story 2.1~2.2
- **역할/계정**: admin@pms.local
- **사전조건**: 마스터가 비어있는 상태(시드 미적재·클라우드 등).
- **단계**: 1) 각 탭 열기.
- **기대결과**: 빈 상태 안내("등록된 진료과가 없습니다. '진료과 추가'로 시작하세요." 등)·"추가" 버튼 노출.
  크래시 없음.
- **유형**: 경계

---

## FR 커버리지 체크

| 담당 FR | 커버 시나리오 | 비고 |
|---|---|---|
| FR-200 진료과·진료실 마스터 관리(생성·수정·비활성) | TC-E2-01~17, 31, 33, 35, 46 | 진료과 CRUD·진료실 CRUD·소속 FK·시드·빈상태 전수. 비활성=soft delete(07/16) |
| FR-201 진단(KCD)·수가(EDI)·약품 마스터 + 버전·유효기간(발효/만료) | TC-E2-18~26, 30, 33, 46 | 3종 생성·수정·금액·유효기간·4상태 배지·만료보존. "버전"=effective-dating+audit(별도 컬럼 없음) |
| FR-202 모든 임상·정산 입력은 마스터 선택, 자유 입력 제한(단일 진실) | TC-E2-39~42 | 검색 피커 free-text 차단·현재유효 필터·키보드/aria·재사용 계약. Epic 2엔 라이브 화면 없음(컴포넌트/Epic4·5 소비) |
| FR-203 마스터 비활성(soft delete)으로 과거기록 참조 무결성 유지 | TC-E2-03, 07, 08, 09, 13, 14, 15, 16, 26, 29, 30, 31, 38 | soft delete·행 보존·비활성 배정 차단·의존성 경고·CI unique·비활성 소속 마커 전수 |
| FR-214 직원 소속 진료과 배정(일부, 2.6) | TC-E2-36, 37, 38, 31 | 생성 시 배정·디렉터리 재배정/해제·비활성/미존재/403/404 가드 |
| (RBAC·감사 횡단) | TC-E2-27, 28, 29, 32, 38, 43, 44, 45 | 403 게이트·anon 차단·감사 자동기록·웹 하드닝(pending/부분강등/재시도) |
