import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi, type Mock } from "vitest";

import { MastersManager } from "@/components/admin/masters-manager";
import { apiFetch } from "@/lib/api/client";
import type { Department, Room } from "@/lib/admin/masters";

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

// base-ui Dialog/AlertDialog 가 jsdom 에서 요구하는 브라우저 API 스텁.
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

const TS = "2026-06-20T00:00:00Z";
const DEPT_ACTIVE: Department = {
  id: "d1",
  code: "ORTHO",
  name: "정형외과",
  description: "근골격",
  is_active: true,
  created_at: TS,
  updated_at: TS,
};
const DEPT_INACTIVE: Department = {
  id: "d2",
  code: "OLD",
  name: "폐과",
  description: null,
  is_active: false,
  created_at: TS,
  updated_at: TS,
};
const ROOM: Room = {
  id: "r1",
  code: "R101",
  name: "1진료실",
  department_id: "d1",
  is_active: true,
  created_at: TS,
  updated_at: TS,
};

function renderManager() {
  return render(
    <MastersManager initial={{ departments: [DEPT_ACTIVE, DEPT_INACTIVE], rooms: [ROOM] }} />,
  );
}

describe("MastersManager", () => {
  it("진료과 목록 + 활성/비활성 배지 렌더", () => {
    renderManager();
    expect(screen.getByText("정형외과")).toBeInTheDocument();
    expect(screen.getByText("폐과")).toBeInTheDocument();
    // 배지 텍스트는 행 버튼("활성"/"비활성")과 겹치므로 행 단위로 스코프해 단언.
    const orthoRow = screen.getByText("정형외과").closest("tr") as HTMLElement;
    const oldRow = screen.getByText("폐과").closest("tr") as HTMLElement;
    expect(within(orthoRow).getByText("활성")).toBeInTheDocument(); // 정형외과 = 활성 배지
    expect(within(oldRow).getByText("비활성")).toBeInTheDocument(); // 폐과 = 비활성 배지
  });

  it("진료실 탭 전환 → 소속 진료과 명칭 표시", async () => {
    renderManager();
    await userEvent.click(screen.getByRole("tab", { name: /진료실/ }));
    expect(screen.getByText("1진료실")).toBeInTheDocument();
    expect(screen.getByText("정형외과")).toBeInTheDocument(); // 소속 진료과 라벨
  });

  it("진료과 생성 → POST 호출 + 목록 반영", async () => {
    const created: Department = {
      id: "d3",
      code: "ENT",
      name: "이비인후과",
      description: null,
      is_active: true,
      created_at: TS,
      updated_at: TS,
    };
    (apiFetch as Mock).mockResolvedValue(created);
    renderManager();

    await userEvent.click(screen.getByRole("button", { name: "진료과 추가" }));
    await userEvent.type(screen.getByLabelText(/코드/), "ENT");
    await userEvent.type(screen.getByLabelText(/이름/), "이비인후과");
    await userEvent.click(screen.getByRole("button", { name: "생성" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [path, init] = (apiFetch as Mock).mock.calls[0];
    expect(path).toBe("/v1/masters/departments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ code: "ENT", name: "이비인후과" });
    expect(await screen.findByText("이비인후과")).toBeInTheDocument();
  });

  it("비활성 전환 → 확인 다이얼로그 경유 PATCH(is_active=false)", async () => {
    (apiFetch as Mock).mockResolvedValue({ ...DEPT_ACTIVE, is_active: false });
    renderManager();

    // 활성 진료과(정형외과)의 '비활성' 버튼(테이블 행) — 초기엔 유일.
    await userEvent.click(screen.getByRole("button", { name: "비활성" }));
    // 확인 다이얼로그 등장
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/비활성 처리 확인/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "비활성" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [path, init] = (apiFetch as Mock).mock.calls[0];
    expect(path).toBe("/v1/masters/departments/d1/active");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ is_active: false });
  });

  it("비활성 항목 활성 복귀 → 확인 없이 즉시 PATCH(is_active=true)", async () => {
    (apiFetch as Mock).mockResolvedValue({ ...DEPT_INACTIVE, is_active: true });
    renderManager();

    // 비활성 진료과(폐과)의 '활성' 버튼 — 유일.
    await userEvent.click(screen.getByRole("button", { name: "활성" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [path, init] = (apiFetch as Mock).mock.calls[0];
    expect(path).toBe("/v1/masters/departments/d2/active");
    expect(JSON.parse(init.body)).toEqual({ is_active: true });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); // 확인 없음
  });
});
