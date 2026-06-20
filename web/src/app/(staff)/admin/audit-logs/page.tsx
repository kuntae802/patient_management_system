import { AuditLogViewer } from "@/components/admin/audit-log-viewer";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 감사 로그 뷰어(FR-243). 부모 (staff)/layout 이 직원 보장 → 여기선 권한만 가드(fallback=/home).
// 읽기전용 — append-only(0004)는 DB 가 강제. 조회는 FastAPI(apiFetch) 경유(actor 이름 users 조인 필요).
export default async function AuditLogsPage() {
  await requirePermission("audit.read", STAFF_HOME);

  return (
    <div className="px-6 py-6">
      <AuditLogViewer />
    </div>
  );
}
