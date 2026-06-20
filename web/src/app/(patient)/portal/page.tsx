import { redirect } from "next/navigation";

import { LogoutButton } from "@/components/auth/logout-button";
import { isStaffRole } from "@/lib/auth/branch";
import { createClient } from "@/lib/supabase/server";

// 환자 포털 placeholder. 실제 포털(진료내역·예약·영수증)은 Epic 8, 환자 레코드는 Epic 3.
// 스톱갭(§리뷰): 직원이 환자 포털 직접 접근 시 직원 영역으로.
export default async function PatientPortalPage() {
  const supabase = await createClient();
  const { data: role } = await supabase.rpc("auth_user_role");
  if (isStaffRole(role as string | null)) {
    redirect("/home");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-[18px] font-semibold text-foreground">환자 포털</h1>
      <p className="text-[13px] text-muted-foreground">
        준비 중입니다. 예약 · 진료 내역 · 영수증 조회는 추후 제공됩니다.
      </p>
      <LogoutButton />
    </main>
  );
}
