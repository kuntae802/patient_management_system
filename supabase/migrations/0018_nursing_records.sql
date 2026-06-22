-- 0018_nursing_records.sql — 일상/처치 간호기록(nursing_record) 테이블 + 신규 권한 nursing.record + RLS·GRANT·감사.
-- Story 5.7 / FR-090(처치 워크리스트)·FR-092(처치 수행·처치기록)·FR-093(재수행 차단)·FR-094(오더 없는 일상 간호기록).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실 — nursing_record 기등재). timestamptz=UTC 저장. soft delete=is_active.
-- 한국어는 UI 라벨·주석만.
--
-- ⚠️ 처치 수행 엔진은 0015 가 완비 — 본 파일은 소비만(신규 DDL = nursing_record 테이블·권한뿐).
--    perform_treatment_order RPC(0015:251 — ordered→performed·소스상태 precondition=FR-093 재수행 차단·
--    performed_by/at 세팅·treatment.perform 자가 게이트)·전이 트리거(enforce_act_order_transition)·treatment_orders
--    스키마·RLS·GRANT·감사는 0015 소유. treatment.perform 은 0002:96 기존 권한(nurse seed grant 5.1).
--
-- ⚠️ nursing_record = 처치 수행 내용(자유 서사·treatment_order_id 부착)과 일상 간호기록(오더 없음·NULL)을
--    단일 테이블이 담는다. treatment_order_id nullable = 오더 연결 선택(FR-094). treatment_orders 에는 내용
--    컬럼 없음(행위=fee_schedule_id FK 단일 진실) → "처치기록 내용"은 본 테이블 소유.
--
-- ⚠️ 신규 권한 nursing.record(일상 간호기록 게이트) = 0002 미존재 → INSERT + admin 부트 재grant **필수**
--    (0002 admin cross-join 은 후행 마이그 권한 자동 미포함 — 누락 시 test_admin_role_has_all_permissions 회귀;
--    0010·0012·0013·0014·0015 가 겪은 함정). nurse grant 1건은 seed.sql 소관.
--
-- ⚠️ content = 자유 임상 서사 → 감사 스냅샷 마스킹 **필수**(audit.py _SENSITIVE_KEY·audit.ts SENSITIVE_KEY 에
--    `content` 동반 추가 — 0017 vital_signs 수치는 구조화라 마스킹 무변경이었으나 본 자유텍스트는 변경 필요).
--
-- ⚠️ Epic 5 마이그 블록 = 0015~0029 고정(병렬 Epic 6 워크트리 0030~ 비침범). 0018 = nursing_records(0017 다음).
--
-- 의존: 0001(gen_random_uuid), 0002(users·roles·permissions·role_permissions), 0003(has_permission·order.read 헬퍼),
--   0004(audit_trigger_fn), 0009(patients — RLS self 경로), 0010(encounters FK), 0015(treatment_orders FK·order.read 권한).

-- ── nursing_record (간호기록 — 한 내원에 N건, 매 기록 = 새 행 append) ──────────
-- 처치 수행 내용(treatment_order_id 부착)·일상 간호기록(NULL). 추적 = 기록자(recorded_by)·시각.
-- vital_signs(0017) DDL 컨벤션 미러(uuid PK·encounter_id 1:N FK·timestamptz·is_active soft delete).
create table if not exists public.nursing_record (
  id                 uuid primary key default gen_random_uuid(),
  encounter_id       uuid not null references public.encounters (id),         -- 1:N(해당 내원에 연결)
  treatment_order_id uuid references public.treatment_orders (id),            -- nullable = 오더 연결 선택(FR-094 = NULL)
  content            text not null,                                           -- 간호기록/처치 수행 내용(자유 서사·감사 마스킹)
  recorded_by        uuid not null references public.users (id),              -- 기록 간호사(nursing.record / 처치 수행)
  recorded_at        timestamptz not null default now(),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- 빈/공백-only 내용 차단(DB 최종선; 클라 가드 1차선·서버 Pydantic min_length 2차선 — vital_signs_at_least_one 동형).
  constraint nursing_record_content_not_blank check (char_length(btrim(content)) >= 1)
);
create index if not exists idx_nursing_record_encounter_id       on public.nursing_record (encounter_id);
create index if not exists idx_nursing_record_treatment_order_id on public.nursing_record (treatment_order_id);
create index if not exists idx_nursing_record_recorded_at        on public.nursing_record (recorded_at);

-- ── 권한 카탈로그 확장(신규 nursing.record — 일상 간호기록 게이트) ──────────────────
-- treatment.perform(처치 수행)은 0002:96 기존(재시드 금지). 신규 = nursing.record(오더 없는 간호기록).
insert into public.permissions (code, name, resource, action) values
  ('nursing.record', '일상 간호기록', 'nursing', 'record')
on conflict (code) do nothing;

-- admin 부트 grant(신규 권한만; 비-admin grant 는 Story 1.7 매트릭스 UI 소관). 멱등.
-- ⚠️ 필수: 0002 admin cross-join 은 후행 마이그레이션 권한을 자동 포함하지 않는다(누락 시
--    test_admin_role_has_all_permissions 회귀 — 0010·0012·0013·0014·0015 가 겪은 함정).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'nursing.record'
where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;

-- ── 권한 posture(테이블 단위 GRANT — 민감 reveal 컬럼 없음, 0017 자세) ────────────────
revoke all on public.nursing_record from anon, authenticated;
grant select, insert, update, delete on public.nursing_record to service_role;  -- 쓰기 = service_role(FastAPI)
grant select on public.nursing_record to authenticated;                          -- RLS 행 게이트

-- ── RLS(방어심층 — FastAPI=service_role 가 RLS 우회하므로 조회 권위는 라우터 require_permission;
--    본 정책은 환자 포털 Supabase 직결 경로[Epic 8] + 일관성 대비) ──────────────────────
alter table public.nursing_record enable row level security;

-- 직원 = order.read(의사·간호·방사선 임상 컨텍스트 읽기) OR nursing.record(간호 기록자 read-back).
-- vital_signs_select_staff 미러(권한 코드만 활력→간호기록 도메인으로 치환).
drop policy if exists nursing_record_select_staff on public.nursing_record;
create policy nursing_record_select_staff on public.nursing_record
  for select to authenticated using (
    (select public.has_permission('order.read')) or (select public.has_permission('nursing.record'))
  );

-- 환자 = 본인 내원의 간호기록만(encounter → patient → auth_uid, 포털 Epic 8). vital_signs_select_self 미러.
drop policy if exists nursing_record_select_self on public.nursing_record;
create policy nursing_record_select_self on public.nursing_record
  for select to authenticated using (
    exists (
      select 1 from public.encounters e
      join public.patients p on p.id = e.patient_id
      where e.id = nursing_record.encounter_id and p.auth_uid = (select auth.uid())
    )
  );

-- 쓰기 정책 없음 = authenticated 의 INSERT/UPDATE/DELETE 거부(쓰기는 service_role/FastAPI 가 RLS 우회).

-- ── 감사 트리거 부착(0004 audit_trigger_fn 재사용 — append-only, actor 동반) ──────────
-- ⚠️ content = 자유 임상 서사 → 감사 스냅샷 마스킹 필수(audit.py·audit.ts 에 `content` 추가 — 본 마이그와 동반).
--    FK(encounter_id·treatment_order_id·recorded_by)·플래그·timestamp 는 구조화. id(uuid PK)=target_id 계약 충족.
drop trigger if exists trg_nursing_record_audit on public.nursing_record;
create trigger trg_nursing_record_audit after insert or update or delete on public.nursing_record
  for each row execute function public.audit_trigger_fn();
