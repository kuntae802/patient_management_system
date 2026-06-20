import { MastersManager } from "@/components/admin/masters-manager";
import { fetchMasters, todayISO } from "@/lib/admin/masters";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

// 진료과·진료실 마스터 관리(FR-200·203). 부모 (staff)/layout 이 직원 보장 → 여기선 권한만 가드(fallback=/home).
// 읽기 = Supabase 직접조회(authenticated SELECT, 0006 — 전역 참조 데이터). 토글·생성 쓰기 = 클라 컴포넌트가 FastAPI 호출.
export default async function MastersPage() {
  await requirePermission("master.manage", STAFF_HOME);

  const supabase = await createClient();
  const initial = await fetchMasters(supabase);
  // 서버(KST 컨테이너) today 를 단일 권위로 주입 — 코드 마스터 시점 배지가 2.3 검색 피커와 동일 today 공유.
  const today = todayISO();

  return (
    <div className="px-6 py-6">
      <MastersManager initial={initial} today={today} />
    </div>
  );
}
