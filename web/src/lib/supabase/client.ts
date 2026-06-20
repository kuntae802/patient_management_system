import { createBrowserClient } from "@supabase/ssr";

import { env } from "@/lib/env";

// 브라우저(클라이언트 컴포넌트) Supabase 클라이언트. publishable 키만 사용(공개 안전).
// secret/service_role 키는 절대 클라 번들에 넣지 않는다(서버 전용). env 는 fail-fast 검증됨(lib/env).
export function createClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
