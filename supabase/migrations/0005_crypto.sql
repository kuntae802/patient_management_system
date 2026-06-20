-- 0005_crypto.sql — PII 암복호 프리미티브(Vault 키 + pgcrypto) + HMAC blind index + 자가-감사 복호
-- Story 1.9 / FR-241(민감정보 pgcrypto 암호화·키는 Vault), FR-003(HMAC 중복 매칭 토대),
--               FR-242(민감정보 조회 = 감사 이벤트).
--
-- 설계 노트:
--   * 제네릭(주민번호 전용 아님) — 모든 PII(연락처·주소 등) 공용 보안 경로(UX-DR22 "모든 PII reveal 일관 게이트").
--     환자 주민번호는 이 함수들의 첫 소비처(Epic 3 patients)일 뿐, 본 마이그레이션은 데이터/컬럼을 만들지 않는다.
--   * 키는 Vault(`vault.secrets`)에 보관 — 코드·DB에 평문 키 없음(FR-241). 키는 gen_random_bytes 로 DB 안에서
--     생성하므로 마이그레이션 파일에 평문 키가 들어가지 않는다. dev `db reset` 시 재생성(데이터도 초기화되어 무해),
--     prod 는 1회 생성 후 유지(멱등 가드).
--   * 암복호 RPC 는 service_role 한정 SECURITY DEFINER — authenticated/anon 직접 호출 차단(방어심층, FastAPI 경유만).
--   * `decrypt_sensitive` 는 복호 시 audit_logs 에 `read` 이벤트를 원자적으로 자가-기록 → "복호 = 감사"를 DB가 강제
--     (우회 불가, AC3). 값(before/after)은 절대 저장하지 않는다(PII 경계).
--   * pgcrypto/gen_random_uuid 는 0001 이 이미 활성(재선언 금지 — 마이그레이션 불변). pgcrypto 함수는 `extensions`
--     스키마라 search_path=public 함수에서 스키마 한정 호출.
--   * supabase_vault 확장은 Supabase 스택에 기본 설치(vault 스키마) — `create extension` 불요.
--
-- 의존: 0001(pgcrypto@extensions), 0004(audit_logs + action 'read' CHECK).

-- ── Vault 키(환경별 자동 생성, 평문 키 파일 미포함) ───────────────────────────
-- create_secret(new_secret, new_name, new_description) — 멱등: 동명 시크릿 부재 시에만 생성.
select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'pms_pii_enc_key',
  'pgcrypto symmetric key for PII column encryption (resident_no 등) — Story 1.9'
)
where not exists (select 1 from vault.secrets where name = 'pms_pii_enc_key');

select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'pms_pii_hmac_key',
  'HMAC key for PII blind index (dedup matching, FR-003) — Story 1.9'
)
where not exists (select 1 from vault.secrets where name = 'pms_pii_hmac_key');

-- ── encrypt_sensitive: 평문 → 암호문(bytea). service_role only ────────────────
create or replace function public.encrypt_sensitive(p_plaintext text)
returns bytea
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'pms_pii_enc_key';
  -- 키 부재 시 NULL → pgp_sym_encrypt(p, NULL)=NULL = 암호화 조용한 누락. 명시적 실패로 전환(방어심층).
  if v_key is null then
    raise exception 'PII Vault 암호화 키 누락: %', 'pms_pii_enc_key';
  end if;
  return extensions.pgp_sym_encrypt(p_plaintext, v_key);
end;
$$;

-- ── decrypt_sensitive: 암호문 → 평문 + 자가-감사(복호 = 'read' 이벤트). service_role only ──
-- actor 캡처는 0004 audit_trigger_fn 과 동일 계약: app.actor_id(검증된 UUID) → auth.uid() 폴백.
-- 비-UUID app.actor_id 가 ::uuid 캐스트를 터뜨려 호출 트랜잭션을 abort 시키는 자가-DoS 방지(형식 검증 후 캐스트).
create or replace function public.decrypt_sensitive(
  p_ciphertext bytea,
  p_target_table text,
  p_target_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key       text;
  v_plain     text;
  v_actor     uuid;
  v_actor_txt text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'pms_pii_enc_key';
  if v_key is null then
    raise exception 'PII Vault 암호화 키 누락: %', 'pms_pii_enc_key';
  end if;
  v_plain := extensions.pgp_sym_decrypt(p_ciphertext, v_key);

  v_actor_txt := nullif(current_setting('app.actor_id', true), '');
  v_actor := coalesce(
    case
      when v_actor_txt ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then v_actor_txt::uuid
    end,
    auth.uid()
  );

  -- 복호 자체를 감사(누가·언제·무엇을 reveal). raw 값(before/after)은 절대 저장하지 않는다(PII 경계).
  insert into public.audit_logs (actor_id, action, target_table, target_id)
  values (v_actor, 'read', p_target_table, p_target_id);

  return v_plain;
end;
$$;

-- ── blind_index: 결정적 HMAC 해시(중복 매칭, FR-003 토대). service_role only ──
-- vault(테이블)를 읽으므로 IMMUTABLE 불가 → 함수형 인덱스 금지. 소비처(Epic 3)는 결과를 컬럼(예 resident_no_hash)에
-- 저장 + 컬럼 UNIQUE 인덱스로 중복을 막는다. 호출자는 정규화된 입력(하이픈·공백 제거)을 전달(정규화 = services/rrn).
create or replace function public.blind_index(p_plaintext text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'pms_pii_hmac_key';
  if v_key is null then
    raise exception 'PII Vault HMAC 키 누락: %', 'pms_pii_hmac_key';
  end if;
  return encode(extensions.hmac(p_plaintext, v_key, 'sha256'), 'hex');
end;
$$;

-- ── 권한 posture: 직접 클라 호출 차단(service_role = FastAPI 경유만) ───────────
revoke all on function public.encrypt_sensitive(text)              from public, anon, authenticated;
revoke all on function public.decrypt_sensitive(bytea, text, text) from public, anon, authenticated;
revoke all on function public.blind_index(text)                    from public, anon, authenticated;
grant execute on function public.encrypt_sensitive(text)              to service_role;
grant execute on function public.decrypt_sensitive(bytea, text, text) to service_role;
grant execute on function public.blind_index(text)                    to service_role;
