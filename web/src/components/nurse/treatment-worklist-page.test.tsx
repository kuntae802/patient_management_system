import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TreatmentWorklistPage } from "@/components/nurse/treatment-worklist-page";
import type { NursingWorklistItem } from "@/lib/encounters/treatment-orders";

// 처치 워크리스트(Story 5.7 AC1) — fetchNursingWorklist 모킹. 검증: pending>0 만 노출·미수행 건수·빈 상태.
vi.mock("@/lib/encounters/treatment-orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/encounters/treatment-orders")>();
  return { ...actual, fetchNursingWorklist: vi.fn(), fetchTreatmentOrders: vi.fn() };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import {
  fetchNursingWorklist,
  fetchTreatmentOrders,
} from "@/lib/encounters/treatment-orders";

const mockWorklist = vi.mocked(fetchNursingWorklist);
vi.mocked(fetchTreatmentOrders).mockResolvedValue([]);

afterEach(() => vi.clearAllMocks());

function makeItem(over: Partial<NursingWorklistItem> = {}): NursingWorklistItem {
  return {
    encounter_id: "e1",
    chart_no: "C0001",
    patient_name: "홍길동",
    department_name: "내과",
    status: "registered",
    created_at: "2026-06-22T00:00:00Z",
    pending_treatment_count: 2,
    oldest_pending_ordered_at: "2026-06-22T00:00:00Z",
    nursing_record_count: 0,
    ...over,
  };
}

describe("TreatmentWorklistPage", () => {
  it("미수행 처치 보유 내원만 노출(pending=0 제외)", async () => {
    mockWorklist.mockResolvedValue([
      makeItem({ encounter_id: "e1", patient_name: "환자A", pending_treatment_count: 2 }),
      makeItem({ encounter_id: "e2", patient_name: "환자B", pending_treatment_count: 0 }),
    ]);
    render(<TreatmentWorklistPage />);
    expect(await screen.findByText("환자A")).toBeInTheDocument();
    expect(screen.queryByText("환자B")).not.toBeInTheDocument();
  });

  it("미수행 건수 배지를 보여준다", async () => {
    mockWorklist.mockResolvedValue([makeItem({ pending_treatment_count: 3 })]);
    render(<TreatmentWorklistPage />);
    expect(await screen.findByText("미수행 3")).toBeInTheDocument();
  });

  it("미수행 처치가 없으면 빈 상태", async () => {
    mockWorklist.mockResolvedValue([makeItem({ pending_treatment_count: 0 })]);
    render(<TreatmentWorklistPage />);
    await waitFor(() =>
      expect(screen.getByText("수행할 처치가 없습니다.")).toBeInTheDocument(),
    );
  });
});
