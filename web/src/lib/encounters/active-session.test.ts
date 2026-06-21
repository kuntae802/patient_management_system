import { afterEach, describe, expect, it } from "vitest";

import {
  ACTIVE_ENCOUNTER_KEY,
  claimActiveEncounter,
  clearActiveEncounter,
  isActiveEncounter,
  readActiveEncounter,
} from "./active-session";

// 세션당 활성 내원 1개 가드 레지스트리(Story 4.4 · UX-DR21⑨). jsdom localStorage 로 검증.
afterEach(() => window.localStorage.clear());

describe("active-session 레지스트리", () => {
  it("점유 → 읽기 왕복(encounter_id/no 보존)", () => {
    claimActiveEncounter({ encounter_id: "e1", encounter_no: "00000001" });
    const active = readActiveEncounter();
    expect(active?.encounter_id).toBe("e1");
    expect(active?.encounter_no).toBe("00000001");
    expect(active?.opened_at).toBeTruthy();
  });

  it("미점유 시 읽기는 null", () => {
    expect(readActiveEncounter()).toBeNull();
  });

  it("isActiveEncounter 는 현재 점유 내원만 true", () => {
    claimActiveEncounter({ encounter_id: "e1", encounter_no: "00000001" });
    expect(isActiveEncounter("e1")).toBe(true);
    expect(isActiveEncounter("e2")).toBe(false);
  });

  it("나중 점유가 이전 점유를 대체(세션당 1개)", () => {
    claimActiveEncounter({ encounter_id: "e1", encounter_no: "00000001" });
    claimActiveEncounter({ encounter_id: "e2", encounter_no: "00000002" });
    expect(readActiveEncounter()?.encounter_id).toBe("e2");
    expect(isActiveEncounter("e1")).toBe(false);
  });

  it("해제는 현재 점유가 그 내원일 때만(타 내원 점유 보존)", () => {
    claimActiveEncounter({ encounter_id: "e1", encounter_no: "00000001" });
    clearActiveEncounter("e2"); // 다른 내원 해제 시도 → 무효
    expect(isActiveEncounter("e1")).toBe(true);
    clearActiveEncounter("e1"); // 본인 해제 → 비움
    expect(readActiveEncounter()).toBeNull();
  });

  it("손상된 localStorage 값은 null 로 안전 처리", () => {
    window.localStorage.setItem(ACTIVE_ENCOUNTER_KEY, "{not json");
    expect(readActiveEncounter()).toBeNull();
  });
});
