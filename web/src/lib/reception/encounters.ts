import { z } from "zod";

import { apiFetch } from "@/lib/api/client";

// 내원(encounters) — 접수(Story 4.2) 타입·Zod 스키마·생성 호출. 전 필드 snake_case(camelCase 변환 금지).
// 쓰기 = FastAPI(apiFetch, encounter.register). 상태머신·감사는 DB 소유(0010) — 클라 재구현 금지.
// 타입은 수동 정의(database.types.ts 미생성) — FastAPI EncounterResponse 의 거울.

/** 내원 상태(0010 encounter_status 6값). */
export type EncounterStatus =
  | "scheduled"
  | "registered"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

/** 접수 경로(0010 visit_type). */
export type VisitType = "walk_in" | "reserved";

/** FastAPI EncounterResponse 의 거울(snake_case). encounters 는 비-PII(patient_id=FK·encounter_no=사람용 번호). */
export type Encounter = {
  id: string;
  encounter_no: string;
  patient_id: string;
  department_id: string;
  room_id: string | null;
  doctor_id: string | null;
  visit_type: VisitType;
  status: EncounterStatus;
  cancel_reason: string | null;
  registered_at: string | null;
  consult_started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  no_show_at: string | null;
  created_by: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** walk-in 접수 입력(클라 검증 1선) — 환자·진료과 선택 필수. visit_type/status 는 서버·DB 소유. */
export const walkInIntakeSchema = z.object({
  patient_id: z.string().min(1, "접수할 환자를 선택하세요"),
  department_id: z.string().min(1, "진료과를 선택하세요"),
});
export type WalkInIntakeValues = z.infer<typeof walkInIntakeSchema>;

/** walk-in 내원 생성(POST /v1/encounters). 성공 → Encounter(encounter_no·status='registered'). */
export async function createWalkInEncounter(values: WalkInIntakeValues): Promise<Encounter> {
  return apiFetch<Encounter>("/v1/encounters", {
    method: "POST",
    body: JSON.stringify({
      patient_id: values.patient_id,
      department_id: values.department_id,
    }),
  });
}

// 진료상태 표시 메타(0010 6값) — UX-DR6 status-badge 의 인라인 최소판(A3 풀 컴포넌트는 4.3).
// 접수(registered) 라벨은 raw 앰버 텍스트 대비 미달(3.43:1) → status-received-ink(5.75:1) 사용.
// 취소=취소선(색 비의존 중복 인코딩). 색은 Tailwind 시맨틱 토큰(globals.css status-*).
export const ENCOUNTER_STATUS_META: Record<
  EncounterStatus,
  { label: string; badgeClass: string }
> = {
  scheduled: {
    label: "예약",
    badgeClass: "border-status-scheduled/40 bg-status-scheduled/12 text-status-scheduled",
  },
  registered: {
    label: "접수",
    badgeClass: "border-status-received/40 bg-status-received/12 text-status-received-ink",
  },
  in_progress: {
    label: "진행중",
    badgeClass: "border-status-inprogress/40 bg-status-inprogress/12 text-status-inprogress",
  },
  completed: {
    label: "완료",
    badgeClass: "border-status-done/40 bg-status-done/12 text-status-done-ink",
  },
  cancelled: {
    label: "취소",
    badgeClass: "border-status-cancelled/40 bg-status-cancelled/12 text-status-cancelled line-through",
  },
  no_show: {
    label: "노쇼",
    badgeClass: "border-status-cancelled/40 bg-status-cancelled/12 text-status-cancelled",
  },
};
