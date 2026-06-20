"""API v1 루트 라우터.

도메인 라우터(patients · encounters · orders · nursing · billing · scheduling ·
masters · admin · dashboard)는 후속 스토리가 등록한다.
"""

from fastapi import APIRouter

from app.api.v1 import admin, auth

api_router = APIRouter()

# 인증·권한 증명(Story 1.5). 외부 경로: /patient_management_system/api/v1/auth/*
api_router.include_router(auth.router)

# 관리자 RBAC 명령(Story 1.7). 외부 경로: /patient_management_system/api/v1/admin/rbac/*
api_router.include_router(admin.router)

# 후속 스토리에서 include 예:
#   from app.api.v1 import patients, encounters
#   api_router.include_router(patients.router)
#   api_router.include_router(encounters.router)
