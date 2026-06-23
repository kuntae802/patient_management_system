-- 0053_order_encounter_gate.sql — 오더-by-내원상태 게이트(종결 내원 오더 생성·수행 차단) + 부분수행 정산 무결성
-- Story 7.10 / FR-119(부분 수행 정산 — 일부 오더만 수행 후 이탈한 내원도 수행분까지 정산).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실). 불변식·상태머신·게이트 로직은 DB 가 소유(project-context).
--
-- ⚠️ 파일 번호 0053: Epic 7 마이그 블록 0045~0059(0052_payment_cancel 다음).
--
-- ── 핵심 통찰 — "수행분만 정산"은 이미 구조적(7.9 "수가 미발생" 구조성의 쌍대) ──
--   fee_items 는 perform 시점에만 발생(0021): 진찰료=registered→in_progress, 검사·처치료=ordered→performed.
--   미수행(ordered) 오더는 fee_item 0 → build_payment(fee_items 집계)가 자동 제외 → 수행분만 청구(FR-119).
--   ⇒ 7.10 의 능동 작업 = ① 오더-by-내원상태 게이트(종결 내원에 신규 수가·오더 차단 = 정산액 사후 변조 방지)
--      ② 미수행 카운트 가시성(pending_orders_count = API 헤더 SELECT·본 마이그 무관). fee_item 삭제 로직 없음.
--
-- ── 게이트 의미 = 종결(completed/cancelled/no_show)·soft-deleted 내원 차단 (NOT 비-in_progress) ──
--   ⚠️ 비자명: 방사선·간호·판독 워크리스트(db.py fetch_radiology/nursing/reading_worklist)가
--      `e.status in ('registered','in_progress')` 를 노출 → **registered 내원에 오더 생성·수행은 실제 임상
--      플로우**(촬영·처치·검체는 진찰 전/중 수행). 따라서 in_progress-only 게이트는 실기능을 깨뜨린다.
--   게이트는 **종결 내원(정산 후·수가 변조 위험)** 만 차단 → deferred 항목(완료/취소 내원 오더)을 정확히 청산하고
--      registered 기반 워크리스트 플로우를 보존한다. scheduled/registered/in_progress(active) = 오더 가능.
--
-- ── 청산 deferred-work(전부 "완료/취소 내원" = terminal 지목) ──
--   L277(insert_prescription 내원상태 미검증)·L290(insert_examination 동일)·treatment 생성 = 생성 트리거로 청산.
--   L333(call_perform_treatment_order 내원상태 미검증) = perform_treatment_order 게이트로 청산(treatment perform).
--   L346(종결 내원 perform 시 수가 적재) = perform RPC 게이트가 상류 차단 → 종결 내원 fee 발생 불가로 청산.
--
-- ── 설계 결정 3건(사용자 확정 2026-06-25·AskUserQuestion) ──
--   ① 오더-by-내원상태 게이트 = 7.10 에서 닫는다(종결 내원 오더 생성·수행 차단·deferred 5건 청산).
--   ② 미수행 오더 처분 = 그대로 둔다(ordered 잔존·청구는 fee_items 부재로 구조적 제외·오더 cancel RPC 추가 안 함).
--   ③ 부분수행 가시성 = 카운트 배지(pending_orders_count·payment.read 경로·order.read grant 0·API 소관·본 마이그 무관).
--
-- 경계(하지 않음): 미수행 오더 자동 cancel(forward-only 유지) · complete_examination 게이트(종결 후 판독 정당·fee 0)
--   · fee 트리거(0021) 변경(perform 게이트 상류 차단으로 충분) · nursing_records 게이트(간호 도메인·비-billable·잔여)
--   · dispense/export 게이트(7.7·종결 후 정당).
--
-- 의존: 0010(encounters status/is_active·enforce_encounter_transition·_map_pg_sqlstate PT404/PT409),
--   0015(examinations/treatment_orders/prescriptions encounter_id·is_active·perform_examination·
--        perform_treatment_order·enforce_act_order_transition·enforce_prescription_transition),
--   0021(fee 트리거 — perform 게이트가 상류 차단·본 파일 무변경).

-- ── 1. 가드 함수 — 내원이 오더를 받을 수 있는 상태인지 검증(생성 트리거·perform RPC 공용) ───────────
-- 종결(completed/cancelled/no_show)·soft-deleted(is_active=false) → PT409. 미존재 → PT404.
-- SECURITY DEFINER: encounters RLS 우회 조회(트리거 INSERT·SECURITY DEFINER RPC 양 컨텍스트에서 actor 무관 평가).
create or replace function public.assert_encounter_orderable(p_encounter_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_active boolean;
begin
  select status, is_active into v_status, v_active
    from public.encounters
   where id = p_encounter_id;
  if not found then
    raise exception 'encounter not found: %', p_encounter_id using errcode = 'PT404';
  end if;
  if not v_active then
    raise exception 'encounter is not active (soft-deleted): %', p_encounter_id using errcode = 'PT409';
  end if;
  if v_status in ('completed', 'cancelled', 'no_show') then
    raise exception 'encounter is terminal, cannot accept orders: % (status=%)', p_encounter_id, v_status
      using errcode = 'PT409';
  end if;
end;
$$;

-- EXECUTE posture: 게이트는 SECURITY DEFINER 트리거/RPC(owner 컨텍스트)에서만 호출 → public/anon/authenticated 회수.
revoke all on function public.assert_encounter_orderable(uuid) from public, anon, authenticated;
grant execute on function public.assert_encounter_orderable(uuid) to service_role;

-- ── 2. 오더 생성 게이트 — BEFORE INSERT 트리거(examinations·treatment_orders·prescriptions 공용) ───────
-- 종결 내원에 신규 오더 INSERT 차단(직접 API·stale 탭 포함·db.py insert_* 는 RPC 아닌 직접 INSERT → DB 트리거가 권위).
-- SECURITY DEFINER: 가드(SECURITY DEFINER) 호출 + encounters 조회를 owner 컨텍스트로(authenticated INSERT 시에도).
-- 기존 전이 트리거(enforce_act_order_transition·enforce_prescription_transition)와 공존(둘 다 통과 필요).
create or replace function public.enforce_encounter_orderable_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_encounter_orderable(new.encounter_id);
  return new;
end;
$$;

drop trigger if exists trg_examinations_encounter_gate on public.examinations;
create trigger trg_examinations_encounter_gate
  before insert on public.examinations
  for each row execute function public.enforce_encounter_orderable_on_insert();

drop trigger if exists trg_treatment_orders_encounter_gate on public.treatment_orders;
create trigger trg_treatment_orders_encounter_gate
  before insert on public.treatment_orders
  for each row execute function public.enforce_encounter_orderable_on_insert();

drop trigger if exists trg_prescriptions_encounter_gate on public.prescriptions;
create trigger trg_prescriptions_encounter_gate
  before insert on public.prescriptions
  for each row execute function public.enforce_encounter_orderable_on_insert();

-- ── 3. 오더 수행 게이트 — perform RPC 재정의(0015 본문 + 게이트 1줄) ─────────────────────────────────
-- 종결 내원의 ordered 오더 수행 차단 → fee_items 미적재(deferred L346 청산·정산 종료 내원 청구액 사후 변조 방지).
-- 0015 본문 그대로 + 룩업 직후 assert_encounter_orderable 추가. 권한·소스상태 검사·전이·반환은 보존.
-- ⚠️ create or replace 는 EXECUTE grant 보존(0015 grant·재grant 불요 — 0010→4.7 complete_encounter 재정의 선례).

-- perform_examination: ordered → performed (방사선사 촬영 / 간호 검체 수행).
create or replace function public.perform_examination(p_examination_id uuid)
returns public.examinations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.examinations;
begin
  if not public.has_permission('examination.perform') then
    raise exception 'permission denied: examination.perform' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.examinations where id = p_examination_id for update;
  if not found then
    raise exception 'examination not found: %', p_examination_id using errcode = 'PT404';
  end if;
  perform public.assert_encounter_orderable(v_row.encounter_id);  -- 7.10 게이트: 종결 내원 수행 차단(수가 변조 방지)
  if v_row.status <> 'ordered' then  -- 소스 상태 선검사(이미 performed/completed 재수행 차단, FR-093)
    raise exception 'invalid examination transition: % -> performed', v_row.status using errcode = 'PT409';
  end if;
  update public.examinations
     set status = 'performed', performed_by = (select auth.uid()), performed_at = now(), updated_at = now()
   where id = p_examination_id
   returning * into v_row;
  return v_row;
end;
$$;

-- perform_treatment_order: ordered → performed (간호 처치 수행, FR-090·FR-092).
create or replace function public.perform_treatment_order(p_treatment_order_id uuid)
returns public.treatment_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.treatment_orders;
begin
  if not public.has_permission('treatment.perform') then
    raise exception 'permission denied: treatment.perform' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.treatment_orders where id = p_treatment_order_id for update;
  if not found then
    raise exception 'treatment order not found: %', p_treatment_order_id using errcode = 'PT404';
  end if;
  perform public.assert_encounter_orderable(v_row.encounter_id);  -- 7.10 게이트: 종결 내원 수행 차단(수가 변조 방지)
  if v_row.status <> 'ordered' then  -- 소스 상태 선검사(이미 performed 재수행 차단, FR-093)
    raise exception 'invalid treatment order transition: % -> performed', v_row.status using errcode = 'PT409';
  end if;
  update public.treatment_orders
     set status = 'performed', performed_by = (select auth.uid()), performed_at = now(), updated_at = now()
   where id = p_treatment_order_id
   returning * into v_row;
  return v_row;
end;
$$;
