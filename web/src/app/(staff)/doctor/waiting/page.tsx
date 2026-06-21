import { WaitingBoard } from "@/components/encounters/waiting-board";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 진료 대기(의사, FR-022·030). 원무와 공유하는 대기 현황판 컴포넌트를 마운트(UX-DR7 공유 화면).
// encounter.read 게이트 — doctor 권한 grant·진찰 시작(start_consult) 배선은 Story 4.4 가 켠다(현재
// doctor=권한0 → 이 라우트는 4.4 까지 STAFF_HOME 강등; nav 진입점은 staff-nav 가 역할 노출).
export default async function DoctorWaitingPage() {
  await requirePermission("encounter.read", STAFF_HOME);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <WaitingBoard role="doctor" />
    </div>
  );
}
