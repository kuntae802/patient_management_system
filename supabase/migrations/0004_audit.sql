-- 0004_audit.sql — append-only 감사로그 + 제네릭 감사 트리거
-- Story 1.3 / FR-242, NFR-042. 변경 전/후 스냅샷, append-only(service_role 포함 전 역할 UPDATE/DELETE 차단).

-- ── audit_logs (감사로그 — append-only) ──────────────────────────────────────
-- actor_id 는 users 가 아니라 auth.users 를 참조: 직원(users)·환자(patients.auth_uid)·시스템(NULL)
-- 행위자를 모두 수용한다(환자 actor 가 users FK 를 위반하는 문제 회피).
create table if not exists public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references auth.users (id) on delete set null,
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
  v_action text;
  v_before jsonb;
  v_after  jsonb;
  v_actor  uuid;
begin
  if tg_op = 'INSERT' then
    v_action := 'create'; v_before := null;           v_after := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := 'update'; v_before := to_jsonb(old);   v_after := to_jsonb(new);
  else
    v_action := 'delete'; v_before := to_jsonb(old);   v_after := null;
  end if;

  v_actor := coalesce(
    nullif(current_setting('app.actor_id', true), '')::uuid,
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

-- ── append-only 강제(이중) ───────────────────────────────────────────────────
alter table public.audit_logs enable row level security;

-- ① RLS: INSERT/SELECT 만(UPDATE/DELETE 정책 없음 → deny). 상세 조회 권한 게이트(audit.read)는 1.10 강화.
drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated with check (true);

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated using (true);

-- ② GRANT(권위): 모든 역할에서 UPDATE/DELETE 회수(service_role 은 BYPASSRLS 라 권리 회수가 최종선),
--    INSERT/SELECT 만 허용. anon 은 접근 불가.
revoke all    on public.audit_logs from anon, authenticated, service_role;
grant  insert, select on public.audit_logs to authenticated, service_role;

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
