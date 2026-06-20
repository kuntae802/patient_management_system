import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi, type Mock } from "vitest";

import { StaffDirectory } from "@/components/admin/staff-directory";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { StaffMember } from "@/lib/admin/staff";

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

afterEach(() => vi.clearAllMocks());

function member(over: Partial<StaffMember>): StaffMember {
  return {
    id: crypto.randomUUID(),
    employee_no: "EMP9001",
    name: "간호사1",
    role_code: "nurse",
    employment_status: "active",
    license_no: null,
    license_type: null,
    phone: null,
    hire_date: null,
    department_id: null,
    created_at: "2026-06-20T00:00:00Z",
    updated_at: "2026-06-20T00:00:00Z",
    ...over,
  };
}

const ACTIVE = member({ employee_no: "EMP9001", name: "간호사1", employment_status: "active" });
const ONLEAVE = member({ employee_no: "EMP9002", name: "원무1", role_code: "reception", employment_status: "on_leave" });

describe("StaffDirectory", () => {
  it("마운트 시 FastAPI 목록 조회 → 직원·재직상태 배지 렌더", async () => {
    (apiFetch as Mock).mockResolvedValueOnce([ACTIVE, ONLEAVE]);
    render(<StaffDirectory />);

    expect(apiFetch).toHaveBeenCalledWith("/v1/admin/users");
    expect(await screen.findByText("간호사1")).toBeInTheDocument();
    expect(screen.getByText("원무1")).toBeInTheDocument();
    // 재직상태는 행별 select 의 현재값으로 검증(배지 텍스트는 select 옵션과 중복되므로).
    expect((screen.getByLabelText("간호사1 재직상태 변경") as HTMLSelectElement).value).toBe("active");
    expect((screen.getByLabelText("원무1 재직상태 변경") as HTMLSelectElement).value).toBe("on_leave");
  });

  it("복귀(active)는 확인 없이 즉시 PATCH", async () => {
    (apiFetch as Mock)
      .mockResolvedValueOnce([ONLEAVE])
      .mockResolvedValueOnce({ ...ONLEAVE, employment_status: "active" });
    render(<StaffDirectory />);
    await screen.findByText("원무1");

    await userEvent.selectOptions(screen.getByLabelText("원무1 재직상태 변경"), "active");

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    const [path, init] = (apiFetch as Mock).mock.calls[1];
    expect(path).toContain("/employment-status");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ employment_status: "active" });
  });

  it("휴직/퇴사는 확인 다이얼로그 경유 후에만 PATCH", async () => {
    (apiFetch as Mock)
      .mockResolvedValueOnce([ACTIVE])
      .mockResolvedValueOnce({ ...ACTIVE, employment_status: "on_leave" });
    render(<StaffDirectory />);
    await screen.findByText("간호사1");

    await userEvent.selectOptions(screen.getByLabelText("간호사1 재직상태 변경"), "on_leave");

    // 다이얼로그 전엔 PATCH 없음(목록 조회 1회만)
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("휴직 처리 확인")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "휴직" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse((apiFetch as Mock).mock.calls[1][1].body)).toEqual({
      employment_status: "on_leave",
    });
  });

  it("상태변경 실패(예: 자가-락아웃 409) → 오류 토스트", async () => {
    (apiFetch as Mock)
      .mockResolvedValueOnce([ONLEAVE])
      .mockRejectedValueOnce(new ApiError("self_lockout", "본인 계정은 변경할 수 없습니다.", 409));
    render(<StaffDirectory />);
    await screen.findByText("원무1");

    await userEvent.selectOptions(screen.getByLabelText("원무1 재직상태 변경"), "active");
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("본인 계정은 변경할 수 없습니다."));
  });

  it("목록 조회 실패 → 오류 + 다시 시도", async () => {
    (apiFetch as Mock).mockRejectedValueOnce(
      new ApiError("service_unavailable", "직원 목록을 불러오지 못했습니다.", 503),
    );
    render(<StaffDirectory />);

    expect(await screen.findByText("직원 목록을 불러오지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});
