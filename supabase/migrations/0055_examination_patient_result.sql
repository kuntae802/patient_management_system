-- 0055_examination_patient_result.sql — examinations 에 "환자용 쉬운 말 결과 요약 + 정상/주의 플래그" 컬럼
-- Story 8.2 / FR-121(환자 본인 검사 결과 조회 — '내 기록' 펼침 상세의 검사 결과 요약).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실). 환자용 큐레이션 값(판독의/seed 소유, 자유텍스트 아님).
--
-- ⚠️ 파일 번호 0055: 0054(diagnoses.patient_friendly_note·8.1) 다음.
--
-- ── 설계 ──
--   환자 포털 펼침 상세는 검사마다 "쉬운 말 결과 요약 + 정상/주의 플래그"를 보인다(목업 .lab·UX-DR20).
--   examinations 엔 findings·reading_conclusion(자유 임상 서사·감사 마스킹·환자 비노출) 뿐 — 환자에게
--   보일 구조적 결과·플래그가 없다. → nullable 컬럼 2개 신설(8.1 diagnoses.patient_friendly_note 동형).
--     patient_result_summary = 환자용 쉬운 말 결과 요약(없으면 NULL → 클라가 안내 폴백).
--     patient_result_flag    = 정상/주의 구조적 플래그(normal|attention·색 비의존 배지 진실 원천·NULL=배지 없음).
--   값은 판독의가 채움(실운영)·demo_seed 가 채움(데모). 적용된 기존 DB(데모 클라우드)는 NULL(폴백).
--   ⚠️ 검사 수치·참조범위는 구조화 컬럼으로 만들지 않는다(원천 없음·허위 금지) — 수치는 판독의가
--      summary 산문에 녹여 작성. 부재는 펼침 하단 안내("자세한 수치…의원 보관")가 덮는다.
--
-- ── 권한·RLS 변경 0 ── examinations 는 이미 examinations_select_self(0015·본인 내원 경유)·_select_staff
--   (order.read). 새 컬럼은 그 정책에 자동 포함.
--
-- ⚠️ 감사 마스킹 변경 0 ── patient_result_* 는 **환자에게 보이도록 큐레이션된 평이한 글로스**다
--   (findings/reading_conclusion 임상 서사와 달리). api/app/services/audit.py `_SENSITIVE_KEY` +
--   web `audit.ts SENSITIVE_KEY` 에 **등록하지 않는다**(마스킹하면 환자 포털 자기 데이터가 가려지는
--   모순 — diagnoses.patient_friendly_note 동일 posture). examinations 감사 트리거(0015 기부착)가
--   새 컬럼을 자동 스냅샷하나 평이한 글로스라 평문 보존이 정당.
--
-- 의존: 0015(examinations 스키마·examinations_select_self), 0020(findings/reading_conclusion — 대비용).

alter table public.examinations
  add column if not exists patient_result_summary text;            -- 환자용 쉬운 말 결과 요약

alter table public.examinations
  add column if not exists patient_result_flag text                -- 정상/주의 구조적 플래그
    check (patient_result_flag is null or patient_result_flag in ('normal', 'attention'));

comment on column public.examinations.patient_result_summary is
  '환자 포털용 쉬운 말 검사 결과 요약(Story 8.2·FR-121). nullable — 없으면 안내 폴백. 값은 판독의/seed 소유. 마스킹 제외(환자 노출용 큐레이션).';
comment on column public.examinations.patient_result_flag is
  '환자용 정상/주의 플래그(normal|attention·Story 8.2). nullable — 없으면 배지 미표시. 색 비의존 배지의 진실 원천.';
