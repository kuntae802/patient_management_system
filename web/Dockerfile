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
ENV NEXT_PUBLIC_BASE_PATH=/patient_management_system
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
