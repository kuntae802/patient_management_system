import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

// Next 16: 구 `middleware.ts`가 `proxy.ts`로 변경(함수명 middleware→proxy, 노드 런타임 기본).
// 세션 갱신 + 인증 가드를 매 요청 수행. 역할별 RBAC 가드는 Story 1.6.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    {
      // api·정적 자산·이미지·폰트·favicon 제외. (정적 분석 위해 상수)
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|mjs|map|json|txt|xml|woff2?)$).*)",
      // prefetch 요청에는 세션 가드 미적용(실제 내비게이션에서만 평가 — 불필요한 Auth 왕복 방지).
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
