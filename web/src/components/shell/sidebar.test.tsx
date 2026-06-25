import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PermissionsProvider } from "@/components/auth/permissions-provider";

import { Sidebar } from "./sidebar";

// next/navigation·next/link 를 jsdom 친화적으로 모킹.
vi.mock("next/navigation", () => ({ usePathname: () => "/reception/waiting" }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function renderSidebar(role: string, perms: string[]) {
  return render(
    <PermissionsProvider role={role} permissions={perms}>
      <Sidebar collapsed={false} />
    </PermissionsProvider>,
  );
}

const ADMIN_PERMS = ["rbac.manage", "audit.read", "dashboard.read", "master.manage", "user.manage"];

describe("Sidebar RBAC 노출 게이트", () => {
  it("admin + 전체 권한 → 관리 항목 렌더", () => {
    renderSidebar("admin", ADMIN_PERMS);
    expect(screen.getByRole("link", { name: "권한" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "감사 로그" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "근무 스케줄" })).toBeInTheDocument(); // master.manage 보유(6.1)
  });

  it("reception(권한 0) → 직무 항목(수납·환자 등록 포함) 모두 렌더, 관리 항목은 역할 불일치로 미렌더", () => {
    renderSidebar("reception", []);
    expect(screen.getByRole("link", { name: "수납" })).toBeInTheDocument(); // 직무 → 권한 게이트 없음
    expect(screen.getByRole("link", { name: "환자 등록" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "대기 현황" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "접수" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "권한" })).not.toBeInTheDocument(); // admin 전용
  });

  it("admin 권한 0 → 권한 게이트 걸린 관리 항목 미렌더, 무권한 푸터 항목은 렌더", () => {
    renderSidebar("admin", []);
    expect(screen.queryByRole("link", { name: "권한" })).not.toBeInTheDocument(); // rbac.manage 필요
    expect(screen.queryByRole("link", { name: "감사 로그" })).not.toBeInTheDocument(); // audit.read 필요
    expect(screen.queryByRole("link", { name: "근무 스케줄" })).not.toBeInTheDocument(); // master.manage 필요(6.1)
    expect(screen.getByRole("link", { name: "도움말" })).toBeInTheDocument(); // 무권한 푸터 항목은 렌더
  });

  it("활성 경로 항목 → aria-current=page + 좌측 액센트 바", () => {
    renderSidebar("reception", []);
    const active = screen.getByRole("link", { name: "대기 현황" });
    expect(active).toHaveAttribute("aria-current", "page");
  });

  it("푸터 공통 항목(도움말)은 전 역할에 노출", () => {
    renderSidebar("nurse", []);
    // 설정은 미구현(Story 9.1 = 도움말만 신설) — 도움말은 requiredPermission 없이 전 직원 노출.
    expect(screen.getByRole("link", { name: "도움말" })).toBeInTheDocument();
  });

  it("역할 한글 표시명 노출", () => {
    renderSidebar("admin", ADMIN_PERMS);
    expect(screen.getByText("관리자")).toBeInTheDocument();
  });
});
