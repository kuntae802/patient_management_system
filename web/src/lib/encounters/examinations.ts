import { apiFetch } from "@/lib/api/client";

// 검사·영상 오더(examinations, Story 5.3) 타입·API 호출. 전 필드 snake_case(camelCase 변환 금지).
// 오더=FastAPI(examination.order)·조회=FastAPI(order.read). 검사 행위=fee_schedule 마스터 FK(free-text 차단).
// exam_type(lab/imaging)=워크리스트 라우팅 분류 축(FR-061). FastAPI ExaminationResponse 의 거울(수동 정의).

/** 검사 유형 — 워크리스트 라우팅 분류 축(lab 진단검사→간호 / imaging 영상검사→방사선, FR-061). */
export type ExamType = "lab" | "imaging";

/** FastAPI ExaminationResponse 의 거울. fee_* 는 fee_schedules 마스터 조인(읽기시점). */
export type Examination = {
  id: string;
  encounter_id: string;
  exam_type: ExamType;
  fee_schedule_id: string;
  fee_code: string;
  fee_name: string;
  fee_category: string | null;
  amount_krw: number;
  status: string;
  ordered_by: string;
  ordered_at: string;
  equipment_id: string | null;
  performed_by: string | null;
  performed_at: string | null;
  completed_by: string | null;
  completed_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** 오더 생성 요청 바디. exam_type=라우팅 분류·fee_schedule_id=검사 행위(마스터 FK). */
export type ExaminationCreateBody = {
  exam_type: ExamType;
  fee_schedule_id: string;
};

function examinationsUrl(encounterId: string): string {
  return `/v1/encounters/${encounterId}/examinations`;
}

/** 한 내원의 검사·영상 오더 목록(최신순, GET). 게이트 order.read. */
export async function fetchExaminations(encounterId: string): Promise<Examination[]> {
  return apiFetch<Examination[]>(examinationsUrl(encounterId));
}

/** 검사·영상 오더 생성(POST). 게이트 examination.order. status='ordered'(지시) DB 강제. */
export async function createExamination(
  encounterId: string,
  body: ExaminationCreateBody,
): Promise<Examination> {
  return apiFetch<Examination>(examinationsUrl(encounterId), {
    method: "POST",
    body: JSON.stringify(body),
  });
}
