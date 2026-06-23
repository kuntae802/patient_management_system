-- 0045_payments.sql — 수납 헤더(payments) + 수납상세 라인(payment_details) 스키마
--   + 진찰료 초진/재진 동적 매핑(fee_on_encounter_start 재정의) + 만료·비활성 수가 적재 제외(insert_fee_item 재정의)
--   + amount 정합 CHECK(fee_items·payment_details) + RLS·감사·권한. (전부 5.10 이월 흡수 포함)
-- Story 7.1 / FR-110(자동발생 수가 집계·수납 건 생성), FR-116(수가 자동발생 규칙), NFR-041(트랜잭션 원자성).
--   아키텍처 §445(한국 청구 단순화 선 = 수납 에픽 소유) · §179 ④(선/후수납 정책 플래그).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실). timestamptz=UTC 저장. 금액=KRW 정수(소수 없음).
-- 불변식·적재는 DB 가 소유 — 수가/정산 로직을 Python/TS 에 재구현 금지(project-context).
--
-- ⚠️ 파일 번호 0045: Epic 7 마이그 블록 0045~0059(Epic 6 워크트리 0030~0037 다음). 에픽/아키(§321) stale
--    "0012_billing" 정정 — 누적 시프트(0015·0021 헤더 선례 동형). glossary §마이그레이션 단일 진실.
--
-- ── 2계층 수가 모델(glossary: fee_item ≠ payment_detail = 설계 의도) ──
--   임상 적재   fee_items(0021·5.10)        : 임상 이벤트 → 내원별 수가항목(금액 스냅샷·멱등)
--   수납 집계   payment_details(본 파일·7.1) : payments 헤더 1:N 라인 = fee_items 집계 대상(집계 RPC=7.2)
--   본 스토리(7.1) = 스키마 + 초진/재진 동적 매핑 + 5.10 이월 흡수. **집계=7.2·본인부담 산정=7.3·finalize=7.4·문서=7.5~7.7.**
--
-- ── 경계(사용자 확정 2026-06-23) ──
--   초진/재진 = 동적 판정(과거 완료 내원 유무) · 본인부담 = 보험유형별(컬럼만·산정 7.3) · 약제비 = 원외처방 스코프아웃(fee_item 0).
--   payments 금액·결제 컬럼 = 7.2 집계/7.3 산정/7.4 결제가 채움(본 파일 = 컬럼·불변식·기본값 0/NULL 선언만).
--
-- 의존: 0001(gen_random_uuid), 0002(permissions·role_permissions·admin·users), 0003(has_permission),
--   0004(audit_trigger_fn), 0007(fee_schedules FK·effective/is_active), 0010(encounters·patient_id·status),
--   0021(fee_items·fee_mappings·insert_fee_item·fee_on_encounter_start — 본 파일이 재정의/확장).

-- ════════════════════════════════════════════════════════════════════════════
-- Task 1 — 수납 스키마(payments·payment_details) + 권한·GRANT·RLS·감사
-- ════════════════════════════════════════════════════════════════════════════

-- ── payments (수납 헤더 — 내원 1:1) ──────────────────────────────────────────
-- 한 외래 내원의 정산 헤더. encounter_id UNIQUE = 내원당 수납 1건(1:1 불변식). 선수납(7.8)도 단일 헤더 +
-- paid_amount_krw 누적(별도 행 아님). 금액·결제 컬럼은 7.2/7.3/7.4 가 채움 — 본 파일은 0/NULL 기본값.
create table if not exists public.payments (
  id                     uuid primary key default gen_random_uuid(),
  encounter_id           uuid not null unique references public.encounters (id),  -- 내원 1:1(정산 헤더)
  status                 text not null default 'draft'
                           check (status in ('draft', 'finalized', 'cancelled')),  -- draft=집계전/중(7.2)·finalized=결제완료(7.4)·cancelled=취소/노쇼 미발생(7.9)
  billing_type           text not null default 'postpaid'
                           check (billing_type in ('postpaid', 'prepaid')),        -- 후수납 기본 / 선수납(7.8·아키 §179 ④)
  -- 금액 집계(7.2 집계·7.3 산정·7.4 결제가 채움 — 본 파일=기본값 0). 전부 KRW 정수 >= 0.
  total_amount_krw       integer not null default 0 check (total_amount_krw >= 0),         -- 총 진료비(급여+비급여)
  covered_amount_krw     integer not null default 0 check (covered_amount_krw >= 0),       -- 급여 대상 금액
  non_covered_amount_krw integer not null default 0 check (non_covered_amount_krw >= 0),   -- 비급여 금액
  copay_amount_krw       integer not null default 0 check (copay_amount_krw >= 0),         -- 본인부담금(환자 청구)
  insurer_amount_krw     integer not null default 0 check (insurer_amount_krw >= 0),       -- 공단부담금
  paid_amount_krw        integer not null default 0 check (paid_amount_krw >= 0),          -- 이미 납부(선수납 7.8)
  -- 결제(7.4 finalize 가 채움 — nullable).
  payment_method         text check (payment_method in ('card', 'cash', 'transfer')),     -- 결제수단
  payment_no             text unique,                                                      -- 영수증/수납번호(finalize 시 부여·7.4/7.5)
  finalized_at           timestamptz,
  finalized_by           uuid references public.users (id),
  cancelled_at           timestamptz,
  cancel_reason          text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ── payment_details (수납상세 라인 — fee_items 집계 대상·7.2 가 적재) ─────────
-- payments 헤더 1:N 라인. 스냅샷(code·name·금액·분류·coverage) = 집계 시점 고정(청구 정합). 본인부담 컬럼은 7.3 채움.
create table if not exists public.payment_details (
  id                 uuid primary key default gen_random_uuid(),
  payment_id         uuid not null references public.payments (id) on delete cascade,  -- 헤더 삭제 시 라인 동반(draft 정리)
  fee_item_id        uuid references public.fee_items (id),                            -- 출처 수가항목(역추적·집계원). nullable=수기 라인(7.x 가산·노쇼료 7.9)
  -- 스냅샷(집계 시점 fee_items/fee_schedules 복사 — 청구 시점 고정).
  fee_schedule_id    uuid references public.fee_schedules (id),
  code               text,                                                            -- EDI 코드
  name               text,                                                            -- 행위명(비-PII — 마스킹 무관)
  category           text,                                                            -- 분류(진찰료/검사료/…)
  quantity           integer not null default 1 check (quantity > 0),
  unit_amount_krw    integer not null check (unit_amount_krw >= 0),                   -- 단가
  amount_krw         integer not null check (amount_krw >= 0),                        -- 총액(quantity * unit)
  coverage_type      text not null check (coverage_type in ('covered', 'non_covered')),
  -- 본인부담 산정(7.3 이 채움 — 본 파일=컬럼만·기본값 0/NULL).
  copay_rate         numeric(4,3) check (copay_rate is null or copay_rate between 0 and 1),  -- 적용 본인부담률 스냅샷(0~1·예 0.300)
  copay_amount_krw   integer not null default 0 check (copay_amount_krw >= 0),
  insurer_amount_krw integer not null default 0 check (insurer_amount_krw >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- 금액 정합: 총액 = 수량 * 단가(집계 quantity 가변 대비 강제 — 5.10 이월 흡수, AC5 의 payment_details 측).
  constraint payment_details_amount_calc check (amount_krw = quantity * unit_amount_krw),
  -- 집계 멱등: 같은 수가항목이 한 수납에 2회 집계 금지(fee_items unique 의 집계측 거울).
  --   NULL fee_item_id 다중 허용(수기 라인 — Postgres unique 는 NULL 을 distinct 취급).
  unique (payment_id, fee_item_id)
);
create index if not exists idx_payment_details_payment_id on public.payment_details (payment_id);

-- ── 권한 카탈로그(0021 컨벤션 — 수납 조회, Epic 7 원무 정산·환자 포털 Epic 8 소비) ──
-- payment.read = 원무·임상 조회용. 쓰기 권한(payment.manage/finalize)은 7.4 소관(소비처 정의 시).
insert into public.permissions (code, name, resource, action) values
  ('payment.read', '수납 조회', 'payment', 'read')
on conflict (code) do nothing;

-- admin 부트 grant(신규 권한만; 비-admin grant 는 Story 1.7 매트릭스 UI 소관). 멱등.
-- ⚠️ 필수: 0002 admin cross-join 은 후행 마이그레이션 권한을 자동 포함하지 않는다(누락 시
--    test_admin_role_has_all_permissions 회귀 — 0010·0013·0014·0015·0021 이 겪은 함정).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'payment.read'
where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;

-- ── 권한 posture(0021 패턴 — 민감 컬럼 없음 → 테이블 단위 GRANT) ──────────────
revoke all on public.payments, public.payment_details from anon, authenticated;
grant select, insert, update, delete on public.payments, public.payment_details to service_role;
-- authenticated = SELECT(RLS 행 게이트). 쓰기는 service_role/FastAPI(7.2 집계·7.4 finalize).
grant select on public.payments, public.payment_details to authenticated;

-- ── RLS(방어심층 — service_role/FastAPI 쓰기에도 유지, 0021/0010 인라인 패턴) ──
alter table public.payments        enable row level security;
alter table public.payment_details enable row level security;

-- payments: 직원 = payment.read 보유 시 전체 행(원무 정산) — encounters_select_staff 미러.
drop policy if exists payments_select_staff on public.payments;
create policy payments_select_staff on public.payments
  for select to authenticated using ((select public.has_permission('payment.read')));

-- payments: 환자 = 본인 내원의 수납만(encounter→patient→auth_uid 경유, 포털 Epic 8). encounters_select_self 미러.
drop policy if exists payments_select_self on public.payments;
create policy payments_select_self on public.payments
  for select to authenticated using (
    exists (
      select 1 from public.encounters e
      join public.patients p on p.id = e.patient_id
      where e.id = payments.encounter_id and p.auth_uid = (select auth.uid())
    )
  );

-- payment_details: 직원 = payment.read 보유 시 전체 행.
drop policy if exists payment_details_select_staff on public.payment_details;
create policy payment_details_select_staff on public.payment_details
  for select to authenticated using ((select public.has_permission('payment.read')));

-- payment_details: 환자 = 본인 수납의 라인만(payment→encounter→patient→auth_uid 경유).
drop policy if exists payment_details_select_self on public.payment_details;
create policy payment_details_select_self on public.payment_details
  for select to authenticated using (
    exists (
      select 1 from public.payments pay
      join public.encounters e on e.id = pay.encounter_id
      join public.patients p on p.id = e.patient_id
      where pay.id = payment_details.payment_id and p.auth_uid = (select auth.uid())
    )
  );

-- 쓰기 정책 없음 = authenticated 의 INSERT/UPDATE/DELETE 거부(쓰기는 service_role/FastAPI 7.2/7.4 가 RLS 우회).

-- ── 감사 트리거 부착(0004 audit_trigger_fn 재사용 — append-only, actor 동반) ──
-- 두 테이블 id(uuid PK) 보유 → target_id = coalesce(after->>'id', before->>'id') 계약 충족(0004).
-- ⚠️ 스냅샷 컬럼 = FK·숫자·금액·짧은 구조화 텍스트(status·billing_type·coverage_type·category·payment_method)
--    ·EDI code·행위명(name=처치/검사 명칭·비-PII) = 자유 임상 서사·환자 PII 없음 → 3.6 마스킹 집합(_SENSITIVE_KEY/
--    _PII_NAME_TABLES) 무변경(5.10 §AC9·encounter_diagnoses 동형 FK posture — payment_details 는 _PII_NAME_TABLES 비포함).
drop trigger if exists trg_payments_audit on public.payments;
create trigger trg_payments_audit after insert or update or delete on public.payments
  for each row execute function public.audit_trigger_fn();

drop trigger if exists trg_payment_details_audit on public.payment_details;
create trigger trg_payment_details_audit after insert or update or delete on public.payment_details
  for each row execute function public.audit_trigger_fn();

-- ════════════════════════════════════════════════════════════════════════════
-- Task 2 — 5.10 함수·매핑 재정의(초진/재진 동적 · 만료수가 적재제외 · amount CHECK)
-- ════════════════════════════════════════════════════════════════════════════

-- ── fee_mappings source_event 확장(초진/재진 동적 — AC3) ──────────────────────
-- 5.10 = encounter_start 단일(재진 고정). 7.1 = 초진/재진 분기(encounter_start_initial/repeat) 추가.
-- 레거시 encounter_start 보존(폴백·하위호환). unique 부분 인덱스 idx_fee_mappings_source_event(source_event)
--   where is_active 는 유지 — 세 source_event 각각 활성 1행 강제(fee_on_encounter_start 의 limit 1 결정성).
alter table public.fee_mappings drop constraint if exists fee_mappings_source_event_check;
alter table public.fee_mappings add constraint fee_mappings_source_event_check
  check (source_event in ('encounter_start', 'encounter_start_initial', 'encounter_start_repeat'));

-- ── insert_fee_item 재정의(만료·비활성 수가 적재 제외 — 5.10 이월 흡수, AC4) ──
-- 5.10 = id 만 룩업. 7.1 = "현재 유효"(is_active · effective 윈도우) 술어 추가 → 만료/폐지 EDI 코드 신규 적재
--   차단(0007 "현재 유효" 계약 충족·deferred-work L344 해소). 유효 시점 스냅샷 금액은 후 만료돼도 보존
--   (적재 시점 고정 의도와 양립 — 차단 대상은 *신규* 적재만). 나머지는 0021 불변(멱등·SECURITY DEFINER).
create or replace function public.insert_fee_item(
  p_encounter_id    uuid,
  p_fee_schedule_id uuid,
  p_source_type     text,
  p_source_id       uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fee public.fee_schedules;
begin
  select * into v_fee from public.fee_schedules
   where id = p_fee_schedule_id
     and is_active
     and effective_from <= current_date
     and (effective_to is null or effective_to >= current_date);
  if not found then
    return;  -- 만료·미발효·비활성·미존재 = 적재 안 함(만료 수가 청구 제외 — 적재 시점 검증)
  end if;
  insert into public.fee_items
    (encounter_id, fee_schedule_id, source_type, source_id,
     quantity, unit_amount_krw, amount_krw, category, coverage_type)
  values
    (p_encounter_id, p_fee_schedule_id, p_source_type, p_source_id,
     1, v_fee.amount_krw, v_fee.amount_krw, v_fee.category, v_fee.coverage_type)
  on conflict (source_type, source_id) do nothing;  -- 멱등(중복 적재 0)
end;
$$;
-- 방어적 재선언: 서명 동일이라 0021 의 PUBLIC EXECUTE 회수(patch2)는 보존되나, 마이그 자기완결성과
--   authenticated 직접 호출 수가 위조 회귀 차단을 위해 명시 재선언(0005/0012/0021 동형 posture).
revoke all on function public.insert_fee_item(uuid, uuid, text, uuid) from public, anon, authenticated;

-- ── fee_on_encounter_start 재정의(진찰료 초진/재진 동적 판정 — AC3) ───────────
-- 5.10 = encounter_start 단일 룩업(재진 AA254 고정). 7.1 = 환자 과거 완료 내원 유무로 초진/재진 분기:
--   과거 완료 내원 존재 → 재진(encounter_start_repeat → AA254) / 없으면(첫 방문) → 초진(encounter_start_initial → AA154).
--   분기 매핑 부재 시 레거시 encounter_start 폴백(5.10 단일 매핑 하위호환). 30일 재진규칙·진료과 가산은 미구현(단순화 선).
-- 트리거 부착(trg_encounters_fee: AFTER UPDATE OF status WHEN registered→in_progress)은 0021 그대로(재부착 불요).
create or replace function public.fee_on_encounter_start()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_repeat       boolean;
  v_event           text;
  v_fee_schedule_id uuid;
begin
  -- 초진/재진 판정(이력 유무): 동일 환자의 과거 완료 내원(현 내원 제외) 존재 = 재진.
  select exists (
    select 1 from public.encounters e
    where e.patient_id = new.patient_id
      and e.id <> new.id
      and e.status = 'completed'
  ) into v_is_repeat;
  v_event := case when v_is_repeat then 'encounter_start_repeat' else 'encounter_start_initial' end;
  -- 분기 이벤트 활성 매핑 룩업 → 없으면 레거시 encounter_start 폴백.
  select fee_schedule_id into v_fee_schedule_id
    from public.fee_mappings where source_event = v_event and is_active limit 1;
  if v_fee_schedule_id is null then
    select fee_schedule_id into v_fee_schedule_id
      from public.fee_mappings where source_event = 'encounter_start' and is_active limit 1;
  end if;
  if v_fee_schedule_id is not null then
    perform public.insert_fee_item(new.id, v_fee_schedule_id, 'encounter', new.id);
  end if;
  return new;
end;
$$;

-- ── fee_items amount 정합 CHECK(5.10 이월 흡수, AC5) ──────────────────────────
-- 5.10 quantity 항상 1(amount=unit)이라 기존 행 전부 충족 → 무회귀. Epic 7 quantity 가변(집계)·
--   직접 UPDATE(service_role) 대비 amount<>quantity*unit 불일치 행 차단(deferred-work L346 해소).
alter table public.fee_items drop constraint if exists fee_items_amount_calc;
alter table public.fee_items add constraint fee_items_amount_calc
  check (amount_krw = quantity * unit_amount_krw);
