import { describe, expect, it } from "vitest";

import {
  codeStatus,
  departmentLabel,
  fetchMasters,
  formatKrw,
  isCurrentlyValid,
  todayISO,
  type Department,
} from "@/lib/admin/masters";

// fetchMasters(부분 강등, AC4) 검증용 가짜 SupabaseClient — from().select().order() 가 테이블별
// {data,error} 로 resolve. Supabase 쿼리는 reject 가 아니라 error 를 객체로 돌려준다.
type TableResult = { data: unknown[] | null; error: { message: string } | null };
function fakeSupabase(results: Partial<Record<string, TableResult>>) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            order() {
              return Promise.resolve(results[table] ?? { data: [], error: null });
            },
          };
        },
      };
    },
  } as unknown as Parameters<typeof fetchMasters>[0];
}

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

describe("fetchMasters 부분 강등 (Story 2.6 / AC4)", () => {
  it("한 테이블만 실패하면 나머지는 data, 실패 테이블만 errors 에 담는다", async () => {
    const supabase = fakeSupabase({
      departments: { data: [dept({})], error: null },
      diagnoses: { data: null, error: { message: "진단 조회 실패" } },
      // rooms·fee_schedules·drugs 는 기본 {data:[],error:null}
    });
    const { data, errors } = await fetchMasters(supabase);

    expect(data.departments).toHaveLength(1); // 정상 테이블은 그대로
    expect(data.diagnoses).toEqual([]); // 실패 테이블은 빈 배열로 강등
    expect(errors.diagnoses).toBe("진단 조회 실패"); // 실패만 errors 에
    expect(errors.departments).toBeUndefined();
    expect(errors.rooms).toBeUndefined();
  });

  it("전부 성공이면 errors 가 비어 있다(회귀 — 정상 경로 무영향)", async () => {
    const { data, errors } = await fetchMasters(fakeSupabase({}));
    expect(Object.keys(errors)).toHaveLength(0);
    expect(data.departments).toEqual([]);
  });
});
