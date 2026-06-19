# api — FastAPI 오케스트레이션 레이어

쓰기/명령(상태 전이·수납 트랜잭션·진료비 문서·시뮬 이음매)을 담당. 불변식(상태머신·수가·감사·RLS)은 **DB가 소유**하고, FastAPI는 JWKS 검증 + RBAC + 다단계 명령 조립만 한다. **무ORM**(asyncpg + SQLAlchemy Core + RPC), **Alembic 미사용**(스키마 단일 소유 = Supabase 마이그레이션).

## 로컬 개발

```bash
# 1) 로컬 Supabase 스택 (루트에서)
supabase start

# 2) 환경변수 — .env.example 복사 후 supabase start 출력값 채우기
cp .env.example .env   # SUPABASE_SECRET_KEY 등 (커밋 금지)

# 3) 개발 서버 (root_path=/patient_management_system/api)
uv run fastapi dev app/main.py
#   헬스: http://localhost:8000/health  → {"status":"ok"}
```

## 검증

```bash
uv run ruff check .     # 린트
uv run pytest          # 테스트 (tests/)
```

## 구조

```
app/
├── main.py            # FastAPI(root_path), CORS, /health, v1 라우터
├── core/              # config · security(JWKS·권한) · db(asyncpg) · errors(봉투) · logging(PII 마스킹)
├── api/v1/router.py   # 도메인 라우터 등록 지점 (후속 스토리)
├── schemas/           # Pydantic (요청·응답, snake_case)
├── services/          # 도메인 오케스트레이션
├── db/                # 명시적 쿼리·RPC 호출
└── internal/          # 시드·관리 보조
tests/                 # pytest
```
