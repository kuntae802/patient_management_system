import { redirect } from "next/navigation";

import { PatientTabBar } from "@/components/portal/patient-tab-bar";
import { VisitHistory } from "@/components/portal/visit-history";
import { isStaffRole } from "@/lib/auth/branch";
import { createClient } from "@/lib/supabase/server";

// 환자 포털 "내 기록"((patient) 영역 — 인증 필요, proxy 가 미인증 차단). Story 8.1 / FR-120·UX-DR17.
// 직원 차단만 서버에서(직원 → 직원 영역). 본인 연결 확인·내원 카드는 클라(VisitHistory — apiFetch 는
// 브라우저 세션 기반이라 서버 컴포넌트 미동작). 하단 탭바는 화면 로컬(예약 화면 sticky CTA 충돌 회피).
export default async function PatientRecordsPage() {
  const supabase = await createClient();
  const { data: role } = await supabase.rpc("auth_user_role");
  if (isStaffRole(role as string | null)) {
    redirect("/home");
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 py-8">
      <VisitHistory />
      <PatientTabBar />
    </main>
  );
}
