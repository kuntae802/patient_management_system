import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi, type Mock } from "vitest";

import { MastersManager } from "@/components/admin/masters-manager";
import { apiFetch } from "@/lib/api/client";
import type {
  Department,
  Diagnosis,
  Drug,
  FeeSchedule,
  MastersData,
  Room,
} from "@/lib/admin/masters";

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

// 시점 상태가 결정적이도록 발효/만료일을 먼 과거/미래로 둔다(codeStatus 는 실제 today 기준).
const DX_VALID: Diagnosis = {
  id: "dx1",
  code: "I10",
  name: "본태성 고혈압",
  effective_from: "2000-01-01",
  effective_to: null,
  is_active: true,
  created_at: TS,
  updated_at: TS,
};
const DX_EXPIRED: Diagnosis = {
  id: "dx2",
  code: "E11",
  name: "구버전 당뇨",
  effective_from: "2000-01-01",
  effective_to: "2000-12-31",
  is_active: true,
  created_at: TS,
  updated_at: TS,
};
const DX_PENDING: Diagnosis = {
  id: "dx3",
  code: "J45",
  name: "예정 천식",
  effective_from: "2999-01-01",
  effective_to: null,
  is_active: true,
  created_at: TS,
  updated_at: TS,
};
const DX_INACTIVE: Diagnosis = {
  id: "dx4",
  code: "Z99",
  name: "폐지 진단",
  effective_from: "2000-01-01",
  effective_to: null,
  is_active: false,
  created_at: TS,
  updated_at: TS,
};
const FEE: FeeSchedule = {
  id: "f1",
  code: "AA157",
  name: "재진 진찰료",
  amount_krw: 12000,
  category: "진찰료",
  effective_from: "2000-01-01",
  effective_to: null,
  is_active: true,
  created_at: TS,
  updated_at: TS,
};
const DRUG: Drug = {
  id: "g1",
  code: "642901230",
  name: "타이레놀정 500mg",
  ingredient_code: "120901ATB",
  unit: "정",
  effective_from: "2000-01-01",
  effective_to: null,
  is_active: true,
  created_at: TS,
  updated_at: TS,
};

function renderManager(overrides: Partial<MastersData> = {}) {
  return render(
    <MastersManager
      initial={{
        departments: [DEPT_ACTIVE, DEPT_INACTIVE],
        rooms: [ROOM],
        diagnoses: [],
        feeSchedules: [],
        drugs: [],
        ...overrides,
      }}
    />,
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

  it("진료과 비활성 전환 → 의존성 카운트 조회 후 확인 다이얼로그 경유 PATCH(is_active=false)", async () => {
    // 진료과 비활성은 의존성(진료실·직원) 카운트를 먼저 GET 한 뒤 확인 → PATCH (apiFetch 2회).
    (apiFetch as Mock).mockImplementation((path: string) =>
      path.endsWith("/dependents")
        ? Promise.resolve({ rooms: 0, staff: 0 })
        : Promise.resolve({ ...DEPT_ACTIVE, is_active: false }),
    );
    renderManager();

    await userEvent.click(screen.getByRole("button", { name: "비활성" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/비활성 처리 확인/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "비활성" }));

    // 의존성 GET + active PATCH (순서 무관하게 PATCH 호출을 찾아 단언).
    await waitFor(() => {
      const patch = (apiFetch as Mock).mock.calls.find(
        ([, init]) => init?.method === "PATCH",
      );
      expect(patch).toBeTruthy();
    });
    const patchCall = (apiFetch as Mock).mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patchCall?.[0]).toBe("/v1/masters/departments/d1/active");
    expect(JSON.parse(patchCall?.[1].body)).toEqual({ is_active: false });
    // 의존성 카운트 GET 도 호출됨
    expect(
      (apiFetch as Mock).mock.calls.some(([p]) => p === "/v1/masters/departments/d1/dependents"),
    ).toBe(true);
  });

  it("진료과 비활성 — 참조 진료실·직원 카운트를 경고에 표시(AC4)", async () => {
    (apiFetch as Mock).mockImplementation((path: string) =>
      path.endsWith("/dependents")
        ? Promise.resolve({ rooms: 3, staff: 5 })
        : Promise.resolve({ ...DEPT_ACTIVE, is_active: false }),
    );
    renderManager();

    await userEvent.click(screen.getByRole("button", { name: "비활성" }));
    const dialog = await screen.findByRole("alertdialog");
    // 경고 문구에 카운트 노출
    expect(within(dialog).getByText(/3개 진료실 · 5명 직원/)).toBeInTheDocument();
  });

  it("진료과 비활성 — 의존성 조회 실패 시 일반 문구로 폴백(fail-soft, 비활성 진행 가능)", async () => {
    (apiFetch as Mock).mockImplementation((path: string) =>
      path.endsWith("/dependents")
        ? Promise.reject(new Error("network"))
        : Promise.resolve({ ...DEPT_ACTIVE, is_active: false }),
    );
    renderManager();

    await userEvent.click(screen.getByRole("button", { name: "비활성" }));
    const dialog = await screen.findByRole("alertdialog");
    // 카운트 문구 없음(일반 폴백) — 그래도 비활성 확인은 가능
    expect(within(dialog).queryByText(/명 직원/)).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "비활성" }));
    await waitFor(() => {
      const patch = (apiFetch as Mock).mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(patch?.[0]).toBe("/v1/masters/departments/d1/active");
    });
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

  it("진단 탭 → 시점 상태 배지(유효/만료/발효 전/비활성) 표시", async () => {
    renderManager({ diagnoses: [DX_VALID, DX_EXPIRED, DX_PENDING, DX_INACTIVE] });
    await userEvent.click(screen.getByRole("tab", { name: /진단/ }));

    const validRow = screen.getByText("본태성 고혈압").closest("tr") as HTMLElement;
    const expiredRow = screen.getByText("구버전 당뇨").closest("tr") as HTMLElement;
    const pendingRow = screen.getByText("예정 천식").closest("tr") as HTMLElement;
    const inactiveRow = screen.getByText("폐지 진단").closest("tr") as HTMLElement;
    expect(within(validRow).getByText("유효")).toBeInTheDocument();
    expect(within(expiredRow).getByText("만료")).toBeInTheDocument();
    expect(within(pendingRow).getByText("발효 전")).toBeInTheDocument();
    // 비활성 행: 배지 "비활성"(행 액션 버튼은 "활성"이라 행 스코프로 단언).
    expect(within(inactiveRow).getByText("비활성")).toBeInTheDocument();
  });

  it("진단 생성 → POST /v1/masters/diagnoses (발효일 포함)", async () => {
    (apiFetch as Mock).mockResolvedValue({ ...DX_VALID, id: "dxN", code: "K35", name: "급성 충수염" });
    renderManager();
    await userEvent.click(screen.getByRole("tab", { name: /진단/ }));

    await userEvent.click(screen.getByRole("button", { name: "진단 추가" }));
    await userEvent.type(screen.getByLabelText(/코드/), "K35");
    await userEvent.type(screen.getByLabelText(/이름/), "급성 충수염");
    await userEvent.click(screen.getByRole("button", { name: "생성" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [path, init] = (apiFetch as Mock).mock.calls[0];
    expect(path).toBe("/v1/masters/diagnoses");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.code).toBe("K35");
    expect(body.name).toBe("급성 충수염");
    expect(typeof body.effective_from).toBe("string"); // 폼 기본=오늘
    expect(await screen.findByText("급성 충수염")).toBeInTheDocument();
  });

  it("수가 탭 → 금액 천단위 포맷 표시", async () => {
    renderManager({ feeSchedules: [FEE] });
    await userEvent.click(screen.getByRole("tab", { name: /수가/ }));
    expect(screen.getByText("12,000")).toBeInTheDocument();
  });

  it("약품 탭 → 주성분코드·단위 표시", async () => {
    renderManager({ drugs: [DRUG] });
    await userEvent.click(screen.getByRole("tab", { name: /약품/ }));
    expect(screen.getByText("타이레놀정 500mg")).toBeInTheDocument();
    expect(screen.getByText("120901ATB")).toBeInTheDocument();
  });

  it("진단 비활성 → 확인 다이얼로그 경유 PATCH(is_active=false)", async () => {
    (apiFetch as Mock).mockResolvedValue({ ...DX_VALID, is_active: false });
    renderManager({ diagnoses: [DX_VALID] });
    await userEvent.click(screen.getByRole("tab", { name: /진단/ }));

    await userEvent.click(screen.getByRole("button", { name: "비활성" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "비활성" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [path, init] = (apiFetch as Mock).mock.calls[0];
    expect(path).toBe("/v1/masters/diagnoses/dx1/active");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ is_active: false });
  });
});
