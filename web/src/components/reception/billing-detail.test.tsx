import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BillingDetail } from "@/components/reception/billing-detail";

// 수납 집계·결제 상세(Story 7.2/7.3/7.4) — build/finalizePayment 모킹. 검증: 진입 시 build 호출(멱등)·헤더·
// "자동 산정" 마커·라인·pay-chip·빈 상태·403·신원 배너·결제수단 토글·신원 재진술 confirm·finalize·완료 패널.
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));
vi.mock("@/lib/billing/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/payments")>();
  return { ...actual, buildPayment: vi.fn(), finalizePayment: vi.fn() };
});
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ApiError } from "@/lib/api/client";
import { buildPayment, finalizePayment, type Payment, type PaymentDetail } from "@/lib/billing/payments";

const mockBuild = vi.mocked(buildPayment);
const mockFinalize = vi.mocked(finalizePayment);

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
    insurance_type: "health_insurance",
    patient_name: "홍길동",
    chart_no: "C-0001",
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

  it("본인부담금·공단부담금 + 보험유형 근거 렌더(7.3)", async () => {
    mockBuild.mockResolvedValue(
      makePayment({
        insurance_type: "health_insurance",
        total_amount_krw: 15790,
        covered_amount_krw: 12590,
        non_covered_amount_krw: 3200,
        copay_amount_krw: 6970,
        insurer_amount_krw: 8820,
      }),
    );
    render(<BillingDetail encounterId="enc-1" />);
    expect(await screen.findByText("6,970")).toBeInTheDocument(); // 본인부담금(환자 청구)
    expect(screen.getByText("8,820")).toBeInTheDocument(); // 공단부담금
    expect(screen.getByText("건강보험")).toBeInTheDocument(); // 보험유형 근거 칩
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

  // ── Story 7.4: 결제·내원 완료 ──────────────────────────────────────────────

  it("상시 신원 배너(이름·차트번호) + 미수납 배지(draft)", async () => {
    mockBuild.mockResolvedValue(makePayment());
    render(<BillingDetail encounterId="enc-1" />);
    expect(await screen.findByText("홍길동")).toBeInTheDocument();
    expect(screen.getByText("차트 C-0001")).toBeInTheDocument();
    expect(screen.getByText("미수납")).toBeInTheDocument();
  });

  it("결제수단 토글 + 신원 재진술 confirm → finalize 성공 시 완료 패널", async () => {
    mockBuild.mockResolvedValue(makePayment({ copay_amount_krw: 5280 }));
    mockFinalize.mockResolvedValue(
      makePayment({
        status: "finalized",
        payment_method: "cash",
        payment_no: "R-20260623-000042",
        copay_amount_krw: 5280,
        paid_amount_krw: 5280,
        finalized_at: "2026-06-23T05:00:00Z",
      }),
    );
    render(<BillingDetail encounterId="enc-1" />);
    // 결제수단 현금 선택.
    await userEvent.click(await screen.findByRole("radio", { name: "현금" }));
    // 결제 버튼 → 신원 재진술 confirm(이름·차트번호 표시).
    await userEvent.click(screen.getByRole("button", { name: "결제·내원 완료" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/홍길동/)).toBeInTheDocument();
    expect(within(dialog).getByText(/C-0001/)).toBeInTheDocument();
    // 확정 → finalize(선택한 현금) 호출.
    await userEvent.click(within(dialog).getByRole("button", { name: "결제·내원 완료" }));
    await waitFor(() => expect(mockFinalize).toHaveBeenCalledWith("enc-1", "cash"));
    // 완료 패널(영수증번호·성공 토스트).
    expect(await screen.findByText("결제 완료")).toBeInTheDocument();
    expect(screen.getByText("R-20260623-000042")).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("finalized 상태 → 완료 패널·결제수단 토글 없음·완료 배지", async () => {
    mockBuild.mockResolvedValue(
      makePayment({
        status: "finalized",
        payment_method: "transfer",
        payment_no: "R-20260623-000001",
        paid_amount_krw: 5280,
        finalized_at: "2026-06-23T05:00:00Z",
      }),
    );
    render(<BillingDetail encounterId="enc-1" />);
    expect(await screen.findByText("결제 완료")).toBeInTheDocument();
    expect(screen.getByText("R-20260623-000001")).toBeInTheDocument();
    expect(screen.getByText("계좌이체")).toBeInTheDocument();
    // "완료" 배지 = 상시 신원 배너 + 완료 패널 양쪽(finalized 상태).
    expect(screen.getAllByText("완료").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("button", { name: "결제·내원 완료" })).not.toBeInTheDocument();
    // 문서 출력 = 다음-액션 placeholder(7.5~7.6 경계·비활성·UX-DR14 "결제 완료 → 문서 출력" 자리).
    const docBtn = screen.getByRole("button", { name: /문서 출력/ });
    expect(docBtn).toBeInTheDocument();
    expect(docBtn).toBeDisabled();
  });

  it("finalize 실패(주상병 미지정 422) → 에러 토스트", async () => {
    mockBuild.mockResolvedValue(makePayment());
    mockFinalize.mockRejectedValue(
      new ApiError("primary_diagnosis_required", "주상병을 1개 지정해야 합니다.", 422),
    );
    render(<BillingDetail encounterId="enc-1" />);
    await userEvent.click(await screen.findByRole("button", { name: "결제·내원 완료" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "결제·내원 완료" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
