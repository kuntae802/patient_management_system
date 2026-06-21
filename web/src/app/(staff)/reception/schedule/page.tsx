import { SlotAvailability } from "@/components/scheduling/slot-availability";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 예약 관리 — 원무(Story 6.2, FR-012). nav("예약 관리")는 reception 역할로 노출(직무 본질·게이트 없음),
// 화면 권위는 appointment.read(미보유 → STAFF_HOME 강등) + FastAPI(403). 6.2 = 가용 슬롯 미리보기 읽기.
// 6.3/6.4 가 이 라우트를 예약 캘린더(UX-DR15)·booking-peek·대리 예약으로 확장한다.
export default async function ReceptionSchedulePage() {
  await requirePermission("appointment.read", STAFF_HOME);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <SlotAvailability />
    </div>
  );
}
