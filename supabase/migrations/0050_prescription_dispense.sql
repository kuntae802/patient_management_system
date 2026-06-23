-- 0050_prescription_dispense.sql — 원외처방전 발급(issued→dispensed) 경로 + 처방전 내보내기 감사
-- Story 7.7 / FR-115(원무 원외처방전 출력·발급), FR-080(처방 생명주기 발행→발급·시스템 내 수행자 없음).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실). timestamptz=UTC. 불변식·감사는 DB 가 소유.
--
-- ⚠️ 파일 번호 0050: Epic 7 마이그 블록 0045~(0049_payment_receipt 다음).
--
-- ── Story 5.1 이월 청산 ──
--   처방 상태머신은 0015 가 이미 완성했다: status CHECK('issued','dispensed')·dispensed_at 컬럼·
--   enforce_prescription_transition(issued→dispensed 허용·재전이 PT409)·trg_prescriptions_audit.
--   그러나 발급 경로(권한 게이트·RPC)가 없어 현재 service_role 직접 UPDATE 로만 도달 가능했다 —
--   5.1 코드리뷰가 "dispense RPC + prescription.dispense 권한 = Epic 7(7.7)"로 명시 이월했다.
--   본 마이그레이션이 그 경로를 정석으로 완성한다(상태머신/CHECK/트리거/컬럼은 재정의 금지·0015 소유).
--
-- ── 설계 결정 4건(사용자 확정 2026-06-24·AskUserQuestion) ──
--   ① 발급 = 명시적 "발급 확정" 버튼 → dispense_prescription RPC(인쇄=감사·발급=상태전이 분리).
--   ② 발급 권한 = prescription.dispense 신규(reception+admin) — 문서 읽기 엔드포인트도 동일 게이트.
--   ③ 진입 = 수납 화면 처방전 섹션(finalize 무관 — 발행 처방만 있으면 출력·발급).
--   ④ 발급자 = 감사로그 actor 만(trg_prescriptions_audit 가 UPDATE 자동 기록·dispensed_by 컬럼 없음).
--
-- 의존: 0002(permissions·role_permissions·has_permission·users.license_no), 0004(audit_logs·action 'read'
--   CHECK·audit_trigger_fn), 0012(reveal_contact — actor 캡처 + 수동 'read' 감사 INSERT 선례),
--   0015(prescriptions·prescription_details·enforce_prescription_transition·trg_prescriptions_audit).

-- ════════════════════════════════════════════════════════════════════════════
-- Task 1 — 권한 카탈로그 확장 + admin 부트 grant
-- ════════════════════════════════════════════════════════════════════════════

-- prescription.dispense — 원외처방전 발급(issued→dispensed) 게이트. 발급은 원무 직무(FR-115)이며
--   발행(prescription.create·의사)과 별개. 비-admin grant(reception)는 seed.sql/1.7 매트릭스 소관.
insert into public.permissions (code, name, resource, action) values
  ('prescription.dispense', '처방전 발급', 'prescription', 'dispense')
on conflict (code) do nothing;

-- admin 부트 grant(신규 권한만; 비-admin grant 는 Story 1.7 매트릭스 UI/seed 소관). 멱등.
-- ⚠️ 필수: 0002 admin cross-join 은 후행 마이그레이션 권한을 자동 포함하지 않는다(누락 시
--    test_admin_role_has_all_permissions 회귀 — 0010·0012·0013·0014·0015·0021 가 겪은 함정).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'prescription.dispense'
where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- Task 2 — dispense_prescription RPC(issued → dispensed)
-- ════════════════════════════════════════════════════════════════════════════

-- 발급 전이 RPC — 0015 perform_examination 미러(SECURITY DEFINER·has_permission 자가 게이트·for update·
--   소스상태 선검사). status='issued' → 'dispensed' + dispensed_at=now(). dispensed_by 컬럼 없음(설계 ④
--   — 발급자는 trg_prescriptions_audit 가 actor 와 함께 자동 기록). 재발급(이미 dispensed)은 PT409.
create or replace function public.dispense_prescription(p_prescription_id uuid)
returns public.prescriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.prescriptions;
begin
  if not public.has_permission('prescription.dispense') then
    raise exception 'permission denied: prescription.dispense' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.prescriptions where id = p_prescription_id for update;
  if not found then
    raise exception 'prescription not found: %', p_prescription_id using errcode = 'PT404';
  end if;
  if v_row.status <> 'issued' then  -- 일방향(이미 dispensed 재발급 차단·FR-080)
    raise exception 'invalid prescription transition: % -> dispensed', v_row.status using errcode = 'PT409';
  end if;
  update public.prescriptions
     set status = 'dispensed', dispensed_at = now(), updated_at = now()
   where id = p_prescription_id
   returning * into v_row;
  return v_row;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- Task 3 — log_prescription_document_export(처방전 인쇄/내보내기 감사)
-- ════════════════════════════════════════════════════════════════════════════

-- 처방전 인쇄/내보내기를 'read' 감사 이벤트로 기록(UX-DR22 "민감 문서 인쇄/내보내기 자체가 감사").
--   0049 log_payment_document_export 미러하되 스코프 교체:
--     · 게이트 = prescription.dispense(payment.read 아님 — 처방 스코프).
--     · finalized 게이트 없음(0049 와의 결정적 차이) — 처방전은 결제 finalize 와 무관(발행 처방이면 출력).
--     · target_table='prescriptions'(payments 아님). raw PII(약품명·환자명·진단명·면허번호) 미적재.
create or replace function public.log_prescription_document_export(
  p_prescription_id uuid,
  p_document_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id        uuid;
  v_actor     uuid;
  v_actor_txt text;
begin
  if not public.has_permission('prescription.dispense') then
    raise exception 'permission denied: prescription.dispense' using errcode = 'insufficient_privilege';
  end if;

  select id into v_id from public.prescriptions where id = p_prescription_id;
  if v_id is null then
    raise exception 'prescription not found: %', p_prescription_id using errcode = 'PT404';
  end if;

  -- actor 캡처(0012 reveal_contact·0049 log_payment_document_export 미러: app.actor_id UUID 형식검증
  --   → auth.uid() 폴백·비-UUID 캐스트 abort 방지).
  v_actor_txt := nullif(current_setting('app.actor_id', true), '');
  v_actor := coalesce(
    case
      when v_actor_txt ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then v_actor_txt::uuid
    end,
    auth.uid()
  );

  -- 문서 내보내기 = 'read' 감사. document_type('prescription')은 after_data jsonb 로 구분.
  --   raw 값(약품명·환자명·진단·면허번호)은 저장하지 않는다(PII 경계 — prescription_id·document_type 만).
  insert into public.audit_logs (actor_id, action, target_table, target_id, after_data)
  values (
    v_actor, 'read', 'prescriptions', v_id::text,
    jsonb_build_object('document_type', p_document_type, 'event', 'document_export')
  );
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- Task 4 — EXECUTE posture
-- ════════════════════════════════════════════════════════════════════════════

-- dispense_prescription: RPC 가 has_permission 자체 게이트 → authenticated 직접 호출도 안전(방어심층·
--   0015 perform_* 동형). log_prescription_document_export: 감사 위조 차단 → service_role 전용
--   (0049 log_payment_document_export 동형).
revoke all on function public.dispense_prescription(uuid) from public, anon, authenticated;
grant execute on function public.dispense_prescription(uuid) to authenticated, service_role;

revoke all on function public.log_prescription_document_export(uuid, text)
  from public, anon, authenticated;
grant execute on function public.log_prescription_document_export(uuid, text) to service_role;
