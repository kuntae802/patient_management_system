import { apiFetch } from "@/lib/api/client";

// 수납(billing) 타입·API 호출(Story 7.2 / FR-110). 전 필드 snake_case(camelCase 변환 금지).
// 집계 빌드=FastAPI(payment.manage)·조회=FastAPI(payment.read). 집계 로직은 build_payment DB 함수가 소유.
// FastAPI PaymentResponse·BillingWorklistPage 의 거울(수동 정의 — database.types.ts 미생성 프로젝트).

/** FastAPI PaymentDetailItem 의 거울 — 수납상세 라인(집계 시점 스냅샷). fee_item_id 보유=자동 집계 라인. */
export type PaymentDetail = {
  id: string;
  payment_id: string;
  fee_item_id: string | null; // 집계원(자동 라인 근거) — null=수기 라인(7.x)
  fee_schedule_id: string | null;
  code: string | null; // EDI 코드(스냅샷)
  name: string | null; // 행위명(스냅샷·비-PII)
  category: string | null; // 분류(진찰료/검사료/…)
  quantity: number;
  unit_amount_krw: number;
  amount_krw: number;
  coverage_type: string; // 급여 covered / 비급여 non_covered (pay-chip)
  copay_rate: number | null; // 본인부담률(7.3 채움)
  copay_amount_krw: number; // 본인부담금(7.3 채움)
  insurer_amount_krw: number; // 공단부담금(7.3 채움)
  created_at: string;
  updated_at: string;
};

/** FastAPI PaymentResponse 의 거울 — 수납 건(헤더 + 상세 라인). 금액 total/covered/non_covered=7.2 집계. */
export type Payment = {
  id: string;
  encounter_id: string;
  status: string; // draft=집계중(7.2)·finalized=결제완료(7.4)·cancelled
  billing_type: string; // postpaid 후수납 / prepaid 선수납(7.8)
  insurance_type: string; // 환자 보험유형(본인부담 산정 근거 표시·7.3·insuranceLabel 로 한글화)
  patient_name: string; // 신원 재진술 confirm·상시 배너(7.4·비-RRN denormalized)
  chart_no: string; // 차트번호(신원 재진술용)
  total_amount_krw: number;
  covered_amount_krw: number;
  non_covered_amount_krw: number;
  copay_amount_krw: number; // 본인부담금(환자 청구액·7.3 산정)
  insurer_amount_krw: number; // 공단부담금(7.3 산정)
  paid_amount_krw: number;
  payment_method: string | null; // 결제=7.4
  payment_no: string | null;
  finalized_at: string | null;
  finalized_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  details: PaymentDetail[];
};

/** FastAPI BillingWorklistItem 의 거울 — 정산 대상 내원 행(예상 총액=Σ fee_items 라이브). */
export type BillingWorklistItem = {
  encounter_id: string;
  encounter_no: string;
  patient_name: string;
  chart_no: string;
  department_name: string;
  status: string;
  consult_started_at: string | null;
  estimated_total_krw: number;
};

export type BillingWorklistPage = {
  data: BillingWorklistItem[];
  meta: { page: number; page_size: number; total: number };
};

/** 수납 워크리스트(정산 대상 내원 — in_progress·일자별, GET). 게이트 payment.read. 일자 미지정=KST 오늘. */
export async function fetchBillingWorklist(date?: string): Promise<BillingWorklistPage> {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  return apiFetch<BillingWorklistPage>(`/v1/billing/worklist${query}`);
}

/** 수납 건 집계 빌드(진입 시 자동 집계, 멱등 POST). 게이트 payment.manage. 자동발생 수가를 draft 로 집계. */
export async function buildPayment(encounterId: string): Promise<Payment> {
  return apiFetch<Payment>(`/v1/encounters/${encounterId}/payment`, {
    method: "POST",
  });
}

/** 한 내원의 수납 건 조회(헤더 + 라인, GET). 게이트 payment.read. 빌드 전 → 404. */
export async function fetchPayment(encounterId: string): Promise<Payment> {
  return apiFetch<Payment>(`/v1/encounters/${encounterId}/payment`);
}

/** 결제 수단 — 카드/현금/계좌이체(DB CHECK·Pydantic Literal 거울). */
export type PaymentMethod = "card" | "cash" | "transfer";

/**
 * 수납 finalize(결제 기록 + 내원 완료, POST). 게이트 payment.manage. draft → finalized 전이 +
 * complete_encounter(내원 in_progress→completed) 원자 호출. 주상병 미지정 → 422, 비-draft → 409.
 */
export async function finalizePayment(
  encounterId: string,
  paymentMethod: PaymentMethod,
): Promise<Payment> {
  return apiFetch<Payment>(`/v1/encounters/${encounterId}/payment/finalize`, {
    method: "POST",
    body: JSON.stringify({ payment_method: paymentMethod }),
  });
}
