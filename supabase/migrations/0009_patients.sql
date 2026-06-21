-- 0009_patients.sql — patients(+임상 프로필, resident_no 암호화 3컬럼) + guardians + RLS·감사
-- Story 3.1 / FR-002(원무 직접 등록·auth_uid 미설정), FR-003(HMAC 중복 매칭), FR-240(RLS 본인/역할).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실). timestamptz=UTC 저장. soft delete=is_active.
-- 불변식·감사는 DB 가 소유. 암복호·HMAC 프리미티브는 0005_crypto.sql 재사용(여기서 재선언 금지).
--
-- ⚠️ 파일 번호 0009: 0005(crypto)·0006/0007(마스터)·0008(코드 CI unique)가 0005~0008 을 소진했다
--    (glossary.md §마이그레이션 번호 변이). 아키텍처 계획 맵의 "0006_patients"·"0014_rls_policies" 는
--    드리프트 — patients 는 0009, RLS 는 본 파일에 인라인(0006/0007 마스터와 동일 관례, 별도 RLS 파일 없음).
--
-- 주민번호 보안 모델(0005_crypto.sql 소비):
--   * resident_no_enc(bytea)  = encrypt_sensitive(raw)         — 평문 미저장, 복호는 service_role RPC 만.
--   * resident_no_hash(text)  = blind_index(normalize_rrn(raw)) — 결정적 HMAC, UNIQUE 로 중복 차단(FR-003).
--   * resident_no_masked(text)= mask_rrn(raw) = '710314-2******' — 비민감 표시값(읽기 시 복호 불요).
--   FastAPI(service_role)가 위 3값을 한 트랜잭션에서 채운다. 함수형 인덱스 금지(blind_index 는 Vault 읽어 IMMUTABLE 불가).
--
-- 의존: 0001(pgcrypto/gen_random_uuid), 0003(has_permission), 0004(audit_trigger_fn), 0005(crypto 프리미티브).

-- ── chart_no 시퀀스(사람용 식별자 — race-free DB 부여, PII 아님·라우트 안전) ─────
-- chart_no = 8자리 zero-pad(예 00000001). 앱이 아니라 DB 가 부여(경쟁 조건 차단). 사람용 번호는
-- PK(uuid)와 별개(architecture §Naming "사람용 번호는 별도").
create sequence if not exists public.patients_chart_no_seq;

-- ── patients (환자 — 원무 직접 등록 + 앱 자가가입 공용) ───────────────────────────
create table if not exists public.patients (
  id                uuid primary key default gen_random_uuid(),
  chart_no          text not null unique
                      default lpad(nextval('public.patients_chart_no_seq')::text, 8, '0'),
  name              text not null,
  birth_date        date not null,                 -- 검증된 주민번호에서 서버가 파생(입력 불일치 제거)
  sex               text not null check (sex in ('male', 'female')),  -- 주민번호 성별자리에서 파생
  -- 주민번호 3컬럼(0005 프리미티브 소비) — raw 평문은 어디에도 저장하지 않는다.
  resident_no_enc   bytea not null,                -- encrypt_sensitive(raw) 암호문
  resident_no_hash  text not null,                 -- blind_index(normalize_rrn(raw)) — UNIQUE 중복 차단
  resident_no_masked text not null,                -- mask_rrn(raw) 표시값(비민감)
  -- 연락·행정(평문 PII — reveal 게이트 대상 아님: 직원 patient.read 로 조회, 환자 본인 조회).
  phone             text,
  address           text,
  email             text,
  insurance_type    text not null
                      check (insurance_type in ('health_insurance', 'medical_aid',
                                                'auto_insurance', 'self_pay')),
  insurance_no      text,
  -- 임상 프로필(컬럼은 본 마이그레이션에서 생성, 입력·조회 UI 는 Story 3.2 — 여기선 전부 nullable).
  blood_type        text,
  allergies         text,
  chronic_diseases  text,
  medications       text,
  notes             text,
  -- 분리 프로필: 원무 직접 등록 환자는 auth 계정 없음 → NULL. 앱 자가가입(3.4) 시 설정 → RLS 본인행 앵커.
  auth_uid          uuid references auth.users (id) on delete set null,
  is_active         boolean not null default true,  -- soft delete(물리 삭제 금지 — 진료·법적 보존)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 중복 매칭(FR-003): resident_no_hash 컬럼 UNIQUE(식 인덱스 아님 — blind_index 는 IMMUTABLE 불가).
create unique index if not exists idx_patients_resident_no_hash on public.patients (resident_no_hash);
-- 본인행 RLS 조회(auth_uid)·향후 검색(name) 보조 인덱스.
create index if not exists idx_patients_auth_uid on public.patients (auth_uid);
create index if not exists idx_patients_name on public.patients (name);

-- ── guardians (보호자 — 테이블만 생성, 입력 UI 는 Story 3.3) ──────────────────────
-- 환자 1:N 보호자. on delete cascade: 환자 hard delete 는 없으나(soft delete), 정합상 명시.
create table if not exists public.guardians (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients (id) on delete cascade,
  name         text not null,
  relationship text not null,                       -- 관계(예: 자녀·배우자) — 표시명, enum 미강제
  phone        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_guardians_patient_id on public.guardians (patient_id);

-- ── 권한 posture(컬럼 레벨 — 민감 컬럼 방어심층) ──────────────────────────────────
-- 쓰기 = FastAPI(service_role). 읽기 = FastAPI 가 마스킹 컬럼만 투영(서버 권위). authenticated 직접
-- 조회(환자 포털 본인·직원 RLS)에도 resident_no_enc/_hash 는 **컬럼 GRANT 에서 제외** → RLS(행)에
-- 더해 컬럼(열)까지 이중 차단(클라가 암호문·HMAC 를 끌어갈 수 없다). anon 전면 차단.
revoke all on public.patients, public.guardians from anon, authenticated;
grant select, insert, update, delete on public.patients, public.guardians to service_role;
grant usage on sequence public.patients_chart_no_seq to service_role;
-- authenticated 는 비민감/마스킹 컬럼만 SELECT(resident_no_enc·resident_no_hash 제외).
grant select (
  id, chart_no, name, birth_date, sex, resident_no_masked,
  phone, address, email, insurance_type, insurance_no,
  blood_type, allergies, chronic_diseases, medications, notes,
  auth_uid, is_active, created_at, updated_at
) on public.patients to authenticated;
grant select on public.guardians to authenticated;  -- guardians 는 암호화 컬럼 없음(보호자 PII reveal=미래)

-- ── RLS(방어심층 — service_role/FastAPI 쓰기에도 유지, FR-240) ────────────────────
alter table public.patients  enable row level security;
alter table public.guardians enable row level security;

-- 환자 = 본인 행만((select auth.uid()) = auth_uid). 원무 등록 환자(auth_uid=NULL)는 본인 매칭 없음
-- → 앱 자가가입(3.4)으로 auth_uid 설정 시 본인 포털(Epic 8)에서 조회 가능. initplan 캐싱((select ...)).
drop policy if exists patients_select_self on public.patients;
create policy patients_select_self on public.patients
  for select to authenticated using ((select auth.uid()) = auth_uid);

-- 직원 = patient.read 권한 보유 시 전체 행(SECURITY DEFINER 헬퍼로 조인 RLS 회피, 0003).
drop policy if exists patients_select_staff on public.patients;
create policy patients_select_staff on public.patients
  for select to authenticated using ((select public.has_permission('patient.read')));

-- 쓰기 정책 없음 = authenticated 의 INSERT/UPDATE/DELETE 거부(쓰기는 service_role 이 RLS 우회).

-- guardians: 직원(patient.read) 또는 본인(환자 행 경유) 조회.
drop policy if exists guardians_select_staff on public.guardians;
create policy guardians_select_staff on public.guardians
  for select to authenticated using ((select public.has_permission('patient.read')));

drop policy if exists guardians_select_self on public.guardians;
create policy guardians_select_self on public.guardians
  for select to authenticated using (
    exists (
      select 1 from public.patients p
      where p.id = guardians.patient_id and p.auth_uid = (select auth.uid())
    )
  );

-- ── 감사 트리거 부착(0004 audit_trigger_fn 재사용) ────────────────────────────────
-- 두 테이블 모두 id 컬럼 보유 → target_id = coalesce(after->>'id', before->>'id') 계약 충족(1.3 이월).
-- ⚠️ 스냅샷(before/after jsonb)에 resident_no_enc 는 암호문(bytea→hex)이라 평문 RRN 부재(PII 경계).
--    name/phone/address 평문 PII 는 스냅샷에 포함되나 audit_logs 는 admin(audit.read)만 + 뷰어 렌더
--    마스킹(1.10) — 서버측 감사 PII 정책 보강은 교차절단 추적 항목(deferred-work.md, A-3).
drop trigger if exists trg_patients_audit on public.patients;
create trigger trg_patients_audit after insert or update or delete on public.patients
  for each row execute function public.audit_trigger_fn();

drop trigger if exists trg_guardians_audit on public.guardians;
create trigger trg_guardians_audit after insert or update or delete on public.guardians
  for each row execute function public.audit_trigger_fn();
