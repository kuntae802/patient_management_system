import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { fetchUserPermissions } from "./permissions";

type UsersResult = { data: { role_id: string } | null; error: unknown };
type PermsResult = { data: unknown[] | null; error: unknown };

// users → role_id, role_permissions → permissions(code) 체이닝을 모킹.
function mockSupabase(users: UsersResult, perms: PermsResult): SupabaseClient {
  return {
    from: vi.fn((table: string) => {
      if (table === "users") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(users) }) }),
        };
      }
      // role_permissions
      return { select: () => ({ eq: () => Promise.resolve(perms) }) };
    }),
  } as unknown as SupabaseClient;
}

describe("fetchUserPermissions", () => {
  it("정상 → 권한 코드 배열(snake_case 유지)", async () => {
    const supabase = mockSupabase(
      { data: { role_id: "r1" }, error: null },
      {
        data: [{ permissions: { code: "patient.read" } }, { permissions: { code: "rbac.manage" } }],
        error: null,
      },
    );
    expect(await fetchUserPermissions(supabase, "u1")).toEqual(["patient.read", "rbac.manage"]);
  });

  it("임베드가 배열 형태여도 첫 code 추출(방어)", async () => {
    const supabase = mockSupabase(
      { data: { role_id: "r1" }, error: null },
      { data: [{ permissions: [{ code: "audit.read" }] }], error: null },
    );
    expect(await fetchUserPermissions(supabase, "u1")).toEqual(["audit.read"]);
  });

  it("비직원(users 행 없음) → []", async () => {
    const supabase = mockSupabase({ data: null, error: null }, { data: [], error: null });
    expect(await fetchUserPermissions(supabase, "u1")).toEqual([]);
  });

  it("users 조회 에러 → []", async () => {
    const supabase = mockSupabase(
      { data: null, error: { message: "boom" } },
      { data: [], error: null },
    );
    expect(await fetchUserPermissions(supabase, "u1")).toEqual([]);
  });

  it("role_permissions 조회 에러 → []", async () => {
    const supabase = mockSupabase(
      { data: { role_id: "r1" }, error: null },
      { data: null, error: { message: "boom" } },
    );
    expect(await fetchUserPermissions(supabase, "u1")).toEqual([]);
  });

  it("null/누락 permissions 항목은 건너뜀", async () => {
    const supabase = mockSupabase(
      { data: { role_id: "r1" }, error: null },
      { data: [{ permissions: null }, { permissions: { code: "vital.record" } }], error: null },
    );
    expect(await fetchUserPermissions(supabase, "u1")).toEqual(["vital.record"]);
  });
});
