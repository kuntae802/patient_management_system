import { EquipmentList } from "@/components/radiology/equipment-list";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 장비 관리(방사선사, Story 5.8 / FR-103). 장비 목록·상태 읽기 전용 표시(상태 변경은 5.8 범위 밖).
// 게이트 examination.perform(미보유 → STAFF_HOME). 촬영 배정·가용성 확인용.
export default async function RadiologyEquipmentRoute() {
  await requirePermission("examination.perform", STAFF_HOME);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-5">
        <h1 className="text-[18px] font-semibold text-foreground">장비 관리</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          검사장비 목록과 가용 상태입니다. 촬영 배정 시 가용 장비를 확인하세요.
        </p>
      </header>
      <EquipmentList />
    </div>
  );
}
