import { ReminderLog } from "@/components/scheduling/reminder-log";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// SMS 리마인더 — 원무(Story 6.6, FR-014). nav("리마인더")는 reception 역할로 노출(운영 본질),
// 화면 권위는 notification.read(미보유 → STAFF_HOME 강등) + FastAPI(403). 디스패치 실행(notification.send)
// 은 화면 안의 PermissionGate + 서버 게이트. 발송은 시뮬/로그(실 SMS 미연동·연결 가능한 이음매).
export default async function ReceptionRemindersPage() {
  await requirePermission("notification.read", STAFF_HOME);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <ReminderLog />
    </div>
  );
}
