import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TreatmentPanel } from "@/components/encounters/treatment-panel";
import type { TreatmentOrder } from "@/lib/encounters/treatment-orders";
import type { Encounter } from "@/lib/reception/encounters";

// 처치 패널(Story 5.4) — treatment-orders lib·MasterSearchPicker(스텁)·sonner 모킹.
// 검증: 빈 상태·행위 선택→createTreatmentOrder({fee_schedule_id})→reload·목록 렌더·로드 실패+다시 시도.
vi.mock("@/lib/encounters/treatment-orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/encounters/treatment-orders")>();
  return { ...actual, fetchTreatmentOrders: vi.fn(), createTreatmentOrder: vi.fn() };
});
// MasterSearchPicker 는 Supabase 직접조회 → 스텁. onChange 값 = fee_schedule_id.
vi.mock("@/components/ui/master-search-picker", () => ({
  MasterSearchPicker: ({
    id,
    disabled,
    onValueChange,
  }: {
    id?: string;
    disabled?: boolean;
    onValueChange: (v: unknown) => void;
  }) => (
    <input
      id={id}
      data-testid="treatment-picker"
      disabled={disabled}
      onChange={(e) =>
        onValueChange({
          id: e.target.value,
          code: `F-${e.target.value}`,
          name: `행위-${e.target.value}`,
          kind: "fee_schedule",
          is_active: true,
          effective_from: "2020-01-01",
          effective_to: null,
          category: "처치료",
          amount_krw: 4500,
        })
      }
    />
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { createTreatmentOrder, fetchTreatmentOrders } from "@/lib/encounters/treatment-orders";

const mockFetch = vi.mocked(fetchTreatmentOrders);
const mockCreate = vi.mocked(createTreatmentOrder);

afterEach(() => vi.clearAllMocks());

const ENC = { id: "e1" } as Encounter;

function renderPanel() {
  return render(<TreatmentPanel encounter={ENC} today="2026-06-22" />);
}

function pickFee(id: string) {
  fireEvent.change(screen.getByTestId("treatment-picker"), { target: { value: id } });
}

function makeTreatment(over: Partial<TreatmentOrder> = {}): TreatmentOrder {
  return {
    id: "tr1",
    encounter_id: "e1",
    fee_schedule_id: "fs1",
    fee_code: "M0030",
    fee_name: "단순처치(드레싱, 100㎠ 미만)",
    fee_category: "처치료",
    amount_krw: 4500,
    status: "ordered",
    ordered_by: "d1",
    ordered_at: "2026-06-22T00:00:00Z",
    performed_by: null,
    performed_at: null,
    is_active: true,
    created_at: "2026-06-22T00:00:00Z",
    updated_at: "2026-06-22T00:00:00Z",
    ...over,
  };
}

describe("TreatmentPanel", () => {
  it("오더된 처치가 없으면 빈 상태를 표시한다", async () => {
    mockFetch.mockResolvedValue([]);
    renderPanel();
    expect(await screen.findByText("오더된 처치 없음")).toBeInTheDocument();
  });

  it("행위 선택 시 fee_schedule_id 로 createTreatmentOrder 를 호출하고 재조회한다", async () => {
    mockFetch.mockResolvedValue([]);
    mockCreate.mockResolvedValue(makeTreatment());
    renderPanel();
    await screen.findByText("오더된 처치 없음");
    pickFee("M0030");
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith("e1", { fee_schedule_id: "M0030" });
    expect(mockFetch).toHaveBeenCalledTimes(2); // 초기 로드 + 오더 후 reload
  });

  it("오더된 처치 목록을 렌더한다(행위 코드·명칭)", async () => {
    mockFetch.mockResolvedValue([makeTreatment()]);
    renderPanel();
    expect(await screen.findByText("M0030")).toBeInTheDocument();
    expect(screen.getByText("단순처치(드레싱, 100㎠ 미만)")).toBeInTheDocument();
  });

  it("로드 실패 시 인라인 에러와 다시 시도를 표시하고 재시도로 복구한다", async () => {
    mockFetch.mockRejectedValueOnce(new Error("boom"));
    renderPanel();
    expect(await screen.findByText("처치 오더를 불러오지 못했습니다.")).toBeInTheDocument();
    mockFetch.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("오더된 처치 없음")).toBeInTheDocument();
  });
});
