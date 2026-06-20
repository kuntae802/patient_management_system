import { beforeEach, describe, expect, it, vi } from "vitest";

// redirect 는 실제 Next 처럼 throw 로 모킹(호출 즉시 흐름 중단).
const redirectMock = vi.fn((path: string): never => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({ redirect: (p: string) => redirectMock(p) }));

const supabaseMock = {
  auth: { getUser: vi.fn() },
  rpc: vi.fn(),
};
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => supabaseMock) }));

const fetchUserPermissionsMock = vi.fn();
vi.mock("@/lib/auth/permissions", () => ({
  fetchUserPermissions: (...args: unknown[]) => fetchUserPermissionsMock(...args),
}));

import { LOGIN_PATH, PATIENT_HOME, STAFF_HOME } from "./branch";
import { requirePermission, requireStaff } from "./guards";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireStaff", () => {
  it("active 직원 → 통과(userId·role 반환, redirect 없음)", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    supabaseMock.rpc.mockResolvedValue({ data: "admin", error: null });
    const ctx = await requireStaff();
    expect(ctx.userId).toBe("u1");
    expect(ctx.role).toBe("admin");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("비직원(role null) → PATIENT_HOME 강등", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    supabaseMock.rpc.mockResolvedValue({ data: null, error: null });
    await expect(requireStaff()).rejects.toThrow(`REDIRECT:${PATIENT_HOME}`);
  });

  it("RPC 에러 → 강등(추정 금지)", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    await expect(requireStaff()).rejects.toThrow(/REDIRECT/);
  });

  it("미인증(user 없음) → PATIENT_HOME 강등", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } });
    supabaseMock.rpc.mockResolvedValue({ data: "admin", error: null });
    await expect(requireStaff()).rejects.toThrow(`REDIRECT:${PATIENT_HOME}`);
  });
});

describe("requirePermission", () => {
  it("권한 보유 → 통과", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    fetchUserPermissionsMock.mockResolvedValue(["rbac.manage"]);
    await expect(requirePermission("rbac.manage")).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("권한 미보유 → fallback(STAFF_HOME) 강등", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    fetchUserPermissionsMock.mockResolvedValue([]);
    await expect(requirePermission("rbac.manage")).rejects.toThrow(`REDIRECT:${STAFF_HOME}`);
  });

  it("미인증 → LOGIN_PATH 강등(AC1)", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } });
    await expect(requirePermission("rbac.manage")).rejects.toThrow(`REDIRECT:${LOGIN_PATH}`);
  });
});
