import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { LOGIN_PATH } from "@/lib/auth/branch";

// @supabase/ssr 세션 갱신 + 인증 가드. Next 16에서 middleware→proxy(노드 런타임 기본).
// 역할별(RBAC) 라우트 가드는 Story 1.6 — 여기선 "로그인 여부"만 본다(§결정 D-2).

function redirectPreservingCookies(
  pathname: string,
  request: NextRequest,
  from: NextResponse,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname; // basePath는 nextUrl이 보유 → 자동 반영
  const res = NextResponse.redirect(url);
  // getUser()가 갱신한 세션 쿠키를 리다이렉트 응답에 보존
  from.cookies.getAll().forEach((cookie) => res.cookies.set(cookie));
  return res;
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
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
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser()는 Auth 서버에 토큰을 검증/갱신 — getSession보다 안전.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isLoginRoute = path === LOGIN_PATH || path.startsWith(`${LOGIN_PATH}/`);

  // 미인증 + 보호 경로 → /login
  if (!user && !isLoginRoute) {
    return redirectPreservingCookies(LOGIN_PATH, request, response);
  }
  // 인증됨 + /login → 루트("/")로(루트 페이지가 staff/patient 분기)
  if (user && isLoginRoute) {
    return redirectPreservingCookies("/", request, response);
  }

  return response;
}
