import { VitalsWorklistPage } from "@/components/nurse/vitals-page";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 활력징후 입력(간호, Story 5.6 / FR-091). 부모 (staff)/layout 이 직원 보장 → 여기선 vital.record 가드
// (미보유 → STAFF_HOME). 간호사는 encounter.read 0 이므로 진료 허브 진입 불가 → 이 워크리스트가 활력
// 작업 진입점(nav staff-nav 의 "활력징후 입력" = nurse 역할 노출). 5.7 처치 워크리스트가 이 진입 확장.
export default async function NurseVitalsPage() {
  await requirePermission("vital.record", STAFF_HOME);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-5">
        <h1 className="text-[18px] font-semibold text-foreground">활력징후 입력</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          오늘 활성 내원을 선택해 활력징후를 측정·기록합니다.
        </p>
      </header>
      <VitalsWorklistPage />
    </div>
  );
}
