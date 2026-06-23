-- 0052_payment_cancel.sql — 취소·노쇼 정산(settle_cancelled_visit) RPC + 선납 환급 컬럼 + cancelled 일관성 CHECK
-- Story 7.9 / FR-118(취소·노쇼 종결 내원 수가 미발생), NFR-041(다단계 작업 트랜잭션 원자성).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실). 금액=KRW 정수(소수 없음). timestamptz=UTC.
-- 불변식·정산·상태전이 로직은 DB 가 소유 — 수가/정산/상태머신 로직을 Python/TS 에 재구현 금지(project-context).
--
-- ⚠️ 파일 번호 0052: Epic 7 마이그 블록 0045~0059(0051_payment_prepay 다음).
--
-- ── 취소·환급 레이어(0045 컬럼 선언 → 0046 적재 → 0047 산정 → 0048 결제·완료 → 0051 선후수납 → 0052 취소·환급) ──
--   7.1(0045) = payments.status(draft/finalized/**cancelled**)·cancelled_at·cancel_reason 컬럼 선언만(취소 로직 미구현).
--   7.4(0048) = finalize 전액 정산. "취소·노쇼 정산=7.9" 명시 이월 + cancelled 일관성 CHECK 7.9 소관 명시(L113).
--   7.8(0051) = 선결제 누적·차액 정산. "과납=환급 7.9 이월"·"선납 후 0-수가 내원 환급=7.9".
--   본 스토리(7.9) = ① refunded_amount_krw 컬럼(선납 환급액·총 수령 paid 보존·별도 추적)
--                    ② payments_cancelled_consistency CHECK(취소 행=cancelled_at 필수·0048 이월 청산)
--                    ③ settle_cancelled_visit(cancel_encounter + draft payment void + 선납 전액 환급·1 txn).
--   **부분 수행 정산=7.10 · 환자 포털 수납=8.3 · 노쇼료 실제 부과=정책 OFF 기본(메커니즘만 0045 예비·미구현).**
--
-- ── 핵심 통찰 — "수가 미발생"은 대부분 구조적 ──
--   진찰료 fee_item 은 registered→in_progress(start_consult) 트리거로 적재·검사처치료는 perform 시 적재.
--   취소·노쇼는 in_progress 진입 *전*(scheduled/registered) → fee_items 구조적 0 = 수가 미발생 자동 보장.
--   ⇒ 7.9 의 능동 작업 = draft 수납 건 void(특히 선납 prepaid 헤더) + 선납 환급. fee_item 삭제 로직 없음.
--
-- ── 설계 결정 4건(사용자 확정 2026-06-24·AskUserQuestion) ──
--   ① 정산 진입점 = 수납 화면 통합 액션(billing-detail "내원 취소·환급" → settle RPC·결제 도메인 수납 일원화).
--   ② 환급 기록 = 신규 컬럼 refunded_amount_krw(paid 보존·refunded 별도·순납부=paid-refunded·전액 환급).
--   ③ 노쇼료 = 정책 OFF 기본·메커니즘 예비만(payment_details.fee_item_id nullable 0045·실제 부과 미구현).
--   ④ 환급 확인 = 신원 confirm(web) + 원결제수단 자동(payment_method)·환급 문서 미출력.
--
-- 의존: 0001(gen_random_uuid), 0010(encounters·cancel_encounter SECURITY DEFINER·encounter.cancel·상태머신),
--   0045(payments·status draft/finalized/cancelled·paid_amount_krw·cancelled_at·cancel_reason·encounter_id UNIQUE·
--        trg_payments_audit·payments_finalized_consistency), 0046(build_payment)는 FastAPI 오케스트레이션(선행 호출).

-- ════════════════════════════════════════════════════════════════════════════
-- Task 1 — 선납 환급 컬럼(refunded_amount_krw) + 환급/취소 일관성 CHECK
-- ════════════════════════════════════════════════════════════════════════════

-- ── 선납 환급액(설계 결정 ②) ──────────────────────────────────────────────────
-- paid_amount_krw(총 수령)는 보존하고 refunded_amount_krw(반환액)를 별도 추적 → 순납부 = paid - refunded.
--   "10,000 받고 10,000 환급" 이력 영속(리포팅·감사 근거). 기존 행 default 0(무회귀).
alter table public.payments
  add column if not exists refunded_amount_krw integer not null default 0
    check (refunded_amount_krw >= 0);

-- 환급 ≤ 수령(받은 것보다 더 환급 불가). 기존 행(refunded 0 ≤ paid) 전부 통과 → ADD 성공.
alter table public.payments drop constraint if exists payments_refund_le_paid;
alter table public.payments add constraint payments_refund_le_paid
  check (refunded_amount_krw <= paid_amount_krw);

-- ── cancelled 일관성 CHECK(0048 L113 이월 청산) ───────────────────────────────
-- 취소 행은 취소시각(cancelled_at) 필수 — 부분 취소·일관성 깨짐 차단. draft/finalized(status<>'cancelled'
--   true)·기존 cancelled 행 0 → ADD 성공·무회귀. cancel_reason 은 nullable(사유 선택 입력·web).
alter table public.payments drop constraint if exists payments_cancelled_consistency;
alter table public.payments add constraint payments_cancelled_consistency
  check (status <> 'cancelled' or cancelled_at is not null);

-- ════════════════════════════════════════════════════════════════════════════
-- Task 2 — settle_cancelled_visit(취소 전이 + draft void + 선납 전액 환급·1 txn)
-- ════════════════════════════════════════════════════════════════════════════

-- 한 내원을 취소(scheduled/registered→cancelled)하고 draft 수납 건을 void + 선납 전액 환급한다. 순서:
--   ① draft payment 룩업 + 행 잠금(for update) + draft 가드. ⚠️ **락 순서 = payment→encounter**:
--     finalize(0048/0051)는 payment 락 후 complete_encounter(encounter) 락 → settle 도 payment 먼저
--     잡아 동일 내원 동시 settle/finalize 의 ABBA 데드락(40P01)을 제거(코드리뷰 patch). build_payment
--     선행으로 정상 경로 항상 1행. 가드(status≠'draft' = PT409)도 side-effect 전 평가(방어심층).
--   ② cancel_encounter perform: 상태머신 재사용(재구현 0·project-context). 내부 has_permission('encounter.cancel')
--     평가(미보유 42501→403) · 비-(scheduled/registered) = PT409 · 미존재 = PT404 → 전체 롤백(NFR-041).
--   ③ void + 환급: status='cancelled'·cancelled_at·cancel_reason · refunded_amount_krw = paid_amount_krw
--     (선납 전액 환급 — 설계 결정 ②). 후수납(선납 0) 취소는 refunded=0(환급 없음).
--   · 감사 = trg_payments_audit(0045)·encounters 감사 트리거가 actor(app.actor_id)와 자동 기록(수동 INSERT 불요).
-- ⚠️ 권한(payment.manage) 재평가는 FastAPI db 계층(_require_payment_manage·동일 txn TOCTOU) — prepay/finalize
--    동형(RPC 내부 payment.manage 없음·EXECUTE 회수 + service_role 호출 + Python 가드가 권위).
--    encounter.cancel 은 cancel_encounter 내부가 평가(authenticated_conn 의 auth.uid()=호출자·prepay/finalize 동형).
-- ⚠️ 순서 불변식: build_payment(db 계층·encounter registered 시점) → settle(payment 락+가드 → cancel 전이 → void).
--    cancel_encounter 를 본 RPC 안에서 perform 하므로 build_payment 는 settle 진입 전에 완료돼야 함
--    (db 계층 호출 순서로 강제 — RPC 내부에서 build_payment 호출 금지).
create or replace function public.settle_cancelled_visit(
  p_encounter_id uuid,
  p_reason       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_status     text;
  v_paid       integer;
begin
  -- ① draft 수납 건 룩업 + 행 잠금(payment FOR UPDATE 먼저). ⚠️ 락 순서 = payment→encounter:
  --   finalize(0048/0051)는 payment 락 후 complete_encounter(encounter) 락 → settle 도 동일 순서로
  --   잡아 동일 내원 동시 settle/finalize 의 ABBA 데드락(40P01·미매핑 503)을 제거(코드리뷰 patch).
  --   build_payment(db 계층 선행)로 정상 경로에서 항상 1행. draft 가드도 side-effect(cancel) 전에 평가(방어).
  select id, status, paid_amount_krw
    into v_payment_id, v_status, v_paid
    from public.payments
   where encounter_id = p_encounter_id
   for update;

  if v_payment_id is null then  -- 직접호출 대비 방어(db 계층 build_payment 선행 시 도달 불가)
    raise exception 'payment not found for encounter: %', p_encounter_id using errcode = 'PT404';
  end if;

  if v_status is distinct from 'draft' then  -- 이미 finalized/cancelled = void 차단(비가역·방어)
    raise exception 'invalid payment transition: settle on %', v_status using errcode = 'PT409';
  end if;

  -- ② 내원 취소 전이(상태머신 재사용 — registered/scheduled→cancelled). 권한(encounter.cancel 42501)·
  --   소스상태(비-registered/scheduled PT409)·존재(PT404) 가드는 cancel_encounter 내부. 실패 시 전체 롤백.
  perform public.cancel_encounter(p_encounter_id, p_reason);

  -- ③ void + 선납 전액 환급(설계 결정 ②). 후수납(paid=0)은 refunded=0. cancelled_at = 일관성 CHECK 충족.
  update public.payments set
    status              = 'cancelled',
    cancelled_at        = now(),
    cancel_reason       = p_reason,
    refunded_amount_krw = v_paid,
    updated_at          = now()
  where id = v_payment_id;

  return v_payment_id;
end;
$$;

-- EXECUTE posture(0051 prepay_payment 동형) — service_role/FastAPI 만 호출. authenticated 직접 호출
--   차단(취소·환급 위조 방어·권한은 FastAPI require_permission('payment.manage') + db has_permission 재평가).
revoke all on function public.settle_cancelled_visit(uuid, text) from public, anon, authenticated;
grant execute on function public.settle_cancelled_visit(uuid, text) to service_role;
