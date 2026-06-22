import { ReadingWorklistPage } from "@/components/doctor/reading-worklist-page";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 판독 워크리스트(의사 판독의 겸임, Story 5.9 / FR-102). 부모 (staff)/layout 이 직원 보장 → 여기선
// examination.complete 가드(미보유 → STAFF_HOME). nav "판독" = doctor 역할 노출. 좌 목록(미판독
// 영상검사·performed) → 우 판독 패널(영상 썸네일·소견/결론 입력·완료).
export default async function DoctorRadiologyRoute() {
  await requirePermission("examination.complete", STAFF_HOME);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-5">
        <h1 className="text-[18px] font-semibold text-foreground">판독 워크리스트</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          촬영 수행된 영상검사를 판독합니다. 판독 소견을 기록하면 검사 오더가 완료됩니다.
        </p>
      </header>
      <ReadingWorklistPage />
    </div>
  );
}
