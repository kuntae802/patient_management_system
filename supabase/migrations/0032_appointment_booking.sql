-- 0032_appointment_booking.sql — 예약 생성(메모·SMS 동의) + appointment.create 권한
-- Story 6.3 / FR-013(더블부킹 차단·표면화). 0031(appointments 본체·EXCLUDE) 위에 booking-peek 가
-- 쓰는 컬럼 2종 + 생성 권한만 더한다. 식별자 영문 snake_case(docs/glossary.md). timestamptz=UTC.
--
-- ⚠️ 파일 번호 0032: Epic 6 블록 0030~ 의 세 번째(6.1=0030 근무표·6.2=0031 예약 본체).
--    병렬 Epic 5(0015~0029)와 비충돌.
--
-- ⚠️ 스코프(6.3): 예약 생성 토대(컬럼·권한)만. **예약 상태 전이 트리거(enforce_appointment_transition)·
--    변경/취소/노쇼 RPC·encounters.reservation_id 배선 = 6.4**(원무 대리 생성·변경·취소). 본 파일은
--    전이/링크 미포함 — 0031 status CHECK(어휘) + EXCLUDE(더블부킹 불변식)를 6.3 이 INSERT 로 소비.
--
-- 의존: 0001(확장), 0002(permissions·role_permissions·roles), 0031(appointments + trg_appointments_audit).

-- ── appointments 컬럼 추가(booking-peek 필드) ────────────────────────────────────────────────
-- note = 예약 메모(저민감 운영 텍스트 — doctor_time_offs.reason·encounters.cancel_reason 정합·
--    ⚠️ 임상/PII 자유텍스트 금지 관례). 감사 마스킹 불요: 단수 `note` 는 _SENSITIVE_KEY/SENSITIVE_KEY
--    의 `notes`(복수)에 매칭 안 됨 → 운영 텍스트라 의도된 무마스킹(6.2 가 예고한 "메모 마스킹 검토"의
--    결론; SOAP 자유 임상서사와 구분). sms_opt_in = 예약 확정 SMS 발송 동의(6.6 이 소비·6.3 은 저장만).
alter table public.appointments
  add column if not exists note text;
alter table public.appointments
  add column if not exists sms_opt_in boolean not null default false;

-- 컬럼 ALTER 는 기존 감사 트리거(0031 trg_appointments_audit)가 자동 포착 → 트리거 재부착 불요.

-- ── 권한 카탈로그 확장(예약 생성 게이트) ──────────────────────────────────────────────────────
-- appointment.create = booking-peek 저장 게이트(원무 — 환자·관리자는 6.5/매트릭스). appointment.read
-- (0031, 슬롯·캘린더 조회)와 별개 권한(최소권한 — 조회만 가능한 역할과 분리).
insert into public.permissions (code, name, resource, action) values
  ('appointment.create', '예약 생성', 'appointment', 'create')
on conflict (code) do nothing;

-- admin 부트 grant(신규 권한만; 비-admin grant 는 Story 1.7 매트릭스 UI 소관). 멱등.
-- ⚠️ 필수: 0002 admin cross-join 은 후행 마이그레이션 권한을 자동 포함하지 않는다(누락 시
--    test_admin_role_has_all_permissions 회귀 — 0010·0012·0013·0014·0015·0031 이 겪은 함정).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'appointment.create'
where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;
