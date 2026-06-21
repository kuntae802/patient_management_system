-- 0030_doctor_schedules.sql — 의사 근무표(주간 반복) + 휴진·예외 + RLS·감사
-- Story 6.1 / FR-220(근무표 등록·관리), FR-221(휴진·예외 등록 → FR-012 가용 슬롯·FR-016 재배정 근거).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실 — doctor_schedule=근무표·doctor_time_off=휴진/예외).
-- timestamptz=UTC 저장. soft delete=is_active(물리 삭제 금지 — 과거 예약 참조 보존). 불변식·감사는 DB 가 소유.
--
-- ⚠️ 파일 번호 0030: Epic 6 는 병렬 worktree(epic-6-scheduling). main 은 0014(4.7)까지·Epic 5 가
--    0015~0029 예약 → Epic 6 마이그 블록 = 0030~(머지 충돌 회피). 에픽/아키텍처는 묶음 계획
--    "0011_scheduling.sql(doctor_schedules·doctor_time_offs·appointments)"을 참조하나, 4.6/4.7 분리
--    선례(계획 0008_clinical → 0013_medical_records + 0014_encounter_diagnoses)에 따라 스토리별로
--    나눈다. 본 마이그레이션 = 근무표·휴진 2 테이블만. **appointments(예약 본체)는 booking 스토리
--    (6.2/6.3)가 별도 마이그레이션으로 생성** — encounters.reservation_id FK(0010:54 "Epic 6 ALTER")·
--    더블부킹 EXCLUDE·예약 상태머신을 그 스토리가 함께 설계(half-baked 선반영 회피).
--
-- 권한: 쓰기 = master.manage(0002 기존·admin cross-join 보유 — 진료과·진료실 masters 와 동형의
--    관리자 관리 설정 데이터). 신규 권한·admin 부트 grant 재실행 없음. 읽기 = 전 직원(슬롯 계산·예약).
--
-- 의존: 0001(gen_random_uuid·extensions 스키마), 0002(users), 0003(has_permission),
--    0004(audit_trigger_fn), 0006(departments·rooms).

-- ── btree_gist (근무표 겹침 방지 EXCLUDE 의 uuid·smallint '=' gist opclass) ───────────────────
-- 0001 패턴: 확장은 extensions 스키마. tsrange '&&' 는 core gist 라 확장 불요, 스칼라 '=' 만 btree_gist.
-- 6.3 예약 더블부킹 EXCLUDE 도 이 확장을 재사용한다. extensions 가 DB search_path 에 있어 opclass 자동 해석.
create extension if not exists btree_gist with schema extensions;

-- ── doctor_schedules (근무표 — 의사별 주간 반복 패턴) ─────────────────────────────────────────
-- weekday = PG extract(dow) 정합(0=일 ~ 6=토) — 6.2 슬롯 계산이 예약일의 dow 로 근무 블록을 전개한다.
-- department_id 명시(NOT NULL): 의사가 여러 진료과를 커버할 수 있어 블록별로 둔다(FR-010 진료과 선택 그룹핑).
-- room_id 선택(nullable): 진료실 동적 배정 여지(0006:20-21 — 진료실 자원충돌·capacity 는 스케줄 범위).
create table if not exists public.doctor_schedules (
  id            uuid primary key default gen_random_uuid(),
  doctor_id     uuid not null references public.users (id),        -- 담당의(role=doctor; 서비스 검증)
  department_id uuid not null references public.departments (id),  -- 슬롯 그룹핑(진료과)
  room_id       uuid references public.rooms (id),                 -- 진료실(선택)
  weekday       smallint not null check (weekday between 0 and 6), -- 0=일 .. 6=토 (PG dow)
  start_time    time not null,
  end_time      time not null,
  is_active     boolean not null default true,                     -- soft delete(예약 참조 보존)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint doctor_schedules_time_order check (start_time < end_time)
);

-- 겹침 방지: 같은 의사·같은 요일의 활성 시간블록이 겹치면 거부(불변식 = DB 소유, 6.2 슬롯 계산이
-- 비겹침 근무를 전제). Postgres 내장 timerange 부재 → date-anchored tsrange 관용구(immutable). 위반 =
-- SQLSTATE 23P01(exclusion_violation) → 서비스가 asyncpg.ExclusionViolationError catch → 409 schedule_overlap
-- (masters code_taken 패턴 동형, _map_pg_sqlstate 변경 불요). 부분 제약 where (is_active) = 비활성 행은
-- 차단 안 함(soft-delete 철학; 재활성이 겹침 유발 시에도 발화 → set_active 도 catch). 인접 [) = 비겹침.
-- extensions 가 search_path 에 있어 btree_gist opclass(gist_uuid_ops·gist_int2_ops) 자동 해석.
alter table public.doctor_schedules
  add constraint doctor_schedules_no_overlap
  exclude using gist (
    doctor_id with =,
    weekday   with =,
    tsrange(('2000-01-01'::date + start_time),
            ('2000-01-01'::date + end_time)) with &&
  ) where (is_active);

create index if not exists idx_doctor_schedules_doctor_id     on public.doctor_schedules (doctor_id);
create index if not exists idx_doctor_schedules_department_id on public.doctor_schedules (department_id);
-- 슬롯 계산(의사 × 요일) 조회.
create index if not exists idx_doctor_schedules_doctor_weekday on public.doctor_schedules (doctor_id, weekday);

-- ── doctor_time_offs (휴진/예외 — 특정 기간; 휴가·학회) ───────────────────────────────────────
-- start_at/end_at = timestamptz 범위: 종일 휴가(자정~자정)·부분(학회 특정 시각) 모두 표현. 겹침 제약
-- 없음 — 중첩 휴진은 무해한 합집합(슬롯 계산이 union 으로 차감). reason = 저민감 운영 사유(휴가·학회);
-- ⚠️ 임상/PII 자유텍스트 금지(0010 cancel_reason 정합 — 감사 스냅샷 건강정보 유입 차단).
create table if not exists public.doctor_time_offs (
  id          uuid primary key default gen_random_uuid(),
  doctor_id   uuid not null references public.users (id),
  start_at    timestamptz not null,
  end_at      timestamptz not null,
  reason      text,                          -- 저민감 운영 사유(임상/PII 금지)
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint doctor_time_offs_time_order check (start_at < end_at)
);

create index if not exists idx_doctor_time_offs_doctor_id    on public.doctor_time_offs (doctor_id);
-- 휴진 조회(의사 × 기간).
create index if not exists idx_doctor_time_offs_doctor_start on public.doctor_time_offs (doctor_id, start_at);

-- ── 권한 posture (0006 masters 미러 — 관리자 관리 config 테이블) ──────────────────────────────
-- 쓰기 권위 = FastAPI(service_role) + master.manage 게이트. 읽기 = authenticated SELECT(전역 참조 —
-- 슬롯 계산·예약 흐름이 모든 직원 화면에서 근무표·휴진을 읽음). anon 접근 불가.
revoke all on public.doctor_schedules, public.doctor_time_offs from anon, authenticated;
grant select, insert, update, delete on public.doctor_schedules, public.doctor_time_offs to service_role;
grant select on public.doctor_schedules, public.doctor_time_offs to authenticated;

-- ── RLS (방어심층 — service_role/FastAPI 쓰기에도 유지) ────────────────────────────────────────
alter table public.doctor_schedules enable row level security;
alter table public.doctor_time_offs enable row level security;

-- 전역 참조 데이터: authenticated SELECT 전체 허용(비민감 — 의사 uuid·요일·시각·운영 사유). 관리 화면이
-- 비활성도 표시해야 하므로 inactive 행도 노출하고, 신규 선택 제외는 소비처(6.2 슬롯 계산)가 is_active 필터.
-- 쓰기 정책은 두지 않는다 = authenticated 의 INSERT/UPDATE/DELETE 거부(쓰기는 service_role 이 RLS 우회).
drop policy if exists doctor_schedules_select_authenticated on public.doctor_schedules;
create policy doctor_schedules_select_authenticated on public.doctor_schedules
  for select to authenticated using (true);

drop policy if exists doctor_time_offs_select_authenticated on public.doctor_time_offs;
create policy doctor_time_offs_select_authenticated on public.doctor_time_offs
  for select to authenticated using (true);

-- ── 감사 트리거 부착(0004 audit_trigger_fn 재사용) ────────────────────────────────────────────
-- 두 테이블 모두 id 컬럼 보유 → target_id = coalesce(after->>'id', before->>'id') 계약 충족(1.3 이월).
-- 컬럼이 비-PII/비-건강민감(uuid·요일·시각·운영 사유) → before/after 스냅샷에 민감정보 무유입
-- (3.6 마스킹 집합 _SENSITIVE_KEY 변경 불요 — 0006/0010 동일). 생성·수정·비활성이 actor 와 함께 자동 감사.
drop trigger if exists trg_doctor_schedules_audit on public.doctor_schedules;
create trigger trg_doctor_schedules_audit after insert or update or delete on public.doctor_schedules
  for each row execute function public.audit_trigger_fn();

drop trigger if exists trg_doctor_time_offs_audit on public.doctor_time_offs;
create trigger trg_doctor_time_offs_audit after insert or update or delete on public.doctor_time_offs
  for each row execute function public.audit_trigger_fn();
