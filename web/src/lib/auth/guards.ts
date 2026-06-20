import { redirect } from "next/navigation";

import { isStaffRole, LOGIN_PATH, PATIENT_HOME, STAFF_HOME } from "@/lib/auth/branch";
import { fetchUserPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

// 서버 컴포넌트/레이아웃 전용 라우트 가드. UI 게이트와 독립 — 최종 권위는 FastAPI(403)·RLS(방어심층).
// (server-only 패키지 미설치 → 주석으로 경계 명시; 클라 컴포넌트에서 import 금지.)

/**
 * active 직원만 통과시키는 영역 가드. 비직원·RPC 실패·미인증 → PATIENT_HOME 으로 강등.
 * 통과 시 후속 작업용 컨텍스트(supabase·userId·role)를 반환해 중복 조회를 피한다.
 */
export async function requireStaff(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  role: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: role, error } = await supabase.rpc("auth_user_role");
  if (error || !user || !isStaffRole(role as string | null)) {
    redirect(PATIENT_HOME); // RPC 실패 시 분기를 추정하지 않고 안전 강등(로그인 폼 D-1 과 일관).
  }
  return { supabase, userId: user.id, role: role as string };
}

/**
 * 특정 권한이 없으면 fallback 으로 강등하는 권한 가드.
 * 1.7+ 권한별 보호 라우트(예: `(staff)/admin/*` 레이아웃)가 소비할 패턴.
 */
export async function requirePermission(
  code: string,
  fallback: string = STAFF_HOME,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(LOGIN_PATH); // AC1: 미인증 → /login (proxy 가 선행 처리하나 단독 호출 시에도 일관).
  }
  const permissions = await fetchUserPermissions(supabase, user.id);
  if (!permissions.includes(code)) {
    redirect(fallback);
  }
}
