-- 0015_orders.sql — 오더 생명주기(처방·검사·처치) 스키마 + 유형별 상태머신(CHECK·전이 트리거·전이 RPC) + RLS·감사
-- Story 5.1 / FR-080(지시자·수행자·시각 분리 추적), FR-093(재수행 차단 DB 최종선), FR-051(처방↔진단 연결),
--   NFR-040(상태 전이 무결성 — 역행·건너뛰기·재수행 차단), FR-061(검사 유형별 워크리스트 라우팅 근거).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실). timestamptz=UTC 저장. soft delete=is_active.
-- 불변식·감사는 DB 가 소유 — 상태머신을 Python/TS 에 재구현 금지(전이 트리거·RPC 가 단일 진실, 0010 자세 계승).
--
-- ⚠️ 파일 번호 0015: 에픽 본문·아키텍처(§318)는 stale 번호 "0009_orders" 를 참조하나, 0009 는 이미
--    0009_patients 가 차지했고 번호가 누적 시프트됐다(0010~0014 적용분). 따라서 orders = 0015
--    (glossary.md §마이그레이션 번호 — Epic 4→5 Project Lead 결정). **Epic 5 마이그 블록 = 0015~0029 고정**
--    (병렬 Epic 6 워크트리 0030~ 침범 금지). 후속: nursing(5.6 vital_signs)·billing(5.10 수가 자동발생)는 0016+.
--
-- 상태머신 모델(유형별 per-table — 단일 통합 orders 테이블 없음; order=총칭 추상, 우 오더 패널 5.5 가 union):
--   처방   prescriptions   : (INSERT)→ issued    | issued → dispensed                 [dispense RPC = Epic 7(7.7)]
--   검사   examinations    : (INSERT)→ ordered   | ordered → performed → completed    [perform/complete RPC = 본 파일]
--   처치   treatment_orders: (INSERT)→ ordered   | ordered → performed → completed    [perform RPC = 본 파일; complete 예약]
--   종결·역행 없음(forward-only). 잘못된 전이/비정상 초기상태/재수행 = SQLSTATE 'PT409'(커스텀 'PT' 클래스;
--   FastAPI _map_pg_sqlstate 가 409 매핑 — 0010 과 동일 어휘, 신규 SQLSTATE 불요). not-found = 'PT404'(→404).
--   gap ⑤(오더 상태 어휘 통일·아키텍처 §428) = 본 파일이 확정.
--
-- 의존: 0001(gen_random_uuid), 0002(users·roles·permissions·prescription.create/examination.order/treatment.order/
--   treatment.perform 시드), 0003(has_permission), 0004(audit_trigger_fn), 0007(drugs·fee_schedules 마스터 FK),
--   0009(patients — RLS self 경로), 0010(encounters FK), 0014(encounter_diagnoses FK — FR-051).

-- ── equipment (검사장비 마스터 — 촬영 배정·가용성, 5.8 목록·상태 FR-103) ──────────
-- 오더 생명주기 아님(전이 트리거 없음). status=운영 가용성(available/in_use/maintenance, 5.8 자유 갱신).
-- examinations.equipment_id 가 참조하므로 먼저 생성. 전역 참조 데이터(rooms/departments 미러).
create table if not exists public.equipment (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,                 -- 장비 식별 코드(예 XR-01). 생성 후 불변
  name       text not null,                         -- 표시명(예 흉부촬영기)
  modality   text,                                  -- 영상 양식(예 X-ray/US/CT, 선택)
  status     text not null default 'available'
               check (status in ('available', 'in_use', 'maintenance')),  -- 가용성(상태머신 아님)
  is_active  boolean not null default true,         -- soft delete
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── prescriptions (처방전 헤더 — 한 내원에 1:N) ────────────────────────────────
create table if not exists public.prescriptions (
  id                    uuid primary key default gen_random_uuid(),
  encounter_id          uuid not null references public.encounters (id),          -- 1:N(한 내원 복수 처방)
  encounter_diagnosis_id uuid references public.encounter_diagnoses (id),         -- 처방 근거 진단(FR-051, nullable·5.2 세팅)
  status                text not null default 'issued'
                          check (status in ('issued', 'dispensed')),              -- 발행 → 발급(원외 약국, Epic 7)
  ordered_by            uuid not null references public.users (id),               -- 발행 의사(지시자, FastAPI jwt sub)
  ordered_at            timestamptz not null default now(),
  dispensed_at          timestamptz,                                              -- 발급 시각(Epic 7 7.7)
  is_active             boolean not null default true,                            -- soft delete(정정=is_active 토글)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_prescriptions_encounter_id on public.prescriptions (encounter_id);
create index if not exists idx_prescriptions_status       on public.prescriptions (status);

-- ── prescription_details (처방상세 라인 — 약품·용량·횟수·일수·용법) ────────────
-- 약품은 drug_id(약품 마스터 FK)로만 — free-text 약품명 차단의 구조적 강제(FR-050). dose/frequency/일수/용법은
-- 구조화 처방 파라미터(임상 서사 아님 — drug_id 조인 없이는 무의미 → 감사 마스킹 불요, encounter_diagnoses 동형).
create table if not exists public.prescription_details (
  id                uuid primary key default gen_random_uuid(),
  prescription_id   uuid not null references public.prescriptions (id),   -- 헤더 FK(1:N)
  drug_id           uuid not null references public.drugs (id),           -- 약품 마스터 FK(free-text 차단)
  dose              numeric check (dose is null or dose > 0),             -- 용량(단위=drugs.unit, 양수)
  frequency         text,                                                 -- 횟수/용법코드(예 'TID'=1일3회)
  duration_days     integer check (duration_days is null or duration_days > 0),  -- 투약 일수
  usage_instruction text,                                                 -- 용법(식후/식전 등 짧은 구조화 지시)
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_prescription_details_prescription_id on public.prescription_details (prescription_id);
create index if not exists idx_prescription_details_drug_id         on public.prescription_details (drug_id);

-- ── examinations (검사·영상 오더 — 진단검사 lab / 영상검사 imaging) ────────────
-- exam_type 이 워크리스트 라우팅 분기(imaging→방사선사 5.8 / lab 검체→간호 5.3, FR-061). 행위=fee_schedules
-- (EDI 행위 마스터) FK 로만 — free-text 차단. 판독 소견(finding) 텍스트 컬럼은 5.9 가 추가(0010 자유텍스트 회피
-- 자세 — 자유 임상 서사는 소유 스토리가 컬럼+마스킹 동반 추가).
create table if not exists public.examinations (
  id              uuid primary key default gen_random_uuid(),
  encounter_id    uuid not null references public.encounters (id),        -- 1:N
  exam_type       text not null check (exam_type in ('lab', 'imaging')),  -- 진단검사 / 영상검사(라우팅 FR-061)
  fee_schedule_id uuid not null references public.fee_schedules (id),     -- EDI 행위(검사 종류, master-only)
  status          text not null default 'ordered'
                    check (status in ('ordered', 'performed', 'completed')),  -- 지시 → 수행 → 판독/완료
  ordered_by      uuid not null references public.users (id),             -- 지시 의사(지시자)
  ordered_at      timestamptz not null default now(),
  equipment_id    uuid references public.equipment (id),                  -- 촬영 장비 배정(영상검사, 5.8·nullable)
  performed_by    uuid references public.users (id),                      -- 수행자(방사선사/간호, perform RPC 세팅)
  performed_at    timestamptz,
  completed_by    uuid references public.users (id),                      -- 판독의(complete RPC 세팅)
  completed_at    timestamptz,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_examinations_encounter_id   on public.examinations (encounter_id);
create index if not exists idx_examinations_status         on public.examinations (status);
-- 워크리스트 조회(검사 유형 × 상태) — 5.3/5.8 소비.
create index if not exists idx_examinations_type_status    on public.examinations (exam_type, status);

-- ── treatment_orders (처치 오더 — 간호 워크리스트, FR-070) ─────────────────────
-- 처치 수행 내용(자유 서사)·간호기록은 5.7 의 nursing_record(별도 테이블) 소유 — 본 테이블은 추적 FK·상태만.
create table if not exists public.treatment_orders (
  id              uuid primary key default gen_random_uuid(),
  encounter_id    uuid not null references public.encounters (id),
  fee_schedule_id uuid not null references public.fee_schedules (id),     -- 처치 행위(EDI, master-only)
  status          text not null default 'ordered'
                    check (status in ('ordered', 'performed', 'completed')),  -- 지시 → 수행 → 완료(complete 예약)
  ordered_by      uuid not null references public.users (id),             -- 지시 의사
  ordered_at      timestamptz not null default now(),
  performed_by    uuid references public.users (id),                      -- 수행 간호사(perform RPC 세팅)
  performed_at    timestamptz,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_treatment_orders_encounter_id on public.treatment_orders (encounter_id);
create index if not exists idx_treatment_orders_status       on public.treatment_orders (status);

-- ── 전이 강제 트리거(상태머신 단일 진실 — direct update·service_role 까지 봉쇄, NFR-040 최종선) ──
-- 0010 enforce_encounter_transition 패턴(테이블 미접근·old/new 비교·raise 만 → SECURITY DEFINER 불요).
-- INSERT=초기상태 가드, UPDATE=전이 매트릭스. same-status UPDATE(비-상태 컬럼 갱신, 예 5.8 equipment_id·
-- 5.2 진단 연결) 통과 허용. 위반 = SQLSTATE 'PT409'(FastAPI 409 매핑).

-- 처방: issued → dispensed (dispense=Epic 7).
create or replace function public.enforce_prescription_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'issued' then
      raise exception 'invalid initial prescription status: %', new.status using errcode = 'PT409';
    end if;
    return new;
  end if;
  if new.status = old.status then
    return new;
  end if;
  if not (old.status = 'issued' and new.status = 'dispensed') then
    raise exception 'invalid prescription transition: % -> %', old.status, new.status using errcode = 'PT409';
  end if;
  return new;
end;
$$;

-- 검사·처치 공용(매트릭스 동일 ordered→performed→completed): 두 트리거가 동일 함수 참조.
create or replace function public.enforce_act_order_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'ordered' then
      raise exception 'invalid initial order status: %', new.status using errcode = 'PT409';
    end if;
    return new;
  end if;
  if new.status = old.status then
    return new;
  end if;
  if not (
    (old.status = 'ordered'   and new.status = 'performed') or
    (old.status = 'performed' and new.status = 'completed')
  ) then
    raise exception 'invalid order transition: % -> %', old.status, new.status using errcode = 'PT409';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prescriptions_transition on public.prescriptions;
create trigger trg_prescriptions_transition
  before insert or update on public.prescriptions
  for each row execute function public.enforce_prescription_transition();

drop trigger if exists trg_examinations_transition on public.examinations;
create trigger trg_examinations_transition
  before insert or update on public.examinations
  for each row execute function public.enforce_act_order_transition();

drop trigger if exists trg_treatment_orders_transition on public.treatment_orders;
create trigger trg_treatment_orders_transition
  before insert or update on public.treatment_orders
  for each row execute function public.enforce_act_order_transition();

-- ── 전이 RPC 3종(SECURITY DEFINER + search_path 고정; has_permission 자체 게이트 = 동일 txn TOCTOU 재평가) ──
-- 0010 start_consult 동형. not-found(PT404) + 소스 상태 precondition(PT409)을 선검사 — 소스 상태 선검사가
-- **FR-093 재수행 차단의 핵심**(트리거의 same-status 통과가 만드는 사각: 이미 performed 인 오더 재수행 시
-- 수행자/시각 덮어쓰기 → 차단). 전이 트리거는 직접 update·잘못된 전이의 최종 백스톱으로 유지. 액터 = auth.uid().
-- 오더 생성(처방 발행·검사/처치 지시) INSERT 는 RPC 아님 — service_role 직접(5.2/5.3/5.4, walk-in 선례).

-- perform_examination: ordered → performed (방사선사 촬영 / 간호 검체 수행).
create or replace function public.perform_examination(p_examination_id uuid)
returns public.examinations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.examinations;
begin
  if not public.has_permission('examination.perform') then
    raise exception 'permission denied: examination.perform' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.examinations where id = p_examination_id for update;
  if not found then
    raise exception 'examination not found: %', p_examination_id using errcode = 'PT404';
  end if;
  if v_row.status <> 'ordered' then  -- 소스 상태 선검사(이미 performed/completed 재수행 차단, FR-093)
    raise exception 'invalid examination transition: % -> performed', v_row.status using errcode = 'PT409';
  end if;
  update public.examinations
     set status = 'performed', performed_by = (select auth.uid()), performed_at = now(), updated_at = now()
   where id = p_examination_id
   returning * into v_row;
  return v_row;
end;
$$;

-- complete_examination: performed → completed (판독의 판독 완료, FR-102). 판독 소견 텍스트 컬럼·캡처는
-- Story 5.9 가 추가/재정의(0010→4.7 complete_encounter 재정의 선례 — EXECUTE grant 는 create or replace 보존).
create or replace function public.complete_examination(p_examination_id uuid)
returns public.examinations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.examinations;
begin
  if not public.has_permission('examination.complete') then
    raise exception 'permission denied: examination.complete' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.examinations where id = p_examination_id for update;
  if not found then
    raise exception 'examination not found: %', p_examination_id using errcode = 'PT404';
  end if;
  if v_row.status <> 'performed' then  -- 소스 상태 선검사(수행 전 판독·재완료 차단)
    raise exception 'invalid examination transition: % -> completed', v_row.status using errcode = 'PT409';
  end if;
  update public.examinations
     set status = 'completed', completed_by = (select auth.uid()), completed_at = now(), updated_at = now()
   where id = p_examination_id
   returning * into v_row;
  return v_row;
end;
$$;

-- perform_treatment_order: ordered → performed (간호 처치 수행, FR-090·FR-092). 권한 treatment.perform(0002 기존).
create or replace function public.perform_treatment_order(p_treatment_order_id uuid)
returns public.treatment_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.treatment_orders;
begin
  if not public.has_permission('treatment.perform') then
    raise exception 'permission denied: treatment.perform' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.treatment_orders where id = p_treatment_order_id for update;
  if not found then
    raise exception 'treatment order not found: %', p_treatment_order_id using errcode = 'PT404';
  end if;
  if v_row.status <> 'ordered' then  -- 소스 상태 선검사(이미 performed 재수행 차단, FR-093)
    raise exception 'invalid treatment order transition: % -> performed', v_row.status using errcode = 'PT409';
  end if;
  update public.treatment_orders
     set status = 'performed', performed_by = (select auth.uid()), performed_at = now(), updated_at = now()
   where id = p_treatment_order_id
   returning * into v_row;
  return v_row;
end;
$$;

-- ── 권한 카탈로그 확장(0002 컨벤션 — 리소스 온라인 시 에픽 마이그레이션이 확장) ──────────
-- prescription.create·examination.order·treatment.order·treatment.perform 는 0002 에 이미 시드(재시드 금지).
-- 신규: order.read(RLS 직원 게이트 — 의사·간호·방사선만, 원무 제외 = 최소권한, diagnosis.read 자세 계승),
--   examination.perform(촬영/검체 수행), examination.complete(판독). 역할별 grant(비-admin)는 seed.sql/1.7 매트릭스.
insert into public.permissions (code, name, resource, action) values
  ('order.read',           '오더 조회',      'order',       'read'),
  ('examination.perform',  '검사·영상 수행', 'examination', 'perform'),
  ('examination.complete', '검사 판독 완료', 'examination', 'complete')
on conflict (code) do nothing;

-- admin 부트 grant(신규 권한만; 비-admin grant 는 Story 1.7 매트릭스 UI 소관). 멱등.
-- ⚠️ 필수: 0002 admin cross-join 은 후행 마이그레이션 권한을 자동 포함하지 않는다(누락 시
--    test_admin_role_has_all_permissions 회귀 — 0010·0012·0013·0014 가 겪은 함정).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('order.read', 'examination.perform', 'examination.complete')
where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;

-- ── 권한 posture(0014 패턴 — 민감 reveal 컬럼 없음 → 테이블 단위 GRANT) ────────────────────
revoke all on public.equipment, public.prescriptions, public.prescription_details,
              public.examinations, public.treatment_orders
  from anon, authenticated;
grant select, insert, update, delete on public.equipment, public.prescriptions, public.prescription_details,
              public.examinations, public.treatment_orders
  to service_role;
-- authenticated = SELECT(RLS 행 게이트). 쓰기는 service_role(FastAPI)/RPC.
grant select on public.equipment, public.prescriptions, public.prescription_details,
              public.examinations, public.treatment_orders
  to authenticated;
-- 전이 RPC EXECUTE: RPC 가 has_permission 자체 게이트 → authenticated 직접 호출도 안전(방어심층 + 테스트).
grant execute on function public.perform_examination(uuid)      to authenticated, service_role;
grant execute on function public.complete_examination(uuid)     to authenticated, service_role;
grant execute on function public.perform_treatment_order(uuid)  to authenticated, service_role;

-- ── RLS(방어심층 — service_role/FastAPI 쓰기에도 유지, 별도 RLS 파일 없이 인라인) ──────
alter table public.equipment            enable row level security;
alter table public.prescriptions        enable row level security;
alter table public.prescription_details enable row level security;
alter table public.examinations         enable row level security;
alter table public.treatment_orders     enable row level security;

-- equipment = 전역 참조(장비 목록·상태 — 비민감 코드/명칭). authenticated SELECT 전체(rooms/departments 미러).
drop policy if exists equipment_select_authenticated on public.equipment;
create policy equipment_select_authenticated on public.equipment
  for select to authenticated using (true);

-- 오더 4종: 직원 = order.read 권한 보유 시 전체 행(의사·간호·방사선 워크리스트 — encounter.read 가 아님, 임상 경계).
drop policy if exists prescriptions_select_staff on public.prescriptions;
create policy prescriptions_select_staff on public.prescriptions
  for select to authenticated using ((select public.has_permission('order.read')));

drop policy if exists prescription_details_select_staff on public.prescription_details;
create policy prescription_details_select_staff on public.prescription_details
  for select to authenticated using ((select public.has_permission('order.read')));

drop policy if exists examinations_select_staff on public.examinations;
create policy examinations_select_staff on public.examinations
  for select to authenticated using ((select public.has_permission('order.read')));

drop policy if exists treatment_orders_select_staff on public.treatment_orders;
create policy treatment_orders_select_staff on public.treatment_orders
  for select to authenticated using ((select public.has_permission('order.read')));

-- 환자 = 본인 내원의 오더만(encounter → patient → auth_uid 경유, 포털 Epic 8). encounter_diagnoses_select_self 미러.
drop policy if exists prescriptions_select_self on public.prescriptions;
create policy prescriptions_select_self on public.prescriptions
  for select to authenticated using (
    exists (
      select 1 from public.encounters e
      join public.patients p on p.id = e.patient_id
      where e.id = prescriptions.encounter_id and p.auth_uid = (select auth.uid())
    )
  );

-- 처방상세 = 헤더(prescriptions) → encounter → patient 추가 조인.
drop policy if exists prescription_details_select_self on public.prescription_details;
create policy prescription_details_select_self on public.prescription_details
  for select to authenticated using (
    exists (
      select 1 from public.prescriptions pr
      join public.encounters e on e.id = pr.encounter_id
      join public.patients p on p.id = e.patient_id
      where pr.id = prescription_details.prescription_id and p.auth_uid = (select auth.uid())
    )
  );

drop policy if exists examinations_select_self on public.examinations;
create policy examinations_select_self on public.examinations
  for select to authenticated using (
    exists (
      select 1 from public.encounters e
      join public.patients p on p.id = e.patient_id
      where e.id = examinations.encounter_id and p.auth_uid = (select auth.uid())
    )
  );

drop policy if exists treatment_orders_select_self on public.treatment_orders;
create policy treatment_orders_select_self on public.treatment_orders
  for select to authenticated using (
    exists (
      select 1 from public.encounters e
      join public.patients p on p.id = e.patient_id
      where e.id = treatment_orders.encounter_id and p.auth_uid = (select auth.uid())
    )
  );

-- 쓰기 정책 없음 = authenticated 의 INSERT/UPDATE/DELETE 거부(쓰기는 service_role/RPC 가 RLS 우회).

-- ── 감사 트리거 부착(0004 audit_trigger_fn 재사용 — 생성·전이·정정이 actor 와 함께 append-only 기록) ──
-- 5개 테이블 모두 id(uuid PK) 보유 → target_id = coalesce(after->>'id', before->>'id') 계약 충족(0004:63).
-- ⚠️ 스냅샷 컬럼 = FK(encounter_id·drug_id·fee_schedule_id·equipment_id·*_by)·플래그(is_*)·숫자(dose·duration_days)·
--    짧은 구조화 텍스트(frequency·usage_instruction·status·modality) = 비-자유텍스트 → 3.6 마스킹 집합(_SENSITIVE_KEY)
--    변경 불요(encounter_diagnoses 동일 FK posture, 4.7 §결정4). 자유 임상 서사(판독 소견 5.9·처치 내용 5.7)는
--    소유 스토리가 컬럼+마스킹 동반 추가 — 본 파일은 자유 서사 컬럼을 두지 않아 마스킹 교차절단 회피.
drop trigger if exists trg_equipment_audit on public.equipment;
create trigger trg_equipment_audit after insert or update or delete on public.equipment
  for each row execute function public.audit_trigger_fn();

drop trigger if exists trg_prescriptions_audit on public.prescriptions;
create trigger trg_prescriptions_audit after insert or update or delete on public.prescriptions
  for each row execute function public.audit_trigger_fn();

drop trigger if exists trg_prescription_details_audit on public.prescription_details;
create trigger trg_prescription_details_audit after insert or update or delete on public.prescription_details
  for each row execute function public.audit_trigger_fn();

drop trigger if exists trg_examinations_audit on public.examinations;
create trigger trg_examinations_audit after insert or update or delete on public.examinations
  for each row execute function public.audit_trigger_fn();

drop trigger if exists trg_treatment_orders_audit on public.treatment_orders;
create trigger trg_treatment_orders_audit after insert or update or delete on public.treatment_orders
  for each row execute function public.audit_trigger_fn();
