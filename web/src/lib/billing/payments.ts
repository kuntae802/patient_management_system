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
  refunded_amount_krw: number; // 선납 환급액(취소·노쇼 7.9·순납부=paid-refunded)
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

// 진료비 계산서·영수증 문서(Story 7.5 / FR-113) — FastAPI ReceiptResponse 의 거울(전 필드 snake_case).
// finalized 수납 건만(GET·payment.read). 요양기관·환자(masked RRN)·진료·결제·발급 + 상세 라인(항목별
// 금액표는 클라가 category 집계). 금액=DB 산정값(클라는 표시 그룹핑만). 인쇄/PDF=브라우저(window.print).

/** 요양기관 정보(0049 clinic_profile 거울 — 영수증 헤더). */
export type ReceiptClinic = {
  name: string;
  biz_no: string;
  hira_no: string; // 요양기관기호
  address: string;
  ceo_name: string;
  phone: string;
};

/** 영수증 환자 정보 — 주민번호는 masked 만(full reveal 이월·PII 경계). */
export type ReceiptPatient = {
  name: string;
  chart_no: string;
  resident_no_masked: string; // 710314-2****** (masked only)
  insurance_type: string; // insuranceLabel 로 한글화
};

/** 영수증 진료 정보 — 진료과·담당의·진료기간(KST date). */
export type ReceiptEncounter = {
  department_name: string;
  doctor_name: string | null;
  treatment_started_on: string; // YYYY-MM-DD
  treatment_ended_on: string;
};

/** FastAPI ReceiptResponse 의 거울 — 법정 서식 「진료비 계산서·영수증」 데이터(7.5). */
export type Receipt = {
  clinic: ReceiptClinic;
  patient: ReceiptPatient;
  encounter: ReceiptEncounter;
  status: string; // finalized(영수증)
  payment_no: string | null;
  payment_method: string | null;
  finalized_at: string | null;
  issued_by_name: string | null; // 발급담당
  total_amount_krw: number;
  covered_amount_krw: number;
  non_covered_amount_krw: number;
  copay_amount_krw: number; // 본인부담 총액(납부할 금액·3행)
  insurer_amount_krw: number;
  paid_amount_krw: number; // 기납부(3행)
  due_amount_krw: number; // 납부할 금액 = copay - paid(3행)
  details: PaymentDetail[];
};

/** 문서 유형 — receipt=진료비 계산서·영수증(7.5), statement=진료비 세부산정내역서(7.6). 동일 ReceiptResponse 데이터의 다른 렌더링. */
export type DocumentType = "receipt" | "statement";

/**
 * finalized 수납 건의 문서 데이터(GET). 게이트 payment.read. 비-finalized → 409·빌드 전 → 404.
 * 영수증·세부산정내역서가 **동일 데이터**를 공유(라인 전 컬럼·진료기간 포함) — 문서별 렌더링은 web 컴포넌트.
 */
export async function fetchReceipt(encounterId: string): Promise<Receipt> {
  return apiFetch<Receipt>(`/v1/encounters/${encounterId}/payment/receipt`);
}

/**
 * 문서 인쇄/내보내기 = 감사 이벤트 기록(POST·204). 게이트 payment.read. 인쇄(Ctrl P)/PDF 저장 직전
 * 호출 → audit_logs 'read'(document_type=receipt/statement). UX-DR22 "민감 문서 인쇄/내보내기 자체가
 * 감사 이벤트". documentType 으로 영수증/세부산정내역서 내보내기를 구분 기록(동일 엔드포인트·RPC).
 */
export async function exportReceipt(
  encounterId: string,
  documentType: DocumentType = "receipt",
): Promise<void> {
  await apiFetch<null>(`/v1/encounters/${encounterId}/payment/receipt/export`, {
    method: "POST",
    body: JSON.stringify({ document_type: documentType }),
  });
}

/** 결제 수단 — 카드/현금/계좌이체(DB CHECK·Pydantic Literal 거울). */
export type PaymentMethod = "card" | "cash" | "transfer";

/**
 * 선결제(선수납, POST). 게이트 payment.manage. 진료 전(registered)·진료 중(in_progress)의 draft
 * 수납에 본인부담 추정액을 미리 받아 paid_amount_krw 에 누적(단일 누계) + billing_type→prepaid 전환.
 * 내원 상태 전이 없음(완료는 finalize). 이미 결제/취소 또는 금액≤0 → 409, 금액 검증 실패 → 422.
 */
export async function prepayPayment(
  encounterId: string,
  amountKrw: number,
  paymentMethod: PaymentMethod,
): Promise<Payment> {
  return apiFetch<Payment>(`/v1/encounters/${encounterId}/payment/prepay`, {
    method: "POST",
    body: JSON.stringify({ amount_krw: amountKrw, payment_method: paymentMethod }),
  });
}

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

/**
 * 내원 취소·정산(수가 미발생·선납 환급, POST). 게이트 payment.manage. settle_cancelled_visit RPC 가
 * cancel_encounter(registered→cancelled) + draft 수납 void + 선납 전액 환급(원결제수단)을 원자 처리.
 * 비-registered/scheduled 또는 비-draft → 409, encounter.cancel 미보유 → 403. reason=저민감 운영 사유.
 */
export async function settleCancelledVisit(
  encounterId: string,
  reason?: string | null,
): Promise<Payment> {
  return apiFetch<Payment>(`/v1/encounters/${encounterId}/payment/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? null }),
  });
}
