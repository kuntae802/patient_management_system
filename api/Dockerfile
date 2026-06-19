# patient_management_system api — FastAPI (uv) 멀티스테이지
# 110 서버 컨테이너: 컨테이너 :8000 ← 108 nginx가 192.168.219.110:8060 으로 proxy
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim
WORKDIR /app

# 의존성 레이어 (소스보다 먼저 → 캐시 최적화)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# 앱 소스
COPY app ./app

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
# root_path/CORS/시크릿은 런타임 환경변수로 주입 (docker-compose env)
CMD ["fastapi", "run", "app/main.py", "--host", "0.0.0.0", "--port", "8000"]
