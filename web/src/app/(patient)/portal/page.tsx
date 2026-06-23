import Link from "next/link";
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
      <p className="text-[13px] text-muted-foreground">영수증 조회는 추후 제공됩니다.</p>
      {/* 예약하기(Story 6.5) — 진료과·의사·시간을 골라 본인 예약 생성. */}
      <Link
        href="/booking"
        className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 text-[14px] font-bold text-primary-foreground hover:bg-primary/90"
      >
        예약하기
      </Link>
      {/* 내 기록(Story 8.1) — 본인 내원 이력·진단을 쉬운 말로(RLS 본인만). */}
      <Link
        href="/records"
        className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-border bg-card px-4 text-[14px] font-bold text-foreground hover:bg-muted"
      >
        내 기록 보기
      </Link>
      {/* 미연결 환자(자가가입 후 본인 확인 미완)의 연결 진입점(Story 3.4). 이미 연결됐으면 멱등. */}
      <Link
        href="/onboarding"
        className="rounded-md border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground hover:bg-muted"
      >
        본인 진료기록 연결
      </Link>
      <LogoutButton />
    </main>
  );
}
