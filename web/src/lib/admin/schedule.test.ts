import { describe, expect, it } from "vitest";

import {
  doctorLabel,
  doctorScheduleCreateSchema,
  doctorTimeOffCreateSchema,
  fetchSchedules,
  formatTimeRange,
  hhmm,
  isoToLocalInput,
  localInputToKstIso,
  roomLabel,
  toScheduleCreatePayload,
  toScheduleUpdatePayload,
  toTimeOffCreatePayload,
  toTimeOffUpdatePayload,
  weekdayLabel,
  type DoctorSchedule,
  type SchedulingDoctor,
} from "@/lib/admin/schedule";
import type { Room } from "@/lib/admin/masters";

// fetchSchedules(부분 강등) 검증용 가짜 SupabaseClient — from().select().order()[.order()] 가
// 테이블별 {data,error} 로 resolve(체인 가능 + thenable). masters.test.ts fakeSupabase 미러 + 2-order.
type TableResult = { data: unknown[] | null; error: { message: string } | null };
function fakeSupabase(results: Partial<Record<string, TableResult>>) {
  return {
    from(table: string) {
      const result = results[table] ?? { data: [], error: null };
      const chain = {
        select: () => chain,
        order: () => chain,
        then: (resolve: (r: TableResult) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  } as unknown as Parameters<typeof fetchSchedules>[0];
}

function room(over: Partial<Room>): Room {
  return {
    id: "r1",
    code: "R101",
    name: "1진료실",
    department_id: "d1",
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const DOCTORS: SchedulingDoctor[] = [
  { id: "doc1", name: "김의사", department_id: "d1" },
  { id: "doc2", name: "이의사", department_id: null },
];

const VALID_SCHED = {
  doctor_id: "doc1",
  department_id: "d1",
  room_id: "",
  weekday: "1",
  start_time: "09:00",
  end_time: "12:00",
};
const VALID_TIMEOFF = {
  doctor_id: "doc1",
  start_at: "2030-03-01T09:00",
  end_at: "2030-03-03T18:00",
  reason: "학회",
};

describe("표시 헬퍼", () => {
  it("weekdayLabel: 0=일 .. 6=토 (PG dow), 범위 밖 ?", () => {
    expect(weekdayLabel(0)).toBe("일");
    expect(weekdayLabel(1)).toBe("월");
    expect(weekdayLabel(6)).toBe("토");
    expect(weekdayLabel(9)).toBe("?");
  });

  it("hhmm / formatTimeRange: 초 절단·범위 표기", () => {
    expect(hhmm("09:00:00")).toBe("09:00");
    expect(formatTimeRange("09:00:00", "12:30:00")).toBe("09:00–12:30");
  });

  it("doctorLabel: 미매칭 → (미상)", () => {
    expect(doctorLabel(DOCTORS, "doc1")).toBe("김의사");
    expect(doctorLabel(DOCTORS, "zzz")).toBe("(미상)");
  });

  it("roomLabel: 미지정 → —, 비활성 → (비활성), 미매칭 → (미상)", () => {
    const rooms = [room({ id: "r1", name: "1진료실", is_active: true }), room({ id: "r2", name: "구실", is_active: false })];
    expect(roomLabel(rooms, null)).toBe("—");
    expect(roomLabel(rooms, "r1")).toBe("1진료실");
    expect(roomLabel(rooms, "r2")).toBe("구실 (비활성)");
    expect(roomLabel(rooms, "zzz")).toBe("(미상)");
  });
});

describe("datetime-local ↔ KST ISO 라운드트립", () => {
  it("localInputToKstIso: 벽시계에 +09:00 부착", () => {
    expect(localInputToKstIso("2030-03-01T09:00")).toBe("2030-03-01T09:00:00+09:00");
  });

  it("isoToLocalInput: KST 벽시계로 환원(라운드트립)", () => {
    const iso = localInputToKstIso("2030-03-01T09:00"); // +09:00
    expect(isoToLocalInput(iso)).toBe("2030-03-01T09:00");
  });

  it("isoToLocalInput: UTC 입력도 KST 벽시계로", () => {
    // 2030-03-01T00:00:00Z = KST 09:00
    expect(isoToLocalInput("2030-03-01T00:00:00Z")).toBe("2030-03-01T09:00");
  });
});

describe("Zod 검증 (Pydantic 거울)", () => {
  it("근무표: 유효 입력 통과", () => {
    expect(doctorScheduleCreateSchema.safeParse(VALID_SCHED).success).toBe(true);
  });

  it("근무표: 종료<=시작 → refine 실패(end_time path)", () => {
    const r = doctorScheduleCreateSchema.safeParse({ ...VALID_SCHED, start_time: "12:00", end_time: "09:00" });
    expect(r.success).toBe(false);
  });

  it("근무표: weekday 범위 밖(7)·미선택 의사 → 실패", () => {
    expect(doctorScheduleCreateSchema.safeParse({ ...VALID_SCHED, weekday: "7" }).success).toBe(false);
    expect(doctorScheduleCreateSchema.safeParse({ ...VALID_SCHED, doctor_id: "" }).success).toBe(false);
  });

  it("휴진: 유효 입력 통과 / 종료<=시작 실패", () => {
    expect(doctorTimeOffCreateSchema.safeParse(VALID_TIMEOFF).success).toBe(true);
    expect(
      doctorTimeOffCreateSchema.safeParse({ ...VALID_TIMEOFF, start_at: "2030-03-03T18:00", end_at: "2030-03-01T09:00" })
        .success,
    ).toBe(false);
  });
});

describe("payload 매퍼", () => {
  it("근무표 create: 빈 room_id 제거 + weekday 정수화", () => {
    expect(toScheduleCreatePayload(VALID_SCHED)).toEqual({
      doctor_id: "doc1",
      department_id: "d1",
      weekday: 1,
      start_time: "09:00",
      end_time: "12:00",
    });
  });

  it("근무표 create: room_id 있으면 포함", () => {
    expect(toScheduleCreatePayload({ ...VALID_SCHED, room_id: "r1" })).toMatchObject({ room_id: "r1" });
  });

  it("근무표 update: room_id 항상 전송(빈값=null)", () => {
    expect(toScheduleUpdatePayload(VALID_SCHED)).toEqual({
      doctor_id: "doc1",
      department_id: "d1",
      room_id: null,
      weekday: 1,
      start_time: "09:00",
      end_time: "12:00",
    });
  });

  it("휴진 create: KST ISO 변환 + 빈 사유 제거", () => {
    expect(toTimeOffCreatePayload({ ...VALID_TIMEOFF, reason: "" })).toEqual({
      doctor_id: "doc1",
      start_at: "2030-03-01T09:00:00+09:00",
      end_at: "2030-03-03T18:00:00+09:00",
    });
  });

  it("휴진 update: doctor_id 제외 + reason 항상 전송(빈값=null)", () => {
    expect(toTimeOffUpdatePayload({ ...VALID_TIMEOFF, reason: "" })).toEqual({
      start_at: "2030-03-01T09:00:00+09:00",
      end_at: "2030-03-03T18:00:00+09:00",
      reason: null,
    });
  });
});

describe("fetchSchedules 부분 강등 (masters 2.6/AC4 동형)", () => {
  it("한 자원만 실패하면 나머지는 data, 실패 자원만 errors", async () => {
    const sched: DoctorSchedule = {
      id: "s1",
      doctor_id: "doc1",
      department_id: "d1",
      room_id: null,
      weekday: 1,
      start_time: "09:00:00",
      end_time: "12:00:00",
      is_active: true,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const supabase = fakeSupabase({
      doctor_schedules: { data: [sched], error: null },
      doctor_time_offs: { data: null, error: { message: "휴진 조회 실패" } },
    });
    const { data, errors } = await fetchSchedules(supabase);
    expect(data.schedules).toHaveLength(1);
    expect(data.timeOffs).toEqual([]);
    expect(errors.timeOffs).toBe("휴진 조회 실패");
    expect(errors.schedules).toBeUndefined();
  });

  it("전부 성공이면 errors 가 비어 있다", async () => {
    const { data, errors } = await fetchSchedules(fakeSupabase({}));
    expect(Object.keys(errors)).toHaveLength(0);
    expect(data.schedules).toEqual([]);
  });
});
