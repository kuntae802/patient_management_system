import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppointmentCalendar } from "@/components/scheduling/appointment-calendar";
import type { CalendarResponse } from "@/lib/scheduling/appointments";

// fetchDayCalendar 만 모킹, CALENDAR_STATUS_META·타입은 실제 유지.
vi.mock("@/lib/scheduling/appointments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scheduling/appointments")>();
  return { ...actual, fetchDayCalendar: vi.fn() };
});
// 진료과 직접조회용 가짜 Supabase.
vi.mock("@/lib/supabase/client", () => ({ createClient: () => fakeSupabase }));
// BookingPeek·BookingDetail 은 스텁(프롭 노출) — 캘린더 클릭→오픈만 검증.
vi.mock("@/components/scheduling/booking-peek", () => ({
  BookingPeek: (props: { doctorName: string; scheduledStart: string }) => (
    <div data-testid="peek">
      {props.doctorName}|{props.scheduledStart}
    </div>
  ),
}));
vi.mock("@/components/scheduling/booking-detail", () => ({
  BookingDetail: (props: { appointmentId: string; patientName: string | null }) => (
    <div data-testid="detail">
      {props.appointmentId}|{props.patientName}
    </div>
  ),
}));

import { fetchDayCalendar } from "@/lib/scheduling/appointments";

const mockCalendar = fetchDayCalendar as unknown as ReturnType<typeof vi.fn>;

const deptChain = {
  select: () => deptChain,
  eq: () => deptChain,
  order: () => deptChain,
  then: (cb: (r: { data: unknown[]; error: null }) => unknown) =>
    Promise.resolve(cb({ data: [{ id: "d1", name: "내과" }], error: null })),
};
const fakeSupabase = { from: () => deptChain };

const CALENDAR: CalendarResponse = {
  date: "2030-06-03",
  slot_minutes: 30,
  doctors: [
    {
      doctor_id: "doc1",
      doctor_name: "의사A",
      slots: [
        {
          start: "2030-06-03T01:00:00Z", // 10:00 KST
          end: "2030-06-03T01:30:00Z",
          status: "confirmed",
          patient_name: "홍길동",
          appointment_id: "a1",
        },
        {
          start: "2030-06-03T01:30:00Z", // 10:30 KST
          end: "2030-06-03T02:00:00Z",
          status: "available",
          patient_name: null,
          appointment_id: null,
        },
      ],
    },
  ],
};

beforeEach(() => mockCalendar.mockReset());

describe("AppointmentCalendar", () => {
  async function selectDept() {
    const user = userEvent.setup();
    render(<AppointmentCalendar />);
    await waitFor(() => expect(screen.getByRole("option", { name: "내과" })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole("combobox"), "d1");
    return user;
  }

  it("진료과 선택 → 캘린더 그리드(확정+환자명·available) 렌더", async () => {
    mockCalendar.mockResolvedValue(CALENDAR);
    await selectDept();
    await waitFor(() => expect(mockCalendar).toHaveBeenCalledWith("d1", expect.any(String)));
    // 확정 슬롯 = 환자명, available 슬롯 = 클릭 가능 button("예약 가능"=범례에도 있어 button 으로 특정).
    expect(await screen.findByText("홍길동")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /예약 가능/ })).toBeInTheDocument();
    expect(screen.getByText("의사A")).toBeInTheDocument();
  });

  it("available 슬롯 클릭 → booking-peek 오픈(의사·시각 전달)", async () => {
    mockCalendar.mockResolvedValue(CALENDAR);
    const user = await selectDept();
    const available = await screen.findByRole("button", { name: /예약 가능/ });
    await user.click(available);
    const peek = await screen.findByTestId("peek");
    expect(peek).toHaveTextContent("의사A|2030-06-03T01:30:00Z");
  });

  it("확정 슬롯 클릭 → booking-detail 오픈(appointment_id·환자명 전달, 6.4)", async () => {
    mockCalendar.mockResolvedValue(CALENDAR);
    const user = await selectDept();
    const confirmed = await screen.findByText("홍길동");
    // 6.4: 확정 슬롯은 클릭 가능 button(상세·액션 진입).
    const cell = confirmed.closest("button");
    expect(cell).not.toBeNull();
    await user.click(cell!);
    expect(await screen.findByTestId("detail")).toHaveTextContent("a1|홍길동");
  });
});
