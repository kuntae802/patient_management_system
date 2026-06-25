import Link from "next/link";
import { redirect } from "next/navigation";

import { LogoutButton } from "@/components/auth/logout-button";
import { PatientTabBar } from "@/components/portal/patient-tab-bar";
import { PaymentHistory } from "@/components/portal/payment-history";
import { isStaffRole } from "@/lib/auth/branch";
import { createClient } from "@/lib/supabase/server";

// 환자 포털 '마이' 탭((patient) 영역 — 인증 필요, proxy 가 미인증 차단). Story 8.3 / FR-122·UX-DR17.
// 주 콘텐츠 = 본인 finalized 수납·영수증(PaymentHistory — 클라, apiFetch 는 브라우저 세션 기반). 하단에
// 계정 동작(본인 연결·로그아웃) 유지. 직원 차단만 서버에서(직원 → 직원 영역). 하단 탭바는 화면 로컬
// (예약 화면 sticky CTA 충돌 회피 — 8.1 결정). 예약·내 기록은 탭바가 잇는다.
export default async function PatientPortalPage() {
  const supabase = await createClient();
  const { data: role } = await supabase.rpc("auth_user_role");
  if (isStaffRole(role as string | null)) {
    redirect("/home");
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 py-8">
      <PaymentHistory />

      {/* 계정 동작 — 본인 연결(미연결 환자의 멱등 진입점, Story 3.4) · 로그아웃. */}
      <section className="mt-2 flex flex-col items-stretch gap-2 border-t border-border pt-6">
        <Link
          href="/onboarding"
          className="rounded-xl border border-border bg-card px-4 py-3 text-center text-[13px] font-medium text-foreground hover:bg-muted"
        >
          본인 진료기록 연결
        </Link>
        <Link
          href="/portal/help"
          className="rounded-xl border border-border bg-card px-4 py-3 text-center text-[13px] font-medium text-foreground hover:bg-muted"
        >
          도움말
        </Link>
        <LogoutButton />
      </section>

      <PatientTabBar />
    </main>
  );
}
