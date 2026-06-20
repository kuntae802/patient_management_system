import { describe, expect, it } from "vitest";

import {
  codeStatus,
  departmentLabel,
  formatKrw,
  isCurrentlyValid,
  todayISO,
  type Department,
} from "@/lib/admin/masters";

function dept(over: Partial<Department>): Department {
  return {
    id: "d1",
    code: "ORTHO",
    name: "정형외과",
    description: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

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

describe("departmentLabel (Story 2.4 / AC5)", () => {
  const depts = [
    dept({ id: "a", name: "내과", is_active: true }),
    dept({ id: "b", name: "정형외과", is_active: false }),
  ];

  it("미지정(null)은 —", () => {
    expect(departmentLabel(depts, null)).toBe("—");
  });

  it("활성 소속은 이름만", () => {
    expect(departmentLabel(depts, "a")).toBe("내과");
  });

  it("비활성 소속은 이름 + (비활성) 마커", () => {
    expect(departmentLabel(depts, "b")).toBe("정형외과 (비활성)");
  });

  it("미매칭은 (미상) 폴백(오해성 '삭제된 진료과' 대신)", () => {
    expect(departmentLabel(depts, "zzz")).toBe("(미상)");
  });
});
