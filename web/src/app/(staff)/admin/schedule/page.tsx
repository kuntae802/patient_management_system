import { ScheduleManager } from "@/components/admin/schedule-manager";
import { fetchSchedules } from "@/lib/admin/schedule";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

// 근무표·휴진 관리(FR-220·221). 부모 (staff)/layout 이 직원 보장 → 여기선 권한만 가드(fallback=/home).
// 읽기 = Supabase 직접조회(authenticated SELECT, 0030/0006 — 전역 참조 데이터): 근무표·휴진·진료과·진료실.
// ⚠️ 의사 목록은 주입하지 않는다(users RLS 본인행, 0003 → RSC 직접조회 불가) — 매니저가 마운트 시
// FastAPI(apiFetch)로 조회한다. 토글·생성 쓰기도 클라 컴포넌트가 FastAPI(master.manage) 호출.
export default async function SchedulePage() {
  await requirePermission("master.manage", STAFF_HOME);

  const supabase = await createClient();
  // 부분 강등(masters 2.6/AC4): 한 자원 실패가 화면 전체를 다운시키지 않게 data + per-자원 errors.
  const { data, errors } = await fetchSchedules(supabase);

  return (
    <div className="px-6 py-6">
      <ScheduleManager
        initial={data}
        departments={data.departments}
        rooms={data.rooms}
        loadErrors={errors}
      />
    </div>
  );
}
