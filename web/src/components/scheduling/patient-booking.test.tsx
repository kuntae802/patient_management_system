import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import { PatientBooking } from "@/components/scheduling/patient-booking";

// 링크 확인(GET /patients/self)·진료과(Supabase) 모킹. self 경로 fetch 는 모킹하되 12h 포맷터는 실제.
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});
vi.mock("@/lib/scheduling/patient-booking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scheduling/patient-booking")>();
  return {
    ...actual,
    fetchSelfBookableDoctors: vi.fn(),
    fetchSelfSlots: vi.fn(),
    createSelfAppointment: vi.fn(),
  };
});
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [{ id: "d1", name: "내과" }], error: null }),
        }),
      }),
    }),
  }),
}));

import { apiFetch } from "@/lib/api/client";
import {
  createSelfAppointment,
  fetchSelfBookableDoctors,
  fetchSelfSlots,
} from "@/lib/scheduling/patient-booking";

const mockApiFetch = apiFetch as unknown as ReturnType<typeof vi.fn>;
const mockDoctors = fetchSelfBookableDoctors as unknown as ReturnType<typeof vi.fn>;
const mockSlots = fetchSelfSlots as unknown as ReturnType<typeof vi.fn>;
const mockCreate = createSelfAppointment as unknown as ReturnType<typeof vi.fn>;

const SLOT_START = "2030-06-03T02:00:00Z"; // 11:00 KST
const SLOTS = [
  { start: SLOT_START, end: "2030-06-03T02:30:00Z", status: "available" as const },
  { start: "2030-06-03T02:30:00Z", end: "2030-06-03T03:00:00Z", status: "booked" as const },
];

async function reachSlots(user: ReturnType<typeof userEvent.setup>) {
  // 진료과 → 의사 → 첫 날짜 칩(오늘) 선택 → 슬롯 로드. 각 단계 옵션 로드를 먼저 대기(결정론적).
  await screen.findByRole("option", { name: "내과" }); // 진료과(Supabase) 로드 완료
  await user.selectOptions(screen.getByRole("combobox", { name: "진료과" }), "d1");
  await screen.findByRole("option", { name: "이정훈" }); // 의사 로드 완료(select 활성)
  await user.selectOptions(screen.getByRole("combobox", { name: "의사" }), "doc1");
  await user.click(await screen.findByRole("button", { name: /오늘/ }));
}

describe("PatientBooking", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockDoctors.mockReset();
    mockSlots.mockReset();
    mockCreate.mockReset();
    mockApiFetch.mockResolvedValue({ id: "self", name: "홍길동" }); // 연결됨
    mockDoctors.mockResolvedValue([{ id: "doc1", name: "이정훈", department_id: "d1" }]);
    mockSlots.mockResolvedValue({ doctor_id: "doc1", date: "x", slot_minutes: 30, slots: SLOTS });
  });

  it("미연결 환자 → 온보딩 연결 안내(예약 폼 미표시)", async () => {
    mockApiFetch.mockRejectedValue(new ApiError("no_self_patient", "미연결", 404));
    render(<PatientBooking />);
    expect(await screen.findByText("본인 진료기록 연결")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "진료과" })).not.toBeInTheDocument();
  });

  it("흐름 완료 → createSelfAppointment(patient_id 없는 페이로드) + 완료 화면", async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue({ id: "a1", status: "booked" });
    render(<PatientBooking />);

    await reachSlots(user);
    // 12시간 표기(오전 11:00 = 02:00Z+9) 슬롯 선택.
    await user.click(await screen.findByText(/(오전|AM) 11:00/));
    await user.click(screen.getByRole("button", { name: "예약 확정하기" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const payload = mockCreate.mock.calls[0][0];
    expect(payload).toMatchObject({
      department_id: "d1",
      doctor_id: "doc1",
      scheduled_start: SLOT_START,
      sms_opt_in: true,
    });
    expect(payload).not.toHaveProperty("patient_id"); // 세션 스코프 — 클라가 patient_id 미전송
    expect(await screen.findByText("예약이 완료되었어요")).toBeInTheDocument();
  });

  it("더블부킹 409 → 인라인 경고, 완료 화면 미표시", async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(new ApiError("double_booking", "겹침", 409));
    render(<PatientBooking />);

    await reachSlots(user);
    await user.click(await screen.findByText(/(오전|AM) 11:00/));
    await user.click(screen.getByRole("button", { name: "예약 확정하기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("방금 마감된 시간입니다");
    expect(screen.queryByText("예약이 완료되었어요")).not.toBeInTheDocument();
  });

  it("노쇼 임계 409 → 쉬운 말 안내, 완료 화면 미표시(6.7)", async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(new ApiError("no_show_threshold_exceeded", "노쇼 제한", 409));
    render(<PatientBooking />);

    await reachSlots(user);
    await user.click(await screen.findByText(/(오전|AM) 11:00/));
    await user.click(screen.getByRole("button", { name: "예약 확정하기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("병원으로 문의해 주세요");
    expect(screen.queryByText("예약이 완료되었어요")).not.toBeInTheDocument();
  });

  it("가용 슬롯 0 → 빈-상태 메시지", async () => {
    const user = userEvent.setup();
    mockSlots.mockResolvedValue({
      doctor_id: "doc1",
      date: "x",
      slot_minutes: 30,
      slots: [{ start: SLOT_START, end: "2030-06-03T02:30:00Z", status: "time_off" as const }],
    });
    render(<PatientBooking />);
    await reachSlots(user);
    expect(
      await screen.findByText("이 날짜에 예약 가능한 시간이 없어요. 다른 날짜를 선택해 주세요."),
    ).toBeInTheDocument();
  });

  it("슬롯 미선택 시 예약 확정 CTA 비활성", async () => {
    const user = userEvent.setup();
    render(<PatientBooking />);
    await reachSlots(user);
    await screen.findByText(/(오전|AM) 11:00/); // 슬롯 렌더됨(미선택)
    expect(screen.getByRole("button", { name: "예약 확정하기" })).toBeDisabled();
  });
});
