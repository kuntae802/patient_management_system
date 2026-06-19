# patient_management_system web — Next.js 16 standalone 멀티스테이지
# 110 컨테이너 :3000 ← 108 nginx가 192.168.219.110:3002 으로 proxy (basePath=/patient_management_system)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* 는 빌드타임에 클라 번들로 인라인됨 → 반드시 build ARG로 주입
# (런타임 env로 넘기면 브라우저 번들엔 안 박힘. compose의 build.args가 .env에서 전달)
ARG NEXT_PUBLIC_BASE_PATH=/patient_management_system
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=Asia/Seoul
# Next standalone 출력 (server.js + 정적 자산)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
