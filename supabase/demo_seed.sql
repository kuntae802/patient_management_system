-- demo_seed.sql — 클라우드 테스트용 더미 임상 데이터 (재실행 가능)
-- ─────────────────────────────────────────────────────────────────────────────
-- 목적: 비어있는 임상 트랜잭션 테이블(환자/예약/내원/오더…)을 현실적으로 채워
--       리스트·검색·대기판·예약충돌·노쇼제한·진료허브·수가 등을 즉시 테스트.
-- 원칙(불변식 준수):
--   * 주민번호는 DB 크립토 함수(encrypt_sensitive/blind_index)로 채움 → reveal 정상 동작.
--   * 수가(fee_items)는 직접 INSERT 하지 않고, 상태 전이 UPDATE 로 트리거를 실제 발화시켜 생성.
--   * 결정적 UUID 프리픽스(0001=환자 / 0002=내원 / 0003=예약 / 00021=검사 / 00022=처치 / 00023=처방)
--     로 재실행 시 SEED 행만 정리(사용자가 테스트 중 만든 데이터는 보존).
-- 적용: docker exec -i <supabase_db> psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f - < supabase/demo_seed.sql
-- ─────────────────────────────────────────────────────────────────────────────

do $seed$
declare
  -- 직원(seed.sql 고정 UUID)
  v_admin uuid := '000000a1-0000-4000-8000-0000000000a1';
  v_doc   uuid := '000000a2-0000-4000-8000-0000000000a2';
  v_recep uuid := '000000a3-0000-4000-8000-0000000000a3';
  v_nurse uuid := '000000a4-0000-4000-8000-0000000000a4';
  v_rad   uuid := '000000a5-0000-4000-8000-0000000000a5';

  -- 마스터(코드로 조회)
  v_dept_im uuid;
  v_room_im uuid; v_room_xr uuid;
  v_eq_xr1 uuid;
  v_fee_cbc uuid; v_fee_hba1c uuid; v_fee_cxr uuid; v_fee_iv uuid; v_fee_neb uuid;
  v_drug_amox uuid; v_drug_tyl uuid; v_drug_loxo uuid; v_drug_zyrtec uuid;
  v_drug_amlo uuid; v_drug_metf uuid; v_drug_panto uuid; v_drug_lipitor uuid;
  v_dx_cold uuid; v_dx_pharyn uuid; v_dx_rhinitis uuid;
  v_dx_htn uuid; v_dx_dm uuid; v_dx_lipid uuid; v_dx_gastro uuid;

  v_today date;

  -- 결정적 UUID 프리픽스(접미 2자리 hex 부착)
  pp text := '00010000-0000-4000-8000-0000000000';  -- 환자
  ep text := '00020000-0000-4000-8000-0000000000';  -- 내원
  xp text := '00021000-0000-4000-8000-0000000000';  -- 검사
  tp text := '00022000-0000-4000-8000-0000000000';  -- 처치
  rp text := '00023000-0000-4000-8000-0000000000';  -- 처방
  ap text := '00030000-0000-4000-8000-0000000000';  -- 예약
begin
  perform set_config('app.actor_id', v_admin::text, true);  -- 감사 actor
  v_today := (now() at time zone 'Asia/Seoul')::date;

  -- ── 마스터 조회 ──────────────────────────────────────────────────────────
  select id into v_dept_im   from departments  where code = 'IM';
  select id into v_room_im   from rooms        where code = 'R101';
  select id into v_room_xr   from rooms        where code = 'XR1';
  select id into v_eq_xr1    from equipment    where code = 'XR-01';
  select id into v_fee_cbc   from fee_schedules where code = 'C3800';
  select id into v_fee_hba1c from fee_schedules where code = 'D2700';
  select id into v_fee_cxr   from fee_schedules where code = 'HA201';
  select id into v_fee_iv    from fee_schedules where code = 'KK150';
  select id into v_fee_neb   from fee_schedules where code = 'NA240';
  select id into v_drug_amox    from drugs where code = '612200180';
  select id into v_drug_tyl     from drugs where code = '645100250';
  select id into v_drug_loxo    from drugs where code = '657601640';
  select id into v_drug_zyrtec  from drugs where code = '645000730';
  select id into v_drug_amlo    from drugs where code = '641603080';
  select id into v_drug_metf    from drugs where code = '642100240';
  select id into v_drug_panto   from drugs where code = '646700890';
  select id into v_drug_lipitor from drugs where code = '648601570';
  select id into v_dx_cold     from diagnoses where code = 'J00';
  select id into v_dx_pharyn   from diagnoses where code = 'J02.9';
  select id into v_dx_rhinitis from diagnoses where code = 'J30.4';
  select id into v_dx_htn      from diagnoses where code = 'I10';
  select id into v_dx_dm       from diagnoses where code = 'E11.9';
  select id into v_dx_lipid    from diagnoses where code = 'E78.5';
  select id into v_dx_gastro   from diagnoses where code = 'A09';

  -- ── 기존 SEED 행 정리(FK 의존 역순) ──────────────────────────────────────
  -- ⚠️ 손자 테이블은 부모(encounter)의 자식 id 기준 서브쿼리로 지운다. 구버전 demo_seed 가
  --    랜덤 UUID 로 만든 처방·검사도 청산되도록(프리픽스 매칭만으론 누락 → FK 위반). 재실행 멱등.
  delete from payment_details      where payment_id      in (select id from payments      where encounter_id::text like '00020000-%');
  delete from prescription_details where prescription_id in (select id from prescriptions where encounter_id::text like '00020000-%');
  delete from examination_images   where examination_id  in (select id from examinations  where encounter_id::text like '00020000-%');
  delete from fee_items            where encounter_id::text  like '00020000-%';
  delete from vital_signs          where encounter_id::text  like '00020000-%';
  delete from nursing_record       where encounter_id::text  like '00020000-%';
  delete from payments             where encounter_id::text  like '00020000-%';
  delete from prescriptions        where encounter_id::text  like '00020000-%';
  delete from encounter_diagnoses  where encounter_id::text  like '00020000-%';
  delete from examinations         where encounter_id::text  like '00020000-%';
  delete from treatment_orders     where encounter_id::text  like '00020000-%';
  delete from medical_records      where encounter_id::text  like '00020000-%';
  delete from notification_logs    where patient_id::text like '00010000-%' or appointment_id::text like '00030000-%';
  delete from encounters           where id::text            like '00020000-%';
  delete from appointments         where id::text            like '00030000-%';
  delete from guardians            where patient_id::text    like '00010000-%';
  delete from patients             where id::text            like '00010000-%';

  -- ── 환자 20명 ────────────────────────────────────────────────────────────
  insert into patients
    (id, name, birth_date, sex, resident_no_enc, resident_no_hash, resident_no_masked,
     phone, address, email, insurance_type, blood_type, allergies, chronic_diseases, medications, notes)
  select (pp || v.sfx)::uuid, v.name, v.bd::date, v.sex,
         public.encrypt_sensitive(v.rrn),
         public.blind_index(v.rrn),
         substr(v.rrn,1,6) || '-' || substr(v.rrn,7,1) || '******',
         v.phone, v.addr, v.email, v.ins, v.blood, v.allergies, v.chronic, v.meds, v.notes
  from (values
    ('01','김영수','1975-03-14','male',  '7503141234567','010-2345-6701','서울 강남구 테헤란로 101','kim.ys@example.com','health_insurance','A+',  null,                          '본태성 고혈압',           '암로디핀 5mg 1일 1회',  null),
    ('02','이미경','1982-07-22','female','8207222345678','010-2345-6702','서울 서초구 반포대로 22', 'lee.mk@example.com','health_insurance','B+',  null,                          null,                       null,                     '알레르기비염 추적'),
    ('03','박정호','1968-11-05','male',  '6811051456789','010-2345-6703','서울 송파구 올림픽로 33', null,                'health_insurance','O+',  null,                          '제2형 당뇨병',            '메트포르민 500mg 1일 2회', null),
    ('04','최수진','1990-02-18','female','9002182567890','010-2345-6704','서울 마포구 월드컵로 44', 'choi.sj@example.com','health_insurance','A-', null,                          null,                       null,                     null),
    ('05','정대현','1985-09-30','male',  '8509301678901','010-2345-6705','서울 용산구 한강대로 55', null,                'self_pay',        'B+',  null,                          null,                       null,                     '노쇼 이력 환자'),
    ('06','한지영','1972-06-12','female','7206122789012','010-2345-6706','서울 강서구 공항대로 66', 'han.jy@example.com','health_insurance','O+',  null,                          '고혈압, 고지혈증',         '암로디핀, 아토르바스타틴', null),
    ('07','오세훈','1995-12-03','male',  '9512031890123','010-2345-6707','서울 동작구 사당로 77',   null,                'health_insurance','AB+', null,                          null,                       null,                     null),
    ('08','윤서아','1988-04-25','female','8804252901234','010-2345-6708','서울 성동구 왕십리로 88', 'yoon.sa@example.com','health_insurance','A+', '계란',                        null,                       null,                     null),
    ('09','임재욱','1979-08-17','male',  '7908171012345','010-2345-6709','서울 광진구 능동로 99',   null,                'health_insurance','O+',  '페니실린계 항생제(두드러기 과거력)', null,             null,                     '항생제 처방 시 주의'),
    ('10','강민지','1993-01-09','female','9301092123456','010-2345-6710','서울 노원구 동일로 110',  'kang.mj@example.com','health_insurance','B-', null,                          null,                       null,                     null),
    ('11','송준호','1965-05-21','male',  '6505211234560','010-2345-6711','서울 은평구 통일로 121',  null,                'medical_aid',     'A+',  null,                          '본태성 고혈압',            '텔미사르탄',              null),
    ('12','배수빈','2001-10-14','female','0110144234561','010-2345-6712','서울 관악구 관악로 132',  null,                'health_insurance','AB+', null,                          null,                       null,                     null),
    ('13','신동민','1958-03-08','male',  '5803081345672','010-2345-6713','서울 중랑구 망우로 143',  null,                'health_insurance','O+',  null,                          '고지혈증',                 '로수바스타틴',            null),
    ('14','권나래','1997-07-19','female','9707192456783','010-2345-6714','서울 도봉구 도봉로 154',  'kwon.nr@example.com','health_insurance','A+', null,                          null,                       null,                     null),
    ('15','황태석','1983-11-27','male',  '8311271567894','010-2345-6715','서울 양천구 목동로 165',  null,                'health_insurance','B+',  null,                          null,                       null,                     null),
    ('16','문가은','1976-09-02','female','7609022678905','010-2345-6716','서울 구로구 디지털로 176','moon.ge@example.com','auto_insurance',  'O-', null,                          null,                       null,                     '교통사고 외래'),
    ('17','류현우','2017-05-16','male',  '1705163789016','010-2345-6717','서울 강동구 천호대로 187',null,                'health_insurance','A+',  null,                          null,                       null,                     '소아(보호자 동반)'),
    ('18','조아인','2019-12-08','female','1912084890127','010-2345-6718','서울 금천구 시흥대로 198', null,               'health_insurance','B+',  '땅콩',                        null,                       null,                     '소아(보호자 동반)'),
    ('19','남기훈','1948-02-22','male',  '4802221901238','010-2345-6719','서울 종로구 종로 209',    null,                'medical_aid',     'O+',  null,                          '고혈압, 제2형 당뇨병',     '암로디핀, 메트포르민',     '고령(보호자 동반)'),
    ('20','백서연','2000-06-30','female','0006304012349','010-2345-6720','서울 영등포구 여의대로 220','baek.sy@example.com','health_insurance','A+',null,                         null,                       null,                     null)
  ) as v(sfx,name,bd,sex,rrn,phone,addr,email,ins,blood,allergies,chronic,meds,notes);

  -- ── 보호자 3명(소아 2 + 고령 1) ──────────────────────────────────────────
  insert into guardians (patient_id, name, relationship, phone)
  values
    ((pp||'17')::uuid, '김미나', '모',   '010-3456-7817'),
    ((pp||'18')::uuid, '조성우', '부',   '010-3456-7818'),
    ((pp||'19')::uuid, '남정희', '자녀', '010-3456-7819');

  -- ── 예약 17건 ────────────────────────────────────────────────────────────
  insert into appointments
    (id, patient_id, doctor_id, department_id, room_id, scheduled_start, scheduled_end,
     status, created_by, sms_opt_in, note, cancelled_at, no_show_at, completed_at, cancel_reason)
  select (ap||v.sfx)::uuid, (pp||v.psfx)::uuid, v_doc, v_dept_im, v_room_im,
         ((v_today + v.off) + v.st::time) at time zone 'Asia/Seoul',
         ((v_today + v.off) + v.st::time) at time zone 'Asia/Seoul' + (v.dur || ' min')::interval,
         v.status, v_recep, v.sms, v.note,
         case when v.status='cancelled' then ((v_today + v.off) + v.st::time) at time zone 'Asia/Seoul' - interval '1 day' end,
         case when v.status='no_show'   then ((v_today + v.off) + v.st::time) at time zone 'Asia/Seoul' + interval '30 min' end,
         case when v.status='completed' then ((v_today + v.off) + v.st::time) at time zone 'Asia/Seoul' + (v.dur || ' min')::interval end,
         case when v.status='cancelled' then '환자 사정으로 취소' end
  from (values
    ('01','01',-3,'09:30',20,'completed',false, null),
    ('02','02',-2,'09:30',20,'completed',false, null),
    ('03','03',-2,'10:00',20,'completed',false, null),
    ('04','04',-1,'09:30',20,'completed',false, null),
    ('05','05',-6,'10:00',20,'no_show',  false, null),
    ('06','05',-4,'10:00',20,'no_show',  false, '재예약 후 재노쇼'),
    ('07','11',-5,'11:00',20,'no_show',  false, null),
    ('08','13',-3,'14:00',20,'cancelled',false, null),
    ('09','14',-2,'15:00',20,'cancelled',false, null),
    ('10','15', 0,'15:30',20,'booked',   false, '오늘 오후 예약'),
    ('11','16', 0,'16:00',20,'booked',   false, null),
    ('12','17', 0,'16:30',20,'booked',   false, '소아 진료'),
    ('13','18', 1,'09:30',20,'booked',   true,  '내일 예약(리마인더 대상)'),
    ('14','19', 2,'10:00',20,'booked',   true,  '리마인더 대상'),
    ('15','20', 3,'11:00',20,'booked',   true,  null),
    ('16','02', 5,'09:30',20,'booked',   false, null),
    ('17','01', 7,'14:00',20,'booked',   false, '정기 추적')
  ) as v(sfx,psfx,off,st,dur,status,sms,note);

  -- ── 내원 11건(우선 registered 로 생성) ───────────────────────────────────
  insert into encounters
    (id, patient_id, department_id, room_id, doctor_id, visit_type, created_by, registered_at, reservation_id)
  select (ep||v.sfx)::uuid, (pp||v.psfx)::uuid, v_dept_im, v_room_im, v_doc, v.vtype, v_recep,
         ((v_today + v.off) + v.st::time) at time zone 'Asia/Seoul',
         case when v.asfx is not null then (ap||v.asfx)::uuid end
  from (values
    ('01','01','reserved',-3,'09:35','01'),
    ('02','02','reserved',-2,'09:35','02'),
    ('03','03','reserved',-2,'10:05','03'),
    ('04','04','reserved',-1,'09:35','04'),
    ('05','05','walk_in', -1,'11:00',null),
    ('06','06','walk_in', -4,'10:00',null),
    ('07','07','walk_in',  0,'09:20',null),
    ('08','08','walk_in',  0,'09:50',null),
    ('09','09','walk_in',  0,'10:00',null),
    ('10','10','walk_in',  0,'10:05',null),
    ('11','11','walk_in',  0,'10:10',null)
  ) as v(sfx,psfx,vtype,off,st,asfx);

  -- ── 검사·처치 오더 생성(ordered) ─────────────────────────────────────────
  insert into examinations (id, encounter_id, exam_type, fee_schedule_id, ordered_by, ordered_at)
  values
    -- lab(검체) 검사 제거 — 검체 채취 수행 경로(주체) 미구현으로 진료허브 "검사" 탭 삭제(Finding #2).
    -- examination 인프라(exam_type)는 유지하되 영상(imaging)만 시드(처치는 treatment_orders 별도).
    ((xp||'03')::uuid, (ep||'06')::uuid, 'imaging', v_fee_cxr,   v_doc, (v_today-4 + time '10:10') at time zone 'Asia/Seoul'),
    ((xp||'04')::uuid, (ep||'08')::uuid, 'imaging', v_fee_cxr,   v_doc, (v_today   + time '10:05') at time zone 'Asia/Seoul');

  insert into treatment_orders (id, encounter_id, fee_schedule_id, ordered_by, ordered_at)
  values
    ((tp||'01')::uuid, (ep||'02')::uuid, v_fee_neb, v_doc, (v_today-2 + time '09:45') at time zone 'Asia/Seoul'),
    ((tp||'02')::uuid, (ep||'04')::uuid, v_fee_iv,  v_doc, (v_today-1 + time '09:50') at time zone 'Asia/Seoul'),
    ((tp||'03')::uuid, (ep||'08')::uuid, v_fee_neb, v_doc, (v_today   + time '10:05') at time zone 'Asia/Seoul');

  -- ── 처방 발행(issued) — 오더-by-내원상태 게이트(0053): 완료 전이 *전*(registered)에 발행해야 통과 ──
  insert into prescriptions (id, encounter_id, status, ordered_by, ordered_at)
  values
    ((rp||'01')::uuid, (ep||'01')::uuid, 'issued', v_doc, (v_today-3 + time '09:55') at time zone 'Asia/Seoul'),
    ((rp||'02')::uuid, (ep||'02')::uuid, 'issued', v_doc, (v_today-2 + time '09:55') at time zone 'Asia/Seoul'),
    ((rp||'03')::uuid, (ep||'03')::uuid, 'issued', v_doc, (v_today-2 + time '10:20') at time zone 'Asia/Seoul'),
    ((rp||'04')::uuid, (ep||'04')::uuid, 'issued', v_doc, (v_today-1 + time '09:55') at time zone 'Asia/Seoul'),
    ((rp||'05')::uuid, (ep||'05')::uuid, 'issued', v_doc, (v_today-1 + time '11:20') at time zone 'Asia/Seoul'),
    ((rp||'06')::uuid, (ep||'06')::uuid, 'issued', v_doc, (v_today-4 + time '10:20') at time zone 'Asia/Seoul');

  -- ── 상태 전이: 진찰 시작(registered→in_progress) → 진찰료 트리거 발화(e01~e08) ──
  update encounters set status='in_progress',
         consult_started_at = registered_at + interval '10 min'
   where id::text like '00020000-%'
     and right(id::text,2) in ('01','02','03','04','05','06','07','08');

  -- ── 상태 전이: 진료 완료(in_progress→completed) (e01~e06) ──────────────────
  update encounters set status='completed',
         completed_at = consult_started_at + interval '25 min'
   where id::text like '00020000-%'
     and right(id::text,2) in ('01','02','03','04','05','06');

  -- ── 검사 수행(ordered→performed) → 검사·영상료 트리거 발화(x01,x02,x03) ──────
  update examinations set status='performed',
         performed_by = v_rad,
         performed_at = ordered_at + interval '20 min',
         equipment_id = case when exam_type='imaging' then v_eq_xr1 end
   where id::text = '00021000-0000-4000-8000-000000000003';

  -- ── 판독 완료(performed→completed) + 소견·결론(x01,x02,x03) ─────────────────
  --    findings/reading_conclusion = 직원용 임상 서사(감사 마스킹·환자 비노출).
  --    patient_result_* = 환자 포털용 쉬운 말 요약 + 정상/주의 플래그(0055·8.2·환자 노출).
  update examinations set status='completed', completed_by = v_doc,
         completed_at = performed_at + interval '30 min',
         findings = case right(id::text,2)
                      when '03' then '양측 폐야 청명, 심흉비 정상, 늑골횡격막각 예리' end,
         reading_conclusion = case right(id::text,2)
                      when '03' then '활동성 폐병변 없음' else null end,
         patient_result_summary = case right(id::text,2)
                      when '03' then '가슴 사진에서 특별한 이상은 보이지 않았어요.' end,
         patient_result_flag = case right(id::text,2)
                      when '03' then 'normal' end
   where id::text = '00021000-0000-4000-8000-000000000003';

  -- ── 처치 수행(ordered→performed) → 처치료 트리거 발화(t01,t02) ──────────────
  update treatment_orders set status='performed',
         performed_by = v_nurse,
         performed_at = ordered_at + interval '15 min'
   where id::text in ('00022000-0000-4000-8000-000000000001',
                      '00022000-0000-4000-8000-000000000002');

  -- ── SOAP 진료기록(완료 내원 e01~e06) ──────────────────────────────────────
  insert into medical_records (encounter_id, author_id, subjective, objective, assessment, plan)
  values
    ((ep||'01')::uuid, v_doc, '3일 전부터 콧물·인후통, 발열 없음', '인두 경도 발적, 편도 비대 없음',        '급성 비인두염(감기)',        '대증요법, 수분 섭취 권고, 3일분 투약'),
    ((ep||'02')::uuid, v_doc, '2주간 재채기·맑은 콧물·눈 가려움', '하비갑개 창백·부종',                    '알레르기비염',               '항히스타민제 처방, 네뷸라이저 시행'),
    ((ep||'03')::uuid, v_doc, '당뇨 정기 추적, 특이 증상 없음',   '족부 병변 없음, 체중 변화 없음',          '제2형 당뇨병 추적관찰',      'CBC·HbA1c 확인, 메트포르민 유지, 식이 교육'),
    ((ep||'04')::uuid, v_doc, '어제부터 상복부 불편감·묽은 변 3회','복부 경도 압통, 경미한 탈수',            '급성 위장염',                '수액 처치, 제산제 처방, 경과 관찰'),
    ((ep||'05')::uuid, v_doc, '인후통·연하통 2일, 발열 38.1도',   '편도 백태(+), 경부 림프절 압통',          '급성 인두염',                '항생제 처방, 해열제 병용'),
    ((ep||'06')::uuid, v_doc, '고혈압·고지혈증 정기 추적',        '진료실 혈압 138/86',                    '본태성 고혈압, 고지혈증',     '약물 유지, 흉부촬영 정상, 생활습관 교육');

  -- ── 진단(완료 내원) ──────────────────────────────────────────────────────
  insert into encounter_diagnoses (encounter_id, diagnosis_id, is_primary, recorded_by)
  values
    ((ep||'01')::uuid, v_dx_cold,    true,  v_doc),
    ((ep||'02')::uuid, v_dx_rhinitis,true,  v_doc),
    ((ep||'03')::uuid, v_dx_dm,      true,  v_doc),
    ((ep||'04')::uuid, v_dx_gastro,  true,  v_doc),
    ((ep||'05')::uuid, v_dx_pharyn,  true,  v_doc),
    ((ep||'06')::uuid, v_dx_htn,     true,  v_doc),
    ((ep||'06')::uuid, v_dx_lipid,   false, v_doc);

  -- ── 수납 finalize(완료 내원 e01~e06) — 본인부담 결제 완료(운영 대시보드 매출·Story 8.5) ──
  --    데모 가시성용 직접 적재(실 운영은 build→price→finalize RPC). finalized_at=완료일 → 일별 매출
  --    추세 표시. payment_no=R-YYYYMMDD-<sfx>(KST·2자리라 실 6자리 시퀀스와 비충돌). 환급 0
  --    (refunded 차감은 실 취소 플로우에서 발생 — 8.5 가 그 첫 리포팅 소비처).
  insert into payments
    (encounter_id, status, billing_type, total_amount_krw, copay_amount_krw, paid_amount_krw,
     payment_method, payment_no, finalized_at, finalized_by)
  select (ep||v.sfx)::uuid, 'finalized', 'postpaid', v.copay, v.copay, v.copay,
         v.method,
         'R-' || to_char(e.completed_at at time zone 'Asia/Seoul', 'YYYYMMDD') || '-' || v.sfx,
         e.completed_at, v_recep
  from (values
    ('01', 4500, 'card'),
    ('02', 8200, 'card'),
    ('03', 6700, 'cash'),
    ('04', 7400, 'card'),
    ('05', 5100, 'cash'),
    ('06', 9300, 'card')
  ) as v(sfx, copay, method)
  join encounters e on e.id = (ep||v.sfx)::uuid;

  -- ── 처방 상세(처방 발행은 위 registered 단계·게이트 0053 통과) ─────────────
  insert into prescription_details (prescription_id, drug_id, dose, frequency, duration_days, usage_instruction)
  values
    ((rp||'01')::uuid, v_drug_tyl,    1, '1일 3회', 3,  '매 식후 30분'),
    ((rp||'01')::uuid, v_drug_loxo,   1, '1일 2회', 3,  '아침·저녁 식후'),
    ((rp||'02')::uuid, v_drug_zyrtec, 1, '1일 1회', 14, '취침 전'),
    ((rp||'03')::uuid, v_drug_metf,   1, '1일 2회', 30, '아침·저녁 식후'),
    ((rp||'04')::uuid, v_drug_panto,  1, '1일 1회', 14, '아침 식전'),
    ((rp||'05')::uuid, v_drug_amox,   1, '1일 3회', 5,  '매 식후'),
    ((rp||'05')::uuid, v_drug_tyl,    1, '필요시',  3,  '발열 시'),
    ((rp||'06')::uuid, v_drug_amlo,   1, '1일 1회', 30, '아침 식후'),
    ((rp||'06')::uuid, v_drug_lipitor,1, '1일 1회', 30, '취침 전');

  -- ── 활력징후(완료 6 + 진료중 2 = e01~e08) ─────────────────────────────────
  insert into vital_signs (encounter_id, systolic, diastolic, pulse, body_temp, respiratory_rate, spo2, recorded_by, recorded_at)
  select (ep||v.sfx)::uuid, v.sys, v.dia, v.pul, v.temp::numeric, v.rr, v.spo2, v_nurse,
         ((v_today + v.off) + v.st::time) at time zone 'Asia/Seoul'
  from (values
    ('01',120,80,72,'36.8',16,98,-3,'09:30'),
    ('02',118,76,68,'36.5',15,99,-2,'09:30'),
    ('03',132,84,76,'36.6',16,98,-2,'10:00'),
    ('04',110,70,88,'37.4',18,97,-1,'09:30'),
    ('05',126,82,90,'38.1',18,97,-1,'10:55'),
    ('06',138,86,74,'36.7',16,98,-4,'09:55'),
    ('07',122,78,70,'36.6',15,99, 0,'09:25'),
    ('08',128,80,80,'36.9',17,98, 0,'09:55')
  ) as v(sfx,sys,dia,pul,temp,rr,spo2,off,st);

  -- ── 간호기록 ─────────────────────────────────────────────────────────────
  insert into nursing_record (encounter_id, treatment_order_id, content, recorded_by, recorded_at)
  values
    ((ep||'02')::uuid, (tp||'01')::uuid, '네뷸라이저 10분 시행, 시행 후 호흡음 호전 확인', v_nurse, (v_today-2 + time '10:05') at time zone 'Asia/Seoul'),
    ((ep||'04')::uuid, (tp||'02')::uuid, '생리식염수 500mL 정맥 점적 시작, 부작용 없음',   v_nurse, (v_today-1 + time '10:10') at time zone 'Asia/Seoul'),
    ((ep||'07')::uuid, null,             '내원 시 활력징후 측정, 환자 안정 상태 유지',     v_nurse, (v_today   + time '09:28') at time zone 'Asia/Seoul');

  raise notice 'demo_seed 완료: 환자 20 / 보호자 3 / 예약 17 / 내원 11(완료6·진료중2·대기3) / 수납 finalize 6';
end
$seed$;
