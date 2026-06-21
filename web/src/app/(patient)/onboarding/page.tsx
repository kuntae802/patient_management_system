import { redirect } from "next/navigation";

import { isStaffRole } from "@/lib/auth/branch";
import { createClient } from "@/lib/supabase/server";

import { OnboardingForm } from "./onboarding-form";

// 본인인증·연결 화면((patient) 영역 — 인증 필요, proxy 가 미인증 차단). Story 3.4.
// 직원 계정이 진입하면 직원 영역으로(self-link 는 직원 403 — 화면 단에서도 분리).
export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: role } = await supabase.rpc("auth_user_role");
  if (isStaffRole(role as string | null)) {
    redirect("/home");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
      <OnboardingForm />
    </main>
  );
}
