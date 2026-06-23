import { BillingWorklist } from "@/components/reception/billing-worklist";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 수납 워크리스트(원무, Story 7.2 / FR-110). 부모 (staff)/layout 이 직원 보장 → 여기선 권한만 가드.
// payment.read 미보유 → STAFF_HOME 강등. 오늘 정산 대상(in_progress) 내원 목록 → 선택 시 집계 상세.
// 수납 메뉴는 nav 가 reception 역할로 노출(staff-nav) — 진짜 권위는 FastAPI(403)·RLS. 집계 빌드는
// 상세 화면 진입 시 payment.manage 로 수행(원무 보유). 조회는 payment.read(의사도 보유하나 nav 미노출).
export default async function ReceptionBillingPage() {
  await requirePermission("payment.read", STAFF_HOME);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-5">
        <h1 className="text-[18px] font-semibold text-foreground">수납</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          오늘 진료 중인 내원의 자동 산정 수가를 집계해 정산합니다.
        </p>
      </header>
      <BillingWorklist />
    </div>
  );
}
