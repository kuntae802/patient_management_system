-- 0013_medical_records.sql — SOAP 진료기록(medical_records) + RLS·감사
-- Story 4.6 / FR-040(SOAP 형식 작성·저장), FR-041(한 내원 1:N 진료기록), FR-242(조회=감사).
-- UX-DR11(soap-ledger). 식별자 영문 snake_case(docs/glossary.md 단일 진실). timestamptz=UTC. soft delete=is_active.
-- 불변식·감사는 DB 가 소유 — 쓰기/감사/권한 평가는 FastAPI(service_role) 또는 트리거가 강제.
--
-- ⚠️ 파일 번호 0013: 에픽 본문·아키텍처는 stale 번호 "0008_clinical.sql"(medical_records+encounter_diagnoses 합본)을
--    참조하나, 실제 적용분은 0001~0012(마지막 0012_patient_reveal)다. 따라서 medical_records = 0013.
--    스토리별 마이그레이션 원칙상 본 파일 = SOAP medical_records 만; encounter_diagnoses(주/부상병·diagnosis.attach)
--    는 Story 4.7 소유(별도 0014). 0010:52~53 이 encounters 에 자유텍스트 컬럼을 의도적으로 회피한 이유의 청산처.
--
-- 의존: 0001(gen_random_uuid), 0002(permissions·role_permissions·medical_record.write 시드),
--   0003(has_permission), 0004(audit_trigger_fn + action CHECK), 0009(patients — RLS self 경로), 0010(encounters FK).

-- ── medical_records (SOAP 진료기록 — 한 내원에 1:N, 의사가 작성) ──────────────────
create table if not exists public.medical_records (
  id           uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounters (id),  -- 1:N(한 내원 복수 기록) — ON DELETE 미지정(RESTRICT)
  author_id    uuid not null references public.users (id),       -- 작성 의사(FastAPI 가 jwt sub 로 세팅)
  -- SOAP 4 파트(전부 nullable — 일부만 채운 기록 허용·실제 차팅 현실). PII/건강민감 자유텍스트 →
  -- 감사 스냅샷 마스킹 대상(services/audit.py _SENSITIVE_KEY · web audit.ts SENSITIVE_KEY 양쪽 등록, Story 3.6).
  subjective   text,   -- S 주관적(환자 호소·증상)
  objective    text,   -- O 객관적(검진·검사 소견)
  assessment   text,   -- A 평가(임상 판단·진단 소견)
  plan         text,   -- P 계획(처방·교육·추적)
  is_active    boolean not null default true,      -- soft delete 일관성
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_medical_records_encounter_id on public.medical_records (encounter_id);
create index if not exists idx_medical_records_author_id    on public.medical_records (author_id);

-- ── 권한 카탈로그 확장(0002 컨벤션 — 리소스 온라인 시 에픽 마이그레이션이 확장) ──────────
-- medical_record.write 는 0002 에 이미 시드(재시드 금지). 조회 게이트 medical_record.read 만 신규:
--   의사 임상 SOAP 는 의사·관리자만 조회(encounter.read 재사용 시 원무·간호도 열람 → 최소권한 위반).
insert into public.permissions (code, name, resource, action) values
  ('medical_record.read', '진료기록 조회', 'medical_record', 'read')
on conflict (code) do nothing;

-- admin 부트 grant(신규 권한만; 비-admin grant 는 Story 1.7 매트릭스 UI 소관). 멱등.
-- ⚠️ 필수: 0002 admin cross-join 은 후행 마이그레이션 권한을 자동 포함하지 않는다(누락 시
--    test_admin_role_has_all_permissions 회귀 — 0010·0012 가 겪은 함정).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'medical_record.read'
where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;

-- ── 권한 posture(0010 패턴 — 민감 reveal 컬럼 없음 → 테이블 단위 GRANT) ────────────────────
revoke all on public.medical_records from anon, authenticated;
grant select, insert, update, delete on public.medical_records to service_role;
-- authenticated = SELECT(RLS 행 게이트). 쓰기는 service_role(FastAPI) 경유.
grant select on public.medical_records to authenticated;

-- ── RLS(방어심층 — service_role/FastAPI 쓰기에도 유지, 별도 RLS 파일 없이 인라인) ──────
alter table public.medical_records enable row level security;

-- 직원 = medical_record.read 권한 보유 시 전체 행(의사·관리자만 — encounter.read 가 아님, 임상 경계).
drop policy if exists medical_records_select_staff on public.medical_records;
create policy medical_records_select_staff on public.medical_records
  for select to authenticated using ((select public.has_permission('medical_record.read')));

-- 환자 = 본인 내원의 진료기록만(encounter → patient → auth_uid 경유, 포털 Epic 8). encounters_select_self 미러.
drop policy if exists medical_records_select_self on public.medical_records;
create policy medical_records_select_self on public.medical_records
  for select to authenticated using (
    exists (
      select 1
      from public.encounters e
      join public.patients p on p.id = e.patient_id
      where e.id = medical_records.encounter_id and p.auth_uid = (select auth.uid())
    )
  );

-- 쓰기 정책 없음 = authenticated 의 INSERT/UPDATE/DELETE 거부(쓰기는 service_role 가 RLS 우회).

-- ── 감사 트리거 부착(0004 audit_trigger_fn 재사용 — 작성·갱신·삭제가 actor 와 함께 append-only 기록) ──
-- id(uuid PK) 보유 → target_id = coalesce(after->>'id', before->>'id') 계약 충족(0004:63).
-- ⚠️ SOAP 자유텍스트(subjective/objective/assessment/plan)가 before/after 스냅샷에 최초 유입 →
--    읽기시점 마스킹(3.6)이 이 4 컬럼명을 _SENSITIVE_KEY/SENSITIVE_KEY 에 등록해야 평문 누출 차단.
drop trigger if exists trg_medical_records_audit on public.medical_records;
create trigger trg_medical_records_audit after insert or update or delete on public.medical_records
  for each row execute function public.audit_trigger_fn();
