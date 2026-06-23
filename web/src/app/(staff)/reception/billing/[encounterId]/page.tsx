import { BillingDetail } from "@/components/reception/billing-detail";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 수납 집계 상세(원무, Story 7.2 / FR-110·UX-DR14). 부모 (staff)/layout 이 직원 보장 → payment.manage 가드
// (미보유 → STAFF_HOME). ⚠️ 가드 = 쓰기 권한(payment.manage): 진입 시 컴포넌트가 build_payment(POST·manage)를
// 멱등 호출하므로 페이지 게이트도 manage 로 정렬(payment.read 만 보유한 doctor 가 막다른 403 화면에 안 들어가게 —
// 코드리뷰 patch). doctor 읽기 전용 수납 조회(GET)는 이월 ⑤. 라우트 키 = 불투명 encounter_id(URL=PII 불가).
// build_payment → 자동발생 수가를 draft 수납 건으로 집계·표시("자동" 마커). finalize·결제·내원완료는 Story 7.4.
export default async function ReceptionBillingDetailPage({
  params,
}: {
  params: Promise<{ encounterId: string }>;
}) {
  await requirePermission("payment.manage", STAFF_HOME);
  const { encounterId } = await params;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <BillingDetail encounterId={encounterId} />
    </div>
  );
}
