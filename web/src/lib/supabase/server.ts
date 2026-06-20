import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { env } from "@/lib/env";

// 서버(RSC·route handler) Supabase 클라이언트. Next 16의 async `cookies()` 사용.
// 세션 쿠키 갱신의 권위는 proxy(lib/supabase/proxy.ts, Next 16 미들웨어) — RSC의 setAll 실패는 무시.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component에서 호출되면 set 불가 — 미들웨어가 세션 갱신을 담당하므로 무시.
          }
        },
      },
    },
  );
}
