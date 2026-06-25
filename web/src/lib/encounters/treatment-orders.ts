import { apiFetch } from "@/lib/api/client";
import { type EncounterStatus } from "@/lib/reception/encounters";

// 처치 오더(treatment_orders, Story 5.4) 타입·API 호출. 전 필드 snake_case(camelCase 변환 금지).
// 오더=FastAPI(treatment.order)·조회=FastAPI(order.read). 처치 행위=fee_schedule 마스터 FK(free-text 차단).
// 검사·영상과 달리 exam_type 분류 축 없음(처치=간호 단일 라우팅, FR-070). TreatmentOrderResponse 거울(수동 정의).
// Story 5.7 확장: 처치 수행(perform)·일상 간호기록(nursing_record)·간호 워크리스트.

/** FastAPI TreatmentOrderResponse 의 거울. fee_* 는 fee_schedules 마스터 조인(읽기시점). */
export type TreatmentOrder = {
  id: string;
  encounter_id: string;
  fee_schedule_id: string;
  fee_code: string;
  fee_name: string;
  fee_category: string | null;
  amount_krw: number;
  coverage_type: string; // 급여 covered / 비급여 non_covered (5.5 pay-chip)
  status: string;
  ordered_by: string;
  ordered_by_name: string | null; // users 조인(추적 라인 지시자, 5.5)
  ordered_at: string;
  performed_by: string | null;
  performed_by_name: string | null; // users 조인(추적 라인 수행자, 5.5)
  performed_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** 오더 생성 요청 바디. fee_schedule_id=처치 행위(마스터 FK). 검사의 exam_type 없음. */
export type TreatmentOrderCreateBody = {
  fee_schedule_id: string;
};

function treatmentOrdersUrl(encounterId: string): string {
  return `/v1/encounters/${encounterId}/treatment-orders`;
}

/** 한 내원의 처치 오더 목록(최신순, GET). 게이트 order.read. */
export async function fetchTreatmentOrders(
  encounterId: string,
): Promise<TreatmentOrder[]> {
  return apiFetch<TreatmentOrder[]>(treatmentOrdersUrl(encounterId));
}

/** 처치 오더 생성(POST). 게이트 treatment.order. status='ordered'(지시) DB 강제. */
export async function createTreatmentOrder(
  encounterId: string,
  body: TreatmentOrderCreateBody,
): Promise<TreatmentOrder> {
  return apiFetch<TreatmentOrder>(treatmentOrdersUrl(encounterId), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** 처치 오더 취소(POST .../cancel·0056). 게이트 order.cancel. 미수행(ordered)만 — 수행분 409. */
export async function cancelTreatmentOrder(
  encounterId: string,
  orderId: string,
): Promise<TreatmentOrder> {
  return apiFetch<TreatmentOrder>(
    `${treatmentOrdersUrl(encounterId)}/${orderId}/cancel`,
    { method: "POST" },
  );
}

// ── 처치 수행·일상 간호기록·간호 워크리스트(Story 5.7 / FR-090·FR-092·FR-093·FR-094) ──────

/** FastAPI NursingWorklistItem 거울. 오늘 활성 내원 1행 + 미수행 처치·간호기록 건수(비-PII). */
export type NursingWorklistItem = {
  encounter_id: string;
  chart_no: string;
  patient_name: string;
  department_name: string;
  status: EncounterStatus; // registered·in_progress (StatusBadge 호환)
  created_at: string;
  pending_treatment_count: number; // 미수행(ordered) 처치 — 처치 워크리스트 진입 신호
  oldest_pending_ordered_at: string | null; // 가장 오래된 미수행 지시시각(지연 디텍터·UX-DR21 ⑥)
  nursing_record_count: number;
};

/** FastAPI NursingRecordResponse 거울. treatment_order_id=처치 수행 연결 / null=일상 기록. */
export type NursingRecord = {
  id: string;
  encounter_id: string;
  treatment_order_id: string | null;
  content: string;
  recorded_by: string;
  recorded_by_name: string | null;
  recorded_at: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** 처치 수행 요청 바디. content=처치기록 내용(선택·빈값이면 미생성). */
export type TreatmentPerformBody = {
  content?: string | null;
};

/** 일상 간호기록 생성 바디. content 필수(빈/공백 서버 422). */
export type NursingRecordCreateBody = {
  content: string;
};

/** 간호 워크리스트(오늘 활성 내원, GET). 게이트 treatment.perform ∨ nursing.record. */
export async function fetchNursingWorklist(): Promise<NursingWorklistItem[]> {
  return apiFetch<NursingWorklistItem[]>("/v1/nursing/worklist");
}

/** 처치 오더 수행(POST). 게이트 treatment.perform. 재수행 → 409 invalid_transition(FR-093). */
export async function performTreatmentOrder(
  encounterId: string,
  orderId: string,
  body: TreatmentPerformBody = {},
): Promise<TreatmentOrder> {
  return apiFetch<TreatmentOrder>(
    `/v1/encounters/${encounterId}/treatment-orders/${orderId}/perform`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

function nursingRecordsUrl(encounterId: string): string {
  return `/v1/encounters/${encounterId}/nursing-records`;
}

/** 한 내원의 간호기록 목록(최신순, GET). 게이트 order.read ∨ nursing.record. */
export async function fetchEncounterNursingRecords(
  encounterId: string,
): Promise<NursingRecord[]> {
  return apiFetch<NursingRecord[]>(nursingRecordsUrl(encounterId));
}

/** 일상 간호기록 생성(POST). 게이트 nursing.record. 오더 연결 없음(FR-094). */
export async function createNursingRecord(
  encounterId: string,
  body: NursingRecordCreateBody,
): Promise<NursingRecord> {
  return apiFetch<NursingRecord>(nursingRecordsUrl(encounterId), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// 지연 디텍터(UX-DR21 ⑥)는 order-safety.ts 의 elapsedMinutes·OVERDUE_THRESHOLD_MIN 재사용
// (워크리스트는 oldest_pending_ordered_at 으로 판정 — 별도 isOverdue 미정의·5.5 헬퍼 공유).
