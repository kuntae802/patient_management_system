import { StaffDirectory } from "@/components/admin/staff-directory";
import { fetchDepartments, type Department } from "@/lib/admin/masters";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

// 직원 계정·재직상태·진료과 배정 관리(FR-214·215 + Story 2.6). 부모 (staff)/layout 이 직원 보장 →
// 여기선 권한만 가드(fallback=/home). 목록·생성·상태변경·진료과 배정은 FastAPI 경유(users RLS 본인행 →
// 직접조회 불가). 진료과 목록만 Supabase 직접조회(전역 참조 데이터)로 서버에서 주입.
export default async function UsersPage() {
  await requirePermission("user.manage", STAFF_HOME);

  const supabase = await createClient();
  // 진료과 조회 실패가 직원 화면 전체(자체 재시도 UI 보유)를 다운시키지 않게 fail-soft([] 폴백).
  // 진료과 배정은 보조 affordance — [] 면 재배정 select 가 "소속 없음"+현 소속만 표시(정상 동작).
  let departments: Department[] = [];
  try {
    departments = await fetchDepartments(supabase);
  } catch {
    departments = [];
  }

  return (
    <div className="px-6 py-6">
      <StaffDirectory departments={departments} />
    </div>
  );
}
