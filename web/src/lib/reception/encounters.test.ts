import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api/client";
import {
  callEncounter,
  createWalkInEncounter,
  type Encounter,
  ENCOUNTER_STATUS_META,
  encounterHubPath,
  type EncounterListItem,
  type EncounterStatus,
  fetchEncounter,
  fetchEncounters,
  nextCallCandidate,
  registerEncounter,
  startConsult,
  walkInIntakeSchema,
  waitMinutes,
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
  called_at: null,
  call_count: 0,
  last_called_by: null,
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

  it("6개 상태 전부 글리프 보유(UX-DR6 A3 색 비의존 인코딩)", () => {
    const statuses: EncounterStatus[] = [
      "scheduled",
      "registered",
      "in_progress",
      "completed",
      "cancelled",
      "no_show",
    ];
    for (const s of statuses) expect(ENCOUNTER_STATUS_META[s].glyph).toBeTruthy();
  });
});

// ── 대기 현황판(Story 4.3) — 목록/호출 호출 + 헬퍼 ────────────────────────────────

function listItem(over: Partial<EncounterListItem>): EncounterListItem {
  return {
    id: "x",
    encounter_no: "00000001",
    patient_id: "p",
    department_id: "d1",
    room_id: null,
    doctor_id: null,
    visit_type: "walk_in",
    status: "registered",
    registered_at: "2026-06-21T00:00:00Z",
    consult_started_at: null,
    called_at: null,
    call_count: 0,
    is_active: true,
    created_at: "2026-06-21T00:00:00Z",
    patient_name: "환자",
    chart_no: "00000001",
    department_name: "내과",
    room_name: null,
    doctor_name: null,
    ...over,
  };
}

describe("fetchEncounters", () => {
  it("진료과·상태 필터를 쿼리스트링으로 전송한다", async () => {
    mockApiFetch.mockResolvedValueOnce({ data: [], meta: { page: 1, page_size: 200, total: 0 } });
    await fetchEncounters({ department_id: "d1", status: ["registered", "in_progress"] });
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/v1/encounters?department_id=d1&status=registered&status=in_progress&page_size=500",
    );
  });

  it("진료과만 지정 시 status 없이 전송", async () => {
    mockApiFetch.mockResolvedValueOnce({ data: [], meta: { page: 1, page_size: 500, total: 0 } });
    await fetchEncounters({ department_id: "d1" });
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters?department_id=d1&page_size=500");
  });
});

describe("callEncounter / registerEncounter", () => {
  it("호출 = POST /v1/encounters/{id}/call", async () => {
    mockApiFetch.mockResolvedValueOnce(ENCOUNTER);
    await callEncounter("e1");
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters/e1/call", { method: "POST" });
  });

  it("접수 = POST /v1/encounters/{id}/register", async () => {
    mockApiFetch.mockResolvedValueOnce(ENCOUNTER);
    await registerEncounter("e1");
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters/e1/register", { method: "POST" });
  });
});

// ── 진찰 시작(Story 4.4) — start-consult 액션 + 단건 조회 + 허브 경로 ──────────────────

describe("startConsult / fetchEncounter / encounterHubPath", () => {
  it("진찰 시작 = POST /v1/encounters/{id}/start-consult, in_progress 반환", async () => {
    mockApiFetch.mockResolvedValueOnce({ ...ENCOUNTER, status: "in_progress" });
    const result = await startConsult("e1");
    expect(result.status).toBe("in_progress");
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters/e1/start-consult", { method: "POST" });
  });

  it("단건 조회 = GET /v1/encounters/{id}", async () => {
    mockApiFetch.mockResolvedValueOnce(ENCOUNTER);
    await fetchEncounter("e1");
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/encounters/e1");
  });

  it("허브 경로는 불투명 encounter_id 키", () => {
    expect(encounterHubPath("e1")).toBe("/encounter/e1");
  });
});

describe("waitMinutes", () => {
  it("from 으로부터 경과 분을 계산한다", () => {
    const now = new Date("2026-06-21T00:30:00Z").getTime();
    expect(waitMinutes("2026-06-21T00:00:00Z", now)).toBe(30);
  });
  it("from 이 null 이면 null", () => {
    expect(waitMinutes(null)).toBeNull();
  });
  it("미래 시각은 0(음수 방지)", () => {
    const now = new Date("2026-06-21T00:00:00Z").getTime();
    expect(waitMinutes("2026-06-21T01:00:00Z", now)).toBe(0);
  });
});

describe("nextCallCandidate", () => {
  it("가장 오래 대기한 미호출 registered 를 고른다", () => {
    const items = [
      listItem({ id: "b", status: "registered", registered_at: "2026-06-21T00:10:00Z" }),
      listItem({ id: "a", status: "registered", registered_at: "2026-06-21T00:05:00Z" }),
      listItem({ id: "c", status: "in_progress", registered_at: "2026-06-21T00:01:00Z" }),
    ];
    expect(nextCallCandidate(items)?.id).toBe("a");
  });

  it("이미 호출된 registered 는 건너뛰고 미호출 우선", () => {
    const items = [
      listItem({ id: "a", registered_at: "2026-06-21T00:05:00Z", called_at: "2026-06-21T00:06:00Z" }),
      listItem({ id: "b", registered_at: "2026-06-21T00:10:00Z", called_at: null }),
    ];
    expect(nextCallCandidate(items)?.id).toBe("b");
  });

  it("registered 가 없으면 null", () => {
    expect(nextCallCandidate([listItem({ status: "completed" })])).toBeNull();
  });
});
