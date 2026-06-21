import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api/client";
import {
  fetchAvailableSlots,
  fetchBookableDoctors,
  formatSlotTime,
  SLOT_STATUS_META,
} from "@/lib/scheduling/slots";

vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn() }));
const mockApiFetch = apiFetch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => mockApiFetch.mockReset());

describe("formatSlotTime", () => {
  it("UTC ISO → KST HH:MM (저장 UTC·표시 KST)", () => {
    expect(formatSlotTime("2030-06-03T00:00:00Z")).toBe("09:00"); // 00:00 UTC = 09:00 KST
    expect(formatSlotTime("2030-06-03T01:30:00Z")).toBe("10:30");
  });
});

describe("fetchAvailableSlots", () => {
  it("doctor_id·date 쿼리로 /slots 호출", async () => {
    mockApiFetch.mockResolvedValue({ slots: [] });
    await fetchAvailableSlots("doc-1", "2030-06-03");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/v1/scheduling/slots?doctor_id=doc-1&date=2030-06-03",
    );
  });
});

describe("fetchBookableDoctors", () => {
  it("진료과 필터 옵션 — 있으면 쿼리, 없으면 무쿼리", async () => {
    mockApiFetch.mockResolvedValue([]);
    await fetchBookableDoctors("dept-1");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/v1/scheduling/bookable-doctors?department_id=dept-1",
    );
    await fetchBookableDoctors();
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/scheduling/bookable-doctors");
  });
});

describe("SLOT_STATUS_META", () => {
  it("available 만 selectable(나머지 비활성)", () => {
    expect(SLOT_STATUS_META.available.selectable).toBe(true);
    expect(SLOT_STATUS_META.booked.selectable).toBe(false);
    expect(SLOT_STATUS_META.time_off.selectable).toBe(false);
    expect(SLOT_STATUS_META.past.selectable).toBe(false);
  });

  it("상태별 라벨·글리프(음영 비의존 다중 인코딩)", () => {
    expect(SLOT_STATUS_META.available.label).toBe("예약 가능");
    expect(SLOT_STATUS_META.booked.label).toBe("마감");
    expect(SLOT_STATUS_META.time_off.label).toBe("휴진");
    expect(SLOT_STATUS_META.past.label).toBe("지남");
    for (const meta of Object.values(SLOT_STATUS_META)) {
      expect(meta.glyph).toBeTruthy();
    }
  });
});
