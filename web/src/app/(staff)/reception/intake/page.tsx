import { PatientIntake } from "@/components/reception/patient-intake";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 환자 접수(원무 walk-in, FR-021). 부모 (staff)/layout 이 직원 보장 → 여기선 권한만 가드.
// encounter.register 미보유(권한 미부여 원무) → STAFF_HOME 으로 강등. 쓰기·검증은 클라가 FastAPI 호출.
// 접수 메뉴는 nav 가 reception 역할로 노출(staff-nav) — 진짜 권위는 FastAPI(403)·DB 전이 트리거.
export default async function ReceptionIntakePage() {
  await requirePermission("encounter.register", STAFF_HOME);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <PatientIntake />
    </div>
  );
}
