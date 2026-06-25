# Epic 1: 기반·신원·접근통제 — 테스트 시나리오

## 에픽 개요
직원 신원(분리 프로필)·역할기반 접근통제(RBAC 3계층: FastAPI 쓰기 권위 / RLS 행 권위 / UI 노출 게이트)·append-only 감사로그·주민번호 pgcrypto 암호화와 reveal 프리미티브를 구축한다. 권한 매트릭스(코드수정 없이 즉시반영), 직원 계정·재직상태 관리(휴직·퇴사 시 접근/로그인 차단), 감사 조회·필터가 핵심 산출물이다.

## 스토리 ↔ FR ↔ 구현 매핑
| 스토리 | 기능 | 커버 FR | 핵심 구현(엔드포인트/화면/RPC/권한/마이그) |
|---|---|---|---|
| 1.1 | 모노레포 4서피스 스캐폴드(init) | (기반) | api/ web/ mobile/ supabase/ 구조, web `:3002` / api `:8060`, `supabase db reset` → seed.sql |
| 1.2 | 디자인 시스템 토큰·전역 셸 골격 | (기반) | `AppShell`(`app-shell.tsx`)·`Sidebar`·`Topbar`, Pretendard·Lucide, 로그인 화면 "환자 관리 시스템" |
| 1.3 | 신원·RBAC 스키마·RLS 헬퍼·감사 트리거(DB) | FR-210·240·242 | 0001 pgcrypto, 0002 roles/permissions/role_permissions/users(+부트시드, admin 전권), 0003 `auth_user_role()`/`has_permission()`+RLS, 0004 `audit_logs`+`audit_trigger_fn`+append-only 삼중 가드 |
| 1.4 | 분리 프로필 로그인(Supabase Auth) | FR-212 | `login-form.tsx`→`signInWithPassword`→`rpc("auth_user_role")`→`landingPathForRole`(branch.ts), `proxy.ts`/`supabase/proxy.ts` 인증 가드, `signOut` |
| 1.5 | FastAPI 인증·RBAC 강제(JWKS·권한 의존성) | FR-213 | `core/security.py`(JWKS ES256·`get_current_user`·`require_permission`·`get_current_staff/patient`), `core/db.py`(`authenticated_conn` GUC 주입·`fetch_has_permission`), `GET /v1/auth/me`·`/v1/auth/check`(rbac.manage) |
| 1.6 | 미들웨어 가드·역할별 셸 노출(RBAC UI 게이트) | FR-213 | `proxy.ts`(로그인 가드), `(staff)/layout.tsx`+`requireStaff`/`requirePermission`(guards.ts), `staff-nav.ts`+`filterNav`, `Sidebar`, `PermissionGate`/`LockedAction`, `PermissionsProvider`/`usePermissions` |
| 1.7 | RBAC 권한 매트릭스(관리자) | FR-210·211 | 화면 `/admin/permissions`, `PUT /v1/admin/rbac/grants`(`set_role_permission` TOCTOU 재평가·admin 409·patient 422), `rbac-matrix.ts`(읽기 직접조회), 즉시반영·민감권한 확인 다이얼로그 |
| 1.8 | 직원 계정·재직상태 관리(관리자) | FR-214·215 | 화면 `/admin/users`, `GET/POST /v1/admin/users`·`PATCH .../employment-status`·`.../department`, `services/users.py`(GoTrue create+보상삭제·ban 동기화), 자가-락아웃 409 |
| 1.9 | 주민번호 암호화·감사 reveal 프리미티브 | FR-241·242 | 0005 Vault 키+`encrypt_sensitive`/`decrypt_sensitive`(복호=자가감사)/`blind_index`, service_role 한정, `db.encrypt_sensitive`/`decrypt_sensitive` 래퍼 |
| 1.10 | 감사 로그 뷰어(관리자·append-only) | FR-242·243 | 화면 `/admin/audit-logs`, `GET /v1/admin/audit-logs`(actor/action/table/target/기간 필터·페이지), `services/audit.py`(서버측 PII 마스킹), `audit-log-viewer.tsx` |
| (1.9→4.5) | RRN/연락처 reveal 엔드포인트 | FR-241·242 | 0012 `reveal_rrn`/`reveal_contact` RPC(권한 재평가+자가감사), 권한 `patient.reveal_rrn`/`patient.reveal_contact` |

**RBAC 노출 모델(코드리뷰 확정):** 직무 핵심 메뉴는 역할로 노출(예: 원무 접수/환자/수납), 민감·관리 메뉴(`/admin/*`)만 `requiredPermission` 게이트. admin 메뉴 6종은 각각 `dashboard.read`/`master.manage`/`rbac.manage`/`master.manage`/`user.manage`/`audit.read` 필요.

**데모 계정 권한 요지(seed.sql):** admin=23+권한 전부 / doctor=encounter.read·start·complete, patient.read·reveal_rrn·reveal_contact, medical_record·diagnosis·prescription·examination·treatment.order 등 / reception=encounter.register·read·call(임상오더 권한 0) / nurse=order.read·examination.perform·treatment.perform·vital.record (encounter.*·patient.* 권한 0 = 진료/환자 도메인 403 baseline) / radiologist=order.read·examination.perform. **admin 외 어떤 데모 계정도 rbac.manage·user.manage·audit.read·master.manage·dashboard.read 를 보유하지 않음** → 관리 화면/엔드포인트 403 baseline.

---

## 테스트 시나리오

### TC-E1-01: 직원 로그인 성공 → 역할별 착지(분리 프로필 분기)
- **검증**: FR-212 / Story 1.4
- **역할/계정**: admin@pms.local, doctor@pms.local, reception@pms.local, nurse@pms.local, radiologist@pms.local (전부 Staff1234)
- **사전조건**: `supabase db reset` 후 API(:8060)·web(:3002) 기동. 미로그인 상태.
- **단계**: 1) `/login` 접속, "환자 관리 시스템" 헤더 확인 2) 각 직원 이메일 + Staff1234 입력 후 "로그인" 클릭 3) 착지 경로 확인
- **기대결과**: 5개 직원 계정 모두 로그인 성공, `auth_user_role()`이 직원 역할 코드를 반환 → `/home`(STAFF_HOME)으로 착지. 좌측 사이드바 푸터에 역할 한글 라벨(관리자/의사/원무과/간호사/방사선사) 표시.
- **유형**: 정상

### TC-E1-02: 잘못된 비밀번호 → 무PII 한국어 범용 오류
- **검증**: FR-212 / Story 1.4
- **역할/계정**: admin@pms.local
- **사전조건**: 미로그인.
- **단계**: 1) `/login` 2) admin@pms.local + 틀린 비밀번호(예: wrong123) 입력 3) "로그인" 클릭
- **기대결과**: 로그인 실패, `role="alert"` 한국어 범용 메시지 표시(원문 오류·이메일·토큰 비노출 — `authErrorMessage`). 착지/리다이렉트 없음, 여전히 `/login`.
- **유형**: 예외

### TC-E1-03: 클라이언트 폼 검증(이메일 형식/필수)
- **검증**: FR-212 / Story 1.4
- **역할/계정**: (미인증)
- **사전조건**: `/login`.
- **단계**: 1) 이메일 비우고 제출 → 검증 오류 2) "abc"(@없음) 입력 후 제출 3) 비밀번호 비우고 제출
- **기대결과**: RHF+Zod(loginSchema)가 제출 전 차단 — `email-error`/`password-error` 인라인 메시지(한국어). 네트워크 호출 미발생.
- **유형**: 경계

### TC-E1-04: 미인증 보호 경로 접근 → /login 리다이렉트
- **검증**: FR-213 / Story 1.6
- **역할/계정**: (미인증)
- **사전조건**: 로그아웃/시크릿 창.
- **단계**: 1) 주소창에 `/home` 직접 입력 2) `/admin/users` 직접 입력 3) `/reception/waiting` 직접 입력
- **기대결과**: `supabase/proxy.ts updateSession`이 user 없음 + 비공개 경로 → 전부 `/login`으로 리다이렉트(공개 경로 = `/login`·`/signup`만).
- **유형**: 권한·보안

### TC-E1-05: 로그인 상태로 공개 경로 접근 → 루트로 리다이렉트
- **검증**: FR-212 / Story 1.4·1.6
- **역할/계정**: admin@pms.local
- **사전조건**: admin 로그인 완료.
- **단계**: 1) 주소창에 `/login` 입력 2) `/signup` 입력
- **기대결과**: 인증 상태에서 공개 경로 접근 시 `/`로 리다이렉트(`user && isPublicRoute`). 루트가 세션 기준 재평가 후 직원 영역으로.
- **유형**: 정상

### TC-E1-06: 로그아웃 → 세션 제거·로그인 화면 복귀
- **검증**: FR-212 / Story 1.4
- **역할/계정**: doctor@pms.local
- **사전조건**: doctor 로그인.
- **단계**: 1) 로그아웃 버튼(`logout-button`) 클릭 2) 뒤로가기 또는 `/home` 재접속 시도
- **기대결과**: `signOut({scope:'local'})`로 세션 쿠키 제거 후 `/login`. 보호 경로 재접속 시 다시 `/login`(세션 잔존 없음).
- **유형**: 정상

### TC-E1-07: 역할별 사이드바 메뉴 노출(원무)
- **검증**: FR-213 / Story 1.6
- **역할/계정**: reception@pms.local
- **사전조건**: reception 로그인.
- **단계**: 1) 사이드바 항목 확인
- **기대결과**: 운영(대기 현황·접수·예약 관리·리마인더)·환자(환자 등록·환자 검색)·정산(수납·문서 출력) 노출. 의사/간호/영상/관리 섹션 미노출(roles 미매칭). 관리(`/admin/*`) 항목 전무.
- **유형**: 정상

### TC-E1-08: 관리자 사이드바 — 관리 메뉴는 권한 게이트
- **검증**: FR-211·213 / Story 1.6·1.7
- **역할/계정**: admin@pms.local
- **사전조건**: admin 로그인(전권한).
- **단계**: 1) 사이드바 "관리" 섹션 확인
- **기대결과**: 운영/대시보드·마스터·권한·근무 스케줄·직원 계정·감사 로그 6종 모두 노출(admin이 dashboard.read·master.manage·rbac.manage·user.manage·audit.read 전부 보유). filterNav 규칙(역할 매칭 AND requiredPermission 보유) 만족.
- **유형**: 정상

### TC-E1-09: 권한 회수 시 관리 메뉴 동적 숨김(코드수정 없이 즉시반영 — 노출 측면)
- **검증**: FR-211·213 / Story 1.6·1.7
- **역할/계정**: admin@pms.local (자기 자신은 admin 고정 불가 → 별도 admin 역할 직원 필요). 대안으로 신규 admin 직원 생성 후 검증하거나, DB에서 비-admin 역할의 메뉴로 확인.
- **사전조건**: admin 로그인. (admin 권한은 매트릭스에서 변경 불가하므로) `/admin/users`에서 신규 admin 역할 직원 A 생성 후 A로 로그인.
- **단계**: 1) admin으로 `/admin/permissions` 진입은 admin 자기 권한이 고정이라 불가 — 대신 A(admin)로 로그인 시 관리 메뉴 전부 보임을 확인. (※ admin 역할은 항상 전권 → 메뉴 숨김 검증은 비-admin 역할에서 수행: TC-E1-10 참조)
- **기대결과**: admin 역할 사용자는 항상 관리 메뉴 전부 노출(매트릭스가 admin 열 잠금). 동적 숨김 검증은 비-admin 역할로 이관.
- **유형**: 정상

### TC-E1-10: 직접 URL로 권한 밖 관리 화면 진입 → /home 강등(서버 가드)
- **검증**: FR-213 / Story 1.6·1.7·1.8·1.10
- **역할/계정**: nurse@pms.local (관리 권한 0)
- **사전조건**: nurse 로그인.
- **단계**: 1) 주소창에 `/admin/permissions` 직접 입력 2) `/admin/users` 입력 3) `/admin/audit-logs` 입력 4) `/admin/masters` 입력 5) `/admin/dashboard` 입력
- **기대결과**: 각 페이지 서버 컴포넌트의 `requirePermission(code, STAFF_HOME)` 가드가 권한 미보유 → `/home`으로 redirect. UI 우회로 화면 접근 불가(서버 권위).
- **유형**: 권한·보안

### TC-E1-11: 비직원/RPC 실패 시 (staff) 영역 강등
- **검증**: FR-212·213 / Story 1.6
- **역할/계정**: (환자 계정 — Epic 8 self-가입 또는 없으면 N/A). 대안: 직원이 아닌 세션.
- **사전조건**: `auth_user_role()`이 NULL/'patient' 반환하는 세션(환자 또는 직원 행 없는 auth 사용자).
- **단계**: 1) `/home` 또는 임의 `(staff)` 경로 접근
- **기대결과**: `requireStaff()`가 `isStaffRole(role)` false → `/portal`(PATIENT_HOME)로 redirect. (환자 데모 계정이 없으면 코드 경로 검증으로 대체 — guards.ts:24.)
- **유형**: 권한·보안

### TC-E1-12: FastAPI 인증 — 토큰 없이 보호 엔드포인트 호출 → 401
- **검증**: FR-213 / Story 1.5
- **역할/계정**: (토큰 없음)
- **사전조건**: API 기동.
- **단계**: 1) `curl http://localhost:8060/v1/auth/me` (Authorization 헤더 없이) 2) `curl .../v1/auth/check`
- **기대결과**: 둘 다 401(AuthError) — `get_current_user`가 creds None → AuthError. 어떤 검증이 실패했는지 본문에 비노출.
- **유형**: 권한·보안

### TC-E1-13: FastAPI 인증 — 변조/만료/잘못된 토큰 → 401
- **검증**: FR-213 / Story 1.5
- **역할/계정**: (위조 토큰)
- **사전조건**: API 기동.
- **단계**: 1) `Authorization: Bearer invalid.token.here`로 `/v1/auth/me` 호출 2) 서명 부위 변조한 실제 형식 토큰 호출 3) (가능 시) exp 지난 토큰 호출
- **기대결과**: 전부 401. 서명 불일치/JWKS 키 미스/형식 오류/만료 모두 AuthError로 통일. 비-UUID sub·빈 aud 같은 클레임 비정상도 401(500 아님).
- **유형**: 예외/보안

### TC-E1-14: /auth/me 정상 — 본인 신원만 반환
- **검증**: FR-212·213 / Story 1.5
- **역할/계정**: doctor@pms.local
- **사전조건**: doctor 세션 access token 확보(브라우저 DevTools Network 또는 supabase-js).
- **단계**: 1) `Authorization: Bearer <doctor token>`로 `GET /v1/auth/me`
- **기대결과**: 200, `{sub, role:"doctor", is_staff:true, employee_no:"EMP0002", name:"의사(테스트)"}`. 타인/환자 PII 미포함.
- **유형**: 정상

### TC-E1-15: require_permission 강제 — rbac.manage 미보유 403
- **검증**: FR-213 / Story 1.5·1.7
- **역할/계정**: doctor@pms.local (rbac.manage 미보유), admin@pms.local (보유)
- **사전조건**: 두 계정 토큰.
- **단계**: 1) doctor 토큰으로 `GET /v1/auth/check` 2) admin 토큰으로 동일 호출
- **기대결과**: doctor → 403(ForbiddenError, detail `{required_permission:"rbac.manage"}`). admin → 200 `{permission:"rbac.manage", allowed:true}`. 권한은 항상 DB `has_permission` 룩업(토큰에 RBAC 역할 없음).
- **유형**: 권한·보안

### TC-E1-16: 권한 매트릭스 조회·렌더(관리자)
- **검증**: FR-210·211 / Story 1.7
- **역할/계정**: admin@pms.local
- **사전조건**: admin 로그인.
- **단계**: 1) `/admin/permissions` 진입 2) 매트릭스 헤더 확인
- **기대결과**: 역할 5열(reception·doctor·nurse·radiologist·admin, admin 최후미·patient 제외), 권한 행(resource 그룹·DB 카탈로그 전수). admin 열은 자물쇠+"전체" 배지·전부 체크·변경불가. "변경은 즉시 적용되며 감사 로그에 기록됩니다" 배너. 민감 권한(reveal_rrn·reveal_contact·rbac.manage·audit.read)에 "민감" 태그.
- **유형**: 정상

### TC-E1-17: 권한 grant 토글 — 비민감 권한 즉시 반영
- **검증**: FR-211 / Story 1.7
- **역할/계정**: admin@pms.local
- **사전조건**: `/admin/permissions`. 대상: reception 행 × 비민감 권한(예: appointment.read).
- **단계**: 1) reception × appointment.read 셀 클릭(체크 on) 2) 우상단 "변경사항 자동 저장됨 · HH:MM" 확인 3) 페이지 새로고침
- **기대결과**: `PUT /v1/admin/rbac/grants {role_code:"reception", permission_code:"appointment.read", granted:true}` 호출, 낙관적 체크 표시 → autosave 표식. 새로고침 후에도 grant 유지(DB 반영). 저장 버튼 없음(즉시반영, FR-211).
- **유형**: 정상

### TC-E1-18: 민감 권한 토글 — 확인 다이얼로그 경유
- **검증**: FR-211 / Story 1.7 / UX-DR16
- **역할/계정**: admin@pms.local
- **사전조건**: `/admin/permissions`. 대상: reception × patient.reveal_rrn(민감).
- **단계**: 1) reception × patient.reveal_rrn 셀 클릭 2) 확인 다이얼로그("권한 부여 확인", "…부여하시겠습니까? …감사 로그에 기록됩니다") 확인 3) "부여" 클릭
- **기대결과**: 민감 권한은 즉시 적용 전 ConfirmDialog 표시. "부여" 시 PUT 호출+적용, "취소" 시 무변경. 회수 시 "권한 회수 확인" 다이얼로그.
- **유형**: 경계/정상

### TC-E1-19: admin 역할 권한 변경 차단 → 409 role_locked
- **검증**: FR-211 / Story 1.7 (자가-락아웃 방지)
- **역할/계정**: admin@pms.local
- **사전조건**: admin 토큰.
- **단계**: 1) `PUT /v1/admin/rbac/grants {role_code:"admin", permission_code:"audit.read", granted:false}` 직접 호출(UI는 admin 열 클릭 무시)
- **기대결과**: 409 ConflictError `role_locked` "관리자 역할의 권한은 변경할 수 없습니다." admin은 항상 전권 고정(UI도 admin 열 onCellActivate에서 early return).
- **유형**: 권한·보안

### TC-E1-20: patient 역할 매트릭스 변경 차단 → 422 invalid_target
- **검증**: FR-211 / Story 1.7
- **역할/계정**: admin@pms.local
- **사전조건**: admin 토큰.
- **단계**: 1) `PUT /v1/admin/rbac/grants {role_code:"patient", permission_code:"appointment.read", granted:true}` 직접 호출
- **기대결과**: 422 `invalid_target` "권한 매트릭스에서 변경할 수 없는 역할입니다." (patient는 직무 RBAC 비대상; UI 열에서도 제외).
- **유형**: 예외/보안

### TC-E1-21: 미존재 role/permission 코드 토글 → 404
- **검증**: FR-211 / Story 1.7
- **역할/계정**: admin@pms.local
- **사전조건**: admin 토큰.
- **단계**: 1) `PUT .../rbac/grants {role_code:"ghost", permission_code:"appointment.read", granted:true}` 2) `{role_code:"reception", permission_code:"no.such", granted:true}`
- **기대결과**: 미존재 role → 404(detail role_code), 미존재 permission → 404(detail permission_code).
- **유형**: 예외

### TC-E1-22: grant 멱등성 — changed 플래그
- **검증**: FR-211 / Story 1.7
- **역할/계정**: admin@pms.local
- **사전조건**: admin 토큰. reception × appointment.read 이미 grant 상태(TC-17 후).
- **단계**: 1) 동일 grant=true 재요청 2) revoke 후 다시 revoke
- **기대결과**: 이미 있는 grant 재요청 → `changed:false`(INSERT 0 0). 없는 revoke → `changed:false`(DELETE 0). 감사행 0 추가.
- **유형**: 경계

### TC-E1-23: 권한 토글 → 감사 로그 자동 기록(actor=관리자)
- **검증**: FR-242 / Story 1.7·1.3·1.10
- **역할/계정**: admin@pms.local
- **사전조건**: admin 로그인.
- **단계**: 1) `/admin/permissions`에서 reception × payment.process grant 토글 2) `/admin/audit-logs` 진입 3) 대상 필터 "role_permissions"(역할 권한), 동작 "생성" 선택
- **기대결과**: `role_permissions` create 감사행 등장, 행위자=관리자(테스트)(EMP0001), after_data에 role_id/permission_id. 0004 `trg_role_permissions_audit`가 actor=app.actor_id로 자동 기록(앱이 직접 INSERT 안 함).
- **유형**: 정상/감사

### TC-E1-24: 비-admin이 매트릭스 화면/엔드포인트 접근 → 차단
- **검증**: FR-211·213 / Story 1.7
- **역할/계정**: reception@pms.local (rbac.manage 미보유)
- **사전조건**: reception 로그인 + 토큰.
- **단계**: 1) `/admin/permissions` 직접 URL 진입 2) reception 토큰으로 `PUT /v1/admin/rbac/grants` 직접 호출
- **기대결과**: 화면 → `requirePermission("rbac.manage")` 가드로 `/home` 강등. API → 403(라우터 require_rbac_manage + set_role_permission 내부 재평가 이중). 사이드바에 "권한" 메뉴 자체 미노출.
- **유형**: 권한·보안

### TC-E1-25: 직원 계정 목록 조회(관리자)
- **검증**: FR-214 / Story 1.8
- **역할/계정**: admin@pms.local
- **사전조건**: admin 로그인.
- **단계**: 1) `/admin/users` 진입 2) "직원 목록" 표 확인
- **기대결과**: 5개 시드 직원(EMP0001~0005) 사번순 표시(사번·이름·역할·소속 진료과·면허·재직상태·변경). `GET /v1/admin/users`(service_role이 users RLS 본인행 우회 → 전원 반환). 직접 Supabase 조회로는 본인행만 보이므로 FastAPI 경유가 유일.
- **유형**: 정상

### TC-E1-26: 직원 계정 생성 성공(Auth + 프로필)
- **검증**: FR-214 / Story 1.8
- **역할/계정**: admin@pms.local
- **사전조건**: `/admin/users`.
- **단계**: 1) "계정 추가" 클릭 2) 사번=EMP0010, 이름=테스트의사, 이메일=newdoc@pms.local, 임시 비밀번호=Staff1234, 역할=의사, 면허종류=의사, 면허번호=12345 입력 3) "계정 생성" 클릭 4) 신규 계정으로 로그인 시도
- **기대결과**: 201, 토스트 "테스트의사 계정이 생성되었습니다.", 목록에 행 추가(재직). GoTrue auth.users 생성 → users 프로필 INSERT(create_staff 2단계). newdoc@pms.local/Staff1234 로그인 가능 → /home. 응답·로그에 비밀번호 비노출, 폼 reset.
- **유형**: 정상

### TC-E1-27: 직원 생성 — 사번 중복 → 409 인라인
- **검증**: FR-214 / Story 1.8
- **역할/계정**: admin@pms.local
- **사전조건**: `/admin/users` 계정 추가 모달.
- **단계**: 1) 사번=EMP0001(기존 admin 사번), 이메일=fresh@pms.local, 나머지 유효 입력 2) "계정 생성"
- **기대결과**: 409 `employee_no_taken`, "사번" 필드에 인라인 오류 표기. **방금 만든 GoTrue Auth 사용자는 보상 삭제**(고아 방지, create_staff except 블록). 목록 미변경.
- **유형**: 예외

### TC-E1-28: 직원 생성 — 이메일 중복 → 409 인라인
- **검증**: FR-214 / Story 1.8
- **역할/계정**: admin@pms.local
- **사전조건**: 계정 추가 모달.
- **단계**: 1) 이메일=admin@pms.local(기존), 사번=EMP0011, 나머지 유효 2) "계정 생성"
- **기대결과**: 409 `email_taken`, "이메일" 필드 인라인 오류. GoTrue 단계에서 실패 → 프로필 미생성.
- **유형**: 예외

### TC-E1-29: 직원 생성 — patient 역할 거부 → 422
- **검증**: FR-214 / Story 1.8
- **역할/계정**: admin@pms.local
- **사전조건**: admin 토큰(UI 역할 select엔 patient 없음 → API 직접).
- **단계**: 1) `POST /v1/admin/users {role_code:"patient", employee_no:"EMP0012", email:"p@pms.local", password:"Staff1234", name:"X"}` 직접 호출
- **기대결과**: 422 `invalid_target` "직원 계정으로 만들 수 없는 역할입니다." Auth 사용자 미생성(사전검증, create_staff:41). 미지 역할 코드도 동일 거부.
- **유형**: 예외/보안

### TC-E1-30: 직원 생성 — 약한 비밀번호 → 422
- **검증**: FR-214 / Story 1.8
- **역할/계정**: admin@pms.local
- **사전조건**: 계정 추가 모달 또는 API.
- **단계**: 1) 비밀번호="123"(8자 미만) 입력 후 생성 2) (Pydantic 통과시키려면 API로 8자지만 GoTrue 정책 위반 비번 전송)
- **기대결과**: Pydantic min_length=8 위반 → 422(폼 인라인). GoTrue 약한 비밀번호 → 422 `weak_password`. 비밀번호 비노출.
- **유형**: 경계

### TC-E1-31: 재직상태 변경 — 휴직 → 접근·로그인 차단
- **검증**: FR-215 / Story 1.8
- **역할/계정**: admin@pms.local (대상: nurse@pms.local)
- **사전조건**: `/admin/users`. nurse 다른 브라우저에서 로그인 중이면 가시적.
- **단계**: 1) nurse 행 "재직상태" select에서 "휴직" 선택 2) 확인 다이얼로그("휴직 처리하면 로그인과 시스템 접근이 차단됩니다") → 확인 3) nurse로 신규 로그인 시도 4) (nurse 기존 세션) 보호 화면 새로고침
- **기대결과**: PATCH `.../employment-status {employment_status:"on_leave"}`. DB UPDATE(접근 권위) + GoTrue ban. nurse 신규 로그인 거부(banned). 기존 세션도 `auth_user_role()`/`has_permission`이 active만 인정 → role NULL → requireStaff 강등/권한 0. 토스트 "간호사(테스트) · 휴직 처리되었습니다."
- **유형**: 권한·보안

### TC-E1-32: 재직상태 복귀 — 재직 → 접근 복원(즉시)
- **검증**: FR-215 / Story 1.8
- **역할/계정**: admin@pms.local (대상: 휴직 처리된 nurse)
- **사전조건**: TC-31로 nurse 휴직 상태.
- **단계**: 1) nurse 행 재직상태 "재직" 선택(복귀는 확인 다이얼로그 없이 즉시) 2) nurse 로그인 재시도
- **기대결과**: PATCH active → DB 복원 + GoTrue unban('none'). nurse 로그인 성공·접근 복원. 복귀는 비차단 동작이라 즉시 적용.
- **유형**: 정상

### TC-E1-33: 재직상태 — 퇴사 처리
- **검증**: FR-215 / Story 1.8
- **역할/계정**: admin@pms.local (대상: TC-26에서 만든 EMP0010 또는 radiologist)
- **사전조건**: `/admin/users`.
- **단계**: 1) 대상 행 재직상태 "퇴사" 선택 → 확인 다이얼로그 → 확인 2) 대상으로 로그인 시도 3) 해당 진료과 의존성 카운트 확인(Epic 2 영역, 참고)
- **기대결과**: terminated 처리, ban 적용, 로그인 차단. `auth_user_role`/`has_permission`에서 제외(active 아님). 감사 update 기록.
- **유형**: 권한·보안

### TC-E1-34: 자가-락아웃 방지 — 관리자가 본인 비활성화 → 409
- **검증**: FR-215 / Story 1.8
- **역할/계정**: admin@pms.local (대상: 본인 = EMP0001)
- **사전조건**: admin 토큰/화면.
- **단계**: 1) `/admin/users`에서 본인(관리자(테스트)) 행 재직상태를 "휴직"으로 시도, 또는 2) `PATCH /v1/admin/users/<본인 sub>/employment-status {employment_status:"on_leave"}`
- **기대결과**: 409 `self_lockout` "본인 계정은 비활성(휴직/퇴사)으로 변경할 수 없습니다." 본인을 active→active로 두는 것은 허용. 목록 미변경.
- **유형**: 권한·보안

### TC-E1-35: 재직상태 변경 — 미존재 직원 → 404
- **검증**: FR-215 / Story 1.8
- **역할/계정**: admin@pms.local
- **사전조건**: admin 토큰.
- **단계**: 1) `PATCH /v1/admin/users/00000000-0000-4000-8000-000000000999/employment-status {employment_status:"terminated"}`
- **기대결과**: 404(detail user_id). 미존재 대상에 대한 상태 변경 거부.
- **유형**: 예외

### TC-E1-36: 직원 관리 — 비-admin 접근 차단
- **검증**: FR-214·215 / Story 1.8
- **역할/계정**: doctor@pms.local (user.manage 미보유)
- **사전조건**: doctor 로그인 + 토큰.
- **단계**: 1) `/admin/users` 직접 URL 2) doctor 토큰으로 `GET /v1/admin/users` 3) `POST /v1/admin/users` 4) `PATCH .../employment-status`
- **기대결과**: 화면 → `/home` 강등. API 전부 403(require_user_manage + db 내부 has_permission 재평가). 사이드바에 "직원 계정" 미노출.
- **유형**: 권한·보안

### TC-E1-37: 소속 진료과 배정/변경/해제
- **검증**: FR-214 / Story 1.8·2.6
- **역할/계정**: admin@pms.local
- **사전조건**: `/admin/users`. 활성 진료과 시드 존재(Epic 2 seed).
- **단계**: 1) 직원 행 "소속 진료과" select에서 활성 진료과 선택 2) "소속 없음"으로 변경 3) (API) 비활성 진료과 id로 배정 시도
- **기대결과**: PATCH `.../department`. 활성 진료과 배정 성공 토스트. "소속 없음"=null 해제. 비활성/미존재 진료과 → 422(`inactive_department`/`invalid_department`) 토스트. GoTrue 부수효과 없음(접근 무관).
- **유형**: 정상/경계

### TC-E1-38: 주민번호 암호화 라운드트립(프리미티브)
- **검증**: FR-241 / Story 1.9
- **역할/계정**: (service_role/DB 직접 또는 통합 테스트)
- **사전조건**: `supabase db reset` 후 Vault 키 `pms_pii_enc_key` 생성됨.
- **단계**: 1) DB에서 `select encrypt_sensitive('7103141234567')` → 암호문 2) `select decrypt_sensitive(<암호문>,'patients','<id>')` → 평문 3) 평문 == 원문 확인
- **기대결과**: enc→dec 라운드트립 일치. 암호문은 bytea(pgp_sym_encrypt). 평문 키는 코드/마이그레이션 파일에 없음(Vault gen_random_bytes 생성). authenticated/anon 직접 호출은 권한 거부(service_role only).
- **유형**: 정상/보안

### TC-E1-39: 복호 = 자가-감사('read' 이벤트, raw 값 미저장)
- **검증**: FR-241·242 / Story 1.9
- **역할/계정**: (service_role, app.actor_id=admin sub 주입)
- **사전조건**: 암호문 1건.
- **단계**: 1) `set local app.actor_id='<admin uid>'` 후 `decrypt_sensitive(<암호문>,'patients','<pid>')` 2) `select * from audit_logs where action='read' and target_table='patients' order by created_at desc limit 1`
- **기대결과**: 복호 호출이 audit_logs에 action='read', target_table='patients', target_id=<pid>, actor_id=admin uid 자동 INSERT(우회 불가). **before_data/after_data는 NULL**(raw RRN 평문 절대 미저장, PII 경계).
- **유형**: 보안/감사

### TC-E1-40: blind index 결정성·UNIQUE 중복 차단
- **검증**: FR-241 (FR-003 토대) / Story 1.9
- **역할/계정**: (service_role/DB)
- **사전조건**: HMAC 키 `pms_pii_hmac_key` 생성됨.
- **단계**: 1) `select blind_index('7103141234567')` 2회 → 동일 해시 확인 2) (Epic 3) 동일 정규화 주민번호로 환자 2명 등록 시도
- **기대결과**: 같은 입력 → 같은 HMAC(결정적). Epic 3에서 동일 주민번호 환자 중복 등록은 `idx_patients_resident_no_hash` UNIQUE 위반으로 차단(0009). blind_index는 service_role only.
- **유형**: 경계/보안

### TC-E1-41: 암복호 RPC 직접 클라 호출 차단
- **검증**: FR-241 / Story 1.9
- **역할/계정**: doctor@pms.local (authenticated)
- **사전조건**: doctor의 supabase-js 세션.
- **단계**: 1) `supabase.rpc('encrypt_sensitive', {p_plaintext:'x'})` 2) `supabase.rpc('decrypt_sensitive', ...)` 3) `supabase.rpc('blind_index', ...)`
- **기대결과**: 전부 권한 거부(execute가 service_role에만 grant, anon/authenticated revoke). 클라가 직접 암복호/감사 우회 불가 — FastAPI 경유만.
- **유형**: 권한·보안

### TC-E1-42: 주민번호 reveal — 권한 보유자(의사) 성공 + 자가감사
- **검증**: FR-241·242 / Story 1.9(0012 reveal_rrn), Story 4.5
- **역할/계정**: doctor@pms.local (patient.reveal_rrn 보유)
- **사전조건**: 환자 1명 등록(Epic 3) + 진료 컨텍스트. (Epic 1 단독 검증 시 0012 reveal_rrn RPC를 service_role로 호출 + has_permission이 doctor sub로 true인지.)
- **단계**: 1) 진료 허브에서 RRN reveal 액션 트리거(Epic 4.5 화면) 또는 API reveal 경로 2) audit_logs read 이벤트 확인
- **기대결과**: full 주민번호 반환(응답 바디만), 0012가 has_permission('patient.reveal_rrn') 동일-txn 재평가 후 decrypt_sensitive 호출 → 'read' 자가감사(actor=의사). 로그/에러에 RRN 미echo.
- **유형**: 정상/감사

### TC-E1-43: 주민번호 reveal — 권한 미보유 → 거부
- **검증**: FR-213·241 / Story 1.9(0012), 1.7
- **역할/계정**: nurse@pms.local (patient.reveal_rrn 미보유), reception@pms.local
- **사전조건**: 환자 1명.
- **단계**: 1) reveal_rrn 경로를 권한 없는 역할 컨텍스트로 호출
- **기대결과**: 0012 `reveal_rrn`이 `not has_permission('patient.reveal_rrn')` → insufficient_privilege(42501) → FastAPI 403. 복호·감사 미발생.
- **유형**: 권한·보안

### TC-E1-44: 감사 로그 뷰어 조회·렌더(관리자)
- **검증**: FR-243 / Story 1.10
- **역할/계정**: admin@pms.local
- **사전조건**: admin 로그인. 사전 변경(권한 토글·직원 생성)으로 감사행 존재.
- **단계**: 1) `/admin/audit-logs` 진입 2) 목록(시각·행위자·동작·대상·상세)·총 건수·페이지네이션 확인 3) "보기" 클릭 → 상세 패널
- **기대결과**: 최신순 목록(`GET /v1/admin/audit-logs`), 행위자=이름(사번)/시스템(actor_id NULL), 동작 배지(생성/조회/수정/삭제/로그인), 대상 한글 라벨+#target_id. 페이지당 50, total/range 표시. 상세에 before/after diff. **편집·삭제 어포던스 없음**(append-only).
- **유형**: 정상

### TC-E1-45: 감사 로그 필터 — 행위자·동작·대상·기간
- **검증**: FR-243 / Story 1.10
- **역할/계정**: admin@pms.local
- **사전조건**: `/admin/audit-logs`, 다양한 감사행 존재.
- **단계**: 1) 동작 "생성" 필터 2) 대상 "직원 계정(users)" 필터 3) 행위자 드롭다운에서 관리자(테스트) 선택 4) 시작일/종료일 지정 5) "초기화"
- **기대결과**: 각 필터가 쿼리스트링(action/target_table/actor_id/date_from/date_to)으로 전달, 서버 동적 WHERE(값 $n 바인딩, 컬럼/연산자 고정 → SQLi 차단). 날짜는 KST→ISO+09:00 변환. 결과 0건 시 "조건에 해당하는 감사 로그가 없습니다." 초기화 시 1페이지 전체.
- **유형**: 정상/경계

### TC-E1-46: 감사 필터 — 역전 기간 → 422(무음 0건 방지)
- **검증**: FR-243 / Story 1.10
- **역할/계정**: admin@pms.local
- **사전조건**: admin 토큰.
- **단계**: 1) `GET /v1/admin/audit-logs?date_from=2026-06-30T00:00:00%2B09:00&date_to=2026-06-01T23:59:59%2B09:00`
- **기대결과**: 422 `invalid_date_range` "조회 시작일이 종료일보다 늦을 수 없습니다." (빈 결과와 명시적 오류 구분).
- **유형**: 예외/경계

### TC-E1-47: 감사 필터 — 잘못된 action 값 → 422
- **검증**: FR-243 / Story 1.10
- **역할/계정**: admin@pms.local
- **사전조건**: admin 토큰.
- **단계**: 1) `GET /v1/admin/audit-logs?action=CREATE`(대문자) 2) `?action=foo`(미지) 3) `?action=`(빈값)
- **기대결과**: AuditAction Literal 검증 실패 → 422(무음 0건 방지). 유효값은 create/read/update/delete/login 소문자만.
- **유형**: 예외/경계

### TC-E1-48: 감사 로그 — 서버측 PII 마스킹(스냅샷)
- **검증**: FR-242·243 / Story 1.10·3.6
- **역할/계정**: admin@pms.local
- **사전조건**: 환자 등록(Epic 3) 또는 연락처 포함 행 변경으로 PII 포함 감사행 존재.
- **단계**: 1) `/admin/audit-logs`에서 patients 대상 감사행 "보기" 2) 상세 before/after 확인 3) 원시 API 응답(`GET .../audit-logs`)에서 before_data/after_data 직접 확인
- **기대결과**: resident_no/phone/address/email/name(patients·guardians)/notes/allergies 등 민감 키 값이 "●●●● (마스킹됨)"로 마스킹. **마스킹은 서버(services/audit.py mask_snapshot)가 1차 권위** → API 본문 자체에 평문 PII 없음. 키(필드명)는 보존(diff 가독성). chart_no/birth_date/sex/is_active 등 비민감은 노출.
- **유형**: 보안/감사

### TC-E1-49: 감사 로그 — 비-admin 접근 차단
- **검증**: FR-243 / Story 1.10
- **역할/계정**: reception@pms.local (audit.read 미보유)
- **사전조건**: reception 로그인 + 토큰.
- **단계**: 1) `/admin/audit-logs` 직접 URL 2) reception 토큰으로 `GET /v1/admin/audit-logs`
- **기대결과**: 화면 → `requirePermission("audit.read")` → `/home`. API → 403(require_audit_read). RLS `audit_logs_select`도 has_permission('audit.read') 게이트(방어심층). 사이드바에 "감사 로그" 미노출.
- **유형**: 권한·보안

### TC-E1-50: 감사로그 append-only — UPDATE/DELETE 차단(삼중 가드)
- **검증**: FR-242 / Story 1.3·1.10
- **역할/계정**: (service_role/DB 직접)
- **사전조건**: audit_logs에 행 존재.
- **단계**: 1) `update audit_logs set action='login' where id=<x>` 2) `delete from audit_logs where id=<x>` (service_role 연결)
- **기대결과**: BEFORE 트리거 `audit_logs_block_mutation` → "audit_logs is append-only — UPDATE/DELETE is not permitted" 예외(insufficient_privilege). GRANT도 UPDATE/DELETE 전 역할 회수. RLS no_update/no_delete using(false). 어떤 경로로도 변조 불가.
- **유형**: 보안/감사

### TC-E1-51: 휴직/퇴사 직원 권한 무효화(방어심층 — has_permission/auth_user_role)
- **검증**: FR-215·240 / Story 1.3·1.8
- **역할/계정**: admin (대상: 권한 보유 직원, 예: doctor)
- **사전조건**: doctor active.
- **단계**: 1) doctor 휴직 처리 2) (doctor 기존 토큰이 아직 유효하다면) doctor 토큰으로 `GET /v1/auth/me`·권한 필요 엔드포인트 호출 3) doctor의 supabase 직접 조회로 `rpc('auth_user_role')`
- **기대결과**: `auth_user_role()`/`has_permission()`이 `employment_status='active'`만 인정 → 휴직 즉시 role=NULL, 권한 0. `/auth/me` role:null·is_staff:false, 권한 엔드포인트 403. ban으로 신규 로그인도 차단. (DB 헬퍼가 ban과 독립적인 2차 방어선.)
- **유형**: 권한·보안

### TC-E1-52: RLS — 직원이 타인 users 행 직접 조회 불가(본인행만)
- **검증**: FR-240 / Story 1.3
- **역할/계정**: doctor@pms.local
- **사전조건**: doctor의 supabase-js 세션.
- **단계**: 1) `supabase.from('users').select('*')` 2) `supabase.from('users').select('*').eq('id', '<admin uid>')`
- **기대결과**: `users_select_self` RLS(id = auth.uid())로 본인 행 1건만 반환. 타인행 0건. 전직원 목록은 FastAPI(service_role) 경유만 가능(TC-25). roles/permissions/role_permissions는 카탈로그라 authenticated SELECT 허용(using true).
- **유형**: 권한·보안/RLS

### TC-E1-53: RLS — 환자 행 본인만(직원은 patient.read 필요)
- **검증**: FR-240 / Story 1.3(헬퍼)·3.1(0009)
- **역할/계정**: nurse@pms.local (patient.read 0), doctor@pms.local (patient.read 보유)
- **사전조건**: 환자 1명 등록.
- **단계**: 1) nurse supabase-js로 `from('patients').select('*')` 2) doctor supabase-js로 동일
- **기대결과**: nurse → 0건(patients_select_staff = has_permission('patient.read') false, 본인 환자도 아님). doctor → 전체 환자(patient.read true). 환자 본인은 auth_uid=auth.uid()로 본인행만(patients_select_self). 응답에 resident_no_enc/_hash 컬럼 제외(GRANT 제외 + 투영 방어심층).
- **유형**: 권한·보안/RLS

### TC-E1-54: 감사 actor 정확성 — GUC 주입(app.actor_id)
- **검증**: FR-242 / Story 1.5·1.3
- **역할/계정**: admin@pms.local
- **사전조건**: admin 로그인.
- **단계**: 1) admin이 권한 토글(TC-23) 또는 직원 생성 2) 해당 감사행의 actor_id가 admin sub인지 확인
- **기대결과**: `authenticated_conn`이 트랜잭션 시작 시 `request.jwt.claims`(sub→auth.uid())와 `app.actor_id` GUC를 SET LOCAL 주입 → 감사 트리거가 actor를 정확히 기록. service_role 풀은 auth.uid()가 NULL이므로 이 주입이 없으면 actor NULL이 됨.
- **유형**: 감사

### TC-E1-55: 비-UUID actor_id 캐스트 방어(자가-DoS 방지)
- **검증**: FR-242 / Story 1.3·1.9 (방어심층)
- **역할/계정**: (DB 직접/회귀 테스트)
- **사전조건**: roles 등 감사 대상 테이블.
- **단계**: 1) `set local app.actor_id='not-a-uuid'` 후 감사 대상 테이블 INSERT 2) (decrypt_sensitive·reveal_contact 동일 경로)
- **기대결과**: 트리거가 UUID 정규식 검증 후에만 ::uuid 캐스트 → 비-UUID는 캐스트 안 하고 auth.uid() 폴백(NULL 가능). 원본 트랜잭션 abort되지 않음(자가-DoS 방지). 정상 쓰기 성공.
- **유형**: 경계/보안

### TC-E1-56: JWKS 일시 장애 → 503(전면 500 금지)
- **검증**: FR-213 / Story 1.5 (AC7)
- **역할/계정**: (인프라 시뮬)
- **사전조건**: JWKS 엔드포인트 도달 불가 상황 시뮬(네트워크 차단 또는 설정 오류) — 또는 통합 테스트.
- **단계**: 1) JWKS 호스트 차단 후 `GET /v1/auth/me` 토큰과 함께 호출
- **기대결과**: PyJWKClientConnectionError → ServiceUnavailableError(503). 전면 500 아님. DB 일시 장애(asyncpg PostgresError 등)도 503 매핑(`_run_authed`).
- **유형**: 예외(인프라)

### TC-E1-57: 권한 게이트 UI 표현 — 잠금 액션(PermissionGate/LockedAction)
- **검증**: FR-213 / Story 1.6 / UX-DR8·18·20
- **역할/계정**: 권한 미보유 컨텍스트(예: reception이 reveal_rrn 미보유 화면)
- **사전조건**: PermissionGate를 쓰는 화면 도달(Epic 4 진료 허브가 첫 소비, Epic 1에서는 컴포넌트 동작 검증).
- **단계**: 1) 권한 없는 액션 영역 확인
- **기대결과**: disabled가 아닌 `aria-disabled="true"` 버튼 + 자물쇠 아이콘 + 한국어 사유(aria-describedby) — 포커스 가능(스크린리더 낭독). 색/툴팁만 아님. 보안 경계 아니라 FastAPI 403이 최종 차단(UI는 학습 레이어).
- **유형**: 정상(UX 게이트)

### TC-E1-58: 전역 셸 골격·디자인 시스템(시각 회귀)
- **검증**: (기반) / Story 1.1·1.2
- **역할/계정**: admin@pms.local
- **사전조건**: 로그인.
- **단계**: 1) 사이드바 접기/펼치기(Topbar 토글) 2) 로고 "한빛 정형외과"·역할 라벨·섹션 캡션 확인 3) Pretendard 폰트·Lucide 아이콘·라이트 테마(임상 틸 액센트) 확인
- **기대결과**: AppShell(Sidebar+Topbar+main) 렌더, 접힘 시 w-sidebar-collapsed·아이콘만, 활성 메뉴 좌측 teal 액센트 바. 빈 섹션 캡션 없음. 4서피스 스캐폴드(api/web/mobile/supabase)·web :3002 정상 기동.
- **유형**: 정상(기반)

### TC-E1-59: 클라이언트 권한 데이터는 보안 경계 아님(fail-closed 디폴트)
- **검증**: FR-213 / Story 1.6
- **역할/계정**: (권한 조회 실패 시뮬) 또는 비직원
- **사전조건**: fetchUserPermissions가 RLS/transient 오류를 만나는 상황.
- **단계**: 1) 권한 조회 실패 경로(예: 비직원 세션) → 사이드바 2) 실패 시 콘솔 경고 확인
- **기대결과**: 오류/비직원 → 빈 권한 배열(fail-closed) → 관리 메뉴 숨김. 콘솔에 "[fetchUserPermissions] … 빈 권한으로 강등" 경고(무신호 붕괴 관측성). UI 게이트는 학습/속도 레이어 — 실제 차단은 서버.
- **유형**: 경계/보안

### TC-E1-60: 환자 자가가입 경로 분기(비직원 → /portal)
- **검증**: FR-212 / Story 1.4 (Epic 3.4 연계)
- **역할/계정**: (환자 자가가입 계정 — Epic 3.4 생성)
- **사전조건**: `/signup`으로 환자 가입(Epic 3.4) 또는 직원 행 없는 auth 사용자.
- **단계**: 1) `/login`에서 환자 계정 로그인 2) 착지 경로 확인
- **기대결과**: `auth_user_role()` NULL → `landingPathForRole` = PATIENT_HOME(/portal). 직원 영역 접근 시 requireStaff 강등. (Epic 1 단독 검증은 branch.ts/guards.ts 로직 확인으로 대체 가능.)
- **유형**: 정상(분기)

---

## FR 커버리지 체크
| 담당 FR | 커버 시나리오 | 비고 |
|---|---|---|
| FR-210 역할·권한 N:M 관리 | TC-16, 17, 22, 25 | roles/permissions/role_permissions 매트릭스·grant/revoke |
| FR-211 관리자 권한 토글(코드수정 없이 즉시반영) | TC-16, 17, 18, 19, 20, 21, 22, 23, 24 | 저장버튼 없음·민감 확인·admin/patient 차단·멱등 |
| FR-212 분리 프로필 로그인 분기 | TC-01, 02, 03, 05, 06, 14, 51, 60 | 직원=users.id=auth uid / 환자=auth_uid, landingPathForRole |
| FR-213 화면·기능·데이터 접근 역할 권한 제어 | TC-04, 07, 08, 10, 11, 12, 13, 15, 24, 36, 43, 49, 57, 59 | 비노출(메뉴) + 거부(403/redirect/RLS) |
| FR-214 직원 계정 생성·역할/소속/면허 관리 | TC-25, 26, 27, 28, 29, 30, 37 | GoTrue+프로필 2단계·보상삭제·진료과 배정 |
| FR-215 재직상태 관리·휴직/퇴사 접근차단 | TC-31, 32, 33, 34, 35, 51 | DB 접근권위 + GoTrue ban·자가락아웃 409 |
| FR-240 RLS(환자 본인·직원 역할별) DB 강제 | TC-52, 53, (51) | users 본인행·patients self/staff·헬퍼 active 필터 |
| FR-241 주민번호 pgcrypto 암호화·키 Vault | TC-38, 39, 40, 41, 42, 43 | enc/dec 라운드트립·Vault 키·service_role only·reveal |
| FR-242 주요작업·민감조회 감사로그 | TC-23, 39, 42, 48, 50, 54, 55 | 자동 트리거·복호=read·append-only·actor 정확성 |
| FR-243 관리자 감사로그 조회·필터(행위자/기간/대상) | TC-44, 45, 46, 47, 48, 49 | 페이지·필터·역전기간 422·마스킹·권한게이트 |
| (기반) 스캐폴드·디자인 시스템 | TC-58 | 4서피스·AppShell·토큰 |
