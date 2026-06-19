"""환경 설정 — 12-factor. 시크릿(secret/service_role 키)은 환경변수/Vault, 코드·DB 미보관.

NOTE: 후속 스토리에서 pydantic-settings + .env 로딩으로 승격 예정.
지금은 os.getenv 기반 최소 스텁(기본값으로 health 등 무인증 경로 동작).
"""

import os


def _split_csv(raw: str) -> list[str]:
    return [item.strip() for item in raw.split(",") if item.strip()]


class _Settings:
    # 서브패스 전파 (4개 서피스 일관). project-context: root_path=/patient_management_system/api
    api_root_path: str = os.getenv("API_ROOT_PATH", "/patient_management_system/api")
    cors_origins: list[str] = _split_csv(
        os.getenv("CORS_ORIGINS", "https://kuntae802.mooo.com")
    )
    # 로컬: supabase start 출력값. 서버 전용 시크릿은 클라 노출 금지.
    supabase_db_url: str | None = os.getenv("SUPABASE_DB_URL")
    supabase_jwks_url: str | None = os.getenv("SUPABASE_JWKS_URL")
    supabase_secret_key: str | None = os.getenv("SUPABASE_SECRET_KEY")


settings = _Settings()
