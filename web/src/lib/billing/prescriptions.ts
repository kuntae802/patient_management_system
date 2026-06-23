import { apiFetch } from "@/lib/api/client";

// 원외처방전 문서·발급(Story 7.7 / FR-115·FR-080). 전 필드 snake_case(camelCase 변환 금지). 처방전은
// payment 스코프가 아니라 prescription 스코프 — 문서 조립/발급/내보내기 감사 게이트 = prescription.dispense
// (원무). FastAPI PrescriptionDocumentResponse 의 거울(수동 정의). 약가 없음(원외처방전 = 약품 목록만).

/** 요양기관 정보(0049 clinic_profile 거울 — 영수증과 동일 shape). */
export type PrescriptionDocClinic = {
  name: string;
  biz_no: string;
  hira_no: string; // 요양기관기호
  address: string;
  ceo_name: string;
  phone: string;
};

/** 처방전 환자 정보 — 주민번호는 masked 만(full reveal 이월·PII 경계). */
export type PrescriptionDocPatient = {
  name: string;
  chart_no: string;
  resident_no_masked: string; // 900101-1****** (masked only)
  insurance_type: string; // insuranceLabel 로 한글화
  birth_date: string | null; // YYYY-MM-DD
  sex: string | null; // male/female
};

/** 처방전 진료 정보 — 진료과·담당의. */
export type PrescriptionDocEncounter = {
  department_name: string;
  doctor_name: string | null;
};

/** 처방 의료인 — 성명·면허종류·면허번호(법정 서식 필수·null → 미기재). */
export type PrescriptionDocPrescriber = {
  name: string | null;
  license_type: string | null; // doctor/radiologist
  license_no: string | null;
};

/** 근거 진단(질병분류기호 KCD·FR-051). 근거 진단 없으면 항목 자체 null. */
export type PrescriptionDocDiagnosis = {
  code: string; // KCD 코드(예 I10)
  name: string;
};

/** 처방 의약품 라인 — 약품명·코드·단위 + 용량·횟수·일수·용법(FR-050). 약가 없음. */
export type PrescriptionDocDrug = {
  drug_code: string;
  drug_name: string;
  drug_unit: string | null; // 1회 투약량 단위(정·mg)
  dose: number | null; // 1회 투약량
  frequency: string | null; // 1일 투여횟수(예 TID)
  duration_days: number | null; // 총 투여일수
  usage_instruction: string | null; // 용법
};

/** 원외처방전 1매(처방 1건). status=issued(발행)/dispensed(발급). */
export type PrescriptionDocItem = {
  id: string;
  status: string;
  ordered_at: string; // 발행일
  dispensed_at: string | null; // 발급일(미발급 시 null)
  prescriber: PrescriptionDocPrescriber;
  diagnosis: PrescriptionDocDiagnosis | null;
  drugs: PrescriptionDocDrug[];
};

/** FastAPI PrescriptionDocumentResponse 의 거울 — 한 내원의 발행/발급 처방 전체(법정 서식 데이터). */
export type PrescriptionDocument = {
  clinic: PrescriptionDocClinic;
  patient: PrescriptionDocPatient;
  encounter: PrescriptionDocEncounter;
  prescriptions: PrescriptionDocItem[];
};

/**
 * 한 내원의 원외처방전 문서 데이터(GET). 게이트 prescription.dispense(원무). payment 무관(finalize 게이트
 * 없음 — 발행 처방이면 출력). 미존재 내원 → 404. 처방 0건 → prescriptions=[]. 주민번호는 masked 만.
 */
export async function fetchPrescriptionDocument(
  encounterId: string,
): Promise<PrescriptionDocument> {
  return apiFetch<PrescriptionDocument>(
    `/v1/encounters/${encounterId}/prescription-document`,
  );
}

/**
 * 원외처방전 발급(issued→dispensed, POST). 게이트 prescription.dispense. **상태 전이 = 액션 엔드포인트**.
 * 비가역 1방향 — 이미 dispensed 재발급 → 409. 타 내원/미존재 → 404. 성공 후 호출자가 문서를 재조회한다.
 */
export async function dispensePrescription(
  encounterId: string,
  prescriptionId: string,
): Promise<void> {
  await apiFetch<unknown>(
    `/v1/encounters/${encounterId}/prescriptions/${prescriptionId}/dispense`,
    { method: "POST" },
  );
}

/**
 * 처방전 인쇄/내보내기 = 감사 기록(POST·204). 게이트 prescription.dispense. 인쇄(Ctrl P)/PDF 저장 직전
 * 호출 → audit_logs 'read'(document_type=prescription). UX-DR22 "민감 문서 인쇄/내보내기 자체가 감사".
 */
export async function exportPrescriptionDocument(
  encounterId: string,
  prescriptionId: string,
): Promise<void> {
  await apiFetch<null>(
    `/v1/encounters/${encounterId}/prescriptions/${prescriptionId}/document/export`,
    { method: "POST" },
  );
}
