-- 0046_payment_aggregation.sql — 수납 건 집계 함수(build_payment) + 쓰기 권한(payment.manage)
-- Story 7.2 / FR-110(자동발생 수가 집계·수납 건 생성), UX-DR14("자동" 마커), NFR-041(트랜잭션 원자성).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실). 금액=KRW 정수(소수 없음). timestamptz=UTC.
-- 불변식·집계 로직은 DB 가 소유 — 수가/정산 로직을 Python/TS 에 재구현 금지(project-context).
--
-- ⚠️ 파일 번호 0046: Epic 7 마이그 블록 0045~0059(0045_payments 다음).
--
-- ── 2계층 수가 모델(0045 §) ──
--   임상 적재  fee_items(0021·5.10)           : 임상 이벤트 → 내원별 수가항목(금액 스냅샷·멱등)
--   수납 집계  payment_details(0045·7.1)       : payments 헤더 1:N 라인 = fee_items 집계 대상
--   본 스토리(7.2) = 집계 함수 build_payment(fee_items → payment_details 영속 적재 + 헤더 롤업) + 쓰기 권한.
--   **본인부담 산정(copay/insurer)=7.3 · finalize·결제·내원완료=7.4 · 문서=7.5~7.7.**
--
-- ── 설계 결정(사용자 확정 2026-06-23) ──
--   집계 영속 = 진입 시 자동 집계(build_payment 멱등) · 쓰기 권한 = payment.manage 신규(reception) · 진입 = 워크리스트→상세.
--
-- 의존: 0001(gen_random_uuid), 0002(permissions·role_permissions·admin), 0003(has_permission),
--   0004(audit_trigger_fn), 0007(fee_schedules·code·name), 0010(encounters), 0021(fee_items),
--   0045(payments·payment_details·payment.read·unique(encounter_id)·unique(payment_id,fee_item_id)).

-- ════════════════════════════════════════════════════════════════════════════
-- Task 1 — 집계 함수 build_payment(fee_items → payment_details 멱등 적재 + 헤더 롤업)
-- ════════════════════════════════════════════════════════════════════════════

-- 한 내원의 자동발생 수가(fee_items)를 draft 수납 건(payments 헤더 + payment_details 라인)으로 집계한다.
-- 멱등: on conflict(payment_id, fee_item_id) do nothing → 재호출 시 신규 fee_item 만 추가(기존 라인·금액 불변).
--   진입 시 자동 집계 모델 = 수납 화면 열 때마다 안전 반복(그 사이 수행된 오더의 수가만 추가 집계).
-- 상태 가드: status≠'draft'(finalized/cancelled) 면 라인·금액 동결(7.4 finalize 후 불변) → 무변경 반환.
-- ⚠️ fee_items 엔 code/name 없음 → fee_schedules 조인으로 스냅샷(금액·category·coverage 는 fee_items 직접).
-- ⚠️ 헤더 롤업 = total/covered/non_covered 만(7.2 책임분 — deferred-work L366 흡수). copay/insurer=7.3·결제=7.4.
create or replace function public.build_payment(p_encounter_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id  uuid;
  v_status      text;
  v_total       integer;
  v_covered     integer;
  v_non_covered integer;
begin
  -- 헤더 upsert(내원 1:1 — 0045 encounter_id UNIQUE). 이미 있으면 무변경(do nothing).
  insert into public.payments (encounter_id)
  values (p_encounter_id)
  on conflict (encounter_id) do nothing;

  select id, status into v_payment_id, v_status
    from public.payments where encounter_id = p_encounter_id;

  -- draft 외(finalized/cancelled)는 집계 동결 — 무변경 반환(7.4 finalize 후 라인 불변 보존).
  if v_status is distinct from 'draft' then
    return v_payment_id;
  end if;

  -- fee_items → payment_details 멱등 적재(신규 항목만). 스냅샷 = 집계 시점 고정(청구 정합).
  insert into public.payment_details
    (payment_id, fee_item_id, fee_schedule_id, code, name, category,
     quantity, unit_amount_krw, amount_krw, coverage_type)
  select v_payment_id, fi.id, fi.fee_schedule_id, fs.code, fs.name, fi.category,
         fi.quantity, fi.unit_amount_krw, fi.amount_krw, fi.coverage_type
    from public.fee_items fi
    join public.fee_schedules fs on fs.id = fi.fee_schedule_id
   where fi.encounter_id = p_encounter_id
  on conflict (payment_id, fee_item_id) do nothing;

  -- 헤더 금액 롤업(라인 합) — total=Σ, covered=Σ(급여), non_covered=Σ(비급여). total=covered+non_covered 항등.
  select
    coalesce(sum(amount_krw), 0),
    coalesce(sum(amount_krw) filter (where coverage_type = 'covered'), 0),
    coalesce(sum(amount_krw) filter (where coverage_type = 'non_covered'), 0)
    into v_total, v_covered, v_non_covered
    from public.payment_details where payment_id = v_payment_id;

  -- 값이 실제로 바뀔 때만 UPDATE(불필요 감사행 방지 — 변경 없는 재진입은 트리거 미발화).
  update public.payments set
    total_amount_krw       = v_total,
    covered_amount_krw     = v_covered,
    non_covered_amount_krw = v_non_covered,
    updated_at             = now()
  where id = v_payment_id
    and (total_amount_krw, covered_amount_krw, non_covered_amount_krw)
        is distinct from (v_total, v_covered, v_non_covered);

  return v_payment_id;
end;
$$;

-- EXECUTE posture(0005/0012 SECURITY DEFINER 선례) — service_role/FastAPI 만 호출. authenticated 직접 호출
--   차단(집계=쓰기 명령·권한은 FastAPI require_permission + db has_permission 재평가가 게이트).
revoke all on function public.build_payment(uuid) from public, anon, authenticated;
grant execute on function public.build_payment(uuid) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Task 2 — payment.manage 쓰기 권한 + admin 부트 grant
-- ════════════════════════════════════════════════════════════════════════════

-- payment.manage = 수납 쓰기(집계 빌드 7.2 · finalize 7.4 공유). 7.1 이 7.4 로 이월했던 쓰기 권한을
--   소비처(7.2)가 도입. 비-admin grant(reception)는 seed/매트릭스 소관.
insert into public.permissions (code, name, resource, action) values
  ('payment.manage', '수납 관리', 'payment', 'manage')
on conflict (code) do nothing;

-- admin 부트 grant(신규 권한만; 매트릭스 UI 는 Story 1.7). 멱등.
-- ⚠️ 필수: 0002 admin cross-join 은 후행 마이그 권한을 자동 포함하지 않는다(누락 시
--    test_admin_role_has_all_permissions 회귀 — 0010·0013·0014·0015·0021·0045 가 겪은 함정).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'payment.manage'
where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;
