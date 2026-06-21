import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api/client";
import {
  createWalkInEncounter,
  type Encounter,
  ENCOUNTER_STATUS_META,
  type EncounterStatus,
  walkInIntakeSchema,
} from "./encounters";

// 내원 접수(Story 4.2) — Zod 검증(클라 1선) + 생성 호출(apiFetch 모킹) + 상태 메타.
vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn() }));
const mockApiFetch = vi.mocked(apiFetch);
afterEach(() => vi.clearAllMocks());

describe("walkInIntakeSchema (클라 1선)", () => {
  it("환자·진료과 선택 시 통과", () => {
    expect(walkInIntakeSchema.safeParse({ patient_id: "p1", department_id: "d1" }).success).toBe(
      true,
    );
  });

  it("환자 미선택 → 거부", () => {
    expect(walkInIntakeSchema.safeParse({ patient_id: "", department_id: "d1" }).success).toBe(
      false,
    );
  });

  it("진료과 미선택 → 거부", () => {
    expect(walkInIntakeSchema.safeParse({ patient_id: "p1", department_id: "" }).success).toBe(
      false,
    );
  });
});

const ENCOUNTER: Encounter = {
  id: "e1",
  encounter_no: "00000001",
  patient_id: "p1",
  department_id: "d1",
  room_id: null,
  doctor_id: null,
  visit_type: "walk_in",
  status: "registered",
  cancel_reason: null,
  registered_at: "2026-06-21T00:00:00Z",
  consult_started_at: null,
  completed_at: null,
  cancelled_at: null,
  no_show_at: null,
  created_by: "u1",
  is_active: true,
  created_at: "2026-06-21T00:00:00Z",
  updated_at: "2026-06-21T00:00:00Z",
};

describe("createWalkInEncounter", () => {
  it("POST /v1/encounters 로 patient_id·department_id 만 전송하고 Encounter 를 반환한다", async () => {
    mockApiFetch.mockResolvedValueOnce(ENCOUNTER);

    const result = await createWalkInEncounter({ patient_id: "p1", department_id: "d1" });

    expect(result).toEqual(ENCOUNTER);
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters", {
      method: "POST",
      body: JSON.stringify({ patient_id: "p1", department_id: "d1" }),
    });
  });
});

describe("ENCOUNTER_STATUS_META (UX-DR6 인라인 최소판)", () => {
  it("6개 상태 전부 라벨·badgeClass 를 보유한다", () => {
    const statuses: EncounterStatus[] = [
      "scheduled",
      "registered",
      "in_progress",
      "completed",
      "cancelled",
      "no_show",
    ];
    for (const s of statuses) {
      expect(ENCOUNTER_STATUS_META[s].label).toBeTruthy();
      expect(ENCOUNTER_STATUS_META[s].badgeClass).toBeTruthy();
    }
  });

  it("접수 라벨은 대비 AA 잉크(status-received-ink) 사용 + 취소는 취소선(색 비의존 중복 인코딩)", () => {
    expect(ENCOUNTER_STATUS_META.registered.badgeClass).toContain("text-status-received-ink");
    expect(ENCOUNTER_STATUS_META.cancelled.badgeClass).toContain("line-through");
  });
});
