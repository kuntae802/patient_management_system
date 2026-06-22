import { NursingNotesPage } from "@/components/nurse/nursing-notes-page";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 일상 간호기록(간호, Story 5.7 / FR-094). 부모 (staff)/layout 이 직원 보장 → 여기선 nursing.record
// 가드(미보유 → STAFF_HOME). 오더 없이도 간호 활동을 기록(처치 오더 연결은 선택 — 처치 워크리스트의
// 수행 액션이 소유). nav "간호기록" = nurse 역할 노출.
export default async function NurseNotesPage() {
  await requirePermission("nursing.record", STAFF_HOME);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-5">
        <h1 className="text-[18px] font-semibold text-foreground">간호기록</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          오늘 활성 내원을 선택해 일상 간호기록을 남깁니다.
        </p>
      </header>
      <NursingNotesPage />
    </div>
  );
}
