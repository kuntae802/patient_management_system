import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PermissionsProvider } from "@/components/auth/permissions-provider";

import { usePermissions } from "./use-permissions";

function Probe() {
  const { role, has } = usePermissions();
  return (
    <div>
      role:{role ?? "none"} rbac:{String(has("rbac.manage"))}
    </div>
  );
}

describe("usePermissions", () => {
  it("Provider 내 권한 보유 → role 노출 + has true", () => {
    render(
      <PermissionsProvider role="admin" permissions={["rbac.manage", "audit.read"]}>
        <Probe />
      </PermissionsProvider>,
    );
    expect(screen.getByText(/role:admin/)).toBeInTheDocument();
    expect(screen.getByText(/rbac:true/)).toBeInTheDocument();
  });

  it("권한 미보유 → has false", () => {
    render(
      <PermissionsProvider role="reception" permissions={[]}>
        <Probe />
      </PermissionsProvider>,
    );
    expect(screen.getByText(/rbac:false/)).toBeInTheDocument();
  });

  it("Provider 밖 호출 → throw", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/PermissionsProvider/);
    spy.mockRestore();
  });
});
