import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api/client";
import { createExamination, fetchExaminations } from "@/lib/encounters/examinations";

// 검사·영상 lib(Story 5.3) — apiFetch 모킹으로 URL·메서드·바디 검증. 전 경로 snake_case.
vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn() }));
const mockApiFetch = vi.mocked(apiFetch);
afterEach(() => vi.clearAllMocks());

describe("examinations lib", () => {
  it("fetchExaminations — GET sub-resource", async () => {
    mockApiFetch.mockResolvedValueOnce([]);
    await fetchExaminations("e1");
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters/e1/examinations");
  });

  it("createExamination — POST + JSON 바디(exam_type·fee_schedule_id)", async () => {
    mockApiFetch.mockResolvedValueOnce({} as never);
    const body = { exam_type: "imaging" as const, fee_schedule_id: "fs1" };
    await createExamination("e1", body);
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters/e1/examinations", {
      method: "POST",
      body: JSON.stringify(body),
    });
  });
});
