import { apiFetch } from "@/lib/api/client";

// 처방 오더(prescriptions, Story 5.2) 타입·API 호출. 전 필드 snake_case(camelCase 변환 금지).
// 발행=FastAPI(prescription.create)·조회=FastAPI(order.read). 약품=마스터 FK(free-text 차단).
// 권한·감사·불변식(상태머신)은 DB/서버 소유. FastAPI Prescription(Detail)Response 의 거울(수동 정의).

/** FastAPI PrescriptionDetailResponse 의 거울. drug_*·ingredient_code·coverage_type 는 약품 마스터 조인. */
export type PrescriptionDetail = {
  id: string;
  prescription_id: string;
  drug_id: string;
  drug_code: string;
  drug_name: string;
  ingredient_code: string | null;
  coverage_type: string; // 급여 covered / 비급여 non_covered (5.5 pay-chip)
  dose: number | null;
  frequency: string | null;
  duration_days: number | null;
  usage_instruction: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** FastAPI PrescriptionResponse 의 거울. details=1:N 상세 라인. */
export type Prescription = {
  id: string;
  encounter_id: string;
  encounter_diagnosis_id: string | null;
  status: string;
  ordered_by: string;
  ordered_by_name: string | null; // users 조인(추적 라인 지시자, 5.5)
  ordered_at: string;
  dispensed_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  details: PrescriptionDetail[];
};

/** 발행 요청 상세 라인(쓰기). 약품만 필수, 나머지 파라미터는 선택. */
export type PrescriptionDetailInput = {
  drug_id: string;
  dose?: number | null;
  frequency?: string | null;
  duration_days?: number | null;
  usage_instruction?: string | null;
  allergy_override_reason?: string | null; // 알레르기 오버라이드 사유(UX-DR21②, 5.5)
};

/** 발행 요청 바디. encounter_diagnosis_id=근거 진단(선택)·details=최소 1줄. */
export type PrescriptionCreateBody = {
  encounter_diagnosis_id?: string | null;
  details: PrescriptionDetailInput[];
};

function prescriptionsUrl(encounterId: string): string {
  return `/v1/encounters/${encounterId}/prescriptions`;
}

/** 한 내원의 발행 처방전 목록(헤더 최신순 + 상세, GET). 게이트 order.read. */
export async function fetchPrescriptions(
  encounterId: string,
): Promise<Prescription[]> {
  return apiFetch<Prescription[]>(prescriptionsUrl(encounterId));
}

/** 처방전 발행(POST). 게이트 prescription.create. 헤더 + 상세 원자적 생성. */
export async function createPrescription(
  encounterId: string,
  body: PrescriptionCreateBody,
): Promise<Prescription> {
  return apiFetch<Prescription>(prescriptionsUrl(encounterId), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** 처방 취소(POST .../cancel·0056). 게이트 order.cancel. 미발급(issued)만 — 발급/취소 409. */
export async function cancelPrescription(
  encounterId: string,
  prescriptionId: string,
): Promise<Prescription> {
  return apiFetch<Prescription>(`${prescriptionsUrl(encounterId)}/${prescriptionId}/cancel`, {
    method: "POST",
  });
}

/**
 * 이미 처방된 성분(ingredient_code, 비-null) 집합 — 동일 성분 중복 경고(FR-052)의 기준.
 * 발행된(활성) 처방의 활성 상세 라인만 집계. 클라 측 비차단 경고 — 서버는 차단하지 않는다.
 */
export function issuedIngredientCodes(
  prescriptions: Prescription[],
): Set<string> {
  const codes = new Set<string>();
  for (const p of prescriptions) {
    if (!p.is_active || p.status === "cancelled") continue; // 취소 처방은 중복 기준 제외(0056)
    for (const d of p.details) {
      if (d.is_active && d.ingredient_code) codes.add(d.ingredient_code);
    }
  }
  return codes;
}
