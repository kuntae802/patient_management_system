import { TreatmentWorklistPage } from "@/components/nurse/treatment-worklist-page";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 처치 워크리스트(간호, Story 5.7 / FR-090·FR-092·FR-093). 부모 (staff)/layout 이 직원 보장 → 여기선
// treatment.perform 가드(미보유 → STAFF_HOME). 간호사는 encounter.read 0 이라 진료 허브 진입 불가 →
// 이 워크리스트가 처치 수행 진입점(nav "처치 워크리스트" = nurse 역할 노출). 재수행 차단·수행 추적.
export default async function NurseWorklistPage() {
  await requirePermission("treatment.perform", STAFF_HOME);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-5">
        <h1 className="text-[18px] font-semibold text-foreground">처치 워크리스트</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          오늘 활성 내원의 지시된 처치를 수행 처리합니다. 이미 수행된 처치는 잠깁니다.
        </p>
      </header>
      <TreatmentWorklistPage />
    </div>
  );
}
