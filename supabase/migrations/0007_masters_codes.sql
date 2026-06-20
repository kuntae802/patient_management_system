-- 0007_masters_codes.sql — 코드 마스터(KCD 진단·EDI 수가·약품) + 유효기간(발효/만료) + 감사·RLS
-- Story 2.2 / FR-201(이월 갭 ① — 마스터 3종 발효/만료 컬럼). 식별자 영문 snake_case(docs/glossary.md 단일 진실).
-- soft delete = is_active(물리 삭제 금지 — 과거 기록 참조 보존, FR-203). 불변식·감사는 DB 가 소유.
--
-- ⚠️ 파일 번호 0007: 0001~0006 적용됨(0005=crypto, 0006=조직 마스터). 아키텍처 계획의 "0005_masters"
--    +"0006_patients" 는 crypto(0005) 삽입으로 시프트됐고, 코드 마스터가 0007 을 차지하므로 patients 는
--    0008 로 한 칸 더 cascade(glossary.md §마이그레이션 번호 변이).
--
-- 🔑 버전·유효기간 모델: code UNIQUE(코드당 1행, 0006 미러). "버전" = effective_from/effective_to 유효기간
--    + audit_logs 변경이력(0004 트리거)으로 표현(별도 version 컬럼 없음). 소비처(2.3 피커·Epic4·5)는
--    "현재 유효" = is_active AND effective_from<=오늘 AND (effective_to IS NULL OR effective_to>=오늘) 로 필터.
--    관리화면(2.2)은 비활성·만료 행도 표시(편집 목적) → RLS authenticated SELECT 는 전부 노출.

-- ── diagnoses (KCD 진단 마스터) ──────────────────────────────────────────────
create table if not exists public.diagnoses (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,            -- KCD 코드값(영문1+숫자, 예 I10). 생성 후 불변
  name           text not null,                   -- 한글 진단명(예: 본태성 고혈압)
  effective_from date not null,                   -- 발효일(이 날부터 유효)
  effective_to   date,                            -- 만료일(nullable=무기한). null 아니면 이 날까지 유효
  is_active      boolean not null default true,   -- soft delete: false=신규 선택 제외, 행·명칭은 보존
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint diagnoses_effective_range check (effective_to is null or effective_to >= effective_from)
);
create index if not exists idx_diagnoses_effective on public.diagnoses (effective_from, effective_to);

-- ── fee_schedules (EDI 행위 수가 마스터) ─────────────────────────────────────
-- 단가(amount_krw)는 KRW 정수(소수 없음). 급여여부·산정특례·본인부담률은 Epic 7 수납(다운스트림).
create table if not exists public.fee_schedules (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,            -- EDI 행위 수가코드
  name           text not null,                   -- 행위명
  amount_krw     integer not null,                -- 단가(원, 정수)
  category       text,                            -- 분류(선택)
  effective_from date not null,
  effective_to   date,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint fee_schedules_amount_nonneg check (amount_krw >= 0),
  constraint fee_schedules_effective_range check (effective_to is null or effective_to >= effective_from)
);
create index if not exists idx_fee_schedules_effective on public.fee_schedules (effective_from, effective_to);

-- ── drugs (약품 마스터) ──────────────────────────────────────────────────────
-- code=의약품 표준코드(KD)/보험코드, ingredient_code=주성분코드(9자리, 대체조제 — 선택), unit=단위(선택).
create table if not exists public.drugs (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,           -- 의약품 표준/보험 코드
  name            text not null,                  -- 약품명(제품명)
  ingredient_code text,                           -- 주성분코드(9자리, 선택)
  unit            text,                           -- 단위(예 정/캡슐/mL, 선택)
  effective_from  date not null,
  effective_to    date,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint drugs_effective_range check (effective_to is null or effective_to >= effective_from)
);
create index if not exists idx_drugs_effective on public.drugs (effective_from, effective_to);

-- ── 권한 posture (0006 미러) ──────────────────────────────────────────────────
-- 쓰기 권위 = FastAPI(service_role) + master.manage 게이트. 읽기 = authenticated SELECT(전역 참조
-- 데이터 — 모든 직원이 피커/조회로 읽음). anon 접근 불가.
revoke all on public.diagnoses, public.fee_schedules, public.drugs from anon, authenticated;
grant select, insert, update, delete on public.diagnoses, public.fee_schedules, public.drugs to service_role;
grant select on public.diagnoses, public.fee_schedules, public.drugs to authenticated;

-- ── RLS(방어심층 — service_role/FastAPI 쓰기에도 유지) ────────────────────────
alter table public.diagnoses      enable row level security;
alter table public.fee_schedules  enable row level security;
alter table public.drugs          enable row level security;

-- 전역 참조 데이터: authenticated SELECT 전체 허용(비민감 — 코드·명칭·금액·날짜만, PII 없음). 관리화면은
-- 비활성·만료도 표시해야 하므로 전부 노출하고, 신규 선택 제외는 소비처 피커가 "현재 유효"로 필터한다.
-- 쓰기 정책은 두지 않는다 = authenticated 의 INSERT/UPDATE/DELETE 거부(쓰기는 service_role 이 RLS 우회).
drop policy if exists diagnoses_select_authenticated on public.diagnoses;
create policy diagnoses_select_authenticated on public.diagnoses
  for select to authenticated using (true);

drop policy if exists fee_schedules_select_authenticated on public.fee_schedules;
create policy fee_schedules_select_authenticated on public.fee_schedules
  for select to authenticated using (true);

drop policy if exists drugs_select_authenticated on public.drugs;
create policy drugs_select_authenticated on public.drugs
  for select to authenticated using (true);

-- ── 감사 트리거 부착(0004 audit_trigger_fn 재사용) ────────────────────────────
-- 세 테이블 모두 id 컬럼 보유 → 트리거의 target_id = coalesce(after->>'id', before->>'id') 계약 충족
-- (1.3 이월 'id 컬럼 계약'). 생성·수정·비활성이 actor(=app.actor_id=호출 관리자)와 함께 자동 감사된다.
drop trigger if exists trg_diagnoses_audit on public.diagnoses;
create trigger trg_diagnoses_audit after insert or update or delete on public.diagnoses
  for each row execute function public.audit_trigger_fn();

drop trigger if exists trg_fee_schedules_audit on public.fee_schedules;
create trigger trg_fee_schedules_audit after insert or update or delete on public.fee_schedules
  for each row execute function public.audit_trigger_fn();

drop trigger if exists trg_drugs_audit on public.drugs;
create trigger trg_drugs_audit after insert or update or delete on public.drugs
  for each row execute function public.audit_trigger_fn();
