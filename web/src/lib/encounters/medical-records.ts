import { apiFetch } from "@/lib/api/client";

// SOAP 진료기록(medical_records, Story 4.6) 타입·API 호출. 전 필드 snake_case(camelCase 변환 금지).
// 쓰기=FastAPI(medical_record.write)·조회=FastAPI(medical_record.read). 감사·권한·RLS 는 DB/서버 소유.
// FastAPI MedicalRecordResponse 의 거울(수동 정의 — database.types.ts 미생성).

/** SOAP 파트(0013 medical_records 컬럼명과 일치 — 감사 마스킹 키 정합). */
export type SoapPart = "subjective" | "objective" | "assessment" | "plan";

/** FastAPI MedicalRecordResponse 의 거울. 임상 텍스트는 권한 게이트로 보호(비-PII 식별 필드 + 자유텍스트). */
export type MedicalRecord = {
  id: string;
  encounter_id: string;
  author_id: string;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** POST·PUT 공용 페이로드(4 파트 — 전체 교체 의미). 미전송/빈문자열=서버에서 None 정규화. */
export type MedicalRecordWrite = {
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
};

function recordsUrl(encounterId: string): string {
  return `/v1/encounters/${encounterId}/medical-records`;
}

/** 한 내원의 SOAP 진료기록 목록(최근순·1:N, GET). 게이트 medical_record.read. */
export async function fetchMedicalRecords(encounterId: string): Promise<MedicalRecord[]> {
  return apiFetch<MedicalRecord[]>(recordsUrl(encounterId));
}

/** SOAP 진료기록 생성(autosave 첫 저장, POST). 게이트 medical_record.write. */
export async function createMedicalRecord(
  encounterId: string,
  body: MedicalRecordWrite,
): Promise<MedicalRecord> {
  return apiFetch<MedicalRecord>(recordsUrl(encounterId), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** SOAP 진료기록 갱신(autosave 전체 교체, PUT). 게이트 medical_record.write. */
export async function updateMedicalRecord(
  encounterId: string,
  recordId: string,
  body: MedicalRecordWrite,
): Promise<MedicalRecord> {
  return apiFetch<MedicalRecord>(`${recordsUrl(encounterId)}/${recordId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}
