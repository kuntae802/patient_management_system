import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi, type Mock } from "vitest";

import { StaffCreateForm } from "@/components/admin/staff-create-form";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { Department } from "@/lib/admin/masters";

const DEPARTMENTS: Department[] = [
  { id: "dept-im", code: "IM", name: "내과", description: null, is_active: true, created_at: "2026-06-20T00:00:00Z", updated_at: "2026-06-20T00:00:00Z" },
  { id: "dept-old", code: "OLD", name: "폐과", description: null, is_active: false, created_at: "2026-06-20T00:00:00Z", updated_at: "2026-06-20T00:00:00Z" },
];

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

// base-ui Dialog 가 jsdom 에서 요구하는 브라우저 API 스텁.
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

const STAFF = {
  id: "00000000-0000-4000-8000-000000000001",
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
};

async function fillValid() {
  await userEvent.type(screen.getByLabelText(/사번/), "EMP9001");
  await userEvent.type(screen.getByLabelText(/^이름/), "간호사1");
  await userEvent.type(screen.getByLabelText(/이메일/), "nurse1@pms.local");
  await userEvent.type(screen.getByLabelText(/임시 비밀번호/), "Staff1234");
  await userEvent.selectOptions(screen.getByLabelText(/역할/), "nurse");
}

describe("StaffCreateForm", () => {
  it("필수 누락 시 검증 오류 표시 + 제출 호출 없음", async () => {
    render(<StaffCreateForm open onOpenChange={vi.fn()} onCreated={vi.fn()} departments={DEPARTMENTS} />);
    await userEvent.click(screen.getByRole("button", { name: "계정 생성" }));

    expect(await screen.findByText("사번을 입력하세요")).toBeInTheDocument();
    expect(screen.getByText("역할을 선택하세요")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("유효 입력 → POST 호출(빈 옵셔널 제외) + onCreated + 닫힘", async () => {
    (apiFetch as Mock).mockResolvedValue(STAFF);
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    render(<StaffCreateForm open onOpenChange={onOpenChange} onCreated={onCreated} departments={DEPARTMENTS} />);

    await fillValid();
    await userEvent.click(screen.getByRole("button", { name: "계정 생성" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [path, init] = (apiFetch as Mock).mock.calls[0];
    expect(path).toBe("/v1/admin/users");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      employee_no: "EMP9001",
      name: "간호사1",
      email: "nurse1@pms.local",
      password: "Staff1234",
      role_code: "nurse",
    }); // 빈 옵셔널(license_*/phone/hire_date)은 미포함
    expect(onCreated).toHaveBeenCalledWith(STAFF);
    expect(onOpenChange).toHaveBeenCalledWith(false); // 성공 시 닫힘
  });

  it("사번 중복(409) → 사번 필드 인라인 오류", async () => {
    (apiFetch as Mock).mockRejectedValue(
      new ApiError("employee_no_taken", "이미 사용 중인 사번입니다.", 409),
    );
    render(<StaffCreateForm open onOpenChange={vi.fn()} onCreated={vi.fn()} departments={DEPARTMENTS} />);

    await fillValid();
    await userEvent.click(screen.getByRole("button", { name: "계정 생성" }));

    expect(await screen.findByText("이미 사용 중인 사번입니다.")).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled(); // 필드 인라인이라 토스트 아님
  });

  it("진료과 선택 시 payload 에 department_id 포함 · 비활성 진료과 미노출 (AC1)", async () => {
    (apiFetch as Mock).mockResolvedValue({ ...STAFF, department_id: "dept-im" });
    render(<StaffCreateForm open onOpenChange={vi.fn()} onCreated={vi.fn()} departments={DEPARTMENTS} />);

    // 활성 진료과만 옵션(비활성 '폐과'는 신규 배정 대상 아님 — 미노출).
    expect(screen.queryByRole("option", { name: "폐과" })).not.toBeInTheDocument();

    await fillValid();
    await userEvent.selectOptions(screen.getByLabelText(/소속 진료과/), "dept-im");
    await userEvent.click(screen.getByRole("button", { name: "계정 생성" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse((apiFetch as Mock).mock.calls[0][1].body);
    expect(body.department_id).toBe("dept-im");
  });
});
