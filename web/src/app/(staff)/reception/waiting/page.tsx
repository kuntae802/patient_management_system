import { WaitingBoard } from "@/components/encounters/waiting-board";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 대기 현황판(원무, FR-022·023). 부모 (staff)/layout 이 직원 보장 → 여기선 권한만 가드.
// encounter.read 미보유 → STAFF_HOME 강등. 실시간·조회·호출은 클라가 Supabase 구독 + FastAPI 호출.
// 대기 현황 메뉴는 nav 가 reception 역할로 노출(staff-nav) — 진짜 권위는 FastAPI(403)·RLS.
export default async function ReceptionWaitingPage() {
  await requirePermission("encounter.read", STAFF_HOME);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <WaitingBoard role="reception" />
    </div>
  );
}
