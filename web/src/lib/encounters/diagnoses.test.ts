import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api/client";
import {
  attachDiagnosis,
  type EncounterDiagnosis,
  fetchEncounterDiagnoses,
  removeDiagnosis,
  setDiagnosisPrimary,
  completeEncounter,
} from "@/lib/encounters/diagnoses";

// 내원진단 lib(Story 4.7) — apiFetch 모킹으로 URL·메서드·바디·반환 검증. 전 경로 snake_case.
vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn() }));
const mockApiFetch = vi.mocked(apiFetch);
afterEach(() => vi.clearAllMocks());

const DX: EncounterDiagnosis = {
  id: "ed1",
  encounter_id: "e1",
  diagnosis_id: "dx1",
  diagnosis_code: "I10",
  diagnosis_name: "본태성(원발성) 고혈압",
  is_primary: true,
  recorded_by: "d1",
  is_active: true,
  created_at: "2026-06-21T00:00:00Z",
  updated_at: "2026-06-21T00:00:00Z",
};

describe("diagnoses lib", () => {
  it("fetchEncounterDiagnoses — GET sub-resource", async () => {
    mockApiFetch.mockResolvedValueOnce([DX]);
    const out = await fetchEncounterDiagnoses("e1");
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters/e1/diagnoses");
    expect(out).toEqual([DX]);
  });

  it("attachDiagnosis — POST + JSON 바디(diagnosis_id·is_primary)", async () => {
    mockApiFetch.mockResolvedValueOnce(DX);
    await attachDiagnosis("e1", { diagnosis_id: "dx1", is_primary: true });
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters/e1/diagnoses", {
      method: "POST",
      body: JSON.stringify({ diagnosis_id: "dx1", is_primary: true }),
    });
  });

  it("setDiagnosisPrimary — PATCH ed id + is_primary", async () => {
    mockApiFetch.mockResolvedValueOnce({ ...DX, is_primary: false });
    await setDiagnosisPrimary("e1", "ed1", false);
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters/e1/diagnoses/ed1", {
      method: "PATCH",
      body: JSON.stringify({ is_primary: false }),
    });
  });

  it("removeDiagnosis — DELETE ed id", async () => {
    mockApiFetch.mockResolvedValueOnce(null);
    await removeDiagnosis("e1", "ed1");
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters/e1/diagnoses/ed1", {
      method: "DELETE",
    });
  });

  it("completeEncounter — POST /complete", async () => {
    mockApiFetch.mockResolvedValueOnce({ id: "e1", status: "completed" });
    await completeEncounter("e1");
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters/e1/complete", { method: "POST" });
  });
});
