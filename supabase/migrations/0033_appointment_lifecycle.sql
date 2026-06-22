-- 0033_appointment_lifecycle.sql — 예약 상태 전이(변경·취소·노쇼·완료) 상태머신 + appointment.update
-- Story 6.4 / FR-011(원무 대리 생성·변경·취소). appointment.status 가 예약 생명주기 단일 진실
-- (Option A): booked → cancelled | no_show | completed. 내원은 도착 시점에만 생성(reserved·registered).
-- 식별자 영문 snake_case. timestamptz=UTC. 불변식·감사는 DB 소유(트리거·EXCLUDE·감사 트리거 0031).
--
-- ⚠️ 파일 번호 0033: Epic 6 블록 0030~ 의 네 번째(6.1=0030·6.2=0031·6.3=0032). 병렬 Epic5(0015~0029) 비충돌.
--
-- ⚠️ enforce_appointment_transition = **BEFORE UPDATE 만**(INSERT 초기상태 가드 없음): 6.3
--    test_double_booking_adjacent_and_cancelled_allowed 가 cancelled 를 직접 INSERT(EXCLUDE 부분 술어
--    검증) → INSERT 가드 추가 시 회귀. 초기상태는 0031 status CHECK + default 'booked' 가 담당.
--
-- 의존: 0031(appointments·status CHECK·trg_appointments_audit), 0010(enforce_encounter_transition 미러·
--    PT409 규약), 0002(permissions·role_permissions), 0004(audit 자동 포착).

-- ── 전이 타임스탬프·사유 컬럼(encounters 미러) ───────────────────────────────────────────────
-- cancelled_at/no_show_at/completed_at = 전이 시각(nullable·6.7 노쇼 카운트·감사 근거). cancel_reason =
-- 저민감 운영 사유(encounters.cancel_reason·doctor_time_offs.reason 정합·임상/PII 자유텍스트 금지·
-- 단수 키라 _SENSITIVE_KEY 미매칭 → 마스킹 불요).
alter table public.appointments add column if not exists cancelled_at timestamptz;
alter table public.appointments add column if not exists no_show_at   timestamptz;
alter table public.appointments add column if not exists completed_at timestamptz;
alter table public.appointments add column if not exists cancel_reason text;

-- ── 전이 강제 트리거(상태머신 단일 진실 — service_role/직접 update 까지 봉쇄) ────────────────────
-- enforce_encounter_transition(0010) 미러. **BEFORE UPDATE 만**(위 ⚠️). 상태 변경 없으면(reschedule 등
-- 비-상태 컬럼 갱신) 통과. booked → cancelled|no_show|completed 만 허용. 종결 상태 = 이탈 전이 없음.
-- 위반 = SQLSTATE 'PT409' → _map_pg_sqlstate → 409 invalid_transition(FastAPI 매핑 변경 0).
create or replace function public.enforce_appointment_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then  -- 비-상태 컬럼 갱신(시각 변경=reschedule·메모 등) 통과
    return new;
  end if;
  if not (
    old.status = 'booked' and new.status in ('cancelled', 'no_show', 'completed')
  ) then
    raise exception 'invalid appointment transition: % -> %', old.status, new.status
      using errcode = 'PT409';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_appointments_transition on public.appointments;
create trigger trg_appointments_transition
  before update on public.appointments
  for each row execute function public.enforce_appointment_transition();

-- ── 권한 카탈로그 확장(예약 변경·취소·노쇼·접수 게이트) ────────────────────────────────────────
-- appointment.update = 기존 예약 상태 변경(cancel/no_show/reschedule/complete) 게이트(원무 — 환자는
-- 매트릭스). appointment.read(조회)·appointment.create(생성)와 별개 최소권한.
insert into public.permissions (code, name, resource, action) values
  ('appointment.update', '예약 변경·취소', 'appointment', 'update')
on conflict (code) do nothing;

-- admin 부트 grant(신규 권한만; 비-admin grant 는 Story 1.7 매트릭스 UI 소관). 멱등.
-- ⚠️ 필수: 0002 admin cross-join 은 후행 마이그레이션 권한을 자동 포함하지 않는다(누락 시
--    test_admin_role_has_all_permissions 회귀 — 0010·0012~0015·0031·0032 함정).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'appointment.update'
where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;
