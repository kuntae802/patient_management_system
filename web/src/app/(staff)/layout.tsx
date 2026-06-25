import { PermissionsProvider } from "@/components/auth/permissions-provider";
import { AppShell } from "@/components/shell/app-shell";
import { requireStaff } from "@/lib/auth/guards";
import { fetchUserDepartment, fetchUserPermissions } from "@/lib/auth/permissions";

// 직원 영역 레이아웃 — 역할 가드(requireStaff: 비직원 → /portal) 후 권한 목록을 fetch 해
// 전역 셸(AppShell)에 Context 로 제공한다. 인증 여부 1차 가드는 proxy(미인증 → /login).
// RBAC UI 노출 게이트(사이드바 필터·권한 밖 액션)는 이 Context 를 소비(Story 1.6).
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { supabase, userId, role } = await requireStaff();
  const permissions = await fetchUserPermissions(supabase, userId);
  const department = await fetchUserDepartment(supabase, userId);

  return (
    <PermissionsProvider role={role} permissions={permissions} department={department}>
      <AppShell>{children}</AppShell>
    </PermissionsProvider>
  );
}
