-- 0004_audit.sql — append-only 감사로그 + 제네릭 감사 트리거
-- Story 1.3 / FR-242, NFR-042. 변경 전/후 스냅샷, append-only(service_role 포함 전 역할 UPDATE/DELETE 차단).

-- ── audit_logs (감사로그 — append-only) ──────────────────────────────────────
-- actor_id 는 비정규화 행위자(직원·환자의 auth uid, 또는 NULL=시스템). FK 미부착 이유:
--   (1) 감사 INSERT 가 actor 부재(삭제·레이스)로 abort 되어 원본 쓰기를 깨뜨리지 않게(append-only 회복력),
--   (2) 행위자 삭제 후에도 "누가 했는지"를 보존(on delete set null 이 actor 를 지우는 포렌식 훼손 방지).
create table if not exists public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid,
  action       text not null check (action in ('create','read','update','delete','login')),
  target_table text not null,
  target_id    text,
  before_data  jsonb,
  after_data   jsonb,
  ip_address   inet,
  created_at   timestamptz not null default now()
);
create index if not exists idx_audit_logs_actor_id     on public.audit_logs (actor_id);
create index if not exists idx_audit_logs_target_table on public.audit_logs (target_table);
create index if not exists idx_audit_logs_created_at   on public.audit_logs (created_at);

-- ── 제네릭 감사 트리거 함수(SECURITY DEFINER, owner=postgres) ─────────────────
-- actor 캡처 계약: FastAPI(service_role)는 트랜잭션 시작 시 `set local app.actor_id = '<jwt sub>'`
-- 를 주입한다(Story 1.5). 직접 인증 경로는 auth.uid() 로 폴백. 미설정 시 NULL(시스템 액션).
create or replace function public.audit_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action    text;
  v_before    jsonb;
  v_after     jsonb;
  v_actor     uuid;
  v_actor_txt text;
begin
  if tg_op = 'INSERT' then
    v_action := 'create'; v_before := null;           v_after := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := 'update'; v_before := to_jsonb(old);   v_after := to_jsonb(new);
  else
    v_action := 'delete'; v_before := to_jsonb(old);   v_after := null;
  end if;

  -- app.actor_id 가 비-UUID 문자열이면 ::uuid 캐스트가 트리거 내부에서 예외를 던져
  -- 원본 쓰기 트랜잭션 전체를 abort 시킨다(자가 DoS). UUID 형식을 검증한 뒤에만 캐스트.
  v_actor_txt := nullif(current_setting('app.actor_id', true), '');
  v_actor := coalesce(
    case
      when v_actor_txt ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then v_actor_txt::uuid
    end,
    auth.uid()
  );

  insert into public.audit_logs (actor_id, action, target_table, target_id, before_data, after_data)
  values (
    v_actor,
    v_action,
    tg_table_name,
    coalesce(v_after ->> 'id', v_before ->> 'id'),
    v_before,
    v_after
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ── append-only 강제(삼중: RLS deny + GRANT 회수 + BEFORE 트리거) ─────────────
alter table public.audit_logs enable row level security;

-- ① 조회는 audit.read 권한 게이트(현재 admin만 보유). authenticated 직접 INSERT는 불허(actor·action 위조
--    표면 차단) — 감사 기록은 audit_trigger_fn(SECURITY DEFINER, owner)이 수행하고, 앱 emitted read/login
--    이벤트는 FastAPI(service_role) 경유. UPDATE/DELETE는 명시적 deny 정책으로 봉쇄(Task4 명세 정합).
drop policy if exists audit_logs_insert on public.audit_logs;  -- 구 authenticated INSERT 정책 제거

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated using ((select public.has_permission('audit.read')));

drop policy if exists audit_logs_no_update on public.audit_logs;
create policy audit_logs_no_update on public.audit_logs
  for update to authenticated using (false);

drop policy if exists audit_logs_no_delete on public.audit_logs;
create policy audit_logs_no_delete on public.audit_logs
  for delete to authenticated using (false);

-- ② GRANT(권위): UPDATE/DELETE 전 역할 회수. authenticated=SELECT(RLS audit.read로 행 게이트),
--    service_role=INSERT/SELECT(앱 emitted 이벤트 + 조회). anon 접근 불가.
revoke all on public.audit_logs from anon, authenticated, service_role;
grant select on public.audit_logs to authenticated;
grant insert, select on public.audit_logs to service_role;

-- ③ BEFORE 트리거: 테이블 owner(postgres)/BYPASSRLS 직접 변조까지 봉쇄(GRANT·RLS가 못 막는 경로).
--    audit_logs는 정상 운영에서 UPDATE/DELETE가 전무하므로 무조건 차단해도 다운사이드 없음.
--    (단, superuser는 트리거 비활성화 가능 — 완전 불변은 DB 범위 밖.)
create or replace function public.audit_logs_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs is append-only — % is not permitted', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists trg_audit_logs_no_mutation on public.audit_logs;
create trigger trg_audit_logs_no_mutation
  before update or delete on public.audit_logs
  for each statement execute function public.audit_logs_block_mutation();

-- ── 트리거 부착: 1.3 소유 신원/RBAC 테이블 ───────────────────────────────────
-- RBAC 변경(1.7)·직원 계정 변경(1.8)이 자동 감사된다. 다른 엔티티는 각 마이그레이션이 부착.
drop trigger if exists trg_roles_audit on public.roles;
create trigger trg_roles_audit after insert or update or delete on public.roles
  for each row execute function public.audit_trigger_fn();

drop trigger if exists trg_permissions_audit on public.permissions;
create trigger trg_permissions_audit after insert or update or delete on public.permissions
  for each row execute function public.audit_trigger_fn();

drop trigger if exists trg_role_permissions_audit on public.role_permissions;
create trigger trg_role_permissions_audit after insert or update or delete on public.role_permissions
  for each row execute function public.audit_trigger_fn();

drop trigger if exists trg_users_audit on public.users;
create trigger trg_users_audit after insert or update or delete on public.users
  for each row execute function public.audit_trigger_fn();
