-- patient_management_system — seed.sql (골격)
-- db reset 시 마이그레이션 적용 후 실행된다 (config.toml [db.seed]).
--
-- 🟢 마스터 시드(Story 2.5): 진료과 · 진료실 · KCD 진단 · EDI 수가 · 약품 마스터 + 샘플(파일 하단).
--    데모/개발용 현재-유효 데이터(effective_from 과거 · effective_to NULL)로 검색 피커·골든 패스를 띄운다.
--    수가 자동발생 메커니즘·fee_items 적재는 Story 5.10(0021_billing). 진찰 매핑(fee_mappings) 초진/재진
--    동적 판정·payment.read·수납 스키마(payments)는 Story 7.1(0045_payments). 30일 재진규칙·진료과 가산·
--    정액제·약제비(약가 모델)·집계 적재(payment_details)는 Epic 7 후속(다운스트림 — 7.2/7.3 등).
--
-- 식별자는 영문 snake_case, 한국어는 표시명(display_name)·주석만 (docs/glossary.md 단일 진실).

-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ DEV ONLY — 로그인·인증/권한 검증용 테스트 직원 계정 (프로덕션 시드 아님)
--   실제 직원 계정 생성은 Story 1.8(관리자 UI). db reset 시 재생성됨.
--   로컬 자격증명(로컬 전용, 절대 운영 사용 금지, 전부 비번 Staff1234):
--     · admin@pms.local      role=admin     → 23권한 전부(Story 1.3 시드)  → require_permission 통과
--     · doctor@pms.local     role=doctor    → encounter.read/start(4.4) + patient.read/reveal_rrn/reveal_contact(4.5)
--       + medical_record.write/read(4.6) + diagnosis.attach/read·encounter.complete(4.7) 보유 → 진료 대기·진찰
--       시작 + 진료 허브 환자 배너·임상 프로필·RRN/연락처 reveal + SOAP 진료기록 작성·조회 + 진단 부착·진료 완료 골든 패스.
--       rbac.manage 등 그 외 권한은 미보유 → /auth/check 등은 여전히 403(Story 1.5 매트릭스 검증).
--     · nurse@pms.local      role=nurse     → encounter.*/patient.* 권한 0(그쪽 403 baseline, Story 4.4/4.5).
--       Story 5.1 부터 오더 권한(order.read·examination.perform·treatment.perform) 보유 → 검체/처치 수행 골든 패스.
--       ⚠️ 오더 도메인 403 baseline 은 reception(임상 오더 권한 0)으로 이동.
--     · reception@pms.local  role=reception → encounter.register/read/call 보유(하단 grant) → walk-in 접수·호출
--       골든 패스 가동(Story 4.2/4.3). 역할 grant 는 데모/통합테스트용 — 프로덕션은 1.7 매트릭스가 부여.
--     · radiologist@pms.local role=radiologist → order.read·examination.perform 보유(5.1 grant) → 촬영 워크리스트·
--       영상 업로드·촬영 수행 골든 패스(Story 5.8). 촬영 수행 403 baseline = reception + doctor(perform 무).
--   ★ 안전: seed.sql 은 로컬 `supabase db reset` 에서만 실행된다. 운영 배포는 `supabase db push`
--     (마이그레이션만, seed 미실행)이므로 클라우드에 이 계정이 생기지 않는다.
--     🚫 `supabase db reset --linked`(클라우드 대상)는 절대 실행 금지 — DB 전체가 초기화된다.
--   pgcrypto(crypt/gen_salt)는 extensions 스키마(0001)라 스키마 한정 호출.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  -- 테스트 직원 명단(uid·email·employee_no·name·role_code)
  v_accounts constant jsonb := jsonb_build_array(
    jsonb_build_object('uid','000000a1-0000-4000-8000-0000000000a1',
      'email','admin@pms.local','employee_no','EMP0001','name','관리자(테스트)','role','admin'),
    jsonb_build_object('uid','000000a2-0000-4000-8000-0000000000a2',
      'email','doctor@pms.local','employee_no','EMP0002','name','의사(테스트)','role','doctor'),
    jsonb_build_object('uid','000000a3-0000-4000-8000-0000000000a3',
      'email','reception@pms.local','employee_no','EMP0003','name','원무(테스트)','role','reception'),
    -- 무권한 baseline(Story 4.4) — doctor 가 encounter.read/start 를 받으면 admin·reception·doctor 셋 다
    -- encounter.read 보유 → "권한 미보유 403" 검증 계정이 사라진다. nurse(간호 권한=Epic 5) 가 그 baseline.
    jsonb_build_object('uid','000000a4-0000-4000-8000-0000000000a4',
      'email','nurse@pms.local','employee_no','EMP0004','name','간호사(테스트)','role','nurse'),
    -- 방사선사(Story 5.8) — 촬영 워크리스트·영상 업로드·촬영 수행(order.read·examination.perform = 위 5.1 grant 기보유).
    --   촬영 수행 403 baseline = reception(임상 오더 권한 0) + doctor(examination.order 有·examination.perform 無).
    jsonb_build_object('uid','000000a5-0000-4000-8000-0000000000a5',
      'email','radiologist@pms.local','employee_no','EMP0005','name','방사선사(테스트)','role','radiologist')
  );
  v_acct jsonb;
  v_uid uuid;
  v_role_id uuid;
begin
  for v_acct in select * from jsonb_array_elements(v_accounts)
  loop
    v_uid := (v_acct->>'uid')::uuid;

    select id into v_role_id from public.roles where code = v_acct->>'role';
    if v_role_id is null then
      raise exception '% 역할이 시드되지 않음 — 0002_identity_rbac 를 먼저 적용하세요',
        v_acct->>'role';
    end if;

    if not exists (select 1 from auth.users where id = v_uid) then
      -- ⚠️ GoTrue는 토큰 text 컬럼을 non-nullable string으로 스캔 → NULL이면 로그인 시
      --    "Database error querying schema"(500). 수동 삽입 시 빈 문자열('')로 채워야 함.
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data, is_super_admin,
        confirmation_token, recovery_token, email_change, email_change_token_new,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token
      ) values (
        '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
        v_acct->>'email', extensions.crypt('Staff1234', extensions.gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}', '{}', false,
        '', '', '', '', '', '', '', ''
      );

      insert into auth.identities (
        id, user_id, identity_data, provider, provider_id,
        created_at, updated_at, last_sign_in_at
      ) values (
        gen_random_uuid(), v_uid,
        jsonb_build_object('sub', v_uid::text, 'email', v_acct->>'email'),
        'email', v_uid::text, now(), now(), now()
      );
    end if;

    insert into public.users (id, employee_no, name, role_id)
    values (v_uid, v_acct->>'employee_no', v_acct->>'name', v_role_id)
    on conflict (id) do nothing;
  end loop;
end $$;

-- ── (DEV/데모) 원무(reception) 역할 → 내원 접수 권한 grant (Story 4.2) ──────────────────────
-- 접수(encounter.register)·내원 조회(encounter.read)는 원무 직무 본질(walk-in 접수 골든 패스 가동).
-- 0002/0010 의 admin cross-join grant 패턴 미러 · 멱등. ★ 프로덕션 런타임 grant 는 Story 1.7 RBAC
-- 매트릭스 UI 소유(rbac-ui-exposure-model: 직무 핵심은 역할 노출) — 이 시드는 로컬 db reset 전용
-- (데모·통합테스트 가동, 운영 db push 엔 미반영). encounter.register 는 0002, read 는 0010 시드.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('encounter.register', 'encounter.read')
where r.code = 'reception'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 원무(reception) 역할 → 환자 호출 권한 grant (Story 4.3) ──────────────────────
-- 대기 현황판 "다음 호출"(encounter.call)은 원무 직무 본질(접수→호출→진찰 골든 패스 가동). 0011 시드.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'encounter.call'
where r.code = 'reception'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 의사(doctor) 역할 → 진료 대기·진찰 시작 권한 grant (Story 4.4) ──────────────────
-- 의사 보드 접근(encounter.read)·진찰 시작(encounter.start)은 의사 핵심 직무 — 진료 대기열 조회 +
-- start_consult 골든 패스 가동(접수→호출→진찰). encounter.read/start 는 0002/0010 시드, 여기선 역할
-- 매핑만. ★ 프로덕션 런타임 grant 는 Story 1.7 RBAC 매트릭스 UI 소유(rbac-ui-exposure-model: 직무
-- 핵심은 역할 노출) — 이 시드는 로컬 db reset 전용(데모·통합테스트, 운영 db push 엔 미반영). 멱등.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('encounter.read', 'encounter.start')
where r.code = 'doctor'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 의사(doctor) 역할 → 진료 허브 환자 컨텍스트 권한 grant (Story 4.5) ──────────────
-- 진료 허브 배너·좌 컨텍스트는 의사 핵심 직무: 환자 신원·임상 프로필·과거 이력 조회(`patient.read`) +
-- 임상 안전상 주민번호·연락처 reveal(`patient.reveal_rrn`/`patient.reveal_contact` — 권한 게이트 + 감사).
-- reveal 권한 보유는 admin·doctor 뿐(reception 등은 1.7 매트릭스 소관). patient.read 는 0009, reveal_rrn 은
-- 0002, reveal_contact 는 0012 시드 — 여기선 역할 매핑만. ★ 프로덕션 런타임 grant 는 1.7 매트릭스 UI 소유
-- (rbac-ui-exposure-model: 민감·reveal 은 권한 게이트) — 이 시드는 로컬 db reset 전용(운영 db push 미반영). 멱등.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('patient.read', 'patient.reveal_rrn', 'patient.reveal_contact')
where r.code = 'doctor'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 의사(doctor) 역할 → SOAP 진료기록 작성·조회 권한 grant (Story 4.6) ──────────────
-- 진료 허브 중앙 SOAP ledger 작성(`medical_record.write`, 0002 기존)·조회(`medical_record.read`, 0013 신규)
-- 는 의사 핵심 직무. medical_record.read 는 의사·관리자만(원무·간호는 임상 SOAP 미열람 — 최소권한).
-- ★ 프로덕션 런타임 grant 는 1.7 매트릭스 UI 소유 — 이 시드는 로컬 db reset 전용(운영 db push 미반영). 멱등.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('medical_record.write', 'medical_record.read')
where r.code = 'doctor'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 의사(doctor) 역할 → 진단 부착·조회·진료 완료 권한 grant (Story 4.7) ──────────────
-- 진단 블록 KCD 부착(`diagnosis.attach`, 0002 기존)·조회(`diagnosis.read`, 0014 신규)·주상병 게이트
-- 동반 진료 완료(`encounter.complete`, 0002 기존)는 의사 핵심 직무. diagnosis.read 는 의사·관리자만
-- (원무·간호는 진단 미열람 — 최소권한). ★ 프로덕션 런타임 grant 는 1.7 매트릭스 UI 소유 — 이 시드는
-- 로컬 db reset 전용(운영 db push 미반영). 멱등.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('diagnosis.attach', 'diagnosis.read', 'encounter.complete')
where r.code = 'doctor'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) Epic 5 오더 권한 grant — 의사·간호·방사선 (Story 5.1) ──────────────────────
-- 오더 도메인은 직역 분담: 의사=조회+판독, 간호=조회+검체/처치 수행, 방사선사=조회+촬영 수행. order.read 는
-- 임상 3역(의사·간호·방사선)만(원무 제외 = 최소권한). order.read/examination.perform/examination.complete 는
-- 0015 신규, treatment.perform 는 0002 기존 — 여기선 역할 매핑만. ★ 프로덕션 런타임 grant 는 1.7 매트릭스 UI
-- 소유 — 이 시드는 로컬 db reset 전용(운영 db push 미반영). 멱등.
-- ⚠️ baseline 이동: nurse 가 오더 권한을 받으므로 nurse 는 더 이상 "오더" 무권한 baseline 이 아니다(여전히
--    encounter.*/patient.* 권한 0 → 그쪽 4.4/4.5 baseline 은 유지·무영향). **오더 403 검증 baseline = reception**
--    (임상 오더 권한 0). radiologist 데모 계정 = EMP0005(Story 5.8 신설, 위 v_accounts) → 본 grant 가 그 계정에 적용.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('order.read', 'examination.complete')
where r.code = 'doctor'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('order.read', 'examination.perform', 'treatment.perform')
where r.code = 'nurse'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('order.read', 'examination.perform')
where r.code = 'radiologist'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 의사(doctor) 역할 → 처방 발행 권한 grant (Story 5.2) ──────────────────────────
-- 처방전 발행(`prescription.create`)은 의사 핵심 직무. ⚠️ prescription.create 는 **0002 기존 권한**
-- (0015 신규 아님) — admin 은 0002 cross-join 으로 이미 보유하므로 **admin 부트 grant 재실행 불요**
-- (4.6/4.7/5.1 의 "신규권한→admin 재grant" 함정 비해당, test_admin_role_has_all_permissions 회귀 0).
-- 처방 조회는 order.read(doctor 가 5.1 에서 이미 보유) → 여기선 발행 권한만. ★ 프로덕션 런타임 grant 는
-- 1.7 매트릭스 UI 소유 — 이 시드는 로컬 db reset 전용. 멱등.
-- ⚠️ 처방 발행 403 검증 baseline = reception(오더 권한 0) + nurse(order.read 보유·prescription.create
--    미보유 = read-yes/create-no). nurse 의 encounter/patient baseline 은 비중첩이라 무영향.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('prescription.create')
where r.code = 'doctor'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 의사(doctor) 역할 → 검사·영상 오더 권한 grant (Story 5.3) ──────────────────────────
-- 검사·영상 오더(`examination.order`)는 의사 핵심 직무. ⚠️ examination.order 는 **0002 기존 권한**
-- (0015 신규 아님 — 0002:94) — admin 은 0002 cross-join 으로 이미 보유하므로 **admin 부트 grant 재실행 불요**
-- (5.1 의 "신규권한(order.read/examination.perform/complete)→admin 재grant" 함정 비해당, 회귀 0).
-- 검사·영상 조회는 order.read(doctor 가 5.1 에서 이미 보유) → 여기선 오더 권한만. ★ 프로덕션 런타임 grant 는
-- 1.7 매트릭스 UI 소유 — 이 시드는 로컬 db reset 전용. 멱등.
-- ⚠️ 검사·영상 오더 403 baseline = reception(오더 권한 0) + nurse(order.read 보유·examination.order
--    미보유 = read-yes/order-no). nurse 의 encounter/patient baseline 은 비중첩이라 무영향.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('examination.order')
where r.code = 'doctor'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 의사(doctor) 역할 → 처치 오더 권한 grant (Story 5.4) ──────────────────────────
-- 처치 오더(`treatment.order`)는 의사 핵심 직무. ⚠️ treatment.order 는 **0002 기존 권한**
-- (0015 신규 아님 — 0002:95) — admin 은 0002 cross-join 으로 이미 보유하므로 **admin 부트 grant 재실행 불요**
-- (5.1 의 "신규권한→admin 재grant" 함정 비해당, test_admin_role_has_all_permissions 회귀 0).
-- 처치 조회는 order.read(doctor 가 5.1 에서 이미 보유) → 여기선 오더 권한만. ★ 프로덕션 런타임 grant 는
-- 1.7 매트릭스 UI 소유 — 이 시드는 로컬 db reset 전용. 멱등.
-- ⚠️ 처치 오더 403 baseline = reception(오더 권한 0) + nurse(order.read·treatment.perform 보유·treatment.order
--    미보유 = read-yes/order-no). nurse 의 encounter/patient baseline 은 비중첩이라 무영향.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('treatment.order')
where r.code = 'doctor'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 간호사(nurse) 역할 → 활력징후 기록 권한 grant (Story 5.6) ──────────────────────
-- 활력징후 기록(`vital.record`)은 간호 직무 본질 → 역할로 노출(rbac-ui-exposure-model). ⚠️ vital.record 는
-- **0002 기존 권한**(0002:97 — 0017 신규 아님) — admin 은 0002 cross-join 으로 이미 보유하므로 **admin 부트
-- grant 재실행 불요**(5.2/5.3/5.4 의 "기존권한 소비" 동형, test_admin_role_has_all_permissions 회귀 0).
-- 여기선 nurse 역할 매핑만. ★ 프로덕션 런타임 grant 는 1.7 매트릭스 UI 소유 — 이 시드는 로컬 db reset 전용. 멱등.
-- ⚠️ 활력 기록 403 baseline = reception(임상 기록 권한 0) + doctor(encounter.read 보유·vital.record 미보유 =
--    read-yes/record-no). nurse 의 encounter/patient baseline(4.4/4.5)은 비중첩이라 무영향(nurse encounter.read 0 유지).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('vital.record')
where r.code = 'nurse'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 간호사(nurse) 역할 → 일상 간호기록 권한 grant (Story 5.7) ──────────────────────
-- 일상 간호기록(`nursing.record`)은 간호 직무 본질(0002:76 nurse='처치·활력징후·간호기록') → 역할로 노출.
-- ⚠️ nursing.record 는 **0018 신규 권한**(admin 은 0018 부트 재grant 로 보유 — 0017 vital.record 와 다른 점,
--    0002 미존재 권한이라 신규 도입) → 여기선 nurse 역할 매핑만. ★ 프로덕션 런타임 grant 는 1.7 매트릭스 UI
--    소유 — 이 시드는 로컬 db reset 전용. 멱등.
-- ⚠️ 처치 수행(`treatment.perform`)은 nurse 가 이미 보유(seed.sql:178·Story 5.1 — order.read/examination.perform
--    과 함께 grant) → 추가 grant 없음. 본 스토리 nurse seed 변경 = nursing.record 1건뿐.
-- ⚠️ 403 baseline: ① 처치 수행 = reception(권한 0) + doctor(treatment.order 보유·treatment.perform 미보유 =
--    order-yes/perform-no, 처치 오더 baseline 역전) · ② 일상 간호기록 = reception + doctor(nursing.record 미보유).
--    nurse 의 encounter/patient baseline(4.4/4.5)은 비중첩이라 무영향(nurse encounter.read 0 유지).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('nursing.record')
where r.code = 'nurse'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 원무(reception) 역할 → 예약 슬롯 조회 권한 grant (Story 6.2) ──────────────────────
-- 가용 슬롯 조회·예약 피커(appointment.read)는 원무 직무 본질(전화·방문 예약 흐름 6.4 가동). appointment.read
-- 는 0031 신규 — 여기선 역할 매핑만. ★ 프로덕션 런타임 grant 는 1.7 매트릭스 UI 소유 — 이 시드는 로컬
-- db reset 전용(운영 db push 미반영). 멱등.
-- ⚠️ appointment 403 검증 baseline = nurse(appointment.read 미보유; 의사·환자 grant 는 6.4/6.5).
--    reception 이 appointment.read 를 받아도 encounter/patient/order baseline 은 비중첩 유지(무영향).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'appointment.read'
where r.code = 'reception'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 원무(reception) 역할 → 예약 생성 권한 grant (Story 6.3) ──────────────────────────
-- booking-peek 예약 저장(appointment.create)은 원무 직무 본질(전화·방문 대리 예약). appointment.create
-- 는 0032 신규 — 여기선 역할 매핑만. ★ 프로덕션 런타임 grant 는 1.7 매트릭스 UI 소유 — 이 시드는 로컬
-- db reset 전용(운영 db push 미반영). 멱등.
-- ⚠️ appointment 403 검증 baseline = nurse(appointment.create·read 둘 다 미보유; 환자 grant 는 6.5).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'appointment.create'
where r.code = 'reception'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 원무(reception) 역할 → 예약 변경·취소 권한 grant (Story 6.4) ──────────────────────
-- 변경·취소·노쇼·도착접수(appointment.update)는 원무 직무 본질(전화·방문 대리 예약 생명주기). appointment.update
-- 는 0033 신규 — 여기선 역할 매핑만. ★ 프로덕션 런타임 grant 는 1.7 매트릭스 UI 소유 — 로컬 db reset 전용. 멱등.
-- ⚠️ appointment 403 baseline = nurse(appointment.* 전무). 도착접수의 내원 생성은 encounter.register(reception 보유, 4.2).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'appointment.update'
where r.code = 'reception'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 원무(reception) 역할 → 알림 조회·디스패치 권한 grant (Story 6.6) ───────────────────
-- 리마인더 로그 조회(notification.read)·디스패치 실행(notification.send)은 원무 운영 본질(예약 운영의
-- 일부). 둘 다 0035 신규 — 여기선 역할 매핑만. ★ 프로덕션 런타임 grant 는 1.7 매트릭스 UI 소유 — 로컬
-- db reset 전용(운영 db push 미반영). 멱등.
-- ⚠️ notification 403 검증 baseline = nurse(read·send 둘 다 미보유). reception 이 notification.* 를 받아도
--    encounter/patient/order baseline 은 비중첩 유지(무영향).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('notification.read', 'notification.send')
where r.code = 'reception'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 의사·원무 역할 → 수가항목 조회 권한 grant (Story 5.10) ───────────────────
-- 수가항목 조회(fee_item.read)는 의사(진료 중 발생 수가 확인)·원무(수납 정산 — Epic 7 소비자) 직무 본질
-- (rbac-ui-exposure-model: 직무 핵심은 역할로 노출). fee_item.read 는 0021 신규 — 여기선 역할 매핑만
-- (admin 부트 grant 는 0021 이 수행). nurse/radiologist 미포함(조회 최소권한 — 수가 정산은 의사·원무).
-- ★ 프로덕션 런타임 grant 는 1.7 매트릭스 UI 소유 — 로컬 db reset 전용. 멱등.
-- ⚠️ fee_item.read 403 검증 baseline = nurse(미보유). reception 이 받아도 order baseline 은 비중첩 유지.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'fee_item.read'
where r.code in ('doctor', 'reception')
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 의사·원무 역할 → 수납 조회 권한 grant (Story 7.1) ───────────────────
-- 수납 조회(payment.read)는 원무(수납 정산 — Epic 7 핵심 직무)·의사(진료비 확인) 직무 본질
-- (rbac-ui-exposure-model: 직무 핵심은 역할로 노출). payment.read 는 0045 신규 — 여기선 역할 매핑만
-- (admin 부트 grant 는 0045 가 수행). nurse/radiologist 미포함(조회 최소권한 — 수납은 원무·의사).
-- ★ 프로덕션 런타임 grant 는 1.7 매트릭스 UI 소유 — 로컬 db reset 전용. 멱등.
-- ⚠️ payment.read 403 검증 baseline = nurse(미보유). 쓰기 권한(payment.manage)은 아래(7.2 도입).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'payment.read'
where r.code in ('doctor', 'reception')
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 원무 역할 → 수납 관리(쓰기) 권한 grant (Story 7.2) ───────────────────
-- 수납 관리(payment.manage)는 집계 빌드(7.2)·finalize(7.4)를 게이트하는 쓰기 권한. 수납 정산 = 원무
-- 직무 본질 → reception 만(rbac-ui-exposure-model). 의사는 payment.read 조회만(정산 쓰기 없음).
-- payment.manage 는 0046 신규 — 여기선 역할 매핑만(admin 부트 grant 는 0046 가 수행). 멱등.
-- ⚠️ payment.manage 403 검증 baseline = doctor·nurse(미보유 — 빌드 거부).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'payment.manage'
where r.code = 'reception'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 원무 역할 → 처방전 발급(prescription.dispense) 권한 grant (Story 7.7) ──────
-- 처방전 발급(issued→dispensed)은 원무 직무 — 원무가 원외처방전을 출력·발급한다(FR-115·rbac-ui-
-- exposure-model). prescription.dispense 는 0050 신규 — 여기선 역할 매핑만(admin 부트 grant 는 0050 가
-- 수행). 발행(prescription.create)은 의사 직무이며 발급과 별개. 멱등 · db reset 전용(운영 미반영).
-- ⚠️ 비중첩 baseline: reception 의 "오더 권한 0" baseline(prescription.create·order.read·examination.*·
--    treatment.* 미보유 → 발행/조회/수행 403)은 그대로 유지된다 — prescription.dispense 는 별개 권한이라
--    오더 발행/수행 baseline 에 영향 없음(reception 은 여전히 발행·조회·수행 불가, 발급만 가능).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'prescription.dispense'
where r.code = 'reception'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 원무 역할 → 진료 완료(encounter.complete) 권한 grant (Story 7.4) ──────
-- 7.4 finalize_payment 가 결제 확정 시 complete_encounter(내원 in_progress→completed)를 호출한다.
-- 이 PMS 는 진료 후에도 내원이 in_progress 로 유지되고(billing 워크리스트=in_progress 필터·7.2),
-- **결제 finalize 가 완료 전이의 트리거** → 내원 완료 = 원무 정산 직무의 일부(rbac-ui-exposure-model).
-- encounter.complete 는 0002 기존(4.7 에서 doctor 에 grant) — 여기선 reception 역할 매핑만(신규 권한 0).
-- ⚠️ baseline 이동: reception 은 더 이상 encounter.complete 무권한이 아니다(4.7 의 reception 403 가정 갱신).
-- ★ 프로덕션 런타임 grant 는 1.7 매트릭스 UI 소유 — 로컬 db reset 전용. 멱등.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'encounter.complete'
where r.code = 'reception'
on conflict (role_id, permission_id) do nothing;

-- ── (DEV/데모) 원무 역할 → 내원 취소(encounter.cancel) 권한 grant (Story 7.9) ──────
-- 7.9 settle_cancelled_visit 가 취소·노쇼 정산 시 cancel_encounter(내원 registered→cancelled)를 호출한다.
-- 취소·노쇼 = 수가 미발생 + 선납 환급 = 원무 정산 직무의 일부(rbac-ui-exposure-model·결제 도메인 수납 일원화).
-- encounter.cancel 은 0010 기존(카탈로그 + admin 부트 grant) — 여기선 reception 역할 매핑만(신규 권한 0·재grant 불요).
-- ⚠️ baseline 이동: reception 은 더 이상 encounter.cancel 무권한이 아니다(취소 정산 직무 — 403 검증 baseline=nurse·doctor).
-- ★ 프로덕션 런타임 grant 는 1.7 매트릭스 UI 소유 — 로컬 db reset 전용. 멱등.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'encounter.cancel'
where r.code = 'reception'
on conflict (role_id, permission_id) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 마스터 시드 (Story 2.5) — 진료과 · 진료실 · KCD 진단 · EDI 수가 · 약품
-- ════════════════════════════════════════════════════════════════════════════
--   설계 규칙(반드시 유지):
--   1) 코드 행은 전부 "현재 유효"(소비처 피커 술어 isCurrentlyValid):
--      effective_from 과거(2020-01-01) · effective_to NULL(무기한) · is_active=true(default).
--      effective_from 이 미래면 'pending' 으로 피커 미노출 → 시연이 깨진다.
--   2) 멱등: ON CONFLICT (lower(code)) DO NOTHING. ★ 0008 이 code 컬럼 UNIQUE 제약을
--      lower(code) 함수 인덱스로 교체했으므로 `ON CONFLICT (code)` 는 에러("no unique ...
--      matching") — 반드시 (lower(code)) 로 추론한다. db reset 시 빈 테이블이라 충돌 없이 적재,
--      수동 재실행(psql -f) 시에도 중복 0.
--   3) rooms.department_id → departments(id) FK: departments 를 먼저 적재하고 rooms 는
--      코드 서브셀렉트로 참조(하드코딩 UUID 회피). 공용 공간(처치실·영상실)은 department_id NULL.
--   4) 식별자(code)는 영문/대문자 일관, 한국어는 name(표시명)·주석만. 금액은 KRW 정수.
--   5) 시드 INSERT 는 0004/0006/0007 감사 트리거를 발화시켜 audit_logs 에 actor_id=NULL·
--      action='create' 로 기록된다(append-only·FK 부재 — INSERT 무차단). 정상이며 별도 처리 불요.
--   6) 코드·단가는 심평원 표준 '형식'의 그럴듯한 데모값(규제 100% 정합이 아니라 믿을 만한 시연이 기준).
--      행위/진단 → 수가코드 '매핑'(fee_mappings)은 Epic 7 — 여기선 수가 '마스터 행'만 적재.

-- ── 요양기관 정보 (clinic_profile) — 영수증 헤더용 단일행 (Story 7.5) ─────────
-- 진료비 계산서·영수증(7.5)·세부산정내역서(7.6) 헤더의 병원명·사업자번호·요양기관기호·주소·대표자·전화.
-- 단일행(id=1·요양기관 단일 운영). 데모값(심평원 표준 '형식'의 그럴듯한 시연값). 멱등 = id 충돌 시 갱신.
insert into public.clinic_profile (id, name, biz_no, hira_no, address, ceo_name, phone) values
  (1, '○○의원', '123-45-67890', '31234567', '서울특별시 ○○구 ○○로 123, 4층', '박○○', '02-123-4567')
on conflict (id) do update set
  name = excluded.name, biz_no = excluded.biz_no, hira_no = excluded.hira_no,
  address = excluded.address, ceo_name = excluded.ceo_name, phone = excluded.phone,
  updated_at = now();

-- ── 진료과 (departments) — 외래 중소병원 7개 ────────────────────────────────
insert into public.departments (code, name, description) values
  ('IM',   '내과',         '고혈압·당뇨·소화기 등 성인 내과 외래'),
  ('FM',   '가정의학과',   '감기·예방접종·만성질환 1차 진료'),
  ('OS',   '정형외과',     '근골격계 통증·외상·관절 질환'),
  ('ENT',  '이비인후과',   '비염·인후염·중이염 등 귀·코·목'),
  ('PED',  '소아청소년과', '소아 감염·성장·예방접종'),
  ('DERM', '피부과',       '피부염·알레르기·미용 외 일반 피부'),
  ('SU',   '외과',         '창상 처치·소수술·일반외과 외래')
on conflict (lower(code)) do nothing;

-- ── 진료실 (rooms) — 진료실 6 + 공용 2 ──────────────────────────────────────
insert into public.rooms (code, name, department_id) values
  ('R101', '제1진료실', (select id from public.departments where lower(code) = lower('IM'))),
  ('R102', '제2진료실', (select id from public.departments where lower(code) = lower('FM'))),
  ('R103', '제3진료실', (select id from public.departments where lower(code) = lower('OS'))),
  ('R104', '제4진료실', (select id from public.departments where lower(code) = lower('ENT'))),
  ('R105', '제5진료실', (select id from public.departments where lower(code) = lower('PED'))),
  ('R106', '제6진료실', (select id from public.departments where lower(code) = lower('DERM'))),
  ('TRT1', '처치실',     null),
  ('XR1',  '영상촬영실', null)
on conflict (lower(code)) do nothing;

-- ── KCD 진단 (diagnoses) — 외래 흔한 상병 22개 (KCD-8 형식) ──────────────────
-- effective_from 과거 · effective_to NULL = 현재 유효(피커 노출). 코드는 KCD 표기 그대로(소수 세분류 포함).
-- patient_friendly_note(0054·Story 8.1) = 환자 포털 "내 기록" 쉬운 말 부연(예: "고혈압 (혈압이 높은 상태)").
-- 마스터 단일 진실 — 부연 값은 여기서 소유(마이그 0054 는 컬럼만). 없으면 NULL → 클라가 진단명만 표시.
insert into public.diagnoses (code, name, patient_friendly_note, effective_from, effective_to) values
  ('J00',   '급성 비인두염[감기]',                       '목감기·코감기',                  '2020-01-01', null),
  ('J02.9', '상세불명의 급성 인두염',                     '목이 붓고 아픈 상태',            '2020-01-01', null),
  ('J03.9', '상세불명의 급성 편도염',                     '편도가 부은 상태',               '2020-01-01', null),
  ('J20.9', '상세불명의 급성 기관지염',                   '기침·가래가 나는 기관지 염증',    '2020-01-01', null),
  ('J30.4', '상세불명의 알레르기비염',                    '코 알레르기(재채기·콧물)',        '2020-01-01', null),
  ('J45.9', '상세불명의 천식',                            '숨이 차고 기침이 나는 호흡기 질환', '2020-01-01', null),
  ('I10',   '본태성(원발성) 고혈압',                       '혈압이 높은 상태',               '2020-01-01', null),
  ('E11.9', '합병증을 동반하지 않은 2형 당뇨병',           '혈당이 높은 상태',               '2020-01-01', null),
  ('E78.5', '상세불명의 고지질혈증',                       '피 속 지방(콜레스테롤)이 높은 상태', '2020-01-01', null),
  ('K21.9', '식도염을 동반하지 않은 위-식도역류병',         '위산이 식도로 올라오는 상태',      '2020-01-01', null),
  ('K29.7', '상세불명의 위염',                            '위에 생긴 염증',                 '2020-01-01', null),
  ('K59.0', '변비',                                       '변을 보기 어려운 상태',          '2020-01-01', null),
  ('A09',   '감염성 및 상세불명 기원의 위장염 및 결장염',   '장에 생긴 염증(설사·복통)',       '2020-01-01', null),
  ('M54.5', '요통',                                       '허리 통증',                      '2020-01-01', null),
  ('M25.50','상세불명 부위의 관절통',                      '관절이 아픈 상태',               '2020-01-01', null),
  ('M75.0', '어깨의 유착성 관절낭염(오십견)',              '어깨가 굳어 아픈 상태(오십견)',    '2020-01-01', null),
  ('M79.1', '근육통',                                     '근육이 아픈 상태',               '2020-01-01', null),
  ('L20.9', '상세불명의 아토피피부염',                     '가렵고 건조한 피부 염증(아토피)',  '2020-01-01', null),
  ('L30.9', '상세불명의 피부염',                           '피부에 생긴 염증',               '2020-01-01', null),
  ('N39.0', '부위가 명시되지 않은 요로감염',               '소변길에 생긴 감염',             '2020-01-01', null),
  ('R51',   '두통',                                       '머리가 아픈 상태',               '2020-01-01', null),
  ('R50.9', '상세불명의 열',                               '열이 나는 상태',                 '2020-01-01', null)
on conflict (lower(code)) do nothing;

-- ── EDI 수가 (fee_schedules) — 진찰·검사·영상·처치·주사 18개 ─────────────────
-- amount_krw = KRW 정수(소수 없음·>=0). category 는 그룹 라벨. 코드·단가는 심평원 형식의 데모값.
-- coverage_type(급여 covered / 비급여 non_covered, Story 5.5) = pay-chip·수가 프리뷰 분류. 비급여=물리치료성
-- 일부(MM070 핫팩·MM151 TENS) 데모 근사 — 정확 급여분류는 건보 고시 의존(과제 범위 밖). 본인부담 산정=Epic7.
insert into public.fee_schedules (code, name, amount_krw, category, coverage_type, effective_from, effective_to) values
  ('AA154', '초진진찰료(의원)',              17610, '진찰료', 'covered',     '2020-01-01', null),
  ('AA254', '재진진찰료(의원)',              12590, '진찰료', 'covered',     '2020-01-01', null),
  ('C3800', '일반혈액검사(CBC)',              3500, '검사료', 'covered',     '2020-01-01', null),
  ('C5400', '요검사(요화학 정성)',            1500, '검사료', 'covered',     '2020-01-01', null),
  ('D2700', '당화혈색소(HbA1c)',              6000, '검사료', 'covered',     '2020-01-01', null),
  ('E6541', '심전도검사(표준 12유도)',        5460, '검사료', 'covered',     '2020-01-01', null),
  ('F6310', '알레르기 피부반응검사',           8000, '검사료', 'non_covered', '2020-01-01', null),
  ('HB010', '비내시경검사',                  12000, '검사료', 'covered',     '2020-01-01', null),
  ('HA201', '흉부 단순촬영(1매)',             9030, '영상료', 'covered',     '2020-01-01', null),
  ('HA401', '복부 단순촬영(1매)',             9500, '영상료', 'covered',     '2020-01-01', null),
  ('M0030', '단순처치(드레싱, 100㎠ 미만)',    4500, '처치료', 'covered',     '2020-01-01', null),
  ('M0040', '창상봉합술(안면 외, 2.5cm 미만)',30000, '처치료', 'covered',     '2020-01-01', null),
  ('MM070', '표층열치료(핫팩)',               2300, '처치료', 'non_covered', '2020-01-01', null),
  ('MM151', '경피적 전기신경자극치료(TENS)',   3200, '처치료', 'non_covered', '2020-01-01', null),
  ('NA240', '네뷸라이저(분무흡입)',           2800, '처치료', 'covered',     '2020-01-01', null),
  ('KK054', '근육내주사',                     1810, '주사료', 'covered',     '2020-01-01', null),
  ('KK052', '정맥내 일시주사',                 2530, '주사료', 'covered',     '2020-01-01', null),
  ('KK150', '정맥내 점적주사(수액)',           5500, '주사료', 'covered',     '2020-01-01', null)
on conflict (lower(code)) do nothing;

-- ── 수가매핑 (fee_mappings) — 진찰료 초진/재진 동적 매핑 (Story 7.1·5.10) ─────────
-- 진찰 시작(registered→in_progress) → 진찰료 코드. fee_on_encounter_start(0045 재정의)이 환자 과거 완료
-- 내원 유무로 분기 룩업: 첫 방문 → encounter_start_initial(초진 AA154) / 재방문 → encounter_start_repeat
-- (재진 AA254). 30일 재진규칙·진료과 가산·정액제는 미구현(청구 단순화 선·아키텍처 §445).
-- ⚠️ 레거시 encounter_start(AA254·5.10) 행은 폴백으로 보존(트리거가 initial/repeat 우선 → 정상 경로 미사용).
-- 검사·처치는 오더 행이 fee_schedule_id 직접 보유(매핑 항등) → fee_mappings 미경유(진찰만 비-항등).
-- 멱등: source_event 별 활성 매핑이 이미 있으면 skip(unique 부분 인덱스 + not exists 가드).
insert into public.fee_mappings (source_event, fee_schedule_id)
select 'encounter_start', fs.id
from public.fee_schedules fs
where lower(fs.code) = 'aa254'
  and not exists (
    select 1 from public.fee_mappings m
    where m.source_event = 'encounter_start' and m.is_active
  );

insert into public.fee_mappings (source_event, fee_schedule_id)
select 'encounter_start_initial', fs.id
from public.fee_schedules fs
where lower(fs.code) = 'aa154'  -- 초진진찰료(의원)
  and not exists (
    select 1 from public.fee_mappings m
    where m.source_event = 'encounter_start_initial' and m.is_active
  );

insert into public.fee_mappings (source_event, fee_schedule_id)
select 'encounter_start_repeat', fs.id
from public.fee_schedules fs
where lower(fs.code) = 'aa254'  -- 재진진찰료(의원)
  and not exists (
    select 1 from public.fee_mappings m
    where m.source_event = 'encounter_start_repeat' and m.is_active
  );

-- ── 약품 (drugs) — 외래 흔한 처방 17개 ──────────────────────────────────────
-- code=보험/표준코드(데모 9자리), ingredient_code=주성분코드(대체조제용, 선택), unit=단위.
-- coverage_type(급여 covered / 비급여 non_covered, Story 5.5) = pay-chip 분류. 비급여=일반약 성격 일부(코푸시럽)
-- 데모 근사. 약가(금액)는 미모델(drugs 금액 컬럼 부재) — 처방 pay-chip 은 분류만·수가 프리뷰 금액 제외.
insert into public.drugs (code, name, ingredient_code, unit, coverage_type, effective_from, effective_to) values
  ('645100250', '타이레놀정500밀리그람(아세트아미노펜)',      '153002ATB', '정',   'covered',     '2020-01-01', null),
  ('642900360', '부루펜정200밀리그람(이부프로펜)',            '217001ATB', '정',   'covered',     '2020-01-01', null),
  ('657601640', '록소닌정60밀리그람(록소프로펜나트륨)',        '463501ATB', '정',   'covered',     '2020-01-01', null),
  ('612200180', '아목시실린캡슐250밀리그람',                   '141001ACH', '캡슐', 'covered',     '2020-01-01', null),
  ('642701230', '오구멘틴정375밀리그람(아목시실린/클라불란산)', '141501ATB', '정',   'covered',     '2020-01-01', null),
  ('645000730', '지르텍정10밀리그람(세티리진)',               '376001ATB', '정',   'covered',     '2020-01-01', null),
  ('644801020', '클라리틴정10밀리그람(로라타딘)',             '222001ATB', '정',   'covered',     '2020-01-01', null),
  ('641603080', '노바스크정5밀리그람(암로디핀)',              '161001ATB', '정',   'covered',     '2020-01-01', null),
  ('642100240', '다이아벡스정500밀리그람(메트포르민)',         '251001ATB', '정',   'covered',     '2020-01-01', null),
  ('648601570', '리피토정10밀리그람(아토르바스타틴)',          '489001ATB', '정',   'covered',     '2020-01-01', null),
  ('646700890', '판토록정40밀리그람(판토프라졸)',             '367001ATB', '정',   'covered',     '2020-01-01', null),
  ('644500670', '무코스타정100밀리그람(레바미피드)',          '445001ATB', '정',   'covered',     '2020-01-01', null),
  ('651401050', '뮤테란캡슐200밀리그람(아세틸시스테인)',       '514001ACH', '캡슐', 'covered',     '2020-01-01', null),
  ('653700110', '코푸시럽(진해거담 복합)',                    null,        'mL',   'non_covered', '2020-01-01', null),
  ('660001230', '덱사메타손주5밀리그람(주사)',                '192001AIJ', '앰플', 'covered',     '2020-01-01', null),
  ('670000010', '생리식염수주 500밀리리터',                   null,        'mL',   'covered',     '2020-01-01', null),
  ('661200340', '리도카인염산염주 2%',                        '251801AIJ', '앰플', 'covered',     '2020-01-01', null)
on conflict (lower(code)) do nothing;

-- ── 검사장비 (equipment) — 영상검사 촬영 배정용 데모 3종 (Story 5.1) ──────────
-- 5.8 촬영 워크리스트/장비 목록 골든 패스용. status=available(가용). ⚠️ equipment.code 는 직접 UNIQUE
-- 제약(0008 lower(code) 함수 인덱스 비대상)이므로 `on conflict (code)`(masters 의 (lower(code)) 와 다름).
insert into public.equipment (code, name, modality, status) values
  ('XR-01',  '제1일반촬영기', 'X-ray', 'available'),
  ('XR-02',  '제2일반촬영기', 'X-ray', 'available'),
  ('US-01',  '초음파진단기',  'US',    'available')
on conflict (code) do nothing;

-- ── (DEV ONLY) 데모 의사 → 진료과 배정 ──────────────────────────────────────
-- 골든 패스(Epic 4 접수·Epic 6 예약)는 "진료과 소속 의사"를 전제한다. 위 DEV ONLY doctor 계정을
-- 내과(IM)에 배정해 후속 시연을 매끄럽게 한다 — **데모 시드**이며, 실제 직원 진료과 배정 기능은
-- Story 2.6(관리자 직원 배정 UI + PATCH /admin/users/{id}/department)이 뒷받침한다(우회 아님).
-- 멱등(department_id 가 NULL 일 때만) · 운영 미영향(seed 는 로컬 db reset 전용).
update public.users
  set department_id = (select id from public.departments where lower(code) = lower('IM'))
  where id = '000000a2-0000-4000-8000-0000000000a2'
    and department_id is null;

-- ── (DEV/데모) 데모 의사 → 면허종류·면허번호 (Story 7.7 원외처방전) ──────────────────
-- 원외처방전 법정 서식은 처방 의료인의 면허종류·면허번호를 요구한다(0002 users.license_type/license_no).
-- 데모 의사(EMP0002)에 의사 면허를 채워 처방전 발급 데모가 "—" 없이 완성된 서식을 띄우게 한다.
-- 멱등(미설정일 때만) · db reset 전용(운영 미반영). 실제 면허 관리 UI 는 스코프 밖(데모 시드).
update public.users
  set license_type = 'doctor', license_no = '12345'
  where id = '000000a2-0000-4000-8000-0000000000a2'
    and license_no is null;

-- ── (DEV/데모) 데모 의사 주간 근무표 + 샘플 휴진 (Story 6.1) ───────────────────────
-- ⚠️ 파일 최하단 위치 필수: doctor_schedules·doctor_time_offs 가 users·departments·rooms 를 FK 참조
--    하므로 마스터 시드(진료과·진료실)·의사 IM 배정 **이후**에 둔다(앞 grant 블록에 두면 FK 위반).
-- 데모 의사(EMP0002)의 월–금 오전/오후 근무 + 미래 학회 휴진 1건으로 6.2 슬롯 계산 데모를 띄운다.
-- master.manage 재사용 → 새 권한 grant 없음. 멱등(존재 검사 가드) · db reset 전용(운영 미반영).
do $$
declare
  v_doctor constant uuid := '000000a2-0000-4000-8000-0000000000a2';
  v_dept uuid;
  v_room uuid;
  v_wd smallint;
begin
  select id into v_dept from public.departments where lower(code) = lower('IM');
  select id into v_room from public.rooms where lower(code) = lower('R101');
  -- 의사·진료과·진료실이 모두 시드돼 있어야 진행(부분 시드 환경 보호 — 없으면 조용히 skip).
  if v_dept is null or v_room is null
     or not exists (select 1 from public.users where id = v_doctor) then
    return;
  end if;
  -- 월(1)~금(5): 오전 09:00–12:30 · 오후 14:00–17:30. weekday=PG dow(0=일). 멱등 가드로 재삽입 방지.
  for v_wd in 1..5 loop
    if not exists (select 1 from public.doctor_schedules
                   where doctor_id = v_doctor and weekday = v_wd and start_time = '09:00') then
      insert into public.doctor_schedules
        (doctor_id, department_id, room_id, weekday, start_time, end_time)
        values (v_doctor, v_dept, v_room, v_wd, '09:00', '12:30');
    end if;
    if not exists (select 1 from public.doctor_schedules
                   where doctor_id = v_doctor and weekday = v_wd and start_time = '14:00') then
      insert into public.doctor_schedules
        (doctor_id, department_id, room_id, weekday, start_time, end_time)
        values (v_doctor, v_dept, v_room, v_wd, '14:00', '17:30');
    end if;
  end loop;
  -- 샘플 휴진(미래 학회 1일). 멱등: 같은 의사·시작일 있으면 skip.
  if not exists (select 1 from public.doctor_time_offs
                 where doctor_id = v_doctor and start_at = '2030-05-01 00:00+09') then
    insert into public.doctor_time_offs (doctor_id, start_at, end_at, reason)
      values (v_doctor, '2030-05-01 00:00+09', '2030-05-02 00:00+09', '학회 참석');
  end if;
end $$;
