-- 0002_identity_rbac.sql — 직원 신원 · RBAC(역할·권한·역할_권한) 스키마 + 부트스트랩 시드
-- Story 1.3 / FR-210. 식별자 영문 snake_case(docs/glossary.md 단일 진실). timestamptz=UTC 저장.

-- ── roles (역할) ────────────────────────────────────────────────────────────
create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,           -- reception/doctor/nurse/radiologist/admin/patient
  name        text not null,                  -- 한글 표시명
  description text,
  created_at  timestamptz not null default now()
);

-- ── permissions (권한) ───────────────────────────────────────────────────────
create table if not exists public.permissions (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,            -- `<resource>.<action>` 형식 (예: patient.read)
  name       text not null,                   -- 한글 표시명
  resource   text not null,
  action     text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_permissions_resource_action on public.permissions (resource, action);

-- ── role_permissions (역할_권한, N:M) ────────────────────────────────────────
create table if not exists public.role_permissions (
  id            uuid primary key default gen_random_uuid(),
  role_id       uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (role_id, permission_id)
);
create index if not exists idx_role_permissions_role_id on public.role_permissions (role_id);
create index if not exists idx_role_permissions_permission_id on public.role_permissions (permission_id);

-- ── users (직원 프로필 — 분리 프로필 패턴) ────────────────────────────────────
-- id = Supabase auth uid (기본값 없음; Story 1.8 이 계정 생성 시 채움).
-- department_id 는 FK 미부착: departments 는 0005_masters 가 생성하므로 FK 도 0005 가 추가한다
-- (여기서 FK 를 걸면 'relation "departments" does not exist' 로 적용 실패).
create table if not exists public.users (
  id                uuid primary key references auth.users (id) on delete cascade,
  employee_no       text not null unique,
  name              text not null,
  role_id           uuid not null references public.roles (id),
  department_id     uuid,
  license_no        text,
  license_type      text check (license_type in ('doctor','radiologist')),
  phone             text,
  employment_status text not null default 'active'
                    check (employment_status in ('active','on_leave','terminated')),
  hire_date         date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_users_role_id on public.users (role_id);
create index if not exists idx_users_department_id on public.users (department_id);

-- ── 권한 posture (auto_expose off → 명시적 GRANT 필요) ────────────────────────
-- 쓰기 권위 = FastAPI(service_role). 직접 클라 읽기 = authenticated(SELECT) + RLS 행 필터(0003).
-- anon 은 신원/RBAC 테이블 접근 불가.
revoke all on public.users, public.roles, public.permissions, public.role_permissions
  from anon, authenticated;
grant select, insert, update, delete
  on public.users, public.roles, public.permissions, public.role_permissions
  to service_role;
grant select on public.roles, public.permissions, public.role_permissions to authenticated;
grant select on public.users to authenticated;  -- RLS(0003)가 본인 행으로 제한

-- ── 부트스트랩 시드 ───────────────────────────────────────────────────────────
-- 트리거(0004)는 이 마이그레이션 이후 부착되므로, 시드 INSERT 는 감사되지 않는다(시스템 부트스트랩).
-- 멱등: ON CONFLICT DO NOTHING.

-- 역할 6종(glossary §도메인 엔티티 role: 6역할)
insert into public.roles (code, name, description) values
  ('reception',   '원무과',   '접수·대기·수납 담당'),
  ('doctor',      '의사',     '진료·처방·오더 지시'),
  ('nurse',       '간호사',   '처치·활력징후·간호기록'),
  ('radiologist', '방사선사', '영상 촬영·판독 지원'),
  ('admin',       '관리자',   '시스템 관리·권한 설정'),
  ('patient',     '환자',     '환자 포털(본인 내역·예약)')
on conflict (code) do nothing;

-- 권한 카탈로그(초기 버전 — 리소스가 온라인될 때 에픽별 마이그레이션이 확장). 역할별 grant 토글 UI = Story 1.7.
insert into public.permissions (code, name, resource, action) values
  ('patient.read',         '환자 조회',         'patient',        'read'),
  ('patient.create',       '환자 등록',         'patient',        'create'),
  ('patient.update',       '환자 정보 수정',    'patient',        'update'),
  ('patient.reveal_rrn',   '주민번호 열람',     'patient',        'reveal_rrn'),
  ('encounter.register',   '접수',              'encounter',      'register'),
  ('encounter.start',      '진찰 시작',         'encounter',      'start'),
  ('encounter.complete',   '내원 완료',         'encounter',      'complete'),
  ('medical_record.write', '진료기록 작성',     'medical_record', 'write'),
  ('diagnosis.attach',     '진단 부착',         'diagnosis',      'attach'),
  ('prescription.create',  '처방 발행',         'prescription',   'create'),
  ('examination.order',    '검사·영상 오더',    'examination',    'order'),
  ('treatment.order',      '처치 오더',         'treatment',      'order'),
  ('treatment.perform',    '처치 수행',         'treatment',      'perform'),
  ('vital.record',         '활력징후 기록',     'vital',          'record'),
  ('appointment.read',     '예약 조회',         'appointment',    'read'),
  ('appointment.create',   '예약 생성',         'appointment',    'create'),
  ('appointment.cancel',   '예약 취소',         'appointment',    'cancel'),
  ('payment.process',      '수납 처리',         'payment',        'process'),
  ('master.manage',        '마스터 관리',       'master',         'manage'),
  ('dashboard.read',       '운영 대시보드 조회','dashboard',      'read'),
  ('user.manage',          '직원 계정 관리',    'user',           'manage'),
  ('rbac.manage',          '권한 매트릭스 관리','rbac',           'manage'),
  ('audit.read',           '감사 로그 조회',    'audit',          'read')
on conflict (code) do nothing;

-- 기본 grant: admin = 전체 권한(부트 가능 보장; 이후 Story 1.7 매트릭스에서 타 역할 grant 관리).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;
