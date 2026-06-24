import { apiFetch } from "@/lib/api/client";

// 환자 포털 "내 기록" 카드 펼침 상세(Story 8.2·FR-121)의 타입·조회·표시 헬퍼. FastAPI
// PatientEncounterDetail 의 거울(snake_case 유지 — camelCase 변환 금지, project-context). 처방=약 라인
// 평면(복약 안내 쉬운 말 조립), 검사=결과 요약 + 정상/주의 플래그(색 비의존). findings 등 임상 서사는
// 서버가 미투영(환자 비노출). 게이트=get_current_patient(직원 403)·소유 검증(비본인 내원 → 404).

export type ExamResultFlag = "normal" | "attention";

/** 처방 약 1줄(FastAPI PatientPrescriptionItem 거울). frequency/usage_instruction 은 저장값(한국어). */
export type PatientPrescriptionItem = {
  drug_name: string;
  unit: string | null;
  dose: number | null;
  frequency: string | null;
  usage_instruction: string | null;
  duration_days: number | null;
  coverage_type: string | null;
};

/** 검사 1건(FastAPI PatientExaminationItem 거울). 완료 전이면 결과 NULL(클라 폴백). */
export type PatientExaminationItem = {
  exam_name: string;
  exam_type: string;
  status: string;
  patient_result_summary: string | null;
  patient_result_flag: ExamResultFlag | null;
  completed_at: string | null;
};

export type PatientEncounterDetail = {
  prescriptions: PatientPrescriptionItem[];
  examinations: PatientExaminationItem[];
};

/** 본인 내원 1건 처방·검사 상세(GET /v1/patients/me/encounters/{id}/detail). 비소유 → 404. */
export function fetchSelfEncounterDetail(
  encounterId: string,
): Promise<PatientEncounterDetail> {
  return apiFetch<PatientEncounterDetail>(
    `/v1/patients/me/encounters/${encounterId}/detail`,
  );
}

/** 복약 안내 쉬운 말 조립 — 저장된 한국어 필드 결합(코드 매핑 금지). 예 "1일 3회, 매 식후 30분, 1정". */
export function formatDosage(item: PatientPrescriptionItem): string {
  const dosePart = item.dose != null ? `${item.dose}${item.unit ?? ""}` : null;
  return [item.frequency, item.usage_instruction, dosePart]
    .filter((p): p is string => Boolean(p && p.trim()))
    .join(", ");
}

// 정상/주의 플래그 메타 — 색 + 글리프 + 라벨 중복 인코딩(색 비의존·UX-DR20). 색 토큰은 직원 배지와
// 동일(globals.css): 정상=status-done 그린·주의=status-received-ink 앰버(대비 AA 충족). ExamResultBadge 소비.
export const RESULT_FLAG_META: Record<
  ExamResultFlag,
  { label: string; glyph: string; badgeClass: string }
> = {
  normal: {
    label: "정상",
    glyph: "✓",
    badgeClass: "border-status-done/40 bg-status-done/12 text-status-done-ink",
  },
  attention: {
    label: "주의",
    glyph: "!",
    badgeClass: "border-status-received/40 bg-status-received/12 text-status-received-ink",
  },
};
