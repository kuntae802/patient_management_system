-- 0034_patient_self_booking.sql — 환자 본인 예약을 위한 created_by 비정규화(FK 제거)
-- Story 6.5 / FR-010(환자 앱 슬롯 조회·예약). 환자는 앱에서 본인 예약을 직접 생성하며, 예약
-- 생성자(created_by)는 환자의 auth uid(= JWT sub = patients.auth_uid)다. 그러나 이 uid 는
-- public.users(직원 신원)에 없다(분리 프로필: 직원=users.id / 환자=patients.auth_uid) → 0031 의
-- created_by → users FK 가 본인 예약 INSERT 를 막는다.
--
-- 해소(Option C·사용자 확정): created_by 의 users FK 만 제거하고, 의미를 '예약 생성자(원무/시스템)'
-- → '생성자 auth uid'(직원 uid 또는 환자 auth_uid)로 확장한다. audit_logs.actor_id 선례와 동일
-- 패턴(0004:5-10 — "직원·환자의 auth uid", FK 미부착 이유 명시). created_by 는 NOT NULL 유지(직원·
-- 환자 모두 항상 sub 보유)·doctor_id(→users)·patient_id(→patients) FK 는 무변경.
--
-- ⚠️ 파일 번호 0034: Epic 6 블록 0030~ 의 다섯 번째(6.1=0030·6.2=0031·6.3=0032·6.4=0033). 병렬
--    Epic5(0015~0029) 비충돌. 신규 권한·시드 없음(환자는 RBAC 권한 0 — 본인 예약 경로는
--    get_current_patient + 서버 patient_id 도출이 권위).
--
-- 의존: 0031(appointments·created_by FK·status·EXCLUDE), 0009(patients·auth_uid), 0004(audit).

-- ── created_by FK 제거(비정규화 생성자 auth uid) ───────────────────────────────────────────────
-- if exists 로 멱등(이미 제거/재적용 안전). 잔존 FK 0 은 test_migrations_appointments 가 검증.
alter table public.appointments drop constraint if exists appointments_created_by_fkey;

comment on column public.appointments.created_by is
  '예약 생성자 auth uid(비정규화) — 직원 uid(public.users.id) 또는 환자 auth_uid(public.patients.auth_uid). '
  'FK 미부착(audit_logs.actor_id 선례·분리 프로필). NOT NULL.';
