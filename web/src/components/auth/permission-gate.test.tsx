import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PermissionGate } from "./permission-gate";
import { PermissionsProvider } from "./permissions-provider";

function wrap(perms: string[]) {
  return render(
    <PermissionsProvider role="admin" permissions={perms}>
      <PermissionGate
        permission="rbac.manage"
        lockedLabel="권한 관리"
        reason="이 작업은 '권한 매트릭스 관리' 권한이 필요합니다"
      >
        <button type="button">권한 관리</button>
      </PermissionGate>
    </PermissionsProvider>,
  );
}

describe("PermissionGate", () => {
  it("권한 보유 → children(실제 버튼) 렌더, 잠금 아님", () => {
    wrap(["rbac.manage"]);
    const btn = screen.getByRole("button", { name: "권한 관리" });
    expect(btn).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(/필요합니다/)).not.toBeInTheDocument();
  });

  it("권한 미보유 → 잠금 표현(aria-disabled + aria-describedby + 한국어 사유)", () => {
    wrap([]);
    const btn = screen.getByRole("button", { name: /권한 관리/ });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    const reasonId = btn.getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    const reason = screen.getByText(/권한 매트릭스 관리.*필요합니다/);
    expect(reason).toBeInTheDocument();
    expect(reason).toHaveAttribute("id", reasonId as string);
  });
});
