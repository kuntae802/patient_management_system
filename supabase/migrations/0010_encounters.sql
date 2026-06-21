-- 0010_encounters.sql — encounters(내원 허브) + 상태머신(CHECK·전이 트리거·전이 RPC) + RLS·감사
-- Story 4.1 / FR-020(접수→내원 생성), FR-118(취소·노쇼 수가 미발생), FR-119(부분수행 정산),
--   NFR-040(상태 전이 무결성 — 역행·건너뛰기 차단), NFR-060(내원 허브 확장).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실). timestamptz=UTC 저장. soft delete=is_active.
-- 불변식·감사는 DB 가 소유 — 상태머신을 Python/TS 에 재구현 금지(전이 트리거·RPC 가 단일 진실).
--
-- ⚠️ 파일 번호 0010: 에픽 본문·아키텍처는 stale 번호 "0007_encounters" 를 참조하나, 0007 은 이미
--    masters_codes(진단·수가·약품)가 차지했고 실제 적용분은 0001~0009(마지막 0009_patients)다.
--    따라서 encounters = 0010(glossary.md §마이그레이션 번호 — Story 4.1 확정).
--
-- 상태머신 모델(전이 매트릭스 = enforce_encounter_transition 단일 진실):
--   (INSERT) → scheduled(예약·Epic 6) | registered(walk-in·MVP)   [그 외 초기상태 차단]
--   scheduled  → registered(register_encounter) | cancelled(cancel) | no_show(mark_no_show)
--   registered → in_progress(start_consult)      | cancelled(cancel)
--   in_progress→ completed(complete_encounter)
--   종결(completed·cancelled·no_show) = 이탈 전이 없음(역행 금지). 부분수행 = in_progress→completed
--   후 Epic 7(FR-119)이 수행분만 정산(별도 상태 아님). 취소·노쇼 수가 미발생 = Epic 7(FR-118).
--   잘못된 전이 → SQLSTATE 'PT409'(커스텀, 코어 미사용 클래스 'PT'; FastAPI 4.2/4.4 가 409 매핑).
--
-- 의존: 0001(gen_random_uuid), 0002(users·encounter.register/start/complete 권한 시드),
--   0003(has_permission), 0004(audit_trigger_fn), 0006(departments·rooms), 0009(patients).

-- ── encounter_no 시퀀스(사람용 내원번호 — race-free DB 부여, PII 아님·라우트 안전) ──
-- 8자리 zero-pad(예 00000001). PK(uuid)와 별개(architecture §Naming "사람용 번호는 별도").
create sequence if not exists public.encounters_encounter_no_seq;

-- ── encounters (내원 — 파이프라인 허브: 임상기록 4.6·오더 Epic5·수납 Epic7 이 매단다) ──
create table if not exists public.encounters (
  id                 uuid primary key default gen_random_uuid(),
  encounter_no       text not null unique
                       default lpad(nextval('public.encounters_encounter_no_seq')::text, 8, '0'),
  patient_id         uuid not null references public.patients (id),     -- ON DELETE 미지정(RESTRICT — 진료 보존)
  department_id      uuid not null references public.departments (id),  -- 대기열 그룹핑(4.3)
  room_id            uuid references public.rooms (id),                 -- 진료실(선택, 배정 시)
  doctor_id          uuid references public.users (id),                 -- 담당의 — start_consult 가 세팅
  visit_type         text not null check (visit_type in ('walk_in', 'reserved')),  -- 접수 경로(생성 시 4.2)
  status             text not null default 'registered'
                       check (status in ('scheduled', 'registered', 'in_progress',
                                         'completed', 'cancelled', 'no_show')),  -- 상태머신 핵심(text+CHECK)
  cancel_reason      text,                          -- 취소/노쇼 운영 사유(저민감 — 임상/PII 자유텍스트 금지)
  -- 전이 타임스탬프(전이 RPC 가 해당 시각 기록 — 대기시간·NFR-002 메트릭 근거).
  registered_at      timestamptz,
  consult_started_at timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  no_show_at         timestamptz,
  created_by         uuid references public.users (id),  -- 접수 처리 직원
  is_active          boolean not null default true,      -- soft delete 일관성(취소는 도메인 status 로 별도)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- ⚠️ 주호소·증상·진단 등 PII/건강민감 자유텍스트 컬럼은 두지 않는다(4.6 SOAP medical_records·
--    4.7 encounter_diagnoses 소유) → 감사 스냅샷에 건강정보 유입 차단(3.6 마스킹 드리프트 회피).
-- ⚠️ reservation_id FK 는 Epic 6(appointments 생성 시) ALTER 로 추가 — appointments 미존재.

create index if not exists idx_encounters_patient_id    on public.encounters (patient_id);
create index if not exists idx_encounters_department_id on public.encounters (department_id);
create index if not exists idx_encounters_status        on public.encounters (status);
-- 대기판/대기열 조회(진료과 × 상태) — 4.3/4.4 소비.
create index if not exists idx_encounters_dept_status   on public.encounters (department_id, status);

-- ── 전이 강제 트리거(상태머신 단일 진실 — service_role/직접 update 까지 봉쇄, NFR-040 최종선) ──
-- SECURITY DEFINER 불요(테이블 미접근·old/new 비교·raise 만 — audit_logs_block_mutation 선례).
-- INSERT=초기상태 가드, UPDATE=전이 매트릭스 강제. 위반 = SQLSTATE 'PT409'(FastAPI 409 매핑).
create or replace function public.enforce_encounter_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('scheduled', 'registered') then
      raise exception 'invalid initial encounter status: %', new.status
        using errcode = 'PT409';
    end if;
    return new;
  end if;

  -- UPDATE: 상태 변경이 없으면(비-상태 컬럼 갱신) 통과.
  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'scheduled'  and new.status in ('registered', 'cancelled', 'no_show')) or
    (old.status = 'registered' and new.status in ('in_progress', 'cancelled')) or
    (old.status = 'in_progress' and new.status = 'completed')
  ) then
    raise exception 'invalid encounter transition: % -> %', old.status, new.status
      using errcode = 'PT409';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_encounters_transition on public.encounters;
create trigger trg_encounters_transition
  before insert or update on public.encounters
  for each row execute function public.enforce_encounter_transition();

-- ── 전이 RPC 5종(SECURITY DEFINER + search_path 고정; has_permission 자체 게이트 = 동일 txn TOCTOU 재평가) ──
-- 쓰기는 service_role(FastAPI) / SECURITY DEFINER RPC 만(authenticated 직접 쓰기 정책 없음).
-- 각 RPC 는 not-found(PT404) + 소스 상태 precondition(PT409)을 선검사한다 — 트리거의 same-status
-- 통과(비-상태 컬럼 갱신 허용)가 만드는 사각(이미 in_progress 인 내원에 start_consult 재호출 →
-- doctor_id/타임스탬프 덮어쓰기·진료 탈취)을 차단(NFR-040 재수행 차단). trg_encounters_transition
-- 은 직접 update·잘못된 전이의 최종 백스톱으로 유지. 권한 미보유 = 'insufficient_privilege'(42501→403).

-- register_encounter: scheduled → registered (예약 환자 도착 접수, Epic 6 reserved 경로).
create or replace function public.register_encounter(p_encounter_id uuid)
returns public.encounters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.encounters;
begin
  if not public.has_permission('encounter.register') then
    raise exception 'permission denied: encounter.register' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.encounters where id = p_encounter_id for update;
  if not found then
    raise exception 'encounter not found: %', p_encounter_id using errcode = 'PT404';
  end if;
  if v_row.status <> 'scheduled' then  -- 소스 상태 선검사(same-status no-op·재수행 차단, NFR-040)
    raise exception 'invalid encounter transition: % -> registered', v_row.status using errcode = 'PT409';
  end if;
  update public.encounters
     set status = 'registered', registered_at = now(), updated_at = now()
   where id = p_encounter_id
   returning * into v_row;
  return v_row;
end;
$$;

-- start_consult: registered → in_progress (의사 진찰 시작; 담당의 = 호출자).
create or replace function public.start_consult(p_encounter_id uuid)
returns public.encounters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.encounters;
begin
  if not public.has_permission('encounter.start') then
    raise exception 'permission denied: encounter.start' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.encounters where id = p_encounter_id for update;
  if not found then
    raise exception 'encounter not found: %', p_encounter_id using errcode = 'PT404';
  end if;
  if v_row.status <> 'registered' then  -- 소스 상태 선검사(same-status 진료 탈취·재수행 차단, NFR-040)
    raise exception 'invalid encounter transition: % -> in_progress', v_row.status using errcode = 'PT409';
  end if;
  update public.encounters
     set status = 'in_progress', consult_started_at = now(),
         doctor_id = (select auth.uid()), updated_at = now()
   where id = p_encounter_id
   returning * into v_row;
  return v_row;
end;
$$;

-- complete_encounter: in_progress → completed (진료 완료; 부분수행도 여기로 종결 → Epic 7 정산).
create or replace function public.complete_encounter(p_encounter_id uuid)
returns public.encounters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.encounters;
begin
  if not public.has_permission('encounter.complete') then
    raise exception 'permission denied: encounter.complete' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.encounters where id = p_encounter_id for update;
  if not found then
    raise exception 'encounter not found: %', p_encounter_id using errcode = 'PT404';
  end if;
  if v_row.status <> 'in_progress' then  -- 소스 상태 선검사(same-status no-op·재수행 차단, NFR-040)
    raise exception 'invalid encounter transition: % -> completed', v_row.status using errcode = 'PT409';
  end if;
  update public.encounters
     set status = 'completed', completed_at = now(), updated_at = now()
   where id = p_encounter_id
   returning * into v_row;
  return v_row;
end;
$$;

-- cancel_encounter: scheduled|registered → cancelled (수가 미발생 정산은 Epic 7 FR-118).
create or replace function public.cancel_encounter(p_encounter_id uuid, p_reason text default null)
returns public.encounters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.encounters;
begin
  if not public.has_permission('encounter.cancel') then
    raise exception 'permission denied: encounter.cancel' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.encounters where id = p_encounter_id for update;
  if not found then
    raise exception 'encounter not found: %', p_encounter_id using errcode = 'PT404';
  end if;
  if v_row.status not in ('scheduled', 'registered') then  -- 소스 상태 선검사(종결 재전이·재수행 차단)
    raise exception 'invalid encounter transition: % -> cancelled', v_row.status using errcode = 'PT409';
  end if;
  update public.encounters
     set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason, updated_at = now()
   where id = p_encounter_id
   returning * into v_row;
  return v_row;
end;
$$;

-- mark_no_show: scheduled → no_show (예약 미방문; 노쇼 카운트·수가 미발생은 Epic 6/7).
create or replace function public.mark_no_show(p_encounter_id uuid, p_reason text default null)
returns public.encounters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.encounters;
begin
  if not public.has_permission('encounter.no_show') then
    raise exception 'permission denied: encounter.no_show' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.encounters where id = p_encounter_id for update;
  if not found then
    raise exception 'encounter not found: %', p_encounter_id using errcode = 'PT404';
  end if;
  if v_row.status <> 'scheduled' then  -- 소스 상태 선검사(접수 후 노쇼 불가·재수행 차단, NFR-040)
    raise exception 'invalid encounter transition: % -> no_show', v_row.status using errcode = 'PT409';
  end if;
  update public.encounters
     set status = 'no_show', no_show_at = now(), cancel_reason = p_reason, updated_at = now()
   where id = p_encounter_id
   returning * into v_row;
  return v_row;
end;
$$;

-- ── 권한 카탈로그 확장(0002 컨벤션 — 리소스 온라인 시 에픽 마이그레이션이 확장) ──────────
-- encounter.register/start/complete 는 0002 에 이미 시드(재시드 금지). read/cancel/no_show 만 신규.
insert into public.permissions (code, name, resource, action) values
  ('encounter.read',    '내원 조회',   'encounter', 'read'),
  ('encounter.cancel',  '내원 취소',   'encounter', 'cancel'),
  ('encounter.no_show', '노쇼 처리',   'encounter', 'no_show')
on conflict (code) do nothing;

-- admin 부트 grant(신규 권한만; 비-admin grant 는 Story 1.7 매트릭스 UI 소관). 멱등.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('encounter.read', 'encounter.cancel', 'encounter.no_show')
where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;

-- ── 권한 posture(0002 패턴 — 민감 컬럼 없음 → 테이블 단위 GRANT) ────────────────────
revoke all on public.encounters from anon, authenticated;
grant select, insert, update, delete on public.encounters to service_role;
grant usage on sequence public.encounters_encounter_no_seq to service_role;
-- authenticated = SELECT(RLS 행 게이트). 쓰기는 service_role/RPC.
grant select on public.encounters to authenticated;
-- 전이 RPC EXECUTE: RPC 가 has_permission 자체 게이트 → authenticated 직접 호출도 안전(방어심층 + 테스트).
grant execute on function public.register_encounter(uuid)         to authenticated, service_role;
grant execute on function public.start_consult(uuid)              to authenticated, service_role;
grant execute on function public.complete_encounter(uuid)         to authenticated, service_role;
grant execute on function public.cancel_encounter(uuid, text)     to authenticated, service_role;
grant execute on function public.mark_no_show(uuid, text)         to authenticated, service_role;

-- ── RLS(방어심층 — service_role/FastAPI 쓰기에도 유지, 별도 RLS 파일 없이 인라인) ──────
alter table public.encounters enable row level security;

-- 직원 = encounter.read 권한 보유 시 전체 행(대기판·대기열 4.3/4.4).
drop policy if exists encounters_select_staff on public.encounters;
create policy encounters_select_staff on public.encounters
  for select to authenticated using ((select public.has_permission('encounter.read')));

-- 환자 = 본인 내원만(patient_id → patients.auth_uid 경유, 포털 Epic 8). guardians_select_self 미러.
drop policy if exists encounters_select_self on public.encounters;
create policy encounters_select_self on public.encounters
  for select to authenticated using (
    exists (
      select 1 from public.patients p
      where p.id = encounters.patient_id and p.auth_uid = (select auth.uid())
    )
  );

-- 쓰기 정책 없음 = authenticated 의 INSERT/UPDATE/DELETE 거부(쓰기는 service_role/RPC 가 RLS 우회).

-- ── 감사 트리거 부착(0004 audit_trigger_fn 재사용 — 모든 전이가 actor 와 함께 append-only 기록) ──
-- id(uuid PK) 보유 → target_id = coalesce(after->>'id', before->>'id') 계약 충족(1.3 이월).
-- 컬럼이 비-PII/비-건강민감 → before/after 스냅샷에 민감정보 무유입(3.6 마스킹 집합 변경 불요).
drop trigger if exists trg_encounters_audit on public.encounters;
create trigger trg_encounters_audit after insert or update or delete on public.encounters
  for each row execute function public.audit_trigger_fn();
