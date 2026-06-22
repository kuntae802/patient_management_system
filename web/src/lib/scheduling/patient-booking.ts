import { apiFetch } from "@/lib/api/client";
import type { AppointmentResponse } from "@/lib/scheduling/appointments";
import type { BookableDoctor, SlotGridResponse } from "@/lib/scheduling/slots";

// 환자 본인 예약(Story 6.5·세션 uid 스코프) 공용 타입·조회·표시 헬퍼. FastAPI 응답의 거울
// (snake_case 유지 — camelCase 변환 금지, project-context). 슬롯 시각 = ISO timestamptz(UTC) →
// 환자 표시는 12시간(오후 2:30·UX-DR17). 게이트 = get_current_patient(직원 403). patient_id 는
// 서버가 세션에서 도출(클라 미전송) — createSelfAppointment 페이로드에 patient_id 없음.

/** FastAPI SelfAppointmentCreate 거울. ⚠️ patient_id 없음(서버 도출)·note 없음. */
export type SelfAppointmentCreate = {
  department_id: string;
  doctor_id: string;
  scheduled_start: string;
  sms_opt_in: boolean;
};

/** 환자 예약용 재직 의사(진료과 필터 옵션). 게이트 get_current_patient. */
export function fetchSelfBookableDoctors(departmentId?: string): Promise<BookableDoctor[]> {
  const query = departmentId ? `?${new URLSearchParams({ department_id: departmentId })}` : "";
  return apiFetch<BookableDoctor[]>(`/v1/scheduling/me/bookable-doctors${query}`);
}

/** 의사·날짜(KST)의 본인 예약 가용 슬롯 그리드(근무−휴진−booked예약·FR-010). 게이트 get_current_patient. */
export function fetchSelfSlots(doctorId: string, dateISO: string): Promise<SlotGridResponse> {
  const query = new URLSearchParams({ doctor_id: doctorId, date: dateISO });
  return apiFetch<SlotGridResponse>(`/v1/scheduling/me/slots?${query.toString()}`);
}

/** 본인 예약 생성(booked). 게이트 get_current_patient. 더블부킹 → 409 double_booking·미연결 → 409
 *  no_self_patient·과거/슬롯 불가 → 422(ApiError). patient_id 는 서버가 세션에서 도출. */
export function createSelfAppointment(
  payload: SelfAppointmentCreate,
): Promise<AppointmentResponse> {
  return apiFetch<AppointmentResponse>("/v1/scheduling/me/appointments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** 슬롯 시각 → KST 12시간 "오후 2:30"(환자용·UX-DR17). 직원 formatSlotTime(24h) 과 별개. */
export function formatSlotTime12h(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** "YYYY-MM-DD"(KST) → "6월 23일 (월)"(쉬운 말 확인용). */
export function formatKstDateLong(dateISO: string): string {
  // 정오(UTC)로 고정해 KST 날짜 경계 흔들림 방지(날짜만 필요).
  const d = new Date(`${dateISO}T12:00:00Z`);
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(d);
}
