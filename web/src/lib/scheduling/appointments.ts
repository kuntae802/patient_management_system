import { apiFetch } from "@/lib/api/client";

// 예약 생성·캘린더(Story 6.3) 공용 타입·조회·표시 헬퍼. FastAPI 응답 거울(snake_case 유지).
// 슬롯 시각 = ISO timestamptz(UTC) → KST 표시는 Intl(formatSlotTime, lib/scheduling/slots).

/** 캘린더 슬롯 상태 = 가용(available/time_off/past) + 예약 overlay(confirmed/completed/no_show/cancelled). */
export type CalendarSlotStatus =
  | "available"
  | "confirmed"
  | "completed"
  | "no_show"
  | "cancelled"
  | "time_off"
  | "past";

export type CalendarSlot = {
  start: string;
  end: string;
  status: CalendarSlotStatus;
  patient_name: string | null;
  appointment_id: string | null;
};

export type DoctorColumn = {
  doctor_id: string;
  doctor_name: string;
  slots: CalendarSlot[];
};

export type CalendarResponse = {
  date: string;
  slot_minutes: number;
  doctors: DoctorColumn[];
};

/** FastAPI AppointmentCreate 거울. scheduled_end 는 서버가 +SLOT_MINUTES 계산(전송 안 함). */
export type AppointmentCreate = {
  department_id: string;
  doctor_id: string;
  patient_id: string;
  scheduled_start: string;
  note?: string | null;
  sms_opt_in: boolean;
};

export type AppointmentResponse = {
  id: string;
  patient_id: string;
  doctor_id: string;
  department_id: string;
  room_id: string | null;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
  note: string | null;
  sms_opt_in: boolean;
  cancel_reason: string | null;
  cancelled_at: string | null;
  no_show_at: string | null;
  completed_at: string | null;
  created_at: string;
};

/** 도착 접수 응답(내원 — EncounterResponse 부분 거울). 대기 현황판 진입 확인용. */
export type CheckInResult = {
  id: string;
  encounter_no: string;
  patient_id: string;
  visit_type: string;
  status: string;
};

/** 환자 노쇼 상태(Story 6.7·FastAPI NoShowStatus 거울). blocked=초과(count>threshold)·서버 권위. */
export type NoShowStatus = {
  patient_id: string;
  no_show_count: number;
  threshold: number;
  blocked: boolean;
};

/**
 * 예약 생성(booking-peek 저장). 게이트 appointment.create.
 * 더블부킹 → 409 double_booking · 노쇼 임계 초과 → 409 no_show_threshold_exceeded(ApiError).
 */
export function createAppointment(payload: AppointmentCreate): Promise<AppointmentResponse> {
  return apiFetch<AppointmentResponse>("/v1/scheduling/appointments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** 환자 노쇼 상태 조회(booking-peek 프로액티브 배지). 게이트 appointment.read. */
export function fetchNoShowStatus(patientId: string): Promise<NoShowStatus> {
  const query = new URLSearchParams({ patient_id: patientId });
  return apiFetch<NoShowStatus>(`/v1/scheduling/no-show-status?${query.toString()}`);
}

/** 예약 취소(booked→cancelled). 게이트 appointment.update. 잘못된 전이 → 409(ApiError). */
export function cancelAppointment(id: string, reason?: string): Promise<AppointmentResponse> {
  return apiFetch<AppointmentResponse>(`/v1/scheduling/appointments/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? null }),
  });
}

/** 예약 노쇼(booked→no_show). 게이트 appointment.update. */
export function noShowAppointment(id: string, reason?: string): Promise<AppointmentResponse> {
  return apiFetch<AppointmentResponse>(`/v1/scheduling/appointments/${id}/no-show`, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? null }),
  });
}

/** 예약 변경(새 의사·시각). 게이트 appointment.update. 슬롯 불가 422·더블부킹 409(ApiError). */
export function rescheduleAppointment(
  id: string,
  payload: { doctor_id: string; scheduled_start: string },
): Promise<AppointmentResponse> {
  return apiFetch<AppointmentResponse>(`/v1/scheduling/appointments/${id}/reschedule`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** 예약 환자 도착 접수 → reserved registered 내원 생성(대기 진입) + 예약 completed. 게이트 appointment.update. */
export function checkInReservation(id: string): Promise<CheckInResult> {
  return apiFetch<CheckInResult>(`/v1/scheduling/appointments/${id}/check-in`, {
    method: "POST",
  });
}

/** 진료과·날짜(KST)의 예약 캘린더(의사 열 × 슬롯). 게이트 appointment.read. */
export function fetchDayCalendar(
  departmentId: string,
  dateISO: string,
): Promise<CalendarResponse> {
  const query = new URLSearchParams({ department_id: departmentId, date: dateISO });
  return apiFetch<CalendarResponse>(`/v1/scheduling/calendar?${query.toString()}`);
}

/**
 * 캘린더 슬롯 상태 표시 메타 — 음영 비의존(UX-DR15·DR20): 라벨 + 글리프 + 채움/테두리/패턴 다중 인코딩.
 * A3 색: 확정=인디고◐(status-inprogress)·완료=그린✓(status-done)·노쇼=앰버●(status-received)·
 * 취소=로즈✕ 취소선(status-cancelled)·휴진=회색 빗금(non-interactive). available 만 클릭(예약 생성).
 */
export const CALENDAR_STATUS_META: Record<
  CalendarSlotStatus,
  { label: string; glyph: string; selectable: boolean; tileClass: string }
> = {
  available: {
    label: "예약 가능",
    glyph: "○",
    selectable: true,
    tileClass:
      "border-primary/45 bg-primary/8 text-foreground hover:bg-primary/15 cursor-pointer",
  },
  confirmed: {
    label: "확정",
    glyph: "◐",
    selectable: false,
    tileClass: "border-status-inprogress/45 bg-status-inprogress/12 text-status-inprogress",
  },
  completed: {
    label: "완료",
    glyph: "✓",
    selectable: false,
    tileClass: "border-status-done/45 bg-status-done/12 text-status-done-ink",
  },
  no_show: {
    label: "노쇼",
    glyph: "●",
    selectable: false,
    tileClass: "border-status-received/45 bg-status-received/12 text-status-received-ink",
  },
  cancelled: {
    label: "취소",
    glyph: "✕",
    selectable: false,
    tileClass: "border-status-cancelled/40 bg-status-cancelled/12 text-status-cancelled line-through",
  },
  time_off: {
    label: "휴진",
    glyph: "✕",
    selectable: false,
    tileClass:
      "border-border bg-[repeating-linear-gradient(45deg,transparent,transparent_5px,rgb(0_0_0/0.06)_5px,rgb(0_0_0/0.06)_8px)] text-muted-foreground",
  },
  past: {
    label: "지남",
    glyph: "—",
    selectable: false,
    tileClass: "border-border bg-muted text-muted-foreground",
  },
};
