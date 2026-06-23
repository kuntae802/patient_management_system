-- 0047_payment_pricing.sql — 본인부담률 정책(copay_policies) + 본인부담 산정 함수(price_payment)
-- Story 7.3 / FR-111(급여/비급여 구분·보험유형별 본인부담금 산정), NFR-041(트랜잭션 원자성).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실). 금액=KRW 정수(소수 없음·copay_rate 만 numeric). timestamptz=UTC.
-- 불변식·산정 로직은 DB 가 소유 — 수가/정산 로직을 Python/TS 에 재구현 금지(project-context).
--
-- ⚠️ 파일 번호 0047: Epic 7 마이그 블록 0045~0059(0046_payment_aggregation 다음).
--
-- ── 산정 레이어(0045 컬럼 선언 → 0046 라인 적재 → 0047 본인부담 산정) ──
--   7.1(0045) = payment_details.copay_rate/copay_amount_krw/insurer_amount_krw 컬럼 선언(값 0/NULL).
--   7.2(0046) = build_payment 가 라인 적재 + 헤더 total/covered/non_covered 롤업(copay/insurer=0 유지).
--   본 스토리(7.3) = price_payment 가 라인 copay/insurer 산정 + 헤더 copay/insurer 롤업.
--   **finalize·결제·내원완료=7.4 · 문서(계산서·세부내역서·처방전)=7.5~7.7.**
--
-- ── 설계 결정 4건(사용자 확정 2026-06-23·AskUserQuestion) ──
--   ① 본인부담률: 급여=건강보험 0.300/의료급여 0.150/자보 0.000/일반 1.000 · 비급여=전 유형 1.000.
--   ② 요율 저장 = copay_policies 정책 테이블(보험유형×급여구분→rate)·price_payment 가 JOIN.
--      ⚠️ 요율 8행은 본 마이그레이션에 임베드(운영 필수 참조데이터 — seed.sql[dev 전용] 아님·permissions 부트 패턴).
--   ③ 산정 시점 = 집계에 이어 자동(POST .../payment 가 build_payment→price_payment 원자 호출·새 엔드포인트 0).
--   ④ 본인부담금 10원 미만 절사·insurer=차액 흡수(라인 amount=copay+insurer 정합).
--   미구현(단순화 선·이월): 산정특례·연령별·의료급여 정액제·30일 재진규칙·진료과/시간대 가산.
--
-- 의존: 0001(gen_random_uuid), 0009(patients.insurance_type — 산정 입력),
--   0010(encounters·patient_id), 0045(payments·payment_details·copay 컬럼·amount CHECK),
--   0046(build_payment — price_payment 가 미러: SECURITY DEFINER·change-guard·EXECUTE 회수).

-- ════════════════════════════════════════════════════════════════════════════
-- Task 1 — 본인부담률 정책 테이블 copay_policies + 시드(마이그 임베드)
-- ════════════════════════════════════════════════════════════════════════════

-- 보험유형 × 급여구분 → 본인부담률(0~1) 단일 진실. price_payment 가 라인별로 JOIN.
-- 비급여(non_covered)는 보험유형 무관 환자 전액(1.000) — 전 유형 행을 명시 시드(함수 = 순수 JOIN·특례 분기 0).
create table if not exists public.copay_policies (
  id             uuid primary key default gen_random_uuid(),
  insurance_type text not null
                   check (insurance_type in ('health_insurance', 'medical_aid',
                                             'auto_insurance', 'self_pay')),
  coverage_type  text not null check (coverage_type in ('covered', 'non_covered')),
  copay_rate     numeric(4,3) not null check (copay_rate between 0 and 1),  -- 본인부담률(예 0.300)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (insurance_type, coverage_type)  -- 보험유형×급여구분 단일 요율(price_payment JOIN 결정성)
);

-- ── 요율 시드(마이그 임베드 — 운영 필수 참조데이터·permissions 부트 동형·멱등) ──────────
-- ⚠️ seed.sql(로컬 db reset 전용·운영 미반영) 아님: price_payment 정확성이 전 환경에서 본 행에 의존
--    (정책 미존재 시 price_payment 가 1.0 폴백 = 전 환자 100% 과청구). 시스템 불변식 = 마이그레이션.
insert into public.copay_policies (insurance_type, coverage_type, copay_rate) values
  ('health_insurance', 'covered',     0.300),  -- 건강보험 급여 본인부담 30%(의원 외래 단순화 선)
  ('medical_aid',      'covered',     0.150),  -- 의료급여 급여 본인부담 15%(정액제 미적용 — 단순화)
  ('auto_insurance',   'covered',     0.000),  -- 자동차보험 급여 = 보험사 전액(본인부담 0)
  ('self_pay',         'covered',     1.000),  -- 일반(무보험) 급여 = 전액 본인
  ('health_insurance', 'non_covered', 1.000),  -- 비급여 = 보험유형 무관 환자 전액
  ('medical_aid',      'non_covered', 1.000),
  ('auto_insurance',   'non_covered', 1.000),
  ('self_pay',         'non_covered', 1.000)
on conflict (insurance_type, coverage_type) do nothing;

-- ── 권한·RLS(비민감 요율 참조 — 마스터 posture) ──────────────────────────────
-- 요율은 비-PII(보험유형·급여구분·숫자) → 전 직원 조회 가능. 쓰기 없음(요율 변경=마이그레이션·본 스토리 관리 UI 없음).
revoke all on public.copay_policies from anon, authenticated;
grant select on public.copay_policies to authenticated, service_role;
alter table public.copay_policies enable row level security;
drop policy if exists copay_policies_select on public.copay_policies;
create policy copay_policies_select on public.copay_policies
  for select to authenticated using (true);
-- 쓰기 정책 없음 = authenticated INSERT/UPDATE/DELETE 거부(요율은 마이그/시드 소유).

-- ════════════════════════════════════════════════════════════════════════════
-- Task 2 — 본인부담 산정 함수 price_payment(라인 copay/insurer 산정 + 헤더 롤업)
-- ════════════════════════════════════════════════════════════════════════════

-- 한 내원의 draft 수납 건 라인에 본인부담을 산정한다(환자 insurance_type 기준):
--   라인 rate = copay_policies(보험유형, 급여구분) → 미존재 시 1.0(보수적 100% 환자·미청구 방지).
--   copay  = rate>=1 ? amount(전액 본인) : rate<=0 ? 0(전액 공단) : floor(amount*rate/10)*10(10원 절사).
--     ⚠️ 절사 가드: rate=1.0/0.0 분기 필수 — 절사로 인한 1원 누락·self_pay 잔돈 공단부담 차단.
--   insurer = amount - copay(차액 흡수 → 라인 amount=copay+insurer 항상 성립).
-- 멱등·change-guard: 변경된 라인만 UPDATE(재진입·미변경 = 트리거 미발화·감사 노이즈 0·build_payment 동형).
-- 상태 가드: status≠'draft'(finalized/cancelled) = 본인부담 동결(7.4 후 불변). 헤더 없음 = return null(빌드 전).
create or replace function public.price_payment(p_encounter_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id     uuid;
  v_status         text;
  v_insurance_type text;
  v_copay          integer;
  v_insurer        integer;
begin
  -- 헤더 + 환자 보험유형 룩업(payments → encounters → patients).
  select pay.id, pay.status, pat.insurance_type
    into v_payment_id, v_status, v_insurance_type
    from public.payments pay
    join public.encounters e on e.id = pay.encounter_id
    join public.patients pat on pat.id = e.patient_id
   where pay.encounter_id = p_encounter_id;

  if v_payment_id is null then
    return null;  -- 빌드 전(헤더 없음) = 산정 대상 없음(build_payment 가 선행 생성)
  end if;

  if v_status is distinct from 'draft' then
    return v_payment_id;  -- finalize/cancel 후 본인부담 동결(7.4 결정 보존)
  end if;

  -- 라인별 산정(정책 JOIN·10원 절사·insurer 차액·change-guard).
  update public.payment_details pd set
    copay_rate         = t.rate,
    copay_amount_krw   = t.copay,
    insurer_amount_krw = t.insurer,
    updated_at         = now()
  from (
    -- 외층: insurer = amount - copay(차액 흡수). 내층: rate·copay 산정(정책 JOIN·절사 가드).
    select c.id, c.rate, c.copay, (c.amount_krw - c.copay) as insurer
    from (
      select d.id, d.amount_krw,
             coalesce(cp.copay_rate, 1.0) as rate,
             case
               when coalesce(cp.copay_rate, 1.0) >= 1 then d.amount_krw                      -- 전액 본인(self_pay·비급여)
               when coalesce(cp.copay_rate, 1.0) <= 0 then 0                                 -- 전액 공단(자보)
               else (floor(d.amount_krw * coalesce(cp.copay_rate, 1.0) / 10) * 10)::integer  -- 10원 절사 본인부담
             end as copay
        from public.payment_details d
        left join public.copay_policies cp
          on cp.insurance_type = v_insurance_type
         and cp.coverage_type = d.coverage_type
       where d.payment_id = v_payment_id
    ) c
  ) t
  where pd.id = t.id
    and (pd.copay_rate, pd.copay_amount_krw, pd.insurer_amount_krw)
        is distinct from (t.rate, t.copay, t.insurer);  -- 변경된 라인만(감사 노이즈 방지)

  -- 헤더 본인부담/공단부담 롤업(라인 합) — change-guard. 결과 불변식: total = copay + insurer.
  select coalesce(sum(copay_amount_krw), 0), coalesce(sum(insurer_amount_krw), 0)
    into v_copay, v_insurer
    from public.payment_details where payment_id = v_payment_id;

  update public.payments set
    copay_amount_krw   = v_copay,
    insurer_amount_krw = v_insurer,
    updated_at         = now()
  where id = v_payment_id
    and (copay_amount_krw, insurer_amount_krw) is distinct from (v_copay, v_insurer);

  return v_payment_id;
end;
$$;

-- EXECUTE posture(0046 build_payment 동형) — service_role/FastAPI 만 호출. authenticated 직접 호출
--   차단(산정=쓰기 명령·권한은 FastAPI require_permission('payment.manage') + db has_permission 재평가가 게이트).
revoke all on function public.price_payment(uuid) from public, anon, authenticated;
grant execute on function public.price_payment(uuid) to service_role;
