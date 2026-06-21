"""API v1 루트 라우터.

도메인 라우터(patients · encounters · orders · nursing · billing · scheduling ·
masters · admin · dashboard)는 후속 스토리가 등록한다.
"""

from fastapi import APIRouter

from app.api.v1 import admin, auth, encounters, masters, patients

api_router = APIRouter()

# 인증·권한 증명(Story 1.5). 외부 경로: /patient_management_system/api/v1/auth/*
api_router.include_router(auth.router)

# 관리자 RBAC 명령(Story 1.7). 외부 경로: /patient_management_system/api/v1/admin/rbac/*
api_router.include_router(admin.router)

# 마스터(진료과·진료실) 명령(Story 2.1). 외부 경로: /patient_management_system/api/v1/masters/*
api_router.include_router(masters.router)

# 환자 등록·조회(Story 3.1). 외부 경로: /patient_management_system/api/v1/patients/*
api_router.include_router(patients.router)

# 내원 접수·조회(Story 4.2). 외부 경로: /patient_management_system/api/v1/encounters/*
api_router.include_router(encounters.router)
