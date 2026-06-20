import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { fetchPermissionMatrix, grantKey } from "@/lib/auth/rbac-matrix";

// roles/permissions/role_permissions 의 from(table).select(...) 체인을 테이블별로 모킹.
function mockSupabase(opts: {
  roles: Array<{ code: string; name: string }>;
  permissions: Array<{ code: string; name: string; resource: string }>;
  grants: Array<{ roles: { code: string }; permissions: { code: string } }>;
  errorTable?: string; // 지정 시 해당 테이블 조회가 error 를 반환
}): SupabaseClient {
  return {
    from: (table: string) => ({
      select: () => {
        if (opts.errorTable === table)
          return Promise.resolve({ data: null, error: { message: "boom" } });
        if (table === "roles") return Promise.resolve({ data: opts.roles, error: null });
        if (table === "permissions")
          return Promise.resolve({ data: opts.permissions, error: null });
        return Promise.resolve({ data: opts.grants, error: null });
      },
    }),
  } as unknown as SupabaseClient;
}

const ROLES = [
  { code: "admin", name: "관리자" },
  { code: "reception", name: "원무과" },
  { code: "doctor", name: "의사" },
  { code: "nurse", name: "간호사" },
  { code: "radiologist", name: "방사선사" },
  { code: "patient", name: "환자" }, // 매트릭스에서 제외돼야 함
];

const PERMISSIONS = [
  { code: "rbac.manage", name: "권한 매트릭스 관리", resource: "rbac" },
  { code: "patient.create", name: "환자 등록", resource: "patient" },
  { code: "patient.read", name: "환자 조회", resource: "patient" },
];

describe("fetchPermissionMatrix", () => {
  it("patient 역할을 제외하고 5개 역할을 매트릭스 순서로 반환", async () => {
    const supabase = mockSupabase({ roles: ROLES, permissions: PERMISSIONS, grants: [] });
    const m = await fetchPermissionMatrix(supabase);
    expect(m.roles.map((r) => r.code)).toEqual([
      "reception",
      "doctor",
      "nurse",
      "radiologist",
      "admin",
    ]);
  });

  it("권한을 resource 그룹 → code 순으로 정렬(patient 먼저, 그룹 내 code 정렬)", async () => {
    const supabase = mockSupabase({ roles: ROLES, permissions: PERMISSIONS, grants: [] });
    const m = await fetchPermissionMatrix(supabase);
    // RESOURCE_LABELS 순서상 patient 가 rbac 보다 앞 → patient.* 가 먼저, 그룹 내 code 오름차순.
    expect(m.permissions.map((p) => p.code)).toEqual([
      "patient.create",
      "patient.read",
      "rbac.manage",
    ]);
  });

  it("role_permissions 임베드를 grant 쌍으로 정규화", async () => {
    const supabase = mockSupabase({
      roles: ROLES,
      permissions: PERMISSIONS,
      grants: [{ roles: { code: "reception" }, permissions: { code: "patient.read" } }],
    });
    const m = await fetchPermissionMatrix(supabase);
    expect(m.grants).toEqual([grantKey("reception", "patient.read")]);
  });

  it("쿼리 에러는 빈 매트릭스로 강등하지 않고 throw(fail-loud)", async () => {
    const supabase = mockSupabase({
      roles: ROLES,
      permissions: PERMISSIONS,
      grants: [],
      errorTable: "role_permissions",
    });
    await expect(fetchPermissionMatrix(supabase)).rejects.toThrow(/권한 매트릭스 조회 실패/);
  });
});
