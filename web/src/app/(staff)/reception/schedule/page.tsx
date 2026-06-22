import { AppointmentCalendar } from "@/components/scheduling/appointment-calendar";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 예약 관리 — 원무(Story 6.3, UX-DR15·FR-013). nav("예약 관리")는 reception 역할로 노출(직무 본질),
// 화면 권위는 appointment.read(미보유 → STAFF_HOME 강등) + FastAPI(403). 예약 캘린더(시간레일×의사 열·
// 일 보기)에서 빈 슬롯 클릭 → booking-peek 예약 생성(appointment.create). 6.4 가 변경·취소·대리를 확장.
export default async function ReceptionSchedulePage() {
  await requirePermission("appointment.read", STAFF_HOME);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <AppointmentCalendar />
    </div>
  );
}
