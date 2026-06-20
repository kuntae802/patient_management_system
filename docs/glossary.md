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
| `role` | 역할 | 6역할 코드: `reception`·`doctor`·`nurse`·`radiologist`·`admin`·`patient` |
| `permission` | 권한 | `<resource>.<action>` 코드(예: `patient.read`) |
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

## enum · CHECK — 신원·RBAC·감사 (Story 1.3, `0002`~`0004`)

**`users.employment_status` (재직상태, CHECK)**

| 값(영문) | 한글 표시명 |
|---|---|
| `active` | 재직 |
| `on_leave` | 휴직 |
| `terminated` | 퇴사 |

**`users.license_type` (면허종류, CHECK, nullable)**

| 값(영문) | 한글 표시명 |
|---|---|
| `doctor` | 의사 |
| `radiologist` | 방사선사 |

**`audit_logs.action` (감사 동작, CHECK)**

| 값(영문) | 한글 표시명 | 비고 |
|---|---|---|
| `create` | 생성 | 트리거 자동(INSERT) |
| `read` | 조회 | 앱이 기록(예: PII reveal — 1.9) |
| `update` | 수정 | 트리거 자동(UPDATE) |
| `delete` | 삭제 | 트리거 자동(DELETE) |
| `login` | 로그인 | 앱이 기록 |

## RLS 헬퍼 · 세션 변수 (Story 1.3)

| 식별자 | 종류 | 비고 |
|---|---|---|
| `auth_user_role()` | 함수(SECURITY DEFINER) | 현재 로그인 직원의 역할 코드(직원 아니면 NULL = 환자/비직원 경계) |
| `has_permission(code)` | 함수(SECURITY DEFINER) | 현재 직원 역할의 권한 보유 여부(boolean). RBAC 데이터 권위 |
| `audit_trigger_fn()` | 트리거 함수(SECURITY DEFINER) | 제네릭 감사 — 전/후 jsonb 스냅샷 + actor 캡처 |
| `app.actor_id` | 세션 GUC(`set local`) | FastAPI(service_role)가 트랜잭션 행위자를 주입(감사 actor 캡처 계약 — Story 1.5). 미설정 시 `auth.uid()` 폴백 |

> **권한 카탈로그(`permissions`)** 는 `0002`가 초기 버전을 시드하고, 리소스가 온라인될 때 각 에픽 마이그레이션이 확장한다. 역할별 grant(`role_permissions`) 토글 관리 UI는 **Story 1.7**. `0002`는 기본 grant로 `admin`=전체만 시드.

## web RBAC UI 게이트 (Story 1.6)

| 식별자 | 종류 | 비고 |
|---|---|---|
| `fetchUserPermissions(supabase, userId)` | 함수(web·서버) | 현재 직원의 권한 코드 목록을 Supabase 직접 조회(`0003`이 깔아둔 `authenticated` SELECT 정책 사용). RBAC UI 노출 게이트의 데이터 소스 |
| `PermissionsProvider` | 컴포넌트(web·클라) | 서버에서 fetch 한 `role`·`permissions`를 React Context 로 셸에 제공(TanStack Query 미사용) |
| `usePermissions()` | 훅(web·클라) | `{ role, has(code) }` — 사이드바 노출 게이트·권한 밖 액션 게이트가 소비 |
| `PermissionGate` / `LockedAction` | 컴포넌트(web·클라) | 권한 밖 액션 잠금 표현(`aria-disabled` + 잠금 글리프 + 한국어 사유). UX-DR8·18·20 |
| `requireStaff()` / `requirePermission(code)` | 함수(web·서버) | route group 레이아웃 라우트 가드. UI 게이트와 독립(최종 권위=FastAPI·RLS) |
| `filterNav(items, role, has)` | 함수(web) | 역할(IA 가시성) AND 권한(`requiredPermission`)으로 메뉴 항목 필터 |

> ⚠️ **UI 게이트는 보안 경계가 아니다** — 쓰기 권위=FastAPI `require_permission`(403), 행 권위=RLS. UI 는 학습·속도 레이어(UX-DR4). DB·API 식별자는 영문 snake_case, web 코드 식별자는 camelCase/PascalCase(파일=kebab-case).

## RBAC 권한 매트릭스 · web→API 호출 (Story 1.7)

| 식별자 | 종류 | 비고 |
|---|---|---|
| `set_role_permission(sub, role_code, permission_code, *, granted)` | 함수(api) | 역할↔권한 grant(INSERT)/revoke(DELETE). **권한 재평가 + 쓰기를 동일 트랜잭션**(TOCTOU 차단). admin 대상=409 `role_locked`, patient=422 `invalid_target`. 0004 트리거가 자동 감사(actor=`app.actor_id`) |
| `PUT /v1/admin/rbac/grants` | 엔드포인트(api) | `GrantUpdate{role_code,permission_code,granted}` → `GrantResult{...,changed}`. `require_permission('rbac.manage')` 게이트. web→FastAPI 최초 인증 쓰기 표면 |
| `apiFetch(path, init)` / `ApiError` | 함수·클래스(web·클라) | 인증 FastAPI 호출 — 브라우저 세션 `access_token`을 Bearer 첨부, 봉투 `{error:{code,message,detail}}` 파싱→`ApiError(code,message,status,detail)`. `path`=`/v1/...`(절대 베이스 `NEXT_PUBLIC_API_BASE_URL`, basePath 무관) |
| `fetchPermissionMatrix(supabase)` | 함수(web) | 매트릭스 데이터(roles[patient 제외·순서]·permissions[전수·resource 정렬]·grant 쌍)를 Supabase 직접 조회(authenticated SELECT, 0003) |
| `PermissionMatrix` | 컴포넌트(web·클라) | 역할×권한 매트릭스 — 즉시 적용·낙관적 갱신+롤백·민감 권한 확인 다이얼로그·2D 화살표 roving 키보드(`<table>`+`<th scope>`) |
| `ConfirmDialog` | 컴포넌트(web·클라) | 민감 권한 토글 확인(base-ui AlertDialog: 포커스 트랩·복원·Esc) |
| `SENSITIVE_PERMISSIONS` / `RESOURCE_LABELS` / `MATRIX_ROLE_ORDER` | 상수(web) | 민감 권한 코드 Set(현 3종: `patient.reveal_rrn`·`rbac.manage`·`audit.read`) · resource→한글 도메인 라벨(그룹 헤더) · 열 순서(admin 최후미 고정) |
| `NEXT_PUBLIC_API_BASE_URL` | env(web 공개) | FastAPI 베이스 URL(`/v1` 미포함). dev=`http://localhost:8000` · prod=`…/patient_management_system/api`. CORS 화이트리스트(`config.cors_origins`)에 web origin 필요 |

> **`requirePermission(code, fallback)` 정책 확정(Story 1.7, deferred-work 1.6 해소):** `(staff)` 하위 보호 라우트(예: `/admin/permissions`)는 부모 `(staff)/layout`이 이미 직원을 보장하므로 staff 재확인 불요. 권한 미보유 직원은 `fallback=STAFF_HOME(/home)`으로 강등. **매트릭스 읽기 = Supabase 직접 조회, 쓰기 = FastAPI(service_role)** — 0002가 authenticated 에 SELECT 만 grant하므로 토글은 FastAPI 경유가 유일 경로.
