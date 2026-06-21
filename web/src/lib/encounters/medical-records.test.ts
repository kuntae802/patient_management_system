import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api/client";
import {
  createMedicalRecord,
  fetchMedicalRecords,
  type MedicalRecord,
  updateMedicalRecord,
} from "@/lib/encounters/medical-records";

// SOAP 진료기록 lib(Story 4.6) — apiFetch 모킹으로 URL·메서드·바디·반환 검증. 전 경로 snake_case.
vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn() }));
const mockApiFetch = vi.mocked(apiFetch);
afterEach(() => vi.clearAllMocks());

const REC: MedicalRecord = {
  id: "r1",
  encounter_id: "e1",
  author_id: "d1",
  subjective: "두통 3일",
  objective: null,
  assessment: null,
  plan: null,
  is_active: true,
  created_at: "2026-06-21T00:00:00Z",
  updated_at: "2026-06-21T00:00:00Z",
};

describe("medical-records lib", () => {
  it("fetchMedicalRecords — GET sub-resource", async () => {
    mockApiFetch.mockResolvedValueOnce([REC]);
    const out = await fetchMedicalRecords("e1");
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters/e1/medical-records");
    expect(out).toEqual([REC]);
  });

  it("createMedicalRecord — POST + JSON 바디", async () => {
    mockApiFetch.mockResolvedValueOnce(REC);
    await createMedicalRecord("e1", { subjective: "두통 3일" });
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters/e1/medical-records", {
      method: "POST",
      body: JSON.stringify({ subjective: "두통 3일" }),
    });
  });

  it("updateMedicalRecord — PUT record id + JSON 바디(전체 교체)", async () => {
    mockApiFetch.mockResolvedValueOnce({ ...REC, assessment: "고혈압 의증" });
    await updateMedicalRecord("e1", "r1", { assessment: "고혈압 의증" });
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters/e1/medical-records/r1", {
      method: "PUT",
      body: JSON.stringify({ assessment: "고혈압 의증" }),
    });
  });
});
