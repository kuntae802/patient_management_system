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
  // 호출 상태(0011 — 호출은 상태 전이 아님). called_at/call_count 로 중복 호출 가시화.
  called_at: string | null;
  call_count: number;
  last_called_by: string | null;
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

// 진료상태 표시 메타(0010 6값) — UX-DR6 status-badge A3. 색 + 글리프(○●◐✓✕) + 굵기 다중 인코딩
// (색 비의존, UX-DR20). 접수(registered) 라벨은 raw 앰버 대비 미달(3.43:1) → status-received-ink
// (5.75:1) 사용. 취소=취소선. 색은 Tailwind 시맨틱 토큰(globals.css status-*). glyph 는 StatusBadge 소비.
export const ENCOUNTER_STATUS_META: Record<
  EncounterStatus,
  { label: string; glyph: string; badgeClass: string }
> = {
  scheduled: {
    label: "예약",
    glyph: "○",
    badgeClass: "border-status-scheduled/40 bg-status-scheduled/12 text-status-scheduled",
  },
  registered: {
    label: "접수",
    glyph: "●",
    badgeClass: "border-status-received/40 bg-status-received/12 text-status-received-ink",
  },
  in_progress: {
    label: "진행중",
    glyph: "◐",
    badgeClass: "border-status-inprogress/40 bg-status-inprogress/12 text-status-inprogress",
  },
  completed: {
    label: "완료",
    glyph: "✓",
    badgeClass: "border-status-done/40 bg-status-done/12 text-status-done-ink",
  },
  cancelled: {
    label: "취소",
    glyph: "✕",
    badgeClass: "border-status-cancelled/40 bg-status-cancelled/12 text-status-cancelled line-through",
  },
  no_show: {
    label: "노쇼",
    glyph: "✕",
    badgeClass: "border-status-cancelled/40 bg-status-cancelled/12 text-status-cancelled",
  },
};

// ── 대기 현황판(Story 4.3) — 목록 타입·조회·호출·헬퍼. 전 필드 snake_case(camelCase 변환 금지). ──

/** 대기 현황판 행(FastAPI EncounterListItem 거울) — 내원 + 호출 상태 + denormalized 표시 필드(조인). */
export type EncounterListItem = {
  id: string;
  encounter_no: string;
  patient_id: string;
  department_id: string;
  room_id: string | null;
  doctor_id: string | null;
  visit_type: VisitType;
  status: EncounterStatus;
  registered_at: string | null;
  consult_started_at: string | null;
  called_at: string | null;
  call_count: number;
  is_active: boolean;
  created_at: string;
  // 조인 표시 필드(보드 렌더용 — 오환자 방지 단서). raw RRN/연락처 미포함(비-PII).
  patient_name: string;
  chart_no: string;
  department_name: string;
  room_name: string | null;
  doctor_name: string | null;
};

/** 목록 페이지(표준 봉투 {data, meta}). */
export type EncounterPage = {
  data: EncounterListItem[];
  meta: { page: number; page_size: number; total: number };
};

/** 상태 그룹 순서(활성도 순, UX-DR7) — 섹션 렌더 순. */
export const STATUS_GROUP_ORDER: readonly EncounterStatus[] = [
  "in_progress",
  "registered",
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
];

/** 종결(접힘+muted) 상태 — 완료/취소/노쇼(시야에서 내림). */
export const TERMINAL_STATUSES: ReadonlySet<EncounterStatus> = new Set([
  "completed",
  "cancelled",
  "no_show",
]);

export type EncounterListParams = {
  department_id: string;
  status?: EncounterStatus[];
  on_date?: string; // YYYY-MM-DD(KST). 미지정 시 서버가 오늘.
};

/** 대기 현황판 목록 조회(GET /v1/encounters). 진료과 필수·상태·일자 필터. */
export async function fetchEncounters(params: EncounterListParams): Promise<EncounterPage> {
  const q = new URLSearchParams();
  q.set("department_id", params.department_id);
  (params.status ?? []).forEach((s) => q.append("status", s));
  if (params.on_date) q.set("on_date", params.on_date);
  // 하루치 진료과 집합은 한 페이지로 그룹핑 — API 최대(500)로 절단 가능성 최소화. 초과 시 보드가
  // meta.total 로 절단을 표시(no-silent-cap). 활성도 순이라 절단되는 건 종결 tail(대기 행 아님).
  q.set("page_size", "500");
  return apiFetch<EncounterPage>(`/v1/encounters?${q.toString()}`);
}

/** 환자 호출(POST /v1/encounters/{id}/call) — 호출 상태 기록(FR-023). registered 행만(아니면 409). */
export async function callEncounter(encounterId: string): Promise<Encounter> {
  return apiFetch<Encounter>(`/v1/encounters/${encounterId}/call`, { method: "POST" });
}

/** 예약 환자 도착 접수(POST /v1/encounters/{id}/register, 4.2 재사용) — scheduled→registered. */
export async function registerEncounter(encounterId: string): Promise<Encounter> {
  return apiFetch<Encounter>(`/v1/encounters/${encounterId}/register`, { method: "POST" });
}

/** 대기 경과 분(from 이후 now 까지). from 없으면 null. 음수 방지(미래 시각 → 0). */
export function waitMinutes(fromIso: string | null, nowMs: number = Date.now()): number | null {
  if (!fromIso) return null;
  const t = new Date(fromIso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 60000));
}

/**
 * 다음 호출 대상 — 가장 오래 대기한 **미호출** registered 내원. 전부 호출됐으면 가장 오래된 registered
 * (재호출 허용). 없으면 null. 정렬: registered_at asc → encounter_no asc(접수 순번 = 대기 순번).
 */
export function nextCallCandidate(items: EncounterListItem[]): EncounterListItem | null {
  const waiting = items
    .filter((e) => e.status === "registered")
    .sort(
      (a, b) =>
        (a.registered_at ?? "").localeCompare(b.registered_at ?? "") ||
        a.encounter_no.localeCompare(b.encounter_no),
    );
  if (waiting.length === 0) return null;
  return waiting.find((e) => !e.called_at) ?? waiting[0];
}
