#!/usr/bin/env bash
# 클라우드 Supabase 를 바라보는 dev 서버 기동 (도메인 노출용 · 108 nginx 뒤 web:3002 / api:8060).
# 재부팅/크래시 후 재시작용. 로그: /tmp/pms-api-cloud.log · /tmp/pms-web-cloud.log
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a   # 클라우드 SUPABASE_* + NEXT_PUBLIC_* (루트 .env)

DOMAIN_API="https://kuntae802.mooo.com/patient_management_system/api"

echo "▶ API :8060 (cloud DB)…"
( cd api && nohup uv run fastapi dev app/main.py --host 0.0.0.0 --port 8060 \
    > /tmp/pms-api-cloud.log 2>&1 & )

echo "▶ WEB :3002 (cloud supabase + domain api)…"
( cd web && nohup env \
    NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
    NEXT_PUBLIC_API_BASE_URL="$DOMAIN_API" \
    NEXT_PUBLIC_BASE_PATH="/patient_management_system" \
    npm run dev -- -H 0.0.0.0 -p 3002 > /tmp/pms-web-cloud.log 2>&1 & )

sleep 8
curl -s -o /dev/null -w "api :8060/health → %{http_code}\n" http://127.0.0.1:8060/health
curl -s -o /dev/null -w "web :3002 → %{http_code}\n" -L http://127.0.0.1:3002/patient_management_system/login
echo "✅ 기동 완료 (108 nginx 가 192.168.219.110:3002/8060 로 프록시)"
