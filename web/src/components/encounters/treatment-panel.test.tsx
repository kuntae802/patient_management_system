import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TreatmentPanel } from "@/components/encounters/treatment-panel";
import type { TreatmentOrder } from "@/lib/encounters/treatment-orders";
import type { Encounter } from "@/lib/reception/encounters";

// 처치 패널(Story 5.4·5.5, controlled) — createTreatmentOrder·MasterSearchPicker(스텁)·sonner 모킹.
// 데이터·reload 는 order-panel 소유(prop 주입). 검증: 빈 상태·행위 선택→create+onReload·목록(pay-chip)·지연 배지.
vi.mock("@/lib/encounters/treatment-orders", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/encounters/treatment-orders")>();
  return { ...actual, createTreatmentOrder: vi.fn() };
});
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

import { createTreatmentOrder } from "@/lib/encounters/treatment-orders";

const mockCreate = vi.mocked(createTreatmentOrder);

afterEach(() => vi.clearAllMocks());

const ENC = { id: "e1" } as Encounter;
const NOW = Date.parse("2026-06-22T00:00:00Z");

function makeTreatment(over: Partial<TreatmentOrder> = {}): TreatmentOrder {
  return {
    id: "tr1",
    encounter_id: "e1",
    fee_schedule_id: "fs1",
    fee_code: "M0030",
    fee_name: "단순처치(드레싱, 100㎠ 미만)",
    fee_category: "처치료",
    amount_krw: 4500,
    coverage_type: "covered",
    status: "ordered",
    ordered_by: "d1",
    ordered_by_name: "김의사",
    ordered_at: "2026-06-22T00:00:00Z",
    performed_by: null,
    performed_by_name: null,
    performed_at: null,
    is_active: true,
    created_at: "2026-06-22T00:00:00Z",
    updated_at: "2026-06-22T00:00:00Z",
    ...over,
  };
}

function renderPanel(treatments: TreatmentOrder[] | null, nowMs = NOW) {
  const onReload = vi.fn().mockResolvedValue(undefined);
  render(
    <TreatmentPanel
      encounter={ENC}
      today="2026-06-22"
      treatments={treatments}
      nowMs={nowMs}
      onReload={onReload}
    />,
  );
  return { onReload };
}

function pickFee(id: string) {
  fireEvent.change(screen.getByTestId("treatment-picker"), {
    target: { value: id },
  });
}

describe("TreatmentPanel (controlled)", () => {
  it("오더된 처치가 없으면 빈 상태를 표시한다", () => {
    renderPanel([]);
    expect(screen.getByText("오더된 처치 없음")).toBeInTheDocument();
  });

  it("로딩(null)이면 스켈레톤을 표시한다", () => {
    renderPanel(null);
    expect(screen.getByLabelText("처치 불러오는 중")).toBeInTheDocument();
  });

  it("행위 선택 시 createTreatmentOrder 호출 후 onReload 한다", async () => {
    mockCreate.mockResolvedValue(makeTreatment());
    const { onReload } = renderPanel([]);
    pickFee("M0030");
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith("e1", { fee_schedule_id: "M0030" });
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
  });

  it("오더된 처치 목록을 렌더한다(행위·pay-chip 비급여)", () => {
    renderPanel([makeTreatment({ coverage_type: "non_covered" })]);
    expect(screen.getByText("M0030")).toBeInTheDocument();
    expect(
      screen.getByText("단순처치(드레싱, 100㎠ 미만)"),
    ).toBeInTheDocument();
    expect(screen.getByText("비급여")).toBeInTheDocument(); // pay-chip
    expect(screen.getByText("김의사")).toBeInTheDocument(); // 추적 라인 지시자
  });

  it("지시 후 임계치 초과 미수행이면 지연 배지를 표시한다(누락 0 디텍터)", () => {
    // ordered_at 으로부터 40분 경과(임계 30분 초과).
    const later = NOW + 40 * 60_000;
    renderPanel([makeTreatment()], later);
    expect(screen.getByText(/지연 40분/)).toBeInTheDocument();
  });
});
