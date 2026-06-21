import { EncounterHub } from "@/components/encounters/encounter-hub";
import { todayISO } from "@/lib/admin/masters";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 진료 허브(Story 4.4) — 진찰 시작(start_consult) 후 진입하는 진료 화면 셸. 부모 (staff)/layout 이
// 직원 보장 → 여기선 encounter.read 가드(미보유 → STAFF_HOME). 라우트 키 = 불투명 encounter_id
// (URL=PII 불가·새로고침 안전·기존 GET /encounters/{id} 재사용). 콘텐츠(환자 배너 4.5·SOAP 4.6·진단
// 4.7·오더 Epic5)는 후속 스토리. nav 미등재 — 진료 시작/진료 계속으로 진입하는 contextual 화면.
// today(KST) 는 서버 주입 — 진단 KCD 피커 "현재 유효" 필터 권위(masters admin 일관, Story 4.7).
export default async function EncounterHubPage({
  params,
}: {
  params: Promise<{ encounterId: string }>;
}) {
  await requirePermission("encounter.read", STAFF_HOME);
  const { encounterId } = await params;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <EncounterHub encounterId={encounterId} today={todayISO()} />
    </div>
  );
}
