import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi, type Mock } from "vitest";

import { PermissionMatrix } from "@/components/admin/permission-matrix";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { PermissionMatrix as Matrix } from "@/lib/auth/rbac-matrix";

// apiFetch 만 모킹(ApiError 실 클래스 유지 → instanceof 동작).
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

// base-ui AlertDialog 가 jsdom 에서 요구할 수 있는 브라우저 API 스텁.
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

const MATRIX: Matrix = {
  roles: [
    { code: "reception", name: "원무과" },
    { code: "doctor", name: "의사" },
    { code: "nurse", name: "간호사" },
    { code: "radiologist", name: "방사선사" },
    { code: "admin", name: "관리자" },
  ],
  permissions: [
    { code: "patient.read", name: "환자 조회", resource: "patient" },
    { code: "patient.reveal_rrn", name: "주민번호 열람", resource: "patient" },
  ],
  grants: [],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("PermissionMatrix", () => {
  it("5개 역할 열(patient 제외) + 그룹 헤더 + 민감 pill 을 렌더", () => {
    render(<PermissionMatrix initial={MATRIX} />);
    for (const name of ["원무과", "의사", "간호사", "방사선사", "관리자"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(screen.queryByRole("columnheader", { name: /환자$/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("환자").length).toBeGreaterThan(0); // 그룹 헤더
    expect(screen.getAllByText("민감").length).toBeGreaterThan(0); // 민감 pill(범례 + 행)
  });

  it("admin 열 셀은 고정(aria-disabled) — 클릭해도 쓰기 호출 없음", async () => {
    render(<PermissionMatrix initial={MATRIX} />);
    const adminCell = screen.getByRole("button", { name: "관리자 — 환자 조회 — 고정 · 변경 불가" });
    expect(adminCell).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(adminCell);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("비민감 토글 → 즉시 FastAPI PUT(낙관적 허용 반영)", async () => {
    (apiFetch as Mock).mockResolvedValue({ changed: true });
    render(<PermissionMatrix initial={MATRIX} />);
    await userEvent.click(screen.getByRole("button", { name: "원무과 — 환자 조회 — 차단" }));

    expect(apiFetch).toHaveBeenCalledWith(
      "/v1/admin/rbac/grants",
      expect.objectContaining({ method: "PUT" }),
    );
    const body = JSON.parse((apiFetch as Mock).mock.calls[0][1].body);
    expect(body).toEqual({ role_code: "reception", permission_code: "patient.read", granted: true });
    // 낙관적 갱신 → 허용 라벨로 전환
    await screen.findByRole("button", { name: "원무과 — 환자 조회 — 허용" });
  });

  it("민감 권한 토글 → 확인 다이얼로그 경유 후에만 적용", async () => {
    (apiFetch as Mock).mockResolvedValue({ changed: true });
    render(<PermissionMatrix initial={MATRIX} />);
    await userEvent.click(screen.getByRole("button", { name: "원무과 — 주민번호 열람 — 차단" }));

    // 다이얼로그 전엔 호출 없음
    expect(apiFetch).not.toHaveBeenCalled();
    expect(await screen.findByText("권한 부여 확인")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "부여" }));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((apiFetch as Mock).mock.calls[0][1].body);
    expect(body.permission_code).toBe("patient.reveal_rrn");
  });

  it("쓰기 실패 → 낙관적 상태 롤백 + 오류 토스트", async () => {
    (apiFetch as Mock).mockRejectedValue(
      new ApiError("role_locked", "변경할 수 없습니다.", 409),
    );
    render(<PermissionMatrix initial={MATRIX} />);
    await userEvent.click(screen.getByRole("button", { name: "원무과 — 환자 조회 — 차단" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("변경할 수 없습니다."));
    // 롤백되어 다시 '차단'
    expect(
      screen.getByRole("button", { name: "원무과 — 환자 조회 — 차단" }),
    ).toBeInTheDocument();
  });
});
