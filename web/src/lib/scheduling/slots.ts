import { apiFetch } from "@/lib/api/client";

// 동적 가용 슬롯(Story 6.2) 공용 타입·조회·표시 헬퍼. FastAPI 슬롯 응답의 거울(snake_case 유지 —
// camelCase 변환 금지, project-context). 슬롯 시각 start/end = ISO timestamptz(UTC) → KST 표시는 Intl.
// 읽기 = FastAPI service_role(가용성만; appointments RLS·active 의사 조인 때문에 직접조회 불가).

/** 슬롯 상태 — available(선택가능)·booked(마감)·time_off(휴진)·past(지남). */
export type SlotStatus = "available" | "booked" | "time_off" | "past";

/** FastAPI Slot 의 거울. start/end = ISO timestamptz(UTC). */
export type Slot = {
  start: string;
  end: string;
  status: SlotStatus;
};

/** FastAPI SlotGridResponse 의 거울. date = "YYYY-MM-DD"(KST). */
export type SlotGridResponse = {
  doctor_id: string;
  date: string;
  slot_minutes: number;
  slots: Slot[];
};

/** FastAPI SchedulingDoctor 의 거울 — 예약 피커용. */
export type BookableDoctor = {
  id: string;
  name: string;
  department_id: string | null;
};

/** 의사·날짜(KST)의 가용 슬롯 그리드(근무−휴진−booked예약, FR-012). 게이트 appointment.read. */
export function fetchAvailableSlots(doctorId: string, dateISO: string): Promise<SlotGridResponse> {
  const query = new URLSearchParams({ doctor_id: doctorId, date: dateISO });
  return apiFetch<SlotGridResponse>(`/v1/scheduling/slots?${query.toString()}`);
}

/** 예약 피커용 재직 의사(진료과 필터 옵션). 게이트 appointment.read. */
export function fetchBookableDoctors(departmentId?: string): Promise<BookableDoctor[]> {
  const query = departmentId ? `?${new URLSearchParams({ department_id: departmentId })}` : "";
  return apiFetch<BookableDoctor[]>(`/v1/scheduling/bookable-doctors${query}`);
}

/** 슬롯 시각 → KST "HH:MM"(저장 UTC·표시 KST, formatKstDateTime 정합). */
export function formatSlotTime(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** 오늘(KST) "YYYY-MM-DD" — 날짜 선택 기본값. */
export function todayKstISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

/**
 * 슬롯 상태 표시 메타 — 음영 비의존(UX-DR20): 라벨 + 글리프 + 채움/테두리/잉크 색을 다중 인코딩한다.
 * 6.2 는 읽기 전용(선택→예약 = 6.3) → selectable 은 시각 강조용이며 클릭 동작은 없다.
 */
export const SLOT_STATUS_META: Record<
  SlotStatus,
  { label: string; glyph: string; selectable: boolean; tileClass: string }
> = {
  available: {
    label: "예약 가능",
    glyph: "○",
    selectable: true,
    tileClass: "border-status-done/45 bg-status-done/12 text-status-done-ink",
  },
  booked: {
    label: "마감",
    glyph: "●",
    selectable: false,
    tileClass: "border-status-scheduled/40 bg-status-scheduled/12 text-status-scheduled",
  },
  time_off: {
    label: "휴진",
    glyph: "✕",
    selectable: false,
    tileClass: "border-status-cancelled/40 bg-status-cancelled/12 text-status-cancelled",
  },
  past: {
    label: "지남",
    glyph: "—",
    selectable: false,
    tileClass: "border-border bg-muted text-muted-foreground",
  },
};
