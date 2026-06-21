-- 0012_patient_reveal.sql — 환자 민감정보 reveal 권한 + RPC(주민번호·연락처 열람 = 권한 게이트 + 감사)
-- Story 4.5 / FR-241(민감정보 암호화)·FR-242(민감정보 조회 = 감사) / UX-DR9·UX-DR22(모든 PII reveal 일관 게이트).
--
-- 설계 노트:
--   * 진료 허브 배너(의사)가 reveal 의 첫 소비처 — 0002(`patient.reveal_rrn` 권한)·0005(`decrypt_sensitive`
--     복호 자가-감사) 프리미티브를 여기서 처음 엔드포인트로 연결한다. 신규 컬럼·테이블 없음(권한 + RPC 만).
--   * 메커니즘 = SECURITY DEFINER RPC: ① `resident_no_enc` 는 authenticated GRANT 제외(0009:82~88)라
--     definer(owner)만 읽는다 ② RPC 안에서 `has_permission` 재평가(동일-txn TOCTOU + 방어심층 — FastAPI
--     require_permission 게이트는 1차선, start_consult 0010:145 동형) ③ 감사는 DB 가 기록(우회 불가):
--     RRN=`decrypt_sensitive` 자동 'read' 이벤트, 연락처=평문이라 복호 없음 → 수동 'read' insert(decrypt_sensitive
--     의 actor 캡처 계약 미러). "복호=감사"를 평문 연락처로 확장(UX-DR22 일관 게이트).
--   * 연락처(phone/address/email)는 평문 저장 유지(0009) — 암호화 마이그레이션 아님(평문 자가-감사 RPC).
--     ⚠️ 알려진 한계: GET /patients/{id} 는 여전히 평문 연락처를 반환(앱 전역 posture) — 서버측 마스킹은 deferred.
--   * 암복호/감사 RPC 는 service_role 한정(authenticated/anon 직접 호출 차단, FastAPI 경유만 — 0005 posture).
--
-- 의존: 0002(permissions·role_permissions), 0003(has_permission), 0004(audit_logs + action 'read' CHECK),
--       0005(decrypt_sensitive·actor 캡처 계약), 0009(patients.resident_no_enc·phone/address/email).

-- ── 신규 권한: 연락처 열람(patient.reveal_contact) ────────────────────────────
-- `patient.reveal_rrn` 은 0002 에 이미 존재(재삽입 금지). 연락처용 게이트만 신설.
insert into public.permissions (code, name, resource, action) values
  ('patient.reveal_contact', '연락처 열람', 'patient', 'reveal_contact')
on conflict (code) do nothing;

-- admin boot grant(신규 권한만 — ⚠️ 0002 admin cross-join 은 후행 권한을 자동 포함하지 않으므로 필수.
-- 누락 시 test_admin_role_has_all_permissions 회귀). 비-admin grant 는 Story 1.7 매트릭스 UI 소관. 멱등.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'patient.reveal_contact'
where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;

-- ── reveal_rrn: 주민번호 복호 + 자가-감사. service_role only ───────────────────
-- has_permission('patient.reveal_rrn') 동일-txn 재평가 → resident_no_enc 복호(decrypt_sensitive 가
-- 'read' 이벤트 자동 기록). full RRN 반환(호출 서비스가 응답 바디로만 노출 — 로그·에러 echo 금지).
create or replace function public.reveal_rrn(p_patient_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enc bytea;
begin
  if not public.has_permission('patient.reveal_rrn') then
    raise exception 'permission denied: patient.reveal_rrn' using errcode = 'insufficient_privilege';
  end if;
  select resident_no_enc into v_enc from public.patients where id = p_patient_id;
  if not found then
    raise exception 'patient not found: %', p_patient_id using errcode = 'PT404';
  end if;
  -- 복호 자체가 audit_logs 에 'read' 자가-기록(0005 decrypt_sensitive) — 여기서 별도 감사 insert 금지(이중 기록 방지).
  return public.decrypt_sensitive(v_enc, 'patients', p_patient_id::text);
end;
$$;

-- ── reveal_contact: 평문 연락처 조회 + 자가-감사. service_role only ────────────
-- 연락처는 평문이라 복호 없음 → 'read' 감사를 owner 권한으로 수동 insert(decrypt_sensitive 의 actor 캡처
-- 계약 미러: app.actor_id UUID 형식검증 → auth.uid() 폴백, 비-UUID 캐스트 abort 방지). full 연락처 반환.
create or replace function public.reveal_contact(p_patient_id uuid)
returns table (phone text, address text, email text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     uuid;
  v_actor_txt text;
begin
  if not public.has_permission('patient.reveal_contact') then
    raise exception 'permission denied: patient.reveal_contact' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.patients p where p.id = p_patient_id) then
    raise exception 'patient not found: %', p_patient_id using errcode = 'PT404';
  end if;

  v_actor_txt := nullif(current_setting('app.actor_id', true), '');
  v_actor := coalesce(
    case
      when v_actor_txt ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then v_actor_txt::uuid
    end,
    auth.uid()
  );

  -- 연락처 조회(reveal) = 'read' 감사(누가·언제·무엇을 reveal). raw 값(before/after)은 저장하지 않는다(PII 경계).
  insert into public.audit_logs (actor_id, action, target_table, target_id)
  values (v_actor, 'read', 'patients', p_patient_id::text);

  return query
    select p.phone, p.address, p.email from public.patients p where p.id = p_patient_id;
end;
$$;

-- ── 권한 posture: 직접 클라 호출 차단(service_role = FastAPI 경유만, 0005 미러) ──
revoke all on function public.reveal_rrn(uuid)     from public, anon, authenticated;
revoke all on function public.reveal_contact(uuid) from public, anon, authenticated;
grant execute on function public.reveal_rrn(uuid)     to service_role;
grant execute on function public.reveal_contact(uuid) to service_role;
