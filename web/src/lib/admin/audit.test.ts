import { describe, expect, it } from "vitest";

import { maskSnapshotValue } from "@/lib/admin/audit";

const MASK = "●●●● (마스킹됨)";

describe("maskSnapshotValue", () => {
  it("최상위 민감 키는 마스킹", () => {
    expect(maskSnapshotValue("resident_no", "710314-2000000")).toEqual({
      masked: true,
      display: MASK,
    });
    expect(maskSnapshotValue("phone", "010-1234-5678").masked).toBe(true);
    expect(maskSnapshotValue("password_hash", "x").masked).toBe(true);
  });

  it("비민감 스칼라는 그대로 표시", () => {
    expect(maskSnapshotValue("name", "김간호")).toEqual({ masked: false, display: "김간호" });
    expect(maskSnapshotValue("employment_status", "active").display).toBe("active");
  });

  it("null/undefined 는 — 로 표시(비민감 키)", () => {
    expect(maskSnapshotValue("hire_date", null).display).toBe("—");
    expect(maskSnapshotValue("note", undefined).display).toBe("—");
  });

  it("비민감 키의 중첩 객체 내부 민감 키도 재귀 마스킹(평문 덤프 차단)", () => {
    // 컨테이너 키(record/details)·display_name 은 비민감, 안쪽 phone 만 민감 → 2단계 재귀 마스킹.
    const value = { details: { display_name: "공개", phone: "010-9999-8888" } };
    const { masked, display } = maskSnapshotValue("record", value);
    expect(masked).toBe(false); // 컨테이너 자체는 비민감
    expect(display).not.toContain("010-9999-8888"); // 내부 phone 평문 노출 안 됨
    expect(display).toContain(MASK);
    expect(display).toContain("공개"); // 비민감 내부 값은 보존
  });

  it("배열 원소 내부의 민감 키도 마스킹", () => {
    const value = [{ ssn: "111-11" }, { label: "공개" }];
    const { display } = maskSnapshotValue("items", value);
    expect(display).not.toContain("111-11");
    expect(display).toContain(MASK);
    expect(display).toContain("공개");
  });
});
