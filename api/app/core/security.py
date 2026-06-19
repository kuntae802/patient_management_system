"""인증·인가 의존성 — Story 1.5에서 구현.

Supabase JWT를 JWKS로 검증(aud=authenticated) + has_permission(code) 기반 RBAC.
RLS(DB 행 권위)와 함께 3계층 권한 중 '쓰기 권위(FastAPI)' 레이어를 맡는다.
UI 게이트는 보안 경계가 아니라 학습·속도 레이어.
"""

# TODO(Story 1.5): JWKS 검증 의존성 + has_permission(code) 권한 의존성
