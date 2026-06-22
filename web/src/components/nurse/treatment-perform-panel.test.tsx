import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TreatmentPerformPanel } from "@/components/nurse/treatment-perform-panel";
import { ApiError } from "@/lib/api/client";
import type { TreatmentOrder } from "@/lib/encounters/treatment-orders";

// 처치 수행 패널(Story 5.7 AC1·AC2) — fetchTreatmentOrders·performTreatmentOrder·sonner 모킹.
// 검증: ordered=수행 폼·performed=잠금(버튼 없음)·수행 호출+onPerformed·busy disable·409 우아 처리.
vi.mock("@/lib/encounters/treatment-orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/encounters/treatment-orders")>();
  return { ...actual, fetchTreatmentOrders: vi.fn(), performTreatmentOrder: vi.fn() };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import {
  fetchTreatmentOrders,
  performTreatmentOrder,
} from "@/lib/encounters/treatment-orders";

const mockFetch = vi.mocked(fetchTreatmentOrders);
const mockPerform = vi.mocked(performTreatmentOrder);

afterEach(() => vi.clearAllMocks());

function makeOrder(over: Partial<TreatmentOrder> = {}): TreatmentOrder {
  return {
    id: "tr1",
    encounter_id: "e1",
    fee_schedule_id: "fs1",
    fee_code: "M0030",
    fee_name: "단순처치(드레싱)",
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

function renderPanel() {
  const onPerformed = vi.fn();
  render(<TreatmentPerformPanel encounterId="e1" onPerformed={onPerformed} />);
  return { onPerformed };
}

describe("TreatmentPerformPanel", () => {
  it("ordered 오더는 수행 버튼을 보여준다", async () => {
    mockFetch.mockResolvedValue([makeOrder()]);
    renderPanel();
    expect(await screen.findByText("단순처치(드레싱)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "수행" })).toBeInTheDocument();
  });

  it("performed 오더는 잠금 표시(수행 버튼 없음)", async () => {
    mockFetch.mockResolvedValue([
      makeOrder({
        status: "performed",
        performed_by: "n1",
        performed_by_name: "이간호",
        performed_at: "2026-06-22T01:00:00Z",
      }),
    ]);
    renderPanel();
    expect(await screen.findByText("수행 완료")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "수행" })).not.toBeInTheDocument();
    expect(screen.getByText(/이간호/)).toBeInTheDocument();
  });

  it("수행 버튼 클릭 → performTreatmentOrder 호출 + onPerformed", async () => {
    mockFetch.mockResolvedValue([makeOrder()]);
    mockPerform.mockResolvedValue(makeOrder({ status: "performed" }));
    const { onPerformed } = renderPanel();
    const btn = await screen.findByRole("button", { name: "수행" });
    fireEvent.click(btn);
    await waitFor(() => expect(mockPerform).toHaveBeenCalledWith("e1", "tr1", { content: null }));
    await waitFor(() => expect(onPerformed).toHaveBeenCalled());
  });

  it("처치기록 내용 입력 시 content 로 전달", async () => {
    mockFetch.mockResolvedValue([makeOrder()]);
    mockPerform.mockResolvedValue(makeOrder({ status: "performed" }));
    renderPanel();
    const textarea = await screen.findByLabelText("처치기록 내용(선택)");
    fireEvent.change(textarea, { target: { value: "드레싱 교환" } });
    fireEvent.click(screen.getByRole("button", { name: "수행" }));
    await waitFor(() =>
      expect(mockPerform).toHaveBeenCalledWith("e1", "tr1", { content: "드레싱 교환" }),
    );
  });

  it("409 invalid_transition(재수행) → onPerformed 로 재로드", async () => {
    mockFetch.mockResolvedValue([makeOrder()]);
    mockPerform.mockRejectedValue(
      new ApiError("invalid_transition", "잘못된 상태 전이입니다.", 409),
    );
    const { onPerformed } = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "수행" }));
    await waitFor(() => expect(onPerformed).toHaveBeenCalled());
  });

  it("빈 목록은 안내 문구", async () => {
    mockFetch.mockResolvedValue([]);
    renderPanel();
    expect(await screen.findByText("지시된 처치 오더가 없습니다.")).toBeInTheDocument();
  });
});
