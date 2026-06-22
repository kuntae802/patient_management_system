import { apiFetch } from "@/lib/api/client";

// 영상 판독·검사 오더 완료(Story 5.9 / FR-102) 타입·API 호출. 전 필드 snake_case(camelCase 변환 금지).
// 판독 워크리스트·완료=FastAPI(examination.complete·의사 판독의 겸임). 영상 조회는 lib/radiology/imaging
// 의 fetchExaminationImages(order.read) 재사용(중복 금지). FastAPI radiology 스키마의 거울.

/** FastAPI ReadingWorklistItem 거울. 오늘 미판독 영상검사(performed) 1행 + 조인(비-PII) + 영상 수. */
export type ReadingWorklistItem = {
  examination_id: string;
  encounter_id: string;
  chart_no: string;
  patient_name: string;
  department_name: string;
  fee_name: string; // 검사 행위명(fee_schedules 조인)
  status: string; // performed(미판독)
  ordered_by_name: string | null; // 지시 의사(추적 라인)
  ordered_at: string;
  performed_by_name: string | null; // 촬영 수행자(방사선사·추적 라인)
  performed_at: string | null; // 촬영 수행 시각(판독 대기 기준)
  image_count: number; // 판독 근거 영상 수
};

/** 판독 완료 요청 바디. findings=소견(필수·non-blank)·reading_conclusion=결론(선택). 전이는 서버/DB 강제. */
export type CompleteExaminationBody = {
  findings: string;
  reading_conclusion?: string | null;
};

/** 판독 워크리스트(오늘 미판독 영상검사, GET). 게이트 examination.complete. */
export async function fetchReadingWorklist(): Promise<ReadingWorklistItem[]> {
  return apiFetch<ReadingWorklistItem[]>("/v1/radiology/reading-worklist");
}

/** 판독 완료(POST). 게이트 examination.complete. 빈 소견 → 422 findings_required·미수행/재완료 → 409. */
export async function completeExamination(
  examinationId: string,
  body: CompleteExaminationBody,
): Promise<unknown> {
  return apiFetch<unknown>(`/v1/examinations/${examinationId}/complete`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
