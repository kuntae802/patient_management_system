-- 0049_payment_receipt.sql — 진료비 계산서·영수증 출력 토대(요양기관 마스터 + 문서 내보내기 감사)
-- Story 7.5 / FR-113(표준 진료비 계산서·영수증), UX-DR14·UX-DR22(법정 서식·인쇄/PDF PII·내보내기 감사).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실). 금액=KRW 정수. timestamptz=UTC.
-- 불변식·감사는 DB 가 소유 — 감사 기록을 우회 불가하게 RPC 로 강제(project-context).
--
-- ⚠️ 파일 번호 0049: Epic 7 마이그 블록 0045~0059(0048_payment_finalize 다음).
--
-- ── 문서 출력 레이어(0045 컬럼 → 0046 적재 → 0047 산정 → 0048 결제·완료 → 0049 문서) ──
--   7.1~7.4 가 수납 건을 집계→산정→finalize(결제·내원완료·영수증번호)까지 채웠다.
--   본 스토리(7.5) = finalized 수납 건을 법정 서식 「진료비 계산서·영수증」으로 렌더(브라우저 인쇄).
--   이 마이그레이션은 그 두 토대를 만든다:
--     ① clinic_profile — 영수증 헤더의 요양기관 정보(병원명·사업자번호·요양기관기호·주소·대표자·전화).
--        현재 organization/clinic 마스터 부재 → 신규 단일행 마스터(요양기관 단일 운영 가정).
--     ② log_payment_document_export — 문서 인쇄/내보내기를 'read' 감사 이벤트로 기록(UX-DR22
--        "민감 문서 인쇄/내보내기 자체가 감사 이벤트"). 제네릭(document_type) → 7.6 세부산정내역서 재사용.
--   **세부산정내역서=7.6 · 원외처방전=7.7 · 서버측 PDF 생성=이월(브라우저 인쇄 채택) · full RRN 문서
--     reveal=이월(영수증은 masked RRN 만).**
--
-- ── 설계 결정 4건(사용자 확정 2026-06-24·AskUserQuestion) ──
--   ① 인쇄/PDF = 브라우저 window.print() + @media print(Batang serif) — 신규 라이브러리 0(서버 PDF 이월).
--   ② 요양기관 정보 = 시드 1행 clinic_profile 테이블(관리 UI 없음·seed 만·7.6/7.7 재사용).
--   ③ 데이터·감사 = 전용 GET .../payment/receipt + POST .../payment/receipt/export(log_payment_document_export).
--   ④ 주민번호 = masked RRN 만(resident_no_masked·full reveal 이월).
--
-- 의존: 0004(audit_logs·action 'read' CHECK·audit_trigger_fn), 0006(departments masters RLS/grant 패턴),
--   0012(reveal_contact — actor 캡처 + 수동 'read' 감사 INSERT 선례), 0045(payments).

-- ════════════════════════════════════════════════════════════════════════════
-- Task 1 — clinic_profile(요양기관 정보 단일행 마스터)
-- ════════════════════════════════════════════════════════════════════════════

-- 영수증 헤더용 요양기관 정보. id=1 CHECK 로 단일행 강제(다기관·지점은 스코프아웃·요양기관 단일 운영).
--   비민감(공개 병원 운영 정보) — 전역 참조(0006 departments 미러: authenticated SELECT·service_role 쓰기).
create table if not exists public.clinic_profile (
  id          smallint primary key default 1 check (id = 1),  -- 단일행 강제(요양기관 1)
  name        text not null,                   -- 병원명(예: ○○의원)
  biz_no      text not null,                   -- 사업자등록번호
  hira_no     text not null,                   -- 요양기관기호(건강보험심사평가원)
  address     text not null,                   -- 주소
  ceo_name    text not null,                   -- 대표자
  phone       text not null,                   -- 전화
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 권한 posture(0006 departments 미러) — 쓰기=service_role(FastAPI)·읽기=authenticated(전역 참조·비민감).
revoke all on public.clinic_profile from anon, authenticated;
grant select, insert, update, delete on public.clinic_profile to service_role;
grant select on public.clinic_profile to authenticated;

-- RLS(방어심층 — service_role 쓰기에도 유지). 전역 참조 데이터: authenticated SELECT 전체 허용,
--   쓰기 정책 없음 = authenticated INSERT/UPDATE/DELETE 거부(service_role 이 RLS 우회).
alter table public.clinic_profile enable row level security;
drop policy if exists clinic_profile_select_authenticated on public.clinic_profile;
create policy clinic_profile_select_authenticated on public.clinic_profile
  for select to authenticated using (true);

-- 감사 트리거(0004 audit_trigger_fn 재사용) — id 컬럼 보유(smallint→text 캐스트 OK·target_id 계약 충족).
--   요양기관 정보 변경(seed/운영)도 actor 와 함께 자동 감사된다.
drop trigger if exists trg_clinic_profile_audit on public.clinic_profile;
create trigger trg_clinic_profile_audit after insert or update or delete on public.clinic_profile
  for each row execute function public.audit_trigger_fn();

-- ════════════════════════════════════════════════════════════════════════════
-- Task 2 — log_payment_document_export(문서 인쇄/내보내기 = 'read' 감사 이벤트)
-- ════════════════════════════════════════════════════════════════════════════

-- UX-DR22 "민감 문서 인쇄/내보내기 자체가 감사 이벤트". 영수증·세부내역서 인쇄/PDF 출력 시 호출되어
--   누가·언제·무슨 문서를 내보냈는지 audit_logs 에 기록한다(우회 불가 — DB 가 소유·service_role only).
--   메커니즘 = 0012 reveal_contact 미러: ① has_permission 동일-txn 재평가(방어심층·라우터 게이트 1차선)
--   ② actor 캡처(app.actor_id UUID 검증 → auth.uid() 폴백·비-UUID 캐스트 abort 방지) ③ 수동 'read' INSERT
--   (action 'read' = 조회/내보내기·0004 CHECK 가 신규 action 불허 → reveal 관례 공유, document_type 으로
--   after_data 에서 구분). raw PII(이름·주민번호·금액) 미적재 — payment_id·document_type 만.
--   제네릭(p_document_type) → 7.6 세부산정내역서도 동일 RPC 재사용('statement').
create or replace function public.log_payment_document_export(
  p_encounter_id uuid,
  p_document_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_status     text;
  v_actor      uuid;
  v_actor_txt  text;
begin
  if not public.has_permission('payment.read') then
    raise exception 'permission denied: payment.read' using errcode = 'insufficient_privilege';
  end if;

  select id, status into v_payment_id, v_status from public.payments where encounter_id = p_encounter_id;
  if v_payment_id is null then
    raise exception 'payment not found for encounter: %', p_encounter_id using errcode = 'PT404';
  end if;

  -- finalized 수납만 문서 출력 대상 — GET .../payment/receipt 의 finalized 게이트(409)와 일관.
  --   draft/cancelled 의 내보내기 감사 적재(audit 오염) 차단. 정상 경로는 finalized 영수증 미리보기.
  if v_status <> 'finalized' then
    raise exception 'document export requires finalized payment: % (status=%)',
      p_encounter_id, v_status using errcode = 'PT409';
  end if;

  -- actor 캡처(0012 reveal_contact L78-85 계약 미러: app.actor_id UUID 형식검증 → auth.uid() 폴백).
  v_actor_txt := nullif(current_setting('app.actor_id', true), '');
  v_actor := coalesce(
    case
      when v_actor_txt ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then v_actor_txt::uuid
    end,
    auth.uid()
  );

  -- 문서 내보내기 = 'read' 감사. document_type(receipt/statement) 은 after_data jsonb 로 구분.
  --   raw 값(이름·주민번호·금액)은 저장하지 않는다(PII 경계 — payment_id·document_type 만).
  insert into public.audit_logs (actor_id, action, target_table, target_id, after_data)
  values (
    v_actor, 'read', 'payments', v_payment_id::text,
    jsonb_build_object('document_type', p_document_type, 'event', 'document_export')
  );
end;
$$;

-- EXECUTE posture(0012 reveal_rrn/reveal_contact 동형) — service_role/FastAPI 만 호출(감사 위조 차단).
revoke all on function public.log_payment_document_export(uuid, text) from public, anon, authenticated;
grant execute on function public.log_payment_document_export(uuid, text) to service_role;
