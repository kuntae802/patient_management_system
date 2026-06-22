import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api/client";
import {
  createPrescription,
  fetchPrescriptions,
  issuedIngredientCodes,
  type Prescription,
} from "@/lib/encounters/prescriptions";

// 처방 lib(Story 5.2) — apiFetch 모킹으로 URL·메서드·바디 검증 + 중복 성분 집합 헬퍼. 전 경로 snake_case.
vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn() }));
const mockApiFetch = vi.mocked(apiFetch);
afterEach(() => vi.clearAllMocks());

function makeRx(over: Partial<Prescription> = {}): Prescription {
  return {
    id: "rx1",
    encounter_id: "e1",
    encounter_diagnosis_id: null,
    status: "issued",
    ordered_by: "d1",
    ordered_at: "2026-06-22T00:00:00Z",
    dispensed_at: null,
    is_active: true,
    created_at: "2026-06-22T00:00:00Z",
    updated_at: "2026-06-22T00:00:00Z",
    details: [],
    ...over,
  };
}

describe("prescriptions lib", () => {
  it("fetchPrescriptions — GET sub-resource", async () => {
    mockApiFetch.mockResolvedValueOnce([makeRx()]);
    const out = await fetchPrescriptions("e1");
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters/e1/prescriptions");
    expect(out).toHaveLength(1);
  });

  it("createPrescription — POST + JSON 바디(근거 진단·상세)", async () => {
    mockApiFetch.mockResolvedValueOnce(makeRx());
    const body = {
      encounter_diagnosis_id: "ed1",
      details: [{ drug_id: "dr1", dose: 0.5, frequency: "TID" }],
    };
    await createPrescription("e1", body);
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters/e1/prescriptions", {
      method: "POST",
      body: JSON.stringify(body),
    });
  });

  it("issuedIngredientCodes — 활성 처방의 활성 상세 성분(비-null)만 집계", () => {
    const rx = makeRx({
      details: [
        {
          id: "d1",
          prescription_id: "rx1",
          drug_id: "dr1",
          drug_code: "645100250",
          drug_name: "타이레놀",
          ingredient_code: "153002ATB",
          dose: null,
          frequency: null,
          duration_days: null,
          usage_instruction: null,
          is_active: true,
          created_at: "x",
          updated_at: "x",
        },
        {
          id: "d2",
          prescription_id: "rx1",
          drug_id: "dr2",
          drug_code: "x",
          drug_name: "성분미상",
          ingredient_code: null, // null 은 집계 제외
          dose: null,
          frequency: null,
          duration_days: null,
          usage_instruction: null,
          is_active: true,
          created_at: "x",
          updated_at: "x",
        },
      ],
    });
    const codes = issuedIngredientCodes([rx]);
    expect(codes.has("153002ATB")).toBe(true);
    expect(codes.size).toBe(1); // null 성분·비활성 제외
  });

  it("issuedIngredientCodes — 비활성 처방은 제외", () => {
    const inactive = makeRx({
      is_active: false,
      details: [
        {
          id: "d1",
          prescription_id: "rx1",
          drug_id: "dr1",
          drug_code: "x",
          drug_name: "x",
          ingredient_code: "AAA",
          dose: null,
          frequency: null,
          duration_days: null,
          usage_instruction: null,
          is_active: true,
          created_at: "x",
          updated_at: "x",
        },
      ],
    });
    expect(issuedIngredientCodes([inactive]).size).toBe(0);
  });
});
