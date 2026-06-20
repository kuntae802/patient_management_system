import { describe, expect, it } from "vitest";

import { landingPathForRole, PATIENT_HOME, STAFF_HOME } from "./branch";

describe("landingPathForRole", () => {
  it("직원(role non-null) → staff 영역", () => {
    expect(landingPathForRole("admin")).toBe(STAFF_HOME);
    expect(landingPathForRole("doctor")).toBe(STAFF_HOME);
  });

  it("비직원(null/undefined) → patient 영역", () => {
    expect(landingPathForRole(null)).toBe(PATIENT_HOME);
    expect(landingPathForRole(undefined)).toBe(PATIENT_HOME);
  });
});
