-- 0017_nursing.sql — 간호 활력징후 기록(vital_signs) 테이블 + RLS·GRANT·감사.
-- Story 5.6 / FR-091(활력징후 측정·기록 전용 기록), FR-032(의사 진료 허브 좌 컨텍스트 패널 활력 표시 연동).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실 — vital_signs 기등재). timestamptz=UTC 저장. soft delete=is_active.
-- 한국어는 UI 라벨·주석만.
--
-- ⚠️ 권한: vital.record 는 **0002 기존 권한**(0002:97 시드 — admin 0002 cross-join 보유). 신규 permissions INSERT
--    없음·admin 부트 재grant 불요(5.2 prescription.create posture — "신규 권한 0"). nurse grant 1건은 seed.sql 소관.
--    → test_admin_role_has_all_permissions 회귀 0(0010/0014 가 겪은 "신규권한→admin 재grant" 함정 비해당).
--
-- ⚠️ 활력 필드 = 항목별 선택(부분 측정 허용·실제 임상) + **최소 1개 측정값 강제**(전부 NULL 차단 = DB 최종선).
--    3중 방어: 클라 Zod(제출 disable) → 서버 Pydantic model_validator(422) → DB CHECK(vital_signs_at_least_one).
--    처방 details min_length=1(빈 처방전 무의미) 패턴 동형. DB 범위 CHECK = 물리적 안전망(넓게); 임상 정상범위
--    표시·입력 합리성은 표시 레이어(isAbnormal)·Pydantic Field 가 담당.
--
-- ⚠️ 일상 간호기록(nursing_record)·처치 수행·재수행 차단 = Story 5.7 소유(glossary §처치·5.4 경계). 본 파일은
--    vital_signs 만. 활력 수정/삭제·시계열 차트·오더-by-내원상태 게이트 = 이월(스토리 §스코프 경계).
--
-- ⚠️ Epic 5 마이그 블록 = 0015~0029 고정(병렬 Epic 6 워크트리 0030~ 비침범). 0017 = nursing(0015 헤더 예고).
--
-- 의존: 0001(gen_random_uuid), 0002(users·vital.record 시드), 0003(has_permission·encounter.read 헬퍼),
--   0004(audit_trigger_fn), 0009(patients — RLS self 경로), 0010(encounters FK).

-- ── vital_signs (활력징후 전용 기록 — 한 내원에 N건, 매 측정 = 새 행 append) ──────────
-- 혈압(수축기/이완기)·맥박·체온·호흡수·SpO2 = 항목별 nullable(부분 측정). 추적 = 기록자(recorded_by)·시각.
-- examinations(0015) DDL 컨벤션 미러(uuid PK·encounter_id 1:N FK·timestamptz·is_active soft delete).
create table if not exists public.vital_signs (
  id               uuid primary key default gen_random_uuid(),
  encounter_id     uuid not null references public.encounters (id),  -- 1:N(해당 내원에 연결, FR-091)
  systolic         integer,        -- 수축기 혈압 mmHg
  diastolic        integer,        -- 이완기 혈압 mmHg
  pulse            integer,        -- 맥박 bpm
  body_temp        numeric(4,1),   -- 체온 °C(소수 1자리)
  respiratory_rate integer,        -- 호흡수 /min
  spo2             integer,        -- 산소포화도 %
  notes            text,           -- 임상 주석(선택; PII 금지 — 구조화 활력 메모 수준)
  recorded_by      uuid not null references public.users (id),       -- 기록 간호사(vital.record)
  recorded_at      timestamptz not null default now(),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- 범위 CHECK = 물리적 안전망(말이 안 되는 값만 차단; 임상 정상범위 ≠ DB 한계). null 허용(미측정).
  constraint vital_signs_systolic_range  check (systolic is null or (systolic between 50 and 300)),
  constraint vital_signs_diastolic_range check (diastolic is null or (diastolic between 20 and 200)),
  constraint vital_signs_pulse_range     check (pulse is null or (pulse between 20 and 300)),
  constraint vital_signs_temp_range      check (body_temp is null or (body_temp between 30.0 and 45.0)),
  constraint vital_signs_resp_range      check (respiratory_rate is null or (respiratory_rate between 4 and 80)),
  constraint vital_signs_spo2_range      check (spo2 is null or (spo2 between 50 and 100)),
  -- 최소 1개 측정값 강제(빈 활력 행 무의미 — DB 최종선; 클라·Pydantic 1·2차선).
  constraint vital_signs_at_least_one    check (
    systolic is not null or diastolic is not null or pulse is not null
    or body_temp is not null or respiratory_rate is not null or spo2 is not null
  )
);
create index if not exists idx_vital_signs_encounter_id on public.vital_signs (encounter_id);
create index if not exists idx_vital_signs_recorded_at  on public.vital_signs (recorded_at);

-- ── 권한 posture(테이블 단위 GRANT — 민감 reveal 컬럼 없음, 0015 자세) ────────────────
-- vital.record 는 0002 기존 권한 → permissions INSERT·admin 재grant 불요(헤더 ⚠️ 참조).
revoke all on public.vital_signs from anon, authenticated;
grant select, insert, update, delete on public.vital_signs to service_role;  -- 쓰기 = service_role(FastAPI)
grant select on public.vital_signs to authenticated;                          -- RLS 행 게이트

-- ── RLS(방어심층 — FastAPI=service_role 가 RLS 우회하므로 조회 권위는 라우터 require_permission;
--    본 정책은 환자 포털 Supabase 직결 경로[Epic 8] + 일관성 대비) ──────────────────────
alter table public.vital_signs enable row level security;

-- 직원 = encounter.read(의사 진료 허브 좌 패널·FR-032) OR vital.record(간호 기록자 read-back). order.read 와
-- 별개 — 활력은 임상 컨텍스트 읽기(encounter.read)와 간호 기록 권한(vital.record) 양쪽이 본다.
drop policy if exists vital_signs_select_staff on public.vital_signs;
create policy vital_signs_select_staff on public.vital_signs
  for select to authenticated using (
    (select public.has_permission('encounter.read')) or (select public.has_permission('vital.record'))
  );

-- 환자 = 본인 내원의 활력만(encounter → patient → auth_uid, 포털 Epic 8). examinations_select_self 미러.
drop policy if exists vital_signs_select_self on public.vital_signs;
create policy vital_signs_select_self on public.vital_signs
  for select to authenticated using (
    exists (
      select 1 from public.encounters e
      join public.patients p on p.id = e.patient_id
      where e.id = vital_signs.encounter_id and p.auth_uid = (select auth.uid())
    )
  );

-- 쓰기 정책 없음 = authenticated 의 INSERT/UPDATE/DELETE 거부(쓰기는 service_role/FastAPI 가 RLS 우회).

-- ── 감사 트리거 부착(0004 audit_trigger_fn 재사용 — append-only, actor 동반) ──────────
-- 스냅샷 컬럼 = FK(encounter_id·recorded_by)·숫자(활력 수치)·플래그·timestamp = 비-자유텍스트 → 3.6 마스킹
-- 집합(_SENSITIVE_KEY) 변경 불요. notes(짧은 구조화 활력 메모)는 PII 금지 전제 → 마스킹 추가 보류(0015
-- 자유서사 회피 자세 계승; RRN/PII 미포함). id(uuid PK) 보유 → target_id 계약 충족(0004:63).
drop trigger if exists trg_vital_signs_audit on public.vital_signs;
create trigger trg_vital_signs_audit after insert or update or delete on public.vital_signs
  for each row execute function public.audit_trigger_fn();
