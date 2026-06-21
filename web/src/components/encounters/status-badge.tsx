import { ENCOUNTER_STATUS_META, type EncounterStatus } from "@/lib/reception/encounters";
import { cn } from "@/lib/utils";

// UX-DR6 status-badge A3 — 글리프(○●◐✓✕) + 상태색 라벨로 진료상태를 색·도형·굵기 다중 인코딩한다
// (색 비의존, UX-DR20). 라벨 텍스트가 접근가능명(아이콘 단독 아님 → aria-label 불요). 취소=취소선.
// ENCOUNTER_STATUS_META 단일 소유(0010 6값) — 접수 라벨=status-received-ink(AA), 색=globals.css 토큰.
export function StatusBadge({
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
      {meta.label}
    </span>
  );
}
