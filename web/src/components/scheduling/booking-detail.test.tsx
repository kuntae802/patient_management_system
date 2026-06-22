import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import { BookingDetail } from "@/components/scheduling/booking-detail";

vi.mock("@/lib/scheduling/appointments", () => ({
  cancelAppointment: vi.fn(),
  noShowAppointment: vi.fn(),
  checkInReservation: vi.fn(),
  rescheduleAppointment: vi.fn(),
}));
vi.mock("@/lib/scheduling/slots", () => ({
  fetchAvailableSlots: vi.fn(),
  formatSlotTime: (iso: string) => iso.slice(11, 16),
}));

import {
  cancelAppointment,
  checkInReservation,
  noShowAppointment,
  rescheduleAppointment,
} from "@/lib/scheduling/appointments";
import { fetchAvailableSlots } from "@/lib/scheduling/slots";

const mockCancel = cancelAppointment as unknown as ReturnType<typeof vi.fn>;
const mockNoShow = noShowAppointment as unknown as ReturnType<typeof vi.fn>;
const mockCheckIn = checkInReservation as unknown as ReturnType<typeof vi.fn>;
const mockReschedule = rescheduleAppointment as unknown as ReturnType<typeof vi.fn>;
const mockSlots = fetchAvailableSlots as unknown as ReturnType<typeof vi.fn>;

const PROPS = {
  open: true,
  onOpenChange: vi.fn(),
  appointmentId: "a1",
  doctorId: "doc1",
  doctorName: "의사A",
  departmentName: "내과",
  scheduledStart: "2030-06-03T01:00:00Z", // 10:00 KST
  patientName: "홍길동",
  onChanged: vi.fn(),
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
  mockNoShow.mockReset();
  mockCheckIn.mockReset();
  mockReschedule.mockReset();
  mockSlots.mockReset();
  PROPS.onChanged.mockReset();
  PROPS.onOpenChange.mockReset();
});

describe("BookingDetail", () => {
  it("도착 접수 → checkInReservation 호출 + 대기 등록 안내", async () => {
    const user = userEvent.setup();
    mockCheckIn.mockResolvedValue({ id: "e1", status: "registered", visit_type: "reserved" });
    render(<BookingDetail {...PROPS} />);

    await user.click(screen.getByRole("button", { name: "도착 접수" }));
    await waitFor(() => expect(mockCheckIn).toHaveBeenCalledWith("a1"));
    expect(await screen.findByRole("status")).toHaveTextContent("대기 현황판에 등록");
    expect(PROPS.onChanged).toHaveBeenCalled();
  });

  it("취소 → 사유 입력 → cancelAppointment 호출 + onChanged", async () => {
    const user = userEvent.setup();
    mockCancel.mockResolvedValue({ id: "a1", status: "cancelled" });
    render(<BookingDetail {...PROPS} />);

    await user.click(screen.getByRole("button", { name: "취소" }));
    await user.type(screen.getByPlaceholderText(/운영 사유/), "환자 요청");
    await user.click(screen.getByRole("button", { name: "예약 취소 확정" }));

    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith("a1", "환자 요청"));
    expect(PROPS.onChanged).toHaveBeenCalled();
  });

  it("노쇼 → noShowAppointment 호출", async () => {
    const user = userEvent.setup();
    mockNoShow.mockResolvedValue({ id: "a1", status: "no_show" });
    render(<BookingDetail {...PROPS} />);

    await user.click(screen.getByRole("button", { name: "노쇼" }));
    await user.click(screen.getByRole("button", { name: "노쇼 처리 확정" }));
    await waitFor(() => expect(mockNoShow).toHaveBeenCalledWith("a1", undefined));
  });

  it("잘못된 전이(409) → 인라인 경고, onChanged 미호출", async () => {
    const user = userEvent.setup();
    mockCancel.mockRejectedValue(new ApiError("invalid_transition", "종결 재전이", 409));
    render(<BookingDetail {...PROPS} />);

    await user.click(screen.getByRole("button", { name: "취소" }));
    await user.click(screen.getByRole("button", { name: "예약 취소 확정" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("종결 재전이");
    expect(PROPS.onChanged).not.toHaveBeenCalled();
  });

  it("변경 → 가용 슬롯 조회·선택 → rescheduleAppointment 호출", async () => {
    const user = userEvent.setup();
    mockSlots.mockResolvedValue({
      doctor_id: "doc1",
      date: "2030-06-03",
      slot_minutes: 30,
      slots: [{ start: "2030-06-03T02:00:00Z", end: "2030-06-03T02:30:00Z", status: "available" }],
    });
    mockReschedule.mockResolvedValue({ id: "a1", status: "booked" });
    render(<BookingDetail {...PROPS} />);

    await user.click(screen.getByRole("button", { name: "변경" }));
    // formatSlotTime 모킹 = iso.slice(11,16) → "2030-06-03T02:00:00Z" → "02:00".
    const slotBtn = await screen.findByRole("button", { name: "02:00" });
    await user.click(slotBtn);

    await waitFor(() =>
      expect(mockReschedule).toHaveBeenCalledWith("a1", {
        doctor_id: "doc1",
        scheduled_start: "2030-06-03T02:00:00Z",
      }),
    );
    expect(PROPS.onChanged).toHaveBeenCalled();
  });
});
