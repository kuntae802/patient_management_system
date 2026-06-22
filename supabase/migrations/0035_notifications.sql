-- 0035_notifications.sql — SMS 리마인더 발송 이력(notification_logs) + 알림 권한
-- Story 6.6 / FR-014(예약 3일 전·1일 전 SMS 리마인더 발송·이력 기록·이월 갭 ③). 발송 = **시뮬/로그**
-- (실 SMS 미연동 — notification_service 가 게이트웨이 호출 대신 로그 INSERT·연결 가능한 이음매).
-- 식별자 영문 snake_case(docs/glossary.md). timestamptz=UTC. 불변식·감사는 DB 가 소유.
--
-- ⚠️ 파일 번호 0035: Epic 6 블록 0030~ 의 여섯 번째(6.1=0030·6.2=0031·6.3=0032·6.4=0033·6.5=0034).
--    병렬 Epic 5(0015~0029)와 비충돌. 아키텍처 계획의 `0013_notifications.sql`(SMS 시뮬·이월 갭 ③)에
--    대응하는 Epic 6 번호.
--
-- ⚠️ notification_logs = 발송 이력 로그(한 번 쓰면 불변). audit_logs(0004) 의 **append-only** posture 변형:
--    service_role = INSERT/SELECT 만(UPDATE/DELETE grant 부재 → 발송 후 변조 봉쇄). 단 audit_logs 의
--    삼중 가드(BEFORE 트리거 차단)까진 불요 — 정상 운영에서 앱이 UPDATE/DELETE 를 호출하지 않고
--    GRANT 부재로 봉쇄(append-only by grant). appointments(전이 UPDATE 필요·full-CRUD)와 다른 모델.
--
-- ⚠️ PII 경계(AC4): `recipient_masked`(이미 마스킹·예 010-****-5678)·`body`(비-식별 운영 텍스트 —
--    환자명·주민번호 없음)·FK(opaque)·시각·status. **원시 PII 없음** → 0035 감사 스냅샷에도 원시 PII
--    미유입 → 3.6 감사 마스킹 집합(`_SENSITIVE_KEY`) 변경 불요(0031 appointments·0010 동일 posture).
--    서비스 `_build_reminder_body` 가 body 에 비-식별만 담는다(이름·연락처 유입 금지).
--
-- 의존: 0001(gen_random_uuid), 0002(permissions·role_permissions·roles), 0004(audit_trigger_fn),
--    0009(patients — phone 마스킹 대상·FK), 0031(appointments — FK·status), 0032(appointments.sms_opt_in).

-- ── notification_logs (SMS 리마인더 발송 이력 — append-only by grant) ───────────────────────────
-- 한 행 = 한 예약×한 리마인더 종류(D-3 또는 D-1)의 1회 시뮬 발송 기록. UNIQUE(appointment_id,
-- reminder_kind) = 멱등(같은 디스패치 재실행이 중복 발송 안 함·ON CONFLICT DO NOTHING). status =
-- simulated(연락처 있어 발송) | skipped(opt-in 했으나 연락처 없음 — 정직 기록). reminder_kind·status·
-- channel CHECK = 전 도메인 고정(미래 ALTER 회피·0031 status 선례). channel='sms' 단일(향후 push/email
-- = CHECK 확장 이음매).
create table if not exists public.notification_logs (
  id                uuid primary key default gen_random_uuid(),
  appointment_id    uuid not null references public.appointments (id),  -- 리마인더 대상 예약
  patient_id        uuid not null references public.patients (id),      -- 비정규화(조회·RLS·집계)
  channel           text not null default 'sms' check (channel in ('sms')),
  reminder_kind     text not null check (reminder_kind in ('d_minus_3', 'd_minus_1')),  -- 3일 전·1일 전
  recipient_masked  text,                          -- 마스킹 수신처(010-****-5678; skipped=null)
  body              text not null,                 -- 시뮬 메시지(비-식별 — 이름·주민번호 없음)
  status            text not null check (status in ('simulated', 'skipped')),
  skip_reason       text,                          -- 'no_recipient' 등(simulated 시 null)
  appointment_start timestamptz not null,          -- 리마인더 대상 예약 시각 스냅샷
  sent_at           timestamptz,                   -- simulated=발송시각·skipped=null
  created_at        timestamptz not null default now(),
  constraint notification_logs_once unique (appointment_id, reminder_kind)  -- 멱등(AC2)
);

create index if not exists idx_notification_logs_appointment_id on public.notification_logs (appointment_id);
create index if not exists idx_notification_logs_patient_id on public.notification_logs (patient_id);
create index if not exists idx_notification_logs_created_at on public.notification_logs (created_at);

-- ── 권한 카탈로그 확장(0002 컨벤션 — 리소스 온라인 시 에픽 마이그레이션이 확장) ────────────────
-- notification.read = 알림 로그 조회 게이트(원무·관리자). notification.send = 디스패치 실행 게이트
-- (리마인더 발송). 최소권한 분리(read 만으론 send 불가 — 조회 역할과 발송 역할 분리 여지).
insert into public.permissions (code, name, resource, action) values
  ('notification.read', '알림 로그 조회', 'notification', 'read'),
  ('notification.send', '알림 디스패치 실행', 'notification', 'send')
on conflict (code) do nothing;

-- admin 부트 grant(신규 권한만; 비-admin grant 는 Story 1.7 매트릭스 UI 소관). 멱등.
-- ⚠️ 필수: 0002 admin cross-join 은 후행 마이그레이션 권한을 자동 포함하지 않는다(누락 시
--    test_admin_role_has_all_permissions 회귀 — 0010·0012~0015·0031·0032·0033 이 겪은 함정).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('notification.read', 'notification.send')
where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;

-- ── 권한 posture·GRANT(append-only by grant — 0004 audit_logs 가벼운 변형) ──────────────────────
-- UPDATE/DELETE 는 전 역할 회수(발송 이력 = 한 번 쓰면 불변). service_role = INSERT/SELECT(앱 발송·조회),
-- authenticated = SELECT(RLS notification.read 행 게이트). anon 접근 불가. ⚠️ service_role 에도
-- update/delete grant 하지 않음(appointments 의 full-CRUD 와 다른 posture — 로그는 불변).
revoke all on public.notification_logs from anon, authenticated, service_role;
grant insert, select on public.notification_logs to service_role;
grant select on public.notification_logs to authenticated;

-- ── RLS(방어심층 — service_role/FastAPI 쓰기에도 유지, 0031 appointments 인라인 패턴 미러) ────────
alter table public.notification_logs enable row level security;

-- 직원 = notification.read 권한 보유 시 전체 행(원무·관리자 — 읽기뷰 대비). appointments_select_staff 미러.
drop policy if exists notification_logs_select_staff on public.notification_logs;
create policy notification_logs_select_staff on public.notification_logs
  for select to authenticated using ((select public.has_permission('notification.read')));

-- ⚠️ 환자 본인 수신함(self SELECT) 정책 = 본 스토리 제외(환자 수신 UI = Epic 8 포털). appointments 의
--    appointments_select_self 같은 self 정책은 추가하지 않는다(YAGNI — Epic 8 이 필요 시 추가).
-- 쓰기 정책 없음 = authenticated 의 INSERT/UPDATE/DELETE 거부(쓰기는 service_role 가 RLS 우회).

-- ── 감사 트리거 부착(0004 audit_trigger_fn 재사용 — 디스패치 발송이 actor 와 함께 append-only 기록) ──
-- id(uuid PK) 보유 → target_id = coalesce(after->>'id', before->>'id') 계약 충족(0004:63).
-- 스냅샷 컬럼 = recipient_masked(이미 마스킹)·body(비-식별)·patient_id/appointment_id(FK·opaque)·시각·
--    status → 원시 PII 없음 → 3.6 마스킹 집합 _SENSITIVE_KEY 변경 불요(0031/0010 동일). notification_logs
--    는 INSERT-only(UPDATE/DELETE grant 부재)라 실질 INSERT 만 발화.
drop trigger if exists trg_notification_logs_audit on public.notification_logs;
create trigger trg_notification_logs_audit after insert or update or delete on public.notification_logs
  for each row execute function public.audit_trigger_fn();
