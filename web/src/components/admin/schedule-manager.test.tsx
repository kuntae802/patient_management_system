import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { ScheduleManager } from "@/components/admin/schedule-manager";
import { apiFetch } from "@/lib/api/client";
import type { Department, Room } from "@/lib/admin/masters";
import type { DoctorSchedule, DoctorTimeOff, SchedulingDoctor } from "@/lib/admin/schedule";

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

const TS = "2026-06-21T00:00:00Z";
const DEPT: Department = {
  id: "d1",
  code: "IM",
  name: "내과",
  description: null,
  is_active: true,
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
const DOCTORS: SchedulingDoctor[] = [{ id: "doc1", name: "김의사", department_id: "d1" }];
const SCHED: DoctorSchedule = {
  id: "s1",
  doctor_id: "doc1",
  department_id: "d1",
  room_id: "r1",
  weekday: 1,
  start_time: "09:00:00",
  end_time: "12:00:00",
  is_active: true,
  created_at: TS,
  updated_at: TS,
};
const TIMEOFF: DoctorTimeOff = {
  id: "t1",
  doctor_id: "doc1",
  start_at: "2030-03-01T00:00:00+09:00",
  end_at: "2030-03-03T00:00:00+09:00",
  reason: "학회",
  is_active: true,
  created_at: TS,
  updated_at: TS,
};

// apiFetch: 마운트 시 /doctors GET + 쓰기. 기본은 doctors=DOCTORS, 그 외=created 반환.
function mockApi(created: unknown = SCHED) {
  (apiFetch as Mock).mockImplementation((path: string) =>
    path === "/v1/scheduling/doctors" ? Promise.resolve(DOCTORS) : Promise.resolve(created),
  );
}

function renderManager(overrides: { schedules?: DoctorSchedule[]; timeOffs?: DoctorTimeOff[] } = {}) {
  return render(
    <ScheduleManager
      initial={{
        schedules: overrides.schedules ?? [SCHED],
        timeOffs: overrides.timeOffs ?? [TIMEOFF],
        departments: [DEPT],
        rooms: [ROOM],
      }}
      departments={[DEPT]}
      rooms={[ROOM]}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi();
});

describe("ScheduleManager", () => {
  it("근무표 목록 렌더 — 요일·시간대·진료실 즉시, 의사명은 마운트 조회 후", async () => {
    renderManager();
    // 요일·시간대는 props 만으로 즉시 렌더(의사 비의존).
    expect(screen.getByText("월")).toBeInTheDocument();
    expect(screen.getByText("09:00–12:00")).toBeInTheDocument();
    expect(screen.getByText("1진료실")).toBeInTheDocument();
    expect(screen.getByText("내과")).toBeInTheDocument();
    // 의사명은 /doctors 조회 완료 후 해석.
    expect(await screen.findByText("김의사")).toBeInTheDocument();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/scheduling/doctors"));
  });

  it("휴진·예외 탭 전환 → 사유·상태 표시", async () => {
    renderManager();
    await userEvent.click(screen.getByRole("tab", { name: /휴진/ }));
    expect(screen.getByText("학회")).toBeInTheDocument();
    const row = screen.getByText("학회").closest("tr") as HTMLElement;
    expect(within(row).getByText("활성")).toBeInTheDocument();
  });

  it("근무표 생성 → POST 호출 + 정확한 body(weekday 정수·기본 시각)", async () => {
    const created: DoctorSchedule = { ...SCHED, id: "s2", weekday: 1 };
    mockApi(created);
    renderManager({ schedules: [] });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/scheduling/doctors"));

    await userEvent.click(screen.getByRole("button", { name: "근무표 추가" }));
    await userEvent.selectOptions(await screen.findByLabelText(/의사/), "doc1");
    await userEvent.selectOptions(screen.getByLabelText(/진료과/), "d1");
    await userEvent.click(screen.getByRole("button", { name: "생성" }));

    await waitFor(() => {
      const post = (apiFetch as Mock).mock.calls.find(([, init]) => init?.method === "POST");
      expect(post).toBeTruthy();
    });
    const post = (apiFetch as Mock).mock.calls.find(([, init]) => init?.method === "POST");
    expect(post?.[0]).toBe("/v1/scheduling/doctor-schedules");
    expect(JSON.parse(post?.[1].body)).toEqual({
      doctor_id: "doc1",
      department_id: "d1",
      weekday: 1,
      start_time: "09:00",
      end_time: "12:00",
    });
  });

  it("근무표 비활성 → 확인 다이얼로그 경유 PATCH(is_active=false)", async () => {
    mockApi({ ...SCHED, is_active: false });
    renderManager();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/scheduling/doctors"));

    await userEvent.click(screen.getByRole("button", { name: "비활성" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/비활성 처리 확인/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "비활성" }));

    await waitFor(() => {
      const patch = (apiFetch as Mock).mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(patch).toBeTruthy();
    });
    const patch = (apiFetch as Mock).mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patch?.[0]).toBe("/v1/scheduling/doctor-schedules/s1/active");
    expect(JSON.parse(patch?.[1].body)).toEqual({ is_active: false });
  });

  it("근무표 활성 복귀는 확인 없이 즉시 PATCH(is_active=true)", async () => {
    mockApi({ ...SCHED, is_active: true });
    renderManager({ schedules: [{ ...SCHED, is_active: false }] });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/v1/scheduling/doctors"));

    await userEvent.click(screen.getByRole("button", { name: "활성" }));
    await waitFor(() => {
      const patch = (apiFetch as Mock).mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(patch).toBeTruthy();
    });
    const patch = (apiFetch as Mock).mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patch?.[0]).toBe("/v1/scheduling/doctor-schedules/s1/active");
    expect(JSON.parse(patch?.[1].body)).toEqual({ is_active: true });
    // 활성 복귀는 alertdialog 미출현.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
