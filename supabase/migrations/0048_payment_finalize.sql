-- 0048_payment_finalize.sql — 수납 finalize(결제 기록 + 내원 완료) + 영수증번호 시퀀스 + 일관성 CHECK
-- Story 7.4 / FR-112(수납 처리·내원 완료), NFR-041(다단계 작업 트랜잭션 원자성).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실). 금액=KRW 정수(소수 없음). timestamptz=UTC.
-- 불변식·정산 로직은 DB 가 소유 — 수가/정산/상태머신 로직을 Python/TS 에 재구현 금지(project-context).
--
-- ⚠️ 파일 번호 0048: Epic 7 마이그 블록 0045~0059(0047_payment_pricing 다음).
--
-- ── finalize 레이어(0045 컬럼 선언 → 0046 라인 적재 → 0047 산정 → 0048 결제·완료) ──
--   7.1(0045) = payments 결제 6컬럼(payment_method·payment_no·finalized_at/by·…) 선언만(값 NULL).
--   7.2(0046) = build_payment 라인 적재 + total/covered/non_covered 롤업.
--   7.3(0047) = price_payment 본인부담 산정(copay/insurer).
--   본 스토리(7.4) = finalize_payment 가 결제 컬럼 기록 + complete_encounter(내원 in_progress→completed) 호출.
--   **취소·노쇼 정산=7.9 · 진료비 문서(계산서·영수증·세부내역서·처방전)=7.5~7.7 · 선/부분수납=7.8.**
--
-- ── 설계 결정 4건(사용자 확정 2026-06-23·AskUserQuestion) ──
--   ① 완료 전이 = complete_encounter RPC 재사용(finalize_payment 가 perform 호출) + reception 에
--      encounter.complete grant(seed.sql) — 상태머신·주상병 게이트(PT422) 재구현 0.
--   ② 영수증번호 payment_no = 전역 시퀀스 payment_no_seq + KST 날짜 프리픽스 R-YYYYMMDD-NNNNNN.
--   ③ 결제 금액 = 전액 정산만(paid_amount_krw = copay_amount_krw 자동·금액 입력 없음) — 선/부분수납 7.8.
--   ④ 신원 재진술 confirm = 수동 확인(web — 이름·차트번호 표시→확인).
--
-- 의존: 0001(gen_random_uuid), 0009(patients), 0010(encounters·complete_encounter·enforce_transition),
--   0014(complete_encounter 재정의 — 주상병 게이트 PT422), 0045(payments 결제컬럼·status·UNIQUE),
--   0046(build_payment), 0047(price_payment — finalize 전 build→price 선행은 FastAPI 가 오케스트레이션).

-- ════════════════════════════════════════════════════════════════════════════
-- Task 1 — 영수증번호 시퀀스(payment_no_seq · 전역 단조증가)
-- ════════════════════════════════════════════════════════════════════════════

-- 전역 시퀀스(일별 리셋 없음 → 카운터 테이블/락 불요·동시 finalize 충돌 0). 날짜는 가독용(아래 포맷),
--   유일성은 시퀀스 + payments.payment_no UNIQUE(0045)가 최종선.
create sequence if not exists public.payment_no_seq;
revoke all on sequence public.payment_no_seq from anon, authenticated;
grant usage, select on sequence public.payment_no_seq to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Task 2 — finalize_payment(결제 컬럼 기록 + complete_encounter 완료 전이)
-- ════════════════════════════════════════════════════════════════════════════

-- 한 내원의 draft 수납 건을 finalized 로 전이하고 내원을 완료한다:
--   · 상태 가드: status≠'draft'(이미 finalized/cancelled) = PT409(이중결제·재finalize 차단·비가역).
--   · 정산 대상 가드: total_amount_krw<=0(빈 내원) = PT409.
--   · 결제 컬럼: status='finalized'·payment_method·payment_no(시퀀스+KST 날짜)·finalized_at/by(actor GUC)·
--     paid_amount_krw = copay_amount_krw(전액 정산 — 설계 결정 ③).
--   · 내원 완료: perform complete_encounter(in_progress→completed·주상병 게이트 PT422·전이 트리거 재사용).
--     주상병 미지정/비-in_progress → 전체 롤백(원자·NFR-041). payment_method 는 컬럼 CHECK 가 최종선(0045).
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
  v_payment_no text;
begin
  -- 헤더 룩업 + 행 잠금(동시 finalize 직렬화 — 7.2/7.3 동시성 이월 부분 강화).
  select id, status, total_amount_krw, copay_amount_krw
    into v_payment_id, v_status, v_total, v_copay
    from public.payments
   where encounter_id = p_encounter_id
   for update;

  if v_payment_id is null then
    raise exception 'payment not found for encounter: %', p_encounter_id using errcode = 'PT404';
  end if;

  if v_status is distinct from 'draft' then  -- 이미 finalized/cancelled = 이중결제·재finalize 차단(비가역)
    raise exception 'invalid payment transition: % -> finalized', v_status using errcode = 'PT409';
  end if;

  if v_total <= 0 then  -- 정산할 수가 항목 0 = 빈 내원 finalize 차단(정상 경로 미발생·방어)
    raise exception 'no billable items for encounter: %', p_encounter_id using errcode = 'PT409';
  end if;

  -- 영수증번호 = R-YYYYMMDD(KST)-NNNNNN(전역 시퀀스 6자리 패딩). 날짜=가독·유일성=시퀀스.
  v_payment_no := 'R-' || to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD')
                       || '-' || lpad(nextval('public.payment_no_seq')::text, 6, '0');

  -- 결제 컬럼 기록(전액 정산 — paid = 본인부담금). finalized_by = authenticated_conn 의 app.actor_id GUC.
  update public.payments set
    status          = 'finalized',
    payment_method  = p_payment_method,
    payment_no      = v_payment_no,
    finalized_at    = now(),
    finalized_by    = nullif(current_setting('app.actor_id', true), '')::uuid,
    paid_amount_krw = v_copay,
    updated_at      = now()
  where id = v_payment_id;

  -- 내원 완료 전이(기존 RPC 재사용 — in_progress→completed·주상병 게이트·전이 트리거). 실패 시 전체 롤백.
  --   has_permission('encounter.complete') 는 호출자(원무) 권한 평가 → reception grant 필요(seed.sql·7.4).
  perform public.complete_encounter(p_encounter_id);

  return v_payment_id;
end;
$$;

-- EXECUTE posture(0046 build_payment·0047 price_payment 동형) — service_role/FastAPI 만 호출.
--   authenticated 직접 호출 차단(finalize·이중결제 위조 방어·권한은 FastAPI require_permission('payment.manage')).
revoke all on function public.finalize_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_payment(uuid, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Task 3 — payments finalize 컬럼 일관성 CHECK(deferred-work L365 finalized 부분 해소)
-- ════════════════════════════════════════════════════════════════════════════

-- finalized 행은 영수증번호·결제시각·담당자·결제수단을 모두 가져야 함(부분 finalize·일관성 깨짐 차단).
--   draft 행은 status<>'finalized' true → 통과(기존 행 무영향·finalized 행 0이라 ADD CONSTRAINT 성공).
--   ⚠️ cancelled 컬럼 일관성(cancelled_at/cancel_reason) CHECK = 7.9 소관(취소 로직 미구현·스코프 누수 방지).
alter table public.payments drop constraint if exists payments_finalized_consistency;
alter table public.payments add constraint payments_finalized_consistency
  check (
    status <> 'finalized'
    or (payment_no is not null and finalized_at is not null
        and finalized_by is not null and payment_method is not null)
  );
