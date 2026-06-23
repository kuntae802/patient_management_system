import { PATIENT_STATUS_LABEL } from "@/lib/patient/records";
import { ENCOUNTER_STATUS_META, type EncounterStatus } from "@/lib/reception/encounters";
import { cn } from "@/lib/utils";

// 환자용 A3 상태 배지(Story 8.1·UX-DR17) — 직원 StatusBadge 의 A3 글리프(○●◐✓✕)+상태색을 재사용하되
// (색 비의존·UX-DR20) 라벨만 환자 톤(PATIENT_STATUS_LABEL: 노쇼→미방문 등). 라벨 텍스트가 접근가능명
// (아이콘 단독 아님 → aria-label 불요). 취소=취소선(직원 메타 badgeClass 상속).
export function PatientStatusBadge({
  status,
  className,
}: {
  status: EncounterStatus;
  className?: string;
}) {
  const meta = ENCOUNTER_STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[12px] font-medium",
        meta.badgeClass,
        className,
      )}
    >
      <span aria-hidden className="text-[10px] leading-none">
        {meta.glyph}
      </span>
      {PATIENT_STATUS_LABEL[status]}
    </span>
  );
}
