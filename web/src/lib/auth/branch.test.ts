import { describe, expect, it } from "vitest";

import { isStaffRole, landingPathForRole, PATIENT_HOME } from "./branch";

describe("landingPathForRole", () => {
  it("직원 역할 → 역할별 홈", () => {
    expect(landingPathForRole("admin")).toBe("/admin/dashboard");
    expect(landingPathForRole("doctor")).toBe("/doctor/waiting");
    expect(landingPathForRole("reception")).toBe("/reception/waiting");
    expect(landingPathForRole("nurse")).toBe("/nurse/worklist");
    expect(landingPathForRole("radiologist")).toBe("/radiology/worklist");
  });

  it("비직원(null/undefined) → patient 영역", () => {
    expect(landingPathForRole(null)).toBe(PATIENT_HOME);
    expect(landingPathForRole(undefined)).toBe(PATIENT_HOME);
  });

  it("'patient' 역할은 직원이 아님 → patient 영역(오분류 방지)", () => {
    expect(landingPathForRole("patient")).toBe(PATIENT_HOME);
  });

  it("알 수 없는 역할 → patient 영역", () => {
    expect(landingPathForRole("ghost")).toBe(PATIENT_HOME);
  });
});

describe("isStaffRole", () => {
  it("5개 직원 역할만 true", () => {
    for (const r of ["reception", "doctor", "nurse", "radiologist", "admin"]) {
      expect(isStaffRole(r)).toBe(true);
    }
    expect(isStaffRole("patient")).toBe(false);
    expect(isStaffRole(null)).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });
});
