import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { isStaffRole } from "@/lib/auth/branch";
import { createClient } from "@/lib/supabase/server";

// 직원 영역 레이아웃 — 전역 셸(AppShell, Story 1.2)을 렌더한다. 인증 여부는 proxy가 가드.
// 스톱갭(§리뷰): 비-직원이 (staff) 직접 내비 시 환자 영역으로. 전면 RBAC·역할별 노출 게이트는 Story 1.6.
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: role } = await supabase.rpc("auth_user_role");
  if (!isStaffRole(role as string | null)) {
    redirect("/portal");
  }
  return <AppShell>{children}</AppShell>;
}
