-- 0014_encounter_diagnoses.sql — 내원진단(encounter_diagnoses) 부착·주/부상병 + 주상병 완료 게이트
-- Story 4.7 / FR-042(KCD 진단 부착·주/부진단 구분). UX-DR12(diagnosis-block)·UX-DR18(검증 422).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실). timestamptz=UTC. soft delete=is_active.
-- 불변식·감사는 DB 가 소유 — 쓰기/감사/권한 평가는 FastAPI(service_role) 또는 트리거가 강제.
--
-- ⚠️ 파일 번호 0014: 에픽 본문·아키텍처는 stale 번호 "0008_clinical.sql"(medical_records+encounter_diagnoses
--    합본)을 참조하나, 실제 적용분은 0001~0013(0013=medical_records SOAP)이다. 따라서 encounter_diagnoses
--    = 0014. glossary §185 의 계획 "0014_rls_policies.sql" 은 미실현(RLS 는 마스터/내원 관례대로 인라인).
--    0013:8 이 "encounter_diagnoses 는 Story 4.7 소유(별도 0014)"로 예약한 청산처.
--
-- ⚠️ 진단은 diagnosis_id(KCD diagnoses 마스터 FK)로만 부착 — free-text 컬럼 없음(UX-DR12 free-text 차단의
--    구조적 강제). 따라서 감사 스냅샷엔 FK·플래그만 유입(SOAP 자유텍스트와 달리 마스킹 불요 — 4.7 §결정 4).
--
-- 의존: 0001(gen_random_uuid), 0002(permissions·role_permissions·diagnosis.attach·encounter.complete 시드),
--   0003(has_permission), 0004(audit_trigger_fn + action CHECK), 0007(diagnoses KCD 마스터 FK),
--   0009(patients — RLS self 경로), 0010(encounters FK + complete_encounter — 본 파일이 게이트 추가 재정의).

-- ── encounter_diagnoses (내원진단 — 한 내원에 1:N, 주/부상병 구분) ──────────────────
create table if not exists public.encounter_diagnoses (
  id            uuid primary key default gen_random_uuid(),
  encounter_id  uuid not null references public.encounters (id),  -- 1:N(한 내원 복수 진단)
  diagnosis_id  uuid not null references public.diagnoses (id),   -- KCD 마스터 FK(free-text 차단의 구조적 강제)
  is_primary    boolean not null default false,    -- 주상병(true)/부상병(false). 활성 주상병 ≤1/내원(아래 부분 unique)
  recorded_by   uuid not null references public.users (id),       -- 부착 의사(FastAPI 가 jwt sub 로 세팅)
  is_active     boolean not null default true,     -- soft delete(제거=정정, 행·이력 보존)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_encounter_diagnoses_encounter_id on public.encounter_diagnoses (encounter_id);
create index if not exists idx_encounter_diagnoses_diagnosis_id on public.encounter_diagnoses (diagnosis_id);

-- ── DB 불변식(부분 unique — 강등은 FastAPI 가 동일 트랜잭션, 인덱스가 최종선) ──────────
-- ① 활성 주상병 ≤1/내원: 다른 진단을 주상병으로 토글하면 FastAPI 가 기존 주상병을 같은 txn 에서 강등(is_primary=false)
--    → 이 인덱스가 경합·버그의 최종 방어선(주진단은 정확히 1개로 수렴, UX-DR12·완료 게이트).
create unique index if not exists uq_encounter_diagnoses_primary
  on public.encounter_diagnoses (encounter_id) where is_primary and is_active;
-- ② 같은 KCD 코드 활성 중복 부착 차단(where is_active → 제거 후 재부착·동일코드 재사용 허용).
create unique index if not exists uq_encounter_diagnoses_dup
  on public.encounter_diagnoses (encounter_id, diagnosis_id) where is_active;

-- ── 권한 카탈로그 확장(0002 컨벤션 — 리소스 온라인 시 에픽 마이그레이션이 확장) ──────────
-- diagnosis.attach·encounter.complete 는 0002 에 이미 시드(재시드 금지). 조회 게이트 diagnosis.read 만 신규:
--   진단(KCD)은 건강민감(질환 노출) → 의사·관리자만 조회(encounter.read 재사용 시 원무·간호도 열람 → 최소권한 위반).
insert into public.permissions (code, name, resource, action) values
  ('diagnosis.read', '진단 조회', 'diagnosis', 'read')
on conflict (code) do nothing;

-- admin 부트 grant(신규 권한만; 비-admin grant 는 Story 1.7 매트릭스 UI 소관). 멱등.
-- ⚠️ 필수: 0002 admin cross-join 은 후행 마이그레이션 권한을 자동 포함하지 않는다(누락 시
--    test_admin_role_has_all_permissions 회귀 — 0010·0012·0013 이 겪은 함정).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'diagnosis.read'
where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;

-- ── 권한 posture(0013 패턴 — 민감 reveal 컬럼 없음 → 테이블 단위 GRANT) ────────────────────
revoke all on public.encounter_diagnoses from anon, authenticated;
grant select, insert, update, delete on public.encounter_diagnoses to service_role;
-- authenticated = SELECT(RLS 행 게이트). 쓰기는 service_role(FastAPI) 경유.
grant select on public.encounter_diagnoses to authenticated;

-- ── RLS(방어심층 — service_role/FastAPI 쓰기에도 유지, 별도 RLS 파일 없이 인라인) ──────
alter table public.encounter_diagnoses enable row level security;

-- 직원 = diagnosis.read 권한 보유 시 전체 행(의사·관리자만 — encounter.read 가 아님, 임상 경계).
drop policy if exists encounter_diagnoses_select_staff on public.encounter_diagnoses;
create policy encounter_diagnoses_select_staff on public.encounter_diagnoses
  for select to authenticated using ((select public.has_permission('diagnosis.read')));

-- 환자 = 본인 내원의 진단만(encounter → patient → auth_uid 경유, 포털 Epic 8). medical_records_select_self 미러.
drop policy if exists encounter_diagnoses_select_self on public.encounter_diagnoses;
create policy encounter_diagnoses_select_self on public.encounter_diagnoses
  for select to authenticated using (
    exists (
      select 1
      from public.encounters e
      join public.patients p on p.id = e.patient_id
      where e.id = encounter_diagnoses.encounter_id and p.auth_uid = (select auth.uid())
    )
  );

-- 쓰기 정책 없음 = authenticated 의 INSERT/UPDATE/DELETE 거부(쓰기는 service_role 가 RLS 우회).

-- ── 감사 트리거 부착(0004 audit_trigger_fn 재사용 — 부착·강등·제거가 actor 와 함께 append-only 기록) ──
-- id(uuid PK) 보유 → target_id = coalesce(after->>'id', before->>'id') 계약 충족(0004:63).
-- 스냅샷 컬럼 = diagnosis_id(FK)·is_primary·recorded_by·is_active·타임스탬프 = 비-자유텍스트 →
--    3.6 마스킹 집합 변경 불요(encounter_id·patient_id 와 동일한 FK posture, 4.7 §결정 4).
drop trigger if exists trg_encounter_diagnoses_audit on public.encounter_diagnoses;
create trigger trg_encounter_diagnoses_audit after insert or update or delete on public.encounter_diagnoses
  for each row execute function public.audit_trigger_fn();

-- ── complete_encounter 재정의 — 주상병(is_primary) 미지정 완료 차단 게이트 추가(Story 4.7) ──────
-- 0010:164~190 본문 보존 + 게이트 1개 추가(마이그레이션 forward-only — 0010 버전을 0014 가 대체).
-- ⚠️ encounter_diagnoses 테이블 생성 뒤에 정의(함수가 해당 테이블 참조). EXECUTE grant(0010:273
--    authenticated+service_role)는 create or replace 가 보존 → 재grant 불요.
create or replace function public.complete_encounter(p_encounter_id uuid)
returns public.encounters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.encounters;
begin
  if not public.has_permission('encounter.complete') then
    raise exception 'permission denied: encounter.complete' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.encounters where id = p_encounter_id for update;
  if not found then
    raise exception 'encounter not found: %', p_encounter_id using errcode = 'PT404';
  end if;
  if v_row.status <> 'in_progress' then  -- 소스 상태 선검사(same-status no-op·재수행 차단, NFR-040)
    raise exception 'invalid encounter transition: % -> completed', v_row.status using errcode = 'PT409';
  end if;
  -- ★ 주상병 게이트(FR-042·UX-DR18, 4.7 신설): 활성 주상병(is_primary=true) ≥1개 없으면 완료 차단.
  --   PT422 = 신규 커스텀 SQLSTATE(코어 미사용 'PT' 클래스 — PT404/PT409 동류) → FastAPI 422 매핑.
  if not exists (
    select 1 from public.encounter_diagnoses
    where encounter_id = p_encounter_id and is_primary = true and is_active = true
  ) then
    raise exception 'primary diagnosis required for completion: %', p_encounter_id using errcode = 'PT422';
  end if;
  update public.encounters
     set status = 'completed', completed_at = now(), updated_at = now()
   where id = p_encounter_id
   returning * into v_row;
  return v_row;
end;
$$;
