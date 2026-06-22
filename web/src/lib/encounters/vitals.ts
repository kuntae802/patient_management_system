import { apiFetch } from "@/lib/api/client";
import { type EncounterStatus } from "@/lib/reception/encounters";

// 간호 활력징후(vital_signs, Story 5.6) 타입·API 호출. 전 필드 snake_case(camelCase 변환 금지).
// 기록=FastAPI(vital.record)·조회=FastAPI(encounter.read ∨ vital.record)·워크리스트=FastAPI(vital.record).
// 권한·감사·최소1개·범위는 DB/서버 소유. FastAPI VitalSignsResponse/VitalsWorklistItem 의 거울(수동 정의).

/** FastAPI VitalSignsResponse 의 거울. 6 항목 전부 nullable(부분 측정). recorded_by_name=users 조인. */
export type VitalSigns = {
  id: string;
  encounter_id: string;
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  body_temp: number | null;
  respiratory_rate: number | null;
  spo2: number | null;
  notes: string | null;
  recorded_by: string;
  recorded_by_name: string | null;
  recorded_at: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** 활력 기록 요청 바디(쓰기). 6 항목 전부 선택 — 단, 서버가 최소 1개 강제(전부 빈 값 422). */
export type VitalSignsCreateBody = {
  systolic?: number | null;
  diastolic?: number | null;
  pulse?: number | null;
  body_temp?: number | null;
  respiratory_rate?: number | null;
  spo2?: number | null;
  notes?: string | null;
};

/** FastAPI VitalsWorklistItem 의 거울. 오늘 활성 내원 1행 — 비-PII 투영. */
export type VitalsWorklistItem = {
  encounter_id: string;
  chart_no: string;
  patient_name: string;
  department_name: string;
  status: EncounterStatus; // 워크리스트는 registered·in_progress 만(StatusBadge 호환)
  created_at: string;
  latest_vital_recorded_at: string | null;
};

/** 활력 측정 항목 키(입력 폼·표시·최소1개 판정 공유). */
export type VitalField =
  | "systolic"
  | "diastolic"
  | "pulse"
  | "body_temp"
  | "respiratory_rate"
  | "spo2";

export const VITAL_FIELDS: VitalField[] = [
  "systolic",
  "diastolic",
  "pulse",
  "body_temp",
  "respiratory_rate",
  "spo2",
];

function vitalsUrl(encounterId: string): string {
  return `/v1/encounters/${encounterId}/vitals`;
}

/** 한 내원의 활력징후 목록(최신순, GET). 게이트 encounter.read ∨ vital.record. */
export async function fetchEncounterVitals(encounterId: string): Promise<VitalSigns[]> {
  return apiFetch<VitalSigns[]>(vitalsUrl(encounterId));
}

/** 활력징후 기록(POST). 게이트 vital.record. 최소 1개 측정값(서버 422). */
export async function createVitalSigns(
  encounterId: string,
  body: VitalSignsCreateBody,
): Promise<VitalSigns> {
  return apiFetch<VitalSigns>(vitalsUrl(encounterId), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** 활력 워크리스트(오늘 활성 내원, GET). 게이트 vital.record(간호 진입). */
export async function fetchVitalsWorklist(): Promise<VitalsWorklistItem[]> {
  return apiFetch<VitalsWorklistItem[]>("/v1/nursing/vitals-worklist");
}

// 성인 임상 정상범위(보수적·표시 전용) — 범위 밖이면 표시 강조(danger). DB CHECK(물리 안전망)와 별개,
// 능동 경고/can't-miss 배너는 비범위(표시 강조까지만). null=미측정(비정상 아님).
const NORMAL_RANGES: Record<VitalField, readonly [number, number]> = {
  systolic: [90, 139],
  diastolic: [60, 89],
  pulse: [60, 100],
  body_temp: [36.0, 37.5],
  respiratory_rate: [12, 20],
  spo2: [95, 100],
};

/** 임상 정상범위 밖이면 true(표시 강조용). null/미측정 → false. */
export function isAbnormal(field: VitalField, value: number | null): boolean {
  if (value === null) return false;
  const [lo, hi] = NORMAL_RANGES[field];
  return value < lo || value > hi;
}

/** 측정값이 하나라도 있으면 true(빈 활력 제출 가드 — 클라 1차선, 서버 422 가 권위). */
export function hasAnyVital(body: VitalSignsCreateBody): boolean {
  return VITAL_FIELDS.some((f) => body[f] !== null && body[f] !== undefined);
}

/** 활력 항목 표시 라벨·단위(입력 폼·표시 공유). */
export const VITAL_LABELS: Record<VitalField, { label: string; unit: string }> = {
  systolic: { label: "수축기 혈압", unit: "mmHg" },
  diastolic: { label: "이완기 혈압", unit: "mmHg" },
  pulse: { label: "맥박", unit: "bpm" },
  body_temp: { label: "체온", unit: "°C" },
  respiratory_rate: { label: "호흡수", unit: "/min" },
  spo2: { label: "SpO₂", unit: "%" },
};
