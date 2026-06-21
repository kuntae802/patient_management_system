-- 0031_appointments.sql — 예약(appointments) 본체 + 더블부킹 EXCLUDE + 슬롯 계산 토대
-- Story 6.2 / FR-012(근무−휴진−기예약 가능 슬롯). 6.1(0030 근무표·휴진)이 이월한 "appointments
-- 소유 결정" = 본 스토리(슬롯 계산이 기예약을 차감하려면 예약 본체 필요) → Option A.
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실 — appointment=예약·슬롯 기반).
-- timestamptz=UTC 저장. 불변식·감사는 DB 가 소유(EXCLUDE·CHECK·트리거).
--
-- ⚠️ 파일 번호 0031: Epic 6 = 병렬 worktree(epic-6-scheduling) → 마이그 블록 0030~(6.1=0030,
--    main 0014/Epic5 0015~0029 와 충돌 회피). 0031 = 예약 본체. 에픽/아키 묶음 계획
--    "0011_scheduling.sql(3테이블)"을 스토리별 분리(4.6/4.7 선례·0030 헤더 노트)한 두 번째 조각.
--
-- ⚠️ appointments = encounters 형 트랜잭션 생명주기 레코드(0030 doctor_schedules/time_offs 같은
--    관리자 config 아님). 따라서 **`is_active` 컬럼 없음** — soft-delete/취소 = status='cancelled'
--    (encounters 가 is_active 없이 status 만 쓰는 모델 정합). 0030(config·is_active)과 다른 모델임에 주의.
--
-- ⚠️ 본 스토리 스코프 = 예약 본체 스키마 + 더블부킹 불변식 + 슬롯 계산 토대 + `encounters.reservation_id`
--    FK 청산. **예약 쓰기(생성/변경/취소)·전이 트리거(enforce_appointment_transition)·전이 RPC·캘린더·
--    booking-peek·더블부킹 409 인라인 표면화 = 6.3/6.4**. 본 파일은 status CHECK(어휘 전 도메인)만 정의,
--    전이 enforcement 는 쓰기와 함께 6.3/6.4. 6.2 는 'booked' 만 쓰기/읽기(seed + 슬롯 차감).
--
-- 의존: 0001(gen_random_uuid·btree_gist[0030 설치, extensions 스키마·DB search_path 에 있어 opclass
--    자동 해석]), 0002(permissions·role_permissions), 0003(has_permission), 0004(audit_trigger_fn),
--    0006(departments·rooms), 0009(patients — FK + RLS self 경로), 0010(encounters — reservation_id FK ALTER).

-- ── appointments (예약 본체 — 슬롯 기반 의사 예약) ─────────────────────────────────────────────
-- scheduled_start/end = timestamptz(UTC): 특정 시각의 슬롯 예약. status = 예약 생명주기(booked 활성·
-- cancelled 취소·no_show 미방문·completed 도착·진료완료). 자유텍스트/PII 컬럼 0(메모는 6.3 booking-peek
-- 이 추가 시 감사 마스킹 교차절단 검토 — 본 파일 미추가). room_id nullable(0030 doctor_schedules 정합).
create table if not exists public.appointments (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients (id),     -- 예약 환자
  doctor_id       uuid not null references public.users (id),        -- 담당의(role=doctor; 쓰기 스토리가 검증)
  department_id   uuid not null references public.departments (id),  -- 진료과(FR-010 그룹핑)
  room_id         uuid references public.rooms (id),                 -- 진료실(선택)
  scheduled_start timestamptz not null,
  scheduled_end   timestamptz not null,
  status          text not null default 'booked'
                    check (status in ('booked', 'cancelled', 'no_show', 'completed')),
  created_by      uuid not null references public.users (id),        -- 예약 생성자(원무/시스템)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint appointments_time_order check (scheduled_start < scheduled_end)
);

-- 더블부킹 차단(불변식 = DB 소유, 6.3 FR-013 토대): 같은 의사·시간 겹치는 활성(booked) 예약 거부.
-- where (status='booked') 부분 제약 = 취소/노쇼/완료는 슬롯 미차단(재예약 가능). tstzrange '[)' 반열림
-- = 인접 슬롯 비겹침. 위반 = SQLSTATE 23P01(exclusion_violation) → 6.3 예약 쓰기가 catch → 409
-- double_booking(0030 schedule_overlap 패턴 동형). 본 스토리는 쓰기 없음 → seed 직접 INSERT 로 발화 검증.
-- btree_gist(gist_uuid_ops)는 0030 설치 + extensions 가 DB search_path 에 있어 자동 해석(0030 선례).
alter table public.appointments
  add constraint appointments_no_double_booking
  exclude using gist (
    doctor_id with =,
    tstzrange(scheduled_start, scheduled_end, '[)') with &&
  ) where (status = 'booked');

create index if not exists idx_appointments_patient_id on public.appointments (patient_id);
create index if not exists idx_appointments_doctor_id  on public.appointments (doctor_id);
-- 슬롯 계산(의사 × 기간) 조회 — booked 만 차감하므로 부분 인덱스.
create index if not exists idx_appointments_doctor_scheduled
  on public.appointments (doctor_id, scheduled_start) where status = 'booked';

-- ── encounters.reservation_id FK(0010:54 "Epic 6 ALTER" 이월 청산) ────────────────────────────
-- 예약 → 내원 링크(예약 환자 도착 접수 시 내원이 원 예약을 가리킴). nullable(walk-in = NULL).
-- ⚠️ 컬럼 추가만 — 내원 읽기/쓰기 배선·booking→encounter 링크 생성은 6.3/6.4(_ENCOUNTER_COLUMNS·
--    EncounterResponse 에 미포함 → 기존 내원 경로 무영향·누설 없음).
alter table public.encounters
  add column if not exists reservation_id uuid references public.appointments (id);
create index if not exists idx_encounters_reservation_id on public.encounters (reservation_id);

-- ── 권한 카탈로그 확장(0002 컨벤션 — 리소스 온라인 시 에픽 마이그레이션이 확장) ────────────────
-- appointment.read = 슬롯·예약 조회 게이트(원무·관리자 — 본 스토리; 의사·환자는 6.4/6.5 grant).
-- 슬롯 가용성은 비-PII 이나 코드베이스 관례대로 권한 게이트(order.read/diagnosis.read 동형).
insert into public.permissions (code, name, resource, action) values
  ('appointment.read', '예약 슬롯 조회', 'appointment', 'read')
on conflict (code) do nothing;

-- admin 부트 grant(신규 권한만; 비-admin grant 는 Story 1.7 매트릭스 UI 소관). 멱등.
-- ⚠️ 필수: 0002 admin cross-join 은 후행 마이그레이션 권한을 자동 포함하지 않는다(누락 시
--    test_admin_role_has_all_permissions 회귀 — 0010·0012·0013·0014·0015 가 겪은 함정).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'appointment.read'
where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;

-- ── 권한 posture(0014 패턴 — 민감 reveal 컬럼 없음 → 테이블 단위 GRANT) ───────────────────────
revoke all on public.appointments from anon, authenticated;
grant select, insert, update, delete on public.appointments to service_role;
-- authenticated = SELECT(RLS 행 게이트). 쓰기는 service_role(FastAPI) 경유.
grant select on public.appointments to authenticated;

-- ── RLS(방어심층 — service_role/FastAPI 쓰기에도 유지, 별도 RLS 파일 없이 인라인) ───────────────
alter table public.appointments enable row level security;

-- 직원 = appointment.read 권한 보유 시 전체 행(원무·관리자 — 6.3 캘린더·6.2 슬롯 직접조회 대비).
-- encounter_diagnoses_select_staff 미러(권한 기반 직원 게이트).
drop policy if exists appointments_select_staff on public.appointments;
create policy appointments_select_staff on public.appointments
  for select to authenticated using ((select public.has_permission('appointment.read')));

-- 환자 = 본인 예약만(patient_id → auth_uid 경유, 포털·환자 앱 6.5). patient_id 가 patients 직접 FK 라
-- encounters 우회 없이 직접 조인(encounter_diagnoses_select_self 보다 단순).
drop policy if exists appointments_select_self on public.appointments;
create policy appointments_select_self on public.appointments
  for select to authenticated using (
    exists (
      select 1 from public.patients p
      where p.id = appointments.patient_id and p.auth_uid = (select auth.uid())
    )
  );

-- 쓰기 정책 없음 = authenticated 의 INSERT/UPDATE/DELETE 거부(쓰기는 service_role 가 RLS 우회).

-- ── 감사 트리거 부착(0004 audit_trigger_fn 재사용 — 생성·변경·취소가 actor 와 함께 append-only 기록) ──
-- id(uuid PK) 보유 → target_id = coalesce(after->>'id', before->>'id') 계약 충족(0004:63).
-- 스냅샷 컬럼 = patient_id(FK·opaque)·doctor_id·department_id·room_id·시각·status = 비-자유텍스트/
--    비-건강민감(encounters.patient_id 와 동일 FK posture) → 3.6 마스킹 집합 _SENSITIVE_KEY 변경 불요
--    (0010/0014/0015 동일). ⚠️ note/메모 자유텍스트 컬럼 추가 시(6.3) 마스킹 교차절단 검토 필요.
drop trigger if exists trg_appointments_audit on public.appointments;
create trigger trg_appointments_audit after insert or update or delete on public.appointments
  for each row execute function public.audit_trigger_fn();
