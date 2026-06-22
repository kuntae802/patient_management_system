import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api/client";
import {
  CALENDAR_STATUS_META,
  createAppointment,
  fetchAffectedAppointments,
  fetchDayCalendar,
  fetchNoShowStatus,
  recordChangeNotice,
} from "@/lib/scheduling/appointments";

vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn() }));
const mockApiFetch = apiFetch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => mockApiFetch.mockReset());

describe("createAppointment", () => {
  it("POST /appointments + snake_case body", async () => {
    mockApiFetch.mockResolvedValue({ id: "a1", status: "booked" });
    await createAppointment({
      department_id: "d1",
      doctor_id: "doc1",
      patient_id: "p1",
      scheduled_start: "2030-06-03T01:00:00Z",
      note: "초진",
      sms_opt_in: true,
    });
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/scheduling/appointments", {
      method: "POST",
      body: JSON.stringify({
        department_id: "d1",
        doctor_id: "doc1",
        patient_id: "p1",
        scheduled_start: "2030-06-03T01:00:00Z",
        note: "초진",
        sms_opt_in: true,
      }),
    });
  });
});

describe("fetchDayCalendar", () => {
  it("department_id·date 쿼리로 /calendar 호출", async () => {
    mockApiFetch.mockResolvedValue({ doctors: [] });
    await fetchDayCalendar("d1", "2030-06-03");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/v1/scheduling/calendar?department_id=d1&date=2030-06-03",
    );
  });
});

describe("fetchNoShowStatus", () => {
  it("patient_id 쿼리로 /no-show-status 호출 + 응답 매핑(snake_case 유지)", async () => {
    mockApiFetch.mockResolvedValue({
      patient_id: "p1",
      no_show_count: 3,
      threshold: 2,
      blocked: true,
    });
    const res = await fetchNoShowStatus("p1");
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/scheduling/no-show-status?patient_id=p1");
    expect(res.no_show_count).toBe(3);
    expect(res.blocked).toBe(true);
  });
});

describe("fetchAffectedAppointments", () => {
  it("doctor_id·start_at·end_at 쿼리로 /affected-appointments 호출 + 응답 매핑(snake_case 유지)", async () => {
    mockApiFetch.mockResolvedValue([
      { id: "a1", patient_name: "홍길동", status: "booked", scheduled_start: "2030-06-03T01:00:00Z" },
    ]);
    const res = await fetchAffectedAppointments("doc1", "2030-06-03T00:00:00Z", "2030-06-03T03:30:00Z");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/v1/scheduling/affected-appointments?doctor_id=doc1&start_at=2030-06-03T00%3A00%3A00Z&end_at=2030-06-03T03%3A30%3A00Z",
    );
    expect(res[0].patient_name).toBe("홍길동");
  });
});

describe("recordChangeNotice", () => {
  it("POST /appointments/{id}/notify-change + kind body", async () => {
    mockApiFetch.mockResolvedValue({ id: "n1", reminder_kind: "cancellation_notice" });
    await recordChangeNotice("a1", "cancellation_notice");
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/scheduling/appointments/a1/notify-change", {
      method: "POST",
      body: JSON.stringify({ kind: "cancellation_notice" }),
    });
  });
});

describe("CALENDAR_STATUS_META", () => {
  it("available 만 selectable(예약 생성), 나머지 비활성", () => {
    expect(CALENDAR_STATUS_META.available.selectable).toBe(true);
    for (const s of ["confirmed", "completed", "no_show", "cancelled", "time_off", "past"] as const) {
      expect(CALENDAR_STATUS_META[s].selectable).toBe(false);
    }
  });

  it("상태별 라벨·글리프(음영 비의존 다중 인코딩)", () => {
    expect(CALENDAR_STATUS_META.confirmed.label).toBe("확정");
    expect(CALENDAR_STATUS_META.no_show.label).toBe("노쇼");
    expect(CALENDAR_STATUS_META.cancelled.label).toBe("취소");
    expect(CALENDAR_STATUS_META.time_off.label).toBe("휴진");
    for (const meta of Object.values(CALENDAR_STATUS_META)) expect(meta.glyph).toBeTruthy();
  });
});
