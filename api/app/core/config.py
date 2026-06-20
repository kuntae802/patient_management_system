"""환경 설정 — 12-factor. 시크릿(secret/service_role 키)은 환경변수/Vault, 코드·DB 미보관.

pydantic-settings 로 `.env`(미커밋) + 프로세스 환경변수를 로딩한다. 필수 인증/DB 설정은
구체 기본값(로컬 supabase)을 두어 dev/test 가 무설정에서도 동작하되, 빈 값은 부팅에서
fail-fast(`validate_runtime`) 한다 — 불투명한 런타임 실패(JWKS/DB 시점 폭발) 방지.

🚫 SUPABASE_SECRET_KEY / SUPABASE_DB_URL 은 서버 전용 — 응답·로그·클라 노출 금지.
   토큰 검증은 공개 JWKS(ES256)로 한다. SECRET_KEY 는 토큰 검증 키가 아니다(§Story1.5 D-5).
"""

from __future__ import annotations

import logging

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("app.config")

# Supabase 표준 audience 클레임(아키텍처 확정값). 토큰 aud 검증의 기대값.
_DEFAULT_JWT_AUD = "authenticated"
_JWKS_SUFFIX = "/.well-known/jwks.json"


class Settings(BaseSettings):
    """프로세스 설정. 환경변수(대문자 동명) 또는 `.env` 로 override."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # 서브패스 전파 (4개 서피스 일관). 외부 경로 /patient_management_system/api/*.
    api_root_path: str = "/patient_management_system/api"
    # CSV 문자열로 받는다(list-from-env JSON 파싱 회피). 노출은 cors_origins_list 프로퍼티.
    cors_origins: str = "http://localhost:3000,https://kuntae802.mooo.com"

    # 로컬 기본 = `supabase start` 출력값. 배포는 compose env 로 override.
    supabase_db_url: str = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    supabase_jwks_url: str = "http://127.0.0.1:54321/auth/v1/.well-known/jwks.json"
    # 서버 전용 시크릿(supabase-py admin·Storage용). 토큰 검증 키 아님. 미설정 가능(경고).
    supabase_secret_key: str | None = None

    # JWKS 검증 기대값. iss 는 미설정 시 jwks_url 베이스에서 도출.
    supabase_jwt_aud: str = _DEFAULT_JWT_AUD
    supabase_jwt_iss: str | None = None

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def jwt_issuer(self) -> str | None:
        """토큰 iss 검증 기대값. 명시값 우선, 없으면 JWKS URL 베이스(`…/auth/v1`)에서 도출."""
        if self.supabase_jwt_iss:
            return self.supabase_jwt_iss
        if self.supabase_jwks_url.endswith(_JWKS_SUFFIX):
            return self.supabase_jwks_url[: -len(_JWKS_SUFFIX)]
        return None

    def validate_runtime(self) -> None:
        """부팅 시 fail-fast. 필수 설정이 빈 값이면 즉시 실패(런타임 불투명 실패 방지)."""
        missing = [
            name
            for name in ("supabase_jwks_url", "supabase_db_url")
            if not (getattr(self, name) or "").strip()
        ]
        if missing:
            raise RuntimeError(
                "필수 환경설정 누락: "
                + ", ".join(m.upper() for m in missing)
                + " — .env 또는 환경변수를 설정하세요."
            )
        if not self.supabase_secret_key:
            # 토큰 검증엔 불필요하나, supabase-py admin 호출(후속)에 필요 — 경고만.
            logger.warning(
                "SUPABASE_SECRET_KEY 미설정 — admin/Storage 기능은 후속 스토리에서 필요."
            )
        if self.jwt_issuer is None:
            # JWKS URL 에서 issuer 도출 실패 → iss 검증 무음 비활성(다른 발급자 토큰 위험).
            logger.warning(
                "토큰 iss 미검증 — JWKS URL 에서 issuer 도출 실패. SUPABASE_JWT_ISS 설정 권장."
            )
        if "*" in self.cors_origins_list:
            # 와일드카드 + allow_credentials=True 는 자격증명 노출 위험.
            logger.warning(
                "CORS_ORIGINS 에 '*' 포함 + 자격증명 허용 — 명시 origin 사용 권장(노출 위험)."
            )


settings = Settings()
