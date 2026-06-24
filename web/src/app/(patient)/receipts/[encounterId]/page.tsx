import { redirect } from "next/navigation";

import { ReceiptDetail } from "@/components/portal/receipt-detail";
import { isStaffRole } from "@/lib/auth/branch";
import { createClient } from "@/lib/supabase/server";

// 환자 포털 영수증 상세((patient) 영역 — 인증 필요). Story 8.3 / FR-122. '마이' 탭 수납 카드 → 진입.
// 직원 차단만 서버에서(직원 → 직원 영역·직원용 7.5 영수증은 별도 경로). 영수증 데이터·소유 검증은 클라가
// FastAPI self 엔드포인트 경유(비소유/비-finalized → 404). 라우트=encounter_id(불투명 UUID·PII 아님).
export default async function PatientReceiptPage({
  params,
}: {
  params: Promise<{ encounterId: string }>;
}) {
  const supabase = await createClient();
  const { data: role } = await supabase.rpc("auth_user_role");
  if (isStaffRole(role as string | null)) {
    redirect("/home");
  }
  const { encounterId } = await params;

  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 py-8">
      <ReceiptDetail encounterId={encounterId} />
    </main>
  );
}
