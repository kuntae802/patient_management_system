import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReceiptDetail } from "@/components/portal/receipt-detail";
import { ApiError } from "@/lib/api/client";
import type { PaymentDetail, Receipt } from "@/lib/billing/payments";

// 영수증 상세(Story 8.3·FR-122·UX-DR23) — ReceiptDetail 검증: 화면=친화 요약(총 진료비·건강보험 부담·
// 내가 낸 금액·항목 대분류·결제수단), 인쇄=7.5 법정 서식(ReceiptDocument·hidden print:block) 재사용·
// window.print, document.title PII 부재(불투명 chart_no), 404 폴백. fetchSelfReceipt 만 모킹(집계 실제).

vi.mock("@/lib/patient/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/patient/payments")>();
  return { ...actual, fetchSelfReceipt: vi.fn() };
});
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { fetchSelfReceipt } from "@/lib/patient/payments";

const mockFetchReceipt = vi.mocked(fetchSelfReceipt);

function line(over: Partial<PaymentDetail> = {}): PaymentDetail {
  return {
    id: `pd-${Math.random()}`,
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
    copay_rate: 0.3,
    copay_amount_krw: 5280,
    insurer_amount_krw: 12330,
    created_at: "2026-06-19T01:00:00Z",
    updated_at: "2026-06-19T01:00:00Z",
    ...over,
  };
}

function makeReceipt(over: Partial<Receipt> = {}): Receipt {
  return {
    clinic: {
      name: "○○의원",
      biz_no: "123-45-67890",
      hira_no: "31234567",
      address: "서울특별시 ○○구 ○○로 123",
      ceo_name: "박○○",
      phone: "02-123-4567",
    },
    patient: {
      name: "이수진",
      chart_no: "C-0001",
      resident_no_masked: "900101-2******",
      insurance_type: "health_insurance",
    },
    encounter: {
      department_name: "내과",
      doctor_name: "이정훈",
      treatment_started_on: "2026-06-19",
      treatment_ended_on: "2026-06-19",
    },
    status: "finalized",
    payment_no: "R-20260619-000042",
    payment_method: "card",
    finalized_at: "2026-06-19T05:00:00Z",
    issued_by_name: "김원무",
    total_amount_krw: 20610,
    covered_amount_krw: 20610,
    non_covered_amount_krw: 0,
    copay_amount_krw: 6280,
    insurer_amount_krw: 14330,
    paid_amount_krw: 6280,
    due_amount_krw: 0,
    details: [
      line(),
      line({ code: "C3800", name: "CBC", category: "검사료", amount_krw: 3000, copay_amount_krw: 1000, insurer_amount_krw: 2000 }),
    ],
    ...over,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  document.title = "";
});

describe("ReceiptDetail", () => {
  it("친화 요약: 총 진료비·건강보험 부담·내가 낸 금액·항목 대분류·결제수단", async () => {
    mockFetchReceipt.mockResolvedValue(makeReceipt());

    render(<ReceiptDetail encounterId="enc-1" />);

    expect(await screen.findByText("진료비 영수증")).toBeInTheDocument();
    // 항목 대분류(category 집계) — 친화 요약 + 인쇄용 법정 서식 양쪽에 등장(≥1).
    expect(screen.getAllByText("진찰료").length).toBeGreaterThan(0);
    expect(screen.getAllByText("검사료").length).toBeGreaterThan(0);
    // 합계 3종 — 친화 요약 전용 라벨(법정 서식은 "본인부담 총액" 등 다른 라벨).
    expect(screen.getByText("총 진료비")).toBeInTheDocument();
    expect(screen.getByText("건강보험에서 낸 금액")).toBeInTheDocument();
    expect(screen.getByText("내가 낸 금액")).toBeInTheDocument();
    expect(screen.getAllByText(/6,280원/).length).toBeGreaterThan(0); // 내가 낸 금액
    expect(screen.getByText(/카드 결제/)).toBeInTheDocument();
  });

  it("법정 서식(ReceiptDocument) 인쇄 재사용 — hidden print:block + window.print", async () => {
    const user = userEvent.setup();
    mockFetchReceipt.mockResolvedValue(makeReceipt());
    window.print = vi.fn();

    render(<ReceiptDetail encounterId="enc-1" />);

    // 7.5 법정 서식이 DOM 에 존재(인쇄 전용 영문 부제 — 친화 요약엔 없음).
    expect(await screen.findByText("MEDICAL FEE STATEMENT & RECEIPT")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /영수증 인쇄·저장/ }));
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it("인쇄 파일명 PII 금지 — document.title=불투명 chart_no(이름 미포함)", async () => {
    mockFetchReceipt.mockResolvedValue(makeReceipt());

    render(<ReceiptDetail encounterId="enc-1" />);

    await screen.findByText("진료비 영수증");
    expect(document.title).toBe("영수증_C-0001");
    expect(document.title).not.toContain("이수진");
  });

  it("비소유/비-finalized(404): 영수증 찾을 수 없음 폴백", async () => {
    mockFetchReceipt.mockRejectedValue(new ApiError("receipt_not_found", "영수증을 찾을 수 없습니다.", 404));

    render(<ReceiptDetail encounterId="enc-x" />);

    expect(await screen.findByText("영수증을 찾을 수 없어요.")).toBeInTheDocument();
    expect(screen.queryByText("진료비 영수증")).not.toBeInTheDocument();
  });
});
