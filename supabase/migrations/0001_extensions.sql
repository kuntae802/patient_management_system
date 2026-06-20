-- 0001_extensions.sql — PostgreSQL 확장 활성화
-- Story 1.3 (신원·RBAC·RLS·감사 DB 토대). 마이그레이션 단일 소유(architecture §스키마 단일 소유).
--
-- 경계 노트:
--   * gen_random_uuid() 는 PG13+ core(pg_catalog)라 확장 없이도 사용 가능(본 프로젝트 PG17).
--   * hmac()/digest()/pgp_sym_encrypt()/pgp_sym_decrypt() 는 Story 1.9(주민번호 암복호·HMAC
--     blind index)가 사용하므로 pgcrypto 를 여기서 미리 활성화한다.
--   * Vault 활성화 + service_role 한정 SECURITY DEFINER 암복호 RPC 는 Story 1.9 가 별도
--     마이그레이션으로 추가한다. 이 파일은 적용 후 편집하지 말 것(마이그레이션 불변성).
--
-- Supabase 관습: 확장은 `extensions` 스키마에 설치(config.toml extra_search_path=["public","extensions"]).

create extension if not exists pgcrypto with schema extensions;
