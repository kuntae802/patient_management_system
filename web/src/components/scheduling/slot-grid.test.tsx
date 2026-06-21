import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SlotGrid } from "@/components/scheduling/slot-grid";
import type { Slot } from "@/lib/scheduling/slots";

function slot(start: string, status: Slot["status"]): Slot {
  return { start, end: start, status };
}

describe("SlotGrid", () => {
  it("빈 슬롯 → 명시 빈-상태 메시지", () => {
    render(<SlotGrid slots={[]} />);
    expect(screen.getByText("이 날짜에 가능한 슬롯이 없습니다.")).toBeInTheDocument();
  });

  it("4상태 라벨 + KST 시각 렌더, 비활성 3개 aria-disabled", () => {
    const slots = [
      slot("2030-06-03T00:00:00Z", "available"),
      slot("2030-06-03T00:30:00Z", "booked"),
      slot("2030-06-03T01:00:00Z", "time_off"),
      slot("2030-06-03T01:30:00Z", "past"),
    ];
    render(<SlotGrid slots={slots} />);

    expect(screen.getByText("예약 가능")).toBeInTheDocument();
    expect(screen.getByText("마감")).toBeInTheDocument();
    expect(screen.getByText("휴진")).toBeInTheDocument();
    expect(screen.getByText("지남")).toBeInTheDocument();
    // 00:00 UTC = 09:00 KST.
    expect(screen.getByText("09:00")).toBeInTheDocument();

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);
    // 비활성 = available 이 아닌 3개(booked·time_off·past). data-status 로 인코딩.
    const nonAvailable = items.filter((li) => li.getAttribute("data-status") !== "available");
    expect(nonAvailable).toHaveLength(3);
  });
});
