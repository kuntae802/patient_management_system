import { OperationsDashboard } from "@/components/dashboard/operations-dashboard";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 운영 대시보드(관리자, Story 8.5 / FR-230). 부모 (staff)/layout 이 직원 보장 → 여기선 권한만 가드.
// dashboard.read 미보유 → STAFF_HOME 강등(서버 가드). 메뉴 노출은 nav 가 admin+dashboard.read 로 게이트
// — 진짜 권위는 FastAPI(403). 집계·표시는 클라 컴포넌트가 /v1/dashboard/operations 로 수행(read-only).
export default async function AdminDashboardPage() {
  await requirePermission("dashboard.read", STAFF_HOME);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-5">
        <h1 className="text-[18px] font-semibold text-foreground">운영 대시보드</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          오늘 내원·대기·매출·노쇼율 현황과 최근 추세를 한눈에 봅니다.
        </p>
      </header>
      <OperationsDashboard />
    </div>
  );
}
