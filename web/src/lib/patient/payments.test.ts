import { describe, expect, it } from "vitest";

import type { PaymentDetail } from "@/lib/billing/payments";
import { aggregateAmountByCategory } from "@/lib/patient/payments";

// 환자 친화 영수증 요약의 대분류 금액 집계(Story 8.3) — 표시 그룹핑(pricing 아님). 적재 순서 보존·
// null/빈 category → "기타"·금액(amount_krw) 합산.

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

describe("aggregateAmountByCategory", () => {
  it("대분류별 amount_krw 합산 + 적재 순서 보존(진찰료 먼저)", () => {
    const rows = aggregateAmountByCategory([
      line({ category: "진찰료", amount_krw: 17610 }),
      line({ category: "검사료", amount_krw: 3000 }),
      line({ category: "검사료", amount_krw: 2000 }),
    ]);
    expect(rows).toEqual([
      { category: "진찰료", amount: 17610 },
      { category: "검사료", amount: 5000 },
    ]);
  });

  it("category null/빈값 → '기타' 로 묶음", () => {
    const rows = aggregateAmountByCategory([
      line({ category: null, amount_krw: 1000 }),
      line({ category: "  ", amount_krw: 500 }),
    ]);
    expect(rows).toEqual([{ category: "기타", amount: 1500 }]);
  });

  it("빈 라인 → 빈 배열", () => {
    expect(aggregateAmountByCategory([])).toEqual([]);
  });
});
