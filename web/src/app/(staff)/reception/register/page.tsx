import { PatientRegister } from "@/components/reception/patient-register";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 환자 등록(원무 직접 등록, FR-002). 부모 (staff)/layout 이 직원 보장 → 여기선 권한만 가드.
// patient.create 미보유(예: 권한 미부여 원무) → STAFF_HOME 으로 강등. 쓰기·검증은 클라가 FastAPI 호출.
export default async function ReceptionRegisterPage() {
  await requirePermission("patient.create", STAFF_HOME);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <PatientRegister />
    </div>
  );
}
