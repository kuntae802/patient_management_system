-- 0006_masters.sql — 조직 마스터(진료과·진료실) + users.department_id FK + 감사·RLS
-- Story 2.1 / FR-200·203. 식별자 영문 snake_case(docs/glossary.md 단일 진실). timestamptz=UTC 저장.
-- soft delete = is_active(물리 삭제 금지 — 과거 기록 참조 보존). 불변식·감사는 DB 가 소유.
--
-- ⚠️ 파일 번호 0006: 0005 는 0005_crypto.sql(Story 1.9)가 차지하므로 아키텍처 계획 맵의
--    "0005_masters" 는 한 칸 시프트됐다(glossary.md §마이그레이션 번호 변이). patients 는 0007 로 이월.

-- ── departments (진료과 — 조직 단위) ─────────────────────────────────────────
create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,            -- 식별 코드 값(예: ORTHO). 생성 후 불변
  name        text not null,                   -- 한글 표시명(예: 정형외과)
  description text,
  is_active   boolean not null default true,   -- soft delete: false=신규 선택 제외, 행·명칭은 보존
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── rooms (진료실 — 물리적 공간) ─────────────────────────────────────────────
-- department_id 는 nullable: 진료실이 특정 진료과에 속할 수 있음(선택). 진료실 자원충돌·capacity
-- 모델(한 방을 오전/오후 다른 의사가 쓰는 등)은 Epic 6 스케줄링 범위(PRD R-4) — 여기선 소속만.
create table if not exists public.rooms (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  department_id uuid references public.departments (id),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_rooms_department_id on public.rooms (department_id);

-- ── users.department_id FK (0002 이월) ───────────────────────────────────────
-- 0002 는 departments 부재로 FK 를 미부착했다(0002:37-38). departments 가 생긴 지금 추가한다.
-- 기존 user 행은 department_id 가 전부 NULL → FK 추가 안전. soft delete 만 하므로 on delete 기본
-- (NO ACTION): 참조 중인 진료과는 물리 삭제되지 않아 충돌이 발생하지 않는다.
alter table public.users
  add constraint users_department_id_fkey
  foreign key (department_id) references public.departments (id);

-- ── 권한 posture (0002 미러) ──────────────────────────────────────────────────
-- 쓰기 권위 = FastAPI(service_role) + master.manage 게이트. 읽기 = authenticated SELECT(전역 참조
-- 데이터 — 모든 직원이 피커/조회로 읽음). anon 접근 불가.
revoke all on public.departments, public.rooms from anon, authenticated;
grant select, insert, update, delete on public.departments, public.rooms to service_role;
grant select on public.departments, public.rooms to authenticated;

-- ── RLS(방어심층 — service_role/FastAPI 쓰기에도 유지) ────────────────────────
alter table public.departments enable row level security;
alter table public.rooms       enable row level security;

-- 전역 참조 데이터: authenticated SELECT 전체 허용(비민감 — 코드·명칭만). 관리화면은 비활성도
-- 표시해야 하므로 inactive 행도 노출하고, 신규 선택 제외는 소비처 피커가 is_active=true 로 필터한다.
-- 쓰기 정책은 두지 않는다 = authenticated 의 INSERT/UPDATE/DELETE 거부(쓰기는 service_role 이 RLS 우회).
drop policy if exists departments_select_authenticated on public.departments;
create policy departments_select_authenticated on public.departments
  for select to authenticated using (true);

drop policy if exists rooms_select_authenticated on public.rooms;
create policy rooms_select_authenticated on public.rooms
  for select to authenticated using (true);

-- ── 감사 트리거 부착(0004 audit_trigger_fn 재사용) ────────────────────────────
-- 두 테이블 모두 id 컬럼 보유 → 트리거의 target_id = coalesce(after->>'id', before->>'id') 계약 충족
-- (1.3 이월 'id 컬럼 계약'). 생성·수정·비활성이 actor(=app.actor_id=호출 관리자)와 함께 자동 감사된다.
drop trigger if exists trg_departments_audit on public.departments;
create trigger trg_departments_audit after insert or update or delete on public.departments
  for each row execute function public.audit_trigger_fn();

drop trigger if exists trg_rooms_audit on public.rooms;
create trigger trg_rooms_audit after insert or update or delete on public.rooms
  for each row execute function public.audit_trigger_fn();
