import type { SupabaseClient } from "@supabase/supabase-js";

// 현재 직원의 권한 코드 목록을 Supabase 직접 조회로 획득. RBAC UI 노출 게이트의 데이터 소스.
// 근거: 0003_rls_helpers.sql:53-65 가 roles/permissions/role_permissions 에 authenticated SELECT 를
//       "1.6 셸 게이트가 카탈로그를 읽도록" 의도적으로 깔아둠 → 새 마이그레이션·RPC 없이 직접 조회.
// ⚠️ 보안 경계 아님(학습·속도 레이어). 쓰기 권위=FastAPI(403), 행 권위=RLS. 비직원/예외 → [] (안전 디폴트).
// ⚠️ permissions.code 는 snake_case(`<resource>.<action>`) — 전 경로 일관(TS 에서 camelCase 변환 금지).
export async function fetchUserPermissions(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  // 1) 본인 role_id (RLS users_select_self 가 본인 행만 허용)
  const { data: me, error: meError } = await supabase
    .from("users")
    .select("role_id")
    .eq("id", userId)
    .maybeSingle();
  // 에러 path 는 정상 빈 권한(비직원)과 구분해 로깅 — 무신호 붕괴(transient/RLS) 관측성 확보(fail-closed 유지).
  if (meError) {
    console.warn("[fetchUserPermissions] users 조회 실패 → 빈 권한으로 강등(fail-closed):", meError.message);
    return [];
  }
  if (!me?.role_id) return [];

  // 2) role_permissions → permissions(code) 임베드(role_id 필터). 카탈로그 SELECT 는 using(true).
  const { data: rows, error: permError } = await supabase
    .from("role_permissions")
    .select("permissions(code)")
    .eq("role_id", me.role_id as string);
  if (permError) {
    console.warn(
      "[fetchUserPermissions] role_permissions 조회 실패 → 빈 권한으로 강등(fail-closed):",
      permError.message,
    );
    return [];
  }
  if (!rows) return [];

  // PostgREST many-to-one 임베드는 객체({code})지만, 타입 추론이 배열일 수 있어 양쪽 방어.
  return (rows as Array<{ permissions: { code: string } | { code: string }[] | null }>)
    .map((r) => {
      const p = r.permissions;
      if (!p) return undefined;
      return Array.isArray(p) ? p[0]?.code : p.code;
    })
    .filter((c): c is string => typeof c === "string");
}

// 현재 직원의 소속 진료과(users.department_id → departments). 의사 진료대기 "본인 과만" 고정 등에 사용.
// fetchUserPermissions 와 동일 경로(users RLS 본인 행 + departments authenticated SELECT). 미배정/에러 → null.
export async function fetchUserDepartment(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ id: string; code: string; name: string } | null> {
  const { data, error } = await supabase
    .from("users")
    .select("departments(id, code, name)")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  type Dept = { id: string; code: string; name: string };
  const d = (data as { departments: Dept | Dept[] | null }).departments;
  const dept = Array.isArray(d) ? d[0] : d;
  return dept ? { id: dept.id, code: dept.code, name: dept.name } : null;
}
