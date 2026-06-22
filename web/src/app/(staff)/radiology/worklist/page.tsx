import { RadiologyWorklistPage } from "@/components/radiology/radiology-worklist-page";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 촬영 워크리스트(방사선사, Story 5.8 / FR-100·FR-101). 부모 (staff)/layout 이 직원 보장 → 여기선
// examination.perform 가드(미보유 → STAFF_HOME). nav "촬영 워크리스트" = radiologist 역할 노출.
// 좌 목록(미수행 영상검사) → 우 캡처 패널(영상 업로드·장비 배정·촬영 수행).
export default async function RadiologyWorklistRoute() {
  await requirePermission("examination.perform", STAFF_HOME);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-5">
        <h1 className="text-[18px] font-semibold text-foreground">촬영 워크리스트</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          오늘 지시된 영상검사를 촬영 수행합니다. 영상을 1장 이상 업로드해야 수행할 수 있습니다.
        </p>
      </header>
      <RadiologyWorklistPage />
    </div>
  );
}
