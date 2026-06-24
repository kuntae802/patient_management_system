import { RESULT_FLAG_META, type ExamResultFlag } from "@/lib/patient/encounter-detail";
import { cn } from "@/lib/utils";

// 환자용 검사 결과 플래그 배지(Story 8.2·UX-DR20) — 정상/주의를 색 + 글리프 + 라벨로 중복 인코딩
// (색 비의존·저가 임상 모니터 + 색약 동시 대응). 라벨 텍스트가 접근가능명(아이콘 단독 아님 → aria-label
// 불요). PatientStatusBadge 패턴 미러(ENCOUNTER_STATUS_META → RESULT_FLAG_META).
export function ExamResultBadge({
  flag,
  className,
}: {
  flag: ExamResultFlag;
  className?: string;
}) {
  const meta = RESULT_FLAG_META[flag];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold",
        meta.badgeClass,
        className,
      )}
    >
      <span aria-hidden className="text-[10px] leading-none">
        {meta.glyph}
      </span>
      {meta.label}
    </span>
  );
}
