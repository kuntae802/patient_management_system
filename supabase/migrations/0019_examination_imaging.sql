-- 0019_examination_imaging.sql — 영상검사 촬영 영상(examination_images) 1:N 테이블 + Storage 버킷 + RLS·GRANT·감사.
-- Story 5.8 / FR-100(촬영 워크리스트)·FR-101(촬영 수행·영상 Storage 업로드, URL 아닌 경로만 DB)·FR-103(장비 목록·상태).
-- 식별자 영문 snake_case(docs/glossary.md 단일 진실 — examination_images·storage_path 신규 등재). timestamptz=UTC. soft delete=is_active.
-- 한국어는 UI 라벨·주석만.
--
-- ⚠️ 촬영 수행 엔진은 0015 가 완비 — 본 파일은 소비 + 영상 저장만. 신규 DDL = examination_images 테이블 + Storage 버킷뿐.
--    perform_examination RPC(0015:194 — ordered→performed·소스상태 precondition=FR-093 재수행 차단·performed_by/at 세팅·
--    examination.perform 자가 게이트)·전이 트리거(enforce_act_order_transition — same-status UPDATE 통과 → equipment_id 배정 허용)·
--    examinations 스키마(equipment_id·performed_by/at 컬럼 기보유)·equipment 테이블·RLS·GRANT·감사는 0015 소유.
--    examination.perform / order.read 는 0015:282 기존 권한(radiologist seed grant 5.1) → **신규 권한·admin 부트 grant 불요**.
--
-- ⚠️ 영상 자료 = Supabase Storage 버킷(비공개) + 서버 발급 서명 URL. **DB 엔 객체 경로(storage_path)만**(architecture.md:217).
--    한 영상검사 = 영상 N장(흉부 PA+측면 등) → 1:N 테이블. 파일 바이트·공개 URL·서명 URL 은 DB 미저장(서명 URL 은 읽을 때 재생성).
--    🔒 객체 경로/파일명에 PII 금지(`{examination_id}/{uuid4}.{ext}` — chart_no·환자명·주민번호 미포함, EXPERIENCE.md:193-194).
--
-- ⚠️ 자유 임상 서사 컬럼 없음(storage_path=경로·content_type/file_size=구조화) → 감사 스냅샷 마스킹 무변경
--    (0017 vital_signs 자세 — _SENSITIVE_KEY 불변. 0018 nursing_record 의 자유텍스트 content 와 대비). 판독 소견 텍스트는 5.9 소유.
--
-- ⚠️ Epic 5 마이그 블록 = 0015~0029 고정(병렬 Epic 6 워크트리 0030~ 비침범). 0019 = examination_imaging(0018 다음).
--
-- 의존: 0001(gen_random_uuid), 0002(users), 0003(has_permission·order.read 헬퍼), 0004(audit_trigger_fn),
--   0009(patients — RLS self 경로), 0010(encounters — self 경로), 0015(examinations FK·order.read·examination.perform 권한).

-- ── examination_images (영상검사 촬영 영상 — 한 검사에 N장, 매 업로드 = 새 행 append) ──────────
-- storage_path = 비공개 버킷 내 객체 경로(서명 URL 아님). 추적 = 업로더(uploaded_by)·시각.
-- examinations(0015) 1:N. status='ordered'(촬영 전) 동안만 업로드, 수행(perform) 시 ≥1 강제(서비스/wrapper).
create table if not exists public.examination_images (
  id             uuid primary key default gen_random_uuid(),
  examination_id uuid not null references public.examinations (id),  -- 1:N(해당 영상검사 오더에 연결)
  storage_path   text not null,                                      -- 비공개 버킷 객체 경로(서명 URL 아님·PII 금지)
  content_type   text not null,                                      -- MIME(image/png·jpeg·webp)
  file_size      integer,                                            -- 바이트(참조용·nullable)
  uploaded_by    uuid not null references public.users (id),         -- 업로드 방사선사(examination.perform)
  uploaded_at    timestamptz not null default now(),
  is_active      boolean not null default true,                      -- soft delete(잘못 올린 영상 비활성)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_examination_images_examination_id on public.examination_images (examination_id);

-- ── 권한 posture(테이블 단위 GRANT — 민감 reveal 컬럼 없음, 0017/0018 자세) ────────────────
-- ⚠️ 신규 권한 없음 — 촬영 수행=examination.perform·조회=order.read 모두 0015 기존(radiologist seed grant) →
--    admin 부트 재grant 불요(test_admin_role_has_all_permissions 회귀 0, 5.3 posture).
revoke all on public.examination_images from anon, authenticated;
grant select, insert, update, delete on public.examination_images to service_role;  -- 쓰기 = service_role(FastAPI)
grant select on public.examination_images to authenticated;                          -- RLS 행 게이트

-- ── RLS(방어심층 — FastAPI=service_role 가 RLS 우회하므로 조회 권위는 라우터 require_permission;
--    본 정책은 환자 포털 Supabase 직결 경로[Epic 8] + 일관성 대비) ──────────────────────
alter table public.examination_images enable row level security;

-- 직원 = order.read(의사 판독·간호·방사선 임상 컨텍스트 읽기). examinations_select_staff(0015) 미러.
drop policy if exists examination_images_select_staff on public.examination_images;
create policy examination_images_select_staff on public.examination_images
  for select to authenticated using (
    (select public.has_permission('order.read'))
  );

-- 환자 = 본인 내원의 영상만(image → examination → encounter → patient → auth_uid, 포털 Epic 8).
-- nursing_record_select_self 미러에 examinations 한 단계 추가.
drop policy if exists examination_images_select_self on public.examination_images;
create policy examination_images_select_self on public.examination_images
  for select to authenticated using (
    exists (
      select 1 from public.examinations ex
      join public.encounters e on e.id = ex.encounter_id
      join public.patients p on p.id = e.patient_id
      where ex.id = examination_images.examination_id and p.auth_uid = (select auth.uid())
    )
  );

-- 쓰기 정책 없음 = authenticated 의 INSERT/UPDATE/DELETE 거부(쓰기는 service_role/FastAPI 가 RLS 우회).

-- ── 감사 트리거 부착(0004 audit_trigger_fn 재사용 — append-only, actor 동반) ──────────
-- storage_path(경로)·content_type·file_size·FK·플래그·timestamp 는 구조화/비-PII → 마스킹 무변경.
-- id(uuid PK)=target_id 계약 충족.
drop trigger if exists trg_examination_images_audit on public.examination_images;
create trigger trg_examination_images_audit after insert or update or delete on public.examination_images
  for each row execute function public.audit_trigger_fn();

-- ── Storage 버킷(비공개 — 영상 자료) ────────────────────────────────────────────────
-- architecture.md:326 가 예고한 `storage.sql` 을 별도 파일 대신 본 번호 마이그에 인라인(단일 소스 재현성 —
-- supabase db reset/push 가 마이그만 적용·standalone storage.sql 미자동실행). 멱등.
-- 🔒 public=false → 접근은 service_role(FastAPI) 서명 URL 전용. storage.objects 에 authenticated 직접접근 정책
--    부여 안 함(deny-by-default; 서명 URL 은 RLS 우회 사전인가). file_size_limit=50MiB·이미지 MIME 화이트리스트.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'examination-images', 'examination-images', false, 52428800,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;
