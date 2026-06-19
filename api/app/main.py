"""patient_management_system API — FastAPI 진입점.

쓰기/명령 오케스트레이션 레이어. 불변식(상태머신·수가·감사·RLS)은 DB가 소유하고,
여기서는 JWKS 검증 + RBAC + 다단계 명령 조립만 담당한다 (아키텍처 §API & Communication).
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings

app = FastAPI(
    title="patient_management_system API",
    version="0.1.0",
    # 리버스 프록시(108 nginx) 뒤 서브패스. OpenAPI 문서 URL 정합용.
    root_path=settings.api_root_path,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    """헬스 체크 — 외부 경로 /patient_management_system/api/health."""
    return {"status": "ok"}


# root_path에 이미 /api 포함 → 라우터 prefix는 /v1
# (외부 경로: /patient_management_system/api/v1/*)
app.include_router(api_router, prefix="/v1")
