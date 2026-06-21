import { WaitingBoard } from "@/components/encounters/waiting-board";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 진료 대기(의사, FR-022·030). 원무와 공유하는 대기 현황판 컴포넌트를 마운트(UX-DR7 공유 화면).
// encounter.read 게이트 — doctor 가 seed grant 로 encounter.read/start 보유(Story 4.4) → 라우트 활성.
// 보드의 doctor 행 액션 = 진료 시작(start_consult → 진료 허브)/진료 계속. nav 진입점은 staff-nav 역할 노출.
export default async function DoctorWaitingPage() {
  await requirePermission("encounter.read", STAFF_HOME);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <WaitingBoard role="doctor" />
    </div>
  );
}
