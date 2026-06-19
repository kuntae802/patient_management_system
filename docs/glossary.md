# 용어집 (Glossary) — 영문 식별자 ↔ 한글

**단일 진실(single source of truth).** DB·API·코드 식별자는 **영문 snake_case**, 한국어는 UI 라벨·주석·enum 표시명·문서에만. **신규 식별자는 여기 등재 후 사용**한다. (출처: architecture.md §식별자 언어, project-context.md)

## 명명 규칙

- 테이블 = 복수 snake_case(`patients`, `encounters`), 컬럼 snake_case.
- PK `id`(UUID), FK `<참조단수>_id`(`patient_id`). 사람용 번호는 별도(`chart_no`, `encounter_no`).
- 타임스탬프 `created_at`/`updated_at`(timestamptz, UTC). soft delete `is_active`.
- enum 타입 `<entity>_status`, RPC = snake_case 동사(`register_encounter`), 트리거 `trg_<table>_<action>`, 헬퍼 `has_permission()`.
- JSON 필드 = 전 경로 snake_case(두 읽기 경로 일관).

## 도메인 엔티티

| 영문 식별자 | 한글 | 비고 |
|---|---|---|
| `patient` | 환자 | `auth_uid` nullable(앱 미사용 환자) |
| `guardian` | 보호자 | 성명·연락처·관계 |
| `user` | 직원(사용자) | `id`=auth uid, 분리 프로필 |
| `role` | 역할 | 6역할: 원무·의사·간호사·방사선사·관리자·환자 |
| `permission` | 권한 | `리소스.동작` 코드 |
| `role_permission` | 역할_권한 | 역할↔권한 N:M |
| `audit_log` | 감사로그 | append-only |
| `department` | 진료과 | 마스터 |
| `room` | 진료실 | 마스터 |
| `drug` | 약품 | 마스터(버전·유효기간) |
| `diagnosis` | 진단 | KCD 코드 마스터 |
| `fee_schedule` | 수가 | EDI 행위 마스터(버전·유효기간) |
| `fee_item` | 수가항목 | 수납상세에 적재되는 항목 |
| `fee_mapping` | 수가매핑 | 임상 행위 → 수가코드 규칙 |
| `encounter` | 내원 | 파이프라인 허브(예약→접수→진행중→완료) |
| `medical_record` | 진료기록 | SOAP, 한 내원 1:N |
| `encounter_diagnosis` | 내원진단 | 주/부상병 구분 |
| `prescription` | 처방전 | 헤더 |
| `prescription_detail` | 처방상세 | 약품·용량·횟수·일수·용법 |
| `examination` | 검사 | 진단검사·영상검사 오더 |
| `equipment` | 검사장비 | 촬영 배정·가용성 |
| `treatment_order` | 처치오더 | 간호 워크리스트 |
| `order` | 오더 | 처방·검사·영상·처치 총칭 |
| `nursing_record` | 간호기록 | 오더 연결 선택 |
| `vital_signs` | 활력징후 | 혈압·맥박·체온·호흡·SpO2 |
| `appointment` | 예약 | 슬롯 기반 |
| `doctor_schedule` | 근무표 | 요일·시간대·진료실 |
| `doctor_time_off` | 휴진/예외 | 휴가·학회 |
| `payment` | 수납 | 헤더 |
| `payment_detail` | 수납상세 | 라인 항목 |
| `notification_log` | 알림로그 | SMS 시뮬 발송이력 |

## 식별 번호 · 민감정보

| 영문 식별자 | 한글 | 비고 |
|---|---|---|
| `chart_no` | 차트번호 | 사람용, 라우트 식별자(PII 아님) |
| `encounter_no` | 내원번호 | 사람용 |
| `resident_no` | 주민등록번호 | pgcrypto 암호화 + HMAC blind index + 마스킹 |

## enum — 내원 상태 (`encounter_status`)

| 값(영문) | 한글 표시명 |
|---|---|
| `scheduled` | 예약 |
| `registered` | 접수 |
| `in_progress` | 진행중 |
| `completed` | 완료 |
| `cancelled` | 취소 |
| `no_show` | 노쇼 |

## enum — 오더 생명주기 (유형별)

- 처방: `issued`(발행) → `dispensed`(발급, 원외 약국)
- 검사·영상: `ordered`(지시) → `performed`(수행) → `completed`(판독/완료)
- 처치: `ordered`(지시) → `performed`(수행) → `completed`(완료)

> 오더 상태 어휘 통일·전이표 full matrix는 해당 마이그레이션(`0009`) 작성 시 확정(다운스트림).
