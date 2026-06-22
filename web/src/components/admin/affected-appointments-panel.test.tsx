import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import { AffectedAppointmentsPanel } from "@/components/admin/affected-appointments-panel";

vi.mock("@/lib/scheduling/appointments", () => ({
  cancelAppointment: vi.fn(),
  rescheduleAppointment: vi.fn(),
  recordChangeNotice: vi.fn(),
}));
vi.mock("@/lib/scheduling/slots", () => ({
  fetchAvailableSlots: vi.fn(),
  fetchBookableDoctors: vi.fn(),
  formatSlotTime: (iso: string) => iso.slice(11, 16),
}));
vi.mock("@/lib/admin/schedule", () => ({
  formatKstDateTime: (iso: string) => iso,
}));

import {
  cancelAppointment,
  recordChangeNotice,
  rescheduleAppointment,
} from "@/lib/scheduling/appointments";
import { fetchAvailableSlots, fetchBookableDoctors } from "@/lib/scheduling/slots";

const mockCancel = cancelAppointment as unknown as ReturnType<typeof vi.fn>;
const mockReschedule = rescheduleAppointment as unknown as ReturnType<typeof vi.fn>;
const mockNotice = recordChangeNotice as unknown as ReturnType<typeof vi.fn>;
const mockSlots = fetchAvailableSlots as unknown as ReturnType<typeof vi.fn>;
const mockDoctors = fetchBookableDoctors as unknown as ReturnType<typeof vi.fn>;

const APPT = {
  id: "a1",
  patient_id: "p1",
  patient_name: "홍길동",
  doctor_id: "doc1",
  department_id: "dep1",
  scheduled_start: "2030-06-03T01:00:00Z",
  scheduled_end: "2030-06-03T01:30:00Z",
  status: "booked",
};

const PROPS = {
  open: true,
  onOpenChange: vi.fn(),
  doctorName: "의사A",
  initial: [APPT],
  onResolved: vi.fn(),
};

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: false,
      media: q,
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

beforeEach(() => {
  mockCancel.mockReset();
  mockReschedule.mockReset();
  mockNotice.mockReset();
  mockSlots.mockReset();
  mockDoctors.mockReset();
  PROPS.onOpenChange.mockReset();
  PROPS.onResolved.mockReset();
  mockDoctors.mockResolvedValue([{ id: "doc1", name: "의사A", department_id: "dep1" }]);
  mockSlots.mockResolvedValue({
    doctor_id: "doc1",
    date: "2030-06-03",
    slot_minutes: 30,
    slots: [{ start: "2030-06-03T02:00:00Z", end: "2030-06-03T02:30:00Z", status: "available" }],
  });
});

describe("AffectedAppointmentsPanel", () => {
  it("영향 예약 목록(환자명) 렌더", () => {
    render(<AffectedAppointmentsPanel {...PROPS} />);
    expect(screen.getByText("홍길동")).toBeInTheDocument();
  });

  it("빈 목록이면 처리할 영향 예약 없음 안내", () => {
    render(<AffectedAppointmentsPanel {...PROPS} initial={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("처리할 영향 예약이 없습니다");
  });

  it("재배정 → 슬롯 선택 → reschedule + reschedule_notice 기록", async () => {
    const user = userEvent.setup();
    mockReschedule.mockResolvedValue({ id: "a1", status: "booked" });
    mockNotice.mockResolvedValue({});
    render(<AffectedAppointmentsPanel {...PROPS} />);

    await user.click(screen.getByRole("button", { name: "재배정" }));
    // formatSlotTime 모킹 = iso.slice(11,16) → "2030-06-03T02:00:00Z" → "02:00".
    const slotBtn = await screen.findByRole("button", { name: "02:00" });
    await user.click(slotBtn);

    await waitFor(() =>
      expect(mockReschedule).toHaveBeenCalledWith("a1", {
        doctor_id: "doc1",
        scheduled_start: "2030-06-03T02:00:00Z",
      }),
    );
    await waitFor(() => expect(mockNotice).toHaveBeenCalledWith("a1", "reschedule_notice"));
    expect(PROPS.onResolved).toHaveBeenCalled();
  });

  it("취소·안내 → cancel(사유 의사 휴진) + cancellation_notice 기록", async () => {
    const user = userEvent.setup();
    mockCancel.mockResolvedValue({ id: "a1", status: "cancelled" });
    mockNotice.mockResolvedValue({});
    render(<AffectedAppointmentsPanel {...PROPS} />);

    await user.click(screen.getByRole("button", { name: "취소·안내" }));
    await user.click(screen.getByRole("button", { name: "취소·안내 확정" }));

    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith("a1", "의사 휴진"));
    await waitFor(() => expect(mockNotice).toHaveBeenCalledWith("a1", "cancellation_notice"));
    expect(PROPS.onResolved).toHaveBeenCalled();
  });

  it("재배정 더블부킹 409 → 인라인 경고·해소 안 됨", async () => {
    const user = userEvent.setup();
    mockReschedule.mockRejectedValue(new ApiError("double_booking", "충돌", 409));
    render(<AffectedAppointmentsPanel {...PROPS} />);

    await user.click(screen.getByRole("button", { name: "재배정" }));
    const slotBtn = await screen.findByRole("button", { name: "02:00" });
    await user.click(slotBtn);

    expect(await screen.findByRole("alert")).toHaveTextContent("이미 예약");
    expect(mockNotice).not.toHaveBeenCalled();
    expect(PROPS.onResolved).not.toHaveBeenCalled();
  });
});
