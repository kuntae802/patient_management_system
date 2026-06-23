-- 0051_payment_prepay.sql — 선결제(prepay_payment) RPC + finalize 차액 정산 재정의
-- Story 7.8 / FR-117(수납 정책 후수납 기본/선수납 옵션), NFR-041(다단계 작업 트랜잭션 원자성).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실). 금액=KRW 정수(소수 없음). timestamptz=UTC.
-- 불변식·정산 로직은 DB 가 소유 — 수가/정산/상태머신 로직을 Python/TS 에 재구현 금지(project-context).
--
-- ⚠️ 파일 번호 0051: Epic 7 마이그 블록 0045~0059(0050_prescription_dispense 다음).
--
-- ── 선후수납 레이어(0045 컬럼 선언 → 0046 적재 → 0047 산정 → 0048 결제·완료 → 0051 선후수납) ──
--   7.1(0045) = payments.billing_type(postpaid/prepaid)·paid_amount_krw 컬럼 선언만(값 default).
--   7.4(0048) = finalize_payment 전액 정산(paid=copay)·후수납만. "선/부분수납=7.8" 명시 이월.
--   본 스토리(7.8) = ① prepay_payment(선결제 누적 + billing_type prepaid 전환·draft 유지)
--                    ② finalize_payment 재정의(paid = greatest(copay, paid) — 차액 수금·과납 보존).
--   **취소·노쇼 환급=7.9 · 부분 수행 정산=7.10 · 환자 포털 수납=8.3.**
--
-- ── 설계 결정 4건(사용자 확정 2026-06-24·AskUserQuestion) ──
--   ① 선수납 진입점 = 수납 워크리스트 확장(registered+in_progress)·동일 billing-detail 화면(web/db).
--   ② 정책 범위 = 건별 운용(billing_type per payment·후수납 기본 default postpaid·신규 설정 테이블 0).
--   ③ 차액 모델 = 단일 누계 paid_amount_krw(선결제 누적·finalize greatest·차액=copay-paid 파생·신규 컬럼 0).
--   ④ 과납(선납>copay) = 표시·플래그 + 환급 7.9 이월(finalize 허용·paid 초과분 보존·차단/즉시환급 미채택).
--
-- 의존: 0001(gen_random_uuid), 0010(encounters·complete_encounter·상태머신),
--   0045(payments·billing_type·paid_amount_krw·status·encounter_id UNIQUE·trg_payments_audit·payments_finalized_consistency),
--   0048(finalize_payment·payment_no_seq — 본 파일이 재정의), 0046(build_payment)·0047(price_payment)는 FastAPI 오케스트레이션.

-- ════════════════════════════════════════════════════════════════════════════
-- Task 1 — prepay_payment(선결제 누적 + 선수납 전환·draft 유지)
-- ════════════════════════════════════════════════════════════════════════════

-- 한 내원의 draft 수납 건에 선결제를 누적한다(접수 후·진찰 전 registered 또는 진찰 중 in_progress):
--   · 헤더 upsert: 없으면 생성(registered 에서 수가 0 이어도 — build_payment 미러). encounter_id 1:1.
--   · 행 잠금(for update): 동시 선결제/finalize 직렬화(finalize_payment 미러).
--   · 상태 가드: status≠'draft'(finalized/cancelled) = PT409(비가역 후 선결제 누적 차단).
--   · 금액 가드: amount<=0 = PT409(Pydantic gt=0 1차·DB 최종선 — 음수/0 누적 차단).
--   · 선결제: billing_type='prepaid'(건별 전환·설계 결정 ②) + paid_amount_krw += amount(단일 누계·설계 결정 ③)
--     + payment_method 기록. **status 불변=draft**(내원 상태 전이 없음 — 선결제는 정산 시점만 앞당김).
--   · 감사 = trg_payments_audit(0045) 가 UPDATE 를 actor(app.actor_id)와 자동 기록(수동 INSERT 불요).
-- ⚠️ 권한(payment.manage) 재평가는 FastAPI db 계층(_require_payment_manage·동일 txn TOCTOU) — build/finalize
--    동형(RPC 내부 has_permission 없음·EXECUTE 회수 + service_role 호출 + Python 가드가 권위).
create or replace function public.prepay_payment(
  p_encounter_id uuid,
  p_amount       integer,
  p_method       text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_status     text;
  v_enc_status text;
begin
  -- 내원 상태 가드(선결제 윈도우 = registered/in_progress·DB 불변식 강제·방어심층). 종결(completed/
  --   cancelled/no_show) 내원에 선결제 누적·draft 헤더 생성 차단(stale-tab/직접호출 reachable·funds to
  --   closed visit 방지). 미존재 → PT404(FastAPI 존재검사 미러·직접호출 대비).
  select status into v_enc_status from public.encounters where id = p_encounter_id;
  if v_enc_status is null then
    raise exception 'encounter not found: %', p_encounter_id using errcode = 'PT404';
  end if;
  if v_enc_status not in ('registered', 'in_progress') then
    raise exception 'invalid encounter state for prepay: %', v_enc_status using errcode = 'PT409';
  end if;

  -- 헤더 upsert(내원 1:1 — 0045 encounter_id UNIQUE). 이미 있으면 무변경(build_payment 미러).
  insert into public.payments (encounter_id)
  values (p_encounter_id)
  on conflict (encounter_id) do nothing;

  -- 행 잠금(동시 선결제/finalize 직렬화).
  select id, status into v_payment_id, v_status
    from public.payments where encounter_id = p_encounter_id
    for update;

  if v_payment_id is null then
    raise exception 'payment not found for encounter: %', p_encounter_id using errcode = 'PT404';
  end if;

  if v_status is distinct from 'draft' then  -- 이미 finalized/cancelled = 선결제 누적 차단(비가역)
    raise exception 'invalid payment transition: prepay on %', v_status using errcode = 'PT409';
  end if;

  if p_amount <= 0 then  -- 음수/0 선결제 차단(Pydantic gt=0 1차·DB 최종선)
    raise exception 'prepay amount must be positive: %', p_amount using errcode = 'PT409';
  end if;

  -- 선결제 누적(단일 누계·설계 결정 ③) + 선수납 전환(건별·설계 결정 ②). status 불변=draft.
  update public.payments set
    billing_type    = 'prepaid',
    paid_amount_krw = paid_amount_krw + p_amount,
    payment_method  = p_method,
    updated_at      = now()
  where id = v_payment_id;

  return v_payment_id;
end;
$$;

-- EXECUTE posture(0048 finalize_payment 동형) — service_role/FastAPI 만 호출. authenticated 직접 호출
--   차단(선결제·금액 위조 방어·권한은 FastAPI require_permission('payment.manage') + db has_permission 재평가).
revoke all on function public.prepay_payment(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.prepay_payment(uuid, integer, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Task 2 — finalize_payment 재정의(차액 정산 — paid = greatest(copay, paid))
-- ════════════════════════════════════════════════════════════════════════════

-- 0048 finalize_payment 를 1점만 바꿔 재정의(동일 서명·0045 insert_fee_item 재정의 선례 동형):
--   · 0048: paid_amount_krw = v_copay (전액 정산 — 후수납만·선납 무시).
--   · 0051: paid_amount_krw = greatest(v_copay, v_paid) (차액 정산·과납 보존).
--     - 후수납(선납 0): greatest(copay, 0) = copay → **무회귀**(7.4 동작 동일).
--     - 선수납(0<선납<copay): greatest(copay, 선납) = copay → 차액(copay-선납) 수금·완납.
--     - 과납(선납>copay): greatest(copay, 선납) = 선납 → 초과분 보존(설계 결정 ④·due 음수=환급 7.9).
--   나머지(가드·payment_no 시퀀스·complete_encounter·EXECUTE 회수)는 0048 그대로 보존.
create or replace function public.finalize_payment(p_encounter_id uuid, p_payment_method text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_status     text;
  v_total      integer;
  v_copay      integer;
  v_paid       integer;
  v_payment_no text;
begin
  -- 헤더 룩업 + 행 잠금(동시 finalize 직렬화). 선납액(v_paid) 추가 조회 = 차액 정산 입력.
  select id, status, total_amount_krw, copay_amount_krw, paid_amount_krw
    into v_payment_id, v_status, v_total, v_copay, v_paid
    from public.payments
   where encounter_id = p_encounter_id
   for update;

  if v_payment_id is null then
    raise exception 'payment not found for encounter: %', p_encounter_id using errcode = 'PT404';
  end if;

  if v_status is distinct from 'draft' then  -- 이미 finalized/cancelled = 이중결제·재finalize 차단(비가역)
    raise exception 'invalid payment transition: % -> finalized', v_status using errcode = 'PT409';
  end if;

  if v_total <= 0 then  -- 정산할 수가 항목 0 = 빈 내원 finalize 차단(선납만 받고 미진료 = 취소·환급 7.9)
    raise exception 'no billable items for encounter: %', p_encounter_id using errcode = 'PT409';
  end if;

  -- 영수증번호 = R-YYYYMMDD(KST)-NNNNNN(전역 시퀀스 6자리 패딩). 날짜=가독·유일성=시퀀스.
  v_payment_no := 'R-' || to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD')
                       || '-' || lpad(nextval('public.payment_no_seq')::text, 6, '0');

  -- 결제 컬럼 기록(차액 정산 — paid = greatest(copay, 선납)). finalized_by = app.actor_id GUC.
  update public.payments set
    status          = 'finalized',
    payment_method  = p_payment_method,
    payment_no      = v_payment_no,
    finalized_at    = now(),
    finalized_by    = nullif(current_setting('app.actor_id', true), '')::uuid,
    paid_amount_krw = greatest(v_copay, v_paid),
    updated_at      = now()
  where id = v_payment_id;

  -- 내원 완료 전이(기존 RPC 재사용 — in_progress→completed·주상병 게이트·전이 트리거). 실패 시 전체 롤백.
  perform public.complete_encounter(p_encounter_id);

  return v_payment_id;
end;
$$;

-- EXECUTE posture(0048 보존·자기완결성 재선언) — service_role/FastAPI 만 호출.
revoke all on function public.finalize_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_payment(uuid, text) to service_role;
