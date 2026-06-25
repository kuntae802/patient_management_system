import { PatientSearchList } from "@/components/reception/patient-search-list";
import { STAFF_HOME } from "@/lib/auth/branch";
import { requirePermission } from "@/lib/auth/guards";

// 환자 검색 페이지 — 사이드바 "환자 검색"(reception·doctor) 진입점. 이름·차트번호·연락처로 검색 후
// 환자 상세(/patients/{id})로 이동. 전역 Ctrl K 팔레트와 동일 검색 API, 페이지 인라인 형태.
// 부모 (staff)/layout 이 직원 보장 → 여기선 patient.read 가드(미보유 → STAFF_HOME 강등).
export default async function PatientSearchPage() {
  await requirePermission("patient.read", STAFF_HOME);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-1 text-[20px] font-semibold tracking-[-0.02em] text-foreground">
        환자 검색
      </h1>
      <p className="mb-5 text-[13px] text-muted-foreground">
        이름·차트번호·연락처로 환자를 찾아 상세로 이동합니다. (전역 단축키 Ctrl K 로도 검색 가능)
      </p>
      <PatientSearchList />
    </div>
  );
}
