"""API v1 루트 라우터.

도메인 라우터(patients · encounters · orders · nursing · billing · scheduling ·
masters · admin · dashboard)는 후속 스토리가 등록한다.
"""

from fastapi import APIRouter

api_router = APIRouter()

# 후속 스토리에서 include 예:
#   from app.api.v1 import patients, encounters
#   api_router.include_router(patients.router)
#   api_router.include_router(encounters.router)
