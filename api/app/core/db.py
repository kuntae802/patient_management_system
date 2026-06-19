"""DB 접근 — asyncpg pool + SQLAlchemy Core + RPC 호출 (무ORM). 후속 스토리에서 구현.

불변식(상태머신·수가·제약)은 DB(트리거·RPC)가 소유. 서비스 계층은 명시적 쿼리·RPC 호출만.
ORM 모델 클래스 금지, Alembic 미사용(스키마 단일 소유 = Supabase 마이그레이션).
"""

# TODO: asyncpg pool lifecycle (startup/shutdown) + RPC 호출 헬퍼
