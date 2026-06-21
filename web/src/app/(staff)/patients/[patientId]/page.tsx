import { PatientDetail } from "@/components/reception/patient-detail";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 환자 상세 = **공유 풀페이지**(원무·의사 진입, EXPERIENCE "비-의사 역할 진입 허용"). 임상 프로필
// 조회·갱신이 여기 거주(Story 3.2). 전역 Ctrl K 검색 진입은 Story 3.5, 진료 허브 배너 연동은 Epic 4.
// 부모 (staff)/layout 이 직원 보장 → 여기선 patient.read 가드(미보유 → STAFF_HOME). 읽기·쓰기는
// 클라가 FastAPI 경유(환자 RLS 본인행 → Supabase 직접조회 불가, 마스킹 컬럼만 투영).
export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ patientId: string }>;
}) {
  await requirePermission("patient.read", STAFF_HOME);
  const { patientId } = await params;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PatientDetail patientId={patientId} />
    </div>
  );
}
