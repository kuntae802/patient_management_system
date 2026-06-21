import { cn } from "@/lib/utils";
import { formatSlotTime, SLOT_STATUS_META, type Slot } from "@/lib/scheduling/slots";

// 동적 가용 슬롯 그리드(Story 6.2 / AC2). 각 슬롯 = 채움+테두리+라벨+글리프로 4상태를 다중 인코딩
// (음영 비의존, UX-DR20). 비활성(booked/time_off/past)은 aria-disabled — 6.2 는 읽기 전용 표시
// (선택→예약 인터랙션은 6.3 캘린더·booking-peek). 빈 가용은 명시 빈-상태(placeholder 단독 의존 금지).
export function SlotGrid({ slots }: { slots: Slot[] }) {
  if (slots.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-[13px] text-muted-foreground">
        이 날짜에 가능한 슬롯이 없습니다.
      </p>
    );
  }
  return (
    <ul
      aria-label="가용 슬롯"
      className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2"
    >
      {slots.map((slot) => {
        const meta = SLOT_STATUS_META[slot.status];
        return (
          <li
            key={slot.start}
            data-status={slot.status}
            className={cn(
              "flex flex-col gap-0.5 rounded-md border px-2.5 py-1.5",
              meta.tileClass,
              !meta.selectable && "opacity-90",
            )}
          >
            <span className="text-[13px] font-semibold tabular-nums">
              {formatSlotTime(slot.start)}
            </span>
            <span className="flex items-center gap-1 text-[11px] font-medium">
              <span aria-hidden className="text-[9px] leading-none">
                {meta.glyph}
              </span>
              {meta.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
