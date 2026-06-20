-- 0008_masters_code_ci_unique.sql — 마스터 코드 대소문자 무관 unique (Story 2.4 / FR-203·AC6)
-- 마스터 5종(진료과·진료실·진단·수가·약품)의 `code` UNIQUE 를 대소문자 무관으로 강화한다.
-- 동기: `code text unique`(0006·0007)는 `ORTHO`/`ortho`/`Ortho` 를 별개로 허용 → 단일 진실(Epic 2)에 균열.
--
-- 방식: `lower(code)` 함수 unique 인덱스로 교체(citext 미사용). citext 면 컬럼 타입이 바뀌어 전 비교·조인
--       경로에 영향 → 함수 인덱스가 더 보수적이며 **원본 케이스 표시는 그대로 보존**(유일성만 대소문자 무관).
--       기존 인라인 `unique` 가 만든 제약 `<table>_code_key`(+백킹 인덱스)를 drop 한 뒤 함수 인덱스를 만든다.
--       FK 는 `departments(id)`(PK)만 참조하므로 code 제약 교체는 안전(code 를 참조하는 FK 없음).
--       insert 핸들러(api db.py)의 `UniqueViolationError → code_taken` 매핑은 제약명 비의존(broad catch)이라
--       인덱스명이 바뀌어도 무영향.
--
-- ⚠️ 파일 번호 0008: 0001~0007 적용됨(0005=crypto, 0006=조직 마스터, 0007=코드 마스터). 본 파일이 0008 을
--    차지하므로 아키텍처 계획의 `0008_patients`(Epic 3)는 **0009 로 한 칸 더 cascade**(glossary.md §마이그레이션
--    번호 변이 — 0005 crypto·0007 codes 와 동일한 의도된 변이). 적용된 0001~0007 은 편집 금지(마이그레이션 불변성).
--
-- 멱등: drop constraint if exists + create unique index if not exists. 현재 충돌 데이터 없음(시드 전 — 관리자
--       입력만, 2.5 시드는 본 인덱스 위에서 적재)이라 인덱스 생성 안전.

-- ── departments (진료과) ──────────────────────────────────────────────────────
alter table public.departments drop constraint if exists departments_code_key;
create unique index if not exists departments_code_lower_key on public.departments (lower(code));

-- ── rooms (진료실) ────────────────────────────────────────────────────────────
alter table public.rooms drop constraint if exists rooms_code_key;
create unique index if not exists rooms_code_lower_key on public.rooms (lower(code));

-- ── diagnoses (KCD 진단) ──────────────────────────────────────────────────────
alter table public.diagnoses drop constraint if exists diagnoses_code_key;
create unique index if not exists diagnoses_code_lower_key on public.diagnoses (lower(code));

-- ── fee_schedules (EDI 수가) ──────────────────────────────────────────────────
alter table public.fee_schedules drop constraint if exists fee_schedules_code_key;
create unique index if not exists fee_schedules_code_lower_key on public.fee_schedules (lower(code));

-- ── drugs (약품) ──────────────────────────────────────────────────────────────
alter table public.drugs drop constraint if exists drugs_code_key;
create unique index if not exists drugs_code_lower_key on public.drugs (lower(code));
