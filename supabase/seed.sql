-- patient_management_system — seed.sql (골격)
-- db reset 시 마이그레이션 적용 후 실행된다 (config.toml [db.seed]).
--
-- 🟢 마스터 시드(Story 2.5): 진료과 · 진료실 · KCD 진단 · EDI 수가 · 약품 마스터 + 샘플(파일 하단).
--    데모/개발용 현재-유효 데이터(effective_from 과거 · effective_to NULL)로 검색 피커·골든 패스를 띄운다.
--    수가 자동발생 매핑(fee_mappings) 시드는 수납 에픽(Epic 7) 착수 전 작성(다운스트림 — 본 파일 범위 밖).
--
-- 식별자는 영문 snake_case, 한국어는 표시명(display_name)·주석만 (docs/glossary.md 단일 진실).

-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ DEV ONLY — 로그인·인증/권한 검증용 테스트 직원 계정 (프로덕션 시드 아님)
--   실제 직원 계정 생성은 Story 1.8(관리자 UI). db reset 시 재생성됨.
--   로컬 자격증명(로컬 전용, 절대 운영 사용 금지, 전부 비번 Staff1234):
--     · admin@pms.local      role=admin     → 23권한 전부(Story 1.3 시드)  → require_permission 통과
--     · doctor@pms.local     role=doctor    → 권한 0(1.7 매트릭스 전)       → require_permission 403
--       (Story 1.5 의 401/403/200 인증·권한 매트릭스 통합 검증용)
--     · reception@pms.local  role=reception → encounter.register/read 보유(하단 grant) → walk-in 접수
--       골든 패스 가동(Story 4.2). 역할 grant 는 데모/통합테스트용 — 프로덕션은 1.7 매트릭스가 부여.
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
      'email','reception@pms.local','employee_no','EMP0003','name','원무(테스트)','role','reception')
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
insert into public.diagnoses (code, name, effective_from, effective_to) values
  ('J00',   '급성 비인두염[감기]',                       '2020-01-01', null),
  ('J02.9', '상세불명의 급성 인두염',                     '2020-01-01', null),
  ('J03.9', '상세불명의 급성 편도염',                     '2020-01-01', null),
  ('J20.9', '상세불명의 급성 기관지염',                   '2020-01-01', null),
  ('J30.4', '상세불명의 알레르기비염',                    '2020-01-01', null),
  ('J45.9', '상세불명의 천식',                            '2020-01-01', null),
  ('I10',   '본태성(원발성) 고혈압',                       '2020-01-01', null),
  ('E11.9', '합병증을 동반하지 않은 2형 당뇨병',           '2020-01-01', null),
  ('E78.5', '상세불명의 고지질혈증',                       '2020-01-01', null),
  ('K21.9', '식도염을 동반하지 않은 위-식도역류병',         '2020-01-01', null),
  ('K29.7', '상세불명의 위염',                            '2020-01-01', null),
  ('K59.0', '변비',                                       '2020-01-01', null),
  ('A09',   '감염성 및 상세불명 기원의 위장염 및 결장염',   '2020-01-01', null),
  ('M54.5', '요통',                                       '2020-01-01', null),
  ('M25.50','상세불명 부위의 관절통',                      '2020-01-01', null),
  ('M75.0', '어깨의 유착성 관절낭염(오십견)',              '2020-01-01', null),
  ('M79.1', '근육통',                                     '2020-01-01', null),
  ('L20.9', '상세불명의 아토피피부염',                     '2020-01-01', null),
  ('L30.9', '상세불명의 피부염',                           '2020-01-01', null),
  ('N39.0', '부위가 명시되지 않은 요로감염',               '2020-01-01', null),
  ('R51',   '두통',                                       '2020-01-01', null),
  ('R50.9', '상세불명의 열'                              , '2020-01-01', null)
on conflict (lower(code)) do nothing;

-- ── EDI 수가 (fee_schedules) — 진찰·검사·영상·처치·주사 18개 ─────────────────
-- amount_krw = KRW 정수(소수 없음·>=0). category 는 그룹 라벨. 코드·단가는 심평원 형식의 데모값.
insert into public.fee_schedules (code, name, amount_krw, category, effective_from, effective_to) values
  ('AA154', '초진진찰료(의원)',              17610, '진찰료', '2020-01-01', null),
  ('AA254', '재진진찰료(의원)',              12590, '진찰료', '2020-01-01', null),
  ('C3800', '일반혈액검사(CBC)',              3500, '검사료', '2020-01-01', null),
  ('C5400', '요검사(요화학 정성)',            1500, '검사료', '2020-01-01', null),
  ('D2700', '당화혈색소(HbA1c)',              6000, '검사료', '2020-01-01', null),
  ('E6541', '심전도검사(표준 12유도)',        5460, '검사료', '2020-01-01', null),
  ('F6310', '알레르기 피부반응검사',           8000, '검사료', '2020-01-01', null),
  ('HB010', '비내시경검사',                  12000, '검사료', '2020-01-01', null),
  ('HA201', '흉부 단순촬영(1매)',             9030, '영상료', '2020-01-01', null),
  ('HA401', '복부 단순촬영(1매)',             9500, '영상료', '2020-01-01', null),
  ('M0030', '단순처치(드레싱, 100㎠ 미만)',    4500, '처치료', '2020-01-01', null),
  ('M0040', '창상봉합술(안면 외, 2.5cm 미만)',30000, '처치료', '2020-01-01', null),
  ('MM070', '표층열치료(핫팩)',               2300, '처치료', '2020-01-01', null),
  ('MM151', '경피적 전기신경자극치료(TENS)',   3200, '처치료', '2020-01-01', null),
  ('NA240', '네뷸라이저(분무흡입)',           2800, '처치료', '2020-01-01', null),
  ('KK054', '근육내주사',                     1810, '주사료', '2020-01-01', null),
  ('KK052', '정맥내 일시주사',                 2530, '주사료', '2020-01-01', null),
  ('KK150', '정맥내 점적주사(수액)',           5500, '주사료', '2020-01-01', null)
on conflict (lower(code)) do nothing;

-- ── 약품 (drugs) — 외래 흔한 처방 17개 ──────────────────────────────────────
-- code=보험/표준코드(데모 9자리), ingredient_code=주성분코드(대체조제용, 선택), unit=단위.
insert into public.drugs (code, name, ingredient_code, unit, effective_from, effective_to) values
  ('645100250', '타이레놀정500밀리그람(아세트아미노펜)',      '153002ATB', '정',   '2020-01-01', null),
  ('642900360', '부루펜정200밀리그람(이부프로펜)',            '217001ATB', '정',   '2020-01-01', null),
  ('657601640', '록소닌정60밀리그람(록소프로펜나트륨)',        '463501ATB', '정',   '2020-01-01', null),
  ('612200180', '아목시실린캡슐250밀리그람',                   '141001ACH', '캡슐', '2020-01-01', null),
  ('642701230', '오구멘틴정375밀리그람(아목시실린/클라불란산)', '141501ATB', '정',   '2020-01-01', null),
  ('645000730', '지르텍정10밀리그람(세티리진)',               '376001ATB', '정',   '2020-01-01', null),
  ('644801020', '클라리틴정10밀리그람(로라타딘)',             '222001ATB', '정',   '2020-01-01', null),
  ('641603080', '노바스크정5밀리그람(암로디핀)',              '161001ATB', '정',   '2020-01-01', null),
  ('642100240', '다이아벡스정500밀리그람(메트포르민)',         '251001ATB', '정',   '2020-01-01', null),
  ('648601570', '리피토정10밀리그람(아토르바스타틴)',          '489001ATB', '정',   '2020-01-01', null),
  ('646700890', '판토록정40밀리그람(판토프라졸)',             '367001ATB', '정',   '2020-01-01', null),
  ('644500670', '무코스타정100밀리그람(레바미피드)',          '445001ATB', '정',   '2020-01-01', null),
  ('651401050', '뮤테란캡슐200밀리그람(아세틸시스테인)',       '514001ACH', '캡슐', '2020-01-01', null),
  ('653700110', '코푸시럽(진해거담 복합)',                    null,        'mL',   '2020-01-01', null),
  ('660001230', '덱사메타손주5밀리그람(주사)',                '192001AIJ', '앰플', '2020-01-01', null),
  ('670000010', '생리식염수주 500밀리리터',                   null,        'mL',   '2020-01-01', null),
  ('661200340', '리도카인염산염주 2%',                        '251801AIJ', '앰플', '2020-01-01', null)
on conflict (lower(code)) do nothing;

-- ── (DEV ONLY) 데모 의사 → 진료과 배정 ──────────────────────────────────────
-- 골든 패스(Epic 4 접수·Epic 6 예약)는 "진료과 소속 의사"를 전제한다. 위 DEV ONLY doctor 계정을
-- 내과(IM)에 배정해 후속 시연을 매끄럽게 한다 — **데모 시드**이며, 실제 직원 진료과 배정 기능은
-- Story 2.6(관리자 직원 배정 UI + PATCH /admin/users/{id}/department)이 뒷받침한다(우회 아님).
-- 멱등(department_id 가 NULL 일 때만) · 운영 미영향(seed 는 로컬 db reset 전용).
update public.users
  set department_id = (select id from public.departments where lower(code) = lower('IM'))
  where id = '000000a2-0000-4000-8000-0000000000a2'
    and department_id is null;
