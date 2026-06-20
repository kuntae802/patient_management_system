-- patient_management_system — seed.sql (골격)
-- db reset 시 마이그레이션 적용 후 실행된다 (config.toml [db.seed]).
--
-- 🟡 실제 마스터 시드는 후속 스토리(Epic 2 / Story 2.5)가 작성한다:
--    EDI 수가 · 약품 · KCD 진단 · 진료과 · 진료실 마스터 + 샘플 데이터.
--    수가 자동발생 매핑(fee_mappings) 시드도 수납 에픽 착수 전 작성(다운스트림).
--
-- 식별자는 영문 snake_case, 한국어는 표시명(display_name)·주석만 (docs/glossary.md 단일 진실).

-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ DEV ONLY — 로그인·인증/권한 검증용 테스트 직원 계정 (프로덕션 시드 아님)
--   실제 직원 계정 생성은 Story 1.8(관리자 UI). db reset 시 재생성됨.
--   로컬 자격증명(로컬 전용, 절대 운영 사용 금지, 둘 다 비번 Staff1234):
--     · admin@pms.local   role=admin   → 23권한 전부(Story 1.3 시드)  → require_permission 통과
--     · doctor@pms.local  role=doctor  → 권한 0(1.7 매트릭스 전)       → require_permission 403
--       (Story 1.5 의 401/403/200 인증·권한 매트릭스 통합 검증용)
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
      'email','doctor@pms.local','employee_no','EMP0002','name','의사(테스트)','role','doctor')
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
