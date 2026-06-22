-- 0021_billing.sql — 수가 자동발생(fee_items 적재 + fee_mappings 규칙) + 임상 이벤트 트리거 3종 + RLS·감사
-- Story 5.10 / FR-081(확정 진단·수행 오더 = 수가 자동발생 근거), FR-116(수가 자동발생 규칙:
--   진찰료=진찰 시 / 검사·처치·영상=수행 완료 시 / 약제비=처방 발행 시), NFR-040(트랜잭션 원자성).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실). timestamptz=UTC 저장. 금액=KRW 정수.
-- 불변식·적재는 DB 트리거가 소유 — 수가 로직을 Python/TS 에 재구현 금지(project-context).
--
-- ⚠️ 파일 번호 0021: 에픽/아키텍처(§321)는 stale 번호 "0012_billing" 을 참조하나, 번호가 누적
--    시프트됐다(0009_orders→실제 0015 선례와 동일). 실제 = 0021(0020_examination_reading 다음).
--    **Epic 5 마이그 블록 0015~0029 고정**(병렬 Epic 6 워크트리 0030~ 침범 금지). glossary §마이그레이션 단일 진실.
--
-- ── 수가 자동발생 메커니즘(DEC-1: DB 트리거 + 수가매핑 규칙 시드) ──
-- 임상 이벤트가 대응 수가 항목(fee_item)을 내원에 원자적·멱등적으로 적재한다. 적재 시점:
--   진찰료   encounters       : registered → in_progress  (start_consult RPC)        → fee_mappings encounter_start 규칙
--   검사·영상 examinations     : ordered    → performed    (perform_examination RPC)  → examinations.fee_schedule_id 직접
--   처치료   treatment_orders : ordered    → performed    (perform_treatment_order)  → treatment_orders.fee_schedule_id 직접
--
-- ⚠️ 매핑 비대칭: 검사·처치는 오더 행이 fee_schedule_id 를 직접 보유(0015·NOT NULL) → 행위=수가코드 항등 →
--    트리거가 NEW.fee_schedule_id 를 fee_items 에 직접 복사(fee_mappings 미경유). 진찰만 비-항등(내원에
--    fee_schedule_id 없음 → fee_mappings encounter_start 규칙이 진찰료 코드 결정)이라 매핑이 실재 필요.
--
-- ── 경계(사용자 확정 2026-06-22 · 본 파일 범위) ──
--   5.10 = 메커니즘 + fee_items 적재 + fee_mappings 진찰 규칙(시드).
--   Epic 7 = payments(수납 헤더)·payment_details(수납상세 라인=fee_items 집계)·finalize·진료비 문서·
--            급여/본인부담 산정·초진/재진 동적 판정·가산·약제비(drugs 약가 컬럼 부재 → 금액 산정 불가).
--   ⚠️ 약제비(처방 발행→수가)는 본 파일 미포함 — drugs 에 약가 없음(seed.sql §약품). 처방 발행 시 fee_item 0.
--
-- 의존: 0001(gen_random_uuid), 0002(permissions·role_permissions·admin), 0003(has_permission),
--   0004(audit_trigger_fn), 0007(fee_schedules FK), 0010(encounters + start_consult),
--   0015(examinations·treatment_orders + perform RPC), 0016(fee_schedules.coverage_type).

-- ── fee_mappings (수가매핑 규칙 — 행위→수가코드 외부화, FR-116) ────────────────
-- 코드 수정 없이 시드로 매핑 관리. source_event 가 비-항등 매핑이 필요한 임상 이벤트를 식별한다.
-- CHECK 단일값 'encounter_start' = 5.10 범위(진찰만). Epic 7 이 가산·정액제 등 신규 source_event 확장.
create table if not exists public.fee_mappings (
  id              uuid primary key default gen_random_uuid(),
  source_event    text not null check (source_event in ('encounter_start')),  -- 매핑 대상 임상 이벤트
  fee_schedule_id uuid not null references public.fee_schedules (id),          -- 매핑 결과 수가(EDI 행위)
  is_active       boolean not null default true,                              -- soft delete(매핑 토글)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- 트리거의 활성 매핑 조회(source_event × is_active) — encounter_start 룩업.
-- ⚠️ unique 부분 인덱스: source_event 당 활성 매핑 1행 강제 → fee_on_encounter_start 의 `limit 1`
--    이 비결정적이 되지 않게 다중 활성 매핑을 차단(23505). seed not exists 가드와 공존(멱등).
create unique index if not exists idx_fee_mappings_source_event
  on public.fee_mappings (source_event) where is_active;

-- ── fee_items (수가항목 — 내원별 자동 적재 + 금액 스냅샷) ──────────────────────
-- 임상 이벤트가 적재하는 수가 항목. Epic 7 수납이 payment_details 로 집계한다(별도 용어·glossary).
-- 금액/분류는 적재 시점 스냅샷(fee_schedules 마스터 변경 후에도 청구 시점 고정 — 정산 정합).
create table if not exists public.fee_items (
  id              uuid primary key default gen_random_uuid(),
  encounter_id    uuid not null references public.encounters (id),       -- 1:N(한 내원 복수 수가항목)
  fee_schedule_id uuid not null references public.fee_schedules (id),     -- 적재된 EDI 수가
  source_type     text not null
                    check (source_type in ('encounter', 'examination', 'treatment')),  -- 발생원 유형(약제비 미포함)
  source_id       uuid not null,                                         -- 발생원 레코드 id(역추적 + 멱등 키)
  quantity        integer not null default 1 check (quantity > 0),       -- 수량(5.10=항상 1·Epic 7 가변)
  unit_amount_krw integer not null check (unit_amount_krw >= 0),         -- 단가 스냅샷(fee_schedules.amount_krw)
  amount_krw      integer not null check (amount_krw >= 0),              -- 총액 스냅샷(quantity * unit_amount_krw)
  category        text,                                                  -- 분류 스냅샷(진찰료/검사료/…)
  coverage_type   text not null
                    check (coverage_type in ('covered', 'non_covered')), -- 급여여부 스냅샷(0016)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- 멱등 불변식: 같은 임상 이벤트(발생원)가 재발화해도 수가 항목 1회만 적재(트리거 재실행·동시성 재시도 방어).
  unique (source_type, source_id)
);
create index if not exists idx_fee_items_encounter_id on public.fee_items (encounter_id);

-- ── 적재 헬퍼(SECURITY DEFINER — fee_items INSERT 시 RLS/GRANT 우회; 0004 audit_trigger_fn 패턴) ──
-- fee_schedules 에서 금액·분류를 스냅샷 복사해 fee_items 에 멱등 INSERT. 트리거 3종이 공유 호출.
-- search_path 고정(0010/0015 SECURITY DEFINER 규칙). p_fee_schedule_id 는 호출처 FK 라 항상 실재.
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
  select * into v_fee from public.fee_schedules where id = p_fee_schedule_id;
  if not found then
    return;  -- 방어: 수가 부재 시 no-op(FK 가 보장하나 안전 — 적재 실패가 전이를 깨지 않게)
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

-- ── 트리거 함수 3종(임상 이벤트 → 수가 적재; 전부 SECURITY DEFINER + search_path 고정) ──

-- 진찰료: 활성 encounter_start 매핑이 가리키는 진찰료 적재(매핑 없으면 no-op·예외 아님).
create or replace function public.fee_on_encounter_start()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fee_schedule_id uuid;
begin
  select fee_schedule_id into v_fee_schedule_id
    from public.fee_mappings
   where source_event = 'encounter_start' and is_active
   limit 1;
  if v_fee_schedule_id is not null then
    perform public.insert_fee_item(new.id, v_fee_schedule_id, 'encounter', new.id);
  end if;
  return new;
end;
$$;

-- 검사·영상료: examinations.fee_schedule_id 직접 적재(매핑 항등).
create or replace function public.fee_on_examination_performed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.insert_fee_item(new.encounter_id, new.fee_schedule_id, 'examination', new.id);
  return new;
end;
$$;

-- 처치료: treatment_orders.fee_schedule_id 직접 적재(매핑 항등).
create or replace function public.fee_on_treatment_performed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.insert_fee_item(new.encounter_id, new.fee_schedule_id, 'treatment', new.id);
  return new;
end;
$$;

-- ── 트리거 부착(⚠️ AFTER UPDATE OF status + WHEN = 상태 전이만 정확히 1회 포착·중복 방지 핵심) ──
-- `OF status` 컬럼 한정 + WHEN(old→new) 조합으로 AFTER INSERT(walk-in 초기 registered)·same-status
-- UPDATE(0010/0015 비-상태 컬럼 갱신: doctor_id·equipment_id·room_id 등)·비-status UPDATE 를 미발화.
-- 정상 경로의 전이 자체는 RPC 소스상태 precondition(start_consult/perform_* PT409)이 1회 보장 →
-- 트리거 발화 1회 + unique(source_type, source_id) on conflict = 멱등(3중 방어).

drop trigger if exists trg_encounters_fee on public.encounters;
create trigger trg_encounters_fee
  after update of status on public.encounters
  for each row
  when (old.status = 'registered' and new.status = 'in_progress')
  execute function public.fee_on_encounter_start();

drop trigger if exists trg_examinations_fee on public.examinations;
create trigger trg_examinations_fee
  after update of status on public.examinations
  for each row
  when (old.status = 'ordered' and new.status = 'performed')
  execute function public.fee_on_examination_performed();

drop trigger if exists trg_treatment_orders_fee on public.treatment_orders;
create trigger trg_treatment_orders_fee
  after update of status on public.treatment_orders
  for each row
  when (old.status = 'ordered' and new.status = 'performed')
  execute function public.fee_on_treatment_performed();

-- ── 권한 카탈로그(0002 컨벤션 — 수가항목 조회, Epic 7 수납이 소비) ───────────────
-- fee_item.read = 원무·임상 조회용. 쓰기는 트리거(SECURITY DEFINER)만 — 조회 권한만 카탈로그화.
insert into public.permissions (code, name, resource, action) values
  ('fee_item.read', '수가항목 조회', 'fee_item', 'read')
on conflict (code) do nothing;

-- admin 부트 grant(신규 권한만; 비-admin grant 는 Story 1.7 매트릭스 UI 소관). 멱등.
-- ⚠️ 필수: 0002 admin cross-join 은 후행 마이그레이션 권한을 자동 포함하지 않는다(누락 시
--    test_admin_role_has_all_permissions 회귀 — 0010·0012·0013·0014·0015 가 겪은 함정).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'fee_item.read'
where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;

-- ── 권한 posture(0015 패턴 — 민감 컬럼 없음 → 테이블 단위 GRANT) ────────────────
revoke all on public.fee_mappings, public.fee_items from anon, authenticated;
grant select, insert, update, delete on public.fee_mappings, public.fee_items to service_role;
-- authenticated = SELECT(RLS 행 게이트). 쓰기는 트리거(SECURITY DEFINER)/시드/service_role.
grant select on public.fee_mappings, public.fee_items to authenticated;
-- ⚠️ insert_fee_item 은 SECURITY DEFINER(owner=postgres) — 트리거 내부 호출만 의도. PUBLIC 기본 EXECUTE 를
--    회수하지 않으면 authenticated 가 직접 호출해 임의 내원에 위조 수가를 적재(fee_items 쓰기 RLS 우회)할 수
--    있다. 트리거 발화는 definer 내부 호출이라 EXECUTE grant 불요(0005 decrypt_sensitive·0012 reveal_rrn 동형).
revoke all on function public.insert_fee_item(uuid, uuid, text, uuid) from public, anon, authenticated;

-- ── RLS(방어심층 — service_role/트리거 쓰기에도 유지, 0015 인라인 패턴) ──────────
alter table public.fee_mappings enable row level security;
alter table public.fee_items    enable row level security;

-- fee_mappings = 전역 참조 마스터(비민감 규칙). authenticated SELECT 전체(fee_schedules/equipment 미러).
drop policy if exists fee_mappings_select_authenticated on public.fee_mappings;
create policy fee_mappings_select_authenticated on public.fee_mappings
  for select to authenticated using (true);

-- fee_items: 직원 = fee_item.read 보유 시 전체 행(Epic 7 수납 정산 — encounters_select_staff 미러).
drop policy if exists fee_items_select_staff on public.fee_items;
create policy fee_items_select_staff on public.fee_items
  for select to authenticated using ((select public.has_permission('fee_item.read')));

-- fee_items: 환자 = 본인 내원의 항목만(encounter → patient → auth_uid 경유, 포털 Epic 8).
drop policy if exists fee_items_select_self on public.fee_items;
create policy fee_items_select_self on public.fee_items
  for select to authenticated using (
    exists (
      select 1 from public.encounters e
      join public.patients p on p.id = e.patient_id
      where e.id = fee_items.encounter_id and p.auth_uid = (select auth.uid())
    )
  );

-- 쓰기 정책 없음 = authenticated 의 INSERT/UPDATE/DELETE 거부(적재는 SECURITY DEFINER 트리거가 우회).

-- ── 감사 트리거 부착(0004 audit_trigger_fn 재사용 — 적재·변경이 actor 와 함께 append-only 기록) ──
-- 두 테이블 모두 id(uuid PK) 보유 → target_id = coalesce(after->>'id', before->>'id') 계약 충족(0004:63).
-- ⚠️ 스냅샷 컬럼 = FK(encounter_id·fee_schedule_id·source_id)·숫자(quantity·*_krw)·짧은 구조화 텍스트
--    (source_type·category·coverage_type·source_event) = 비-자유텍스트 → 3.6 마스킹 집합(_SENSITIVE_KEY)
--    변경 불요(5.1 §AC6·encounter_diagnoses 동형 FK posture — 자유 임상 서사 컬럼 0).
-- ⚠️ 적재 actor: 트리거가 start_consult/perform_* RPC 트랜잭션 내부에서 발화 → app.actor_id GUC(또는
--    auth.uid() 폴백)가 RPC 호출자로 유지(0004 actor 캡처 계약) → 감사 actor = 수가 발생시킨 직원.
drop trigger if exists trg_fee_mappings_audit on public.fee_mappings;
create trigger trg_fee_mappings_audit after insert or update or delete on public.fee_mappings
  for each row execute function public.audit_trigger_fn();

drop trigger if exists trg_fee_items_audit on public.fee_items;
create trigger trg_fee_items_audit after insert or update or delete on public.fee_items
  for each row execute function public.audit_trigger_fn();
