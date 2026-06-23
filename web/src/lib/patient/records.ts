import { apiFetch } from "@/lib/api/client";
import type { EncounterStatus, VisitType } from "@/lib/reception/encounters";

// 환자 포털 "내 기록"(Story 8.1·FR-120·세션 uid 스코프) 타입·조회·표시 헬퍼. FastAPI
// PatientEncounterCard 의 거울(snake_case 유지 — camelCase 변환 금지, project-context). 시각=ISO
// timestamptz(UTC) → 환자 표시는 12시간 KST(오후 2:30·UX-DR17). 게이트=get_current_patient(직원 403).
// patient_id 는 서버가 세션에서 도출(클라 미수용 — 본인 외 데이터 0건).

/** FastAPI PatientEncounterCard 거울. 비-PII(내원 메타 + 진단 마스터 부연 — raw RRN/연락처 없음). */
export type PatientEncounterCard = {
  id: string;
  encounter_no: string;
  status: EncounterStatus;
  visit_type: VisitType;
  department_name: string;
  doctor_name: string | null;
  scheduled_start: string | null;
  registered_at: string | null;
  consult_started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  cancel_reason: string | null;
  primary_diagnosis_name: string | null;
  primary_diagnosis_friendly_note: string | null;
};

/** 본인 내원 이력 카드(GET /v1/patients/me/encounters) — 최근순·세션 uid 스코프. 직원 → 403. */
export function fetchSelfEncounters(): Promise<PatientEncounterCard[]> {
  return apiFetch<PatientEncounterCard[]>("/v1/patients/me/encounters");
}

// 환자 톤 상태 라벨(0010 6값) — 직원 ENCOUNTER_STATUS_META(노쇼 등)와 별개의 따뜻한 표현(UX-DR17).
// 색 비의존: 라벨 텍스트 자체가 접근가능명(StatusBadge A3 패턴 — glyph/badgeClass 는 직원 메타 재사용).
export const PATIENT_STATUS_LABEL: Record<EncounterStatus, string> = {
  scheduled: "예약",
  registered: "접수",
  in_progress: "진료 중",
  completed: "완료",
  cancelled: "취소",
  no_show: "미방문",
};

/** 카드 대표 일시(상태 무관 정렬·표시): 진찰시작 → 접수 → 예약 → 생성 순 폴백. */
export function visitTimestamp(card: PatientEncounterCard): string {
  return (
    card.consult_started_at ?? card.registered_at ?? card.scheduled_start ?? card.created_at
  );
}

/** 시각 접미 라벨 — 진찰했으면 "진료", 예약 내원이면 "예약", 아니면 "접수"(쉬운 말). */
export function visitTimeSuffix(card: PatientEncounterCard): string {
  if (card.consult_started_at) return "진료";
  if (card.visit_type === "reserved") return "예약";
  return "접수";
}

/** ISO timestamptz → KST "2026. 6. 19. (금)"(내 기록 카드 날짜). */
export function formatVisitDate(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(iso));
}

/** ISO timestamptz → KST 12시간 "오후 2:30"(환자용·UX-DR17·직원 24h 와 별개). */
export function formatVisitTime(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** 카드 대표 연도(그룹 캡션용·KST) — 숫자만("2026"). ko-KR 은 "2026년"(년 접미)이라 en-CA 로 추출. */
export function visitYear(card: PatientEncounterCard): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
  }).format(new Date(visitTimestamp(card)));
}
