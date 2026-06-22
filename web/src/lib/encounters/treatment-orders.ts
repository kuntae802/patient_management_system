import { apiFetch } from "@/lib/api/client";

// 처치 오더(treatment_orders, Story 5.4) 타입·API 호출. 전 필드 snake_case(camelCase 변환 금지).
// 오더=FastAPI(treatment.order)·조회=FastAPI(order.read). 처치 행위=fee_schedule 마스터 FK(free-text 차단).
// 검사·영상과 달리 exam_type 분류 축 없음(처치=간호 단일 라우팅, FR-070). TreatmentOrderResponse 거울(수동 정의).

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
