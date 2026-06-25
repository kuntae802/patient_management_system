import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PatientHelpGuide } from "@/components/portal/patient-help-guide";
import { isStaffRole } from "@/lib/auth/branch";
import { createClient } from "@/lib/supabase/server";

// 환자 포털 도움말(/portal/help, Story 9.8 / FR-252·253). (patient) 영역 — 인증은 proxy 가 보장, 여기선
// 직원 차단만(직원 → 직원 영역). 직원용 /help(STAFF_NAV·HelpGuide)와 별개 — 환자 4메뉴 고정 안내를
// 환자 전용 렌더러로 그린다. 마이(/portal) 계정 동작의 "도움말" 링크로 진입.
export default async function PatientHelpPage() {
  const supabase = await createClient();
  const { data: role } = await supabase.rpc("auth_user_role");
  if (isStaffRole(role as string | null)) {
    redirect("/home");
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 py-6">
      <Link
        href="/portal"
        className="mb-4 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden /> 마이로
      </Link>

      <header className="mb-6">
        <h1 className="text-[21px] font-bold text-foreground">도움말</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          예약·내 진료기록·처방·검사 결과·수납·영수증 사용법을 화면과 함께 안내해요. 모두 본인 정보만 보여요.
        </p>
      </header>

      <PatientHelpGuide />
    </main>
  );
}
