-- 0011_encounter_call.sql — 환자 호출(call) 상태 기록 + encounters 실시간 publication (Story 4.3)
-- 대기 현황판(FR-022)·다음 호출 안내(FR-023 — 호출 상태 기록 → 중복 호출·누락 방지). UX-DR6/7/8·18/21.
--
-- ⚠️ 핵심 모델: "호출(call)" 은 상태 전이가 아니다 — encounter_status 6값(0010)에 'called' 없음.
--   환자를 호출해도 내원은 'registered' 에 머문다(진찰 시작=start_consult 가 in_progress 로 전이, 4.4).
--   FR-023 "호출 상태 기록" 의 목적 = 중복 호출·누락 방지 → 전이가 아닌 **비-상태 마커 컬럼**
--   (called_at/call_count/last_called_by) + record_encounter_call RPC 로 모델링한다.
--   재호출(이미 registered 인 행을 다시 부르기)은 정상 동작 — call_count 증가(전이 아님).
--   · 감사: 0010 trg_encounters_audit(AFTER UPDATE)가 호출 UPDATE 를 자동 append-only 기록(FR-023 "기록").
--   · 전이 트리거(0010 enforce_encounter_transition)는 same-status UPDATE 통과(new.status=old.status
--     → return new)므로 비-상태 컬럼만 갱신하는 호출 UPDATE 를 막지 않는다(트리거 사각 활용, 위반 0).
--
-- 실시간: encounters 를 supabase_realtime publication 에 추가(코드베이스 최초 realtime 도입 — 0010
--   까지 어떤 마이그레이션도 publication/replica identity 미설정). 대기 현황판이 진료과 필터
--   postgres_changes 로 구독(payload=encounters 비-PII 행: patient_id=FK·status·called_at — 환자명
--   없음 → UX-DR22 충족) → FastAPI GET /encounters(denormalized 조인)를 refetch.
--
-- 권한: encounter.call 신규(원무·의사가 다음 환자 호출). admin 부트 grant + 비-admin 은 1.7 매트릭스/
--   데모 seed 소관(0002/0010 패턴). 쓰기는 service_role/SECURITY DEFINER RPC 만(authenticated 직접 X).
--
-- 의존: 0002(permissions·role_permissions·roles), 0003(has_permission), 0010(encounters·전이/감사 트리거).

-- ── 호출 상태 컬럼(비-상태 마커 — 상태머신과 분리, 저민감·비-PII → 감사 마스킹 집합 변경 불요) ──
alter table public.encounters
  add column if not exists called_at      timestamptz,                       -- 최종 호출 시각
  add column if not exists call_count     integer not null default 0,        -- 누적 호출 횟수(재호출 포함)
  add column if not exists last_called_by uuid references public.users (id); -- 최종 호출 직원

-- ── record_encounter_call: 호출 기록(전이 아님 — registered 행에 called_at/count 갱신) ──────
-- SECURITY DEFINER + search_path 고정(0010 전이 RPC 패턴 미러). 본문 순서:
--   ① has_permission('encounter.call') 자체 게이트(= 동일 txn TOCTOU 재평가; 미보유 → 42501→403)
--   ② select ... for update(행 잠금; 없으면 PT404→404)
--   ③ 소스 상태 'registered' precondition(미접수/진행중/종결 호출 차단 → PT409→409; 단 이미
--      registered 인 행의 재호출은 허용 = call_count++ — "다시 부르기"는 전이가 아님)
--   ④ called_at=now()·call_count+1·last_called_by=auth.uid() 갱신(전이 트리거 same-status 통과).
create or replace function public.record_encounter_call(p_encounter_id uuid)
returns public.encounters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.encounters;
begin
  if not public.has_permission('encounter.call') then
    raise exception 'permission denied: encounter.call' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from public.encounters where id = p_encounter_id for update;
  if not found then
    raise exception 'encounter not found: %', p_encounter_id using errcode = 'PT404';
  end if;
  if v_row.status <> 'registered' then  -- 호출 대상은 접수(대기) 환자만(미접수/진행중/종결 차단)
    raise exception 'cannot call encounter in status: %', v_row.status using errcode = 'PT409';
  end if;
  update public.encounters
     set called_at = now(), call_count = call_count + 1,
         last_called_by = (select auth.uid()), updated_at = now()
   where id = p_encounter_id
   returning * into v_row;
  return v_row;
end;
$$;

-- ── 권한 카탈로그 확장(0002/0010 패턴 — 리소스 온라인 시 에픽 마이그레이션이 확장) ──────────
insert into public.permissions (code, name, resource, action) values
  ('encounter.call', '환자 호출', 'encounter', 'call')
on conflict (code) do nothing;

-- admin 부트 grant(신규 권한만; 비-admin grant 는 Story 1.7 매트릭스 UI/데모 seed 소관). 멱등.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'encounter.call'
where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;

-- 전이 RPC 패턴 — RPC 자체 has_permission 게이트 → authenticated 직접 호출도 안전(방어심층 + DB 테스트).
grant execute on function public.record_encounter_call(uuid) to authenticated, service_role;

-- ── 실시간 publication(코드베이스 최초) — 대기 현황판 postgres_changes 구독 ────────────────
-- supabase_realtime 은 Supabase 로컬에 기본 존재(빈 publication). replica identity full = RLS-필터
-- realtime 의 UPDATE/DELETE 시 행 데이터 보장(Supabase 권장). encounters 미등록 시에만 add(멱등 —
-- db reset 은 클린이나 수동 재실행 대비; 이미 member 면 'relation is already member' 회피).
alter table public.encounters replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public' and tablename = 'encounters'
     )
  then
    alter publication supabase_realtime add table public.encounters;
  end if;
end $$;
