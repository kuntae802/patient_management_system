# 용어집 (Glossary) — 영문 식별자 ↔ 한글

**단일 진실(single source of truth).** DB·API·코드 식별자는 **영문 snake_case**, 한국어는 UI 라벨·주석·enum 표시명·문서에만. **신규 식별자는 여기 등재 후 사용**한다. (출처: architecture.md §식별자 언어, project-context.md)

## 명명 규칙

- 테이블 = 복수 snake_case(`patients`, `encounters`), 컬럼 snake_case.
- PK `id`(UUID), FK `<참조단수>_id`(`patient_id`). 사람용 번호는 별도(`chart_no`, `encounter_no`).
- 타임스탬프 `created_at`/`updated_at`(timestamptz, UTC). soft delete `is_active`.
- 유효기간(코드 마스터) `effective_from`(발효일)·`effective_to`(만료일, null=무기한) = `date`. 금액 `amount_krw`(KRW 정수). 약품 `ingredient_code`(주성분코드)·`unit`(단위). 수가 `category`(분류).
- enum 타입 `<entity>_status`, RPC = snake_case 동사(`register_encounter`), 트리거 `trg_<table>_<action>`, 헬퍼 `has_permission()`.
- JSON 필드 = 전 경로 snake_case(두 읽기 경로 일관).
- 재사용 검색 피커(Story 2.3, FR-202): `master_search_picker`(마스터 검색 피커) = 진단·약품·수가를 검색·선택만 강제(free-text 차단)하는 공용 컴포넌트(`MasterSearchPicker`). 종류 `MasterKind`(`diagnosis`·`drug`·`fee_schedule`), 선택 결과 `MasterPickerItem`(`code`·`name` + 종류별 식별 필드). Epic 4.7·5.2·5.5/7.x 재사용.

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
| `encounter_diagnosis` | 내원진단 | `encounter_diagnoses`(0014)·KCD `diagnosis_id` FK·`is_primary` 주/부상병·활성 주상병 ≤1(부분 unique) |
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

## enum — 오더 생명주기 (유형별, Story 5.1 `0015_orders.sql` 확정)

- 처방 `prescriptions.status`: `issued`(발행) → `dispensed`(발급, 원외 약국·Epic 7 7.7). 초기 `issued`.
- 검사·영상 `examinations.status`: `ordered`(지시) → `performed`(수행) → `completed`(판독/완료). 초기 `ordered`.
- 처치 `treatment_orders.status`: `ordered`(지시) → `performed`(수행) → `completed`(완료·예약). 초기 `ordered`.

> **(gap ⑤ 청산)** 오더 상태 어휘 통일·전이표 full matrix를 `0015_orders.sql`(Story 5.1)이 확정. 유형별 per-table
> 상태머신(통합 orders 테이블 없음 — `order`=총칭 추상). forward-only(역행·건너뛰기·재수행 없음), 위반 = `PT409`(→409,
> 0010 어휘 재사용·신규 SQLSTATE 불요). 전진 RPC = `perform_examination`/`complete_examination`/`perform_treatment_order`
> (소스상태 precondition = FR-093 재수행 차단). `dispense_prescription`(처방)·`complete_treatment_order`(처치)는 예약(Epic 7/미래).

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
| `mask_snapshot` / `SENSITIVE_KEY` / `PII_NAME_TABLES` | 함수·상수(api `services/audit`·web `lib/admin/audit`, Story 3.6) | 감사 스냅샷 PII/건강민감 **서버측 마스킹**(1차 권위) + 웹 렌더 마스킹(방어심층). 항상-민감 키(연락처·건강민감·암호) 전역 + `name` 은 테이블 인지(patients/guardians만, masters/roles 名 보존). 트리거는 전체행 저장(append-only·포렌식) — 마스킹은 **읽기 시점만**(at-rest 평문 잔존=수용 갭). 연락처/주민번호 reveal 은 Story 4.5(진료 허브 배너) |

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
| `SENSITIVE_PERMISSIONS` / `RESOURCE_LABELS` / `MATRIX_ROLE_ORDER` | 상수(web) | 민감 권한 코드 Set(현 4종: `patient.reveal_rrn`·`patient.reveal_contact`·`rbac.manage`·`audit.read`) · resource→한글 도메인 라벨(그룹 헤더) · 열 순서(admin 최후미 고정) |
| `NEXT_PUBLIC_API_BASE_URL` | env(web 공개) | FastAPI 베이스 URL(`/v1` 미포함). dev=`http://localhost:8000` · prod=`…/patient_management_system/api`. CORS 화이트리스트(`config.cors_origins`)에 web origin 필요 |

> **`requirePermission(code, fallback)` 정책 확정(Story 1.7, deferred-work 1.6 해소):** `(staff)` 하위 보호 라우트(예: `/admin/permissions`)는 부모 `(staff)/layout`이 이미 직원을 보장하므로 staff 재확인 불요. 권한 미보유 직원은 `fallback=STAFF_HOME(/home)`으로 강등. **매트릭스 읽기 = Supabase 직접 조회, 쓰기 = FastAPI(service_role)** — 0002가 authenticated 에 SELECT 만 grant하므로 토글은 FastAPI 경유가 유일 경로.

## 직원 계정 · 재직상태 관리 (Story 1.8, FR-214·215)

| 식별자 | 종류 | 비고 |
|---|---|---|
| `GET /v1/admin/users` | 엔드포인트(api) | 전 직원 목록(`StaffResponse[]`, 사번 순). `require_permission('user.manage')`. 관리 조회 — service_role/postgres 풀이 `users` 본인행 RLS 를 우회해 전원 반환 |
| `POST /v1/admin/users` | 엔드포인트(api) | 직원 생성(201). `StaffCreate` → `StaffResponse`. 사번/이메일 중복 → 409, 비-직원 역할 → 422 |
| `PATCH /v1/admin/users/{user_id}/employment-status` | 엔드포인트(api) | 재직상태 전환. `EmploymentStatusUpdate` → `StaffResponse`. 자가-락아웃 → 409 `self_lockout`, 미존재 → 404 |
| `create_staff(sub, payload)` | 함수(api·services) | 직원 생성 오케스트레이션 — Auth 사용자(HTTP) → `users` INSERT(DB), 실패 시 **보상**(`admin_delete_user`)으로 고아 방지. 역할 사전검증(직원 5역할, patient 422) |
| `change_employment_status(sub, user_id, payload)` | 함수(api·services) | 재직상태 전환 — DB UPDATE(접근 권위·감사) **먼저** → GoTrue ban/unban(로그인·세션) 보강(소프트, 멱등) |
| `list_staff(sub)` | 함수(api·services) | 전 직원 목록 조회 위임 |
| `insert_staff_profile` / `update_employment_status` / `fetch_staff_list` | 함수(api·db) | `authenticated_conn`(GUC actor) 안에서 `has_permission('user.manage')` 재평가 + 쓰기(동일 트랜잭션·TOCTOU 차단). 0004 `trg_users_audit` 자동 감사. 자가-락아웃 가드(`user_id==sub && status!='active'` → 409) |
| `admin_create_user` / `admin_delete_user` / `admin_set_ban(uid, *, banned)` | 함수(api·supabase_admin) | Supabase Auth Admin(supabase-py service_role) 래퍼 — **시스템 최초 supabase-py 사용**. 동기 API 를 `anyio.to_thread` 로 오프로드. ban=`{ban_duration:"876000h"\|"none"}`. 이메일 중복 → 409 `email_taken`, 약한 비밀번호 → 422 |
| `StaffDirectory` / `staff-create-form`(`StaffCreateForm`) | 컴포넌트(web·클라) | 직원 목록·재직상태 변경(확인 다이얼로그) / 생성 폼(base-ui Dialog + RHF + Zod). 목록·쓰기 모두 `apiFetch` |
| `staffCreateSchema` / `toCreatePayload` / `EMPLOYMENT_STATUS_META` | 상수·함수(web·`lib/admin/staff`) | 생성 폼 Zod 스키마(Pydantic `StaffCreate` 거울) · 빈 옵셔널 제거 페이로드 변환 · 재직상태 라벨+배지 색 메타 |
| `supabase_url` | env/config(api) | Supabase API 베이스(GoTrue Auth admin·Storage). 로컬 `http://127.0.0.1:54321`, 배포는 클라우드 URL override |

> **재직상태 = 이중 차단(Story 1.8 확정):** `employment_status`(`active`/`on_leave`/`terminated`) UPDATE 가 **접근 권위** — `has_permission`/`auth_user_role`(0003)이 active 만 인정하므로 휴직/퇴사 시 역할·권한이 즉시 무효(명령 403·셸 강등). GoTrue **ban** 이 **로그인·세션 차단**을 보강(DB 먼저→ban 나중, 차단 방향 fail-safe). 생성은 **Auth(HTTP) + users INSERT(DB) 2단계 비원자 오케스트레이션 + 보상**. email 은 auth.users 단일소유(`public.users`·응답에 없음), 비밀번호 비노출. **마이그레이션 0건**(스키마·트리거·권한 1.3 완비).

## 암복호 프리미티브 · PII 경계 (Story 1.9, `0005_crypto.sql`)

> **제네릭(주민번호 전용 아님)** — 모든 PII(연락처·주소 등) 공용 보안 경로(UX-DR22). 환자 주민번호는 **첫 소비처(Epic 3 patients)** 일 뿐, 이 마이그레이션은 데이터/컬럼을 만들지 않는다(에픽 범위 노트).

| 식별자 | 종류 | 비고 |
|---|---|---|
| `encrypt_sensitive(text)` | 함수(db, SECURITY DEFINER) | 평문 PII → 암호문 `bytea`(`pgp_sym_encrypt`, 키=Vault). service_role only(authenticated/anon REVOKE) |
| `decrypt_sensitive(bytea, target_table, target_id)` | 함수(db, SECURITY DEFINER) | 암호문 → 평문 + **복호 자가-감사**(`audit_logs` `read`, actor=`app.actor_id`, **값 미저장**). "복호=감사"를 DB가 강제(우회 불가). service_role only |
| `blind_index(text)` | 함수(db, SECURITY DEFINER) | 결정적 HMAC 해시(중복 매칭, FR-003 토대). 키=Vault. **IMMUTABLE 불가**(vault 읽음)→소비처가 컬럼(`*_hash`)에 저장+UNIQUE. 입력은 정규화값. service_role only |
| `pms_pii_enc_key` / `pms_pii_hmac_key` | Vault 시크릿(`vault.secrets`) | pgcrypto 대칭키 / HMAC 키. **코드·DB에 평문 없음**(FR-241) — `gen_random_bytes(32)` 로 DB 안에서 생성·`vault.decrypted_secrets` 로 복호 조회 |
| `normalize_rrn` / `validate_rrn` / `mask_rrn` | 함수(api·`services/rrn`) | 주민번호 정규화(13자리) / HARD(형식·성별세기자리 1–8·생년월일)·SOFT(체크섬 경고) 검증 / 마스킹(`710314-2******`). **순수**(DB·테이블 비의존) — 결과는 코드만 담고 원본 미echo(PII 경계) |
| `encrypt_sensitive` / `decrypt_sensitive` / `blind_index`(래퍼) | 함수(api·`core/db`) | 위 RPC 를 `authenticated_conn`(actor GUC 주입) 안에서 호출하는 얇은 async 래퍼. DB 장애→503 |
| `mask_pii` / `PiiMaskingFilter` / `configure_logging` | 함수·클래스(api·`core/logging`) | 운영 로그 주민번호 마스킹 백스톱(우발적 PII 로깅 방어심층). 루트 핸들러에 부착(lifespan) |

> **마이그레이션 번호 변이:** 1.9 가 `0005_crypto.sql` 을 차지 → 아키텍처 계획 맵의 `0005_masters`·`0006_patients` 는 **각각 0006·0007 로 한 칸 시프트**(계획 번호는 *예약*, 적용된 마이그레이션이 아님; 1.3 이 Vault 를 0001 에 접지 않고 별도 마이그레이션으로 미룬 귀결). Epic 2/3 스토리 생성 시 번호 재조정. **reveal UI(눈 아이콘+"감사기록")·엔드포인트는 Epic 3/4**(UX-DR9) — 1.9 는 DB 프리미티브 + 패턴 확립까지.
>
> **(Story 2.2 갱신) 확정 번호:** `0006_masters.sql`=조직 마스터(진료과·진료실, 2.1), `0007_masters_codes.sql`=코드 마스터(진단·수가·약품 + 유효기간, 2.2). 코드 마스터가 0007 을 차지하므로 **patients 는 0008 로 한 칸 더 cascade**(Epic 3 `0008_patients`). 적용된 마이그레이션은 0001~0007.
>
> **(Story 2.4 갱신) 확정 번호:** `0008_masters_code_ci_unique.sql`=마스터 5종 코드 대소문자 무관 unique(`lower(code)` 함수 인덱스로 교체, `<table>_code_key` 제약 drop — 참조 무결성/데이터 품질). 0008 을 코드 CI unique 가 차지하므로 **patients 는 0009 로 한 칸 더 cascade**(Epic 3 `0009_patients`). 적용된 마이그레이션은 0001~0008.
>
> **(Story 2.5 갱신) 마스터 시드:** `supabase/seed.sql` 이 5종 마스터(진료과 7·진료실 8·KCD 진단 22·EDI 수가 18·약품 17)를 **현재-유효 데이터**(`effective_from` 과거·`effective_to` NULL)로 적재 + DEV 의사를 내과(IM)에 배정. 멱등 `ON CONFLICT (lower(code)) DO NOTHING`(0008 함수 인덱스 추론 — `(code)` 아님). **신규 마이그레이션 없음**(시드는 DDL 아님 — 적용 번호 여전히 0001~0008, **patients 는 0009 유지**). 행위/진단 → 수가코드 **매핑(`fee_mappings`) 내용·테이블은 Epic 7**(다운스트림 — 본 스토리는 수가 *마스터 행*만).
>
> **(Story 3.1 확정) `0009_patients.sql` = patients + guardians + RLS·감사 인라인.** patients 가 0009 를 차지(드리프트 종결). **RLS 는 별도 `0014_rls_policies.sql` 파일 없이 본 마이그레이션에 인라인**(0006/0007 마스터 관례 계승 — 아키텍처 계획 맵의 0014 분리는 미실현). 다음 마이그레이션(내원 등 Epic 4)은 **0010**부터. 적용된 마이그레이션은 0001~0009.
>
> **(Story 4.1 확정) `0010_encounters.sql` = encounters + 상태머신(전이 트리거·RPC) + RLS·감사 인라인.** 에픽 본문·아키텍처의 `0007_encounters` 는 **stale**(0007=masters_codes) — encounters 는 0010. RLS·전이 트리거·전이 RPC·권한 시드를 한 파일에 인라인. 적용된 마이그레이션은 0001~0010.

## 환자 컬럼·식별자 (Story 3.1, `0009_patients.sql`)

| 식별자 | 한글 | 비고 |
|---|---|---|
| `chart_no` | 차트번호 | 사람용 식별자(라우트 안전·PII 아님). DB 시퀀스 `patients_chart_no_seq` → 8자리 zero-pad 기본값(race-free) |
| `resident_no` | 주민등록번호 | raw 평문은 **미저장**(아래 3컬럼으로만). 외국인등록번호 포섭(성별자리 5–8) |
| `resident_no_enc` | 주민번호_암호문 | `bytea` = `encrypt_sensitive(raw)`. 복호는 service_role RPC 만 |
| `resident_no_hash` | 주민번호_blind index | `text` = `blind_index(normalize_rrn(raw))`. **UNIQUE** 중복 차단(FR-003) |
| `resident_no_masked` | 주민번호_마스킹 | `text` = `mask_rrn(raw)` = `710314-2******`. 비민감 표시값(읽기 시 복호 불요) |
| `birth_date` / `sex` | 생년월일 / 성별 | 검증된 주민번호에서 **서버 파생**(`sex` ∈ `male`/`female`). 입력 불일치 제거 |
| `insurance_type` / `insurance_no` | 보험유형 / 보험번호 | `insurance_type` ∈ `health_insurance`(건강보험)·`medical_aid`(의료급여)·`auto_insurance`(자동차보험)·`self_pay`(일반) |
| `blood_type`·`allergies`·`chronic_diseases`·`medications`·`notes` | 혈액형·알레르기·기저질환·복용약·특이사항 | 임상 프로필 — 컬럼은 0009, 입력·조회 UI 는 Story 3.2(전부 nullable). `blood_type` 폐쇄어휘(A+/A-/B+/B-/O+/O-/AB+/AB-)는 앱 계층 강제(DB CHECK 아님) |
| `clinical_profile` | 임상 프로필 | 환자 sub-resource(위 5필드 묶음). 갱신 = `PUT /patients/{id}/clinical-profile`(`patient.update` 게이트 + in-txn 재평가), 조회 = `GET /patients/{id}` 포함(Story 3.2) |
| `auth_uid` | 인증 uid | nullable — 원무 등록=NULL, 앱 자가가입(3.4) 설정. RLS 본인행 앵커 |
| `relationship` | 관계 | guardians — 보호자 관계(표시명, enum 미강제) |
| `patients_chart_no_seq` | 차트번호 시퀀스 | chart_no 부여용 DB 시퀀스(service_role usage) |
| `insert_patient` / `fetch_patients` / `fetch_patient` | 함수(api·`core/db`) | 환자 INSERT(권한 동일트랜잭션 재평가+encrypt+blind_index, hash UNIQUE 위반→409 `patient_exists`) / 목록·상세(마스킹 컬럼 투영, `_enc`/`_hash` 제외) |
| `parse_rrn` | 함수(api·`services/rrn`) | 검증된 주민번호 → `(birth_date, sex)` 파생(순수). `normalize_rrn`/`validate_rrn`/`mask_rrn` 동반 |
| `PatientCreate` / `PatientResponse` / `PatientListItem` | 스키마(api·`schemas/patients`) | 생성 요청(`resident_no` 필수, `birth_date`/`sex` 미수신=서버 파생) / 응답(마스킹, `_enc`·`_hash` 미포함) / 목록 경량 |
| `patientCreateSchema` / `toPatientCreatePayload` / `rrnHardError` / `rrnChecksumOk` / `PatientRegister` | 상수·함수·컴포넌트(web·`lib/reception/patients`·`components/reception/patient-register`) | 등록 폼 Zod(Pydantic 거울) · 페이로드 변환 · RRN HARD 사전체크(차단)·체크섬 SOFT(경고) · RHF 풀페이지 폼(성공 시 chart_no+마스킹 확인) |
| `self-link` / `link_self_patient` / `PatientSelfLinkRequest` / `PatientSelfSummary` | 경로·함수·스키마(Story 3.4, api·`patients`·`core/db`·`schemas/patients`) | 앱 자가가입 후 본인 연결 — `POST /patients/self-link`(인증·비직원). `blind_index(normalize_rrn)` 매칭 → `auth_uid = JWT sub`(클라 uid 미수용). outcome 코드: `linked`(연결)·`already_linked`(멱등)·`no_patient_record`(404)·`identity_mismatch`(성명불일치 422)·`already_linked_other`/`account_already_linked`(409) |
| `get_current_patient` | 의존성(api·`core/security`) | 비직원(환자) 게이트 — active 직원 5역할이면 403(`get_current_staff` 반전). self-link/포털용 |
| `simulate_identity_verification` | 함수(api·`services/identity`) | 본인인증(PASS) **시뮬 seam** — 실연동 자리. 현재 통과만, 사칭 방지 1차선은 self-link 성명 일치 가드 |
| 전역 환자 검색 / `searchPatients` / `PatientSearchCommand` | 경로·함수·컴포넌트(Story 3.5, api·`patients`·web·`lib/reception/patients`·`components/shell/patient-search-command`) | 전역 `Ctrl K` 커맨드 팔레트 — `GET /patients?q=`(기존 목록 확장, `patient.read` 게이트) 이름·차트번호·연락처(자릿수) 검색. 결과=마스킹 `PatientListItem`(per-row reveal 없음, 오환자 단서=생년월일+마스킹 RRN+연락처) → 선택 시 `/patients/{id}` 이동. q 는 PII라 로그 미기록(신규 마이그레이션·인덱스 0건 — phone 성능 인덱스 이월) |
| `patient.reveal_rrn` / `patient.reveal_contact` / `reveal_rrn` / `reveal_contact` | 권한·RPC(Story 4.5, `0002`/`0012`·api·`patients`) | 민감정보 열람 권한(둘 다 민감 = 토글 시 확인) + SECURITY DEFINER RPC. `POST /patients/{id}/reveal-rrn`(`reveal_rrn` → `has_permission` 재평가 + `decrypt_sensitive` 복호 = 'read' 자가-감사 → full RRN) / `POST /patients/{id}/reveal-contact`(`reveal_contact` → 권한 재평가 + 수동 'read' 감사 → full phone/address/email, 연락처 평문 유지). 부수효과(감사)=POST. service_role only. `reveal_contact` 는 0012 신규 권한(admin boot grant + 1.7 매트릭스) |
| `GET /patients/{id}/encounters` / `fetch_patient_encounters` | 경로·함수(Story 4.5, api·`patients`·`core/db`) | 한 환자의 과거 내원 이력(진료 허브 좌 컨텍스트, FR-031). `_ENCOUNTER_LIST_COLUMNS` 조인 재사용·최근순·`encounter.read` 게이트. 안전 상한 100건(초과 시 패널이 절단 명시) — 진단/처방 per-visit 부착은 4.7/Epic5 |

> **환자 PII 경계(Story 3.1 확정):** raw 주민번호는 `resident_no_enc`(bytea)로만 — 응답·로그·URL·감사 before/after 평문 부재. 응답은 `resident_no_masked`. **컬럼 GRANT 로 `_enc`/`_hash` 는 authenticated SELECT 제외**(RLS 행 + 컬럼 열 이중 차단). reveal(복호) 엔드포인트·UI 는 **Story 4.5(진료 허브 배너)가 첫 소비처** — `reveal_rrn`/`reveal_contact` RPC(권한 게이트 + 'read' 자가-감사). 단 `GET /patients/{id}` 는 여전히 평문 연락처를 반환(서버측 연락처 마스킹은 이월). 등록 시 동일 주민번호(hash) → 409 `patient_exists`(등록 시점 중복 차단; 앱 자가가입 자동연결은 3.4).

## 내원 상태머신 · 전이 RPC (Story 4.1, `0010_encounters.sql`)

| 식별자 | 종류 | 비고 |
|---|---|---|
| `encounters` | 테이블 | 내원 파이프라인 허브(임상기록 4.6·오더 Epic5·수납 Epic7 이 매단다). PK `id` uuid, 사람용 번호 `encounter_no` |
| `encounters_encounter_no_seq` | 시퀀스 | `encounter_no` 부여용(service_role usage) — 8자리 zero-pad 기본값(race-free, `patients_chart_no_seq` 미러) |
| `visit_type` | 컬럼(CHECK) | 접수 경로: `walk_in`(즉석)·`reserved`(예약). 생성 시 세팅(4.2) |
| `doctor_id` | 컬럼(FK users) | 담당의 — `start_consult` 가 `auth.uid()` 로 세팅(nullable, 4.4 정제) |
| `registered_at`·`consult_started_at`·`completed_at`·`cancelled_at`·`no_show_at` | 컬럼(timestamptz) | 전이 RPC 가 해당 시각 기록(대기시간·NFR-002 메트릭 근거, nullable) |
| `cancel_reason` | 컬럼 | 취소/노쇼 운영 사유(저민감 — 임상/PII 자유텍스트 금지) |
| `created_by` | 컬럼(FK users) | 접수 처리 직원 |
| `register_encounter(uuid)` | RPC(SECURITY DEFINER) | `scheduled→registered`(예약 접수). 권한 `encounter.register`, `registered_at` 기록 |
| `start_consult(uuid)` | RPC(SECURITY DEFINER) | `registered→in_progress`(진찰 시작). 권한 `encounter.start`, `consult_started_at`+`doctor_id=auth.uid()` |
| `complete_encounter(uuid)` | RPC(SECURITY DEFINER) | `in_progress→completed`(진료 완료). 권한 `encounter.complete`, `completed_at`. **주상병 게이트(0014 재정의, 4.7): 활성 주상병(`is_primary`) 미지정 시 `PT422`→422 차단**. 부분수행도 여기로 종결(정산 Epic7 FR-119) |
| `cancel_encounter(uuid, text)` | RPC(SECURITY DEFINER) | `scheduled\|registered→cancelled`. 권한 `encounter.cancel`, `cancelled_at`+`cancel_reason`. 수가 미발생 정산 Epic7 FR-118 |
| `mark_no_show(uuid, text)` | RPC(SECURITY DEFINER) | `scheduled→no_show`. 권한 `encounter.no_show`, `no_show_at` |
| `enforce_encounter_transition()` | 트리거 함수(plpgsql, DEFINER 아님) | **전이 매트릭스 단일 진실** — BEFORE INSERT(초기상태 가드 scheduled\|registered)/UPDATE(전이 검증). 위반 → SQLSTATE `PT409` |
| `trg_encounters_transition` | 트리거(BEFORE INSERT OR UPDATE) | 전이 강제(service_role 직접 update 까지 봉쇄, NFR-040 최종선) |
| `trg_encounters_audit` | 트리거(AFTER, 0004 재사용) | 모든 전이(create/update/delete)를 actor 와 함께 append-only 감사 |
| `encounter.read`·`encounter.cancel`·`encounter.no_show` | 권한(신규 시드) | 0010 카탈로그 확장 + admin 부트 grant(비-admin=1.7 매트릭스). `encounter.register/start/complete` 는 0002 기존 |
| `PT409` / `PT404` / `PT422` | 커스텀 SQLSTATE | 전이 위반(→409)·내원 없음(→404)·**주상병 미지정 완료(→422 `primary_diagnosis_required`, 4.7 `complete_encounter` 게이트)**. 클래스 `PT`=PMS transition(코어 미사용). 권한 위반은 표준 `insufficient_privilege`(42501→403). asyncpg `e.sqlstate` 로 4.2/4.4/4.7 가 `ConflictError`/`NotFoundError`/`AppError`/`ForbiddenError` 매핑 |

> **내원 상태 전이 매트릭스(full, Story 4.1 확정 — architecture Gap Analysis #3 소유):**
> `(INSERT)`→`scheduled`(예약·Epic6)\|`registered`(walk-in·MVP) │ `scheduled`→`registered`\|`cancelled`\|`no_show` │ `registered`→`in_progress`\|`cancelled` │ `in_progress`→`completed`. 종결(`completed`·`cancelled`·`no_show`)=이탈 전이 없음(역행·건너뛰기·종결 재전이 = `PT409`). **`no_show` 는 `scheduled` 에서만**(접수=도착 증명). **`in_progress→cancelled` 기본 불허**(부분수행=`completed` 후 Epic7 정산, FR-119). 부분수행은 별도 상태 아님(`encounter_status` 6값 불변).
>
> **쓰기 경로:** 전이는 SECURITY DEFINER RPC(자체 `has_permission()` 게이트 = 동일 txn TOCTOU 재평가) 또는 service_role 만 — `authenticated` 직접 쓰기 정책 없음(RLS). RPC EXECUTE 는 authenticated+service_role 에 grant(자체 게이트로 안전). FastAPI 액션 엔드포인트(`POST /encounters/{id}/register|start-consult|…`)·asyncpg 래퍼·SQLSTATE→HTTP 매핑은 **Story 4.2/4.4 소비**(4.1=DB 토대). **encounters 에 PII/건강민감 자유텍스트 컬럼 없음**(주호소·진단=4.6/4.7) → 감사 마스킹(3.6) 집합 변경 불요.

## 내원 접수 — FastAPI · 웹 소비 레이어 (Story 4.2)

| 식별자 | 종류 | 비고 |
|---|---|---|
| `POST /v1/encounters` | 엔드포인트 | walk-in 즉석 접수 — service_role 직접 INSERT(`status='registered'`·`visit_type='walk_in'`, register RPC 미경유). 게이트 `encounter.register`. 미존재 환자→404·비활성 환자/진료과→422. 생성 행 자체가 대기열 진입 |
| `POST /v1/encounters/{id}/register` | 엔드포인트(액션) | 예약 환자 도착 접수 — `register_encounter` RPC 소비(`scheduled→registered`). status PATCH 아님. 잘못된 전이→409·미존재→404 |
| `GET /v1/encounters/{id}` | 엔드포인트 | 내원 단건 조회(접수 결과·상세). 게이트 `encounter.read`. 목록·대기 현황판은 4.3 |
| `insert_walk_in_encounter` / `call_register_encounter` / `fetch_encounter` | db 래퍼(`core/db.py`) | walk-in INSERT(`registered_at`·`created_by` 충전=4.1 handoff 청산·환자/진료과 활성 검증) / register RPC 호출 / 단건 조회 |
| `_map_pg_sqlstate` | 헬퍼(`core/db.py`) | **SQLSTATE→도메인 오류 공유 매핑(4.2 도입)** — `PT409→ConflictError(invalid_transition,409)`·`PT404→NotFoundError(404)`·`42501→ForbiddenError(403)`, 그 외→503. `_run_authed` 가 모든 db 호출에 적용(4.4/Epic6·7 재사용) |
| `create_walk_in_encounter` / `register_scheduled_encounter` / `get_encounter` | 서비스(`services/encounters.py`) | 오케스트레이션(검증·RPC 호출→응답 매핑). 상태머신·감사는 DB 소유 |
| `EncounterCreate` / `EncounterResponse` | 스키마(Pydantic) | 생성 요청(`patient_id`·`department_id`·선택 `room_id`) / 응답(0010 전 컬럼, snake_case). 비-PII |
| `createWalkInEncounter` / `walkInIntakeSchema` / `Encounter` | 웹(`lib/reception/encounters.ts`) | 접수 호출(apiFetch)·Zod 스키마·타입(수동 정의 — `database.types.ts` 미생성) |
| `patient-intake` | 웹 컴포넌트(`components/reception/`) | 접수 화면(환자 검색 3.5 재사용 + 진료과 select + 접수 확정). 라우트 `/reception/intake`(nav 기존, 역할 노출) |
| reception → `encounter.register`·`encounter.read` | seed grant(`seed.sql`) | 데모/통합테스트 가동(walk-in 골든 패스). 프로덕션 런타임 grant 는 Story 1.7 매트릭스 소유 |

> **(Story 4.3 확정) `0011_encounter_call.sql` = 호출 상태 + 실시간 publication.** encounters 에 호출 마커 컬럼 추가 + `record_encounter_call` RPC + `encounter.call` 권한 + encounters 를 `supabase_realtime` publication 에 등록(코드베이스 최초 realtime). 적용된 마이그레이션은 0001~0011. 다음(Epic 4 후속/5)은 **0012**부터.

## 환자 호출 · 대기 현황판 (Story 4.3, `0011_encounter_call.sql`)

| 식별자 | 종류 | 비고 |
|---|---|---|
| `called_at` | 컬럼(timestamptz) | 최종 호출 시각(비-상태 마커 — 호출은 전이 아님, nullable) |
| `call_count` | 컬럼(integer, default 0) | 누적 호출 횟수(재호출 포함 — 중복 호출 가시화) |
| `last_called_by` | 컬럼(FK users) | 최종 호출 직원(`auth.uid()`) |
| `record_encounter_call(uuid)` | RPC(SECURITY DEFINER) | 호출 기록(**전이 아님** — `registered` 행에 `called_at`/`call_count++`/`last_called_by`). 권한 `encounter.call`. 미접수/진행중/종결 호출 → `PT409`(→409)·미존재 → `PT404`(→404). 재호출(registered)은 허용(count++). 전이 트리거 same-status 통과 활용 |
| `encounter.call` | 권한(신규 시드) | 환자 호출 — 0011 카탈로그 확장 + admin 부트 grant(reception 데모 grant=seed; doctor=4.4) |
| `GET /v1/encounters` | 엔드포인트 | 대기 현황판 목록 — 진료과(필수)·상태·일자(KST, 기본 오늘) 필터, 활성도 순. 게이트 `encounter.read`. denormalized 조인(환자명·차트번호·진료과명·진료실·담당의) `{data, meta}`. payload 비-PII 보장 위해 raw RRN/연락처 미투영 |
| `POST /v1/encounters/{id}/call` | 엔드포인트(액션) | 환자 호출 — `record_encounter_call` RPC 소비. status PATCH 아님. 게이트 `encounter.call`. mutation 중 버튼 disable=중복 호출 1차선(FR-023) |
| `EncounterListItem` / `EncounterPage` | 스키마(Pydantic) · 웹 타입 | 보드 행(0010·0011 컬럼 + 조인 표시 필드) / `{data, meta}` 페이지 |
| `fetch_encounters` / `call_encounter` | db 래퍼(`core/db.py`) | 목록 조회(진료과×일자×상태 동적 필터+조인+count, `idx_encounters_dept_status`) / 호출 RPC 호출 |
| `list_encounters` / `record_call` | 서비스(`services/encounters.py`) | 목록 페이지 조립(일자 기본=오늘 KST) / 호출 기록 |
| `fetchEncounters` / `callEncounter` / `registerEncounter` | 웹(`lib/reception/encounters.ts`) | 목록 조회 / 호출 / (예약)접수 호출(apiFetch). `nextCallCandidate`·`waitMinutes`·`STATUS_GROUP_ORDER`·`TERMINAL_STATUSES` 헬퍼 |
| `StatusBadge` | 웹 컴포넌트(`components/encounters/`) | UX-DR6 status-badge A3(글리프 ○●◐✓✕ + 상태색 라벨, 색 비의존). `ENCOUNTER_STATUS_META`(glyph 포함) 소비 |
| `useEncountersRealtime` | 웹 훅(`hooks/`) | 코드베이스 최초 realtime — `postgres_changes`(encounters, 진료과 필터) 구독 → 디바운스 refetch + 백스톱 폴링 + 신선도(채널 stale) 가드(UX-DR18/21⑪) |
| `WaitingBoard` | 웹 컴포넌트(`components/encounters/`) | 대기 현황판(원무·의사 공유) — 상태 그룹 섹션·"다음 호출" 히어로·KPI·다음-액션(호출/접수)·stale 배너. 라우트 `/reception/waiting`·`/doctor/waiting` |
| reception → `encounter.call` | seed grant(`seed.sql`) | 데모 호출 골든 패스(doctor 미부여 — 4.4) |

## 내원진단 · 진료 완료 게이트 (Story 4.7, `0014_encounter_diagnoses.sql`)

| 식별자 | 종류 | 비고 |
|---|---|---|
| `encounter_diagnoses` | 테이블(0014) | 내원진단 1:N — `encounter_id`·`diagnosis_id`(KCD `diagnoses` 마스터 FK, free-text 구조 차단)·`is_primary`(주/부상병)·`recorded_by`·`is_active`. 건강민감 자유텍스트 컬럼 없음(진단명=마스터 조인 합성) → 감사 마스킹 불요(FK posture) |
| `uq_encounter_diagnoses_primary` / `uq_encounter_diagnoses_dup` | 부분 unique 인덱스 | 활성 주상병 ≤1/내원(`where is_primary and is_active`) / 같은 코드 활성 중복 부착 차단(`where is_active`). 주상병 강등은 FastAPI 가 동일 트랜잭션(인덱스=최종선) |
| `diagnosis.attach` / `diagnosis.read` | 권한 | 부착/토글/제거=`diagnosis.attach`(0002 기존, 첫 소비처) · 조회=`diagnosis.read`(0014 신규, 의사·관리자만 — 원무·간호 미열람 최소권한 + admin 부트 grant). 완료=`encounter.complete`(0002 기존) |
| `GET /v1/encounters/{id}/diagnoses` | 엔드포인트 | 부착 진단 목록(주상병 우선·부착순). 게이트 `diagnosis.read`. `EncounterDiagnosisResponse[]`(KCD 코드·명칭 조인) |
| `POST /v1/encounters/{id}/diagnoses` | 엔드포인트 | KCD 진단 부착(`{diagnosis_id, is_primary}`). 게이트 `diagnosis.attach`. 주상병 시 기존 강등(동일 txn). 미존재 내원 404·중복 409 `diagnosis_already_attached`·잘못된 diagnosis_id 422 `invalid_reference`(FK 백스톱) |
| `PATCH /v1/encounters/{id}/diagnoses/{ed_id}` | 엔드포인트 | 주/부상병 토글(`{is_primary}`). 게이트 `diagnosis.attach`. 미존재 404 |
| `DELETE /v1/encounters/{id}/diagnoses/{ed_id}` | 엔드포인트 | 부착 진단 제거(soft delete, 204). 게이트 `diagnosis.attach`. 미존재 404 |
| `POST /v1/encounters/{id}/complete` | 엔드포인트(액션) | 진료 완료 — `complete_encounter` RPC 소비. status PATCH 아님. 게이트 `encounter.complete`. **주상병 미지정 → 422 `primary_diagnosis_required`**(PT422)·비-in_progress 409·미존재 404. ⚠️ 완료→수납 액션바·flow stepper·신원 확인은 Epic 7 |
| `DiagnosisAttach`·`DiagnosisPrimaryUpdate`·`EncounterDiagnosisResponse` | 스키마(Pydantic) · 웹 타입 | 부착 요청 / 토글 요청 / 응답(조인 `diagnosis_code`·`diagnosis_name`). `EncounterDiagnosis`(web `lib/encounters/diagnoses.ts` 거울·snake_case) |
| `attach_diagnosis`·`set_diagnosis_primary`·`remove_diagnosis`·`fetch_encounter_diagnoses`·`call_complete_encounter` | db 래퍼(`core/db.py`) | service_role 직접 INSERT/UPDATE(부착=walk-in/medical_records 패턴·`_require_diagnosis_attach` TOCTOU·강등 동일 txn·FK 23503→422) / 완료=RPC 호출(`call_start_consult` 동형) |
| `DiagnosisBlock`·`ConsultationWorkspace`·`diagnoses.ts` | 웹(`components/encounters/`·`lib/encounters/`) | 진단 블록(SOAP 위, `MasterSearchPicker` 단일 어더 + 커스텀 칩·주/부상병 토글·422 인라인+포커스) / 중앙 작업영역(DiagnosisBlock+SoapLedger+진료 완료 최소 액션·primaryError 소유) / 진단 API 호출 |
| doctor → `diagnosis.attach`·`diagnosis.read`·`encounter.complete` | seed grant(`seed.sql`) | 진단 부착·조회·진료 완료 골든 패스(nurse=무권한 baseline 403). 데모/통합테스트용(프로덕션=1.7 매트릭스) |

> **진단 부착 경계(Story 4.7 확정):** 진단은 **KCD `diagnoses` 마스터 FK(`diagnosis_id`)로만** 부착 — free-text 차단(UX-DR12)의 구조적 강제. `encounter_diagnoses` 의 감사 스냅샷은 `diagnosis_id`(FK)·`is_primary`·플래그만 = 자유텍스트 미유입 → **`_SENSITIVE_KEY` 마스킹 집합 무변경**(4.6 SOAP 자유텍스트와의 핵심 차이). 주상병 불변식(≤1/내원)은 **부분 unique 인덱스**가 최종선(강등은 FastAPI 동일 트랜잭션). 진료 완료는 **주상병 1개 필수**(`complete_encounter` 게이트 PT422→422·웹은 진단 필드 포커스+인라인 "주상병을 1개 지정해야 합니다", UX-DR18). **완료→수납 정산·sticky 액션바·flow stepper·신원 확인 = Epic 7**(4.7 = 완료 게이트 + 최소 트리거). **처방↔진단 연결(FR-051)·과거 진단 타임라인(FR-031 좌패널 backfill) = Epic 5/이월**.

## 오더 생명주기 · 전이 RPC (Story 5.1, `0015_orders.sql`)

| 식별자 | 종류 | 의미·계약 |
|---|---|---|
| `prescriptions` / `prescription_details` | 테이블(0015) | 처방전 헤더(1:N·`encounter_id`·`encounter_diagnosis_id` 근거 진단 FR-051 nullable·`status` issued→dispensed·`ordered_by` 발행의사) + 처방상세 라인(`drug_id` 약품 마스터 FK·`dose`·`frequency`·`duration_days`·`usage_instruction` — free-text 약품 차단의 구조적 강제) |
| `examinations` | 테이블(0015) | 검사·영상 오더(`exam_type` lab/imaging 워크리스트 라우팅 FR-061·`fee_schedule_id` EDI 행위 FK·`status` ordered→performed→completed·지시/수행/판독 `*_by`+`*_at`·`equipment_id` 촬영 배정 nullable). 판독 소견 텍스트 컬럼은 5.9 추가 |
| `treatment_orders` | 테이블(0015) | 처치 오더(`fee_schedule_id` 행위 FK·`status` ordered→performed→completed·지시/수행 추적). 수행 내용·간호기록은 5.7 `nursing_record` 별도 |
| `equipment` | 테이블(0015) | 검사장비 마스터(`code`·`name`·`modality`·`status` available/in_use/maintenance — 상태머신 아님). 전역 참조 RLS(rooms 미러). 5.8 목록·상태 FR-103 |
| `enforce_prescription_transition` / `enforce_act_order_transition` | 트리거 함수(0015) | 전이 매트릭스 강제(INSERT 초기상태 가드 + UPDATE 매트릭스). 검사·처치 공용(act 함수). 위반 `PT409`. 0010 `enforce_encounter_transition` 패턴 |
| `perform_examination(uuid)` / `complete_examination(uuid)` / `perform_treatment_order(uuid)` | RPC(SECURITY DEFINER) | 전진 전이 — 권한 자가 게이트(`examination.perform`/`examination.complete`/`treatment.perform`) + `for update` + 소스상태 precondition(재수행 차단 FR-093). 액터=`auth.uid()`. not-found `PT404`. 0010 `start_consult` 동형 |
| `order.read` / `examination.perform` / `examination.complete` | 권한(0015 신규) | 오더 조회(RLS 직원 게이트 — 의사·간호·방사선만, 원무 제외 최소권한) / 검사·영상 수행 / 판독 완료. **admin 부트 grant 재실행**(test_admin_role_has_all_permissions 회귀 회피). `prescription.create`·`examination.order`·`treatment.order`·`treatment.perform`는 0002 기존 |
| nurse → `order.read`·`examination.perform`·`treatment.perform` · doctor → `order.read`·`examination.complete` · radiologist → `order.read`·`examination.perform` | seed grant(`seed.sql`) | 직역 분담 오더 골든 패스. **오더 403 baseline = reception**(임상 오더 권한 0 — nurse 의 encounter/patient baseline 과 분리). 데모/통합테스트용(프로덕션=1.7 매트릭스) |

> **오더 도메인 경계(Story 5.1 확정):** 유형별 per-table 상태머신(통합 orders 테이블 없음 — `order`=총칭 추상, 우 오더 패널 5.5 가 query/UI union). **오더 생성(처방 발행 5.2·검사/처치 지시 5.3/5.4) INSERT = service_role 직접**(walk-in/medical_records 선례·RPC 아님·API TOCTOU 권한 재평가) — 본 스토리는 스키마 + 초기상태 트리거 가드 + 전진 RPC만. 감사 스냅샷 = FK·플래그·숫자·짧은 구조화 텍스트(약품=`drug_id` FK 불투명·dose/frequency 는 조인 없이 무의미) → **`_SENSITIVE_KEY` 마스킹 집합 무변경**(encounter_diagnoses 동일 FK posture). 자유 임상 서사(판독 소견 5.9·처치 수행 내용 5.7)는 소유 스토리가 컬럼+마스킹 동반 추가(본 파일은 자유 서사 컬럼 0). **마이그 번호 0015**(에픽/아키 stale `0009_orders` — 실제 0015·Epic 5 블록 0015~0029 고정·Epic 6 워크트리 0030~ 비침범). 적용된 마이그레이션은 0001~0015. **수가 자동발생 트리거·`fee_mappings`=5.10·알레르기 교차검증=5.5·영상 업로드=5.8·dispense/order-cancel·내원상태 게이트·앱 낙관적 잠금=이월**.

### 처방 오더 발행·조회 API (Story 5.2)

| 식별자 | 종류 | 의미·계약 |
|---|---|---|
| `POST /encounters/{id}/prescriptions` | 경로(api·`orders`·`tags=orders`) | 처방전 발행(FR-050·051) — 헤더 + N 상세 라인 **원자적 1 POST**(처방전=함께 발행되는 단위·1:N). 게이트 `prescription.create`(의사). 약품=`drug_id` 마스터 FK(free-text 차단). 근거 진단 `encounter_diagnosis_id` 선택(같은 내원·활성 검증 → 422 `invalid_diagnosis_reference`). 미존재 내원 404·잘못된 약품 422 `invalid_reference`·빈 details 422(Pydantic min_length) |
| `GET /encounters/{id}/prescriptions` | 경로(api·`orders`) | 발행 처방전 목록(헤더 최신순 + 상세 `drugs` 조인 `drug_code`·`drug_name`·`ingredient_code`). 게이트 `order.read`(의사·간호·방사선·원무 제외) → reception 403·nurse 200. 직접 배열(`{data,meta}` 봉투 아님) |
| `insert_prescription` / `fetch_prescriptions` / `_require_prescription_create` | 함수(`core/db`) | service_role 직접 INSERT(헤더+상세 단일 txn·`attach_diagnosis` 미러)·TOCTOU 재평가. ⚠️ `dose`=numeric → `Decimal(str(dose))` 변환(asyncpg float 거부). 응답=순수 dict 트리(`{**dict(header),"details":[dict(d)…]}` — 중첩 Record 직접 model_validate 불가) |
| `schemas/orders.py` · `services/orders.py` · `api/v1/orders.py` | 모듈(신규) | 오더 도메인 모듈(router.py 가 선언한 orders — 후속 5.3/5.4 합류). `PrescriptionCreate`(details min_length=1)·`PrescriptionResponse`(nested details). db.py 는 단일 유지(오더 섹션 append) |
| `prescription-panel.tsx` · `lib/encounters/prescriptions.ts` · `issuedIngredientCodes` | 웹(신규) | 진료 허브 우 오더 pane(encounter-hub placeholder 교체·처방만=5.2). MasterSearchPicker `kind=drug` 단일 어더로 드래프트 라인 누적 → 발행. 근거 진단=`fetchEncounterDiagnoses` 재사용. **FR-052 동일 성분 중복 경고 = 클라 측 `ingredient_code` 비교(비차단 인라인)** = (발행 처방 활성 상세 ∪ 현 드래프트). 데모 약품 17종 성분 고유 → 같은 약 재추가로 데모 |

> **처방 발행 경계(Story 5.2 확정):** **신규 마이그/신규 권한/admin 부트 grant/감사 마스킹 변경 = 전부 0** — `prescription.create`(0002 기존·admin 보유)·`order.read`(doctor 5.1 기보유) 소비만 → 4.6/4.7/5.1 의 "신규권한→admin 재grant" 함정 비해당, `test_admin_role_has_all_permissions` 회귀 0. **403 baseline = reception(오더 0) + nurse(order.read 有/prescription.create 無 = read-yes/create-no)**. nurse 이관 0건(비중첩 권한). **처방 취소/정정/dispense=Epic 7(7.7)·알레르기 교차검증 하드블록=5.5·신원확인 다이얼로그=Epic 7·오더-by-내원상태 게이트·앱 낙관적 잠금=이월**.

### 검사·영상 오더 API (Story 5.3)

| 식별자 | 종류 | 의미·계약 |
|---|---|---|
| `POST /encounters/{id}/examinations` | 경로(api·`orders`·`tags=orders`) | 검사·영상 오더 생성(FR-060·061) — **단건**(처방 헤더/상세 1:N 아님). 게이트 `examination.order`(의사). `exam_type`(`lab`/`imaging`)=워크리스트 라우팅 분류 축·검사 행위=`fee_schedule_id` 마스터 FK(free-text 차단). status='ordered'(지시) DB 강제. 미존재 내원 404·잘못된 행위 422 `invalid_reference`·잘못된 exam_type 422(Pydantic Literal) |
| `GET /encounters/{id}/examinations` | 경로(api·`orders`) | 한 내원 검사·영상 오더 목록(최신순 + `fee_schedules` 조인 `fee_code`·`fee_name`·`fee_category`·`amount_krw`). 게이트 `order.read`(원무 제외) → reception 403·nurse 200. 직접 배열 |
| `insert_examination` / `fetch_examinations` / `_require_examination_order` | 함수(`core/db`) | service_role 직접 INSERT(`insert_prescription` 미러·단건 평면·Decimal 불요)·TOCTOU 재평가·내원 선검사 404·FK 23503 → 422. 응답 = `fee_schedules` 조인 dict(`_EXAMINATION_COLUMNS`/`_EXAMINATION_FROM`) |
| `ExaminationCreate` / `ExaminationResponse` | 스키마(`schemas/orders.py` 확장) | `exam_type: Literal["lab","imaging"]`·`fee_schedule_id`. 응답=fee 조인 + `status`/`ordered_by`/`equipment_id`·`performed_*`·`completed_*`(후자는 5.7/5.8/5.9 세팅·생성 시 NULL). `create_examination`/`list_examinations`(`services/orders.py`) |
| `examination-panel.tsx` · `lib/encounters/examinations.ts` | 웹(신규) | 진료 허브 우 오더 pane 검사·영상 섹션(처방 패널과 **공존 스택**·encounter-hub). `exam_type` 세그먼트 토글(진단검사/영상검사) + MasterSearchPicker `kind=fee_schedule` 단일 어더 → **즉시 오더**(diagnosis-block 선례). 목록=유형 칩·행위명·`formatKrw`. pay-chip 급여여부·수가 프리뷰 통합=5.5 |

> **검사·영상 오더 경계(Story 5.3 확정):** **신규 마이그/신규 권한/admin 부트 grant/SQLSTATE/감사 마스킹 변경 = 전부 0** — `examination.order`(0002 기존·admin 보유)·`order.read`(doctor 5.1 기보유) 소비만 + doctor `examination.order` 시드 grant 1건(5.2 `prescription.create` 동형·admin 재grant 불요·회귀 0). **403 baseline = reception(오더 0) + nurse(order.read 有/examination.order 無 = read-yes/order-no)**. **라우팅(FR-061) = `exam_type` 분류 축**(워크리스트 UI·수행 perform·검체 채취·외부 의뢰 결과=5.7/5.8/다운스트림·판독 소견 컬럼·complete=5.9·장비 배정 equipment_id·영상 Storage=5.8·전체 탭 패널·누락0 디텍터·수가 프리뷰=5.5·수가 자동발생=5.10·오더 취소/내원상태 게이트=이월).

### 처치 오더 API (Story 5.4)

| 식별자 | 종류 | 의미·계약 |
|---|---|---|
| `POST /encounters/{id}/treatment-orders` | 경로(api·`orders`·`tags=orders`) | 처치 오더 생성(FR-070) — **단건**. 게이트 `treatment.order`(의사). 처치 행위=`fee_schedule_id` 마스터 FK(free-text 차단)·간호 워크리스트 **단일 라우팅**(검사의 `exam_type` 분류 축 없음). status='ordered'(지시) DB 강제. 미존재 내원 404·잘못된 행위 422 `invalid_reference` |
| `GET /encounters/{id}/treatment-orders` | 경로(api·`orders`) | 한 내원 처치 오더 목록(최신순 + `fee_schedules` 조인 `fee_code`·`fee_name`·`fee_category`·`amount_krw`). 게이트 `order.read`(원무 제외) → reception 403·nurse 200. 직접 배열 |
| `insert_treatment_order` / `fetch_treatment_orders` / `_require_treatment_order` | 함수(`core/db`) | service_role 직접 INSERT(`insert_examination` 미러·단건 평면)·TOCTOU 재평가·내원 선검사 404·FK 23503 → 422. 응답 = `fee_schedules` 조인 dict(`_TREATMENT_ORDER_COLUMNS`/`_TREATMENT_ORDER_FROM`). ⚠️ SQL 별칭 `tr`(`to`=예약어 회피) |
| `TreatmentOrderCreate` / `TreatmentOrderResponse` | 스키마(`schemas/orders.py` 확장) | `fee_schedule_id` 만(검사의 `exam_type` 없음). 응답=fee 조인 + `status`/`ordered_by`/`performed_*`(후자는 5.7 세팅·생성 시 NULL). ⚠️ `exam_type`·`equipment_id`·`completed_*` 없음(treatment_orders 미보유). `create_treatment_order`/`list_treatment_orders`(`services/orders.py`) |
| `treatment-panel.tsx` · `lib/encounters/treatment-orders.ts` | 웹(신규) | 진료 허브 우 오더 pane 처치 섹션(처방·검사 패널과 **공존 스택**·encounter-hub). MasterSearchPicker `kind=fee_schedule` 단일 어더 → **즉시 오더**(exam_type 토글 없음 — 검사 패널보다 단순). 목록=행위명·`formatKrw`. 전체 탭 패널·pay-chip·수가 프리뷰 통합=5.5 |

> **처치 오더 경계(Story 5.4 확정):** **신규 마이그/신규 권한/admin 부트 grant/SQLSTATE/감사 마스킹 변경 = 전부 0** — `treatment.order`(0002 기존·admin 보유)·`order.read`(doctor 5.1 기보유) 소비만 + doctor `treatment.order` 시드 grant 1건(5.3 `examination.order` 동형·admin 재grant 불요·회귀 0). **403 baseline = reception(오더 0) + nurse(order.read·treatment.perform 有/treatment.order 無 = read-yes/order-no)**. **처치는 간호 단일 라우팅**(검사의 `exam_type` 분기 없음) — 수행 perform·재수행 차단·일상 간호기록=5.7(`nursing_record` 별도)·`complete_treatment_order` RPC·completed=이월(deferred-work)·전체 탭 패널·누락0 디텍터·수가 프리뷰=5.5·수가 자동발생=5.10·오더 취소/내원상태 게이트=이월.

### 오더 패널 통합 · 알레르기 교차검증 · 누락 0 디텍터 (Story 5.5, `0016_order_coverage_allergy.sql`)

| 식별자 | 종류 | 의미·계약 |
|---|---|---|
| `coverage_type` | 컬럼(0016, `fee_schedules`·`drugs`) | 급여 `covered` / 비급여 `non_covered`(영문 enum·default `covered`·CHECK 2상태). UX-DR13 pay-chip·수가 프리뷰 분류 소스. **급여 분류 flag만** — 본인부담률·산정특례·선별급여=Epic7(0007 주석 화해: 분류=5.5/산정=Epic7) |
| `allergy_override_reason` | 컬럼(0016, `prescription_details`) | 알레르기 오버라이드 사유(자유텍스트·nullable·conflict 라인만). `prescription_details` 는 0015 감사 트리거(`trg_prescription_details_audit`) 보유 → after_data 자동 캡처(append-only). **감사 마스킹 대상**(`_SENSITIVE_KEY` 서버+웹 거울 추가) |
| `_allergy_conflicts(allergies_text, drugs_by_id)` | 함수(`core/db`·순수) | 알레르기↔약품명 토큰 부분일치 휴리스틱(구분자 토큰화·길이≥2·소문자). 반환 `{drug_id:토큰}`. ⚠️ 클래스 매칭 불가(페니실린 ⊄ 아목시실린)·구조화 알레르겐 없음(0009 자유텍스트). 웹 `order-safety.ts allergyMatch` 거울 |
| `insert_prescription` 알레르기 체크 | 함수(`core/db` 확장) | 발행 시 환자 allergies 조회 + drug 배열 대조 → conflict 라인에 사유 없으면 `AppError(409, allergy_conflict, detail.conflicts)`, 있으면 통과 + 사유 INSERT(감사). 서버=권위·재검증(클라 1차선) |
| `POST /encounters/{id}/prescriptions` 409 | 계약 | `allergy_conflict`(409) = 알레르기 매칭 + `allergy_override_reason` 미입력. 사유 입력 시 발행+감사. 동일성분 중복(FR-052)은 별도 클라 비차단 경고 |
| `coverage_type`·`ordered_by_name`·`performed_by_name` | 응답 필드 | 오더 3종 응답에 `coverage_type`(pay-chip)·users 조인 이름(추적 라인). 처방=`ordered_by_name`만(수행자 컬럼 없음). ⚠️ `allergy_override_reason` 은 응답 미노출(쓰기·감사 전용) |
| `order-panel.tsx` | 웹(신규·오케스트레이터) | UX-DR13 탭 통합(처방/검사/영상/처치+카운트). 4종 데이터 **리프트**(병렬 로드·단일 진실) → controlled 자식 패널에 주입. 수가 자동 산정 프리뷰("자동 산정" 마커·급여/비급여 소계)·누락 0 디텍터 배너. 검사·영상=한 테이블 두 탭(`exam_type` 분할) |
| `order-item-meta.tsx` | 웹(신규) | 공유 표시 조각 — `PayChip`(급여/비급여 색+라벨)·`TrackingLine`(지시자·수행자, UX-DR21⑦)·`OverdueBadge`(지연 N분, UX-DR21⑥). 음영 비의존(UX-DR20) |
| `order-safety.ts` | 웹(신규·순수) | `allergyMatch`/`allergyTokens`(서버 거울)·`isOverdue`/`elapsedMinutes`(임계 `OVERDUE_THRESHOLD_MIN=30`·ordered 상태만)·`feePreview`(급여/비급여 소계·**처방 제외**=약가 없음)·`coverageLabel` |
| `prescription/examination/treatment-panel.tsx` | 웹(리팩터) | self-load → **controlled**(데이터+reload prop). 처방 패널=알레르기 오버라이드 UI(danger 경고+사유 입력·발행 게이트). 검사 패널=`exam_type` 토글 제거(탭이 examType 결정) |

> **오더 패널 통합 경계(Story 5.5 확정):** **신규 마이그 1건(0016=컬럼 2개)·신규 권한 0**(알레르기 오버라이드도 `prescription.create` 범위). **정직한 한계**: 알레르기=자유텍스트 → 직접 토큰 매칭만(클래스 매칭 불가)·실제 약물상호작용 DB 없음("활성 투약 상호작용"=FR-052 동일성분 surface)·약가 없음(처방 pay-chip 분류만·프리뷰 금액 제외). **표시 전용**: 수가 프리뷰·pay-chip = 분류·근사 표시, **수가 자동발생(수납상세 적재)·본인부담 산정=5.10/Epic7**. **누락 0 디텍터**=진료 허브 오더 패널만(워크리스트 측 인디케이터=5.7 간호/5.8 방사선·UI 미존재). 알레르기 체크=약품 처방만(검사·영상·처치 act 알레르겐 데이터 없음).

## 간호 활력징후 (Story 5.6, `0017_nursing.sql`)

> ⚠️ **마이그 번호 0017**: Epic 5 블록 0015~0029 의 세 번째(5.1=0015·5.5=0016). 에픽/아키 stale `0010_nursing` — 실제 0017(0017~0029 갭 사용·Epic 6 워크트리 0030~ 비침범). **신규 권한 0**(`vital.record`=0002 기존·admin 보유 → admin 재grant 불요·5.2 posture). **vital_signs 만**(일상 간호기록 `nursing_record`·처치 수행 = 5.7).

| 식별자 | 종류 | 비고 |
|---|---|---|
| `vital_signs` | 테이블(0017) | 활력징후 전용 기록(한 내원 N건·매 측정 새 행 append). `encounter_id` FK(1:N)·`systolic`/`diastolic`(혈압)·`pulse`(맥박)·`body_temp` numeric(4,1)(체온)·`respiratory_rate`(호흡수)·`spo2`(SpO2) **전부 nullable(부분 측정)**·`notes` text(PII 금지)·`recorded_by` FK(기록 간호사)·`recorded_at`. examinations(0015) DDL 미러. 수정/삭제·시계열 차트 = 이월 |
| `vital_signs_at_least_one` | CHECK(0017) | 6 측정값 중 **최소 1개 not null** 강제(빈 활력 행 차단 — DB 최종선). 클라 `hasAnyVital`(1차선)·서버 `VitalSignsCreate.model_validator`(2차선·422)·DB CHECK(최종선) 3중. 범위 CHECK(systolic 50~300 등)=물리 안전망(임상 정상범위 ≠ DB 한계) |
| `vital_signs_select_staff`/`_self` | RLS(0017) | 직원=`has_permission('encounter.read') OR has_permission('vital.record')`(의사 허브 ∨ 간호 기록자)·환자=본인 내원(encounter→patient→auth_uid). ⚠️ **방어심층** — FastAPI=service_role 가 RLS 우회·조회 권위=라우터; 본 정책은 환자 포털 Supabase 직결(Epic 8) 대비 |
| `vital.record` | 권한(0002 기존) | 활력 기록 게이트(간호 직무). 0017 신규 아님 → **nurse seed grant 1건만**(`seed.sql`·5.6)·admin 재grant 불요. **활력 기록 403 baseline = reception(권한 0) + doctor(encounter.read 有·vital.record 無 = read-yes/record-no)**. nurse 의 encounter.read 0(4.4/4.5 baseline)은 유지 — 비중첩 무영향 |
| `require_any_permission(*codes)` | 의존성(0017 신규·`core/security.py`) | `require_permission` 의 **OR 변형**(codes 중 하나라도 보유 시 통과·short-circuit). 첫 소비처=활력 조회(의사 encounter.read ∨ 간호 vital.record — 둘은 공통 권한 0). RLS `vital_signs_select_staff` 가 동일 OR 거울 |
| `POST …/encounters/{id}/vitals` | 엔드포인트(api·`nursing`·201) | 활력 기록(FR-091). 게이트 `vital.record`. recorded_by=토큰 주체·recorded_at=now(). 미존재 내원 404·빈 활력/범위 422(Pydantic·DB CHECK 백스톱)·권한 403. service_role 직접 INSERT(`_require_vital_record` TOCTOU·내원 선검사). body_temp=Decimal 변환(orders.dose 선례) |
| `GET …/encounters/{id}/vitals` | 엔드포인트(api·`nursing`) | 한 내원 활력 목록(최신순·users 조인 `recorded_by_name`). 게이트 `require_any_permission("encounter.read","vital.record")`(의사 진료 허브 FR-032 ∨ 간호 read-back). 직접 배열 |
| `GET …/nursing/vitals-worklist` | 엔드포인트(api·`nursing`) | 활력 워크리스트(AC3) — 오늘(KST) 활성 내원(registered·in_progress) + patients·departments 조인 + `latest_vital_recorded_at`(상관 서브쿼리·미측정 신호). 게이트 `vital.record`(간호 진입). 비-PII 투영(resident_no 제외). ⚠️ **`/nursing/*` 네임스페이스**(`/encounters/vitals-worklist` 는 `GET /encounters/{encounter_id}`[encounters.py:125·먼저 등록]에 흡수되어 422 → `/encounters/*` 밖에 둔다·nursing 라우터 prefix 없음) |
| `VitalSigns`·`VitalsDisplay`·`isAbnormal` | 웹(`lib/encounters/vitals.ts`·`components/encounters/`) | 활력 타입(snake_case 거울)·읽기전용 표시(최신 1건·혈압 합산·`isAbnormal` 정상범위 밖 danger 강조 — 표시 전용·능동 경고 아님). `patient-context-panel` 활력 카드가 빈-상태→실데이터(FR-032). 입력은 간호 전용 |
| `(staff)/nurse/vitals`·`VitalsWorklistPage`·`VitalsInputForm` | 웹(`app/(staff)/`·`components/nurse/`) | 활력 입력 화면(AC1·AC3). 서버 가드 `requirePermission('vital.record')`. 워크리스트(좌)→선택 내원 기존 활력+입력 폼(우). 폼=6 항목 number(선택)·`hasAnyVital` 가드·busy disable(이중 제출)·비정상 aria-invalid·toast. nav "활력징후 입력"=nurse 역할 노출(기정의). 5.7 처치 워크리스트가 이 진입 확장 |
| nurse → `vital.record` | seed grant(`seed.sql`) | 활력 기록 권한(간호 직무·rbac-ui-exposure-model). DEV/데모 전용(운영=1.7 매트릭스). 데모 활력 시드 없음(통합 테스트가 walk-in 후 인라인 기록 커버) |

> **간호 활력징후 경계(Story 5.6 확정):** **신규 마이그 1건(0017=vital_signs)·신규 권한 0**(`vital.record`=0002 기존·nurse seed grant 만). 활력=항목별 선택+최소 1개 강제(3중 방어). 기록=간호(`/nurse/vitals` 워크리스트 진입·encounter.read 0 유지)·조회=의사 진료 허브 좌 패널(FR-032·`require_any_permission`). 워크리스트=`/nursing/*`(라우트 충돌 회피). 수치=구조화 → **감사 마스킹 집합 무변경**. **일상 간호기록 `nursing_record`·처치 수행·재수행 차단 = 5.7 / 활력 수정·삭제·시계열 차트·오더-by-내원상태 게이트·환자 포털 활력 조회(RLS self 미연결) = 이월.**

## 간호 처치 수행 · 일상 간호기록 (Story 5.7, `0018_nursing_records.sql`)

> ⚠️ **마이그 번호 0018**: Epic 5 블록 0015~0029 의 네 번째(5.1=0015·5.5=0016·5.6=0017). **처치 수행 엔진은 0015 가 완비**(`perform_treatment_order` RPC·전이 트리거·`treatment_orders`·`treatment.perform`) → 0018 = 소비만 + `nursing_record` 테이블·신규 권한 `nursing.record`. **재수행 차단은 RPC 소스상태 precondition**(이미 5.1 구현). content=자유 임상 서사 → 감사 마스킹 동반 확장.

| 식별자 | 종류 | 비고 |
|---|---|---|
| `nursing_record` | 테이블(0018) | 간호기록 — `encounter_id` FK(1:N)·`treatment_order_id` FK **nullable**(처치 수행 연결 / NULL=일상 기록 FR-094)·`content` text(자유 임상 서사·감사 마스킹)·`recorded_by` FK·`recorded_at`. vital_signs(0017) DDL 미러. 처치 수행 내용·일상 간호기록을 단일 테이블이 담음(treatment_orders 엔 내용 컬럼 없음) |
| `nursing_record_content_not_blank` | CHECK(0018) | `char_length(btrim(content)) >= 1` — 빈/공백 내용 차단(DB 최종선). 클라 가드(1차)·서버 `NursingRecordCreate` min_length(2차·422)·DB CHECK(최종) 3중 |
| `nursing_record_select_staff`/`_self` | RLS(0018) | 직원=`has_permission('order.read') OR has_permission('nursing.record')`·환자=본인 내원. **방어심층**(FastAPI service_role RLS 우회·권위=라우터·환자 포털 Epic 8 대비). vital_signs RLS 미러 |
| `nursing.record` | 권한(**0018 신규**) | 일상 간호기록 게이트(간호 직무·0002:76 nurse='처치·활력·간호기록'). **0002 미존재 → INSERT + admin 부트 재grant 필수**(test_admin_role_has_all_permissions 회귀 회피·0015 패턴). nurse seed grant 1건. ⚠️ 0017 vital.record(기존·신규 0)와 다른 점 |
| `treatment.perform` | 권한(0002 기존) | 처치 수행 게이트 — **nurse 가 이미 보유**(seed.sql:178·Story 5.1 grant). 0018 신규 아님·admin 재grant 불요. `perform_treatment_order` RPC 가 자가 게이트. **처치 수행 403 baseline = reception(권한 0) + doctor(treatment.order 有·treatment.perform 無 = order-yes/perform-no, 처치 오더 baseline 역전)** |
| `perform_treatment_order(uuid)` | RPC(0015·소비) | 처치 수행 전진 전이(ordered→performed) — 권한 자가 게이트·`for update`·**소스상태 precondition(재수행 차단 FR-093)**·performed_by/at=auth.uid()/now(). not-found PT404·재수행 PT409→409 invalid_transition. `call_perform_treatment_order`(db) 가 경로 선검사(404)+RPC+content 연결 nursing_record 를 동일 txn 에 |
| `POST …/treatment-orders/{oid}/perform` | 엔드포인트(api·`nursing`) | 처치 수행(FR-090·FR-092). 게이트 `treatment.perform`. body `TreatmentPerformBody`(content 선택). 재수행→409·미존재→404·권한→403. content 입력 시 연결 `nursing_record`(treatment_order_id 부착) 같은 액션 생성. 응답=갱신 `TreatmentOrderResponse`(performed_*) |
| `POST …/encounters/{id}/nursing-records` | 엔드포인트(api·`nursing`·201) | 일상 간호기록(FR-094). 게이트 `nursing.record`. treatment_order_id=NULL 고정(오더 연결은 수행 액션 소유). 빈/공백 422·미존재 404·권한 403. recorded_by=토큰 주체 |
| `GET …/encounters/{id}/nursing-records` | 엔드포인트(api·`nursing`) | 한 내원 간호기록 목록(최신순·users 조인). 게이트 `require_any_permission("order.read","nursing.record")`(의사·간호 ∨ 간호). 처치 수행 연결+일상 기록 모두. 직접 배열 |
| `GET …/nursing/worklist` | 엔드포인트(api·`nursing`) | 간호 워크리스트(FR-090) — 오늘(KST) 활성 내원 + `pending_treatment_count`(미수행 ordered)·`oldest_pending_ordered_at`(지연 디텍터 UX-DR21 ⑥)·`nursing_record_count`. 게이트 `require_any("treatment.perform","nursing.record")`. 처치 워크리스트·간호기록 두 화면 공유. 비-PII·`/nursing/*` 네임스페이스 |
| `content` 감사 마스킹 | audit.py·audit.ts | nursing_record.content=자유 임상 서사 → `_SENSITIVE_KEY`(서버 권위)·`SENSITIVE_KEY`(웹 거울) 양쪽 `content` 추가(드리프트 금지). 0017 활력 수치(구조화)는 무변경이었으나 5.7 자유텍스트는 변경 |
| `(staff)/nurse/worklist`·`TreatmentWorklistPage`·`TreatmentPerformPanel` | 웹(`app/(staff)/`·`components/nurse/`) | 처치 워크리스트(AC1·AC2). 가드 `requirePermission('treatment.perform')`. 좌=미수행 처치 보유 내원(pending>0·지연 배지)·우=오더별 수행(ordered=폼+content 선택·busy disable / performed=잠금 "수행 완료"·추적 라인 UX-DR21 ⑤⑦). 409→토스트+재로드. nav "처치 워크리스트"(`/nurse/worklist`·기정의) |
| `(staff)/nurse/notes`·`NursingNotesPage` | 웹(`app/(staff)/`·`components/nurse/`) | 일상 간호기록(AC3). 가드 `requirePermission('nursing.record')`. 좌=오늘 활성 내원 전체(간호기록 건수)·우=기록 작성 폼(content 필수·빈값 가드·busy·toast)+기록 목록(처치 연결 태그). nav "간호기록"(`/nurse/notes`·기정의) |
| nurse → `nursing.record` | seed grant(`seed.sql`) | 일상 간호기록 권한(간호 직무). DEV/데모 전용(운영=1.7 매트릭스). treatment.perform 은 5.1 에서 기grant → 본 스토리 nurse grant=nursing.record 1건 |

> **간호 처치 수행·간호기록 경계(Story 5.7 확정):** **신규 마이그 1건(0018=nursing_record + 권한 nursing.record)·신규 권한 1**(처치 수행=treatment.perform 기존, 일상 간호기록=nursing.record 신규·admin 재grant·nurse grant). 처치 수행=`perform_treatment_order` RPC(0015 기완비) 소비 — 재수행 차단=소스상태 precondition(409). content(처치기록 내용)=수행 시 선택 입력→연결 nursing_record. 워크리스트=encounter-centric(`/nursing/worklist` 공유·5.6 미러). **재수행 차단 임상 해석**: 동일 *오더* 재수행만 차단(반복 처치=의사 신규 오더). **이월**: 처치 `completed` 전이·`complete_treatment_order` RPC·수가 자동발생(5.10/Epic7)·오더-by-내원상태 게이트(완료/취소 내원)·same-status attribution 덮어쓰기(RPC 경로만 보호)·간호기록 수정/삭제(append-only)·의사 허브 간호기록 표시·환자 포털 간호기록(RLS self 미연결).

## 방사선 촬영 · 영상 업로드 · 장비 (Story 5.8, `0019_examination_imaging.sql`)

> ⚠️ **마이그 번호 0019**: Epic 5 블록 0015~0029 의 다섯 번째(5.1=0015·5.5=0016·5.6=0017·5.7=0018). **촬영 수행 엔진은 0015 가 완비**(`perform_examination` RPC·전이 트리거·`examinations.equipment_id`/`performed_*` 컬럼·`examination.perform`/`order.read` 권한·radiologist seed grant) → 0019 = 소비만 + `examination_images` 1:N 테이블 + Storage 버킷. **신규 권한 0·admin 재grant 불요**(5.3 posture). 영상자료 = Supabase Storage(비공개 버킷) + 서명 URL·**DB 엔 경로만**(architecture.md:217).

| 식별자 | 종류 | 비고 |
|---|---|---|
| `examination_images` | 테이블(0019) | 촬영 영상 — `examination_id` FK(1:N·한 영상검사 N장)·`storage_path` text(비공개 버킷 객체 경로·서명 URL 아님·🔒 PII 금지)·`content_type`·`file_size`·`uploaded_by` FK·`uploaded_at`·`is_active`. 자유 서사 컬럼 없음 → **감사 마스킹 무변경**(판독 소견 텍스트는 5.9) |
| `examination_images_select_staff`/`_self` | RLS(0019) | 직원=`has_permission('order.read')`·환자=본인 내원(image→examination→encounter→patient→auth_uid). **방어심층**(FastAPI service_role 우회·권위=라우터). nursing_record RLS 미러 + examinations 한 단계 |
| `examination-images` | Storage 버킷(0019·`storage.buckets` insert) | **비공개**(public=false)·`file_size_limit` 50MiB·`allowed_mime_types` image/png·jpeg·webp. 접근 = service_role 서명 URL 전용(storage.objects 정책 부여 안 함·deny-by-default·서명 URL=RLS 우회). 마이그 인라인(architecture.md:326 의 `storage.sql` 대신·단일 소스 재현성). ⚠️ db reset 후 Storage 게이트웨이(Kong) 준비 대기 필요 |
| `perform_examination(uuid)` | RPC(0015·소비) | 촬영 전진 전이(ordered→performed) — 권한 자가 게이트·`for update`·**소스상태 precondition(재수행 차단 FR-093)**·performed_by/at=auth.uid()/now(). `call_perform_examination`(db) 가 검사 선검사(404/422 not_imaging/409)+**영상≥1 검사(422 image_required)**+장비 검증·same-status UPDATE 배정(422 invalid_equipment)+RPC 를 동일 txn 에. **RPC 재정의 안 함**(equipment_id=wrapper UPDATE·0015 전이 트리거 same-status 통과) |
| `examination.perform`/`order.read` | 권한(0015 기존) | 촬영 수행·업로드·워크리스트=examination.perform(방사선·간호)·영상/장비 조회=order.read(의사 판독 5.9·간호·방사선). **신규 0·admin 재grant 불요**. radiologist seed grant(`order.read`·`examination.perform`)=5.1 기보유 |
| `GET …/radiology/worklist` | 엔드포인트(api·`radiology`) | 촬영 워크리스트(FR-100) — 오늘(KST) 활성 내원의 `exam_type='imaging' AND status='ordered'` + `fee_name`·`image_count`(상관 서브쿼리)·지시자/시각. 게이트 `examination.perform`. FIFO(ordered_at asc)·비-PII·`/radiology/*` 네임스페이스(/encounters/{id} 흡수 회피) |
| `POST …/examinations/{id}/images` | 엔드포인트(api·`radiology`·201) | 영상 업로드(FR-101·multipart `file`) — Storage 저장 + `examination_images` 경로 연결. 게이트 `examination.perform`. 잘못된 MIME/용량 422·lab 422 not_imaging·이미 수행 409 examination_locked·미존재 404. 응답=메타+`signed_url`(`storage_path` 비노출) |
| `GET …/examinations/{id}/images` | 엔드포인트(api·`radiology`) | 영상 목록+서명 URL(FR-101). 게이트 **`order.read`**(5.9 판독 의사 재사용·examination.perform 아님). 서명 URL=조회 시점 재생성. 직접 배열 |
| `POST …/examinations/{id}/perform` | 엔드포인트(api·`radiology`) | 촬영 수행(FR-101·FR-093). 게이트 `examination.perform`. body `PerformExaminationBody`(equipment_id 선택). 영상 0장→422 image_required·재수행→409 invalid_transition·미존재 404·잘못된 장비 422. 응답=갱신 `ExaminationResponse`(performed_*·equipment_id) |
| `GET …/equipment` | 엔드포인트(api·`radiology`) | 장비 목록·상태(FR-103) — 활성 장비(코드순). 게이트 `order.read`. 읽기 전용(상태 변경 5.8 범위 밖). 직접 배열 |
| `upload_object`/`create_signed_url` | 함수(`core/storage.py`) | Storage 래퍼 — `supabase_admin._get_admin_client()`(service_role) 싱글톤 **재사용**·동기 storage3 → `anyio.to_thread` 오프로드(supabase_admin 선례). `SIGNED_URL_TTL_SECONDS=300`(5분). 미설정 secret 키→503 |
| `fetch_radiology_worklist`/`fetch_equipment`/`insert_examination_image`/`fetch_examination_images`/`call_perform_examination` | 함수(`core/db`) | service_role(RLS 우회). 업로드=서비스가 Storage 선행 후 경로 INSERT. 수행=영상≥1·장비·RPC 동일 txn. `_EXAMINATION_IMAGE_COLUMNS`/`_FROM` users 조인 |
| `(staff)/radiology/{worklist,upload,equipment}`·`RadiologyWorklistPage`·`CapturePanel`·`EquipmentList`·`lib/radiology/imaging.ts` | 웹(`app/(staff)/`·`components/radiology/`) | 가드 `requirePermission('examination.perform')`. 워크리스트(좌 미수행 영상검사·우 캡처 패널)·캡처(파일 업로드 멀티파트·서명 URL 썸네일·장비 select·수행 버튼[영상 0장 disabled])·장비 목록(읽기 전용 테이블). nav radiologist 역할 노출(기정의). `/upload`=워크리스트 surface 재사용 |
| `apiFetch` FormData 분기 | `lib/api/client.ts` | `init.body instanceof FormData` 면 Content-Type JSON 강제 건너뜀(브라우저 multipart boundary 설정) — 멀티파트 업로드 필수. 기존 JSON 호출 무영향 |
| EMP0005 radiologist 데모 | seed(`seed.sql`) | `radiologist@pms.local`(Staff1234)·`order.read`·`examination.perform` 보유 → 촬영 골든 패스. **촬영 수행 403 baseline = reception(권한 0) + doctor(examination.order 有·examination.perform 無)** |

> **방사선 촬영 경계(Story 5.8 확정):** **신규 마이그 1건(0019=examination_images + Storage 버킷)·신규 권한 0**(examination.perform·order.read 모두 0015 기존·radiologist 5.1 grant). **결정 3건**: ① 영상=1:N `examination_images`(단일 컬럼 아님·검사당 N장) ② 장비=표시+촬영 배정만(상태 변경·`equipment.manage` 권한 없음 — AC3=표시) ③ 수행 전제=활성 영상≥1(422 image_required·누락 0 디텍터 정신). Storage=비공개 버킷+서버 서명 URL·DB 경로만·🔒 객체 경로 PII 금지. perform_examination RPC 재정의 안 함(equipment_id=same-status UPDATE). **배포**: `SUPABASE_URL` = api 환경(.env.example·docker-compose) 보강 완료(클라우드 서명 URL 호스트). **이월**: 판독 소견 컬럼·`complete_examination`·검사 오더 완료 전이=5.9 / 수가 자동발생(영상 수행 완료→수가)=5.10 / 장비 상태 변경·영상 삭제·환자 포털 영상 조회(RLS self 미연결)=이월.

## 근무표 · 휴진 (Story 6.1, `0030_doctor_schedules.sql`)

> ⚠️ **마이그 번호 0030**: Epic 6 = 병렬 worktree → 마이그 블록 0030~(main 0014/Epic5 0015~0029 와 충돌 회피). 에픽/아키 묶음 계획 `0011_scheduling.sql`(3테이블)을 **스토리별 분리**(4.6/4.7 선례) → 6.1 = 근무표·휴진 2테이블만, **예약(appointments)·예약 생성·`encounters.reservation_id` FK·더블부킹은 booking 스토리(6.2/6.3)** 소유.

| 식별자 | 종류 | 비고 |
|---|---|---|
| `doctor_schedules` | 테이블(0030) | 의사 주간 근무표 — `doctor_id`(users FK)·`department_id`(departments FK)·`room_id`(rooms FK, nullable)·`weekday`(smallint CHECK 0–6, **PG `extract(dow)` 정합: 0=일**)·`start_time`/`end_time`(time, CHECK start<end)·`is_active`. 비-PII/비-건강민감 → 감사 마스킹 불요 |
| `doctor_time_offs` | 테이블(0030) | 휴진/예외 — `doctor_id`(users FK)·`start_at`/`end_at`(timestamptz, CHECK start<end)·`reason`(저민감 운영 사유, **임상/PII 자유텍스트 금지**=cancel_reason 정합)·`is_active`. 겹침 제약 없음(중첩 휴진 무해) |
| `doctor_schedules_no_overlap` | EXCLUDE 제약(btree_gist) | 같은 `doctor_id`·`weekday`의 활성 시간블록 겹침 차단 — `tsrange(date+start, date+end) &&`(내장 timerange 부재 → date-anchored). `where (is_active)` 부분 제약(비활성 무시·재활성도 발화). 위반 23P01 → 409 `schedule_overlap` |
| `master.manage` | 권한(재사용) | 근무표·휴진 쓰기 게이트 — **신규 권한 아님**(0002 기존·admin cross-join 보유). 진료과·진료실 masters 동형(관리자 관리 config). 읽기=전 직원 authenticated SELECT(슬롯 계산·예약). **schedule.* 신설·admin 부트 grant 재실행 없음** → `test_admin_role_has_all_permissions` 무영향 |
| `schedule_overlap`(409) / `invalid_doctor`·`inactive_doctor`·`invalid_room`·`inactive_room`(422) | 도메인 에러코드 | 겹침(EXCLUDE 23P01 서비스 catch, `code_taken` 패턴) / FK 대상 검증(`_assert_doctor_assignable`=role=doctor·active, `_assert_room_assignable`, `_assert_department_assignable` 재사용). **`_map_pg_sqlstate` 변경 없음**(서비스 레이어 catch) |
| `POST·PATCH·PATCH/active /v1/scheduling/doctor-schedules` | 엔드포인트 | 근무표 생성·수정(전 필드 교체)·비활성(soft delete). 게이트 `master.manage`. 겹침 409·미존재 404·FK 422 |
| `POST·PATCH·PATCH/active /v1/scheduling/doctor-time-offs` | 엔드포인트 | 휴진·예외 생성·수정(기간·사유, doctor 불변)·비활성. 게이트 `master.manage` |
| `GET /v1/scheduling/doctors` | 엔드포인트 | 근무표 폼 의사 피커용 재직 의사(`{id,name,department_id}`) — users RLS(본인행) 우회 service_role read(`count_department_dependents` 동형). 게이트 `master.manage` |
| `DoctorSchedule*`·`DoctorTimeOff*`·`SchedulingDoctor` | 스키마(Pydantic)·웹 타입 | 응답·요청 거울(snake_case). `ActiveUpdate`(schemas.masters) 재사용. web `lib/admin/schedule.ts` |
| `insert/update/set_*_active_doctor_schedule`·`_doctor_time_off`·`fetch_active_doctors` | db 래퍼(`core/db.py`) | service_role 직접 INSERT/UPDATE(masters insert_room 패턴·`_require_master_manage` TOCTOU·FK 활성 검증·EXCLUDE/FK catch) |
| `ScheduleManager`·`DoctorScheduleForm`·`DoctorTimeOffForm`·`schedule.ts` | 웹(`components/admin/`·`lib/admin/`) | 근무표·휴진 탭 관리(masters-manager 미러: useState·apiFetch 쓰기·pendingIds·ConfirmDialog·부분 강등) / RHF+Zod+Base UI 폼 / 라우트 `/admin/schedule`(nav `requiredPermission: master.manage`). **의사 목록은 마운트 시 클라 apiFetch**(users RLS → RSC 직접조회 불가, StaffDirectory 패턴) |
| doctor → 데모 근무표·휴진 | seed(`seed.sql`) | 데모 의사(EMP0002) 월–금 오전/오후 근무 + 미래 학회 휴진(파일 최하단·FK 순서·멱등·db reset 전용) |

> **근무 스케줄 경계(Story 6.1 확정):** 근무표·휴진 = 관리자 관리 config(masters 동형·`master.manage` 재사용·전 직원 읽기). 겹침 불변식 = **DB EXCLUDE**(btree_gist·`tsrange` 관용구·`where(is_active)` 부분 제약) → 409 `schedule_overlap`(서비스 catch, `_map_pg_sqlstate` 무변경). 컬럼 비-PII/비-건강민감 → **감사 마스킹 집합 무변경**(0006/0010 동일). **appointments(예약 본체)·동적 슬롯 계산(근무−예외−기예약, FR-012)·더블부킹·SMS·노쇼·휴진 재배정 = 6.2~6.8**. `weekday`=PG dow(0=일) — 6.2 슬롯 계산이 예약일 dow 로 근무 전개.

## 예약 본체 · 동적 가용 슬롯 (Story 6.2, `0031_appointments.sql`)

> ⚠️ **마이그 번호 0031**: Epic 6 블록 0030~ 의 두 번째 조각(6.1 이 이월한 "appointments 소유 결정" = 6.2). 6.1 묶음 계획(`0011_scheduling.sql` 3테이블)을 스토리별 분리 → 0031 = 예약 본체 + 더블부킹 EXCLUDE + `encounters.reservation_id` FK 청산. **예약 쓰기(생성/변경/취소)·전이 트리거·캘린더·booking-peek·더블부킹 409 인라인 = 6.3/6.4**. 본 스토리 = 스키마 + 슬롯 계산(읽기).

| 식별자 | 종류 | 비고 |
|---|---|---|
| `appointment` | 용어 | 예약 — 슬롯 기반 의사 예약. `encounter`(내원)와 별개; 예약 환자 도착 접수 시 내원이 `reservation_id` 로 원 예약을 가리킨다(6.3/6.4 배선) |
| `appointments` | 테이블(0031) | 예약 본체 — `patient_id`(patients FK)·`doctor_id`(users FK)·`department_id`(departments FK)·`room_id`(rooms FK, nullable)·`scheduled_start`/`scheduled_end`(timestamptz UTC, CHECK start<end)·`status`(text CHECK)·`created_by`·`created_at`/`updated_at`. ⚠️ **`is_active` 없음**(encounters 형 트랜잭션 레코드 — soft-delete/취소=`status='cancelled'`, 0030 config 모델과 다름). 자유텍스트/PII 컬럼 0(메모는 6.3 추가 시 마스킹 검토) |
| `appointment_status` | 값 어휘(CHECK) | `booked`(예약·활성·기본)·`cancelled`(취소)·`no_show`(미방문)·`completed`(도착·진료완료). **전 도메인 0031 정의**(미래 CHECK ALTER 회피). **6.2 는 `booked` 만 쓰기/읽기**(슬롯 차감); 전이(booked→cancelled/no_show/completed)·no_show 진실원(appointment vs encounter)=6.3/6.4/6.7 |
| `appointments_no_double_booking` | EXCLUDE 제약(btree_gist) | 같은 `doctor_id`·시간 겹치는 활성(`status='booked'`) 예약 차단 — `tstzrange(scheduled_start, scheduled_end, '[)') &&`(반열림=인접 비겹침). `where (status='booked')` 부분 제약(취소·노쇼·완료는 슬롯 미차단·재예약 가능). 위반 23P01 → **6.3 예약 쓰기가 409 `double_booking`** 표면화(6.2 는 seed/test 직접 INSERT 로 발화 검증). btree_gist=0030 설치 재사용 |
| `encounters.reservation_id` | 컬럼(FK, 0031 ALTER) | 내원 → 원 예약 링크(nullable·walk-in=NULL). 0010:54 "Epic 6 ALTER" 이월 청산. **컬럼 추가만** — 읽기/쓰기 배선·`_ENCOUNTER_COLUMNS`/`EncounterResponse` 반영=6.3/6.4(기존 내원 경로 무영향·누설 없음) |
| `appointment.read` | 권한(0031 신규) | 슬롯·예약 조회 게이트(원무·관리자 — 의사·환자는 6.4/6.5 grant). **admin 부트 grant 재실행**(test_admin_role_has_all_permissions 회귀 회피). **appointment 403 baseline = nurse**(미보유). RLS: 직원=appointment.read 전체 SELECT·환자=본인 예약(patient_id→auth_uid) |
| `SlotStatus` / `Slot` / `SlotGridResponse` | 스키마(Pydantic)·웹 타입 | 슬롯 상태 `available`(선택가능)·`booked`(마감)·`time_off`(휴진)·`past`(지남). 슬롯 `{start,end(timestamptz UTC),status}`. 그리드 `{doctor_id,date,slot_minutes,slots[]}`. web `lib/scheduling/slots.ts` 거울(snake_case) |
| `GET /v1/scheduling/slots?doctor_id&date` | 엔드포인트 | 의사·날짜(KST)의 가용 슬롯 = 근무−휴진−booked예약(FR-012). 게이트 `appointment.read`. 비활성/미존재 의사 → 빈 슬롯(404 아님). FastAPI service_role 계산(가용성만·환자 PII 미반환) |
| `GET /v1/scheduling/bookable-doctors?department_id` | 엔드포인트 | 예약 피커용 재직 의사(`{id,name,department_id}`·dept 필터 옵션). 게이트 `appointment.read`(기존 `/doctors` 는 master.manage admin 전용이라 원무·예약 흐름엔 본 엔드포인트) |
| `compute_available_slots`·`_build_slots`(순수)·`SLOT_MINUTES=30`·`_KST` | 서비스(`services/scheduling.py`) | 슬롯 계산 = 순수 `_build_slots`(DB 무관·단위 테스트) + 얇은 DB 래퍼. KST=고정 +9(무 DST). `pg_dow=isoweekday()%7`(0=일). 슬롯 status 우선순위 past>time_off>booked>available |
| `fetch_doctor_schedules_for_weekday`·`fetch_doctor_time_offs_in_range`·`fetch_booked_appointments_in_range`·`fetch_bookable_doctors` | db 래퍼(`core/db.py`) | 슬롯 계산 service_role 읽기(RLS 우회·`fetch_active_doctors` 패턴). **active 의사 조인 필터**(employment_status='active'·role='doctor') = 6.1 이월 "스케줄 employment 재검증" 흡수 |
| `SlotGrid`·`slots.ts`·`/reception/schedule` | 웹(`components/scheduling/`·`lib/scheduling/`) | 슬롯 그리드(4상태·음영 비의존·읽기전용·선택=6.3) / apiFetch / 라우트 `/reception/schedule`("예약 관리" nav 기존·역할 노출). 진료과→의사→날짜→슬롯 |

> **동적 슬롯 경계(Story 6.2 확정):** `appointments` = encounters 형 트랜잭션 레코드(status 만·`is_active` 없음). 더블부킹·슬롯 차감 불변식 = **DB(EXCLUDE)·service_role 읽기**. 슬롯 계산 = `근무 − 휴진 − booked예약`(FastAPI 순수 함수·KST). 컬럼 비-PII/비-건강민감 → **감사 마스킹 집합 무변경**(0010/0014/0015 동일·메모 컬럼 추가 시 6.3 재검토). **예약 쓰기(생성/변경/취소)·전이 트리거·캘린더·booking-peek·더블부킹 409 = 6.3/6.4 · 환자 앱 슬롯·부서별 집계 = 6.5 · SMS = 6.6 · 노쇼 카운트 = 6.7 · 휴진 재배정 = 6.8 · 진료실 자원충돌·슬롯 길이 가변·점심 명시 상태 = 이월.**

## 예약 생성 · 캘린더 (Story 6.3, `0032_appointment_booking.sql`)

> ⚠️ **마이그 번호 0032**: Epic 6 블록 0030~ 의 세 번째(6.1=0030·6.2=0031). 0031(예약 본체·EXCLUDE) 위에 booking-peek 가 쓰는 컬럼 2종 + 생성 권한만 ALTER/추가. **예약 변경/취소/노쇼 전이·전이 트리거·`reservation_id`→내원 링크 = 6.4**(6.3 = 생성=초기상태 booked 만).

| 식별자 | 종류 | 비고 |
|---|---|---|
| `appointments.note` | 컬럼(text, 0032) | 예약 메모 — **저민감 운영 텍스트**(`cancel_reason`·`doctor_time_offs.reason` 정합·임상/PII 자유텍스트 금지). ⚠️ **감사 마스킹 불요**: 단수 `note` 는 `_SENSITIVE_KEY`/`SENSITIVE_KEY` 의 `notes`(복수) 미매칭 → 운영 텍스트라 의도된 무마스킹(6.2 가 예고한 "메모 마스킹 검토"의 결론; SOAP 자유 임상서사와 구분) |
| `appointments.sms_opt_in` | 컬럼(bool, 0032·기본 false) | 예약 확정 SMS 발송 동의(booking-peek 체크). **6.3 은 저장만** — 실 발송·notification_logs = 6.6 |
| `appointment.create` | 권한(0032 신규) | booking-peek 예약 저장 게이트(원무 — 환자는 6.5·매트릭스). `appointment.read`(조회)와 별개 최소권한. **admin 부트 grant 재실행**(회귀 회피)·reception seed grant. **appointment 403 baseline = nurse**(create·read 둘 다 미보유) |
| `double_booking`(409) | 도메인 에러코드 | 더블부킹 EXCLUDE(0031, 23P01) → 서비스 catch(`_double_booking_error`·0030 `schedule_overlap` 패턴)·`_map_pg_sqlstate` 무변경. 캘린더 booking-peek 인라인 경고 칩(FR-013) |
| `POST /v1/scheduling/appointments` | 엔드포인트 | 예약 생성(booked). 게이트 `appointment.create`. service_role 직접 INSERT(`insert_walk_in_encounter` 패턴·`_require_appointment_create` TOCTOU·환자/의사/진료과 active 선검사·EXCLUDE→409·FK→422). `scheduled_end`=start+30분(서버 계산) |
| `GET /v1/scheduling/calendar?department_id&date` | 엔드포인트 | 예약 캘린더(시간레일×의사 열·일 보기) = 가용 슬롯 + 예약 overlay(확정/완료/노쇼/취소+환자명). 게이트 `appointment.read`. staff(환자명 OK·대기 현황판 4.3 선례) |
| `Appointment(Create/Response)`·`CalendarSlot`·`DoctorColumn`·`CalendarResponse` | 스키마(Pydantic)·웹 타입 | 예약 요청/응답·캘린더 셀(`CalendarSlotStatus`=available/confirmed/completed/no_show/cancelled/time_off/past)·의사 열·일 캘린더. web `lib/scheduling/appointments.ts` |
| `create_appointment`·`_build_calendar`(순수)·`get_day_calendar` | 서비스(`services/scheduling.py`) | 생성(scheduled_end 계산) / 캘린더 합성(`_build_slots`[6.2] base + 예약 overlay·우선순위 confirmed>완료>노쇼>취소) / DB 래퍼(의사별 슬롯+예약 배치 조회) |
| `insert_appointment`·`_require_appointment_create`·`fetch_appointments_for_date`·`_APPOINTMENT_COLUMNS` | db 래퍼(`core/db.py`) | service_role 직접 INSERT·TOCTOU·active 선검사·EXCLUDE/FK catch / 캘린더 overlay 조회(환자명 조인·booked·cancelled·no_show·completed 전부) |
| `AppointmentCalendar`·`BookingPeek`·`appointments.ts`·`CALENDAR_STATUS_META` | 웹(`components/scheduling/`·`lib/scheduling/`) | 캘린더(시간레일×의사 열·점심 band·legend·음영 비의존 slot-block) / booking-peek(Base UI Dialog 우측 슬라이드오버·환자검색 3.5 재사용·409 인라인 칩·이중제출 락) / 라우트 `/reception/schedule`(SlotAvailability→AppointmentCalendar 교체) |
| reception → `appointment.create` | seed grant(`seed.sql`) | 예약 생성 권한(원무 대리 예약). 데모 예약 시드 없음(환자 미시드 — UI/테스트로 생성) |

> **예약 생성 경계(Story 6.3 확정):** 생성=service_role 직접 INSERT(booked)·더블부킹=DB EXCLUDE→409 표면화. `note`=운영 텍스트(마스킹 불요). 캘린더=순수 합성(슬롯+예약 overlay). **변경/취소/노쇼 전이·전이 트리거 `enforce_appointment_transition`·`reservation_id`→내원 링크·대기 흐름 반영·도착 접수 = 6.4 / 환자 앱 예약 = 6.5 / SMS 실 발송 = 6.6 / 노쇼 카운트 = 6.7.**

## 예약 변경 · 취소 · 도착 접수 (Story 6.4, `0033_appointment_lifecycle.sql`)

> ⚠️ **마이그 번호 0033**: Epic 6 블록 0030~ 의 네 번째(6.1=0030·6.2=0031·6.3=0032). 0031/0032(예약 본체·생성) 위에 **전이 상태머신**(트리거)·생명주기 타임스탬프·`appointment.update` 권한만 추가. **예약↔내원 모델 = Option A 확정**: `appointment.status` 가 예약 생명주기 단일 진실(내원은 도착 시점에만 생성).

| 식별자 | 종류 | 비고 |
|---|---|---|
| **예약↔내원 모델(Option A)** | 설계 결정 | `appointment.status`(booked→cancelled/no_show/completed)가 예약 생명주기 단일 진실. 내원은 **도착 접수 시점에만** 생성(`visit_type='reserved'`·`status='registered'`·`reservation_id`→예약). encounters 의 `scheduled` 초기상태·`register_encounter`(scheduled→registered)는 **reserved 경로 미사용**(예약 생성이 scheduled 내원을 만들지 않음 — 향후 정리 이월). 6.7 노쇼 카운트 = `appointment.no_show` 집계 |
| `enforce_appointment_transition` | 트리거(0033·BEFORE UPDATE) | 예약 전이 매트릭스 강제(`enforce_encounter_transition` 0010 미러). `booked → cancelled\|no_show\|completed` 만 허용·종결=이탈 전이 없음·same-status(시각 변경=reschedule 등) 통과. ⚠️ **BEFORE UPDATE 만**(INSERT 초기상태 가드 없음 — 6.3 `test_double_booking_adjacent_and_cancelled_allowed` 가 cancelled 직접 INSERT → 가드 추가 시 회귀; 초기상태는 0031 status CHECK + default 'booked' 담당). 위반 `PT409` → `_map_pg_sqlstate` → 409 `invalid_transition`(매핑 무변경) |
| `appointments.cancelled_at`·`no_show_at`·`completed_at` | 컬럼(timestamptz, 0033·nullable) | 전이 시각(encounters 미러·6.7 노쇼 카운트·감사 근거). 해당 전이 시에만 채워짐 |
| `appointments.cancel_reason` | 컬럼(text, 0033) | 취소·노쇼 저민감 운영 사유(`encounters.cancel_reason`·`note` 정합·임상/PII 금지). ⚠️ **감사 마스킹 불요**(단수 키 — `_SENSITIVE_KEY` 미매칭) |
| `appointment.update` | 권한(0033 신규) | 기존 예약 변경(cancel/no_show/reschedule/complete) 게이트(원무 — 환자는 매트릭스). create/read 와 별개 최소권한. **admin 부트 grant 재실행**·reception seed. **403 baseline = nurse**(appointment.* 전무). 도착접수의 내원 생성은 `encounter.register`(reception 보유, 4.2) |
| `POST …/appointments/{id}/cancel`·`/no-show` | 엔드포인트(액션·status PATCH 아님) | 취소(booked→cancelled)·노쇼(booked→no_show). 게이트 `appointment.update`. 미존재 404·잘못된 전이 409 `invalid_transition`. service_role 직접 UPDATE(`_require_appointment_update` TOCTOU·소스상태 precondition 선검사=재취소/재완료 차단·트리거 백스톱) |
| `POST …/appointments/{id}/reschedule` | 엔드포인트(액션) | 변경(새 의사·시각·status 불변 booked → 트리거 same-status 통과). 슬롯-윈도우 422 `slot_unavailable`·더블부킹 409 `double_booking`·잘못된 전이 409. `scheduled_end`=start+30분(서버) |
| `POST …/appointments/{id}/check-in` | 엔드포인트(액션·201) | 예약 환자 **도착 접수** — 단일 txn: reserved registered 내원 생성(`reservation_id` 연결·대기 현황판 4.3 진입) + 예약→completed. 게이트 `appointment.update`(+ 내원 생성 `encounter.register` TOCTOU). 반환=`EncounterResponse`. `insert_walk_in_encounter` 패턴 미러(visit_type='reserved') |
| `_assert_slot_bookable`(서비스) | 슬롯-윈도우 검증(6.3 이월 청산) | 생성·변경 시 `scheduled_start` 가 **실재 근무 슬롯**인지(available 또는 booked·`compute_available_slots` 재사용)만 검증 → 휴진·지난·근무외·비정렬 = 422 `slot_unavailable`. ⚠️ **이미 예약됨(booked)은 안 막음** — 더블부킹은 DB EXCLUDE 가 409 `double_booking` 처리(슬롯-윈도우가 booked 를 422 로 가로채면 더블부킹 409 경로 소실·6.3 AC3 보존). create 의 과거-거부(`appointment_in_past`)는 유지(빠른 구체 사유) |
| `cancel_appointment`·`mark_appointment_no_show`·`reschedule_appointment`·`check_in_reservation` | db 래퍼(`core/db.py`) | service_role UPDATE·`_require_appointment_update`·`_fetch_appointment_for_update`(for-update·404)·소스상태 precondition(409)·EXCLUDE/FK catch. check-in 은 reserved 내원 INSERT + 예약 completed |
| 캘린더 overlay 정련(6.4 AC2) | 동작 변경(`_build_doctor_column`) | **cancelled·no_show 는 슬롯 점유 안 함** → base(available/past) 복귀·재예약 가능("취소·노쇼된 슬롯 다시 가용"). booked→confirmed·completed 만 overlay(우선순위 confirmed>completed). 6.3 의 cancelled/no_show overlay 를 본 스토리가 정련 |
| `BookingDetail`·`appointments.ts`(전이 함수) | 웹(`components/scheduling/`·`lib/scheduling/`) | 확정 슬롯 클릭 → 상세 슬라이드오버(Base UI Dialog 우측·booking-peek 미러): 취소·노쇼(사유 입력)·도착접수(대기 등록 안내)·변경(같은 의사 가용 슬롯 재선택). 이중제출 useRef 락·409/422 인라인. `cancelAppointment`/`noShowAppointment`/`rescheduleAppointment`/`checkInReservation` |
| reception → `appointment.update` | seed grant(`seed.sql`) | 예약 변경·취소·노쇼·도착접수 권한(원무 대리). 데모 전이 시드 없음(통합 테스트가 환자 인라인 생성 후 커버) |

> **예약 생명주기 경계(Story 6.4 확정·Option A):** 상태머신 = DB 트리거(`enforce_appointment_transition`·BEFORE UPDATE). 전이 = 액션 엔드포인트(service_role UPDATE·소스상태 precondition·트리거 백스톱). 도착 접수 = reserved registered 내원 직접 생성(대기 흐름). 슬롯-윈도우 검증(생성·변경·6.3 이월 청산)·취소/노쇼 슬롯 가용 복귀(캘린더 overlay 정련). 컬럼 비-PII → **감사 마스킹 집합 무변경**. **환자 앱 예약 = 6.5 / SMS 실 발송 = 6.6 / 노쇼 카운트·임계 제한 = 6.7 / 휴진 재배정 = 6.8 / encounters scheduled·register_encounter 정리 = 이월(무해).**

## 환자 본인 예약 (Story 6.5, `0034_patient_self_booking.sql`)

> ⚠️ **마이그 번호 0034**: Epic 6 블록 0030~ 의 다섯 번째. 0031~0033(예약 본체·생성·생명주기) 위에 **created_by FK 제거만** 추가(신규 권한·시드·테이블 없음). 환자는 RBAC 권한 0 — 본인 예약 경로는 `get_current_patient` + **서버 patient_id 도출**(auth_uid=sub)이 권위.

| 용어/식별자 | 종류 | 정의 |
|---|---|---|
| **환자 본인 예약 모델(세션 uid 스코프)** | 설계 결정 | 환자는 앱에서 **본인 예약만** 생성(직원 대리 예약 6.4 와 대칭). 게이트 = `get_current_patient`(직원 5역할→403·환자 RBAC 권한 0). `patient_id` 는 **서버가 `auth_uid = sub` 로 도출**(클라 patient_id 미수용·3.4 self-link 패턴) → 교차환자 예약 구조적 불가(IDOR 차단). 미연결 환자(self-link 미완)→409 `no_self_patient`(온보딩 유도) |
| `appointments.created_by`(의미 확장) | 컬럼(0034·FK 제거) | '예약 생성자(원무/시스템)' → **'생성자 auth uid'**(직원 uid=`users.id` 또는 환자 auth_uid=`patients.auth_uid`). 0031 의 `→ users` FK 를 **제거**(환자 auth uid 는 users 에 없음·분리 프로필). `audit_logs.actor_id` 선례(FK 미부착·직원/환자 uid 혼용·0004:5-10)와 일치. **NOT NULL 유지**·`doctor_id`/`patient_id`/`department_id`/`room_id` FK 무변경 |
| `SelfAppointmentCreate` | 스키마(Pydantic·web Zod 거울) | 환자 본인 예약 요청 — `department_id`·`doctor_id`·`scheduled_start`·`sms_opt_in`. ⚠️ **`patient_id` 없음**(서버 도출)·**`note` 없음**(운영 텍스트는 직원 입력·환자 자유텍스트=임상/PII 리스크 제외). 응답=`AppointmentResponse` 재사용 |
| `GET …/scheduling/me/bookable-doctors`·`/me/slots` | 엔드포인트(환자 읽기) | 게이트 `get_current_patient`. 슬롯·의사 계산은 비-PII 가용성 → 기존 `list_bookable_doctors`·`compute_available_slots` 를 환자 sub 로 재사용(직원 `/scheduling/bookable-doctors`·`/slots` 는 `appointment.read` 유지·병존). 슬롯 응답에 타 환자명 없음 |
| `POST …/scheduling/me/appointments` | 엔드포인트(환자 생성·201) | 게이트 `get_current_patient`. 본인 예약 생성(booked). 더블부킹 409 `double_booking`·과거 422 `appointment_in_past`·슬롯 불가 422 `slot_unavailable`·미연결 409 `no_self_patient`·비활성 환자/의사 422. `_require_appointment_create` **미호출**(권위=self-scope) |
| `create_self_appointment`·`insert_self_appointment` | 서비스·db 래퍼 | `create_appointment`·`insert_appointment` 미러하되 **권한검사 제거 + patient_id 세션 도출**. `insert_self_appointment` 는 동일 txn `select id,is_active from patients where auth_uid=$1(sub)` 로만 patient_id 획득(인자 미수용)·`created_by = sub`(환자 auth uid·FK 제거됨). `_assert_slot_bookable`·과거 거부·active 선검사·EXCLUDE 재사용 |
| `(patient)/booking`·`PatientBooking`·`formatSlotTime12h` | 웹(`app/(patient)/`·`components/scheduling/`·`lib/scheduling/`) | 환자 앱 예약 화면(UX-DR17): 진료과(Supabase 직접조회)→의사→날짜 칩 레일→시간 슬롯 그리드(12h "오후 2:30")→sticky CTA "예약 확정하기"(≥44px)→쉬운 말 확인. 서버 가드=직원→home·연결확인=클라 `GET /patients/self`. `formatSlotTime12h`=hour12:true(직원 `formatSlotTime` 24h 와 별개) |

> **환자 본인 예약 경계(Story 6.5 확정):** 환자=세션 uid 스코프(patient_id 서버 도출·클라 미수용). 읽기=기존 슬롯/의사 서비스 재사용(비-PII)·쓰기=`/me/appointments`(권한 게이트 아님·self-scope 권위). `created_by` 비정규화(Option C·`audit_logs.actor_id` 선례). **앱 예약 변경·취소("마이 메뉴") = 이월(Epic 8/후속) / SMS 실 발송 = 6.6 / 노쇼 임계 제한 = 6.7 / 내 기록·마이 탭 = Epic 8.**

## SMS 리마인더 · 알림 로그 (Story 6.6, `0035_notifications.sql`)

> ⚠️ **마이그 번호 0035**: Epic 6 블록 0030~ 의 여섯 번째(6.1=0030·6.2=0031·6.3=0032·6.4=0033·6.5=0034). 아키텍처 계획 `0013_notifications.sql`(SMS 시뮬·이월 갭 ③)에 대응. **트리거 = 명시적 디스패치 실행**(cron 부재의 이음매)·**발송 = 시뮬/로그**(실 SMS 미연동·`simulate_sms` = 게이트웨이 교체 지점).

| 용어/식별자 | 종류 | 정의 |
|---|---|---|
| **SMS 리마인더 모델(시뮬 이음매·명시적 디스패치)** | 설계 결정 | 시스템에 cron 없음 → 리마인더는 자동 발화 안 하고 `POST /scheduling/reminders/run?as_of=` 로 트리거(운영 전환 시 cron 이 호출·`as_of` 로 시간목킹 없이 데모/테스트). 대상 = `status='booked'` ∩ `sms_opt_in=true` ∩ KST일자 ∈ {`as_of+3일`(D-3), `as_of+1일`(D-1)}. 발송=시뮬(로그 INSERT). |
| `notification_log` | 테이블(0035) | SMS 리마인더 발송 이력(append-only by grant). `appointment_id`(appointments FK)·`patient_id`(patients FK·비정규화)·`channel`('sms' CHECK)·`reminder_kind`('d_minus_3'/'d_minus_1' CHECK)·`recipient_masked`(마스킹 수신처·skipped=null)·`body`(시뮬 메시지·**비-식별**)·`status`('simulated'/'skipped' CHECK)·`skip_reason`·`appointment_start`(예약 시각 스냅샷)·`sent_at`(simulated=발송시각·skipped=null)·`created_at`. ⚠️ **원시 phone·환자명 미저장**(PII 경계 AC4) |
| `notification_logs_once` | UNIQUE 제약(0035) | `(appointment_id, reminder_kind)` — **멱등**(같은 디스패치 재실행이 중복 발송 안 함·`insert_notification_log` 가 `ON CONFLICT DO NOTHING`). 재실행 중복 0(AC2) |
| `reminder_kind` | 값 어휘(CHECK) | `d_minus_3`(예약 3일 전)·`d_minus_1`(1일 전). **전 도메인 0035 정의**(미래 CHECK ALTER 회피). `as_of` 기준 대상일 매칭으로 결정 |
| `notification_logs` append-only posture | GRANT(0035) | service_role=INSERT/SELECT·authenticated=SELECT(RLS notification.read). **UPDATE/DELETE grant 부재**(발송 후 불변·audit_logs 변형·단 삼중 가드까진 불요). appointments 의 full-CRUD 와 다른 모델 |
| `notification.read`·`notification.send` | 권한(0035 신규 2종) | read=알림 로그 조회·send=디스패치 실행. **최소권한 분리**(read 만으론 run 403). **admin 부트 grant 재실행**(test_admin_role_has_all_permissions 회귀 회피)·reception seed grant(운영 본질). **403 baseline = nurse**(둘 다 미보유). RLS: 직원=notification.read 전체 SELECT(self 정책=Epic 8 포털 이월) |
| `POST …/scheduling/reminders/run?as_of=` | 엔드포인트(디스패치) | 게이트 `notification.send`. booked∩opt-in∩{D-3,D-1} 스캔 → 시뮬 발송(연락처 있음=simulated·없음=skipped no_recipient) → 멱등 로그. 응답 = `ReminderRunSummary`. `as_of` 기본=KST 오늘 |
| `GET …/scheduling/reminders?limit=` | 엔드포인트(읽기) | 게이트 `notification.read`. 최근 발송 이력(`created_at` 내림차순). 응답 = `list[NotificationLogResponse]`(원시 phone·환자명 미반환) |
| `run_appointment_reminders`·`list_notification_logs`·`mask_phone`·`_build_reminder_body` | 서비스(`services/notification.py`) | 디스패치 오케스트레이션(KST date→UTC 범위·6.2 패턴·opt-in 필터·skipped 처리·by_kind 집계) / 로그 조회 / 전화번호 마스킹(`mask_rrn` 선례·`010-****-5678`) / 비-식별 시뮬 메시지 생성(이름·주민번호 금지) |
| `fetch_reminder_due_appointments`·`insert_notification_log`·`fetch_notification_logs`·`_require_notification_send` | db 래퍼(`core/db.py`) | service_role 읽기(booked∩opt-in∩날짜+phone+dept명) / 멱등 INSERT(`ON CONFLICT (appointment_id,reminder_kind) DO NOTHING`→충돌 시 None) / 로그 조회 / 쓰기 직전 동일 txn `notification.send` 재평가(TOCTOU·`_require_appointment_create` 미러) |
| `ReminderRunSummary`·`NotificationLogResponse` | 스키마(`schemas/notifications.py`·web 거울) | 디스패치 요약(`as_of`·`created`·`duplicate`·`simulated`·`skipped`·`by_kind`) / 로그 항목(⚠️ 원시 phone·patient_name 필드 부재·AC4) |
| `(staff)/reception/reminders`·`ReminderLog`·`reminders.ts` | 웹(`app/(staff)/`·`components/scheduling/`·`lib/scheduling/`) | 원무 리마인더 화면 — 실행 패널(as_of·이중제출 락·`notification.send` PermissionGate) + 로그 표(시각·종류[3일 전/1일 전]·수신처[마스킹·"(연락처 없음)"]·상태[발송/스킵]·음영 비의존). nav "리마인더"(원무 운영 본질·역할 노출) |

> **SMS 리마인더 경계(Story 6.6 확정):** 트리거=명시적 디스패치(cron 이음매)·발송=시뮬/로그(`simulate_sms` 게이트웨이 교체 지점)·동의 게이트=`sms_opt_in=true` 만(연락처 없으면 skipped·opt-in false 대상 외)·수신처=마스킹 스냅샷(원시 PII 로그·감사 미유입→`_SENSITIVE_KEY` 무변경)·멱등=`UNIQUE(appointment_id,reminder_kind)`. **실 SMS 게이트웨이·cron 자동 = 범위 밖 / 환자 수신함 UI·self SELECT = Epic 8 / 노쇼 카운트 = 6.7 / 휴진 재배정 통지 = 6.8 / 재-리마인더·다채널·재시도·발송 큐·D-N 설정 UI = 이월.**

## 노쇼 카운트 · 임계치 제한 (Story 6.7, `0036_no_show_policy.sql`)

> ⚠️ **마이그 번호 0036**: Epic 6 블록 0030~ 의 일곱 번째(6.1=0030·6.2=0031·6.3=0032·6.4=0033·6.5=0034·6.6=0035). **카운트 = 파생(derived)**: `patients.no_show_count` 같은 비정규화 컬럼 없음 — `appointments.status='no_show'` 가 단일 진실(Option A). AC1 "기록"은 6.4 `mark_appointment_no_show`(booked→no_show·no_show_at) 가 이미 충족 → 6.7 은 **집계·강제**. 0442("no_show_at … 6.7 노쇼 카운트")·0401("no_show 진실원 … =6.3/6.4/6.7") 이월 청산.

| 용어/식별자 | 종류 | 정의 |
|---|---|---|
| **노쇼 임계치 모델(파생 카운트·앱 상수 임계)** | 설계 결정 | 노쇼 횟수 = `appointments.status='no_show'` 집계(파생·드리프트 차단). 임계치는 **DB 가 모름** — 앱 상수 `NO_SHOW_THRESHOLD`(db.py·기본 2) 가 소유(클리닉 설정 테이블 미생성). 차단 = 엄격 `count > threshold`("초과" 문자 해석 → 0·1·2 허용·3회째 차단). `encounters.no_show` 미집계(예약 슬롯 낭비만·walk-in 비-예약 혼입 방지). |
| `patient_no_show_count(uuid)` | 함수(0036·sql stable) | 환자 노쇼 예약 수 단일 진실(`count(*)::int where status='no_show'`). security invoker(service_role=전체·환자=RLS self). EXECUTE = authenticated·service_role(public 회수 후 명시 grant). 쓰기 가드·read 엔드포인트가 공유(카운트 정의 단일화) |
| `NO_SHOW_THRESHOLD` | 상수(`core/db.py`·기본 2) | 노쇼 임계치(튜너블). 가드가 트랜잭션 내부에서 에러 detail 을 만들므로 db.py 소유(`SLOT_MINUTES` 가 service 소유인 것과 레이어 정합). web 은 하드코딩 금지 → `/no-show-status` 의 `threshold`/`blocked` 사용 |
| `_assert_no_show_under_threshold` | db 가드(`core/db.py`) | 신규 예약 직전 동일 txn 검사(TOCTOU·`_require_appointment_create` 사상). `count > NO_SHOW_THRESHOLD` → 409 `no_show_threshold_exceeded`(detail `{patient_id, no_show_count, threshold}`). `insert_appointment`(환자 active 검사 직후)·`insert_self_appointment`(patient_id 도출 직후) 에 삽입. ⚠️ **reschedule/check-in 비대상**(신규 예약 아님) |
| `no_show_threshold_exceeded` | 에러 코드(409) | 노쇼 임계 초과 신규 예약 차단(상태 충돌 — `double_booking`·`no_self_patient` 동류·에러봉투 `_map_pg_sqlstate` 무변경·AppError status_code 직접). 차단된 시도 = DML 0 → audit 행 0(더블부킹 거부 posture) |
| `fetch_patient_no_show_count`·`get_patient_no_show_status` | db·service(`core/db.py`·`services/scheduling.py`) | 카운트 읽기(service_role·존재하지 않는 환자도 0·404 불요) / `NoShowStatus` 조립(count·threshold·blocked=count>threshold·생성 가드와 동일 판정) |
| `GET …/scheduling/no-show-status?patient_id=` | 엔드포인트(읽기) | 게이트 `appointment.read` → 403(nurse baseline). booking-peek 프로액티브 배지용. 응답=`NoShowStatus`(PII 미반환·카운트 정수만). 정적 세그먼트(동적 라우트 충돌 없음) |
| `NoShowStatus` | 스키마(`schemas/scheduling.py`·web 거울) | `patient_id`·`no_show_count`·`threshold`·`blocked`. web 이 임계치 하드코딩 회피하게 서버 권위 |
| `fetchNoShowStatus`·booking-peek 배지·patient-booking 안내 | 웹(`lib/scheduling/appointments.ts`·`components/scheduling/`) | 직원 booking-peek = 환자 선택 시 사전 조회 → `blocked` 면 노쇼 색(`status-received`) 경고 칩 + 저장 버튼 disable + 저장 409 인라인 표면화(음영 비의존) / 환자 앱 = 확정 시 409 → 쉬운 말 안내("병원으로 문의해 주세요") |

> **노쇼 임계 제한 경계(Story 6.7 확정):** 카운트=파생 SQL 함수(`patient_no_show_count`·비정규화 컬럼 없음)·임계=앱 상수(`NO_SHOW_THRESHOLD=2`·`count>threshold`)·강제=db.py 가드(동일 txn·TOCTOU)·코드=409 `no_show_threshold_exceeded`. **차단 = 신규 예약 2경로만**(원무 대리 `POST /appointments` + 환자 본인 `POST /me/appointments`)·**reschedule·check-in 비대상**. 신규 권한·테이블 0(기존 `appointment.read`/`create` 재사용 → admin grant 재실행 불요). **원무 오버라이드(강제 예약)·롤링 윈도우(최근 N개월)·환자 앱 사전 차단(self no-show 엔드포인트) = 의도적 범위 밖(이월).**

## 휴진 시 영향 예약 재배정 (Story 6.8, `0037_appointment_reassignment.sql`)

> ⚠️ **마이그 번호 0037**: Epic 6 블록 0030~ 의 여덟 번째·**마지막**(6.1=0030·6.2=0031·6.3=0032·6.4=0033·6.5=0034·6.6=0035·6.7=0036). **캡스톤 = 기존 조각 묶기**: 신규 핵심 능력 = 영향 예약 조회 1건뿐·재배정 = 6.4 `reschedule` 재사용·안내 = 6.6 `notification_logs` 이음매 확장(사용자 확정). 0501("reminder_kind 전 도메인 0035 정의")·0432·0474·0511 의 "휴진 재배정=6.8" 이월 청산.

| 용어/식별자 | 종류 | 정의 |
|---|---|---|
| **휴진 재배정 모델(표면화·수동 해소)** | 설계 결정 | 0030 휴진 등록은 부수효과 없음(영향 예약 자동 취소/이동 안 함·6.1 설계) → 6.8 은 등록 **후** 영향 예약을 **조회·표면화**하고, 관리자가 재배정/취소를 **명시 액션**으로 수행. 휴진 INSERT↔영향 조회는 분리(TOCTOU 무관·읽기). |
| `GET …/scheduling/affected-appointments?doctor_id&start_at&end_at` | 엔드포인트(읽기) | 그 의사의 `status='booked'` 예약 중 휴진 윈도우 **반열림 겹침**만 + 환자명(cancelled·no_show·completed 제외=슬롯 미점유/종결). 게이트 `appointment.read` → 403(nurse). 겹침 0 → 빈 배열(404 아님)·날짜 파싱 실패 422. 정적 세그먼트(동적 라우트 충돌 없음) |
| `POST …/scheduling/appointments/{id}/notify-change` | 엔드포인트(액션) | 휴진 재배정/취소 환자 안내 기록(시뮬·6.6 이음매). body `{kind: reschedule_notice\|cancellation_notice}`. 게이트 `notification.send` → 403. 재배정/취소 **성공 후** 호출(reschedule_notice 는 새 시각 반영). 멱등(이미 안내됨) → null·미존재 예약 404 |
| `reschedule_notice`·`cancellation_notice` | reminder_kind 값(0037 CHECK 확장) | 변경 통지 2종 — `notification_logs.reminder_kind` 어휘에 추가(6.6 d_minus_3/d_minus_1 옆). UNIQUE(appointment_id, reminder_kind) 로 종류별 1건 멱등. ⚠️ 컬럼명 `reminder_kind` 가 이제 "알림 종류"(리마인더+통지)를 담음 — 정식 리네임(`notification_kind`) 이월 |
| `reschedule_appointment` department 동기화 | db 보강(`core/db.py`·0037 스토리) | **의사 변경 시** `appointment.department_id` = 새 의사 home 진료과(`users.department_id`) 동기화 → 부서-스코프 캘린더 고아 방지(deferred 'reschedule department_id 미동기화' 청산). **같은 의사면 불변**(다중 진료과 의사가 시각만 옮길 때 회귀 차단). 새 의사 진료과 멤버십 검증(`_assert_doctor_in_department`)은 잔여 이월(UI 같은 진료과 피커로 미도달) |
| `fetch_affected_appointments`·`list_affected_appointments` | db·service(`core/db.py`·`services/scheduling.py`) | service_role 읽기(booked∩윈도우 겹침+환자명·`fetch_appointments_for_date` posture) / `AffectedAppointment` 매핑(naive→UTC 간주) |
| `fetch_appointment_notice_context`·`record_change_notice`·`_build_change_notice_body` | db·service(`core/db.py`·`services/notification.py`) | 통지 컨텍스트 읽기(시각·진료과명·phone[마스킹용 내부값·미반환]) / 안내 기록(mask_phone→simulated/skipped·`insert_notification_log` 멱등 재사용·미존재 404) / 비-식별 body 생성(환자명·연락처·주민번호 금지·AC4·`_build_reminder_body` 미러) |
| `AffectedAppointment`·`ChangeNoticeRequest` | 스키마(`schemas/scheduling.py`·web 거울) | 영향 예약(id·patient_id·patient_name·doctor_id·department_id·시각·status) / 통지 요청(kind Literal). `ReminderKind`(schemas/notifications.py) 4값 확장 |
| `AffectedAppointmentsPanel`·`fetchAffectedAppointments`·`recordChangeNotice` | 웹(`components/admin/`·`lib/scheduling/appointments.ts`) | 영향 예약 슬라이드오버(목록형·재배정 모드=의사 피커[같은 진료과 `bookable-doctors`]+슬롯 재선택→reschedule+notice·취소·안내 모드=cancel+notice·booking-detail 미러·이중제출 락·409 인라인 칩). `schedule-manager` = 휴진 등록(onSaved) 후 영향>0 패널 자동 오픈 + 휴진 행 "영향 예약" 액션(재방문) |

> **휴진 재배정 경계(Story 6.8 확정·Epic 6 캡스톤):** 영향 조회=신규 read(booked∩겹침·환자명·`appointment.read`)·재배정=6.4 `reschedule` 재사용(+의사 변경 시 department_id 동기화로 deferred 청산)·안내=6.6 `notification_logs` 이음매 확장(reschedule_notice/cancellation_notice·시뮬·멱등·마스킹·비-식별·`notification.send`·best-effort). 주 surface=관리자 근무 스케줄(휴진 등록=`master.manage` admin). 신규 권한·테이블 0(기존 appointment.read/update·notification.send 재사용 → admin grant 재실행 불요). **자동 일괄 취소/이동·환자 수신함 UI·실 SMS·새 의사 진료과 멤버십 서버검증(`_assert_doctor_in_department`)·`reminder_kind`→`notification_kind` 리네임 = 의도적 범위 밖(이월).**
