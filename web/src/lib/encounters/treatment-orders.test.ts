import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api/client";
import { createTreatmentOrder, fetchTreatmentOrders } from "@/lib/encounters/treatment-orders";

// 처치 오더 lib(Story 5.4) — apiFetch 모킹으로 URL·메서드·바디 검증. 전 경로 snake_case.
vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn() }));
const mockApiFetch = vi.mocked(apiFetch);
afterEach(() => vi.clearAllMocks());

describe("treatment-orders lib", () => {
  it("fetchTreatmentOrders — GET sub-resource", async () => {
    mockApiFetch.mockResolvedValueOnce([]);
    await fetchTreatmentOrders("e1");
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters/e1/treatment-orders");
  });

  it("createTreatmentOrder — POST + JSON 바디(fee_schedule_id)", async () => {
    mockApiFetch.mockResolvedValueOnce({} as never);
    const body = { fee_schedule_id: "fs1" };
    await createTreatmentOrder("e1", body);
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters/e1/treatment-orders", {
      method: "POST",
      body: JSON.stringify(body),
    });
  });
});
