-- 0037_appointment_reassignment.sql — 휴진 재배정/취소 환자 안내 종류 어휘 확장
-- Story 6.8 / FR-016(휴진 등록 시 영향 예약 표시·재배정·안내 지원). 사용자 확정 = "6.6 알림 이음매 확장":
-- 영향 예약 재배정/취소 시 환자 안내(통지)를 6.6 notification_logs(0035) 에 시뮬 기록한다. 본 마이그는
-- 그 안내 2종(reschedule_notice·cancellation_notice)을 reminder_kind 어휘에 더하는 CHECK 교체 한 건.
-- 식별자 영문 snake_case(docs/glossary.md). timestamptz=UTC. 불변식·감사는 DB 가 소유.
--
-- ⚠️ 파일 번호 0037: Epic 6 블록 0030~ 의 여덟 번째·마지막(6.1=0030·6.2=0031·6.3=0032·6.4=0033·
--    6.5=0034·6.6=0035·6.7=0036). 병렬 Epic 5(0015~0029)와 비충돌.
--
-- ⚠️ 신규 권한·테이블·컬럼 0: 영향 조회=기존 `appointment.read`(0031)·재배정=기존
--    `appointment.update`(0033)·안내 기록=기존 `notification.send`(0035) 경로 안. → 0002 admin
--    cross-join 재실행 불요·`test_admin_role_has_all_permissions` 무영향(6.7 posture 미러).
--
-- ⚠️ 네이밍 부채(인지·이월): 컬럼명 `reminder_kind` 가 이제 "알림 종류"(리마인더 d_minus_3/d_minus_1 +
--    변경 통지 reschedule_notice/cancellation_notice)를 함께 담는다. 정식 리네임(`notification_kind`)은
--    범위 밖 — 의미는 값 어휘로 구분한다(UNIQUE(appointment_id, reminder_kind) 는 안내도 종류별 1건 멱등).
--
-- ⚠️ TS 타입 영향 없음: CHECK 값 변경은 `supabase gen types` 생성 타입(reminder_kind: string)에
--    나타나지 않는다 → 재생성 불요(관례상 실행 무해).
--
-- 의존: 0035(notification_logs·reminder_kind CHECK·UNIQUE(appointment_id, reminder_kind)),
--    0031(appointments), 0033(appointment.update).

-- ── reminder_kind 어휘 확장(d_minus_3·d_minus_1 → + reschedule_notice·cancellation_notice) ──────
-- 0035 의 인라인 CHECK 는 PG 자동명 `notification_logs_reminder_kind_check` 로 생성됨(검증 완료).
-- drop if exists 로 멱등 교체(자동명이 다르면 적용 시 잔존 제약과 충돌로 즉시 드러남 → 교정).
alter table public.notification_logs
  drop constraint if exists notification_logs_reminder_kind_check;
alter table public.notification_logs
  add constraint notification_logs_reminder_kind_check
  check (reminder_kind in ('d_minus_3', 'd_minus_1', 'reschedule_notice', 'cancellation_notice'));

comment on column public.notification_logs.reminder_kind is
  '알림 종류 — 리마인더(d_minus_3·d_minus_1·Story 6.6) + 변경 통지(reschedule_notice·cancellation_notice·'
  'Story 6.8 휴진 재배정/취소 안내). UNIQUE(appointment_id, reminder_kind) 로 종류별 1건 멱등. '
  '컬럼명 reminder_kind 리네임(notification_kind)은 이월.';
