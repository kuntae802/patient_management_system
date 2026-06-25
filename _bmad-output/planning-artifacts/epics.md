---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-patient_management_system-2026-06-18/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-designs/ux-patient_management_system-2026-06-19/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-patient_management_system-2026-06-19/EXPERIENCE.md
---

# patient_management_system - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for patient_management_system, decomposing the requirements from the PRD, UX Design, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

> PRD §5~6의 전역 고유 번호(FR-NNN)를 그대로 보존한다. 70개 FR / 18 그룹.

**환자 신원·등록**
- FR-001: 환자는 모바일 앱에서 직접 회원가입(본인인증)하여 환자 계정을 생성할 수 있다. (본인인증=시뮬레이션)
- FR-002: 원무 직원은 앱 미사용 환자(전화·방문·고령자)의 환자 레코드를 직접 생성할 수 있다(`auth_uid` 미설정).
- FR-003: 원무가 생성한 환자가 이후 앱 가입 시, 본인인증으로 기존 레코드와 자동 연결된다(중복 환자 방지).
- FR-004: 원무·의사는 환자의 임상 프로필(혈액형·알레르기·기저질환·복용약·특이사항)을 입력·갱신한다.
- FR-005: 의사는 진료 화면에서 환자 임상 프로필을 조회한다(처방·처치 안전 참조).
- FR-006: 시스템은 환자 보호자 정보(성명·연락처·관계)를 기록한다.

**예약**
- FR-010: 환자는 앱에서 진료과·의사·가능 시간 슬롯을 조회하고 예약할 수 있다.
- FR-011: 원무 직원은 전화·방문 환자를 대신해 예약을 생성·변경·취소할 수 있다.
- FR-012: 시스템은 의사 근무표·휴진 예외를 반영해 예약 가능 슬롯만 노출한다.
- FR-013: 시스템은 동일 슬롯의 더블부킹을 차단한다(오버부킹은 정책 설정 시 허용).
- FR-014: 시스템은 예약 3일 전·1일 전 SMS 리마인더를 발송하고 발송 이력을 기록한다. (발송=시뮬/로그)
- FR-015: 시스템은 환자별 노쇼 횟수를 기록하고, 임계치(기본 2회) 초과 시 예약을 제한한다.
- FR-016: 의사 휴진 등록 시, 영향받는 예약을 표시하고 재배정·안내를 지원한다.

**접수·대기**
- FR-020: 원무 직원은 도착한 예약 환자를 접수하여 내원(Encounter)을 생성하고 '접수' 상태로 전환, 진료과 대기열에 등록한다.
- FR-021: 예약 없이 방문한 환자(walk-in)도 원무가 즉석 접수할 수 있다.
- FR-022: 시스템은 진료과·진료실별 실시간 대기 현황과 순번을 제공한다.
- FR-023: 시스템은 순번에 따라 "다음 호출 환자"를 안내하고 호출 상태를 기록하여, 중복 호출·누락을 방지한다.

**진찰**
- FR-030: 의사는 접수 완료된 환자의 진료 대기열을 조회하고, 진찰을 시작하여 내원을 '진행중' 상태로 전환한다.
- FR-031: 의사는 환자의 과거 내원·진단·처방·검사결과 이력을 타임라인/요약으로 한 화면에서 조회한다.
- FR-032: 의사는 해당 내원의 간호 활력징후 등 사전 입력 데이터를 진료 화면에서 확인한다.

**SOAP 진료기록·진단**
- FR-040: 의사는 진료기록을 SOAP(주관적·객관적·평가·계획) 형식으로 작성·저장한다.
- FR-041: 하나의 내원에 복수의 진료기록(1:N)을 남길 수 있다.
- FR-042: 의사는 평가(A)에 진단을 KCD 진단코드 마스터에서 선택해 부착하고, 주진단/부진단을 구분한다.

**처방 오더(약)**
- FR-050: 의사는 약품 마스터에서 약을 선택해 처방전을 발행한다(처방전 헤더 + 처방상세 라인: 약품·용량·횟수·일수·용법).
- FR-051: 처방은 해당 진단(A)과 연결되어 근거가 기록된다.
- FR-052: 시스템은 동일 성분 중복 처방 시 경고를 제공한다.

**검사·영상 오더**
- FR-060: 의사는 진단검사·영상검사를 오더한다. 오더는 지시 의사를 기록하고 '지시' 상태로 생성된다.
- FR-061: 영상검사 오더는 방사선사 워크리스트로, 진단검사(검체) 오더는 간호 워크리스트(채취 후 외부 의뢰)로 전달된다. 외부 의뢰 결과는 기록으로 반영한다.

**처치 오더**
- FR-070: 의사는 처치를 오더한다. 오더는 지시 의사를 기록하고 '지시' 상태로 생성되어 간호 워크리스트로 전달된다.

**오더 공통(지시→수행)**
- FR-080: 모든 오더는 유형별 생명주기를 따른다 — 처방: 발행→발급(원외 약국, 시스템 내 수행자 없음); 검사·영상: 지시→수행→판독/완료; 처치: 지시→수행→완료. 지시자·수행자·시각이 기록된다.
- FR-081: 확정된 진단·수행 오더는 수가 자동발생의 근거가 되어 수납 정산에 반영된다.

**간호 — 활력징후·처치 수행**
- FR-090: 간호사는 자신의 처치 워크리스트(지시된 처치 오더)를 조회한다.
- FR-091: 간호사는 활력징후(혈압·맥박·체온·호흡수·SpO2 등)를 측정·기록한다(활력징후 전용 기록).
- FR-092: 간호사는 지시된 처치 오더를 수행 처리하고 처치기록(수행자·시각·내용)을 남긴다 → 해당 오더가 '수행' 상태로 전환된다.
- FR-093: 시스템은 이미 수행된 오더의 재수행을 막아 처치 중복·누락을 방지한다.
- FR-094: 간호사는 오더 없이도 일상 간호기록을 남길 수 있다(처치 오더 연결은 선택).

**방사선 — 영상검사 촬영·판독**
- FR-100: 방사선사는 촬영 워크리스트(지시된 영상검사 오더)와 대기 목록을 조회한다.
- FR-101: 방사선사는 촬영을 수행 처리하고, 영상 자료는 스토리지에 저장한 뒤 URL만 DB에 연결한다.
- FR-102: 의사(판독의)는 영상 판독 소견을 기록하고, 해당 검사 오더가 완료 처리된다. (판독=진료의 겸임 허용)
- FR-103: 시스템은 검사장비 목록·상태를 표시하여 촬영 배정·가용성 확인에 활용한다.

**수납·정산**
- FR-110: 시스템은 진찰·오더에서 자동발생한 수가 항목을 집계하여 수납 건을 생성한다(수납 헤더 + 수납상세 라인).
- FR-111: 시스템은 급여(본인부담/공단부담)·비급여를 구분하여 본인부담금을 산정한다.
- FR-112: 원무 직원은 수납을 처리하고(결제 수단·금액 기록) 내원을 '완료' 상태로 전환한다. (결제=기록만, 실 PG 범위 밖)
- FR-113: 시스템은 표준 「진료비 계산서·영수증」을 출력한다(대분류 항목, 급여/비급여 구분, 본인부담총액·이미 납부·납부할 금액 3행 합계).
- FR-114: 시스템은 「진료비 세부산정내역서」를 출력한다(라인: 항목분류·일자·코드·명칭·단가·횟수·일수·금액·본인부담·공단부담).
- FR-115: 원무 직원은 원외처방전을 출력·발급한다.
- FR-116: 시스템은 수가 자동발생 규칙에 따라 항목을 적재한다 — 진찰료=진찰 시, 검사·처치·영상 수가=오더 수행 완료 시, 약제비=처방 발행 시.
- FR-117: 시스템은 수납 정책(후수납 기본 / 선수납 옵션)을 지원한다.
- FR-118: 취소·노쇼로 종결된 내원은 수가 미발생으로 처리한다(노쇼 수수료 정책 적용 시 별도 항목 부과 가능).
- FR-119: 부분 수행(일부 오더만 수행 후 이탈) 내원도 수행된 항목까지 수납·정산할 수 있다.

**환자 포털 — 본인 내역 조회**
- FR-120: 환자는 앱에서 본인의 내원 이력(예약·진찰·진단)을 조회한다.
- FR-121: 환자는 본인의 처방·검사 결과 내역을 조회한다.
- FR-122: 환자는 본인의 수납 내역·영수증을 조회한다.

**마스터 데이터 관리**
- FR-200: 관리자는 진료과·진료실 마스터를 관리(생성·수정·비활성)한다.
- FR-201: 관리자는 진단(KCD)·수가(EDI 행위)·약품 마스터를 관리하며, 각 코드는 버전·유효기간(발효/만료)을 갖는다.
- FR-202: 모든 임상·정산 입력은 마스터에서 선택하며, 비표준 자유 입력을 제한하여 단일 진실을 강제한다.
- FR-203: 마스터 데이터는 비활성(soft delete)으로 처리하여, 과거 기록이 참조하는 코드의 무결성을 유지한다.

**역할·권한 관리 (RBAC)**
- FR-210: 시스템은 역할과 권한(`리소스.동작` 코드)을 N:M으로 관리한다.
- FR-211: 관리자는 관리자 화면에서 역할별 권한을 체크박스로 토글한다(코드 수정 없이 즉시 반영).
- FR-212: 직원·환자 신원은 분리 프로필로 구분되며, 로그인 시 uid 소속 테이블로 직원/환자를 분기한다.
- FR-213: 화면·기능·데이터 접근은 사용자의 역할 권한에 따라 제어된다(권한 없는 기능은 비노출 또는 거부).
- FR-214: 관리자는 직원 계정을 생성하고 역할·소속 진료과·면허번호 등 프로필을 관리한다.
- FR-215: 관리자는 직원의 재직상태(재직·휴직·퇴사)를 관리하며, 휴직·퇴사 시 접근을 차단한다.

**근무표·스케줄 관리**
- FR-220: 관리자는 의사별 근무표(요일·시간대·진료실)를 등록·관리한다.
- FR-221: 관리자는 휴진·예외(휴가·학회 등)를 등록하며, 이는 예약 가능 슬롯(FR-012)·휴진 재배정(FR-016)의 근거가 된다.

**운영 통계·대시보드**
- FR-230: 관리자는 운영 현황(일별 내원·대기·매출·노쇼율 등) 대시보드·통계를 조회한다.

**보안·신뢰 (횡단 강제)**
- FR-240: 행 수준 보안(RLS): 환자는 본인 데이터만, 직원은 역할별 접근만 가능하도록 데이터베이스가 직접 강제한다.
- FR-241: 주민등록번호 등 민감정보는 pgcrypto로 암호화 저장하며, 키는 Supabase Vault에 보관한다(코드·DB에 키 미보관).
- FR-242: 주요 작업(생성·수정·삭제 및 민감정보 조회 등)은 행위자·시각·대상·동작과 함께 감사로그로 기록된다.
- FR-243: 관리자는 감사로그를 조회·필터링(행위자·기간·대상별)한다.

### NonFunctional Requirements

> PRD §7. 17개 NFR.

- NFR-001: 주요 화면(대기열·진료·수납)의 일반 조회 응답은 통상 2초 이내를 목표로 한다. (데모 환경 기준)
- NFR-002: 대기 현황·워크리스트는 5초 이내로 갱신된다(실시간 구독 또는 폴링).
- NFR-010: 직원용 클라이언트는 데스크톱 웹(최신 Chromium 계열 브라우저)에서 동작한다.
- NFR-011: 환자용 클라이언트는 Android 모바일 앱(APK)으로 배포한다.
- NFR-012: 백엔드·인증·스토리지는 Supabase(PostgreSQL)를 사용한다.
- NFR-020: 모든 클라이언트–서버 통신은 TLS(HTTPS)로 암호화한다.
- NFR-021: 인증은 Supabase Auth를 사용하며, 최소권한 원칙(RBAC)에 따라 접근을 제한한다.
- NFR-022: 개인정보보호 표준의 "형태"(암호화·접근통제·감사)는 충실히 모사하되, 공식 인증은 범위 밖임을 명시한다.
- NFR-030: 데이터는 Supabase 관리형 백업에 의존하며, 정기 백업을 전제한다.
- NFR-031: 과제·데모 환경 기준 별도 SLA를 두지 않는다(상용 배포 시 정의). [ASSUMPTION]
- NFR-040: 내원·오더의 상태 전이는 정의된 규칙(상태머신)만 허용한다(역행·건너뛰기 방지). 취소·노쇼·부분수행 경로는 FR-118~119를 따른다.
- NFR-041: 임상·정산 데이터는 마스터 참조 무결성을 유지하며, 다단계 작업(수납 생성 등)은 트랜잭션으로 원자성을 보장한다.
- NFR-042: 감사로그는 추가 전용(append-only)으로, 사후 변조가 어렵도록 한다.
- NFR-050: 각 진료 단계 화면은 현재 내원에 대해 다음 수행 가능한 작업을 명시적으로 제시한다(다음 단계 안내/버튼).
- NFR-051: 각 역할 사용자는 자신의 권한 범위 내 기능만 화면에서 접근하며, 핵심 업무 플로우는 역할별 화면에서 외부 안내 없이 완결할 수 있다.
- NFR-052: 모든 UI와 표준 출력 문서는 한국어로 제공한다.
- NFR-060: 데이터 모델은 진료(Encounter)를 허브로 하여, 향후 입원(Inpatient) 갈래 확장을 수용할 수 있도록 설계한다.

### Additional Requirements

> Architecture가 결정한, 구현·스토리에 직접 영향을 주는 기술 요구사항. (각 항목은 다운스트림 스토리의 전제·게이트가 된다.)

- **[Init/Starter]** 첫 구현 스토리 = `git init` + GitHub 원격 + 초기 커밋 + **4개 미니멀 공식 스캐폴드**(`supabase init` / FastAPI(uv, `fastapi[standard]`) / `create-next-app` Next.js 16 / `flutter create` 웹뷰 셸) + basePath(`/patient_management_system`)·`root_path`·리버스 프록시 설정. 코드 작성 전 토대 고정. (무거운 올인원 SaaS 스타터는 평가 포인트를 대신 처리하므로 거부.)
- **[모노레포]** 단일 GitHub 리포, 디렉토리 `supabase/ api/ web/ mobile/ docs/`. 의미 있는 단위(스키마/인증/진료/…)마다 단계별 커밋(사용자 선호). 커밋·푸시는 승인 시 수행.
- **[스키마 단일 소유]** DDL·RLS·트리거·pgcrypto는 **Supabase CLI 마이그레이션**(`migrations/0001~0014`) 단일 소유. Alembic 미사용. TS 타입은 `supabase gen types`로 DB에서 생성(= 계약).
- **[상태머신 = DB 강제]** 내원·오더 상태를 Postgres enum + 전이 검증 트리거/RPC + CHECK로 강제(역행·건너뛰기 방지, NFR-040). 전이 RPC(예: `register_encounter`, `start_consult`, `complete_encounter`). 전이표 full matrix·취소 가능 시점은 `0007` 작성 시 확정(다운스트림).
- **[수가 자동발생 엔진 = DB 트리거 + 매핑 규칙(시드)]** 임상 이벤트(진찰/오더 수행완료/처방 발행)에 반응하는 DB 트리거가 수납상세를 **원자적 적재**. 행위→수가코드 매핑은 `fee_mappings` 규칙 + `seed.sql`로 외부화. FastAPI는 수납 finalize·진료비 문서 담당. *메커니즘 확정 / 매핑 시드 내용·청구 단순화 선은 수납 에픽 착수 전 결정(다운스트림).*
- **[인증]** Supabase Auth(ES256/JWKS), 분리 프로필(직원=`users.id`=uid / 환자=`patients.auth_uid` nullable). FastAPI는 JWKS로 `aud=authenticated` 검증.
- **[주민번호 암호화]** pgcrypto 컬럼 암호화(키=Vault, 암복호=service_role SECURITY DEFINER RPC) + **HMAC blind index**(`주민번호_hash`)로 중복 매칭(FR-003). 유효성: 형식+생년월일+성별/세기 자리(내국 1–4, 외국 5–8)=HARD, 체크섬=SOFT(경고). 화면 마스킹.
- **[RBAC 3계층]** UI 노출(웹) / FastAPI 명령 강제(쓰기 권위) / RLS 행 강제(데이터 권위). DB 헬퍼 `has_permission(code)`(SECURITY DEFINER). UI 게이트는 보안 경계가 아니라 학습·속도 레이어.
- **[RLS 전략]** 환자=소유 정책(`auth.uid() = patients.auth_uid`, 내원 경유), 직원=역할/권한 기반(SECURITY DEFINER 헬퍼로 조인 RLS 회피), `authenticated` 명시. service_role(FastAPI)는 우회하되 방어심층 유지. 테이블별 정책 세부는 `0014` 작성 시.
- **[감사 append-only]** `audit_logs` UPDATE/DELETE를 service_role 포함 **전 역할 REVOKE**, INSERT만 허용. 트리거 SECURITY DEFINER(owner=postgres). 변경 전/후 스냅샷.
- **[트랜잭션 원자성]** 수납 생성 등 다단계 작업의 원자성 보장(NFR-041).
- **[실시간]** Supabase `postgres_changes`(내원·오더), RLS 필터(진료과/진료실=대기열, 직역=워크리스트), 신선도 ≤5초.
- **[API 경로 분담]** 쓰기/명령→FastAPI(`/api/v1`, 상태 전이=액션 엔드포인트 `POST /encounters/{id}/register`), 단순 읽기→Supabase 직접(RLS), 복잡 집계·문서→FastAPI, 실시간→Supabase 구독. 에러 봉투 `{error:{code,message,detail}}` + HTTP(422/403/409/404/500). JSON 필드=snake_case(두 읽기 경로 일관성).
- **[프론트]** Next.js 16 App Router route group `(staff)`/`(patient)` + 미들웨어 가드. 서버상태=TanStack Query v5, UI상태=Zustand, 세션=Supabase 클라이언트, UI=shadcn/ui, 그리드=TanStack Table, 폼=RHF7+Zod4(Pydantic 거울). 공용 AppShell + 내원 상태별 next-action 어포던스.
- **[데이터 접근 = 무ORM 하이브리드]** 불변식=DB(트리거/제약/RPC), 오케스트레이션=FastAPI(asyncpg·SQLAlchemy Core + RPC), 단순조회=Supabase, Storage·Auth admin=supabase-py. 타입=Pydantic + 생성 TS 타입(ORM 스키마 모델 없음).
- **[배포]** 홈서버 Docker Compose(`web`+`api`) + Supabase 클라우드 관리형. 리버스 프록시 + Let's Encrypt, 도메인 `kuntae802.mooo.com`, 서브패스 `/patient_management_system`(전 서피스 + Supabase redirect + CORS + Flutter 웹뷰 base URL 전파). 환자 APK = `flutter build apk`.
- **[마스터 시드]** `seed.sql`로 EDI 수가·약품·KCD·진료과·진료실 마스터 시드 + 샘플. *수가 매핑 시드 내용은 미작성(다운스트림).*
- **[스토리지]** 영상자료 = Supabase Storage 버킷 + 서명 URL + RLS, DB엔 경로만.
- **[식별자 언어]** DB·API·코드 식별자 = 영문 snake_case/표준 케이싱. 한국어는 UI 라벨·주석·enum 표시명·문서에만. 영문↔한글 용어집(`docs/glossary.md`) 단일 진실, 신규 식별자 등재 후 사용.
- **[이월 스키마 갭 — 아키텍처 소유]** ① 마스터 3종 발효/만료 컬럼(FR-201) ② 환자 임상 프로필 입력/조회 경로 ③ 알림로그(`notification_logs`, SMS 시뮬) ④ 선/후수납 정책 플래그 ⑤ 오더 상태 어휘 통일(지시→수행→완료/판독) ⑥ 취소·노쇼·부분수행 정산 경로.
- **[시뮬 이음매(seam)]** SMS 리마인더·본인인증(PASS)·결제(PG)·EDI 청구·약국 처방 전송·검사 외부 의뢰는 실연동 대신 **연결 가능한 이음매**로 설계(자리만).
- **[CI/CD]** GitHub Actions(self-hosted runner 또는 push→`git pull && docker compose up -d`) + lint·typecheck·migration check. 강화는 Post-MVP.

### UX Design Requirements

> DESIGN.md(시각 시스템·11개 임상 컴포넌트) + EXPERIENCE.md(IA·상태·인터랙션·접근성·임상 안전·PII/감사·키 플로우)에서 추출한 **실행 가능한 작업 항목**. 각 UX-DR은 인수 기준을 가진 스토리로 분해 가능한 수준으로 명시한다. (충돌 시 EXPERIENCE spine > 목업.)

- **UX-DR1 (브랜드 색 시스템 + 대비 정책):** shadcn/ui on Tailwind 4 위 브랜드 델타 토큰 — 단일 액센트 teal(`primary #0E7C8E` / `primary-hover #0A6675` / `ring #0A6675`, teal=액션·브랜드 전용, 상태색 금지) + 5상태 기능색(예약 슬레이트·접수 앰버+`-ink`·진행중 인디고·완료 그린+`-ink`·취소 로즈, `danger`=취소 hex 공유) + 중립 램프. WCAG 2.1 AA 대비 정책 강제(본문/UI 텍스트 ≥4.5:1, 큰 텍스트/비텍스트 UI ≥3:1; raw 앰버·small teal-on-tint·연한 링·`text-disabled` 텍스트 등 미달 조합 금지).
- **UX-DR2 (타이포그래피):** Pretendard **자체 호스팅 번들**(@font-face/네트워크 없음, OS 무관 동일 렌더) + 윈도우 우선 폴백 스택(맑은 고딕). 타입 스케일(page-title 20/600, section 13/600, body 13–14/400, caption 12/400), 숫자=`tabular-nums`, 법정 서식(진료비 계산서·영수증·세부산정내역서)만 Batang serif 예외.
- **UX-DR3 (Shape·Spacing·Elevation):** 코너 반경 스케일(sm5/DEFAULT7/md8/lg10/xl11/full) + **big-seams-dense-interiors** 스페이싱 리듬(섹션 사이 여백 크게·안은 고밀도) + **음영 비의존 인코딩**(중요 신호=색 채움+테두리+글자 굵기; box-shadow에 의미 금지, 균일 카드화 거부 — 중요도 위계+헤어라인+톤 레이어링으로 분리).
- **UX-DR4 (전역 셸):** 좌 사이드바(접이식 240/60px, **RBAC 노출 게이트 — `usePermissions`로 권한 없는 항목 미렌더**, 활성=좌측 teal 액센트 바) + 상단 탑바(52px: 병원명/브레드크럼, `Ctrl K` 환자검색, KST 시계, 실시간 인디케이터, 알림 벨+배지, 아바타/역할 메뉴). 6역할 공통 상속. 진료 허브는 사이드바 아이콘 접힘 진입.
- **UX-DR5 (커맨드 팔레트):** 전역 `Ctrl K`(shadcn `Command`) — 환자 검색(이름·차트번호·연락처) 핵심 + 빠른 이동·동작. 결과 `aria-live`. 단축키 표기=`Ctrl`(NOT ⌘, 윈도우 우선).
- **UX-DR6 (status-badge A3):** 진료상태 5종을 **색 + 도형 글리프(○●◐✓✕) + (취소만)취소선**으로 중복 인코딩. 작은 점(8px) + 라벨 텍스트에 상태색(배경 0). 앰버 라벨=`status-received-ink`, 그린 작은 텍스트=`status-done-ink`. 같은 5색 체계를 **결제상태·예약상태·급여구분에 일관 재사용**. 상태머신 허용 전이만 액션 노출.
- **UX-DR7 (waiting-list-row 대기 현황판):** 기본=**상태별 그룹 섹션**(헤더=점+컬러 상태명+카운트 pill), 활성도 순(진행중→접수→예약→완료→취소), 완료/취소=접힘+muted. 정렬 토글(활성도/호출/대기시간). 행 우측=상태별 **다음-액션 ghost 버튼**(접수=호출·진료시작 / 예약=접수 / 진행중=완료). 상단 **"다음 호출" 히어로**. (원무·의사 공유 화면.)
- **UX-DR8 (button-ghost / next-action affordance, 1급 패턴):** 각 임상 단계 화면이 현재 내원의 **허용된 다음 전이만** 버튼 노출(상태별 버튼 수=상태머신 결정, 역행·건너뛰기 버튼 없음). `.key` 변형(teal 잉크+옅은 채움). **mutation 중 disable**(이중 제출 방지=중복방지 1차선). 고위험 비가역 다음-액션은 **신원 확인 confirm**. 권한 밖=`aria-disabled`+잠금(⊘)+사유(403, hover 툴팁 단독 금지).
- **UX-DR9 (patient-banner 환자 배너):** 상시 노출. 주민번호 **기본 마스킹**(`710314-2******`) + **권한 게이트 reveal**(눈 아이콘+"감사기록" 라벨, 조회 자체가 감사 이벤트). 연락처 등 **모든 PII reveal 동일 게이트**. 우측=진행중 상태 pill + 다음-액션 미러. 고위험 비가역 쓰기 전 신원(이름+차트번호) 재진술.
- **UX-DR10 (allergy-alert):** **음영 비의존**(`danger` 옅은 채움+보더+굵은 라벨+danger 채움 아이콘 박스). 배너 상단 상시 노출 **can't-miss**. `role="alert"`/`aria-live="assertive"` 낭독. **critical 알레르겐은 truncation/"더보기" 뒤 은닉 금지**(전부 노출+카운트, 중증도 순).
- **UX-DR11 (soap-ledger 진료 허브 중앙):** 3-pane(좌 컨텍스트 읽기전용 / 중앙 작성 primary / 우 오더) 중 중앙 = **full-bleed 1열 ledger**. 파트별 헤더 행(S/O/A/P 컬러 배지+한글+영문+설명어+우측 액션) + 본문 행(`cursor:text`, 최소높이 132px, hover=상호작용 암시, **포커스/입력 중=좌측 3px teal 액센트+옅은 틴트(음영 아님)**, placeholder=`text-muted` 가이드 단독의존 금지). 빈 파트는 글리프/라벨("비어 있음")로도 표시. **autosave 인디케이터**("자동 저장됨 · {시각}", polite).
- **UX-DR12 (diagnosis-block):** SOAP 위 박스. **KCD-8 검색 피커**(free-text 금지), 주/부상병 토글, 코드 칩(`status-inprogress` 잉크). 주상병 미지정 완료 시 422.
- **UX-DR13 (order-panel 오더 패널):** 우 ~320px(고밀도 시 300px). 처방/검사/영상/처치 탭(카운트 배지). **master picker**(약품·수가·진단 검색, free-text 금지). 오더 아이템=**추적 라인**(오더→수행: 지시자·수행자·시각). 급여/비급여 pay-chip. **알레르기↔오더 교차검증**(하드 블록 또는 사유기록 오버라이드+감사), **동일성분 중복 처방 경고**(FR-052), **수행완료 오더=잠금**(삭제·재수행 비활성, FR-093), **미수행/지연 오더=가시 인디케이터**(누락 0 디텍터), 수가 자동 산정 프리뷰. 권한 거부=비활성+잠금+사유.
- **UX-DR14 (fee-table 수납):** 수가 **자동 산정**("자동" teal 마커, free-text 없음). 결제상태 A3(미수납 로즈/부분 앰버/완료 그린). 결제수단 토글(카드/현금/계좌이체). **결제 완료 → 문서 출력**(다음-액션 게이트), 결제 확정=**신원 확인 confirm**(고위험 비가역). 후수납 기본/선수납 옵션, 취소·노쇼=수가 미발생, 부분수행=수행분 정산(FR-119). 법정 서식(계산서·영수증/세부내역서) **Batang serif** 미리보기→인쇄(`Ctrl P`)/PDF + **인쇄/PDF PII 정책**(주민번호 마스킹, 파일명 PII 금지, 내보내기=감사 이벤트).
- **UX-DR15 (slot-block 예약 캘린더):** 시간레일(09:00~17:30, 30분 고정) × **열=의사**, 기본 보기=일(Day). 슬롯 상태(가능/확정/노쇼/취소/휴진/점심)=**채움+테두리+패턴**(휴진=빗금, 음영 비의존). 빈 슬롯 클릭→**booking-peek 슬라이드오버**(진료과·의사·환자검색·날짜/시간·메모·SMS 체크·저장/취소). **더블부킹 인라인 차단(409)** + 경고 칩. 노쇼 임계(기본 2회) 초과 제한. 가능 슬롯만(근무표−예외−기예약 동적 계산). 휴진 등록 시 영향 예약 표시·재배정 prompt.
- **UX-DR16 (permission-cell RBAC 매트릭스):** 행=권한(6도메인 22개) × 열=역할(5). 허용=`primary` 채움+✓(음영/틴트 단독 금지), 차단=빈 셀, 관리자 열=고정(🔒 전체 허용·변경 불가). **민감 권한**(주민번호 표시·환자 삭제·수가 조정·권한 관리·감사 로그 조회)=⚠"민감" pill + **확인 단계 필수**(권한명+대상 역할 명시 confirm). 비민감 토글=즉시 적용. 스티키 헤더+첫 열. 변경=**감사 로그 자동 기록**.
- **UX-DR17 (patient-app 환자 앱):** 모바일/반응형(~390px), 큰 타입·**≥44px 터치 타깃**, 하단 3탭(예약/내 기록/마이). **예약 플로우**(진료과→의사→날짜 칩 레일→시간 슬롯 그리드→선택 요약→예약 확정 sticky CTA). **진료내역 카드**(날짜·상태 배지·의사·진단 쉬운 말 부연, 펼치면 처방 복약 안내+검사결과 정상/주의 플래그). **RLS 본인만** + 신뢰 노트 상시. 12시간 표기(오후 2:30). 자체 폰 셸(데스크톱 셸 미상속). 브라우저 줌 200% reflow·OS 동적 타입 존중(58세+).
- **UX-DR18 (State Patterns):** 로딩=**스켈레톤**(스피너 금지), 빈 상태=의미 있는 한국어 문장+단일 다음-액션, 실시간 stale=배너+"다시 연결"+**신선도 ≤5초 초과 시 중요 동작 버튼 가드**, 422=필드 인라인+해당 필드 포커스 이동+`aria-invalid`/`aria-describedby`, 403=사이드바 비노출/화면 내 `aria-disabled`+사유, 409=토스트(assertive)+"새로고침"+로컬 미저장 보존, 파괴적/민감=**확인 다이얼로그 필수+감사 스냅샷(전/후)**.
- **UX-DR19 (Interaction Primitives):** 키보드 우선(외형과 직교) — `Ctrl K` 팔레트, next-action 1급, 포커스 순서=읽기 순서, `Esc`=최상위 모달 닫기, **복합 위젯 roving-tabindex/2D 화살표**(SOAP ledger S→O→A→P, slot-grid 시간×의사, RBAC 매트릭스 110셀; Tab 순회 금지). 레거시 EMR 키보드 속도 보존(베테랑 반대지표).
- **UX-DR20 (Accessibility Floor):** 색만/음영만 의미 금지(색+글리프+굵기). 시맨틱 HTML/ARIA(네이티브 `<button>`/`<input>`/`<a>`, RBAC=`<table>`+`<th scope>`, 캘린더=`role="grid"`, 대기판=리스트 시맨틱, 아이콘 단독 버튼 전부 `aria-label`). 라이브 리전(안전경고 assertive/autosave polite/422 aria-describedby/필수 aria-required). 주민번호 reveal 접근성(접근가능명에 감사 경고 포함). 완전 키보드 조작+포커스 트랩/복원. `:focus-visible` 포커스 링 상시. 403 비활성=사유 낭독 가능. `prefers-reduced-motion` 존중. 환자앱 ≥44px·줌 200% reflow·동적 타입·대비 AA.
- **UX-DR21 (Clinical Safety Patterns):** ① 알레르기 can't-miss ② **알레르기↔오더 교차검증**(기록 알레르기 AND 활성 투약 대조→하드 블록/사유 오버라이드+감사, 모든 오더 적용) ③ 동일성분 중복 경고(FR-052) ④ 알레르기 오버플로 비은닉 ⑤ **재수행 차단**(FR-093, mutation disable 1차선+상태머신 최종선) ⑥ **오더 누락/지연 디텍터**(워크리스트+진료 허브 가시 인디케이터) ⑦ 오더→수행 추적(누가/언제/무엇) ⑧ **고위험 비가역 쓰기 신원 확인**(진료 완료/처방 발행/수납 확정/환자 삭제) ⑨ **다중 진료/스테일 탭 가드**(세션당 활성 내원 1개, 스테일 autosave 거부) ⑩ 동시 편집=낙관적 잠금/버전→409+행 잠금 ⑪ **스테일 실시간=쓰기 가드**(≤5초 초과 시 중요 동작 비활성+강제 새로고침).
- **UX-DR22 (PII · Audit Patterns):** 주민번호 마스킹+권한 reveal+조회 감사(리스트/그리드/검색도 기본 마스킹, per-row reveal 없음). **모든 PII reveal 일관 게이트**(연락처·주소·보험·보호자). 인쇄/PDF PII 정책(full 주민번호=권한+감사+사유 시만, 파일명 PII 금지, 내보내기=감사). **PII 경계**(raw PII는 로그·토스트·에러봉투·URL·딥링크·실시간 페이로드·PDF/파일명·클라 로그 금지; 라우트=`chart_no`/불투명 id; 실시간 select-list 민감컬럼 제외; 환자 포털=세션 uid 스코프, 클라 제공 patient_id 미수용). RLS 데이터 스코핑(본인 외 접근 0). **감사 로그 append-only**(읽기전용 diff 뷰어, 전/후 스냅샷; 포착 범위=모든 PII reveal+인쇄/PDF+상태 전이+RBAC 변경+파괴적 동작, 관리자 본인 조회도 예외 없이).
- **UX-DR23 (Voice/Tone + Responsive/Platform):** 100% 한국어 UI+표준 문서(i18n 프레임워크 없음, `Intl` ko-KR), 용어집 1:1, 오류 `code`=영문/`message`=한국어, 금액=KRW 정수("원", `tabular-nums`), **직원 24시간 / 환자 12시간** 시간 표기 분리, 환자앱 쉬운 말(임상 용어 풀어쓰기). 윈도우 우선(Edge/Chrome), **1366×768 @125–150% 고밀도 내성**(진료 허브 3-pane 축소 하한, 표 ~1280px 밀도 유지), 서브패스 basePath 전파, 환자앱 모바일 반응형.
- **UX-DR24 (Information Architecture):** 6역할 사이트맵(reception/doctor/nurse/radiology/admin/(patient)). **진료(Encounter) 허브 = master canvas**(URL `/encounter/{date}/{chart_no}`, SOAP·진단·처방·검사·처치·활력·수납을 묶는 스포크 허브). **환자 상세=별도 풀페이지**(이력 타임라인, 비-의사 진입 허용). 대기 현황판=원무·의사 공유(간호·방사선=직역별 워크리스트, RLS 필터). 알림=탑바 벨 드롭다운+"전체 보기" 링크(전용 페이지 없음). 모달 스택 1단계까지. 환자앱 v1 범위=예약+본인 조회.

### FR Coverage Map

> 70개 FR 전수 → 에픽 매핑(누락 0 검증).

- FR-001: Epic 3 — 환자 앱 자가가입(본인인증 시뮬)
- FR-002: Epic 3 — 원무 직접 환자 등록(auth_uid 미설정)
- FR-003: Epic 3 — 앱 가입 시 기존 레코드 자동 연결(HMAC 매칭)
- FR-004: Epic 3 — 환자 임상 프로필 입력·갱신
- FR-005: Epic 3 — 의사 임상 프로필 조회(안전 참조)
- FR-006: Epic 3 — 보호자 정보 기록
- FR-010: Epic 6 — 환자 앱 슬롯 조회·예약
- FR-011: Epic 6 — 원무 대리 예약 생성·변경·취소
- FR-012: Epic 6 — 근무표·휴진 반영 가능 슬롯
- FR-013: Epic 6 — 더블부킹 차단
- FR-014: Epic 6 — SMS 리마인더(시뮬)·이력
- FR-015: Epic 6 — 노쇼 카운트·임계치 제한
- FR-016: Epic 6 — 휴진 시 영향 예약 재배정
- FR-020: Epic 4 — 예약 환자 접수→내원 생성·대기열 등록
- FR-021: Epic 4 — walk-in 즉석 접수
- FR-022: Epic 4 — 실시간 대기 현황·순번
- FR-023: Epic 4 — 다음 호출 안내·중복 호출 방지
- FR-030: Epic 4 — 진료 대기열 조회·진찰 시작(진행중 전환)
- FR-031: Epic 4 — 과거 이력 타임라인/요약
- FR-032: Epic 4 — 사전 입력 데이터(활력 등) 확인
- FR-040: Epic 4 — SOAP 진료기록 작성·저장
- FR-041: Epic 4 — 한 내원 복수 진료기록(1:N)
- FR-042: Epic 4 — KCD 진단 부착·주/부진단 구분
- FR-050: Epic 5 — 약품 마스터 처방전 발행(헤더+상세)
- FR-051: Epic 5 — 처방↔진단 연결(근거)
- FR-052: Epic 5 — 동일 성분 중복 처방 경고
- FR-060: Epic 5 — 진단검사·영상검사 오더(지시 상태)
- FR-061: Epic 5 — 영상→방사선/검체→간호 워크리스트 분기
- FR-070: Epic 5 — 처치 오더(간호 워크리스트)
- FR-080: Epic 5 — 오더 유형별 생명주기·지시자/수행자/시각
- FR-081: Epic 5 — 수행 오더=수가 자동발생 근거(트리거 가동)
- FR-090: Epic 5 — 간호 처치 워크리스트 조회
- FR-091: Epic 5 — 활력징후 측정·기록
- FR-092: Epic 5 — 처치 수행·기록(수행 상태 전환)
- FR-093: Epic 5 — 재수행 차단(중복·누락 방지)
- FR-094: Epic 5 — 오더 없는 일상 간호기록
- FR-100: Epic 5 — 방사선 촬영 워크리스트·대기 목록
- FR-101: Epic 5 — 촬영 수행·영상 Storage 저장(URL만 DB)
- FR-102: Epic 5 — 판독 소견 기록·검사 오더 완료
- FR-103: Epic 5 — 검사장비 목록·상태
- FR-110: Epic 7 — 자동발생 수가 집계·수납 건 생성
- FR-111: Epic 7 — 급여/비급여 구분·본인부담 산정
- FR-112: Epic 7 — 수납 처리(결제 기록)·내원 완료
- FR-113: Epic 7 — 표준 진료비 계산서·영수증 출력
- FR-114: Epic 7 — 진료비 세부산정내역서 출력
- FR-115: Epic 7 — 원외처방전 출력·발급
- FR-116: Epic 7 — 수가 자동발생 규칙 적재
- FR-117: Epic 7 — 후수납 기본/선수납 옵션
- FR-118: Epic 7 — 취소·노쇼 수가 미발생
- FR-119: Epic 7 — 부분 수행 정산
- FR-120: Epic 8 — 환자 본인 내원 이력 조회
- FR-121: Epic 8 — 환자 본인 처방·검사 결과 조회
- FR-122: Epic 8 — 환자 본인 수납·영수증 조회
- FR-200: Epic 2 — 진료과·진료실 마스터 관리
- FR-201: Epic 2 — KCD·수가·약품 마스터(버전·유효기간)
- FR-202: Epic 2 — 마스터 선택 강제(자유 입력 제한)
- FR-203: Epic 2 — 마스터 soft delete(참조 무결성)
- FR-210: Epic 1 — 역할·권한 N:M 관리
- FR-211: Epic 1 — 관리자 권한 체크박스 토글(즉시 반영)
- FR-212: Epic 1 — 분리 프로필 신원·로그인 분기
- FR-213: Epic 1 — 역할 권한 기반 접근 제어
- FR-214: Epic 1 — 직원 계정 생성·프로필 관리
- FR-215: Epic 1 — 재직상태 관리·접근 차단
- FR-220: Epic 6 — 의사별 근무표 등록·관리
- FR-221: Epic 6 — 휴진·예외 등록(슬롯·재배정 근거)
- FR-230: Epic 8 — 운영 현황 대시보드·통계
- FR-240: Epic 1 — RLS 본인/역할별 강제
- FR-241: Epic 1 — pgcrypto 민감정보 암호화(Vault 키)
- FR-242: Epic 1 — 감사로그 기록
- FR-243: Epic 1 — 감사로그 조회·필터링
- FR-250: Epic 9 — 로그인 후 도움말 페이지 접근(공개 아님)
- FR-251: Epic 9 — 현재 계정 표시 메뉴만 안내·네비게이션바 인덱스
- FR-252: Epic 9 — 메뉴별 스크린샷·번호 하이라이트·설명
- FR-253: Epic 9 — 현재 계정 메뉴 전수·스크롤 파악

**NFR·UX-DR 횡단 처리:** NFR/보안·접근성·임상 안전 등은 단일 에픽이 아니라 여러 에픽에 횡단 적용된다 — 토대(NFR-010~012, NFR-020~022, NFR-040~042, UX-DR1~5,16,18~20,22)는 Epic 1, 실시간·next-action(NFR-002,050,051)은 Epic 4·5, 성능·문서·한국어(NFR-001,052)는 전 에픽, 확장성(NFR-060)은 Epic 4 내원 허브 설계에서 충족. 각 UX-DR은 해당 컴포넌트가 처음 등장하는 에픽의 스토리로 구체화한다.

## Epic List

### Epic 1: 플랫폼 기반 · 신원 · 접근 통제 (Foundation, Identity & Access Control)
시스템이 부팅되고, 직원·환자가 분리 프로필로 로그인하며, 관리자가 역할별 권한을 체크박스로 토글하고 직원 계정·재직상태를 관리한다. 모든 민감 작업이 감사로그로 남고, RLS·주민번호 암호화·디자인 시스템·전역 셸이 선다 — 모든 후속 화면의 전제. (아키텍처 Phase 0+1; Init 스캐폴드는 Story 1.1)
**FRs covered:** FR-210, FR-211, FR-212, FR-213, FR-214, FR-215, FR-240, FR-241, FR-242, FR-243

### Epic 2: 표준 마스터 데이터 (Master Data & Single Source of Truth)
관리자가 진료과·진료실·KCD진단·EDI수가·약품 마스터를 관리(버전·유효기간·soft delete)하고, 모든 임상·정산 입력이 마스터 검색 피커로 강제되어 단일 진실이 선다. (마스터 검색 피커는 임상·정산 에픽이 소비)
**FRs covered:** FR-200, FR-201, FR-202, FR-203

### Epic 3: 환자 등록 · 프로필 (Patient Registration & Profile)
원무가 환자 레코드를 직접 생성하고, 앱 미사용 환자도 등록되며, 앱 자가가입(본인인증 시뮬) 시 기존 레코드와 자동 연결(중복 방지)된다. 임상 프로필·보호자가 기록되고 전역 환자 검색(Ctrl K)이 동작한다.
**FRs covered:** FR-001, FR-002, FR-003, FR-004, FR-005, FR-006

### Epic 4: 내원 파이프라인 — 접수·대기·진찰·기록 (Encounter Pipeline)
원무가 예약/walk-in 환자를 접수해 내원을 생성하고, 대기 현황판이 "다음 호출"을 안내한다. 의사가 진료를 시작(진행중)해 과거 이력·활력을 한 화면(진료 허브)에서 보고 SOAP·KCD 진단을 기록한다 — 시스템의 심장. walk-in으로 예약 없이 독립 완결. (Phase 2)
**FRs covered:** FR-020, FR-021, FR-022, FR-023, FR-030, FR-031, FR-032, FR-040, FR-041, FR-042

### Epic 5: 오더 · 수행 — 처방·검사·처치·간호·방사선 (Orders & Fulfillment)
의사가 처방·검사·영상·처치를 오더하면 직역별 워크리스트로 흐르고, 간호사가 활력·처치를 수행(재수행 차단)하며, 방사선사가 촬영·영상 업로드하고 의사가 판독한다. 알레르기 교차검증·누락 0 디텍터가 안전을 강제하고, 수가 자동발생 트리거가 가동되기 시작한다. (Phase 3)
**FRs covered:** FR-050, FR-051, FR-052, FR-060, FR-061, FR-070, FR-080, FR-081, FR-090, FR-091, FR-092, FR-093, FR-094, FR-100, FR-101, FR-102, FR-103

### Epic 6: 예약 · 근무 스케줄 (Appointments & Scheduling)
관리자가 의사 근무표·휴진을 등록하고, 환자가 앱에서 가능 슬롯만 보고 예약하며(원무 대리 예약 포함), 더블부킹이 차단되고 SMS 리마인더(시뮬)·노쇼 제한·휴진 재배정이 동작한다. 생성된 예약은 Epic 4의 접수로 흘러든다. (Phase 4)
**FRs covered:** FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-220, FR-221

### Epic 7: 수납 · 정산 · 표준 문서 (Billing, Settlement & Standard Documents)
진찰·수행·처방에서 자동 적재된 수가를 원무가 정산하고(급여구분·본인부담), 표준 「진료비 계산서·영수증」·「세부산정내역서」·원외처방전을 출력하며, 후/선수납·취소/노쇼/부분수행 정산이 처리된다. (Phase 5)
**FRs covered:** FR-110, FR-111, FR-112, FR-113, FR-114, FR-115, FR-116, FR-117, FR-118, FR-119

### Epic 8: 환자 포털 · 운영 대시보드 (Patient Portal & Operations Dashboard)
환자가 앱에서 본인 내원·진단·처방·검사결과·수납내역을 쉬운 말로(본인 것만, RLS) 확인하고, 관리자가 일별 내원·매출·노쇼율 대시보드로 운영을 본다. 환자 앱이 Flutter 웹뷰 APK로 패키징된다. (Phase 4 포털 + Phase 5 대시보드)
**FRs covered:** FR-120, FR-121, FR-122, FR-230

### Epic 9: 도움말 · 온보딩 가이드 (Help & Onboarding)
로그인한 사용자가 자기 셸 안에서 도움말 페이지에 접근해, 현재 계정에 보이는 메뉴만(권한·역할로 가려진 건 미노출) 상단 네비게이션바로 골라 안내받는다. 각 메뉴 안내는 실제 화면 스크린샷·동작요소 번호 하이라이트·단계별 설명으로 구성되어, 스크롤만으로 그 계정의 전체 기능을 빠짐없이 파악한다. 신규 직원 온보딩 보조 — Epic 1~8 구현 완료 후 추가(2026-06-25).
**FRs covered:** FR-250, FR-251, FR-252, FR-253

## Epic 1: 플랫폼 기반 · 신원 · 접근 통제 (Foundation, Identity & Access Control)

시스템이 부팅되고, 직원·환자가 분리 프로필로 로그인하며, 관리자가 역할별 권한을 체크박스로 토글하고 직원 계정·재직상태를 관리한다. 모든 민감 작업이 감사로그로 남고, RLS·주민번호 암호화·디자인 시스템·전역 셸이 선다 — 모든 후속 화면의 전제. (아키텍처 Phase 0+1)

> **에픽 범위 노트:** RLS 헬퍼·감사 트리거·암호화 프리미티브는 여기서 토대를 놓고, 테이블별 RLS 정책과 주민번호 컬럼 적용은 해당 테이블을 만드는 에픽(예: 환자=Epic 3)에서 수행한다(엔티티는 필요할 때만 생성 원칙).

### Story 1.1: 모노레포 · 4개 서피스 스캐폴드 초기화 (Init)

As a 플랫폼 개발자,
I want 모노레포와 4개 공식 미니멀 스캐폴드(supabase/api/web/mobile)를 초기화하고 서브패스·리버스 프록시·용어집을 설정하기를,
So that 이후 모든 스토리가 고정된 토대 위에서 코드를 작성할 수 있다.

**Acceptance Criteria:**

**Given** 빈 작업 디렉토리에서
**When** `git init` + GitHub 원격 연결 + 초기 커밋을 수행하면
**Then** 모노레포 루트(`supabase/ api/ web/ mobile/ docs/`)와 `.gitignore`·`.env.example`·`docker-compose.yml`이 커밋된다
**And** 시크릿(키·`.env`)은 커밋되지 않는다

**Given** Supabase CLI가 설치된 상태에서
**When** `supabase init && supabase start`를 실행하면
**Then** 로컬 Postgres/Auth/Storage 스택이 기동하고 `supabase/migrations/`·`seed.sql` 골격이 생성된다

**Given** uv가 설치된 상태에서
**When** `uv init api` + `uv add "fastapi[standard]" "pyjwt[crypto]" supabase httpx` 후 `fastapi dev`를 실행하면
**Then** FastAPI가 `root_path=/patient_management_system/api`로 기동하고 헬스 엔드포인트가 응답한다

**Given** Node가 설치된 상태에서
**When** `create-next-app web`(TS/Tailwind/App Router/`src`) + `@supabase/supabase-js @supabase/ssr` 설치 + `basePath=/patient_management_system` 설정 시
**Then** 웹앱이 서브패스에서 정상 렌더된다

**Given** Flutter가 설치된 상태에서
**When** `flutter create mobile` + `webview_flutter` 추가 + base URL을 공개 도메인 서브패스로 설정하면
**Then** 웹뷰 셸이 `kuntae802.mooo.com/patient_management_system`을 로드하도록 구성된다(Android API 24+)

**Given** 리버스 프록시 환경에서
**When** Let's Encrypt TLS + 서브패스 라우팅 + CORS 화이트리스트를 구성하면
**Then** web·api·Supabase Auth redirect URL·Flutter 웹뷰 base URL이 모두 동일 서브패스를 반영한다
**And** `docs/glossary.md`(영문↔한글 용어집)와 `docs/project-context.md`(에이전트 규칙)가 시드되고, 모든 식별자는 영문 snake_case다

### Story 1.2: 디자인 시스템 토큰 · 전역 셸 골격

As a 프론트엔드 개발자,
I want shadcn/ui on Tailwind 4 위에 브랜드 토큰과 AppShell(사이드바+탑바) 골격, 공통 상태·접근성 기본을 세우기를,
So that 모든 역할 화면이 일관된 시각·인터랙션·접근성 토대를 상속한다.

**Acceptance Criteria:**

**Given** Tailwind 4 + shadcn/ui가 설치된 상태에서
**When** 브랜드 토큰(액센트 teal·5상태 기능색·중립 램프, UX-DR1)을 정의하면
**Then** 모든 색 조합이 WCAG 2.1 AA(본문 ≥4.5:1, 큰 텍스트/UI ≥3:1)를 충족하고, teal은 액션/브랜드 전용이며 상태색으로 쓰이지 않는다

**Given** 폰트 자산이 번들된 상태에서
**When** Pretendard 자체 호스팅 + 윈도우 우선 폴백 스택(UX-DR2)을 적용하면
**Then** @font-face/네트워크 없이 OS 무관 동일 렌더가 되고, 타입 스케일(page-title/section/body/caption)과 `tabular-nums`가 적용된다

**Given** 디자인 시스템이 로드된 상태에서
**When** 코너 반경 스케일·big-seams-dense-interiors 스페이싱·음영 비의존 인코딩 규칙(UX-DR3)을 적용하면
**Then** 중요 신호는 색 채움+테두리+굵기로 표현되고 box-shadow에 의미를 싣지 않는다

**Given** 인증·권한이 아직 없는 정적 상태에서
**When** AppShell(좌 사이드바 240/60px + 상단 탑바 52px, UX-DR4)을 렌더하면
**Then** 셸 골격(병원명·시계·벨·아바타 슬롯)이 정상 표시되고, 역할 내비 항목은 권한 연동 자리(placeholder)로 준비된다

**Given** 공통 UI 상태가 발생할 때
**When** 로딩=스켈레톤(스피너 금지)·빈 상태·토스트·`:focus-visible` 포커스 링(UX-DR18·UX-DR20)을 구현하면
**Then** 네이티브 시맨틱 요소(`<button>`/`<input>`/`<a>`)와 포커스 링이 일관 동작한다

### Story 1.3: 신원·RBAC 스키마 · RLS 헬퍼 · 감사 트리거 (DB)

As a 백엔드 개발자,
I want 직원 신원·역할·권한 테이블과 RLS 헬퍼 함수, append-only 감사 트리거를 마이그레이션으로 만들기를,
So that 이후 모든 인증·인가·감사가 DB가 강제하는 단일 진실 위에서 동작한다.

**Acceptance Criteria:**

**Given** 빈 스키마에서
**When** 마이그레이션 `0002_identity_rbac.sql`(users, roles, permissions, role_permissions)을 적용하면
**Then** 직원=`users.id`(=auth uid), 역할↔권한 N:M(`리소스.동작` 코드)이 생성된다(FR-210)

**Given** RBAC 테이블이 존재할 때
**When** `0003_rls_helpers.sql`로 `has_permission(code)`·`auth_user_role()`(SECURITY DEFINER)를 만들면
**Then** RLS 정책이 조인 없이 권한을 평가할 수 있고, 환자/직원 경계의 RLS 토대가 선다(FR-240 헬퍼)

**Given** 감사 대상 작업이 발생할 때
**When** `0004_audit.sql`로 `audit_logs` + 트리거(SECURITY DEFINER, owner=postgres)를 만들고 UPDATE/DELETE를 service_role 포함 전 역할 REVOKE(INSERT만)하면
**Then** 행위자·시각·대상·동작과 변경 전/후 스냅샷이 기록되고, append-only가 강제된다(FR-242, NFR-042)

**And** 모든 enum·식별자는 영문 snake_case이며 용어집에 등재된다

### Story 1.4: 분리 프로필 로그인 (Supabase Auth)

As a 직원 또는 환자,
I want 내 계정으로 로그인하면 시스템이 직원/환자를 자동 분기해 주기를,
So that 각자 올바른 서피스로 진입한다.

**Acceptance Criteria:**

**Given** 로그인 화면에서
**When** 자격 증명으로 Supabase Auth 로그인하면
**Then** `@supabase/ssr` 쿠키 세션이 수립되고, uid 소속 테이블(`users` vs `patients.auth_uid`)로 직원/환자가 분기된다(FR-212)

**Given** 직원으로 분기된 경우
**When** 로그인 직후 라우팅되면
**Then** `(staff)` 영역으로, 환자는 `(patient)` 영역으로 이동한다

**Given** 잘못된 자격 증명일 때
**When** 로그인 시도하면
**Then** 한국어 오류 메시지가 표시되고, 오류 envelope/로그에 PII가 노출되지 않는다

**And** 단축키·시각·서브패스(basePath)가 Supabase Auth redirect URL에 정확히 반영된다

### Story 1.5: FastAPI 인증·RBAC 강제 (JWKS + 권한 의존성)

As a 백엔드 개발자,
I want FastAPI가 Supabase JWT(JWKS)를 검증하고 `has_permission` 기반 권한 의존성을 모든 명령 엔드포인트에 강제하기를,
So that 쓰기/명령의 권위가 서버에서 보장된다(UI 게이트와 무관하게).

**Acceptance Criteria:**

**Given** 클라이언트가 `Bearer` 토큰을 첨부할 때
**When** FastAPI가 JWKS로 서명·`aud=authenticated`를 검증하면
**Then** 유효 토큰만 통과하고, 만료/위조 토큰은 401로 거부된다

**Given** 권한이 필요한 명령 엔드포인트에서
**When** 사용자의 역할 권한을 `has_permission(code)`로 확인하면
**Then** 권한 없는 요청은 `{error:{code,message,detail}}` 봉투와 함께 403으로 거부된다(FR-213 쓰기 권위)

**Given** `/api/v1` 라우터에서
**When** OpenAPI 문서를 생성하면
**Then** JSON 필드가 snake_case이고 에러 표준(422/403/409/404/500)이 일관 적용된다

### Story 1.6: 미들웨어 가드 · 역할별 셸 노출 (RBAC UI 게이트)

As a 직원,
I want 내 역할 권한에 맞는 메뉴만 보이고 권한 밖 화면에는 진입이 막히기를,
So that 신규 직원이 자기 일에 집중하고 권한 밖 기능을 학습적으로 인지한다.

**Acceptance Criteria:**

**Given** 로그인된 직원 세션에서
**When** Next 미들웨어가 세션·역할을 가드하면
**Then** 권한 없는 라우트 직접 접근이 차단되고 로그인/홈으로 리다이렉트된다

**Given** 전역 셸이 렌더될 때
**When** `usePermissions` 훅이 사이드바 항목을 평가하면
**Then** 권한 없는 항목은 렌더되지 않는다(숨김; UX-DR4 게이트)

**Given** 화면 내 권한 밖 액션에 대해
**When** 사용자가 그 액션을 마주하면
**Then** `aria-disabled`+잠금(⊘)+사유가 제공되어(403, UX-DR18) 숨기지 않고 학습을 유도한다

### Story 1.7: RBAC 권한 매트릭스 (관리자)

As a 관리자/원장,
I want 역할별 권한을 매트릭스에서 체크박스로 토글하기를,
So that 코드 수정 없이 즉시 접근 정책을 바꿀 수 있다.

**Acceptance Criteria:**

**Given** 관리자 권한으로 RBAC 화면에서
**When** 권한 매트릭스(행=권한 6도메인 22개 × 열=역할 5, UX-DR16)를 열면
**Then** 허용=teal 채움+✓, 차단=빈 셀, 관리자 열=고정(🔒), 스티키 헤더/첫 열로 표시된다

**Given** 비민감 권한 셀에서
**When** 토글하면
**Then** 즉시 적용(저장 버튼 없음)되고 변경이 감사 로그에 자동 기록된다(FR-211)

**Given** 민감 권한(주민번호 표시·환자 삭제·수가 조정·권한 관리·감사 조회)에서
**When** 토글하면
**Then** 권한명+대상 역할을 명시한 확인 다이얼로그를 거친 뒤 적용·감사된다

**And** 매트릭스는 `<table>`+`<th scope>` 시맨틱과 2D 화살표 키보드 모델(UX-DR19·UX-DR20)을 지원한다

### Story 1.8: 직원 계정 · 재직상태 관리 (관리자)

As a 관리자,
I want 직원 계정을 생성하고 역할·소속·면허·재직상태를 관리하기를,
So that 인사 변동(입사·휴직·퇴사)이 시스템 접근에 정확히 반영된다.

**Acceptance Criteria:**

**Given** 관리자 권한으로
**When** 직원 계정을 생성하면
**Then** Supabase Auth 사용자 + `users` 프로필(역할·소속 진료과·면허번호)이 생성된다(FR-214)

**Given** 기존 직원에 대해
**When** 재직상태를 휴직/퇴사로 변경하면
**Then** 해당 직원의 로그인·접근이 차단되고, 재직 복귀 시 복원된다(FR-215)

**Given** 계정·재직 변경이 일어날 때
**When** 작업이 커밋되면
**Then** 감사 로그에 행위자·대상·전/후 상태가 기록된다

### Story 1.9: 주민번호 암호화 · 감사 reveal 프리미티브

As a 보안 담당 개발자,
I want pgcrypto 암호화·Vault 키·복호 RPC·HMAC blind index·감사 reveal 패턴을 프리미티브로 세우기를,
So that 이후 환자 주민번호 등 민감정보가 일관된 보안 경로로만 다뤄진다.

**Acceptance Criteria:**

**Given** `0001_extensions.sql`에서
**When** pgcrypto·`gen_random_uuid`·Vault를 활성화하면
**Then** 암호화 프리미티브가 준비된다(FR-241)

**Given** 민감 컬럼 암복호가 필요할 때
**When** service_role 한정 SECURITY DEFINER 암복호 RPC + HMAC blind index 함수를 만들면
**Then** 키는 코드·DB에 평문으로 없고(Vault 보관), HMAC 해시로 중복 매칭이 가능하다(FR-003 토대)

**Given** 민감정보 reveal 요청이 발생할 때
**When** 권한 게이트 reveal 패턴(눈 아이콘+"감사기록" 접근가능 라벨, UX-DR9·UX-DR22)을 적용하면
**Then** 복호 조회 자체가 감사 이벤트로 기록되고, raw 값은 로그·토스트·에러 envelope·URL·실시간 페이로드에 절대 노출되지 않는다

### Story 1.10: 감사 로그 뷰어 (관리자, append-only)

As a 관리자,
I want 감사 로그를 행위자·기간·대상별로 조회·필터링하기를,
So that 민감정보 접근과 주요 작업을 사후 추적·검증할 수 있다.

**Acceptance Criteria:**

**Given** 관리자 권한으로 감사 화면에서
**When** 행위자·기간·대상 필터를 적용하면
**Then** 해당 감사 로그가 읽기전용으로 조회된다(FR-243)

**Given** 특정 감사 항목에서
**When** 상세를 열면
**Then** 변경 전/후 스냅샷이 읽기전용 diff 뷰어로 표시되고 편집·삭제가 불가능하다(UX-DR22)

**Given** 감사 포착 범위 검증 시
**When** PII reveal·상태 전이·RBAC 변경·파괴적 동작·인쇄/내보내기가 발생하면
**Then** 관리자 본인의 조회를 포함해 예외 없이 모두 기록되어 있다

## Epic 2: 표준 마스터 데이터 (Master Data & Single Source of Truth)

관리자가 진료과·진료실·KCD진단·EDI수가·약품 마스터를 관리(버전·유효기간·soft delete)하고, 모든 임상·정산 입력이 마스터 검색 피커로 강제되어 단일 진실이 선다.

> **에픽 범위 노트:** 마스터 검색 피커는 재사용 컴포넌트로, Epic 4(진단)·Epic 5(약품·수가)가 소비한다. 수가 매핑 시드의 *내용*(행위·진단 → EDI 코드)과 청구 단순화 선은 Epic 7 착수 전 확정한다(다운스트림).

### Story 2.1: 진료과 · 진료실 마스터 관리

As a 관리자,
I want 진료과와 진료실을 생성·수정·비활성하기를,
So that 예약·접수·진료가 정확한 조직 단위를 참조한다.

**Acceptance Criteria:**

**Given** 관리자 권한으로
**When** 마이그레이션 `0005_masters.sql`의 departments·rooms를 기반으로 진료과·진료실을 생성·수정하면
**Then** 조직 단위가 등록되고 후속 화면(예약·대기열·근무표)에서 선택 가능해진다(FR-200)

**Given** 활성 진료과·진료실에 대해
**When** 비활성(soft delete)하면
**Then** 신규 선택에서는 제외되지만 과거 기록의 참조는 유지된다

**And** 변경은 감사 로그에 기록되고, 권한 없는 사용자는 화면 자체에 접근할 수 없다(RBAC)

### Story 2.2: 코드 마스터 관리 — KCD진단 · EDI수가 · 약품 (버전 · 유효기간)

As a 관리자,
I want 진단(KCD)·수가(EDI 행위)·약품 마스터를 버전·유효기간과 함께 관리하기를,
So that 시점에 맞는 표준 코드만 임상·정산에 사용된다.

**Acceptance Criteria:**

**Given** `0005_masters.sql`에 발효/만료 컬럼이 포함된 상태에서
**When** KCD·수가·약품 코드를 등록·수정하면
**Then** 각 코드가 버전·발효일·만료일을 갖고 관리된다(FR-201, 이월 갭 ①)

**Given** 만료된 코드에 대해
**When** 신규 입력 화면에서 피커를 열면
**Then** 유효기간 내 코드만 노출된다

**Given** 과거 기록이 만료 코드를 참조할 때
**When** 그 기록을 조회하면
**Then** 만료 코드도 무결하게 표시된다(참조 보존)

### Story 2.3: 마스터 검색 피커 · 자유 입력 제한

As a 임상·원무 직원,
I want 진단·약품·수가를 검색 피커로만 선택하기를,
So that 비표준 자유 입력 없이 단일 진실이 강제된다.

**Acceptance Criteria:**

**Given** 마스터가 존재하는 입력 지점에서
**When** 재사용 검색 피커(KCD/약품/수가)를 열면
**Then** 마스터에서 검색·선택만 가능하고 free-text 입력이 차단된다(FR-202)

**Given** 검색 피커에서
**When** 키보드로 검색·이동·선택하면
**Then** `aria-live` 결과 안내와 키보드 완전 조작이 지원된다(UX-DR19·UX-DR20)

**And** 피커는 Epic 4(진단)·Epic 5(약품·수가)에서 동일 컴포넌트로 재사용된다

### Story 2.4: 마스터 비활성(soft delete) · 참조 무결성

As a 관리자,
I want 더 이상 쓰지 않는 마스터 코드를 비활성 처리하기를,
So that 신규 사용은 막되 과거 기록의 무결성은 보존된다.

**Acceptance Criteria:**

**Given** 참조 중인 마스터 코드에 대해
**When** 비활성(`is_active=false`)으로 전환하면
**Then** 물리 삭제 없이 신규 선택에서만 제외된다(FR-203)

**Given** 비활성 코드를 참조하는 과거 임상·정산 기록에 대해
**When** 그 기록을 조회하면
**Then** 코드 명칭·값이 정상 표시되어 참조 무결성이 유지된다

### Story 2.5: 마스터 시드 데이터 (seed.sql)

As a 개발자,
I want 데모·개발용 마스터 시드를 `seed.sql`로 적재하기를,
So that 골든 패스 시연이 실제 코드 위에서 동작한다.

**Acceptance Criteria:**

**Given** 빈 마스터 테이블에서
**When** `seed.sql`을 실행하면
**Then** EDI 수가·약품·KCD·진료과·진료실 마스터와 샘플이 적재된다

**Given** 시드가 적재된 상태에서
**When** 임상·정산 피커를 열면
**Then** 실제 코드가 검색·선택된다

**And** 수가 매핑 시드 내용은 Epic 7 착수 전 별도 확정한다(다운스트림 명시 추적)

## Epic 3: 환자 등록 · 프로필 (Patient Registration & Profile)

원무가 환자 레코드를 직접 생성하고, 앱 미사용 환자도 등록되며, 앱 자가가입(본인인증 시뮬) 시 기존 레코드와 자동 연결(중복 방지)된다. 임상 프로필·보호자가 기록되고 전역 환자 검색(Ctrl K)이 동작한다.

> **에픽 범위 노트:** 이 에픽이 patients/guardians 테이블(0006)을 생성하고 Epic 1.9의 암호화·HMAC·RLS 프리미티브를 환자에 적용한다. 진료 허브의 환자 배너 reveal UI는 Epic 4에서 이 데이터 위에 올라간다.

### Story 3.1: 환자 레코드 생성 (원무 직접 등록) · 암호화·RLS 적용

As a 원무 직원,
I want 앱을 안 쓰는 환자(전화·방문·고령자)의 레코드를 직접 생성하기를,
So that 모든 환자가 예약·접수·진료의 대상이 될 수 있다.

**Acceptance Criteria:**

**Given** `0006_patients.sql`로 patients 테이블(주민번호 `_enc`/`_hash` 포함, Epic 1.9 프리미티브 적용)을 만든 상태에서
**When** 원무가 환자 기본정보를 입력해 생성하면
**Then** `auth_uid` 미설정 환자 레코드가 만들어지고 `chart_no`가 부여된다(FR-002)

**Given** 주민번호를 입력할 때
**When** 유효성 검증을 수행하면
**Then** 형식+생년월일+성별/세기 자리(내국 1–4·외국 5–8)=HARD 차단, 체크섬=SOFT 경고로 처리되고, 값은 pgcrypto 암호화 저장·화면 마스킹된다

**Given** 환자/직원 RLS 경계에 대해
**When** `0014` 환자 소유 정책(`auth.uid()=patients.auth_uid`)과 직원 역할 정책을 적용하면
**Then** 환자는 본인만, 직원은 권한 범위만 행을 받는다(FR-240)

### Story 3.2: 환자 임상 프로필 입력 · 조회

As a 원무·의사,
I want 환자의 임상 프로필(혈액형·알레르기·기저질환·복용약·특이사항)을 입력·갱신·조회하기를,
So that 처방·처치 시 안전하게 참조한다.

**Acceptance Criteria:**

**Given** 환자 레코드가 존재할 때
**When** 임상 프로필을 입력·갱신하면
**Then** 혈액형·알레르기·기저질환·복용약·특이사항이 저장된다(FR-004, 이월 갭 ②)

**Given** 의사가 진료 화면에서
**When** 환자 임상 프로필을 조회하면
**Then** 안전 참조 정보(특히 알레르기)가 표시된다(FR-005) — 진료 허브 배너 연동은 Epic 4

**And** 알레르기 데이터는 Epic 5의 오더 교차검증·Epic 4의 can't-miss 경고에 활용된다

### Story 3.3: 보호자 정보 기록

As a 원무 직원,
I want 환자 보호자(성명·연락처·관계)를 기록하기를,
So that 고령·미성년 환자의 연락·동의 경로가 확보된다.

**Acceptance Criteria:**

**Given** 환자 레코드가 존재할 때
**When** guardians에 보호자 정보를 추가하면
**Then** 성명·연락처·관계가 저장되고 환자와 연결된다(FR-006)

**Given** 보호자 연락처(PII)를 조회할 때
**When** reveal 요청하면
**Then** 주민번호와 동일한 권한 게이트+감사 패턴이 적용된다(UX-DR22)

### Story 3.4: 환자 앱 자가가입 · 기존 레코드 자동 연결

As a 환자,
I want 앱에서 회원가입(본인인증)하면 병원이 만들어 둔 기존 레코드와 자동으로 연결되기를,
So that 중복 환자 없이 본인 데이터를 쓸 수 있다.

**Acceptance Criteria:**

**Given** 환자가 앱에서
**When** 회원가입 + 본인인증(시뮬)을 완료하면
**Then** Supabase Auth 계정이 생성되고 `patients.auth_uid`가 설정된다(FR-001)

**Given** 동일인의 원무 생성 레코드가 이미 존재할 때
**When** 가입 시 HMAC blind index로 매칭하면
**Then** 기존 레코드와 자동 연결되어 중복이 방지된다(FR-003)

**Given** 매칭 실패/모호 시
**When** 자동 연결이 불가하면
**Then** 신규 레코드 생성 또는 안내로 안전하게 폴백한다

### Story 3.5: 전역 환자 검색 (Ctrl K 커맨드 팔레트)

As a 직원,
I want 어느 화면에서든 Ctrl K로 환자를 이름·차트번호·연락처로 찾기를,
So that 베테랑의 키보드 속도로 환자에 즉시 도달한다.

**Acceptance Criteria:**

**Given** 직원 세션 어느 화면에서든
**When** `Ctrl K`로 커맨드 팔레트를 열고 검색하면
**Then** 이름·차트번호·연락처로 환자가 검색되고 결과가 `aria-live`로 안내된다(UX-DR5·UX-DR24)

**Given** 검색 결과에서
**When** 환자를 선택하면
**Then** 환자 상세(별도 풀페이지)로 이동한다

**And** 리스트/검색 결과의 주민번호는 기본 마스킹되고 per-row reveal은 없다(UX-DR22)

## Epic 4: 내원 파이프라인 — 접수·대기·진찰·기록 (Encounter Pipeline)

원무가 예약/walk-in 환자를 접수해 내원을 생성하고, 대기 현황판이 "다음 호출"을 안내한다. 의사가 진료를 시작(진행중)해 과거 이력·활력을 한 화면(진료 허브)에서 보고 SOAP·KCD 진단을 기록한다 — 시스템의 심장.

> **에픽 범위 노트:** walk-in 접수(FR-021)로 예약(Epic 6) 없이 독립 완결·시연된다. 내원 상태머신이 이 에픽에서 서고, 오더(Epic 5)·수납(Epic 7)이 이 상태머신에 연결된다.

### Story 4.1: 내원 상태머신 · 전이 RPC (DB)

As a 백엔드 개발자,
I want 내원 상태와 전이 규칙을 DB가 강제하도록 만들기를,
So that 역행·건너뛰기 없이 워크플로우 무결성이 보장된다.

**Acceptance Criteria:**

**Given** `0007_encounters.sql`에서
**When** encounters(status enum: scheduled|registered|in_progress|completed|cancelled|no_show + CHECK)와 전이 RPC(`register_encounter`·`start_consult`·`complete_encounter`)를 만들면
**Then** 정의된 전이만 허용되고 역행·건너뛰기가 차단된다(NFR-040)

**Given** 잘못된 전이 시도 시
**When** RPC가 호출되면
**Then** 409 오류가 반환된다

**And** 취소·노쇼·부분수행 경로(이월 갭 ⑥)와 전이 full matrix가 명시되고, 모든 전이가 감사 트리거로 기록된다

### Story 4.2: 환자 접수 — 예약 · Walk-in

As a 원무 직원,
I want 도착한 예약 환자 또는 예약 없는 방문 환자를 접수하기를,
So that 내원이 생성되어 진료 파이프라인에 진입한다.

**Acceptance Criteria:**

**Given** 예약 환자가 도착했을 때
**When** 예약 목록에서 환자를 찾아 접수하면
**Then** 내원이 '접수' 상태로 생성되고 진료과 대기열에 등록된다(FR-020)

**Given** 예약 없는 방문 환자(walk-in)에 대해
**When** 원무가 환자를 검색·선택해 즉석 접수하면
**Then** 동일하게 내원이 생성·대기열 등록된다(FR-021)

**Given** 접수 시
**When** 내원이 생성되면
**Then** `register_encounter` RPC를 통해 상태머신·감사가 일관 적용된다

### Story 4.3: 대기 현황판 — 실시간 · 다음 호출

As a 원무·의사,
I want 진료과·진료실별 실시간 대기 현황과 "다음 호출 환자"를 보기를,
So that 신규 직원도 순번을 외우지 않고 정확히 다음 환자를 부른다.

**Acceptance Criteria:**

**Given** 접수된 내원이 있을 때
**When** 대기 현황판(UX-DR7; 상태 표시=status-badge A3 UX-DR6, 행별 다음-액션 버튼=UX-DR8)을 열면
**Then** 상태별 그룹 섹션(활성도 순)·카운트 pill·완료/취소 접힘으로 표시되고, 상단 "다음 호출" 히어로와 상태별 다음-액션 버튼(접수=호출·진료시작 등)이 제시된다(FR-022·FR-023, UX-DR6·UX-DR8)

**Given** 다른 단말이 상태를 변경할 때
**When** `postgres_changes` 실시간 구독이 수신되면
**Then** 행이 ≤5초 내 갱신되고, 신선도 초과 시 호출 버튼이 가드된다(UX-DR18·UX-DR21)

**Given** 호출 버튼을 누를 때
**When** mutation이 진행되면
**Then** 버튼이 disable되어 중복 호출이 방지되고, 호출 상태가 기록된다(FR-023)

### Story 4.4: 진료 대기열 · 진찰 시작

As a 의사,
I want 접수 완료 환자의 진료 대기열에서 진찰을 시작하기를,
So that 내원이 진행중으로 전이되고 진료 허브가 열린다.

**Acceptance Criteria:**

**Given** 의사 홈(진료 대기)에서
**When** 접수 상태 환자를 선택해 진찰을 시작하면
**Then** `start_consult` RPC로 내원이 '진행중'으로 전이된다(FR-030)

**Given** 진찰 시작 시
**When** 진료 허브가 열리면
**Then** 세션당 활성 내원 컨텍스트가 1개로 가드된다(UX-DR21 스테일 탭 가드)

### Story 4.5: 진료 허브 — 환자 배너 · 과거 이력 · 활력 컨텍스트

As a 의사,
I want 환자 배너와 과거 이력·활력·임상 프로필을 한 화면에서 보기를,
So that 탭 이동·차트 뒤지기 없이 안전하게 진료를 시작한다.

**Acceptance Criteria:**

**Given** 진료 허브가 열렸을 때
**When** 좌 컨텍스트 패널(읽기전용)을 렌더하면
**Then** 활력징후·임상 프로필·과거 내원/진단/처방/검사 타임라인이 한 화면에 표시된다(FR-031·FR-032)

**Given** 환자 배너에서
**When** 주민번호·연락처 reveal을 요청하면
**Then** 권한 게이트+감사("감사기록" 라벨)가 적용된다(UX-DR9·UX-DR22)

**Given** 환자에게 알레르기·안전 경고가 있을 때
**When** 배너를 렌더하면
**Then** 음영 비의존 can't-miss 경고가 상단 상시 노출되고 `role="alert"`로 낭독되며 critical 항목은 은닉되지 않는다(UX-DR10·UX-DR21)

### Story 4.6: SOAP 진료기록 작성

As a 의사,
I want SOAP 형식으로 진료기록을 작성·자동저장하기를,
So that 표준 기록이 한 내원에 여러 건 남는다.

**Acceptance Criteria:**

**Given** 진료 허브 중앙 작성 영역에서
**When** SOAP ledger(UX-DR11)에 입력하면
**Then** full-bleed 1열 표로 S/O/A/P 파트가 표시되고, 포커스/입력 중 좌측 teal 액센트+틴트(음영 아님)와 text-muted placeholder 가이드가 동작한다

**Given** 작성 중일 때
**When** autosave가 트리거되면
**Then** "자동 저장됨 · {시각}" 인디케이터가 polite 라이브 리전으로 표시된다

**Given** 한 내원에 대해
**When** 진료기록을 추가하면
**Then** 복수 SOAP 기록(1:N)이 저장된다(`0008_clinical.sql`, FR-040·FR-041)

### Story 4.7: 진단 부착 (KCD) · 주/부상병 구분

As a 의사,
I want 평가(A)에 KCD 진단을 검색 피커로 붙이고 주/부상병을 구분하기를,
So that 진단이 표준 코드로 기록되고 처방·수가의 근거가 된다.

**Acceptance Criteria:**

**Given** SOAP 위 진단 블록(UX-DR12)에서
**When** KCD-8 검색 피커로 진단을 선택하면
**Then** encounter_diagnoses에 코드가 부착되고 free-text가 차단된다(FR-042)

**Given** 진단을 부착할 때
**When** 주/부상병 토글을 사용하면
**Then** 주진단·부진단이 구분 저장된다

**Given** 주상병 없이 진료 완료를 시도할 때
**When** 검증이 수행되면
**Then** 422로 차단되고 진단 필드로 포커스가 이동하며 "주상병을 1개 지정해야 합니다"가 인라인 표시된다(UX-DR18)

## Epic 5: 오더 · 수행 — 처방·검사·처치·간호·방사선 (Orders & Fulfillment)

의사가 처방·검사·영상·처치를 오더하면 직역별 워크리스트로 흐르고, 간호사가 활력·처치를 수행(재수행 차단)하며, 방사선사가 촬영·영상 업로드하고 의사가 판독한다. 알레르기 교차검증·누락 0 디텍터가 안전을 강제하고, 수가 자동발생 트리거가 가동되기 시작한다.

> **에픽 범위 노트:** 가장 큰 에픽(17 FR)이나 "오더 도메인 end-to-end"로 응집된다. 수가 자동발생 트리거는 여기서 가동을 시작하고(오더 수행/처방 발행 → 수납상세 적재), 수납 finalize·문서는 Epic 7이다.

### Story 5.1: 오더 생명주기 스키마 · 상태머신 (DB)

As a 백엔드 개발자,
I want 오더 유형별 생명주기와 지시자/수행자 추적, 재수행 차단을 DB로 강제하기를,
So that 모든 오더가 일관된 상태머신과 추적성을 갖는다.

**Acceptance Criteria:**

**Given** `0009_orders.sql`에서
**When** prescriptions(+details)·examinations·equipment·treatment_orders와 오더 상태 어휘(지시→수행→완료/판독, 이월 갭 ⑤)를 만들면
**Then** 유형별 생명주기가 enum+CHECK로 강제되고 지시자·수행자·시각 FK가 분리 기록된다(FR-080)

**Given** 이미 수행 완료된 오더에 대해
**When** 재수행을 시도하면
**Then** DB 제약이 이를 차단한다(FR-093 최종선)

**And** 모든 오더 전이가 감사 트리거로 기록된다

### Story 5.2: 처방 오더 발행 · 중복 경고

As a 의사,
I want 약품 마스터에서 약을 선택해 처방전을 발행하고 진단과 연결하기를,
So that 표준 약품·용법으로 처방하고 근거가 남는다.

**Acceptance Criteria:**

**Given** 진료 허브 오더 패널에서
**When** 약품 마스터 검색 피커로 처방전을 발행하면
**Then** 처방전 헤더 + 처방상세 라인(약품·용량·횟수·일수·용법)이 생성되고 free-text가 차단된다(FR-050)

**Given** 처방을 발행할 때
**When** 진단(A)과 연결하면
**Then** 처방 근거가 기록된다(FR-051)

**Given** 동일 성분이 이미 처방된 상태에서
**When** 같은 성분을 추가하면
**Then** 인라인 중복 경고가 표시된다(FR-052)

### Story 5.3: 검사 · 영상 오더

As a 의사,
I want 진단검사·영상검사를 오더하면 적절한 직역 워크리스트로 전달되기를,
So that 수행 주체가 명확히 분기된다.

**Acceptance Criteria:**

**Given** 진료 허브에서
**When** 진단검사·영상검사를 오더하면
**Then** 지시 의사가 기록되고 오더가 '지시' 상태로 생성된다(FR-060)

**Given** 오더 유형에 따라
**When** 전달되면
**Then** 영상검사는 방사선사 워크리스트로, 진단검사(검체)는 간호 워크리스트(채취 후 외부 의뢰)로 라우팅되고, 외부 의뢰 결과는 기록으로 반영된다(FR-061)

### Story 5.4: 처치 오더

As a 의사,
I want 처치를 오더하면 간호 워크리스트로 전달되기를,
So that 처치 수행이 추적된다.

**Acceptance Criteria:**

**Given** 진료 허브에서
**When** 처치를 오더하면
**Then** 지시 의사가 기록되고 '지시' 상태로 생성되어 간호 워크리스트로 전달된다(FR-070)

### Story 5.5: 오더 패널 · 알레르기 교차검증 · 누락 0 디텍터

As a 의사,
I want 오더 패널에서 알레르기·중복·미수행 위험을 시스템이 잡아 주기를,
So that 환자 안전이 절차로 강제된다.

**Acceptance Criteria:**

**Given** 오더 패널(UX-DR13)에서
**When** 처방/검사/영상/처치 탭과 추적 라인(지시자·수행자·시각)·급여/비급여 pay-chip을 렌더하면
**Then** 마스터 검색 피커로만 추가 가능하고 수가 자동 산정 프리뷰("자동" 마커)가 표시된다

**Given** 오더를 발행할 때
**When** 환자의 기록된 알레르기 AND 활성 투약(상호작용)에 대조하면
**Then** 위험 시 하드 블록 또는 사유 기록 오버라이드+감사가 적용된다(UX-DR21 교차검증)

**Given** 미수행/지연 오더가 있을 때
**When** 워크리스트·진료 허브를 보면
**Then** 가시 인디케이터(연령/임계치)로 surface되어 누락 0이 보장된다(UX-DR21 디텍터)

### Story 5.6: 간호 활력징후 기록

As a 간호사,
I want 활력징후를 측정·기록하기를,
So that 의사가 진료 전 활력 데이터를 본다.

**Acceptance Criteria:**

**Given** `0010_nursing.sql`의 vital_signs에 대해
**When** 간호사가 혈압·맥박·체온·호흡수·SpO2 등을 기록하면
**Then** 활력징후 전용 기록이 저장되고 해당 내원에 연결된다(FR-091)

**Given** 기록된 활력징후는
**When** 의사가 진료 허브를 열면
**Then** 좌 컨텍스트 패널에 표시된다(FR-032 연동)

### Story 5.7: 간호 처치 수행 · 재수행 차단 · 일상 간호기록

As a 간호사,
I want 처치 워크리스트에서 오더를 수행 처리하되 이미 수행된 건은 막히기를,
So that 처치 중복·누락이 0이 된다.

**Acceptance Criteria:**

**Given** 처치 워크리스트(직역별 RLS)에서
**When** 지시된 처치 오더를 조회·수행 처리하면
**Then** 처치기록(수행자·시각·내용)이 남고 오더가 '수행' 상태로 전환된다(FR-090·FR-092)

**Given** 이미 수행된 오더에 대해
**When** 재수행을 시도하면
**Then** mutation 중 버튼 disable(1차선)과 상태머신(최종선)이 이를 차단한다(FR-093, UX-DR21)

**Given** 오더가 없는 일상 간호에 대해
**When** 간호기록을 남기면
**Then** 처치 오더 연결 없이도 기록된다(FR-094)

### Story 5.8: 방사선 촬영 · 영상 업로드 · 장비

As a 방사선사,
I want 촬영 워크리스트에서 촬영을 수행하고 영상을 스토리지에 올리기를,
So that 영상이 안전하게 저장되고 판독으로 이어진다.

**Acceptance Criteria:**

**Given** 촬영 워크리스트·대기 목록에서
**When** 영상검사 오더를 조회하면
**Then** 직역별 워크리스트가 표시된다(FR-100)

**Given** 촬영을 수행할 때
**When** 영상 자료를 업로드하면
**Then** Supabase Storage 버킷에 저장되고 서명 URL/경로만 DB에 연결된다(FR-101)

**Given** 촬영 배정 시
**When** 검사장비 목록을 보면
**Then** 장비 목록·상태가 표시된다(FR-103)

### Story 5.9: 영상 판독 · 검사 오더 완료

As a 의사(판독의 겸임),
I want 영상 판독 소견을 기록하면 검사 오더가 완료되기를,
So that 검사 생명주기가 닫힌다.

**Acceptance Criteria:**

**Given** 촬영이 수행된 영상검사 오더에 대해
**When** 판독 소견을 기록하면
**Then** 소견이 저장되고 해당 검사 오더가 '완료' 처리된다(FR-102)

**And** 판독은 중소병원 외래 기준 진료의 겸임이 허용된다

### Story 5.10: 수가 자동발생 트리거 가동

As a 백엔드 개발자,
I want 임상 이벤트가 수가 항목을 자동 적재하도록 트리거를 가동하기를,
So that 수납이 사람의 코드 암기가 아니라 시스템 규칙으로 채워진다.

**Acceptance Criteria:**

**Given** `0012_billing.sql`의 수가 자동발생 트리거가 설치된 상태에서
**When** 진찰 시작·오더 수행 완료·처방 발행 이벤트가 발생하면
**Then** 대응 수가 항목이 수납상세에 원자적으로 적재된다(FR-081·FR-116 메커니즘)

**Given** 행위→수가코드 매핑에 대해
**When** `fee_mappings` 규칙을 참조하면
**Then** 매핑이 외부화되어 코드 수정 없이 시드로 관리된다

**And** 수납 헤더 생성·finalize·문서는 Epic 7에서 이 적재 데이터를 소비한다

## Epic 6: 예약 · 근무 스케줄 (Appointments & Scheduling)

관리자가 의사 근무표·휴진을 등록하고, 환자가 앱에서 가능 슬롯만 보고 예약하며(원무 대리 예약 포함), 더블부킹이 차단되고 SMS 리마인더(시뮬)·노쇼 제한·휴진 재배정이 동작한다.

> **에픽 범위 노트:** 생성된 예약은 Epic 4의 접수(이미 walk-in으로 동작 중)로 흘러든다. SMS·본인인증은 시뮬 이음매로 처리한다.

### Story 6.1: 근무표 · 휴진 예외 관리 (DB · 관리자)

As a 관리자,
I want 의사별 근무표와 휴진·예외를 등록·관리하기를,
So that 예약 가능 슬롯과 휴진 재배정의 근거가 선다.

**Acceptance Criteria:**

**Given** `0011_scheduling.sql`(doctor_schedules·doctor_time_offs·appointments)에서
**When** 의사별 근무표(요일·시간대·진료실)를 등록하면
**Then** 근무표가 저장된다(FR-220)

**Given** 휴진·예외(휴가·학회 등)에 대해
**When** 등록하면
**Then** 가용 슬롯(FR-012)·휴진 재배정(FR-016)의 근거로 반영된다(FR-221)

### Story 6.2: 동적 가용 슬롯 계산

As a 환자·원무,
I want 실제로 예약 가능한 슬롯만 보기를,
So that 잘못된 시간에 예약하지 않는다.

**Acceptance Criteria:**

**Given** 근무표·휴진·기존 예약이 있을 때
**When** 가용 슬롯을 계산하면
**Then** 근무−예외−기예약으로 산출된 가능 슬롯만 노출된다(FR-012)

**Given** 휴진일·마감 슬롯에 대해
**When** 슬롯 그리드를 렌더하면
**Then** 비활성으로 표시된다

### Story 6.3: 예약 캘린더 · 더블부킹 차단

As a 원무 직원,
I want 캘린더에서 슬롯을 보고 예약하되 더블부킹이 차단되기를,
So that 예약 충돌이 0이 된다.

**Acceptance Criteria:**

**Given** 예약 캘린더(UX-DR15: 시간레일×열=의사, 일 보기)에서
**When** 슬롯 상태(가능/확정/노쇼/취소/휴진/점심)를 렌더하면
**Then** 채움+테두리+패턴(휴진=빗금, 음영 비의존)으로 표시된다

**Given** 빈 슬롯을 클릭할 때
**When** booking-peek 슬라이드오버를 열면
**Then** 진료과·의사·환자검색·날짜/시간·메모·SMS 체크·저장/취소가 제공된다

**Given** 동일 시간대 더블부킹을 시도할 때
**When** 저장하면
**Then** 인라인 차단(409)+경고 칩이 표시되고 저장되지 않는다(FR-013)

### Story 6.4: 원무 대리 예약 생성·변경·취소

As a 원무 직원,
I want 전화·방문 환자를 대신해 예약을 생성·변경·취소하기를,
So that 앱 미사용 환자도 예약된다.

**Acceptance Criteria:**

**Given** 원무가 booking-peek에서
**When** 환자를 검색해 예약을 생성·변경·취소하면
**Then** 예약 상태가 갱신되고 가용 슬롯·대기 흐름에 반영된다(FR-011)

**And** 모든 변경은 상태머신·감사로 일관 처리된다

### Story 6.5: 환자 앱 예약

As a 환자,
I want 앱에서 진료과·의사·시간을 골라 예약하기를,
So that 전화 없이 스스로 예약한다.

**Acceptance Criteria:**

**Given** 환자 앱 예약 탭(UX-DR17)에서
**When** 진료과→의사→날짜 칩 레일→시간 슬롯 그리드 흐름을 진행하면
**Then** 휴진일·마감 슬롯은 비활성이고 가능 슬롯만 선택된다(FR-010)

**Given** 선택을 마쳤을 때
**When** "예약 확정하기"(≥44px sticky CTA)를 누르면
**Then** 예약이 생성되고 12시간 표기·쉬운 말로 확인이 표시된다

### Story 6.6: SMS 리마인더 (시뮬 · 로그)

As a 환자,
I want 예약 3일 전·1일 전 리마인더를 받기를,
So that 노쇼 없이 내원한다.

**Acceptance Criteria:**

**Given** 확정된 예약에 대해
**When** 3일 전·1일 전 시점에 리마인더가 트리거되면
**Then** `0013_notifications.sql`의 notification_logs에 발송 이력이 기록된다(FR-014, 이월 갭 ③)

**And** 실 SMS 연동 대신 시뮬/로그로 처리되며 연결 가능한 이음매로 설계된다

### Story 6.7: 노쇼 카운트 · 임계치 제한

As a 시스템,
I want 환자별 노쇼 횟수를 세고 임계 초과 시 예약을 제한하기를,
So that 상습 노쇼로 인한 슬롯 낭비를 줄인다.

**Acceptance Criteria:**

**Given** 내원이 노쇼로 종결될 때
**When** 노쇼 카운트를 갱신하면
**Then** 환자별 노쇼 횟수가 기록된다(FR-015)

**Given** 노쇼 임계치(기본 2회)를 초과한 환자에 대해
**When** 신규 예약을 시도하면
**Then** 예약이 제한되고 사유가 안내된다

### Story 6.8: 휴진 시 영향 예약 재배정

As a 관리자·원무,
I want 의사 휴진 등록 시 영향받는 예약을 보고 재배정하기를,
So that 환자가 빈손으로 내원하지 않는다.

**Acceptance Criteria:**

**Given** 의사 휴진을 등록할 때
**When** 해당 시간대에 기존 예약이 있으면
**Then** 영향받는 예약 목록이 표시된다(FR-016)

**Given** 영향 예약에 대해
**When** 재배정·안내를 수행하면
**Then** 예약이 다른 슬롯으로 이동하거나 환자 안내가 기록된다

## Epic 7: 수납 · 정산 · 표준 문서 (Billing, Settlement & Standard Documents)

진찰·수행·처방에서 자동 적재된 수가를 원무가 정산하고(급여구분·본인부담), 표준 「진료비 계산서·영수증」·「세부산정내역서」·원외처방전을 출력하며, 후/선수납·취소/노쇼/부분수행 정산이 처리된다.

> **에픽 범위 노트:** 가장 어려운 도메인. 수가 자동발생 트리거는 Epic 5.10에서 가동되었고, 여기서 수가 매핑 시드 내용·청구 단순화 선을 확정하고 finalize·문서를 구현한다. 인쇄/PDF는 PII 정책(UX-DR22)을 준수한다.

### Story 7.1: 수납 스키마 · 수가 매핑 (DB)

As a 백엔드 개발자,
I want 수납 헤더/상세와 수가 매핑 규칙을 완성하기를,
So that 자동발생 수가가 정산 가능한 형태로 집계된다.

**Acceptance Criteria:**

**Given** `0012_billing.sql`에서
**When** payments(+details)·fee_mappings를 만들고 수가 자동발생 규칙(FR-116: 진찰료=진찰 시, 검사·처치·영상=수행 완료 시, 약제비=처방 발행 시)을 정의하면
**Then** 임상 이벤트가 수납상세 라인으로 적재된다

**Given** 수가 매핑 시드 내용에 대해
**When** 행위·진단 → EDI 수가/약가 코드 매핑과 청구 단순화 선(초진/재진·가산 등)을 확정하면
**Then** 다운스트림 이월 항목이 해소된다

### Story 7.2: 수납 건 생성 · 집계

As a 원무 직원,
I want 진찰·오더에서 자동발생한 수가를 집계한 수납 건을 보기를,
So that 수기 계산 없이 정산을 시작한다.

**Acceptance Criteria:**

**Given** 진찰·수행·처방이 발생한 내원에 대해
**When** 수납 화면을 열면
**Then** 자동발생 수가 항목이 집계된 수납 건(헤더+상세 라인)이 표시되고 "자동" 마커가 붙는다(FR-110, UX-DR14)

### Story 7.3: 급여/비급여 구분 · 본인부담 산정

As a 원무 직원,
I want 급여/비급여를 구분해 본인부담금을 산정하기를,
So that 환자에게 정확한 금액을 청구한다.

**Acceptance Criteria:**

**Given** 수납 상세 항목에 대해
**When** 급여(본인부담/공단부담)·비급여를 구분하면
**Then** 본인부담금이 산정되고 pay-chip(급여=그린/비급여=앰버 잉크)으로 표시된다(FR-111)

**And** 금액은 KRW 정수·`tabular-nums`·"원" 접미로 렌더된다

### Story 7.4: 수납 처리 · 내원 완료

As a 원무 직원,
I want 결제를 기록하고 내원을 완료하기를,
So that 한 번의 내원이 정산으로 닫힌다.

**Acceptance Criteria:**

**Given** 수납 건에 대해
**When** 결제 수단(카드/현금/계좌이체)·금액을 기록하면
**Then** 수납이 처리되고 `complete_encounter` RPC로 내원이 '완료'로 전이된다(FR-112)

**Given** 결제 확정(고위험 비가역)을 할 때
**When** 확정 버튼을 누르면
**Then** 환자 신원(이름+차트번호) 재진술 confirm을 거치고 감사 스냅샷이 남는다(UX-DR14·UX-DR21)

**And** 다단계 작업은 FastAPI 트랜잭션으로 원자성이 보장된다(NFR-041)

### Story 7.5: 진료비 계산서 · 영수증 출력

As a 원무 직원,
I want 표준 「진료비 계산서·영수증」을 출력하기를,
So that 환자가 표준 서식 영수증을 받는다.

**Acceptance Criteria:**

**Given** 정산된 수납 건에 대해
**When** 진료비 계산서·영수증을 미리보기/출력하면
**Then** 대분류 항목·급여/비급여 구분·본인부담총액·이미 납부·납부할 금액 3행 합계가 표준 서식으로 렌더된다(FR-113)

**Given** 법정 서식 출력 시
**When** 미리보기를 렌더하면
**Then** Batang serif 격식 레이아웃이 적용되고, 인쇄(`Ctrl P`)/PDF에서 주민번호는 기본 마스킹·파일명 PII 금지·내보내기=감사 이벤트가 적용된다(UX-DR14·UX-DR22)

### Story 7.6: 진료비 세부산정내역서 출력

As a 원무 직원,
I want 「진료비 세부산정내역서」를 출력하기를,
So that 항목별 산정 근거를 제공한다.

**Acceptance Criteria:**

**Given** 정산된 수납 건에 대해
**When** 세부산정내역서를 출력하면
**Then** 라인별(항목분류·일자·코드·명칭·단가·횟수·일수·금액·본인부담·공단부담)이 표준 서식으로 렌더된다(FR-114)

**And** 인쇄/PDF PII 정책(UX-DR22)이 동일 적용된다

### Story 7.7: 원외처방전 출력 · 발급

As a 원무 직원,
I want 원외처방전을 출력·발급하기를,
So that 환자가 원외 약국에서 조제받는다.

**Acceptance Criteria:**

**Given** 발행된 처방에 대해
**When** 원외처방전을 출력하면
**Then** 표준 처방전이 발급되고 발급 이력이 기록된다(FR-115)

**And** 처방은 발행→발급 생명주기(원외 약국, 시스템 내 수행자 없음)를 따른다

### Story 7.8: 수납 정책 — 후수납 / 선수납

As a 원무 직원,
I want 후수납(기본)과 선수납 옵션을 운용하기를,
So that 병원 정책에 맞게 정산 시점을 조정한다.

**Acceptance Criteria:**

**Given** 수납 정책 플래그(이월 갭 ④)가 있을 때
**When** 후수납으로 운용하면
**Then** 진료 후 정산이 기본 동작한다(FR-117)

**Given** 선수납 설정 시
**When** 접수 후 선결제하고 진료 후 차액을 정산하면
**Then** 선결제·차액 정산이 일관 처리된다

### Story 7.9: 취소 · 노쇼 정산 (수가 미발생)

As a 시스템,
I want 취소·노쇼로 종결된 내원을 수가 미발생으로 처리하기를,
So that 발생하지 않은 진료가 청구되지 않는다.

**Acceptance Criteria:**

**Given** 취소·노쇼로 종결된 내원에 대해
**When** 정산을 수행하면
**Then** 수가가 미발생 처리된다(FR-118)

**Given** 노쇼 수수료 정책이 적용될 때
**When** 부과하면
**Then** 별도 항목으로 부과 가능하다

### Story 7.10: 부분 수행 정산

As a 원무 직원,
I want 일부 오더만 수행 후 이탈한 내원도 수행분까지 정산하기를,
So that 부분 진료도 정확히 청구된다.

**Acceptance Criteria:**

**Given** 일부 오더만 수행된 내원에 대해
**When** 정산을 수행하면
**Then** 수행된 항목까지만 수납·정산된다(FR-119, 이월 갭 ⑥ 정산 경로)

## Epic 8: 환자 포털 · 운영 대시보드 (Patient Portal & Operations Dashboard)

환자가 앱에서 본인 내원·진단·처방·검사결과·수납내역을 쉬운 말로(본인 것만, RLS) 확인하고, 관리자가 일별 내원·매출·노쇼율 대시보드로 운영을 본다. 환자 앱이 Flutter 웹뷰 APK로 패키징된다.

> **에픽 범위 노트:** 누적 데이터 위 읽기 뷰로, 데이터를 생성하는 Epic 4·5·7 이후에 온다. 환자 포털은 항상 세션 uid로 스코프되고 RLS가 본인 외 데이터를 차단한다.

### Story 8.1: 환자 포털 — 내 진료내역

As a 환자,
I want 앱에서 본인의 내원 이력(예약·진찰·진단)을 쉬운 말로 보기를,
So that 내 진료가 어땠는지 스스로 이해한다.

**Acceptance Criteria:**

**Given** 환자 세션(uid 스코프)에서
**When** "내 기록" 탭(UX-DR17)을 열면
**Then** 본인 내원 이력 카드(날짜·상태 배지·의사·진단 쉬운 말 부연)가 표시된다(FR-120)

**Given** RLS가 강제되는 상태에서
**When** 데이터를 받으면
**Then** 본인 데이터만 반환되고(타인 0건), 상단에 신뢰 노트가 상시 표시된다(UX-DR22)

### Story 8.2: 환자 포털 — 처방 · 검사 결과

As a 환자,
I want 본인의 처방·검사 결과를 쉬운 말로 보기를,
So that 복약법과 결과를 이해한다.

**Acceptance Criteria:**

**Given** 진료내역 카드를 펼쳤을 때
**When** 처방·검사 결과를 렌더하면
**Then** 복약 안내("하루 1번, 아침 식사 후 한 알")와 검사 결과 요약(정상/주의 플래그)이 쉬운 말로 표시된다(FR-121)

**And** 임상 용어는 환자용으로 풀어쓰기된다(예: "고혈압 (혈압이 높은 상태)", UX-DR23)

### Story 8.3: 환자 포털 — 수납 · 영수증

As a 환자,
I want 본인의 수납 내역·영수증을 보기를,
So that 결제 내역을 확인한다.

**Acceptance Criteria:**

**Given** 환자 세션에서
**When** 수납 내역을 열면
**Then** 본인 수납 내역·영수증이 조회된다(FR-122)

**And** 12시간 표기·쉬운 말·본인 데이터 스코프(RLS)가 일관 적용된다

### Story 8.4: 환자 앱 APK 패키징 · 배포

As a 환자,
I want 환자 포털을 Android 앱(APK)으로 설치하기를,
So that 폰에서 편하게 예약·조회한다.

**Acceptance Criteria:**

**Given** 환자 포털 화면(예약·내 기록)이 완성된 상태에서
**When** Flutter 웹뷰 셸을 `flutter build apk`로 빌드하면
**Then** APK가 공개 도메인 서브패스(`/patient_management_system`)를 로드한다(NFR-011, UX-DR17)

**Given** 서브패스 전파에 대해
**When** 웹뷰 base URL·Supabase Auth redirect·딥링크를 검증하면
**Then** 로그인/실시간/조회가 정상 동작한다

### Story 8.5: 운영 대시보드 · 통계 (관리자)

As a 관리자/원장,
I want 일별 내원·대기·매출·노쇼율 대시보드를 보기를,
So that 운영 현황을 한눈에 파악한다.

**Acceptance Criteria:**

**Given** 관리자 권한으로 대시보드(홈)에서
**When** 운영 통계를 조회하면
**Then** 일별 내원·대기·매출·노쇼율 등 현황이 표시된다(FR-230)

**And** 복잡 집계는 FastAPI가 담당하고, 권한 범위 내 데이터만 노출된다(RBAC·RLS)

## Epic 9: 도움말 · 온보딩 가이드 (Help & Onboarding)

로그인한 사용자가 자기 업무 화면 안에서 선배 없이 기능을 익히도록 돕는 온보딩 보조. 도움말은 공개가 아니라 인증 후 접근하며, 현재 로그인 계정에 실제로 표시되는 메뉴만 안내한다(RBAC filterNav 기반 동적). 상단 고정 네비게이션바가 그 계정의 메뉴 인덱스가 되고, 각 메뉴 안내는 실제 화면 스크린샷 + 동작요소 번호 하이라이트 + 단계별 설명으로 구성된다. (Epic 1~8 구현 완료 후 추가)

> **에픽 범위 노트:** 스크린샷은 playwright 자동 캡처(클라우드 실데이터·DOM 오버레이 번호)로 생성해 정적 이미지로 임베드한다 — 런타임 캡처 의존 없음. 빈 화면 방지를 위해 캡처용 더미 데이터를 자유 보강한다(demo_seed). 콘텐츠 데이터(메뉴 키 → 화면 → 번호·설명)는 전체를 준비하되, 페이지는 현재 계정에 보이는 메뉴만 렌더한다(staff-nav filterNav 재사용). 환자(포털)는 모바일 셸 특성상 우선순위가 낮아 직원 5역할을 먼저 완성한다.

### Story 9.1: 도움말 페이지 셸 · 네비게이션바 · 콘텐츠 구조

As a 로그인한 사용자,
I want 내 화면에서 도움말 페이지에 들어가 내 메뉴 인덱스를 보기를,
So that 내가 쓰는 기능을 한 곳에서 찾아본다.

**Acceptance Criteria:**

**Given** 로그인한 사용자가
**When** 셸 푸터(또는 사용자 메뉴)의 "도움말"을 클릭하면
**Then** 인증된 도움말 페이지로 이동한다 — 미인증 접근은 로그인으로 리다이렉트(공개 아님, FR-250)

**Given** 도움말 페이지가 렌더될 때
**When** 상단 네비게이션바가 구성되면
**Then** 현재 계정에 표시되는 메뉴만(staff-nav filterNav 결과) sticky 인덱스로 나열되고, 권한·역할로 가려진 메뉴는 노출되지 않는다(FR-251)

**Given** 네비게이션바에서
**When** 특정 메뉴를 선택하면
**Then** 본문의 해당 메뉴 안내 섹션으로 앵커 이동한다

**Given** 도움말 콘텐츠가
**When** 데이터 구조(메뉴 키 → 화면 목록 → 번호·설명)로 정의되면
**Then** 페이지가 현재 계정 메뉴만 필터해 섹션을 렌더한다(역할별 전체 하드코딩 아님)

### Story 9.2: 스크린샷 캡처 파이프라인 · 더미 데이터

As a 도움말 작성자,
I want 실제 화면을 자동 캡처하고 번호 하이라이트를 입히는 재현 가능한 파이프라인을,
So that 메뉴별 안내 이미지를 일관되게 생성·갱신한다.

**Acceptance Criteria:**

**Given** playwright + headless 브라우저로
**When** 역할별 로그인 후 각 메뉴 화면을 캡처하면
**Then** 클라우드 실데이터 화면이 PNG로 저장된다

**Given** 캡처 시 핵심 동작요소에
**When** 번호 원 + 테두리를 DOM 오버레이로 주입하면
**Then** 번호 하이라이트가 입혀진 스크린샷이 생성된다 — 별도 이미지 편집 도구 의존 없음(FR-252)

**Given** 빈 화면(데이터 0) 방지를 위해
**When** 필요한 더미 데이터를 demo_seed에 자유 보강하면(오늘 기준)
**Then** 대기·워크리스트·수납 등이 데이터 있는 상태로 캡처된다

**Given** 생성된 이미지가
**When** web `public/` 경로에 배치되면
**Then** 도움말 페이지가 정적으로 임베드한다(런타임 캡처 없음)

### Story 9.3: 원무(reception) 메뉴 안내

As a 원무 직원,
I want 내 메뉴 사용법을 화면과 함께 보기를,
So that 선배 없이 접수·정산 업무를 처리한다.

**Acceptance Criteria:**

**Given** 원무 계정 도움말에서
**When** 메뉴 안내를 스크롤하면
**Then** 대기 현황·접수·예약 관리·리마인더·환자 등록·환자 검색·수납·수납 내역 각 메뉴의 화면 스크린샷·번호 하이라이트·단계별 설명이 빠짐없이 제공된다(FR-253)
**And** 접수→대기→호출, 수납→영수증·재출력 등 핵심 흐름이 설명된다

### Story 9.4: 의사(doctor) 메뉴 안내

As a 의사,
I want 진료 화면 사용법을 보기를,
So that 진료·기록·오더를 정확히 한다.

**Acceptance Criteria:**

**Given** 의사 계정 도움말에서
**When** 메뉴 안내를 보면
**Then** 진료 대기·진료 허브(SOAP·진단·오더·취소)·판독·환자 검색 각각의 스크린샷·번호 하이라이트·설명이 제공된다
**And** 진료 시작→SOAP·진단·오더→(수납에서 완료) 흐름, 본인 진료과 고정·주민번호 reveal 감사가 설명된다

### Story 9.5: 간호(nurse) 메뉴 안내

As a 간호사,
I want 간호 업무 화면 사용법을 보기를,
So that 처치 중복·누락 없이 수행한다.

**Acceptance Criteria:**

**Given** 간호 계정 도움말에서
**When** 메뉴 안내를 보면
**Then** 처치 워크리스트·활력징후 입력·간호기록 각각의 스크린샷·번호 하이라이트·설명이 제공된다
**And** 활력 입력→처치 수행(재수행 차단) 흐름이 설명된다

### Story 9.6: 방사선사(radiologist) 메뉴 안내

As a 방사선사,
I want 영상 업무 화면 사용법을 보기를,
So that 촬영→업로드→판독 흐름을 끊김 없이 수행한다.

**Acceptance Criteria:**

**Given** 방사선사 계정 도움말에서
**When** 메뉴 안내를 보면
**Then** 촬영 워크리스트·영상 업로드·장비 관리 각각의 스크린샷·번호 하이라이트·설명이 제공된다
**And** 촬영 수행→영상 업로드→의사 판독 흐름이 설명된다

### Story 9.7: 관리자(admin) 메뉴 안내

As a 관리자,
I want 관리 화면 사용법을 보기를,
So that 권한·마스터·근무·감사를 운영한다.

**Acceptance Criteria:**

**Given** 관리자 계정 도움말에서
**When** 메뉴 안내를 보면
**Then** 운영/대시보드·마스터·권한·근무 스케줄·직원 계정·감사 로그 각각의 스크린샷·번호 하이라이트·설명이 제공된다
**And** 권한 토글 즉시 반영·대시보드 월간/일별·감사 가독성 등 운영 포인트가 설명된다

### Story 9.8: 환자(portal) 메뉴 안내

As a 환자,
I want 포털 사용법을 보기를,
So that 예약·내 기록을 스스로 확인한다.

**Acceptance Criteria:**

**Given** 환자 계정 도움말에서
**When** 메뉴 안내를 보면
**Then** 예약·내 진료기록·처방/검사결과·수납/영수증 각각의 스크린샷·번호 하이라이트·설명이 제공된다
**And** 본인 데이터만(RLS) 보임이 설명된다
