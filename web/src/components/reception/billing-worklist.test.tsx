import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BillingWorklist } from "@/components/reception/billing-worklist";

// 수납 워크리스트(Story 7.2 AC6) — fetchBillingWorklist 모킹. 검증: 행 렌더(환자·예상총액)·빈 상태·
// 에러+재시도·상세 링크 href. next/link 는 jsdom <a> 로 모킹.
vi.mock("@/lib/billing/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/payments")>();
  return { ...actual, fetchBillingWorklist: vi.fn() };
});
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { fetchBillingWorklist, type BillingWorklistItem } from "@/lib/billing/payments";

const mockFetch = vi.mocked(fetchBillingWorklist);

function makeItem(over: Partial<BillingWorklistItem> = {}): BillingWorklistItem {
  return {
    encounter_id: "enc-1",
    encounter_no: "12345678",
    patient_name: "김환자",
    chart_no: "C-0001",
    department_name: "내과",
    status: "in_progress",
    consult_started_at: "2026-06-23T01:00:00Z",
    estimated_total_krw: 17610,
    ...over,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("BillingWorklist", () => {
  it("정산 대상 행을 렌더(환자명·예상 총액·상세 링크)", async () => {
    mockFetch.mockResolvedValue({
      data: [makeItem()],
      meta: { page: 1, page_size: 200, total: 1 },
    });
    render(<BillingWorklist />);

    expect(await screen.findByText("김환자")).toBeInTheDocument();
    expect(screen.getByText("C-0001")).toBeInTheDocument();
    expect(screen.getByText("17,610")).toBeInTheDocument(); // formatKrw·tabular-nums
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/reception/billing/enc-1");
  });

  it("정산 대상 0건이면 빈 상태", async () => {
    mockFetch.mockResolvedValue({ data: [], meta: { page: 1, page_size: 200, total: 0 } });
    render(<BillingWorklist />);
    expect(await screen.findByText("정산 대상 내원이 없습니다.")).toBeInTheDocument();
  });

  it("로드 실패 시 에러 + 다시 시도 버튼", async () => {
    mockFetch.mockRejectedValue(new Error("boom"));
    render(<BillingWorklist />);
    await waitFor(() =>
      expect(screen.getByText("수납 대상을 불러오지 못했습니다.")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});
