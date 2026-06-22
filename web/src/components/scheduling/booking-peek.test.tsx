import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import type { PatientListItem } from "@/lib/reception/patients";
import { BookingPeek } from "@/components/scheduling/booking-peek";

vi.mock("@/lib/reception/patients", () => ({
  searchPatients: vi.fn(),
  maskPhone: (p: string | null) => p ?? "—",
  sexLabel: (s: string) => (s === "male" ? "남" : "여"),
}));
vi.mock("@/lib/scheduling/appointments", () => ({
  createAppointment: vi.fn(),
  fetchNoShowStatus: vi.fn(),
}));

import { searchPatients } from "@/lib/reception/patients";
import { createAppointment, fetchNoShowStatus } from "@/lib/scheduling/appointments";

const mockSearch = searchPatients as unknown as ReturnType<typeof vi.fn>;
const mockCreate = createAppointment as unknown as ReturnType<typeof vi.fn>;
const mockNoShow = fetchNoShowStatus as unknown as ReturnType<typeof vi.fn>;

const PATIENT: PatientListItem = {
  id: "p1",
  chart_no: "00000001",
  name: "홍길동",
  birth_date: "1990-01-01",
  sex: "male",
  resident_no_masked: "900101-1******",
  phone: "010-1234-5678",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
};

const PROPS = {
  open: true,
  onOpenChange: vi.fn(),
  departmentId: "d1",
  departmentName: "내과",
  doctorId: "doc1",
  doctorName: "의사A",
  scheduledStart: "2030-06-03T01:00:00Z", // 10:00 KST
  onCreated: vi.fn(),
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
  mockSearch.mockReset();
  mockCreate.mockReset();
  mockNoShow.mockReset();
  // 기본 = 노쇼 0(차단 안 됨) — 노쇼 테스트가 개별 override.
  mockNoShow.mockResolvedValue({ patient_id: "p1", no_show_count: 0, threshold: 2, blocked: false });
  PROPS.onCreated.mockReset();
});

describe("BookingPeek", () => {
  it("환자 검색→선택→저장 → createAppointment 호출(snake_case 페이로드)", async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue([PATIENT]);
    mockCreate.mockResolvedValue({ id: "a1", status: "booked" });
    render(<BookingPeek {...PROPS} />);

    await user.type(screen.getByPlaceholderText("이름·차트번호·연락처 검색"), "홍길동");
    const result = await screen.findByText("홍길동 · 00000001");
    await user.click(result);

    await user.click(screen.getByRole("button", { name: "예약 저장" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        department_id: "d1",
        doctor_id: "doc1",
        patient_id: "p1",
        scheduled_start: "2030-06-03T01:00:00Z",
        sms_opt_in: true,
      }),
    );
    expect(PROPS.onCreated).toHaveBeenCalled();
  });

  it("더블부킹 409 → 인라인 경고 칩, 저장 안 됨(onCreated 미호출)", async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue([PATIENT]);
    mockCreate.mockRejectedValue(new ApiError("double_booking", "겹침", 409));
    render(<BookingPeek {...PROPS} />);

    await user.type(screen.getByPlaceholderText("이름·차트번호·연락처 검색"), "홍");
    await user.click(await screen.findByText("홍길동 · 00000001"));
    await user.click(screen.getByRole("button", { name: "예약 저장" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("더블부킹 차단");
    expect(PROPS.onCreated).not.toHaveBeenCalled();
  });

  it("환자 미선택 시 저장 버튼 비활성", () => {
    render(<BookingPeek {...PROPS} />);
    expect(screen.getByRole("button", { name: "예약 저장" })).toBeDisabled();
  });

  it("노쇼 임계 초과 환자 선택 → 프로액티브 경고 + 저장 버튼 비활성(6.7 AC4)", async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue([PATIENT]);
    mockNoShow.mockResolvedValue({
      patient_id: "p1",
      no_show_count: 3,
      threshold: 2,
      blocked: true,
    });
    render(<BookingPeek {...PROPS} />);

    await user.type(screen.getByPlaceholderText("이름·차트번호·연락처 검색"), "홍");
    await user.click(await screen.findByText("홍길동 · 00000001"));

    expect(await screen.findByRole("alert")).toHaveTextContent("신규 예약이");
    expect(screen.getByRole("button", { name: "예약 저장" })).toBeDisabled();
  });

  it("저장 시 노쇼 임계 409 → 경고 칩, 저장 안 됨(onCreated 미호출)", async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue([PATIENT]);
    // 프로액티브는 통과(blocked=false·기본) → 저장 클릭 시 서버 409 로 차단.
    mockCreate.mockRejectedValue(
      new ApiError("no_show_threshold_exceeded", "노쇼 제한", 409, {
        no_show_count: 3,
        threshold: 2,
      }),
    );
    render(<BookingPeek {...PROPS} />);

    await user.type(screen.getByPlaceholderText("이름·차트번호·연락처 검색"), "홍");
    await user.click(await screen.findByText("홍길동 · 00000001"));
    await user.click(screen.getByRole("button", { name: "예약 저장" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("신규 예약이");
    expect(PROPS.onCreated).not.toHaveBeenCalled();
  });
});
