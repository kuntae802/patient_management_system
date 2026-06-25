-- 0056_order_cancel.sql — 미수행 오더 취소(검사·처치 ordered→cancelled, 처방 issued→cancelled)
-- 사용자 요청(2026-06-25·실사용 테스트): 의사가 진료 허브에서 잘못 낸 미수행 오더를 취소.
-- Epic 5 "오더 취소 어휘=이월" 청산. 식별자 영문 snake_case. timestamptz=UTC. 불변식·감사는 DB 소유.
--
-- ⚠️ 파일 번호 0056: 0055_examination_patient_result 다음.
--
-- ── 설계 결정 5건 ──
--   ① 미수행/미발급만 취소 — 검사·처치 status='ordered', 처방 status='issued' 에서만(수행분 차단).
--      수행분(performed/completed/dispensed)은 정산·약국 발급에 영향 → cancel RPC 가 PT409.
--   ② cancelled 상태 추가(신규 컬럼 0) — 취소 시각=updated_at, 취소 주체=기존 trg_*_audit(actor 자동 기록).
--   ③ cancel RPC 3종 = 0015 perform_* / 0050 dispense_prescription 미러(SECURITY DEFINER·has_permission
--      자가 게이트·for update·소스상태 선검사·assert_encounter_orderable 종결내원 차단). cancelled=종착.
--   ④ 권한 order.cancel 신규 1종(order.read 대칭) — 검사/처치/처방 공통. admin(부트)+doctor grant.
--   ⑤ 수가 영향 0 — fee_item 은 'performed' 전이(0021 트리거)에만 발생, ordered 취소는 fee 무관.
--
-- 의존: 0002(permissions·role_permissions·has_permission), 0015(오더 테이블·enforce_*_transition·
--   trg_*_audit), 0021(fee 트리거 — performed 전이에만 발생), 0053(assert_encounter_orderable).

-- ════════════════════════════════════════════════════════════════════════════
-- Task 1 — status CHECK 확장(cancelled 추가)
-- ════════════════════════════════════════════════════════════════════════════

alter table public.examinations drop constraint examinations_status_check;
alter table public.examinations add constraint examinations_status_check
  check (status in ('ordered', 'performed', 'completed', 'cancelled'));

alter table public.treatment_orders drop constraint treatment_orders_status_check;
alter table public.treatment_orders add constraint treatment_orders_status_check
  check (status in ('ordered', 'performed', 'completed', 'cancelled'));

alter table public.prescriptions drop constraint prescriptions_status_check;
alter table public.prescriptions add constraint prescriptions_status_check
  check (status in ('issued', 'dispensed', 'cancelled'));

-- ════════════════════════════════════════════════════════════════════════════
-- Task 2 — 상태 전이 허용(ordered/issued → cancelled). 0015 본문 미러 + 취소 전이 추가.
-- ════════════════════════════════════════════════════════════════════════════

-- 검사·처치 공용 — ordered → cancelled 추가(cancelled 는 종착·재전이 없음).
create or replace function public.enforce_act_order_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'ordered' then
      raise exception 'invalid initial order status: %', new.status using errcode = 'PT409';
    end if;
    return new;
  end if;
  if new.status = old.status then
    return new;
  end if;
  if not (
    (old.status = 'ordered'   and new.status = 'performed') or
    (old.status = 'performed' and new.status = 'completed') or
    (old.status = 'ordered'   and new.status = 'cancelled')
  ) then
    raise exception 'invalid order transition: % -> %', old.status, new.status using errcode = 'PT409';
  end if;
  return new;
end;
$$;

-- 처방 — issued → cancelled 추가.
create or replace function public.enforce_prescription_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'issued' then
      raise exception 'invalid initial prescription status: %', new.status using errcode = 'PT409';
    end if;
    return new;
  end if;
  if new.status = old.status then
    return new;
  end if;
  if not (
    (old.status = 'issued' and new.status = 'dispensed') or
    (old.status = 'issued' and new.status = 'cancelled')
  ) then
    raise exception 'invalid prescription transition: % -> %', old.status, new.status using errcode = 'PT409';
  end if;
  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- Task 3 — 권한 카탈로그 확장 + grant(admin 부트 필수 · doctor 직무)
-- ════════════════════════════════════════════════════════════════════════════

-- order.cancel — 미수행 오더 취소 게이트(검사/처치/처방 공통·order.read 대칭). 오더 지시자(의사) 직무.
insert into public.permissions (code, name, resource, action) values
  ('order.cancel', '오더 취소', 'order', 'cancel')
on conflict (code) do nothing;

-- admin 부트 grant — ⚠️ 필수: 0002 admin cross-join 은 후행 마이그 권한을 자동 포함하지 않는다
--   (누락 시 test_admin_role_has_all_permissions 회귀 — 0010·0012·0015·0021·0050 가 겪은 함정).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'order.cancel'
where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;

-- doctor grant — 오더 지시자가 취소(고정 직무 권한). seed.sql 에도 동일(로컬 reset 일관·멱등).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'order.cancel'
where r.code = 'doctor'
on conflict (role_id, permission_id) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- Task 4 — cancel RPC 3종(0015 perform_* / 0050 dispense 미러)
-- ════════════════════════════════════════════════════════════════════════════

-- 검사 취소(ordered → cancelled). 미수행만(performed/completed/cancelled 는 PT409).
create or replace function public.cancel_examination(p_examination_id uuid)
returns public.examinations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.examinations;
begin
  if not public.has_permission('order.cancel') then
    raise exception 'permission denied: order.cancel' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.examinations where id = p_examination_id for update;
  if not found then
    raise exception 'examination not found: %', p_examination_id using errcode = 'PT404';
  end if;
  perform public.assert_encounter_orderable(v_row.encounter_id);  -- 종결 내원 취소 차단(0053)
  if v_row.status <> 'ordered' then  -- 미수행만 취소(수행분=정산영향)
    raise exception 'invalid examination transition: % -> cancelled', v_row.status using errcode = 'PT409';
  end if;
  update public.examinations
     set status = 'cancelled', updated_at = now()
   where id = p_examination_id
   returning * into v_row;
  return v_row;
end;
$$;

-- 처치 취소(ordered → cancelled). 동형.
create or replace function public.cancel_treatment_order(p_treatment_order_id uuid)
returns public.treatment_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.treatment_orders;
begin
  if not public.has_permission('order.cancel') then
    raise exception 'permission denied: order.cancel' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.treatment_orders where id = p_treatment_order_id for update;
  if not found then
    raise exception 'treatment order not found: %', p_treatment_order_id using errcode = 'PT404';
  end if;
  perform public.assert_encounter_orderable(v_row.encounter_id);  -- 종결 내원 취소 차단(0053)
  if v_row.status <> 'ordered' then  -- 미수행만 취소(수행분=정산영향)
    raise exception 'invalid treatment order transition: % -> cancelled', v_row.status using errcode = 'PT409';
  end if;
  update public.treatment_orders
     set status = 'cancelled', updated_at = now()
   where id = p_treatment_order_id
   returning * into v_row;
  return v_row;
end;
$$;

-- 처방 취소(issued → cancelled). 미발급만(dispensed/cancelled 는 PT409·약국 발급 후 회수 불가).
create or replace function public.cancel_prescription(p_prescription_id uuid)
returns public.prescriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.prescriptions;
begin
  if not public.has_permission('order.cancel') then
    raise exception 'permission denied: order.cancel' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.prescriptions where id = p_prescription_id for update;
  if not found then
    raise exception 'prescription not found: %', p_prescription_id using errcode = 'PT404';
  end if;
  perform public.assert_encounter_orderable(v_row.encounter_id);  -- 종결 내원 취소 차단(0053)
  if v_row.status <> 'issued' then  -- 미발급만 취소(dispensed=약국 발급 완료)
    raise exception 'invalid prescription transition: % -> cancelled', v_row.status using errcode = 'PT409';
  end if;
  update public.prescriptions
     set status = 'cancelled', updated_at = now()
   where id = p_prescription_id
   returning * into v_row;
  return v_row;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- Task 5 — EXECUTE posture(RPC 자가 게이트 → authenticated 직접 호출 안전·0015/0050 동형)
-- ════════════════════════════════════════════════════════════════════════════

revoke all on function public.cancel_examination(uuid) from public, anon, authenticated;
grant execute on function public.cancel_examination(uuid) to authenticated, service_role;

revoke all on function public.cancel_treatment_order(uuid) from public, anon, authenticated;
grant execute on function public.cancel_treatment_order(uuid) to authenticated, service_role;

revoke all on function public.cancel_prescription(uuid) from public, anon, authenticated;
grant execute on function public.cancel_prescription(uuid) to authenticated, service_role;
