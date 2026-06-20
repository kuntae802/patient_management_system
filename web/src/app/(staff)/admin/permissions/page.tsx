import { PermissionMatrix } from "@/components/admin/permission-matrix";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";
import { fetchPermissionMatrix } from "@/lib/auth/rbac-matrix";
import { createClient } from "@/lib/supabase/server";

// 관리자 권한 매트릭스(FR-211). 부모 (staff)/layout 이 직원 보장 → 여기선 권한만 가드(fallback=/home).
// 읽기 = Supabase 직접 조회(authenticated SELECT, 0003). 토글 쓰기 = 클라 컴포넌트가 FastAPI 호출.
export default async function PermissionsPage() {
  await requirePermission("rbac.manage", STAFF_HOME);

  const supabase = await createClient();
  const matrix = await fetchPermissionMatrix(supabase);

  return (
    <div className="px-6 py-6">
      <PermissionMatrix initial={matrix} />
    </div>
  );
}
