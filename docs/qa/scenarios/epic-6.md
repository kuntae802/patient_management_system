# Epic 6: 예약·스케줄 — 테스트 시나리오

## 에픽 개요

Epic 6은 외래 예약·스케줄 전체 라이프사이클을 다룬다: 관리자 근무표/휴진 관리(6.1) → 동적 가용 슬롯 계산(6.2) → 원무 예약 캘린더·더블부킹 차단(6.3) → 원무 대리 변경·취소·노쇼·도착접수(6.4) → 환자 앱 본인 예약(6.5) → SMS 리마인더 시뮬·로그(6.6) → 노쇼 임계치 예약 제한(6.7) → 휴진 영향 예약 재배정·안내(6.8).

핵심 설계 사실(코드 확인):
- **단일 진실(Option A)**: 예약 생명주기 = `appointments.status` (booked → cancelled/no_show/completed). `patients.no_show_count` 같은 비정규화 카운터 없음 — 노쇼 횟수 = `status='no_show'` 행 수 집계(`patient_no_show_count(uuid)` 함수, 0036).
- **슬롯 단위 = 30분** (`SLOT_MINUTES=30`, services/scheduling.py). `scheduled_end`는 항상 서버가 `start+30분`으로 계산(클라 미신뢰).
- **KST 고정 +9 오프셋**(zoneinfo 미의존). 근무표 `start_time/end_time`은 KST 로컬 time, 휴진/예약 timestamptz는 UTC. 슬롯 계산은 KST 벽시계 → UTC 변환 후 휴진/예약(UTC)과 비교.
- **더블부킹 = DB EXCLUDE** (`appointments_no_double_booking`, where `status='booked'`, tstzrange `[)` 반열림, 0031) → asyncpg `ExclusionViolationError`(SQLSTATE 23P01) → 409 `double_booking`.
- **근무표 겹침 = DB EXCLUDE** (`doctor_schedules_no_overlap`, where `is_active`, 0030) → 409 `schedule_overlap`.
- **전이 트리거** = `enforce_appointment_transition` (BEFORE UPDATE만, 0033) booked→{cancelled,no_show,completed}만 허용 → PT409 → 409 `invalid_transition`. + 서비스/DB 계층 소스상태 precondition 선검사(`status != 'booked'` 차단, 재취소/재완료 방지).
- **노쇼 임계치 = 앱 상수** `NO_SHOW_THRESHOLD = 2` (api/app/core/db.py:3547). 차단 = 엄격 `count > 2`(즉 3회째부터). 신규 생성(원무/환자)에만 적용 — reschedule·check-in은 비대상.
- **리마인더 = 시뮬/로그**(실 SMS 미연동). `POST /reminders/run?as_of=` 명시 디스패치(cron 부재 이음매). 멱등 = `UNIQUE(appointment_id, reminder_kind)`. PII = `recipient_masked`만 저장(원시 phone 미유입).
- **환자 앱 인증 의존성**: `/scheduling/me/*` 게이트 = `get_current_patient`(직원 5역할 → 403). patient_id는 클라 미수용 — 서버가 `auth_uid = JWT sub`로 도출(IDOR 구조적 차단). 미연결 → 409 `no_self_patient`.

### 데모 시드 핵심 데이터(사전조건 — `supabase db reset` + `demo_seed.sql` 적용 후)

근무표·휴진(`seed.sql`, db reset 시 자동):
- 의사 EMP0002(doctor@pms.local, id `000000a2-...a2`, 진료과 IM): **월~금(weekday 1~5) 오전 09:00–12:30 · 오후 14:00–17:30** 근무, 진료실 R101.
- 휴진 1건: **2030-05-01 00:00 KST ~ 2030-05-02 00:00 KST**(종일), 사유 "학회 참석".
- 점심: 12:30~14:00은 근무 블록 없음 → 슬롯 미생성(캘린더 "점심시간 · 예약 불가" band).

예약 17건(`demo_seed.sql`, `00030000-...XX`, `v_today` 기준 상대일, 전부 의사 EMP0002·진료과 IM):
| 접미 | 환자 | 상대일(off) | 시각 | 상태 | sms | 비고 |
|---|---|---|---|---|---|---|
| 01 | 01 김영수 | -3 | 09:30 | completed | f | |
| 02 | 02 이미경 | -2 | 09:30 | completed | f | |
| 03 | 03 박정호 | -2 | 10:00 | completed | f | |
| 04 | 04 최수진 | -1 | 09:30 | completed | f | |
| 05 | **05 정대현** | -6 | 10:00 | **no_show** | f | |
| 06 | **05 정대현** | -4 | 10:00 | **no_show** | f | 재예약 후 재노쇼 |
| 07 | **11 송준호** | -5 | 11:00 | **no_show** | f | |
| 08 | 13 신동민 | -3 | 14:00 | cancelled | f | |
| 09 | 14 권나래 | -2 | 15:00 | cancelled | f | |
| 10 | 15 황태석 | 0(오늘) | 15:30 | booked | f | 오늘 오후 예약 |
| 11 | 16 문가은 | 0(오늘) | 16:00 | booked | f | |
| 12 | 17 류현우 | 0(오늘) | 16:30 | booked | f | 소아 진료 |
| 13 | 18 조아인 | +1(내일) | 09:30 | booked | **t** | 내일 예약(리마인더 대상) |
| 14 | 19 남기훈 | +2 | 10:00 | booked | **t** | 리마인더 대상 |
| 15 | 20 백서연 | +3 | 11:00 | booked | **t** | |
| 16 | 02 이미경 | +5 | 09:30 | booked | f | |
| 17 | 01 김영수 | +7 | 14:00 | booked | f | 정기 추적 |

노쇼 카운트 시드 결과(노쇼 임계치 테스트용):
- **정대현(환자 05) = 노쇼 2회**(정확히 임계치 = AC3 경계: 예약 정상 허용). self_pay, phone 010-2345-6705.
- **송준호(환자 11) = 노쇼 1회**.
- 나머지 환자 = 노쇼 0회.

리마인더 대상(sms_opt_in=true·booked·미래): 예약 13(D-1: as_of=오늘이면 +1), 14(D-2 → 어떤 종류 대상도 아님 — 주의!), 15(D-3: as_of=오늘이면 +3). **주의: 예약 14는 off=+2 → D-2라 D-3도 D-1도 아니므로 as_of=오늘 실행 시 발송 대상 아님.** 단 예약 13/15는 환자 18(조아인)/20(백서연) 모두 phone 보유 → simulated.

계정(전부 비밀번호 Staff1234):
- admin@pms.local (role=admin, master.manage·appointment.*·notification.* 전부): 근무표/휴진 관리(6.1·6.8 패널).
- reception@pms.local (role=reception, EMP0003): appointment.read/create/update(6.2~6.4·6.7) + notification.read/send(6.6) + encounter.register(check-in). **master.manage 미보유**(근무표 쓰기 403).
- doctor@pms.local (role=doctor, EMP0002): appointment.* 미보유 → 예약 엔드포인트 403 일부. (데모 의사 = 근무표 주체).
- nurse@pms.local (role=nurse): appointment.* / notification.* **전무** → 403 baseline.
- 환자 계정: **시드 없음**(클라우드 "환자 미시드"). 6.5 booking 앱은 Supabase 자가가입 + self-link 온보딩 선행 필요.

---

## 스토리 ↔ FR ↔ 구현 매핑

| 스토리 | 기능 | 커버 FR | 핵심 구현 |
|---|---|---|---|
| 6.1 | 근무표·휴진·예외 관리(관리자) | FR-220, FR-221 | 마이그 0030(doctor_schedules·doctor_time_offs·EXCLUDE no_overlap·RLS·감사) / `POST·PATCH /scheduling/doctor-schedules·doctor-time-offs[/active]` (master.manage) / web `/admin/schedule` schedule-manager.tsx |
| 6.2 | 동적 가용 슬롯 계산 | FR-012 | 마이그 0031(appointments·EXCLUDE no_double_booking) / `compute_available_slots` `_build_slots` `_slot_status`(past>time_off>booked>available) / `GET /scheduling/slots`·`/bookable-doctors`(appointment.read) / web slot-grid.tsx |
| 6.3 | 예약 캘린더·더블부킹 차단 | FR-013 | 마이그 0032(note·sms_opt_in·appointment.create) / `create_appointment`·`_assert_slot_bookable`·`get_day_calendar`·`_build_doctor_column` / `POST /scheduling/appointments`·`GET /scheduling/calendar` / web appointment-calendar.tsx·booking-peek.tsx |
| 6.4 | 원무 대리 생성·변경·취소·노쇼·도착접수 | FR-011 | 마이그 0033(전이 트리거·cancelled/no_show/completed_at·appointment.update) / `cancel/mark_no_show/reschedule/check_in_reservation` / `POST /scheduling/appointments/{id}/{cancel,no-show,reschedule,check-in}` / web booking-detail.tsx |
| 6.5 | 환자 앱 본인 예약 | FR-010 | 마이그 0034(created_by FK 제거·비정규화) / `create_self_appointment`·`insert_self_appointment`(auth_uid=sub 도출) / `GET·POST /scheduling/me/{bookable-doctors,slots,appointments}`(get_current_patient) / web `/booking` patient-booking.tsx |
| 6.6 | SMS 리마인더 시뮬·로그 | FR-014 | 마이그 0035(notification_logs·UNIQUE once·append-only by grant·notification.read/send) / `run_appointment_reminders`·`mask_phone`·`_build_reminder_body` / `POST /scheduling/reminders/run`·`GET /scheduling/reminders` / web `/reception/reminders` reminder-log.tsx |
| 6.7 | 노쇼 카운트·임계치 제한 | FR-015 | 마이그 0036(`patient_no_show_count` 함수) / `_assert_no_show_under_threshold`(count>2 → 409)·`get_patient_no_show_status` / `GET /scheduling/no-show-status` + 생성 가드(insert_appointment·insert_self_appointment) / web booking-peek 경고 칩 |
| 6.8 | 휴진 시 영향 예약 표시·재배정·안내 | FR-016 | 마이그 0037(reminder_kind CHECK 확장: +reschedule_notice/cancellation_notice) / `list_affected_appointments`·`record_change_notice` / `GET /scheduling/affected-appointments`·`POST /scheduling/appointments/{id}/notify-change` / web affected-appointments-panel.tsx |

---

## 테스트 시나리오

### TC-E6-01: 관리자 근무표 등록(정상)
- **검증**: FR-220 / Story 6.1 AC1·AC5
- **역할/계정**: admin@pms.local
- **사전조건**: 로그인, 좌측 내비 "근무 스케줄" 진입(`/admin/schedule`)
- **단계**:
  1. "근무표" 탭에서 "근무표 추가" 클릭
  2. 폼: 의사=의사(테스트), 진료과=내과(IM), 진료실="진료실 없음" 또는 R101, 요일=토(weekday=6), 시작 09:00, 종료 13:00
  3. "생성" 클릭
- **기대결과**: 201, "근무표가 생성되었습니다." 토스트, 표에 새 행(의사·내과·토·09:00–13:00·활성). audit_logs에 actor=admin INSERT 기록. (토요일은 시드 미존재 → 겹침 없음)
- **유형**: 정상

### TC-E6-02: 근무표 겹침 차단(같은 의사·요일 시간 겹침)
- **검증**: FR-220 / Story 6.1 AC1
- **역할/계정**: admin@pms.local
- **사전조건**: EMP0002는 월(1) 09:00–12:30 시드 보유
- **단계**:
  1. "근무표 추가": 의사=의사(테스트), 요일=월, 시작 11:00, 종료 13:00(시드 09:00–12:30과 겹침)
  2. "생성" 클릭
- **기대결과**: 409 `schedule_overlap`, start_time 필드에 인라인 에러 표시, 저장 안 됨. (DB EXCLUDE `doctor_schedules_no_overlap` 발화)
- **유형**: 예외

### TC-E6-03: 근무표 인접 시간(비겹침) 허용 — 경계
- **검증**: FR-220 / Story 6.1 AC1 (반열림 인접)
- **역할/계정**: admin@pms.local
- **사전조건**: EMP0002 월(1) 09:00–12:30·14:00–17:30 시드. 12:30~14:00 빈 구간
- **단계**: "근무표 추가": 의사=의사(테스트), 요일=월, 시작 12:30, 종료 14:00 → "생성"
- **기대결과**: 201 정상 생성(12:30 시작은 09:00–12:30 블록과 인접·비겹침, 14:00 종료는 14:00 블록과 인접). 점심 슬롯이 채워짐.
- **유형**: 경계

### TC-E6-04: 시작≥종료 시각 폼 검증
- **검증**: Story 6.1 AC5(폼 검증)
- **역할/계정**: admin@pms.local
- **단계**: "근무표 추가": 시작 14:00, 종료 14:00(또는 13:00) → "생성"
- **기대결과**: Zod/Pydantic 422 "종료 시각은 시작 시각보다 뒤여야 합니다." (DB CHECK `doctor_schedules_time_order` 최종선). 저장 안 됨.
- **유형**: 경계

### TC-E6-05: 비활성/미존재 의사·진료과·진료실에 근무표 배정 차단
- **검증**: Story 6.1 AC3
- **역할/계정**: admin@pms.local
- **사전조건**: 비활성 진료과 또는 임의 미존재 UUID 준비(또는 API 직접 호출)
- **단계**: `POST /v1/scheduling/doctor-schedules`에 미존재 doctor_id(또는 비활성/비-doctor 직원) 전송
- **기대결과**: 422 (`invalid_doctor`/`invalid_department`/`invalid_room` 또는 `invalid_reference`). `_assert_doctor_assignable`이 role=doctor·active 검증.
- **유형**: 예외

### TC-E6-06: 근무표 비활성(soft delete) 후 슬롯에서 제외
- **검증**: Story 6.1 AC3, FR-012 연계
- **역할/계정**: admin@pms.local + reception(슬롯 확인)
- **단계**:
  1. admin이 EMP0002 월(1) 오전 09:00–12:30 근무표 행의 "비활성" 클릭 → 확인 다이얼로그 → "비활성"
  2. reception이 `/reception/schedule`에서 IM·다음 월요일 선택(또는 슬롯 조회)
- **기대결과**: 행이 비활성 배지로 표시(물리 삭제 아님). 다음 월요일 오전 09:00~12:30 슬롯이 캘린더에 미생성(근무 블록 0). 오후 14:00–17:30은 그대로.
- **유형**: 정상

### TC-E6-07: 비활성 근무표 재활성 시 겹침이면 차단
- **검증**: Story 6.1 AC3(재활성 겹침)
- **역할/계정**: admin@pms.local
- **사전조건**: 한 의사·요일에 활성 블록 A가 있고, 같은 시간대에 겹치는 비활성 블록 B가 존재(예: TC-E6-06 비활성 후 동시간 신규 활성 생성)
- **단계**: 비활성 블록 B의 "활성" 클릭
- **기대결과**: 409 `schedule_overlap`(부분 EXCLUDE where(is_active)가 false→true 전이에서 발화), 재활성 안 됨.
- **유형**: 경계

### TC-E6-08: 휴진·예외 등록(정상)
- **검증**: FR-221 / Story 6.1 AC2
- **역할/계정**: admin@pms.local
- **단계**:
  1. "휴진·예외" 탭 → "휴진·예외 등록"
  2. 의사=의사(테스트), 시작 일시=(다음 수요일 09:00), 종료=(같은 날 12:30), 사유="연차"
  3. "등록"
- **기대결과**: 201, "휴진·예외가 등록되었습니다." 토스트, 표에 행 추가. 해당 수요일 오전 슬롯이 `time_off`로 차감(6.2 검증). 그 시간에 booked 예약 없으면 영향 패널 미표시(토스트만).
- **유형**: 정상

### TC-E6-09: 휴진 종일 등록 → 슬롯 전부 time_off
- **검증**: FR-012·FR-221 / Story 6.1 AC2, 6.2 AC1
- **역할/계정**: admin@pms.local + reception
- **단계**:
  1. admin: 휴진 등록 의사=EMP0002, 시작=(다음 화요일 00:00), 종료=(다음 수요일 00:00), 사유="학회"
  2. reception: 슬롯 조회 EMP0002·해당 화요일
- **기대결과**: 해당 화요일 09:00–12:30·14:00–17:30 모든 슬롯 status=`time_off`(휴진), 선택 불가. (기존 시드 휴진 2030-05-01도 동일 검증 가능)
- **유형**: 정상

### TC-E6-10: 근무표/휴진 쓰기 권한 게이트(403) — reception/nurse
- **검증**: Story 6.1 AC4(권한 게이트)
- **역할/계정**: reception@pms.local, nurse@pms.local(각각)
- **단계**: `POST /v1/scheduling/doctor-schedules` 또는 `/doctor-time-offs` 직접 호출(master.manage 미보유). web에서는 "근무 스케줄" 메뉴 자체가 admin·master.manage 게이트라 미노출.
- **기대결과**: 403 `forbidden`(required_permission=master.manage). 단 **읽기는 허용**(authenticated SELECT — 모든 직원이 근무표·휴진 조회 가능).
- **유형**: 권한·보안

### TC-E6-11: 근무표/휴진 읽기는 전 직원 허용(RLS)
- **검증**: Story 6.1 AC4(RLS authenticated SELECT)
- **역할/계정**: nurse@pms.local 또는 doctor@pms.local
- **단계**: web에서 근무표·휴진 데이터를 읽는 화면(예: reception 슬롯/캘린더는 직접조회 아님이지만, doctor_schedules는 web Supabase 직접조회). 또는 Supabase 클라이언트 직접 SELECT.
- **기대결과**: 비활성 행 포함 전체 조회 성공(전역 참조 데이터). anon은 접근 불가.
- **유형**: 권한·보안

---

### TC-E6-12: 동적 슬롯 산출 = 근무−휴진−booked (정상 그리드)
- **검증**: FR-012 / Story 6.2 AC1
- **역할/계정**: reception@pms.local
- **사전조건**: EMP0002 평일 근무. 오늘이 평일이고 미래 시각이 남았다고 가정(또는 다음 평일 선택)
- **단계**: `GET /v1/scheduling/slots?doctor_id=<EMP0002>&date=<다음 월요일>` (또는 web slot-availability/캘린더)
- **기대결과**: 09:00–12:30(7슬롯: 09:00,09:30,...,12:00) + 14:00–17:30(7슬롯) = 14개 슬롯. 12:30~14:00 슬롯 없음(점심). 각 슬롯 status=available(미래·미예약). slot_minutes=30. 정렬 오름차순.
- **유형**: 정상

### TC-E6-13: 슬롯 상태 우선순위 — past > time_off > booked > available
- **검증**: FR-012 / Story 6.2 AC1·AC2 (`_slot_status` 우선순위)
- **역할/계정**: reception@pms.local
- **사전조건**: 오늘 평일. 시드 예약 10(오늘 15:30 booked)·11(16:00)·12(16:30) 존재
- **단계**: `GET /scheduling/slots?doctor_id=<EMP0002>&date=<오늘>` (또는 캘린더)
- **기대결과**:
  - 현재 시각 이전 슬롯 = `past`(오전 + 지난 오후)
  - 15:30·16:00·16:30 슬롯 = `booked`(시드 예약)
  - 그 외 미래 근무 슬롯 = `available`
  - (휴진 겹침 슬롯이 있으면 booked보다 time_off 우선)
- **유형**: 정상·경계

### TC-E6-14: 비활성/미존재/비-의사 → 빈 슬롯(404 아님)
- **검증**: Story 6.2 AC3
- **역할/계정**: reception@pms.local
- **단계**: 
  - (a) `GET /scheduling/slots?doctor_id=<임의 미존재 UUID>&date=<평일>`
  - (b) 비-doctor 직원(예: reception 본인 uid) doctor_id로 조회
  - (c) 근무표 없는 요일(예: 일요일·시드 미존재) 조회
- **기대결과**: 200 + slots=[](빈 배열). 404 아님. `fetch_doctor_schedules_for_weekday`의 role=doctor·active 조인 필터로 비-의사/퇴사 의사 슬롯 0.
- **유형**: 경계

### TC-E6-15: 슬롯 조회 권한 게이트(403) — nurse
- **검증**: Story 6.2 AC4
- **역할/계정**: nurse@pms.local
- **단계**: `GET /v1/scheduling/slots?doctor_id=...&date=...` 또는 `/bookable-doctors`
- **기대결과**: 403 `forbidden`(appointment.read 미보유). reception·admin은 200.
- **유형**: 권한·보안

### TC-E6-16: 더블부킹 DB EXCLUDE 토대 검증(스키마 불변식)
- **검증**: Story 6.2 AC5 / FR-013 토대
- **역할/계정**: DB 직접(psql) 또는 시드
- **단계**: 같은 의사·겹치는 시각의 `status='booked'` 예약 2건 직접 INSERT
- **기대결과**: 두 번째 INSERT가 SQLSTATE 23P01(exclusion_violation)로 거부. cancelled/no_show 상태이거나 인접 비겹침 슬롯은 허용(부분 술어 where status='booked', `[)` 반열림).
- **유형**: 경계

### TC-E6-17: 날짜 파싱 실패 → 422
- **검증**: Story 6.2 (date 파라미터)
- **역할/계정**: reception@pms.local
- **단계**: `GET /v1/scheduling/slots?doctor_id=<EMP0002>&date=2026-13-40`
- **기대결과**: 422(FastAPI date 파싱 실패).
- **유형**: 예외

---

### TC-E6-18: 예약 캘린더 일 보기 렌더(상태별 슬롯)
- **검증**: FR-013 / Story 6.3 AC1
- **역할/계정**: reception@pms.local
- **사전조건**: 오늘 시드 예약 10/11/12(booked) 존재
- **단계**: `/reception/schedule` → 진료과=내과(IM), 날짜=오늘
- **기대결과**: 시간레일(세로 30분) × 의사 열. 슬롯이 가능(○)/확정(◐ 환자명)/완료(✓)/노쇼(●)/취소(✕ 취소선)/휴진(빗금)/지남(—)로 라벨+글리프+색 표시(음영 비의존). 15:30·16:00·16:30은 환자명+◐ 확정. 12:30~14:00은 "점심시간 · 예약 불가" band. 범례 표시.
- **유형**: 정상

### TC-E6-19: 빈 슬롯 클릭 → booking-peek 프리필
- **검증**: FR-013 / Story 6.3 AC2
- **역할/계정**: reception@pms.local
- **사전조건**: 오늘 미래 가능 슬롯 존재(예: 17:00)
- **단계**: 캘린더에서 가능(○) 슬롯 17:00 클릭 → booking-peek 슬라이드오버 확인
- **기대결과**: "예약 생성" 제목, 진료과·담당의(의사(테스트))·날짜/시간(프리필, "30분")이 read-only. 환자검색·메모·SMS 체크(기본 ON)·"예약 저장"/"취소" 노출.
- **유형**: 정상

### TC-E6-20: 원무 대리 예약 생성(정상)
- **검증**: FR-011·FR-013 / Story 6.3 AC2, 6.4 AC1
- **역할/계정**: reception@pms.local
- **단계**:
  1. 가능 슬롯 클릭 → booking-peek
  2. 환자검색 "이미경"(또는 차트번호·연락처) → 선택
  3. 메모 입력(선택), SMS 체크 유지
  4. "예약 저장"
- **기대결과**: 201, 예약 status='booked' 생성. 슬라이드오버 닫힘, 캘린더 새로고침 → 해당 슬롯 확정(◐ 이미경). created_by=reception. appointments에 행, 감사 기록.
- **유형**: 정상

### TC-E6-21: 더블부킹 인라인 차단(409)
- **검증**: FR-013 / Story 6.3 AC3
- **역할/계정**: reception@pms.local
- **사전조건**: 동일 의사·시각에 이미 booked(시드 예약 10 = 오늘 15:30)
- **단계**: API로 같은 의사·15:30(오늘) 예약 생성 시도(캘린더 UI는 booked 슬롯 비클릭이라 API/경쟁 시점 재현). 또는 두 탭에서 동시에 같은 가능 슬롯에 다른 환자 예약.
- **기대결과**: 409 `double_booking`. booking-peek에 "✕ 더블부킹 차단 — 같은 시간대에 이미 예약이 있습니다." 인라인 칩, 슬라이드오버 유지·저장 안 됨. (DB EXCLUDE 최종 불변식)
- **유형**: 예외

### TC-E6-22: 슬롯-윈도우 검증 — 근무외/휴진/비정렬 시각 거부(422)
- **검증**: FR-013 / Story 6.3·6.4 (`_assert_slot_bookable`)
- **역할/계정**: reception@pms.local
- **단계**: `POST /scheduling/appointments`에 (a) 점심 시간 12:45, (b) 근무외 18:00, (c) 30분 비정렬 09:15, (d) 휴진 시각(2030-05-01 등) scheduled_start 전송
- **기대결과**: 422 `slot_unavailable`("근무 외·휴진·지난 시각"). available/booked 슬롯이 아니면 거부.
- **유형**: 예외·경계

### TC-E6-23: 과거 시각 예약 거부(422)
- **검증**: Story 6.3·6.4 (`appointment_in_past`)
- **역할/계정**: reception@pms.local
- **단계**: `POST /scheduling/appointments`에 어제/과거 scheduled_start 전송
- **기대결과**: 422 `appointment_in_past` "과거 시각으로는 예약할 수 없습니다."(start<=now 빠른 차단).
- **유형**: 경계

### TC-E6-24: 비활성/미존재 환자 예약 거부
- **검증**: Story 6.3 (insert_appointment 환자 검증)
- **역할/계정**: reception@pms.local
- **단계**: (a) 미존재 patient_id → (b) 비활성 환자 patient_id로 예약 생성
- **기대결과**: (a) 404 환자 미존재, (b) 422 `patient_inactive` "비활성 환자는 예약할 수 없습니다."
- **유형**: 예외

### TC-E6-25: 예약 생성 권한 게이트(403) — nurse
- **검증**: Story 6.3 (appointment.create)
- **역할/계정**: nurse@pms.local
- **단계**: `POST /v1/scheduling/appointments`
- **기대결과**: 403 `forbidden`(appointment.create 미보유). reception·admin은 정상.
- **유형**: 권한·보안

---

### TC-E6-26: 예약 취소(booked→cancelled)
- **검증**: FR-011 / Story 6.4 AC1
- **역할/계정**: reception@pms.local
- **사전조건**: 미래 booked 예약(예: 시드 예약 16 = +5일 이미경, 또는 새로 생성)
- **단계**: 캘린더 확정 슬롯 클릭 → "예약 상세" → "취소" → 사유 입력(운영 사유) → "예약 취소 확정"
- **기대결과**: 200, status='cancelled'·cancelled_at·cancel_reason 설정. 캘린더 새로고침 → 슬롯 다시 가용(취소 슬롯은 점유 안 함, AC2). 감사 기록.
- **유형**: 정상

### TC-E6-27: 예약 노쇼(booked→no_show)
- **검증**: FR-011·FR-015 근거 / Story 6.4 AC1, 6.7 AC1
- **역할/계정**: reception@pms.local
- **사전조건**: 오늘 지난 시각 booked 예약(노쇼 처리는 시각 무관·소스 booked만 검사)
- **단계**: "예약 상세" → "노쇼" → 사유 입력 → "노쇼 처리 확정"
- **기대결과**: 200, status='no_show'·no_show_at 설정. 해당 환자 노쇼 카운트 +1. 슬롯 다시 가용(no_show 미점유). 
- **유형**: 정상

### TC-E6-28: 예약 변경(reschedule) — 같은 의사 새 시각
- **검증**: FR-011 / Story 6.4 AC1·AC2
- **역할/계정**: reception@pms.local
- **사전조건**: 미래 booked 예약
- **단계**: "예약 상세" → "변경" → 새 날짜 선택 → 가용 슬롯 버튼 클릭
- **기대결과**: 200, scheduled_start/end 갱신, status='booked' 유지(트리거 same-status 통과). 같은 의사면 department_id 불변. 새 슬롯에 확정, 옛 슬롯 가용 복귀. 더블부킹 시 409·슬롯불가 422.
- **유형**: 정상

### TC-E6-29: 종결 예약 재전이 차단(409 invalid_transition)
- **검증**: Story 6.4 AC1(잘못된 전이)
- **역할/계정**: reception@pms.local
- **사전조건**: 이미 cancelled/no_show/completed 예약(시드 예약 01 completed·05 no_show·08 cancelled)
- **단계**: cancelled 예약에 `POST .../cancel`(재취소), 또는 completed에 no-show/reschedule API 호출
- **기대결과**: 409 `invalid_transition`("해당 상태의 예약은 그 전이를 할 수 없습니다."). DB 계층 소스상태 precondition(status!='booked') 차단 + 트리거 PT409 백스톱.
- **유형**: 예외·경계

### TC-E6-30: 도착 접수(check-in) → reserved registered 내원 생성
- **검증**: FR-011 / Story 6.4 AC3
- **역할/계정**: reception@pms.local
- **사전조건**: 오늘 booked 예약(예: 시드 예약 10 오늘 15:30 황태석)
- **단계**: "예약 상세" → "도착 접수"
- **기대결과**: 201 EncounterResponse(visit_type='reserved'·status='registered'·reservation_id=예약id). 예약 status='completed'·completed_at 설정. 대기 현황판(4.3)에 등록 진입. "✓ 도착 접수 완료" 표시.
- **유형**: 정상

### TC-E6-31: 도착 접수 시 비활성 환자/진료과 차단(422)
- **검증**: Story 6.4 AC3(도착 시점 재검증)
- **역할/계정**: reception@pms.local
- **사전조건**: booked 예약의 환자를 예약 후 비활성 처리(또는 진료과 폐과)
- **단계**: 그 예약에 "도착 접수"
- **기대결과**: 422 `patient_inactive`/`department_inactive`(접수 거부·예약 취소 유도). 내원 미생성.
- **유형**: 예외

### TC-E6-32: 예약 변경/취소/노쇼/접수 권한 게이트(403) — nurse
- **검증**: Story 6.4 AC4
- **역할/계정**: nurse@pms.local
- **단계**: `POST /scheduling/appointments/{id}/{cancel,no-show,reschedule,check-in}`
- **기대결과**: 403(appointment.update 미보유). reception·admin 정상. (check-in은 추가로 encounter.register TOCTOU)
- **유형**: 권한·보안

### TC-E6-33: 미존재 예약 액션 → 404
- **검증**: Story 6.4
- **역할/계정**: reception@pms.local
- **단계**: 임의 미존재 appointment_id로 cancel/no-show/reschedule/check-in
- **기대결과**: 404 "예약을 찾을 수 없습니다."
- **유형**: 예외

### TC-E6-34: 취소·노쇼 슬롯 재예약 가능(AC2 회귀)
- **검증**: Story 6.4 AC2
- **역할/계정**: reception@pms.local
- **사전조건**: 한 슬롯을 예약 → 취소(TC-E6-26)
- **단계**: 같은 슬롯에 다른 환자 신규 예약 생성
- **기대결과**: 201 정상 생성(취소된 예약은 EXCLUDE 부분 술어 where status='booked'에서 빠져 슬롯 미차단).
- **유형**: 정상·경계

---

### TC-E6-35: 환자 본인 예약 — 가능 슬롯 흐름(정상)
- **검증**: FR-010 / Story 6.5 AC1·AC2
- **역할/계정**: 환자 계정(Supabase 자가가입 + self-link 완료된 환자; demo는 미시드 — 온보딩 선행)
- **사전조건**: 환자 로그인, 본인 진료기록 연결됨. `/booking` 진입
- **단계**: 진료과=내과 → 의사=의사(테스트) → 날짜 칩(미래 평일) → 시간 슬롯(available, 12시간 표기 "오후 2:30") 선택 → "예약 확정하기"(sticky CTA)
- **기대결과**: 201, status='booked' 생성, **patient_id=서버 도출(auth_uid=sub)**, created_by=환자 auth uid. "예약이 완료되었어요" + 12시간 표기 쉬운 말 확인. 휴진/마감/지난 슬롯은 비활성("휴진"/"마감"/"지남") 선택 불가.
- **유형**: 정상

### TC-E6-36: 환자 예약 — 직원 토큰 차단(403)
- **검증**: Story 6.5 AC3(보안 경계)
- **역할/계정**: reception@pms.local(또는 임의 active 직원)
- **단계**: `GET /v1/scheduling/me/slots` 또는 `POST /v1/scheduling/me/appointments` 직원 토큰 호출
- **기대결과**: 403 `forbidden`(get_current_patient 반전 — active 직원 5역할 차단).
- **유형**: 권한·보안

### TC-E6-37: 환자 예약 — 미연결 환자 차단(409 no_self_patient)
- **검증**: Story 6.5 AC3
- **역할/계정**: 자가가입했으나 self-link 미완 환자
- **단계**: `/booking` 진입(또는 `POST /scheduling/me/appointments`)
- **기대결과**: `GET /patients/self` 404/no_self_patient → 화면 "예약하려면 본인 진료기록을 먼저 연결해 주세요." + "본인 진료기록 연결" 링크(/onboarding). 직접 예약 시도 시 409 `no_self_patient`.
- **유형**: 권한·보안

### TC-E6-38: 환자 예약 — patient_id 미수용(IDOR 구조 차단)
- **검증**: Story 6.5 AC3
- **역할/계정**: 연결된 환자 A
- **단계**: `POST /scheduling/me/appointments` 바디에 타 환자 patient_id를 추가로 넣어 시도
- **기대결과**: 서버는 patient_id를 무시하고 auth_uid=sub로 본인 환자만 도출 → 타인 예약 구조적으로 불가(SelfAppointmentCreate 스키마에 patient_id 필드 없음).
- **유형**: 권한·보안

### TC-E6-39: 환자 예약 — 더블부킹 인라인 안내(409)
- **검증**: Story 6.5 AC2·AC4
- **역할/계정**: 연결된 환자
- **사전조건**: 선택하려는 슬롯이 직전에 마감됨(경쟁)
- **단계**: 이미 booked된 시각에 self 예약 시도
- **기대결과**: 409 `double_booking` → "방금 마감된 시간입니다. 다른 시간을 선택해 주세요." 슬롯 재조회.
- **유형**: 예외

### TC-E6-40: 환자 예약 후 슬롯·캘린더 반영
- **검증**: Story 6.5 AC4
- **역할/계정**: 환자 + reception
- **단계**: 환자가 슬롯 예약 → reception이 같은 의사·날짜 캘린더/슬롯 조회
- **기대결과**: 해당 슬롯 마감(booked → 캘린더 confirmed). 환자 예약과 원무 대리 예약이 동일 appointments·동일 EXCLUDE 공유. 슬롯 응답에 환자 PII 누설 없음(가용성만).
- **유형**: 정상

---

### TC-E6-41: 리마인더 디스패치 — D-3·D-1 시뮬 발송
- **검증**: FR-014 / Story 6.6 AC1·AC5
- **역할/계정**: reception@pms.local
- **사전조건**: 시드 예약 13(+1일·sms_opt_in·환자 phone 보유)·15(+3일·sms_opt_in·phone 보유). `/reception/reminders` 진입
- **단계**: "기준일" 비우거나 오늘 입력 → "리마인더 실행"
- **기대결과**: 200. 요약 "발송 완료 — 신규 N건 (발송 N · 스킵 0) · 3일 전 1 · 1일 전 1". notification_logs에 예약 13(d_minus_1)·15(d_minus_3) 각 1행, status='simulated'. 로그표에 종류(3일 전/1일 전)·예약 시각·수신처(010-****-XXXX 마스킹)·상태(발송). **주의: 예약 14(+2일)는 D-2라 미대상**.
- **유형**: 정상

### TC-E6-42: 리마인더 멱등 재실행 — 중복 0
- **검증**: Story 6.6 AC2
- **역할/계정**: reception@pms.local
- **단계**: 같은 as_of로 "리마인더 실행" 2회 연속
- **기대결과**: 2회째 created=0·duplicate=N(요약에 duplicate 표시). 새 행 미생성(UNIQUE(appointment_id, reminder_kind) ON CONFLICT DO NOTHING).
- **유형**: 경계

### TC-E6-43: opt-in 게이트 — sms_opt_in=false 미대상
- **검증**: Story 6.6 AC3
- **역할/계정**: reception@pms.local
- **사전조건**: 미래 booked·sms_opt_in=false 예약(예: 새로 SMS 체크 해제로 생성, 적절한 D-3/D-1 날짜)
- **단계**: 해당 날짜를 D-3/D-1로 만드는 as_of로 실행
- **기대결과**: 그 예약은 로그 0건(대상 아님). opt-in=true만 로그에 담김.
- **유형**: 경계

### TC-E6-44: 미수신 'skipped' 정직 기록(연락처 없음)
- **검증**: Story 6.6 AC3
- **역할/계정**: reception@pms.local
- **사전조건**: sms_opt_in=true·환자 phone NULL인 예약을 D-3/D-1 날짜에 생성(phone 없는 환자로)
- **단계**: 해당 as_of로 실행
- **기대결과**: status='skipped'·skip_reason='no_recipient'·recipient_masked=null. 로그표 수신처 "(연락처 없음)"·상태 "스킵". 요약 skipped 카운트 +1.
- **유형**: 경계

### TC-E6-45: 비-booked 예약 미대상(cancelled/no_show/completed)
- **검증**: Story 6.6 AC3
- **역할/계정**: reception@pms.local
- **단계**: cancelled/no_show 예약이 D-3/D-1 날짜에 있는 as_of로 실행
- **기대결과**: 로그 0건(fetch_reminder_due_appointments where status='booked' 필터).
- **유형**: 경계

### TC-E6-46: PII 경계 — 마스킹 수신처·비-식별 body
- **검증**: Story 6.6 AC4
- **역할/계정**: reception@pms.local
- **단계**: 리마인더 실행 후 `GET /scheduling/reminders` 응답·로그표 확인. body 내용 확인(API 응답엔 body 포함).
- **기대결과**: recipient_masked만(010-****-5678 형식). body에 환자명·주민번호·원시 phone 없음(날짜·시각·진료과·"한울병원"만). 응답에 원시 phone·patient_name 필드 부재.
- **유형**: 권한·보안

### TC-E6-47: 리마인더 권한 게이트(403) — nurse
- **검증**: Story 6.6 AC5
- **역할/계정**: nurse@pms.local
- **단계**: `POST /scheduling/reminders/run`(send) 및 `GET /scheduling/reminders`(read)
- **기대결과**: 둘 다 403(notification.send/read 미보유). reception 보유 → 정상. web에서 "리마인더 실행" 버튼은 PermissionGate(notification.send)로 잠김 표시.
- **유형**: 권한·보안

### TC-E6-48: as_of 미래/과거 지정 — 데모 시간 목킹
- **검증**: Story 6.6 AC1(as_of)
- **역할/계정**: reception@pms.local
- **단계**: as_of=(시드 예약 16의 시각−3일)로 실행(예약 16 = +5일·sms_opt_in=false라 미대상이지만, 임의 future booked·opt-in 예약 기준일 조정)
- **기대결과**: as_of+3·as_of+1 KST 일자 예약만 대상. 시간 목킹 없이 데모 가능.
- **유형**: 정상·경계

---

### TC-E6-49: 노쇼 카운트 정확 집계(읽기)
- **검증**: FR-015 / Story 6.7 AC1
- **역할/계정**: reception@pms.local
- **사전조건**: 시드 — 정대현(05)=노쇼 2, 송준호(11)=노쇼 1, 나머지=0
- **단계**: `GET /scheduling/no-show-status?patient_id=<정대현>` / `<송준호>` / `<타 환자>`
- **기대결과**: 정대현 {no_show_count:2, threshold:2, blocked:false}, 송준호 {1,2,false}, 타 환자 {0,2,false}. (count=2는 임계 도달이나 초과 아님 → blocked=false)
- **유형**: 정상

### TC-E6-50: 임계치 초과 시 신규 예약 제한 — 경계(정확히 2→3)
- **검증**: FR-015 / Story 6.7 AC2·AC3
- **역할/계정**: reception@pms.local
- **사전조건**: 정대현(05) 노쇼 2회
- **단계**:
  1. 정대현으로 신규 예약 생성 시도 → **201 정상**(count=2 = 임계치, 초과 아님, AC3 경계)
  2. 정대현의 추가 booked 예약 하나를 노쇼 처리(no_show 3회로) → 다시 신규 예약 생성 시도
- **기대결과**: 1단계=201 정상 생성. 2단계=409 `no_show_threshold_exceeded`(detail: no_show_count=3, threshold=2). 엄격 `count>2` 차단.
- **유형**: 경계

### TC-E6-51: 노쇼 임계 초과 — booking-peek 인라인 경고·버튼 차단
- **검증**: Story 6.7 AC4(직원 UX)
- **역할/계정**: reception@pms.local
- **사전조건**: 노쇼 3회 환자(TC-E6-50 2단계 결과 환자)
- **단계**: booking-peek에서 그 환자 선택(가능 슬롯 클릭 후)
- **기대결과**: `GET /no-show-status` blocked=true → 경고 칩 "● 노쇼 N회(임계 2회 초과) — 신규 예약이 제한됩니다."(status-received 노쇼 색). "예약 저장" 버튼 disabled.
- **유형**: 권한·보안·UX

### TC-E6-52: 노쇼 임계 초과 — 환자 앱 쉬운 말 안내
- **검증**: Story 6.7 AC2·AC4 / FR-010·FR-015 교차
- **역할/계정**: 노쇼 3회 환자(연결됨)
- **단계**: `/booking`에서 슬롯 선택 → "예약 확정하기"
- **기대결과**: 409 `no_show_threshold_exceeded` → "미방문(노쇼)이 누적되어 앱에서 바로 예약하기 어려워요. 병원으로 문의해 주세요."
- **유형**: 권한·보안·UX

### TC-E6-53: 임계 초과여도 reschedule·check-in은 차단 안 됨(AC3 회귀)
- **검증**: Story 6.7 AC3
- **역할/계정**: reception@pms.local
- **사전조건**: 노쇼 3회 환자의 기존 booked 예약 1건
- **단계**: 그 예약을 reschedule, 또는 check-in
- **기대결과**: 정상 처리(노쇼 가드는 신규 생성 insert_appointment/insert_self_appointment에만 — reschedule/check_in 비대상).
- **유형**: 경계

### TC-E6-54: no-show-status 권한 게이트(403) — nurse
- **검증**: Story 6.7 (appointment.read)
- **역할/계정**: nurse@pms.local
- **단계**: `GET /scheduling/no-show-status?patient_id=...`
- **기대결과**: 403(appointment.read 미보유).
- **유형**: 권한·보안

---

### TC-E6-55: 휴진 영향 예약 조회(겹침만)
- **검증**: FR-016 / Story 6.8 AC1
- **역할/계정**: reception@pms.local 또는 admin
- **사전조건**: EMP0002에 미래 booked 예약(예: 시드 16 +5일, 17 +7일). 그 기간을 덮는 휴진 등록 또는 affected 조회
- **단계**: `GET /scheduling/affected-appointments?doctor_id=<EMP0002>&start_at=<+5일 00:00>&end_at=<+8일 00:00>`
- **기대결과**: 예약 16·17 반환(status='booked'·환자명·시각). cancelled/no_show/completed 제외. 겹침 0이면 빈 배열(404 아님). 환자명만(주민번호/연락처 미포함).
- **유형**: 정상·경계

### TC-E6-56: 휴진 등록 후 영향 예약 패널 표면화(0건/1건+)
- **검증**: FR-016 / Story 6.8 AC2
- **역할/계정**: admin@pms.local
- **단계**:
  1. (1건+) 미래 booked 예약 시각을 덮는 휴진 등록 → 저장
  2. (0건) booked 예약 없는 기간 휴진 등록 → 저장
- **기대결과**: 1단계=저장 후 "휴진 영향 예약 · 재배정" 패널(슬라이드오버) 자동 표시(환자명·시각·[재배정]·[취소·안내]). 0단계=패널 미표시, 토스트만. 비활성된 휴진 행에서도 "영향 예약" 버튼으로 패널 재열기 가능.
- **유형**: 정상·경계

### TC-E6-57: 재배정 — 다른 슬롯 이동 + reschedule_notice 안내 기록
- **검증**: FR-016 / Story 6.8 AC3
- **역할/계정**: admin@pms.local
- **사전조건**: 영향 패널에 booked 예약 1건
- **단계**: 행의 "재배정" → 의사 피커(같은 진료과)·날짜·가용 슬롯 선택 → 제출
- **기대결과**: 예약 새 슬롯 이동(booked 유지). 다른 의사 재배정 시 department_id 새 의사 진료과로 동기화(같은 의사면 불변). 성공 후 `recordChangeNotice(reschedule_notice)` 1건 기록(새 시각 반영). 행 제거. 더블부킹 409·슬롯불가 422 보존.
- **유형**: 정상

### TC-E6-58: 취소·안내 — cancel + cancellation_notice 기록
- **검증**: FR-016 / Story 6.8 AC4
- **역할/계정**: admin@pms.local
- **사전조건**: 영향 패널에 booked 예약(재배정 불가 가정)
- **단계**: 행의 "취소·안내" → 확인
- **기대결과**: 예약 cancelled(사유 "의사 휴진"). notification_logs에 cancellation_notice 1건(마스킹 수신처·비-식별 body·연락처 없으면 skipped). 멱등(재실행 새 행 0). 행 제거.
- **유형**: 정상

### TC-E6-59: notify-change 권한 게이트(403)·미존재 예약(404)·멱등(null)
- **검증**: Story 6.8 AC4
- **역할/계정**: nurse@pms.local(403), admin(멱등/404)
- **단계**: 
  - nurse: `POST /scheduling/appointments/{id}/notify-change`
  - admin: 같은 예약·같은 kind로 notify-change 2회 / 미존재 예약 id로 1회
- **기대결과**: nurse 403(notification.send 미보유). admin 2회째 null(멱등 충돌·새 행 0). 미존재 → 404.
- **유형**: 권한·보안·경계

### TC-E6-60: affected-appointments 권한 게이트(403)·날짜 파싱(422)
- **검증**: Story 6.8 AC1
- **역할/계정**: nurse@pms.local / reception
- **단계**: nurse가 `GET /scheduling/affected-appointments` 호출 / reception이 start_at에 잘못된 datetime 전송
- **기대결과**: nurse 403(appointment.read). 날짜 파싱 실패 422.
- **유형**: 권한·보안·예외

---

### TC-E6-61: 환자 본인 예약 RLS — 타 환자 예약 미조회
- **검증**: Story 6.1/6.5 RLS (appointments_select_self)
- **역할/계정**: 연결된 환자 A
- **단계**: 환자 A 토큰으로 appointments를 Supabase 직접 SELECT(또는 마이 메뉴 — Epic 8이지만 RLS 자체는 검증 가능)
- **기대결과**: 본인 예약(patient_id→auth_uid 매칭)만 반환. 타 환자 예약 미노출. (직원은 appointments_select_staff = appointment.read 보유 시 전체)
- **유형**: 권한·보안

### TC-E6-62: 전체 예약 라이프사이클 통합(생성→리마인더→도착→완료)
- **검증**: FR-010~016 통합
- **역할/계정**: reception + 환자
- **단계**:
  1. 환자 앱: 미래 슬롯 예약(sms_opt_in 체크)
  2. reception: 캘린더에서 확정 확인
  3. reception: as_of 조정해 리마인더 실행 → D-1/D-3 로그 확인
  4. 예약일 당일 reception: 도착 접수 → registered 내원 생성·예약 completed
  5. 대기 현황판에서 내원 확인
- **기대결과**: 전 단계 일관 동작, 상태 전이·감사·슬롯 가용성 정합.
- **유형**: 정상(통합)

---

## FR 커버리지 체크

| 담당 FR | 커버 시나리오 | 비고 |
|---|---|---|
| FR-010 환자 앱 진료과·의사·슬롯 조회·예약 | TC-E6-35,38,39,40,52,62 | 게이트=get_current_patient·patient_id 서버 도출 |
| FR-011 원무 대리 예약 생성·변경·취소 | TC-E6-20,26,27,28,29,30,32,33 | appointment.create/update |
| FR-012 근무표·휴진 반영 가능슬롯만 노출 | TC-E6-06,09,12,13,14,15,17 | compute_available_slots = 근무−휴진−booked |
| FR-013 동일슬롯 더블부킹 차단(오버부킹 정책 허용) | TC-E6-16,21,39 | DB EXCLUDE 23P01→409 (오버부킹 정책=별도 미구현·차단이 기본) |
| FR-014 예약 3일전·1일전 SMS 리마인더 발송·이력 | TC-E6-41,42,43,44,45,46,47,48 | 시뮬/로그·멱등 UNIQUE·D-2는 미대상 |
| FR-015 노쇼 횟수 기록·임계치(2회) 초과 제한 | TC-E6-27,49,50,51,52,53,54 | 엄격 count>2·신규 생성만 |
| FR-016 의사 휴진 시 영향예약 표시·재배정·안내 | TC-E6-55,56,57,58,59,60 | affected-appointments + notify-change(reschedule/cancellation_notice) |
| FR-220 의사별 근무표 등록·관리 | TC-E6-01,02,03,04,05,06,07,10,11 | EXCLUDE no_overlap·soft delete·master.manage |
| FR-221 휴진·예외 등록 | TC-E6-08,09,10,11 | doctor_time_offs·슬롯/재배정 근거 |

추가 횡단(권한·RLS·경계): TC-E6-10,11,15,25,32,36,37,38,47,54,59,60,61 (403/RLS), TC-E6-03,07,13,14,16,17,22,23,29,34,42,43,44,45,48,50,53,55,56 (경계).

---

## 주의·특이점(테스트 전 반드시 인지)

1. **슬롯 계산 알고리즘(6.2)**: 근무 블록(KST time)을 30분 단위로 전개, `cursor+step <= block_end` 조건이라 블록 끝 자투리(<30분)는 슬롯 미생성. 상태 우선순위 **past > time_off > booked > available**(`_slot_status`). KST 벽시계→UTC 변환 후 비교. 점심(12:30~14:00)은 근무 블록 자체가 없어 슬롯 없음.

2. **노쇼 임계치 정확한 경계**: 차단 = **엄격 `count > 2`**(NO_SHOW_THRESHOLD=2). 노쇼 2회=blocked false(예약 허용), 3회째부터 차단. 시드 정대현=정확히 2회(경계 회귀 가드 데이터). 가드는 신규 생성(insert_appointment·insert_self_appointment)에만 — reschedule/check-in 비대상.

3. **리마인더 시뮬 방식**: 실 SMS 없음, notification_logs INSERT로만. as_of+3일=D-3, as_of+1일=D-1. **D-2(시드 예약 14·off=+2)는 as_of=오늘 실행 시 어떤 종류도 아니라 미발송** — 흔한 오해 주의. 멱등 = `UNIQUE(appointment_id, reminder_kind)`. cron 없음 → `/reminders/run` 명시 디스패치.

4. **더블부킹 차단 메커니즘**: DB EXCLUDE 제약(`appointments_no_double_booking`, where status='booked', tstzrange `[)`)이 최종 불변식. 서비스 `_assert_slot_bookable`은 booked 슬롯을 일부러 막지 않음(available/booked 둘 다 통과시켜 EXCLUDE가 409 처리하도록 — 422가 가로채면 더블부킹 경로 소실). FR의 "오버부킹 정책 허용"은 현재 구현엔 별도 오버부킹 토글 없음(차단이 기본·하드 불변식) — 명세-구현 갭으로 기록.

5. **환자 앱 예약 인증 의존성**: `/scheduling/me/*` = `get_current_patient`(권한 의존성 아님). active 직원 5역할 → 403. 환자는 RBAC 권한 0 — 권위는 "auth_uid=sub로 본인만". **demo 환경에 환자 계정 미시드** → 6.5 E2E는 Supabase 자가가입 + self-link 온보딩 선행 필수. patient_id는 SelfAppointmentCreate 스키마에 없어 IDOR 구조 차단.

6. **전이 트리거 BEFORE UPDATE only**: INSERT 가드 없음(시드/테스트가 cancelled 직접 INSERT 가능). same-status UPDATE(reschedule 시각 변경)는 통과. 종결 상태 재전이는 DB 계층 precondition(status!='booked')이 먼저 409, 트리거 PT409가 백스톱.

7. **reschedule department_id 동기화**: 다른 의사로 재배정 시 새 의사 home 진료과로 동기화(부서-스코프 캘린더 고아 방지). 같은 의사면 불변(다중 진료과 의사 회귀 방지). 새 의사 home 진료과 NULL이면 기존 유지.

8. **노쇼 카운트 = encounters.no_show 미집계**: 예약(reservation) 미방문만 카운트(walk-in 내원 no_show는 슬롯 미점유라 제외).
