-- 0003_rls_helpers.sql — RLS 헬퍼 함수 + 신원/RBAC 테이블 RLS 활성화·최소 정책
-- Story 1.3 / FR-240(헬퍼). RBAC 3계층 중 'RLS 행 강제(데이터 권위)'의 토대.
--
-- 모든 SECURITY DEFINER 함수는 명시적 `set search_path = public` (search_path 하이재킹 방지;
-- Supabase 린트 0011_security_definer_search_path). auth.uid() 는 스키마 한정 호출.
-- `(select auth.uid())` 래핑 = RLS initplan 캐싱(Supabase 권장 성능 패턴).

-- ── auth_user_role(): 현재 로그인 직원의 역할 코드(직원 아니면 NULL = 환자/비직원 경계) ──
create or replace function public.auth_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.code
  from public.users u
  join public.roles r on r.id = u.role_id
  where u.id = (select auth.uid())
    and u.employment_status = 'active';  -- 휴직/퇴사자는 역할 무효(방어심층)
$$;

-- ── has_permission(code): 현재 로그인 직원의 역할이 권한 보유 여부(조인 RLS 회피용 헬퍼) ──
create or replace function public.has_permission(perm_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.role_permissions rp
    join public.permissions p on p.id = rp.permission_id
    where rp.role_id = (
        select role_id from public.users
        where id = (select auth.uid())
          and employment_status = 'active'  -- 휴직/퇴사자는 권한 무효(방어심층)
      )
      and p.code = perm_code
  );
$$;

grant execute on function public.auth_user_role() to authenticated, service_role;
grant execute on function public.has_permission(text) to authenticated, service_role;

-- ── RLS 활성화(방어심층 — service_role/FastAPI 쓰기에도 유지) ─────────────────
alter table public.roles            enable row level security;
alter table public.permissions      enable row level security;
alter table public.role_permissions enable row level security;
alter table public.users            enable row level security;

-- 최소 정책: 직원 화면(1.6 셸 게이트·1.7 매트릭스)이 역할·권한 카탈로그를 읽도록 authenticated SELECT.
-- 테이블별 상세·환자 소유 정책(auth.uid()=patients.auth_uid 등)은 0014_rls_policies 로 이월.
drop policy if exists roles_select_authenticated on public.roles;
create policy roles_select_authenticated on public.roles
  for select to authenticated using (true);

drop policy if exists permissions_select_authenticated on public.permissions;
create policy permissions_select_authenticated on public.permissions
  for select to authenticated using (true);

drop policy if exists role_permissions_select_authenticated on public.role_permissions;
create policy role_permissions_select_authenticated on public.role_permissions
  for select to authenticated using (true);

-- users: 본인 프로필 행만 SELECT. 그 외 직원 조회는 FastAPI(service_role) 경유.
drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users
  for select to authenticated using (id = (select auth.uid()));
