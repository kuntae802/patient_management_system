import { redirect } from "next/navigation";

import { PatientBooking } from "@/components/scheduling/patient-booking";
import { isStaffRole } from "@/lib/auth/branch";
import { createClient } from "@/lib/supabase/server";

// 환자 앱 예약((patient) 영역 — 인증 필요, proxy 가 미인증 차단). Story 6.5 / UX-DR17.
// 직원 차단만 서버에서(직원 → 직원 영역). 본인 연결 확인은 클라(PatientBooking 이 GET /patients/self
// 호출 — apiFetch 는 브라우저 세션 기반이라 서버 컴포넌트 미동작). 미연결 → 온보딩 유도(클라).
export default async function PatientBookingPage() {
  const supabase = await createClient();
  const { data: role } = await supabase.rpc("auth_user_role");
  if (isStaffRole(role as string | null)) {
    redirect("/home");
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 py-8">
      <PatientBooking />
    </main>
  );
}
