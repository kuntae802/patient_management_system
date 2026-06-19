import type { NextConfig } from "next";

// 리버스 프록시(108 nginx) 서브패스 — 빌드 타임 결정. 모든 라우팅·자산·redirect에 전파.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/patient_management_system";

const nextConfig: NextConfig = {
  basePath,
  // Docker 배포(110): standalone 출력 (server.js)
  output: "standalone",
};

export default nextConfig;
