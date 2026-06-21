import { apiFetch } from "@/lib/api/client";
import type { Encounter } from "@/lib/reception/encounters";

// 내원진단(encounter_diagnoses, Story 4.7) 타입·API 호출. 전 필드 snake_case(camelCase 변환 금지).
// 부착/토글/제거=FastAPI(diagnosis.attach)·조회=FastAPI(diagnosis.read)·완료=FastAPI(encounter.complete).
// 진단은 마스터 FK(free-text 차단). 권한·감사·RLS·불변식(주상병 ≤1)은 DB/서버 소유.
// FastAPI EncounterDiagnosisResponse 의 거울(수동 정의 — database.types.ts 미생성).

/** FastAPI EncounterDiagnosisResponse 의 거울. diagnosis_code·diagnosis_name 은 KCD 마스터 조인. */
export type EncounterDiagnosis = {
  id: string;
  encounter_id: string;
  diagnosis_id: string;
  diagnosis_code: string;
  diagnosis_name: string;
  is_primary: boolean;
  recorded_by: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function diagnosesUrl(encounterId: string): string {
  return `/v1/encounters/${encounterId}/diagnoses`;
}

/** 한 내원의 부착 진단 목록(주상병 우선·부착순, GET). 게이트 diagnosis.read. */
export async function fetchEncounterDiagnoses(encounterId: string): Promise<EncounterDiagnosis[]> {
  return apiFetch<EncounterDiagnosis[]>(diagnosesUrl(encounterId));
}

/** KCD 진단 부착(POST). 게이트 diagnosis.attach. is_primary=true 면 기존 주상병 강등(서버). */
export async function attachDiagnosis(
  encounterId: string,
  body: { diagnosis_id: string; is_primary: boolean },
): Promise<EncounterDiagnosis> {
  return apiFetch<EncounterDiagnosis>(diagnosesUrl(encounterId), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** 주/부상병 토글(PATCH). 게이트 diagnosis.attach. is_primary=true 면 기존 주상병 강등(서버). */
export async function setDiagnosisPrimary(
  encounterId: string,
  edId: string,
  isPrimary: boolean,
): Promise<EncounterDiagnosis> {
  return apiFetch<EncounterDiagnosis>(`${diagnosesUrl(encounterId)}/${edId}`, {
    method: "PATCH",
    body: JSON.stringify({ is_primary: isPrimary }),
  });
}

/** 부착 진단 제거(DELETE, soft delete). 게이트 diagnosis.attach. */
export async function removeDiagnosis(encounterId: string, edId: string): Promise<void> {
  await apiFetch<void>(`${diagnosesUrl(encounterId)}/${edId}`, { method: "DELETE" });
}

/** 진료 완료(POST /complete) — in_progress→completed, 주상병 게이트. 게이트 encounter.complete.
 *  주상병 미지정 → ApiError(code="primary_diagnosis_required", status 422). */
export async function completeEncounter(encounterId: string): Promise<Encounter> {
  return apiFetch<Encounter>(`/v1/encounters/${encounterId}/complete`, { method: "POST" });
}
