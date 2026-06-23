-- 0054_diagnosis_patient_note.sql — 진단 마스터에 "환자 쉬운 말 부연" 컬럼 추가
-- Story 8.1 / FR-120(환자 본인 내원 이력 조회 — 내 기록 카드의 진단 쉬운 말 부연).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실). 마스터 데이터는 단일 진실(project-context).
--
-- ⚠️ 파일 번호 0054: Epic 7 마이그 블록 0045~0053 다음(첫 Epic 8 마이그).
--
-- ── 설계 ──
--   환자 포털 "내 기록" 카드는 KCD 진단명 옆에 쉬운 말 부연을 보인다(예: "고혈압 (혈압이 높은 상태)",
--   UX-DR23 8.2 도 재사용). diagnoses 마스터엔 code·name 만 있어 부연 소스가 없다 → nullable 컬럼 1개 신설.
--   부연이 없는 진단은 NULL → 클라가 진단명만 표시(우아한 폴백). 환자 자유텍스트 아님(마스터 큐레이션 값).
--
-- ── 구조만 ── 본 마이그는 컬럼 ADD 만 한다(DDL). 부연 **값**은 seed.sql 이 소유한다(마스터 단일 진실,
--   Story 2.5 시드 선례). 마이그레이션은 seed 보다 먼저 실행되므로 여기서 UPDATE 해도 빈 테이블(0행)이라
--   무의미하다 — 값은 seed insert 가 채운다. 적용된 기존 DB(데모 클라우드)는 NULL 유지(폴백·환자 미시드).
--
-- ── 권한·RLS 변경 0 ── diagnoses 는 이미 `grant select to authenticated`(0007) + `diagnoses_select_authenticated`
--   (전체 authenticated SELECT). 새 컬럼은 그 정책에 자동 포함 — 환자도 부연을 읽는다(비-PII 마스터 데이터).

alter table public.diagnoses
  add column if not exists patient_friendly_note text;

comment on column public.diagnoses.patient_friendly_note is
  '환자 포털용 쉬운 말 부연(Story 8.1·UX-DR23). nullable — 없으면 진단명만 표시. 값은 seed.sql 소유.';
