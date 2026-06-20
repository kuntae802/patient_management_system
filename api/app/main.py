"""patient_management_system API — FastAPI 진입점.

쓰기/명령 오케스트레이션 레이어. 불변식(상태머신·수가·감사·RLS)은 DB가 소유하고,
여기서는 JWKS 검증 + RBAC + 다단계 명령 조립만 담당한다 (아키텍처 §API & Communication).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.db import close_pool, create_pool
from app.core.errors import init_error_handlers


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """부팅 시 설정 검증(fail-fast) + asyncpg 풀 생성, 종료 시 풀 정리."""
    settings.validate_runtime()
    await create_pool()
    try:
        yield
    finally:
        await close_pool()


app = FastAPI(
    title="patient_management_system API",
    version="0.1.0",
    # 리버스 프록시(108 nginx) 뒤 서브패스. OpenAPI 문서 URL 정합용.
    root_path=settings.api_root_path,
    lifespan=lifespan,
)

# 모든 예외 → 단일 봉투 {error:{code,message,detail}} (AC3·AC6).
init_error_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    """헬스 체크 — 외부 경로 /patient_management_system/api/health (무인증)."""
    return {"status": "ok"}


# root_path에 이미 /api 포함 → 라우터 prefix는 /v1
# (외부 경로: /patient_management_system/api/v1/*)
app.include_router(api_router, prefix="/v1")
