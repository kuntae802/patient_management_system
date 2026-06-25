import { PaymentHistory } from "@/components/reception/payment-history";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 수납 내역(완료 finalized 수납 재조회·재출력) — 게이트 payment.read(조회 전용). 행의 "영수증 보기" →
// /reception/billing/{encounter_id}(billing-detail)에서 finalized 완료 패널 → 영수증·내역서·처방전 재출력.
// ⚠️ static segment "history" 는 동적 [encounterId] 보다 우선 매칭(Next 라우팅) → 충돌 없음.
export default async function PaymentHistoryPage() {
  await requirePermission("payment.read", STAFF_HOME);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <PaymentHistory />
    </div>
  );
}
