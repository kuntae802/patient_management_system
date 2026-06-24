import { apiFetch } from "@/lib/api/client";
import type { PaymentDetail, Receipt } from "@/lib/billing/payments";

// 환자 포털 '마이' 탭 수납·영수증(Story 8.3·FR-122·세션 uid 스코프) 타입·조회·표시 헬퍼. FastAPI
// PatientPaymentCard/ReceiptResponse 의 거울(snake_case — camelCase 변환 금지, project-context).
// finalized 만 노출. 영수증 문서(법정 서식 데이터)는 7.5 Receipt 재사용 — 친화 요약(화면)·
// ReceiptDocument(인쇄)이 동일 데이터 공유. patient_id 는 서버가 세션에서 도출(클라 미수용·본인 외 0건).

/** FastAPI PatientPaymentCard 거울 — 본인 finalized 수납 카드(비-PII 결제 메타·raw RRN/연락처 없음). */
export type PatientPaymentCard = {
  encounter_id: string; // 영수증 상세 라우팅 키(불투명 UUID)
  payment_no: string | null;
  clinic_name: string;
  department_name: string;
  treatment_date: string | null; // YYYY-MM-DD(KST 진료일)
  finalized_at: string | null; // ISO timestamptz(결제 완료 시각)
  total_amount_krw: number;
  paid_amount_krw: number; // 내가 낸 금액(카드 강조)
  payment_method: string | null;
  status: string; // finalized(고정)
};

/** 본인 finalized 수납 카드 목록(GET /v1/patients/me/payments) — 최근순·세션 uid 스코프. 직원 → 403. */
export function fetchSelfPayments(): Promise<PatientPaymentCard[]> {
  return apiFetch<PatientPaymentCard[]>("/v1/patients/me/payments");
}

/**
 * 본인 내원 1건의 영수증 데이터(GET /v1/patients/me/encounters/{id}/receipt) — 7.5 Receipt 재사용.
 * 소유 미일치(타인 id·미연결)·비-finalized → 404(IDOR 차단·존재/비소유 구분 노출 금지).
 */
export function fetchSelfReceipt(encounterId: string): Promise<Receipt> {
  return apiFetch<Receipt>(`/v1/patients/me/encounters/${encounterId}/receipt`);
}

/** 항목 대분류(category)별 금액 합 — 친화 요약 표시용. 적재 순서 보존·null/빈값 → "기타". */
export type CategoryAmount = { category: string; amount: number };

/**
 * 라인을 대분류별로 묶어 amount_krw 합산(표시 그룹핑 — pricing 아님·금액은 DB 산정값).
 * receipt-document 의 aggregateByCategory(급여/공단 분해)와 달리 환자 친화 요약은 항목·합계만.
 */
export function aggregateAmountByCategory(details: PaymentDetail[]): CategoryAmount[] {
  const order: string[] = [];
  const sums = new Map<string, number>();
  for (const d of details) {
    const category = d.category?.trim() ? d.category : "기타";
    if (!sums.has(category)) {
      sums.set(category, 0);
      order.push(category);
    }
    sums.set(category, (sums.get(category) ?? 0) + d.amount_krw);
  }
  return order.map((c) => ({ category: c, amount: sums.get(c) ?? 0 }));
}
