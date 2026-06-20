import { StaffDirectory } from "@/components/admin/staff-directory";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 직원 계정·재직상태 관리(FR-214·215). 부모 (staff)/layout 이 직원 보장 → 여기선 권한만 가드(fallback=/home).
// 목록·생성·상태변경은 모두 FastAPI 경유(users RLS 본인행 → 직접조회 불가). 클라 컴포넌트가 apiFetch 로 호출.
export default async function UsersPage() {
  await requirePermission("user.manage", STAFF_HOME);

  return (
    <div className="px-6 py-6">
      <StaffDirectory />
    </div>
  );
}
