import { describe, expect, it } from "vitest";

import { codeStatus, formatKrw, isCurrentlyValid, todayISO } from "@/lib/admin/masters";

const TODAY = "2026-06-20";

function row(over: Partial<{ is_active: boolean; effective_from: string; effective_to: string | null }>) {
  return { is_active: true, effective_from: "2026-01-01", effective_to: null, ...over };
}

describe("codeStatus", () => {
  it("비활성은 다른 조건과 무관하게 inactive", () => {
    expect(codeStatus(row({ is_active: false }), TODAY)).toBe("inactive");
    expect(codeStatus(row({ is_active: false, effective_from: "2999-01-01" }), TODAY)).toBe(
      "inactive",
    );
  });

  it("발효일이 미래면 pending", () => {
    expect(codeStatus(row({ effective_from: "2026-07-01" }), TODAY)).toBe("pending");
  });

  it("만료일이 과거면 expired", () => {
    expect(codeStatus(row({ effective_to: "2026-06-19" }), TODAY)).toBe("expired");
  });

  it("유효기간 내면 valid", () => {
    expect(codeStatus(row({ effective_to: "2026-12-31" }), TODAY)).toBe("valid");
    expect(codeStatus(row({ effective_to: null }), TODAY)).toBe("valid");
  });

  it("경계: 발효일==오늘 → valid, 만료일==오늘 → valid", () => {
    expect(codeStatus(row({ effective_from: TODAY }), TODAY)).toBe("valid");
    expect(codeStatus(row({ effective_to: TODAY }), TODAY)).toBe("valid");
  });
});

describe("isCurrentlyValid", () => {
  it("valid 만 true", () => {
    expect(isCurrentlyValid(row({}), TODAY)).toBe(true);
    expect(isCurrentlyValid(row({ is_active: false }), TODAY)).toBe(false);
    expect(isCurrentlyValid(row({ effective_from: "2999-01-01" }), TODAY)).toBe(false);
    expect(isCurrentlyValid(row({ effective_to: "2020-01-01" }), TODAY)).toBe(false);
  });

  it("경계 포함(발효일==오늘, 만료일==오늘)", () => {
    expect(isCurrentlyValid(row({ effective_from: TODAY }), TODAY)).toBe(true);
    expect(isCurrentlyValid(row({ effective_to: TODAY }), TODAY)).toBe(true);
  });
});

describe("todayISO / formatKrw", () => {
  it("todayISO 는 주입한 날짜를 로컬 YYYY-MM-DD 로 변환", () => {
    expect(todayISO(new Date(2026, 5, 20))).toBe("2026-06-20"); // month 0-index: 5=June
    expect(todayISO(new Date(2026, 0, 3))).toBe("2026-01-03");
  });

  it("formatKrw 는 천단위 구분", () => {
    expect(formatKrw(12000)).toBe("12,000");
    expect(formatKrw(0)).toBe("0");
  });
});
