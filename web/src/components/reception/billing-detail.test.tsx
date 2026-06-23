import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BillingDetail } from "@/components/reception/billing-detail";

// 수납 집계 상세(Story 7.2 AC7) — buildPayment 모킹. 검증: 진입 시 build 호출(멱등)·헤더 총/급여/비급여·
// "자동 산정" 마커·라인 code·금액·pay-chip·빈 상태·403 권한 에러. next/link 는 jsdom <a> 로 모킹.
vi.mock("@/lib/billing/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/payments")>();
  return { ...actual, buildPayment: vi.fn() };
});
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ApiError } from "@/lib/api/client";
import { buildPayment, type Payment, type PaymentDetail } from "@/lib/billing/payments";

const mockBuild = vi.mocked(buildPayment);

function makeLine(over: Partial<PaymentDetail> = {}): PaymentDetail {
  return {
    id: "pd-1",
    payment_id: "pay-1",
    fee_item_id: "fi-1",
    fee_schedule_id: "fs-1",
    code: "AA154",
    name: "초진진찰료",
    category: "진찰료",
    quantity: 1,
    unit_amount_krw: 17610,
    amount_krw: 17610,
    coverage_type: "covered",
    copay_rate: null,
    copay_amount_krw: 0,
    insurer_amount_krw: 0,
    created_at: "2026-06-23T01:00:00Z",
    updated_at: "2026-06-23T01:00:00Z",
    ...over,
  };
}

function makePayment(over: Partial<Payment> = {}): Payment {
  return {
    id: "pay-1",
    encounter_id: "enc-1",
    status: "draft",
    billing_type: "postpaid",
    total_amount_krw: 17610,
    covered_amount_krw: 17610,
    non_covered_amount_krw: 0,
    copay_amount_krw: 0,
    insurer_amount_krw: 0,
    paid_amount_krw: 0,
    payment_method: null,
    payment_no: null,
    finalized_at: null,
    finalized_by: null,
    cancelled_at: null,
    cancel_reason: null,
    created_at: "2026-06-23T01:00:00Z",
    updated_at: "2026-06-23T01:00:00Z",
    details: [makeLine()],
    ...over,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("BillingDetail", () => {
  it("진입 시 build_payment 멱등 호출 + 헤더 총/급여/비급여 + 자동 산정 마커", async () => {
    mockBuild.mockResolvedValue(
      makePayment({ total_amount_krw: 20810, covered_amount_krw: 17610, non_covered_amount_krw: 3200 }),
    );
    render(<BillingDetail encounterId="enc-1" />);

    await waitFor(() => expect(mockBuild).toHaveBeenCalledWith("enc-1"));
    expect(await screen.findByText("자동 산정")).toBeInTheDocument(); // UX-DR14 teal 마커
    expect(screen.getByText("20,810")).toBeInTheDocument(); // 총 진료비
    expect(screen.getByText("3,200")).toBeInTheDocument(); // 비급여
  });

  it("상세 라인 — code·행위명·금액·pay-chip(급여) 렌더", async () => {
    mockBuild.mockResolvedValue(makePayment());
    render(<BillingDetail encounterId="enc-1" />);
    expect(await screen.findByText("AA154")).toBeInTheDocument();
    expect(screen.getByText("초진진찰료")).toBeInTheDocument();
    // "급여" = 헤더 금액 라벨 + 라인 PayChip(coverageLabel) 둘 다 렌더(covered 라인).
    expect(screen.getAllByText("급여").length).toBeGreaterThanOrEqual(2);
  });

  it("집계 라인 0건이면 빈 상태", async () => {
    mockBuild.mockResolvedValue(makePayment({ details: [], total_amount_krw: 0, covered_amount_krw: 0 }));
    render(<BillingDetail encounterId="enc-1" />);
    expect(
      await screen.findByText(/집계된 수가 항목이 없습니다/),
    ).toBeInTheDocument();
  });

  it("권한(403) 에러 시 '수납 권한이 없습니다' 표시", async () => {
    mockBuild.mockRejectedValue(new ApiError("forbidden", "권한이 없습니다.", 403));
    render(<BillingDetail encounterId="enc-1" />);
    expect(await screen.findByText("수납 권한이 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});
