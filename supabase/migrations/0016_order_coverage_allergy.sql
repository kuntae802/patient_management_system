-- 0016_order_coverage_allergy.sql — 오더 패널 통합(5.5)용 스키마 보강:
--   ① 급여/비급여 마스터 속성(fee_schedules·drugs.coverage_type) — UX-DR13 pay-chip·수가 자동 산정 프리뷰 데이터 소스.
--   ② 알레르기 오버라이드 사유(prescription_details.allergy_override_reason) — UX-DR21② 교차검증 사유기록+감사.
-- Story 5.5 / UX-DR13(order-panel), UX-DR21②(알레르기↔오더 교차검증 — 서버 강제 사유 오버라이드+감사).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실). 한국어는 UI 라벨만.
--
-- ⚠️ 경계: coverage_type 은 급여/비급여 **분류 flag**(마스터 속성)다. 본인부담률·산정특례·수가 자동발생(수납상세
--    적재)·약가 = Epic 7(7.x)·5.10 소유 — 0007 주석("급여여부·본인부담률은 Epic 7")과 화해: 분류=5.5, 산정=Epic7.
--    coverage_type 2상태(covered/non_covered)만 — 선별급여/부분급여 미모델(목업 pay-chip cov/non 2종).
--
-- ⚠️ Epic 5 마이그 블록 = 0015~0029 고정(병렬 Epic 6 워크트리 0030~ 비침범). 0016 = Epic 5 후속 첫 번호.
--
-- 의존: 0007(fee_schedules·drugs 마스터), 0015(prescription_details + trg_prescription_details_audit 감사 트리거).
--   ⚠️ prescription_details 는 0015 가 이미 감사 트리거(trg_prescription_details_audit, 0015:402-404) 보유 →
--      allergy_override_reason INSERT/UPDATE 가 after_data 로 append-only 자동 캡처. 감사 트리거 추가 불요.

-- ── ① 급여/비급여 마스터 속성 ────────────────────────────────────────────────
-- fee_schedules(검사·영상·처치 FK)·drugs(처방 FK) 둘 다 — pay-chip 을 모든 오더 유형에 그리려면 양쪽 필요.
-- default 'covered'(급여 다수)로 기존 행 무중단. 영문 enum(covered=급여 / non_covered=비급여).
alter table public.fee_schedules
  add column if not exists coverage_type text not null default 'covered'
    check (coverage_type in ('covered', 'non_covered'));

alter table public.drugs
  add column if not exists coverage_type text not null default 'covered'
    check (coverage_type in ('covered', 'non_covered'));

-- ── ② 알레르기 오버라이드 사유(처방상세 라인별) ──────────────────────────────
-- 약품 1개 = 상세 1라인 → conflict 는 라인별 → 사유도 라인에 기록(nullable, conflict 없으면 NULL).
-- 임상 자유 서사 → 감사 마스킹 대상(audit.py/_SENSITIVE_KEY 에 키 추가 — 서버+웹 거울, Story 5.5 Task 7).
alter table public.prescription_details
  add column if not exists allergy_override_reason text;
