import { AppShell } from "@/components/shell/app-shell";

// 직원 영역 레이아웃 — 전역 셸(AppShell, Story 1.2)을 여기서 렌더한다.
// 인증 여부는 proxy가 가드(미인증→/login). 역할별 내비 노출 게이트(usePermissions)는 Story 1.6.
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
