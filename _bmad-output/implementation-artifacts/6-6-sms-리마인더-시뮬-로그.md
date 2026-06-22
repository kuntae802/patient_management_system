---
baseline_commit: 9981f565253a3f5ccdd4ca87915d4466e8c711da
---

# Story 6.6: SMS 리마인더 (시뮬 · 로그)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **환자**,
I want **예약 3일 전·1일 전 리마인더를 받기를**,
so that **노쇼 없이 내원한다.**

## Acceptance Criteria

**[AC1] 리마인더 디스패치 — D-3·D-1 시뮬 발송 + 이력 기록 (FR-014, 이월 갭 ③)**
- **Given** 확정된(`status='booked'`) 예약 중 `sms_opt_in=true` 인 건에 대해
- **When** 리마인더 디스패치를 실행하면(`POST /v1/scheduling/reminders/run?as_of=YYYY-MM-DD`, 기본 = 오늘 KST)
- **Then** 예약의 KST 일자가 **`as_of + 3일`(D-3)** 또는 **`as_of + 1일`(D-1)** 인 건마다 `0035_notifications.sql` 의 `notification_logs` 에 발송 이력이 1행 기록된다. 발송 = **시뮬/로그**(실 SMS 미연동) — `notification_service` 가 게이트웨이 호출 대신 로그 INSERT.

**[AC2] 멱등 재실행 — 중복 발송 0**
- **Given** 같은 `as_of` 로 디스패치를 두 번 실행할 때
- **When** 두 번째 실행이 같은 예약·같은 리마인더 종류를 다시 만나면
- **Then** `notification_logs` 의 **`UNIQUE (appointment_id, reminder_kind)`** 가 중복 INSERT 를 막아 새 행이 생기지 않는다(`ON CONFLICT DO NOTHING`). 디스패치 응답 요약은 `created`(신규)와 `duplicate`(기존)를 구분 집계한다.

**[AC3] 동의·수신 가능 게이트 — opt-in 대상 한정 + 미수신 'skipped' 정직 기록**
- **Given** 디스패치 대상 산정에서
- **When** 예약이 `sms_opt_in=false` 이면 → **대상 아님**(로그 0). `sms_opt_in=true` 이고 환자 연락처(`patients.phone`)가 있으면 → `status='simulated'`(발송). `sms_opt_in=true` 이나 연락처가 **없으면** → `status='skipped'`(`skip_reason='no_recipient'`)
- **Then** 발송 로그는 **opt-in 한 예약만** 담고, 동의했으나 보낼 수 없는 건은 스킵으로 **정직하게** 남는다(은폐 없음). `status='cancelled'/'no_show'/'completed'` 예약은 대상이 아니다(booked 만).

**[AC4] PII 경계 — 수신처 마스킹 + 로그·감사 스냅샷 원시 PII 0**
- **Given** `notification_logs` 행에 대해
- **When** 수신처를 저장하면
- **Then** 원시 전화번호가 아니라 **마스킹 스냅샷**(`recipient_masked`, 예 `010-****-5678`)만 저장된다. `body`(시뮬 메시지)에는 **환자명·주민번호 등 식별 PII 가 없다**(날짜·시각·진료과·병원명 등 비-식별 운영 텍스트만). 따라서 0035 감사 스냅샷에도 원시 PII 가 유입되지 않아 **3.6 감사 마스킹 집합(`_SENSITIVE_KEY`) 변경 불요**.

**[AC5] 원무 읽기뷰 + 디스패치 실행(최소 화면)**
- **Given** 원무 직원이 `/reception/reminders` 에서
- **When** "리마인더 실행"(as_of 입력) 버튼을 누르면 → 디스패치 호출 후 요약(생성·스킵·종류별) 표시 + 로그 목록 갱신. 로그 목록은 시각·종류(3일 전/1일 전)·수신처(마스킹)·상태(발송/스킵)를 표로 보여준다
- **Then** 읽기 = `notification.read`·실행 = `notification.send` 권한 게이트(원무 seed grant·admin 부트 grant). 403 baseline = nurse(notification.* 전무). 목록·요약에 **타 환자 식별 PII 없음**(마스킹 수신처·비-식별 body 만).

> **범위 노트(Story 6.6):** 본 스토리는 **예약 리마인더의 시뮬 발송 + 이력 기록(이음매 설계)** 만 다룬다. **실 SMS 게이트웨이 연동** = 범위 밖(`simulate_sms` 가 연결 가능한 이음매·자리만). **cron/스케줄러 자동 트리거** = 인프라 미보유 → 명시적 디스패치 엔드포인트가 그 이음매(운영 전환 시 cron 이 호출). **환자 앱의 "받은 리마인더" 수신함 UI** = Epic 8 포털(본 스토리는 staff 운영 화면만). **노쇼 카운트·임계 제한** = 6.7. **휴진 재배정 통지** = 6.8. **본인인증·결제 등 다른 시뮬 이음매** = 무관(각 스토리 소유).
>
> **모델 결정(사용자 확정 — 2026-06-22):** ① **트리거 = 명시적 디스패치 실행**(`POST /scheduling/reminders/run?as_of=` — cron 부재의 이음매·`as_of` 로 시간 목킹 없이 데모/테스트). ② **Web = 원무 최소 읽기뷰 + 실행 버튼**(`notification.read`/`notification.send`). ③ **동의 게이트 = `sms_opt_in=true` 만 발송**(연락처 없으면 `skipped`·opt-in false 는 대상 외). ④ **수신처 = 마스킹 스냅샷**(`recipient_masked`·`mask_phone()` 헬퍼 신설·원시 phone/환자명 로그 미유입).

## Tasks / Subtasks

### DB — `supabase/migrations/0035_notifications.sql` (신규) (AC: 1, 2, 3, 4, 5)
- [x] **마이그 번호 0035**: Epic 6 블록 0030~ 의 여섯 번째(6.1=0030·6.2=0031·6.3=0032·6.4=0033·6.5=0034). 병렬 Epic 5(0015~0029) 비충돌. 아키텍처 계획의 `0013_notifications.sql`(SMS 시뮬·이월 갭 ③)에 대응하는 Epic 6 번호. 의존: 0031(appointments·status·sms_opt_in[0032]), 0009(patients·phone), 0002(permissions·role_permissions·roles), 0004(audit_trigger_fn).
- [x] **`notification_logs` 테이블(append-only 발송 이력)**:
  ```sql
  create table if not exists public.notification_logs (
    id                uuid primary key default gen_random_uuid(),
    appointment_id    uuid not null references public.appointments (id),
    patient_id        uuid not null references public.patients (id),   -- 비정규화(조회·RLS·집계)
    channel           text not null default 'sms' check (channel in ('sms')),
    reminder_kind     text not null check (reminder_kind in ('d_minus_3', 'd_minus_1')),
    recipient_masked  text,                                            -- 마스킹 수신처(skipped 시 null)
    body              text not null,                                   -- 시뮬 메시지(비-식별 PII)
    status            text not null check (status in ('simulated', 'skipped')),
    skip_reason       text,                                            -- 'no_recipient' 등(simulated 시 null)
    appointment_start timestamptz not null,                           -- 리마인더 대상 예약 시각 스냅샷
    sent_at           timestamptz,                                     -- simulated=발송시각·skipped=null
    created_at        timestamptz not null default now(),
    constraint notification_logs_once unique (appointment_id, reminder_kind)  -- 멱등(AC2)
  );
  create index if not exists idx_notification_logs_appointment_id on public.notification_logs (appointment_id);
  create index if not exists idx_notification_logs_patient_id on public.notification_logs (patient_id);
  create index if not exists idx_notification_logs_created_at on public.notification_logs (created_at);
  ```
  - ⚠️ `reminder_kind`·`status` 어휘는 **CHECK 로 전 도메인 고정**(미래 ALTER 회피·0031 status 선례). `channel` = 'sms' 단일(향후 push/email = CHECK 확장 이음매).
- [x] **권한 카탈로그 확장(2종 신규)** — `notification.read`(로그 조회)·`notification.send`(디스패치 실행). 0031/0032/0033 패턴 그대로:
  ```sql
  insert into public.permissions (code, name, resource, action) values
    ('notification.read', '알림 로그 조회', 'notification', 'read'),
    ('notification.send', '알림 디스패치 실행', 'notification', 'send')
  on conflict (code) do nothing;
  ```
  - ⚠️ **admin 부트 grant 재실행 필수**(신규 권한 2종) — 0002 admin cross-join 은 후행 마이그 권한 미포함 → 누락 시 `test_admin_role_has_all_permissions` 회귀(0010·0012~0015·0031·0032·0033 함정). `where r.code='admin'` cross-join 으로 두 권한 grant.
- [x] **권한 posture·GRANT(append-only by grant)** — `audit_logs`(0004) 가벼운 변형. UPDATE/DELETE 는 전 역할 회수(발송 이력은 불변), service_role = INSERT/SELECT, authenticated = SELECT(RLS 게이트):
  ```sql
  revoke all on public.notification_logs from anon, authenticated, service_role;
  grant insert, select on public.notification_logs to service_role;
  grant select on public.notification_logs to authenticated;
  ```
  - ⚠️ **service_role 에 update/delete grant 하지 않음**(발송 로그 = 한 번 쓰면 불변). audit_logs 의 삼중 가드(BEFORE 트리거 차단)까진 불요 — 정상 운영에서 앱이 UPDATE/DELETE 를 호출하지 않고 GRANT 부재로 봉쇄(append-only by grant). appointments 의 full-CRUD service_role 과 다른 posture(예약은 전이 UPDATE 필요·로그는 불변).
- [x] **RLS(방어심층 — 0031 appointments 인라인 패턴 미러)**:
  ```sql
  alter table public.notification_logs enable row level security;
  -- 직원 = notification.read 보유 시 전체 행(원무·관리자). appointments_select_staff 미러.
  drop policy if exists notification_logs_select_staff on public.notification_logs;
  create policy notification_logs_select_staff on public.notification_logs
    for select to authenticated using ((select public.has_permission('notification.read')));
  -- 쓰기 정책 없음 = authenticated INSERT/UPDATE/DELETE 거부(쓰기는 service_role RLS 우회).
  ```
  - ⚠️ **환자 본인 수신함(self SELECT) 정책 = 본 스토리 제외**(환자 수신 UI = Epic 8 포털). appointments 의 `appointments_select_self` 같은 self 정책은 **추가하지 않는다**(YAGNI·Epic 8 이 필요 시 추가). 명시 이월.
- [x] **감사 트리거 부착(0004 audit_trigger_fn 재사용)** — 디스패치 발송이 actor 와 함께 자동 기록:
  ```sql
  drop trigger if exists trg_notification_logs_audit on public.notification_logs;
  create trigger trg_notification_logs_audit after insert or update or delete on public.notification_logs
    for each row execute function public.audit_trigger_fn();
  ```
  - ⚠️ **마스킹 검토(완료·무변경)**: 스냅샷 컬럼 = `recipient_masked`(이미 마스킹)·`body`(비-식별 텍스트)·`patient_id`/`appointment_id`(FK·opaque)·시각·status. **원시 PII 없음** → 3.6 `_SENSITIVE_KEY` 변경 불요(0031 appointments·0010 동일). `body` 에 환자명/주민번호를 **절대 넣지 않는다**(서비스 `_build_reminder_body` 가 비-식별만 — AC4).
- [x] **glossary 갱신**: `docs/glossary.md` 끝에 §SMS 리마인더(Story 6.6, `0035_notifications.sql`) 섹션 추가 — `notification_log` 테이블·`reminder_kind`·`notification_logs_once`·`notification.read`/`notification.send`·엔드포인트 2종·`run_appointment_reminders`·`mask_phone`·`ReminderRunSummary`·`NotificationLogResponse` 등재. (예약된 용어 `notification_log`[glossary:49]의 구체화.)

### API — 알림 디스패치 + 읽기 (AC: 1, 2, 3, 4, 5)
> ⚠️ **시뮬 이음매 = `notification_service`**(architecture §Integration: "SMS(`notification_service`+`notification_logs`)"). 실 게이트웨이 호출 대신 로그 INSERT — `simulate_sms` 가 교체 지점. 쓰기·읽기 모두 service_role(`_run_authed`)·KST 고정 +9(6.2 `_KST` 재사용).
- [x] `api/app/services/notification.py` — **신규 서비스 모듈**(SMS 시뮬 이음매):
  - `_KST = timezone(timedelta(hours=9))`·상수 `REMINDER_OFFSETS = {"d_minus_3": 3, "d_minus_1": 1}`(D-N 일수).
  - `mask_phone(phone: str | None) -> str | None` — 마스킹 헬퍼(rrn 마스킹 선례·`services/rrn` 패턴). 입력 정규화(숫자만 추출) 후 **마지막 4자리만 노출**, 가운데 마스킹: `01012345678` → `010-****-5678`. None/빈/4자리 미만 → None(또는 전부 `*`). 단위 테스트 대상(순수).
  - `_build_reminder_body(*, appointment_start: datetime, department_name: str, kind: str) -> str` — **비-식별** 시뮬 메시지(순수). 예: `"[○○병원] 예약 안내: 6월 25일(목) 오후 2:30 정형외과 진료 예약이 있습니다. 변경·취소는 병원으로 문의해 주세요."`. ⚠️ **환자명·주민번호·원시 연락처 금지**(AC4). 12시간 표기(`hour12` KST·환자 친화·6.5 `formatSlotTime12h` 정신).
  - `async def run_appointment_reminders(sub: UUID, as_of: date | None) -> ReminderRunSummary` — 오케스트레이션:
    1. `as_of` 기본 = `datetime.now(_KST).date()`(KST 오늘). D-3 대상일 = `as_of + 3일`, D-1 대상일 = `as_of + 1일`(KST date).
    2. `db.fetch_reminder_due_appointments(sub, d3_date=..., d1_date=...)` → `status='booked' AND sms_opt_in=true AND KST(scheduled_start) ∈ {d3,d1}` 인 예약 + phone + department_name(내부용·응답 미반환).
    3. 각 행: `kind` = (KST 일자가 d3 → 'd_minus_3' / d1 → 'd_minus_1'). `recipient = mask_phone(phone)`. `status, skip_reason, sent_at` = phone 있으면 ('simulated', None, now) / 없으면 ('skipped', 'no_recipient', None). `body = _build_reminder_body(...)`(항상 생성 — 보냈을 메시지).
    4. `db.insert_notification_log(...)`(멱등 ON CONFLICT) → 신규면 created++·기존(None)이면 duplicate++. 종류·상태별 집계.
    5. `ReminderRunSummary` 반환(as_of·created·duplicate·simulated·skipped·by_kind).
  - `async def list_notification_logs(sub: UUID, *, limit: int = 100) -> list[NotificationLogResponse]` — 최근 발송 이력(시각 내림차순). `NotificationLogResponse` 매핑(원시 phone·환자명 미포함).
- [x] `api/app/core/db.py` — 신규 함수 2종(+ 멱등 INSERT 1종·전부 `_run_authed`):
  - `fetch_reminder_due_appointments(sub, *, d3_date, d1_date)` — service_role 읽기(RLS 우회·`fetch_appointments_for_date` 패턴). `appointments a join patients p join departments d`. 필터: `a.status='booked' AND a.sms_opt_in AND (a.scheduled_start KST date) in ($d3,$d1)`. ⚠️ KST 일자 비교 = `(a.scheduled_start at time zone 'Asia/Seoul')::date in ($1,$2)`(또는 UTC 범위 2구간 OR — tzdata 의존 시 6.2 `_KST` 처럼 서비스에서 UTC 범위 산출 후 전달; **선호 = 서비스가 KST 일자 → UTC [start,end) 2구간 계산 후 db 는 범위 OR 조회**, `_KST` 고정오프셋 일관·`at time zone` DB 의존 회피). 반환 = `a.id, a.patient_id, a.scheduled_start, p.phone, d.name as department_name`.
  - `insert_notification_log(sub, *, appointment_id, patient_id, reminder_kind, recipient_masked, body, status, skip_reason, appointment_start, sent_at) -> asyncpg.Record | None` — service_role 직접 INSERT(`_require_notification_send` TOCTOU 재평가 → `insert_appointment` 패턴). `on conflict (appointment_id, reminder_kind) do nothing returning ...` → 충돌 시 **None**(이미 존재·멱등). 0035 감사 트리거 자동 포착.
  - `fetch_notification_logs(sub, *, limit) -> list[asyncpg.Record]` — service_role SELECT(`order by created_at desc limit $1`). 원시 phone 미조회(컬럼에 없음 — recipient_masked 만).
  - `_require_notification_send(conn)` / 읽기 게이트는 엔드포인트 `require_permission('notification.read')` 로 충분(읽기 재평가 불요·슬롯 읽기 선례). 쓰기(insert_notification_log)는 동일 txn `has_permission('notification.send')` 재평가(TOCTOU·`_require_appointment_create` 미러).
- [x] `api/app/schemas/scheduling.py`(또는 신규 `schemas/notifications.py`) — Pydantic(snake_case):
  - `ReminderRunSummary`: `as_of: date`·`created: int`·`duplicate: int`·`simulated: int`·`skipped: int`·`by_kind: dict[str,int]`(예 `{"d_minus_3":2,"d_minus_1":1}`).
  - `NotificationLogResponse`: `id`·`appointment_id`·`patient_id`·`channel`·`reminder_kind`·`recipient_masked: str | None`·`body`·`status`·`skip_reason: str | None`·`appointment_start: datetime`·`sent_at: datetime | None`·`created_at`. ⚠️ **원시 phone·patient_name 필드 부재**(추가 금지·AC4).
  - 위치 권고: 신규 `schemas/notifications.py`(scheduling 비대화 회피·notification 도메인 분리). 라우터는 scheduling.py 에 둠(예약 리마인더라 도메인 인접·별도 라우터 불요).
- [x] `api/app/api/v1/scheduling.py` — 알림 라우트 2종(신규·scheduling.py 내·정적 세그먼트 `reminders`):
  - `require_notification_read = require_permission("notification.read")`·`require_notification_send = require_permission("notification.send")`(모듈 로드 시 1회 — 기존 require_* 선례).
  - `POST /scheduling/reminders/run`(query `as_of: date | None = None`) → 게이트 `require_notification_send` → `notification_service.run_appointment_reminders(user.sub, as_of)`. 응답 `ReminderRunSummary`(200).
  - `GET /scheduling/reminders`(query `limit: int = 100`) → 게이트 `require_notification_read` → `notification_service.list_notification_logs(user.sub, limit=limit)`. 응답 = `list[NotificationLogResponse]`(또는 `{data, meta}` 목록 봉투 — 프로젝트 목록 포맷 정합; **간결성 위해 list 반환·기존 list[SchedulingDoctor] 선례**).
  - ⚠️ 정적 `reminders` 세그먼트 — `/appointments/{appointment_id}/...`·`/me/...` 동적 라우트와 충돌 없음. `from app.services import notification as notification_service` import 추가.
- [x] `api/app/api/v1/router.py` — **무변경**(scheduling 라우터 이미 등록·신규 라우터 없음).

### Web — 원무 리마인더 화면 `(staff)/reception/reminders` (AC: 5)
> ⚠️ **`web/AGENTS.md`: "This is NOT the Next.js you know."** 구현 전 `node_modules/next/dist/docs/` 의 App Router·route group 가이드 확인. 현행 코드 우선(클라 컴포넌트·`useState`·`apiFetch`·Base UI). 새 라이브러리 임의 추가 금지.
- [x] `web/src/lib/scheduling/reminders.ts`(신규) — fetch·타입(snake_case 유지):
  - `runReminders(asOf?: string)` → `POST /v1/scheduling/reminders/run?as_of=`(apiFetch). `fetchNotificationLogs(limit?)` → `GET /v1/scheduling/reminders`. 타입 `ReminderRunSummary`·`NotificationLog`(서버 스키마 거울).
  - 라벨 헬퍼: `REMINDER_KIND_LABEL = {d_minus_3:"3일 전", d_minus_1:"1일 전"}`·`STATUS_LABEL = {simulated:"발송(시뮬)", skipped:"스킵"}`. 시각 포맷 = KST 24h(직원 — 기존 `formatSlotTime` 정신·`lib/scheduling/slots.ts` 재사용 가능). `recipient_masked ?? "(연락처 없음)"`.
- [x] `web/src/app/(staff)/reception/reminders/page.tsx`(신규·서버 컴포넌트 가드):
  - 직원/역할 가드 = 기존 reception 라우트 페이지 패턴 미러(`(staff)/layout.tsx` AppShell + 미들웨어가 1차 가드). 그 후 `<ReminderLog />` 렌더. (참고: `(staff)/reception/schedule/page.tsx` 구조.)
- [x] `web/src/components/scheduling/reminder-log.tsx`(신규·클라):
  - **실행 패널**: `as_of` 날짜 입력(기본 빈값=서버 오늘) + "리마인더 실행" 버튼(≥44px) → `runReminders(asOf)` → 성공 시 요약 표시("생성 N · 스킵 M · 3일 전 X · 1일 전 Y") + 로그 재조회. **이중제출 락**(useRef·mutation 중 disable). 실패 → 인라인 에러.
  - **로그 표**: 시각(created_at KST)·종류(3일 전/1일 전)·수신처(마스킹·없으면 "(연락처 없음)")·상태(발송/스킵·skip_reason). 음영 비의존(상태=라벨+테두리·DR20). 빈-상태("아직 발송된 리마인더가 없습니다 · 실행을 눌러 보세요").
  - **실행 버튼 권한 게이트**: `notification.send` 보유자만 노출(PermissionGate·`usePermissions`). 읽기뷰는 reception 역할 노출(seed 로 notification.read 보유). PII: 마스킹 수신처·비-식별 body 만(타 환자명 0).
  - ⚠️ 상태 분리: 현행 scheduling 컴포넌트 컨벤션(`useState`+`apiFetch`·slot-availability/booking-detail 선례). TanStack Query 미사용 영역 일관.
- [x] `web/src/lib/nav/staff-nav.ts`(UPDATE) — 원무 "운영" 섹션에 nav 항목 추가:
  ```ts
  { section: "운영", label: "리마인더", icon: BellRing, href: "/reception/reminders", roles: ["reception"] },
  ```
  - 노출 = 역할(원무 운영 본질·"예약 관리" 동형·requiredPermission 미지정). 실 동작(실행/읽기)은 API + 컴포넌트 PermissionGate 가 게이트. `BellRing`(또는 적절한 lucide 아이콘) import 추가.

### 테스트 (AC: 1, 2, 3, 4, 5)
- [x] **DB**(`test_migrations_notifications.py` 신규): `notification_logs` 컬럼·FK(appointment_id·patient_id)·`UNIQUE(appointment_id,reminder_kind)`·`status`/`reminder_kind`/`channel` CHECK 위반 거부·append-only GRANT(authenticated UPDATE/DELETE 부재·service_role update/delete 부재)·RLS enabled·감사 트리거 부착. `notification.read`·`notification.send` 권한 존재 + **admin 보유**(`test_admin_role_has_all_permissions` 회귀 가드). 멱등: 같은 (appointment_id,kind) 2회 INSERT → 1행(ON CONFLICT).
- [x] **단위**(`test_notifications.py` 신규): `mask_phone`(`01012345678`→`010-****-5678`·하이픈 포함 입력·None·짧은 입력)·`_build_reminder_body`(환자명·주민번호 **미포함** 단언·12h 라벨·진료과 포함). `run_appointment_reminders` 로직(db 모킹): D-3/D-1 일자 매칭·opt-in 필터·no-phone→skipped·멱등(insert None→duplicate 집계)·by_kind 집계·as_of 기본=KST 오늘.
- [x] **통합**(`test_scheduling_integration.py` 확장 또는 `test_notifications_integration.py` 신규·`patient_session`·reception 토큰 픽스처 재사용):
  - reception 토큰으로 예약 생성(`POST /scheduling/appointments`·`sms_opt_in=true`·환자 phone 있음·scheduled_start = 기준일+3일) → `POST /scheduling/reminders/run?as_of=기준일` → 200·요약 `created>=1`·`by_kind.d_minus_3>=1` → `GET /scheduling/reminders` 에 `status='simulated'`·`recipient_masked` 마스킹·`reminder_kind='d_minus_3'`·**원시 phone·환자명 미노출**.
  - **멱등**: 같은 run 재실행 → `created=0`·`duplicate>=1`·로그 행 수 불변.
  - **opt-in false** 예약 → run 후 로그 0. **opt-in true·phone 없는 환자**(원무 등록 시 phone 미입력) → `status='skipped'`·`skip_reason='no_recipient'`·`recipient_masked` null.
  - **권한**: nurse 토큰 → `/reminders/run` **403**·`/reminders` **403**(notification.* 미보유 baseline). notification.read 만 보유자 → run 403·read 200(최소권한 분리).
- [x] **웹**(vitest+testing-library): `reminder-log.tsx` — 로그 표 렌더(종류/상태/마스킹 라벨)·"리마인더 실행" 클릭 → `runReminders` 호출·요약 표시·이중제출 락·빈-상태·notification.send 미보유 시 실행 버튼 미노출. `reminders.ts` fetch 모킹. `staff-nav.test.ts` — 원무 "리마인더" 항목 노출·타 역할 미노출.
- [x] 회귀: ruff·eslint·tsc clean·**회귀 0**(6.1~6.5 동작 무변경·기존 예약/슬롯/캘린더 경로 유지·admin 전권 유지). ⚠️ **공유 supabase 스택**: DB/통합 테스트는 `supabase db reset && uv run pytest` **원자 실행**(6.3/6.4/6.5 교훈). reset 후 Kong auth stale DNS → 통합 skip 시 `docker restart supabase_kong_<project>`(6.4 교훈).

## Dev Notes

### 확정 설계 요약 (SMS 리마인더 — 시뮬 이음매 + 명시적 디스패치)
**리마인더 = 명시적 디스패치 실행.** 시스템에 cron/스케줄러가 없으므로(인프라 미보유) 리마인더는 **자동 발화하지 않고** `POST /scheduling/reminders/run` 으로 트리거된다. 이 엔드포인트가 바로 **연결 가능한 이음매(seam)**: 운영 전환 시 cron 이 매일 이 엔드포인트를 호출하거나, 내부 `simulate_sms`(로그 INSERT)를 실 SMS 게이트웨이 호출로 교체한다. `as_of` 쿼리(기본 = KST 오늘)는 "오늘로 가정할 날짜" — 시간 목킹(`now` 패치) 없이 데모·테스트에서 D-3/D-1 발화를 재현한다(6.2 `_KST` 고정오프셋·`Date.now` 회피 철학 정합).

**대상 산정 = booked ∩ opt-in ∩ {D-3, D-1}.** `as_of+3일`·`as_of+1일`(KST date)에 해당하는 `status='booked'`·`sms_opt_in=true` 예약만 대상. 동의(`sms_opt_in`, booking 체크박스·6.3/6.5 가 저장)가 발송 전제다. 동의했으나 연락처 없는 건은 `skipped`(no_recipient)로 **정직하게** 남긴다(은폐 금지). cancelled/no_show/completed 는 대상 아님.

**멱등 = `UNIQUE(appointment_id, reminder_kind)`.** 같은 예약·같은 종류는 한 번만 발송(재실행 안전). `ON CONFLICT DO NOTHING` → 디스패치 응답이 created/duplicate 를 구분. (예약 변경 후 재-리마인더, 다채널, 발송 실패 재시도 = 이월.)

**PII 경계 = 마스킹 + 비-식별 body.** 원시 phone 은 절대 로그에 들어가지 않는다 — `mask_phone()` 으로 `recipient_masked`(`010-****-5678`)만 저장. `body` 는 날짜·시각·진료과·병원명만(환자명·주민번호 없음). 따라서 0035 감사 스냅샷에도 원시 PII 가 없어 3.6 `_SENSITIVE_KEY` 무변경(0031 appointments·0010 동일 posture).

### 핵심 아키텍처 패턴·제약 (반드시 따를 것)
- **시뮬 이음매 = `notification_service` + `notification_logs`**: architecture §Integration Points 명시("SMS(`notification_service`+`notification_logs`)"). 실연동 대신 이음매(자리만). `simulate_sms` = 게이트웨이 교체 지점. [Source: architecture.md:64,400·322,341]
- **쓰기 = service_role 직접 INSERT**(전이 RPC 아님·`insert_appointment` 미러). 멱등·active·동의는 DB(UNIQUE·CHECK)·서비스(필터)가 소유. 권한은 쓰기 직전 동일 txn 재평가(`_require_notification_send`·TOCTOU). [Source: api/app/core/db.py:2797-2862·2786-2789]
- **읽기 = service_role(`_run_authed`)**·엔드포인트 `notification.read` 게이트로 충분(슬롯·캘린더 선례·읽기 재평가 불요). [Source: api/app/core/db.py:2394-2432·scheduling.py:140-184]
- **actor 자동 캡처**: `_run_authed` 가 `set local app.actor_id = sub` → 0035 감사 트리거가 발송 actor(디스패치 실행 직원) 기록. 앱은 감사 INSERT 직접 안 함. [Source: api/app/core/db.py:114-130·0004_audit.sql:24-56]
- **KST = 고정 +9**(zoneinfo/tzdata 의존 회피). D-3/D-1 일자·body 시각 표시. 서비스가 KST date → UTC [start,end) 범위 산출 후 db 에 전달(`at time zone` DB 의존 회피·6.2 슬롯 계산 동형). [Source: api/app/services/scheduling.py:40-43,204-207]
- **append-only by grant**: notification_logs = service_role INSERT/SELECT·authenticated SELECT(RLS). UPDATE/DELETE grant 부재(audit_logs 변형·단 삼중 가드까진 불요). appointments 의 full-CRUD 와 다른 posture(로그=불변). [Source: 0004_audit.sql:92-114·0031_appointments.sql:87-114]
- **포맷·에러봉투**: `{error:{code,message(한국어),detail}}`·HTTP(403 권한). 목록 = list 직접(`list[SchedulingDoctor]` 선례) 또는 `{data,meta}`. 금액 없음·시각 ISO8601(KST 표시는 Intl/고정오프셋). [Source: project-context.md 포맷]
- **마이그 = Supabase CLI**·0035 = 다음 Epic 6 번호. **DDL FastAPI 금지**·glossary 선등재. [Source: project-context.md·docs/glossary.md:49]
- **노출 모델(RBAC UI)**: 원무 핵심 메뉴 = 역할 노출("리마인더"=운영 본질·"예약 관리" 동형). 실 동작(실행/읽기)은 API + PermissionGate 게이트. [Source: web/src/lib/nav/staff-nav.ts:47-57·메모리 rbac-ui-exposure-model]

### 소스 트리 — 변경/신규
| 파일 | 동작 | 비고 |
|---|---|---|
| `supabase/migrations/0035_notifications.sql` | **신규** | `notification_logs`(append-only·UNIQUE 멱등)·`notification.read`/`notification.send` 권한·admin 부트 grant·RLS·감사 트리거 |
| `docs/glossary.md` | UPDATE | §SMS 리마인더(notification_log·reminder_kind·권한·엔드포인트·mask_phone·스키마) |
| `api/app/services/notification.py` | **신규** | `mask_phone`·`_build_reminder_body`·`run_appointment_reminders`·`list_notification_logs`(시뮬 이음매) |
| `api/app/core/db.py` | UPDATE | `fetch_reminder_due_appointments`·`insert_notification_log`(멱등 ON CONFLICT)·`fetch_notification_logs`·`_require_notification_send` |
| `api/app/schemas/notifications.py` | **신규** | `ReminderRunSummary`·`NotificationLogResponse`(원시 phone·환자명 부재) |
| `api/app/api/v1/scheduling.py` | UPDATE | `POST /scheduling/reminders/run`·`GET /scheduling/reminders`(notification.send/read 게이트) |
| `web/src/lib/scheduling/reminders.ts` | **신규** | `runReminders`·`fetchNotificationLogs`·라벨 헬퍼·타입 |
| `web/src/app/(staff)/reception/reminders/page.tsx` | **신규** | 서버 가드 + `<ReminderLog />` |
| `web/src/components/scheduling/reminder-log.tsx` | **신규** | 실행 패널(as_of·이중제출 락) + 로그 표(마스킹·상태·음영 비의존) + PermissionGate |
| `web/src/lib/nav/staff-nav.ts` | UPDATE | 원무 "리마인더" nav 항목(역할 노출) |
| `supabase/seed.sql` | UPDATE | reception → `notification.read`+`notification.send` grant(원무 운영). 데모 로그 시드 없음(환자 미시드·테스트/UI 생성) |
| `api/tests/*`·웹 `*.test.tsx` | 신규/UPDATE | DB·단위(mask/body/run)·통합(발송·멱등·opt-in·skip·403)·웹(표·실행·nav) |
| `api/app/api/v1/router.py` | **무변경** | scheduling 라우터 이미 등록 |

### 이전 스토리(6.1~6.5) 인텔리전스 — 반드시 재사용
- **6.2 슬롯/KST**: `_KST` 고정 +9·KST date → UTC 범위 산출 패턴(`compute_available_slots` day_start/day_end). D-3/D-1 일자 → UTC 범위 OR 조회에 동형 재사용. [Source: api/app/services/scheduling.py:40-43,204-220]
- **6.3 예약 생성**: `insert_appointment`(service_role 직접 INSERT·`_require_appointment_create` TOCTOU·EXCLUDE/FK catch·`_APPOINTMENT_COLUMNS`)·`sms_opt_in` 컬럼(0032). `insert_notification_log` 이 이 패턴 미러(멱등 ON CONFLICT 추가). [Source: api/app/core/db.py:2786-2862·0032_appointment_booking.sql:19-22]
- **6.4 전이/권한**: `_require_appointment_update` 동일 txn 재평가(`_require_notification_send` 미러)·도메인별 신규 권한 + admin 부트 grant 재실행(회귀 가드)·seed reception grant. [Source: api/app/core/db.py:2965-2968·0033_appointment_lifecycle.sql:51-66·seed.sql:260-266]
- **6.5 환자/12h·웹**: `formatSlotTime12h`(hour12·환자 친화 — body 시각 표기 정신)·`fetch_appointments_for_date`(appointments+patients+dept 조인·환자명은 staff OK이나 **본 로그는 body 에 환자명 미포함**)·웹 `useState`+`apiFetch`+이중제출 락(slot-availability/onboarding 선례). [Source: api/app/core/db.py:2934-2955·web/src/components/scheduling/patient-booking.tsx]
- **3.6 감사 마스킹**: `_SENSITIVE_KEY` 집합(서버측 PII 마스킹). 0035 컬럼 비-식별(마스킹 수신처·비-식별 body·FK) → 집합 무변경(0031/0010 선례). ⚠️ body 에 환자명 유입 시 마스킹 교차절단 필요 → **유입 금지**가 1차선. [Source: api/app/services/audit.py·0031:115-122]
- **1.9 rrn 마스킹**: 주민번호 마스킹·HMAC 선례(`mask_phone` 이 동형 — 단 phone 은 암호화·blind index 불요·평문 마스킹만). [Source: api/app/services/rrn·0005_crypto.sql]
- **권한 함정**: admin cross-join 은 후행 마이그 권한 미포함 → `notification.read/send` 둘 다 admin 부트 grant 재실행 필수(0010·0012~0015·0031·0032·0033 가 겪은 회귀). [Source: 0033_appointment_lifecycle.sql:58-66]
- **⚠️ 공유 supabase 스택**(6.3/6.4/6.5 교훈): 두 worktree 단일 스택 → DB/통합 테스트 `reset && pytest` 원자 실행. reset 후 Kong auth stale DNS → `docker restart supabase_kong_<project>`. [Source: 메모리 epic6-parallel-worktree·6-4 환경교훈]

### 보안 체크리스트 (LLM 이 놓치기 쉬운 비자명 — 반드시 검증)
- [x] `notification_logs` 에 **원시 phone 컬럼 부재**(recipient_masked 만). `mask_phone` 이 INSERT 전 마스킹·`fetch_*` 가 원시 phone 미반환.
- [x] `body` 에 **환자명·주민번호 0**(`_build_reminder_body` 가 비-식별 텍스트만). `NotificationLogResponse` 에 patient_name 필드 부재.
- [x] 감사 스냅샷(0035 트리거 유입분) 원시 PII 0 → `_SENSITIVE_KEY` 무변경 확인.
- [x] `notification.send`/`notification.read` **최소권한 분리**(read 만으론 run 403). nurse baseline 403(둘 다 미보유).
- [x] 멱등 `UNIQUE(appointment_id, reminder_kind)` → 재실행 중복 0. opt-in false/비-booked 는 대상 외(로그 0).
- [x] append-only: authenticated·service_role UPDATE/DELETE grant 부재(발송 이력 불변).

### 스코프 경계 — 본 스토리 NOT (명시 이월)
- **실 SMS 게이트웨이 연동** = 범위 밖(`simulate_sms` 이음매·자리만). **cron 자동 스케줄링** = 인프라 미보유(디스패치 엔드포인트가 이음매).
- **환자 앱 "받은 리마인더" 수신함 UI·self SELECT 정책** = Epic 8 포털(본 스토리 = staff 운영 화면·notification_logs self RLS 미추가).
- **노쇼 카운트·임계 제한**(상습 노쇼 예약 차단) = 6.7. **휴진 재배정 통지** = 6.8.
- **예약 변경 후 재-리마인더·다채널(push/email)·발송 실패 재시도·발송 예약(scheduled_for) 큐** = 이월(멱등 UNIQUE 가 단순 1회·1채널 보장).
- **리마인더 D-N 오프셋 설정 UI**(병원별 가변) = 이월(상수 REMINDER_OFFSETS·D-3/D-1 고정).

### Project Structure Notes
- API: 신규 `services/notification.py`(notification 도메인 분리·scheduling 비대화 회피)·`schemas/notifications.py`. 라우트는 `api/v1/scheduling.py` 내 `/reminders` 세그먼트(예약 리마인더라 인접·별도 라우터 불요). db 함수는 `core/db.py`.
- Web: `(staff)/reception/reminders`·`components/scheduling/reminder-log.tsx`·`lib/scheduling/reminders.ts`·`lib/nav/staff-nav.ts`. 마이그 0035 = Epic 6 블록.
- ⚠️ Next.js 비표준(`web/AGENTS.md` — `node_modules/next/dist/docs/` 선독). 병렬 Epic 5(0015~0029)와 비충돌(0035)·공유 파일(db.py·glossary·scheduling.py·staff-nav.ts)=merge union(6-1~6-5 선례).
- main 머지: 6-5 까지 main 흡수 완료(6.6 착수 = FF 예상). done 후 glossary 섹션 충돌만 예상(병렬 패턴).

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.6 (1153-1165)] — AC 원문(D-3·D-1 트리거·notification_logs 이력·시뮬/로그·FR-014·이월 갭 ③)
- [Source: _bmad-output/planning-artifacts/architecture.md:64,322,341,400·179] — 시뮬 이음매(notification_service+notification_logs)·0013_notifications 계획(이월 갭 ③)·SMS 실연동 범위 밖
- [Source: _bmad-output/planning-artifacts/prds/.../prd.md:106,290·research-domain.md:33,49] — FR-014(3일·1일 전 SMS·이력)·발송 시뮬/로그(실연동 범위 밖)·도메인(리마인더 SMS 62%·최적 3일+1일 전)
- [Source: supabase/migrations/0031_appointments.sql:28-122] — appointments 스키마(status·patient_id·doctor_id·department_id·scheduled_start)·RLS staff/self·감사 트리거·권한+admin 부트 grant 패턴(미러)
- [Source: supabase/migrations/0032_appointment_booking.sql:19-22] — `sms_opt_in`(bool·기본 false·6.3/6.5 저장만·6.6 소비)
- [Source: supabase/migrations/0004_audit.sql:8-114] — audit_logs append-only(GRANT 회수·RLS·트리거)·audit_trigger_fn(actor=app.actor_id)·notification_logs append-only-by-grant 모델
- [Source: supabase/migrations/0009_patients.sql:28,36] — patients.name·phone(text·nullable·SMS 수신처·마스킹 대상)
- [Source: api/app/core/db.py:114-130,2786-2862,2934-2955,2394-2432] — `authenticated_conn`(actor 주입)·`insert_appointment`/`_require_appointment_create`(미러)·`fetch_appointments_for_date`(조인)·`fetch_*_in_range`(service_role 읽기)
- [Source: api/app/services/scheduling.py:40-43,204-220,251-277] — `_KST`·KST date→UTC 범위·`create_appointment`(서비스 오케스트레이션 미러)
- [Source: api/app/api/v1/scheduling.py:41-50,140-184,261-271] — require_* 의존성·슬롯/캘린더 읽기 게이트·`/me` 정적 세그먼트(reminders 동형)
- [Source: web/src/lib/nav/staff-nav.ts:37-115] — NavItem·STAFF_NAV(원무 운영 본질=역할 노출·"예약 관리" 선례)·filterNav·노출 모델
- [Source: web/src/components/scheduling/patient-booking.tsx·booking-detail.tsx·slot-availability.tsx] — useState+apiFetch·이중제출 락·12h 포맷·음영 비의존·인라인 에러(reminder-log 미러)
- [Source: docs/glossary.md:49,376-460] — `notification_log` 예약 용어·예약 섹션(6.6 §추가 위치)
- [Source: docs/project-context.md] — PII 경계(원시 phone/PII 로그 금지)·service_role 쓰기·append-only·snake_case·KST·마이그 단일 소유·에러봉투
- [Source: 메모리 epic6-parallel-worktree·rbac-ui-exposure-model] — worktree∥머지·공유 supabase 스택 교훈·직무 핵심=역할 노출

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Opus 4.8 1M context)

### Debug Log References

- ⚠️ 착수 전 `git merge main` = **FF**(2ae7f9e → 9981f56 — 5.5 오더 패널 done 흡수). 미커밋 sprint-status 가 FF 를 막아 HEAD 로 되돌린 뒤 FF·baseline_commit 을 머지 후 HEAD(9981f56)로 갱신(6.5 관행). 5.5 흡수 후 0016 오더안전 + 0030~0035 스케줄/알림 공존 확인.
- **공유 supabase 스택**(6.3/6.4/6.5 교훈): DB/통합 테스트 전 `supabase db reset` + `docker restart supabase_kong_patient_management_system`(auth stale DNS 회피·6.4 교훈) → 통합 테스트가 skip 없이 실제 실행(scheduling integration 37 + reminder 6 = 실행 10.88s).
- **ruff E501(라인 100 초과·한국어 docstring/주석)** 수동 래핑(6.2 기록 동일 패턴). ruff format 은 긴 주석/문자열을 안 쪼개므로 별도 단축. 최종 `ruff check app/ tests/` clean.
- **웹 ICU 비의존**(6.5 교훈 선반영): `_format_kst_12h` 를 strftime/locale 대신 수동 산출(period=오전/오후·hour%12) → 테스트 환경 Node 제한 ICU 와 무관하게 "오후 2:30" 결정적.
- **as_of 디스패치 검증**: `as_of` 쿼리로 시간 목킹(`now` 패치) 없이 D-3(as_of=2030-05-31)·D-1(as_of=2030-06-02) 발화를 통합 테스트에서 재현(데모 의사 근무일 2030-06-03 예약).

### Completion Notes List

- **모델(시뮬 이음매·명시적 디스패치)**: cron 부재 → `POST /scheduling/reminders/run?as_of=` 가 이음매(운영 전환 시 cron 호출). 발송 = 시뮬/로그(`notification_service` 가 게이트웨이 대신 로그 INSERT). 대상 = booked ∩ sms_opt_in ∩ {as_of+3일 D-3, as_of+1일 D-1}(KST). 멱등 = DB `UNIQUE(appointment_id, reminder_kind)`.
- **DB(0035)**: `notification_logs`(append-only by grant=service_role INSERT/SELECT·UPDATE/DELETE grant 부재·발송 후 불변)·UNIQUE 멱등·reminder_kind/status/channel CHECK·감사 트리거·RLS staff(notification.read·self 정책 미추가=Epic 8 이월). 신규 권한 `notification.read`/`notification.send` + admin 부트 grant 재실행(회귀 가드) + reception seed grant. 마스킹 수신처·비-식별 body → `_SENSITIVE_KEY` 무변경.
- **API**: `services/notification.py`(`mask_phone` 010-****-5678·`_build_reminder_body` 비-식별·`run_appointment_reminders` KST date→UTC 범위·opt-in 필터·skipped no_recipient·by_kind 집계·`list_notification_logs`)·`schemas/notifications.py`(`ReminderRunSummary`·`NotificationLogResponse` — 원시 phone·patient_name 부재)·`core/db.py`(`fetch_reminder_due_appointments`·`insert_notification_log` 멱등 ON CONFLICT·`fetch_notification_logs`·`_require_notification_send` TOCTOU)·`api/v1/scheduling.py` `POST /reminders/run`·`GET /reminders`(정적 세그먼트·충돌 없음).
- **Web**: `lib/scheduling/reminders.ts`(fetch·타입·라벨·status 메타)·`(staff)/reception/reminders/page.tsx`(서버 가드 notification.read→STAFF_HOME)·`reminder-log.tsx`(실행 패널 as_of+이중제출 락+`notification.send` PermissionGate·로그 표 마스킹 수신처·음영 비의존 상태 배지·빈-상태·요약 aria-live)·`staff-nav.ts` 원무 "리마인더"(역할 노출).
- **AC 충족**: AC1(D-3·D-1 시뮬 발송+이력)·AC2(멱등 UNIQUE·created/duplicate 구분)·AC3(opt-in 한정·연락처 없음 skipped·booked 만)·AC4(마스킹 수신처·비-식별 body·원시 PII 0)·AC5(원무 읽기뷰+실행·notification.read/send 게이트·nurse 403) 전수.
- **테스트**: API **643 passed/9 skip**(신규 = 마이그 19 + 단위 15 + 통합 6·9 skip = 환자 공개가입 미가용 기존분)·ruff clean. Web **372 passed**(신규 = reminder-log 6 + staff-nav 2)·eslint·tsc clean. **회귀 0**(6.1~6.5·5.x 동작 무변경·admin 전권 유지). PII end-to-end: 통합 테스트가 응답에 원시 전화번호(가운데 4자리) 부재 단언.
- **회귀 0 근거**: 신규 권한(notification.*) 비중첩(nurse baseline 무영향)·notification_logs 신규 테이블(기존 경로 무접촉)·db.py/scheduling.py 는 append-only 추가(기존 함수 무변경)·staff-nav 항목 추가(filterNav 로직 무변경).

### Change Log

| 날짜 | 변경 | 비고 |
|---|---|---|
| 2026-06-22 | Story 6.6 구현 완료 → review | 0035 notification_logs(append-only·멱등 UNIQUE)·`notification.read`/`notification.send` 권한·`/scheduling/reminders/run`·`/reminders`(시뮬 디스패치·opt-in 게이트·마스킹 PII)·`(staff)/reception/reminders` 화면. API 643/9skip·Web 372·회귀 0 |
| 2026-06-22 | 코드리뷰 patch 2 적용 → done | `limit` 경계(`Query ge=1,le=500`·음수/과대 422)·`mask_phone` 짧은 번호 전체 재구성 차단(prefix `≥10`). API 650/9skip 재통과·ruff clean. Auditor High/Med 0(AC1~5 전수·PII 경계 검증) |

### File List

**신규**
- `supabase/migrations/0035_notifications.sql`
- `api/app/services/notification.py`
- `api/app/schemas/notifications.py`
- `api/tests/test_migrations_notifications.py`
- `api/tests/test_notifications.py`
- `web/src/lib/scheduling/reminders.ts`
- `web/src/app/(staff)/reception/reminders/page.tsx`
- `web/src/components/scheduling/reminder-log.tsx`
- `web/src/components/scheduling/reminder-log.test.tsx`

**수정**
- `docs/glossary.md` (§SMS 리마인더·알림 로그)
- `api/app/core/db.py` (`fetch_reminder_due_appointments`·`insert_notification_log`·`fetch_notification_logs`·`_require_notification_send`·`_NOTIFICATION_COLUMNS`)
- `api/app/api/v1/scheduling.py` (`/reminders/run`·`/reminders`·notification 의존성·import)
- `api/tests/test_scheduling_integration.py` (리마인더 디스패치·멱등·opt-in·skip·403 통합)
- `supabase/seed.sql` (reception → notification.read+notification.send grant)
- `web/src/lib/nav/staff-nav.ts` (원무 "리마인더" nav·BellRing import)
- `web/src/lib/nav/staff-nav.test.ts` (리마인더 노출·교차오염)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (6-6 상태)

### Review Findings

코드리뷰 3레이어(Blind Hunter·Edge Case Hunter·Acceptance Auditor·2026-06-22). **Acceptance Auditor: High/Med 0** — AC1~5 전수 충족·4 모델 결정 준수·PII 경계(원시 phone·환자명 로그/감사/응답 미유입·`_SENSITIVE_KEY` 무변경 독립 검증)·권한 분리/회귀 가드·멱등·스코프 누수 0 → **마크 done 안전**. Blind/Edge Hunter 가 robustness·PII 마스킹 엣지에서 실질 findings 제기. 분류: **patch 2 · defer 3 · dismiss 5**.

**Patch (수정 대상)**
- [x] [Review][Patch] `GET /scheduling/reminders` 의 `limit` 무경계·미검증 → 음수 `LIMIT -1`=500·과대값=append-only 로그 풀로드 [api/app/api/v1/scheduling.py:list_reminders] (blind+edge·`admin.py:Query(ge=1,le=200)` 선례) — **적용: `Query(default=100, ge=1, le=500)` + 경계 거부 테스트(0/-1/600→422)**
- [x] [Review][Patch] `mask_phone` 가 7자리 이하 번호를 전체 재구성(`123-****-4567`→`****`가 무마스킹) → AC4 PII 경계 구멍 [api/app/services/notification.py:mask_phone] (blind+edge·prefix 노출은 가릴 중간 자리 충분할 때만) — **적용: prefix 노출 조건 `≥7`→`≥10`(짧은 번호는 last4 만) + 7/8/10자리 테스트**

**Defer (이월)**
- [x] [Review][Defer] skipped(연락처 없음) 리마인더 영구 재발송 불가 — 연락처 보정 후 재실행해도 `UNIQUE(appointment_id,reminder_kind)`+`ON CONFLICT`가 duplicate 처리(append-only=UPDATE 불가) [0035·db.insert_notification_log] — 멱등 "단순 1회"·**재시도 이월(스펙 명시)**·skipped 기록은 AC3 의도
- [x] [Review][Defer] 예약 변경(reschedule) 후 새 날짜 재-리마인더 미발화 — 같은 appointment_id·kind 라 ON CONFLICT [db.insert_notification_log] — **스펙 명시 이월**("예약 변경 후 재-리마인더=이월·멱등 UNIQUE 단순 1회 보장")
- [x] [Review][Defer] 비활성 환자/폐과 예약에도 리마인더 발화 — `fetch_reminder_due_appointments` 조인에 `p.is_active`/`d.is_active` 필터 없음 [api/app/core/db.py] — Low·booked 예약이 진실원·body 비-식별·예약 생명주기(상위 데이터 일관성) 소관

**Dismiss (노이즈/by-design 5)**: ①`as_of` 과거값 재로그(시뮬 이음매의 의도된 시간 제어·가드 불요) ②per-row `_require_notification_send` N회(쓰기 직전 TOCTOU 재평가=`_require_appointment_create` 기존 패턴·insert 마다 자기 txn=설계) ③멱등 재실행 요약 `0/0/중복 N`(스펙 정합·duplicate 로 전달) ④웹 `formatKstDateTime` ICU 표시 의존(브라우저 full ICU·body 는 수동 산출·테스트 무영향) ⑤skipped 도 body 생성·저장(스펙 "항상 생성·보냈을 메시지"·비-식별).
