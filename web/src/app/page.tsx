import { redirect } from "next/navigation";

import { LOGIN_PATH, landingPathForRole } from "@/lib/auth/branch";
import { createClient } from "@/lib/supabase/server";

// 루트(/) — 세션 분기 진입점. 미인증→/login, 인증→직원/환자 영역(§결정 D-1).
// (Story 1.2의 디자인 프리뷰 데모는 여기서 제거 — 셸은 (staff) 영역에서 실제 동작으로 검증.)
export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(LOGIN_PATH);
  }

  const { data: role } = await supabase.rpc("auth_user_role");
  redirect(landingPathForRole(role as string | null));
}
