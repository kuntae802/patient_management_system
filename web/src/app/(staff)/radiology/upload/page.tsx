import { RadiologyWorklistPage } from "@/components/radiology/radiology-worklist-page";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 영상 업로드(방사선사, Story 5.8 / FR-101). nav "영상 업로드" 진입점 — 업로드는 검사 선택 후 캡처
// 패널에서 일어나므로 촬영 워크리스트와 동일 surface 를 재사용한다(검사 선택 → 영상 업로드·수행).
// 게이트 examination.perform(미보유 → STAFF_HOME).
export default async function RadiologyUploadRoute() {
  await requirePermission("examination.perform", STAFF_HOME);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-5">
        <h1 className="text-[18px] font-semibold text-foreground">영상 업로드</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          검사를 선택해 촬영 영상을 업로드합니다. 영상은 안전한 스토리지에 저장됩니다.
        </p>
      </header>
      <RadiologyWorklistPage />
    </div>
  );
}
