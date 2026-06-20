import { LogoutButton } from "@/components/auth/logout-button";

// 환자 포털 placeholder. 실제 포털(진료내역·예약·영수증)은 Epic 8, 환자 레코드는 Epic 3.
export default function PatientPortalPage() {
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
