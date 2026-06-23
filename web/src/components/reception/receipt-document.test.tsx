import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReceiptDocument } from "@/components/reception/receipt-document";
import type { PaymentDetail, Receipt } from "@/lib/billing/payments";

// 진료비 계산서·영수증 법정 서식(Story 7.5 / FR-113). 항목별 금액표 category 집계(급여 본인/공단·비급여·
// 합계)·소계=헤더 금액 정합·납부 3행·masked RRN(full 부재)·요양기관/발급담당 렌더.

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
    created_at: "2026-06-23T01:00:00Z",
    updated_at: "2026-06-23T01:00:00Z",
    ...over,
  };
}

// 3 대분류: 진찰료(급여 5280/12330)·검사료(급여 1000/2000)·처치료(비급여 3000 전액 본인).
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
      name: "홍길동",
      chart_no: "C-0001",
      resident_no_masked: "900101-1******",
      insurance_type: "health_insurance",
    },
    encounter: {
      department_name: "내과",
      doctor_name: "이정훈",
      treatment_started_on: "2026-06-23",
      treatment_ended_on: "2026-06-23",
    },
    status: "finalized",
    payment_no: "R-20260623-000042",
    payment_method: "card",
    finalized_at: "2026-06-23T05:00:00Z",
    issued_by_name: "김원무",
    total_amount_krw: 23610,
    covered_amount_krw: 20610,
    non_covered_amount_krw: 3000,
    copay_amount_krw: 9280, // 급여 본인 6280 + 비급여 3000
    insurer_amount_krw: 14330,
    paid_amount_krw: 9280,
    due_amount_krw: 0,
    details: [
      line(),
      line({ code: "C3800", name: "CBC", category: "검사료", amount_krw: 3000, copay_amount_krw: 1000, insurer_amount_krw: 2000 }),
      line({
        code: "X9999",
        name: "비급여처치",
        category: "처치료",
        coverage_type: "non_covered",
        amount_krw: 3000,
        copay_amount_krw: 3000,
        insurer_amount_krw: 0,
      }),
    ],
    ...over,
  };
}

describe("ReceiptDocument", () => {
  it("문서 제목·요양기관·환자·진료 헤더 렌더", () => {
    render(<ReceiptDocument data={makeReceipt()} />);
    expect(screen.getByText("진료비 계산서 · 영수증")).toBeInTheDocument();
    expect(screen.getAllByText("○○의원").length).toBeGreaterThanOrEqual(1); // 헤더 + 서명
    expect(screen.getByText("31234567")).toBeInTheDocument(); // 요양기관기호
    expect(screen.getByText("R-20260623-000042", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("내과 · 이정훈")).toBeInTheDocument();
    expect(screen.getByText("김원무")).toBeInTheDocument(); // 발급담당
  });

  it("주민번호는 masked 만(full RRN 부재·PII 경계)", () => {
    render(<ReceiptDocument data={makeReceipt()} />);
    expect(screen.getByText("900101-1******")).toBeInTheDocument();
    // raw 주민번호(6-7 자리) 미렌더.
    expect(screen.queryByText(/\d{6}-\d{7}/)).toBeNull();
  });

  it("항목별 금액표 — 대분류 집계(급여 본인/공단·비급여)", () => {
    render(<ReceiptDocument data={makeReceipt()} />);
    expect(screen.getByText("진찰료")).toBeInTheDocument();
    expect(screen.getByText("검사료")).toBeInTheDocument();
    expect(screen.getByText("처치료")).toBeInTheDocument();
    // 진찰료 급여 본인부담금 5,280 · 공단부담금 12,330(각 1회 — 고유값).
    expect(screen.getByText("5,280")).toBeInTheDocument();
    expect(screen.getByText("12,330")).toBeInTheDocument();
  });

  it("소계 = 헤더 금액 정합(공단부담 합·총액)", () => {
    render(<ReceiptDocument data={makeReceipt()} />);
    // 소계 공단부담 = insurer_amount_krw(14,330) · 총액 = total_amount_krw(23,610).
    expect(screen.getByText("14,330")).toBeInTheDocument();
    expect(screen.getAllByText("23,610").length).toBeGreaterThanOrEqual(1);
  });

  it("납부 3행(본인부담총액·기납부·납부할금액) + 본인부담 총액", () => {
    render(<ReceiptDocument data={makeReceipt()} />);
    expect(screen.getByText("본인부담 총액")).toBeInTheDocument();
    expect(screen.getByText("이미 납부한 금액")).toBeInTheDocument();
    expect(screen.getByText("납부할 금액")).toBeInTheDocument();
    // 본인부담 총액 = 9,280(copay) · 납부할 금액 = 0(전액 정산).
    expect(screen.getAllByText("9,280").length).toBeGreaterThanOrEqual(1);
  });

  it("결제수단 한글 라벨 + 법적 고지", () => {
    render(<ReceiptDocument data={makeReceipt({ payment_method: "transfer" })} />);
    expect(screen.getByText("계좌이체")).toBeInTheDocument();
    expect(screen.getByText(/국민건강보험법 시행규칙/)).toBeInTheDocument();
  });
});
