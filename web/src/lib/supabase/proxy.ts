import { createServerClient } from "@supabase/ssr";
import { type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { LOGIN_PATH } from "@/lib/auth/branch";

// @supabase/ssr 세션 갱신 + 인증 가드. Next 16에서 middleware→proxy(노드 런타임 기본).
// 역할별(RBAC) 라우트 가드는 Story 1.6 — 여기선 "로그인 여부"만 본다(§결정 D-2).

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // setAll이 채우는 갱신 쿠키를 옵션째 추적 → 리다이렉트 응답에도 동일 옵션으로 보존.
  let refreshed: { name: string; value: string; options: CookieOptions }[] = [];
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          refreshed = cookiesToSet;
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Auth 일시 장애로 getUser()가 throw해도 전면 장애(모든 경로 500)가 되지 않도록 가드.
  let user = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch {
    user = null; // fail-safe: 미인증으로 간주 → 로그인 경로는 통과, 그 외는 /login
  }

  const path = request.nextUrl.pathname;
  const isLoginRoute = path === LOGIN_PATH || path.startsWith(`${LOGIN_PATH}/`);

  const redirectTo = (pathname: string): NextResponse => {
    const url = request.nextUrl.clone();
    url.pathname = pathname; // basePath는 nextUrl이 보유 → 자동 반영
    const res = NextResponse.redirect(url);
    // 갱신 세션 쿠키를 옵션(HttpOnly/Secure/SameSite/Max-Age)째 보존.
    refreshed.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
    return res;
  };

  if (!user && !isLoginRoute) {
    return redirectTo(LOGIN_PATH);
  }
  if (user && isLoginRoute) {
    return redirectTo("/");
  }
  return response;
}
