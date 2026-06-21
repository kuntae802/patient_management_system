import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useActiveEncounter } from "@/hooks/use-active-encounter";
import {
  ACTIVE_ENCOUNTER_KEY,
  claimActiveEncounter,
  readActiveEncounter,
} from "@/lib/encounters/active-session";

// 세션당 활성 내원 1개 가드 훅(Story 4.4 · UX-DR21⑨) — 점유/conflict/supersede/takeOver.
afterEach(() => window.localStorage.clear());

describe("useActiveEncounter", () => {
  it("활성이 없으면 마운트 시 이 내원을 점유(conflict 없음)", () => {
    const { result } = renderHook(() => useActiveEncounter("e1", "00000001"));
    expect(result.current.conflict).toBe(false);
    expect(result.current.superseded).toBe(false);
    expect(readActiveEncounter()?.encounter_id).toBe("e1");
  });

  it("다른 내원이 이미 활성이면 conflict(점유하지 않음)", () => {
    claimActiveEncounter({ encounter_id: "other", encounter_no: "00000099" });
    const { result } = renderHook(() => useActiveEncounter("e1", "00000001"));
    expect(result.current.conflict).toBe(true);
    expect(result.current.active?.encounter_id).toBe("other");
    // 점유는 그대로 other — 자동 탈취 금지.
    expect(readActiveEncounter()?.encounter_id).toBe("other");
  });

  it("takeOver 로 이 내원을 점유하면 conflict 해소", () => {
    claimActiveEncounter({ encounter_id: "other", encounter_no: "00000099" });
    const { result } = renderHook(() => useActiveEncounter("e1", "00000001"));
    act(() => result.current.takeOver());
    expect(result.current.conflict).toBe(false);
    expect(readActiveEncounter()?.encounter_id).toBe("e1");
  });

  it("다른 탭이 활성 내원을 가져가면(storage 이벤트) superseded", () => {
    const { result } = renderHook(() => useActiveEncounter("e1", "00000001"));
    expect(result.current.superseded).toBe(false);
    // 다른 탭이 키를 다른 내원으로 덮어씀(storage 이벤트는 다른 탭에서만 발생 → 수동 디스패치).
    act(() => {
      claimActiveEncounter({ encounter_id: "e2", encounter_no: "00000002" });
      window.dispatchEvent(new StorageEvent("storage", { key: ACTIVE_ENCOUNTER_KEY }));
    });
    expect(result.current.superseded).toBe(true);
  });

  it("다른 탭이 활성 내원을 해제(빈 키)하면 이 허브가 자가복구 재점유(Patch P2)", () => {
    const { result } = renderHook(() => useActiveEncounter("e1", "00000001"));
    // 다른 탭이 가져감 → superseded.
    act(() => {
      claimActiveEncounter({ encounter_id: "e2", encounter_no: "00000002" });
      window.dispatchEvent(new StorageEvent("storage", { key: ACTIVE_ENCOUNTER_KEY }));
    });
    expect(result.current.superseded).toBe(true);
    // 다른 탭이 해제(removeItem) → 빈 키 storage 이벤트 → 이 허브가 재점유, superseded 해제.
    act(() => {
      window.localStorage.removeItem(ACTIVE_ENCOUNTER_KEY);
      window.dispatchEvent(new StorageEvent("storage", { key: ACTIVE_ENCOUNTER_KEY }));
    });
    expect(result.current.superseded).toBe(false);
    expect(readActiveEncounter()?.encounter_id).toBe("e1");
  });
});
