-- 0036_no_show_policy.sql — 환자별 노쇼 카운트 단일 진실 함수(임계치 제한의 집계 토대)
-- Story 6.7 / FR-015(환자별 노쇼 횟수 기록·임계치 기본 2회 초과 시 예약 제한). UX-DR15("노쇼 임계 초과 제한").
-- 식별자 영문 snake_case(docs/glossary.md). timestamptz=UTC. 불변식·감사는 DB 가 소유.
--
-- ⚠️ 파일 번호 0036: Epic 6 블록 0030~ 의 일곱 번째(6.1=0030·6.2=0031·6.3=0032·6.4=0033·6.5=0034·
--    6.6=0035). 병렬 Epic 5(0015~0029·간호 0017 포함)와 비충돌.
--
-- ⚠️ 노쇼 카운트 = **파생(derived)**, 비정규화 컬럼 없음: `patients.no_show_count` 같은 카운터를
--    두지 않는다. 예약 생명주기는 `appointments.status` 가 단일 진실(Option A·6.4 확정) →
--    `status='no_show'` 행 수가 곧 노쇼 횟수다(드리프트 차단). AC1 "기록"은 6.4 `mark_appointment_no_show`
--    (booked→no_show·no_show_at) 가 이미 충족 — 본 스토리는 그것을 **집계·강제**한다.
--
-- ⚠️ encounters.no_show 는 세지 않는다: 노쇼 슬롯 낭비는 *예약(reservation)* 미방문 문제. walk-in 내원
--    no_show 는 예약 슬롯을 점유하지 않았으므로 카운트 대상 아님(이중 집계·비-예약 사건 혼입 방지).
--
-- ⚠️ 임계치(기본 2회)는 **DB 가 모른다** — 앱 상수(`db.NO_SHOW_THRESHOLD`)가 소유. 본 함수는 카운트만
--    반환하고, 초과 판정(count > threshold)은 앱(쓰기 경로 가드 + read 엔드포인트의 `blocked`)이 한다.
--    클리닉 설정 테이블이 없어 단일 값을 위해 테이블을 만들지 않는다(과설계 회피·튜너블 의도는 상수 주석).
--
-- ⚠️ 신규 permission·시드 없음: 읽기는 기존 `appointment.read`(0031)·쓰기 가드는 기존
--    `appointment.create`(0032) 경로 안. → 0002 admin cross-join 재실행 불요·
--    test_admin_role_has_all_permissions 무영향(0010·0012~0015·0031~0033 이 겪은 함정 비해당).
--
-- 의존: 0031(appointments·status CHECK·`status='no_show'`), 0033(no_show_at·전이 트리거).

-- ── 노쇼 카운트 단일 진실 함수 ────────────────────────────────────────────────
-- security invoker(기본): service_role 호출(FastAPI 가드·read 엔드포인트) = RLS 우회·전체 집계·정확.
-- 환자 자가 호출(향후) = appointments_select_self RLS 로 본인 행만 → 본인 카운트 정확. stable(같은 txn
-- 내 동일 결과)·언어 sql(단일 집계). count(*)::int — 노쇼 횟수는 int 범위 충분.
create or replace function public.patient_no_show_count(p_patient_id uuid)
returns integer
language sql
stable
as $$
  select count(*)::int
  from public.appointments
  where patient_id = p_patient_id and status = 'no_show';
$$;

comment on function public.patient_no_show_count(uuid) is
  '환자별 노쇼(미방문) 예약 수 — appointments.status=''no_show'' 집계(단일 진실·파생·비정규화 컬럼 없음). '
  'Story 6.7/FR-015. 임계 판정(count>threshold)은 앱(db.NO_SHOW_THRESHOLD)이 수행.';

-- ── EXECUTE 권한(0031 GRANT posture 미러 — service_role + authenticated) ──────────────────────
-- public 회수 후 명시 grant: service_role(FastAPI 가드·읽기)·authenticated(향후 환자/직원 직접 RPC 대비·
-- RLS 가 행 범위 제한). 비-PII 집계(카운트 정수만).
revoke all on function public.patient_no_show_count(uuid) from public;
grant execute on function public.patient_no_show_count(uuid) to authenticated, service_role;
