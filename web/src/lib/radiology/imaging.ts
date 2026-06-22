import { apiFetch } from "@/lib/api/client";

// 방사선 촬영·영상 업로드·장비(Story 5.8) 타입·API 호출. 전 필드 snake_case(camelCase 변환 금지).
// 워크리스트·업로드·수행=FastAPI(examination.perform)·영상/장비 조회=FastAPI(order.read). 영상 파일은
// Storage(비공개 버킷)·DB 엔 경로만 — 응답은 서명 URL(조회 시점 발급). FastAPI radiology 스키마의 거울.

/** FastAPI RadiologyWorklistItem 거울. 오늘 미수행 영상검사 1행 + 조인(비-PII) + 업로드 영상 수. */
export type RadiologyWorklistItem = {
  examination_id: string;
  encounter_id: string;
  chart_no: string;
  patient_name: string;
  department_name: string;
  fee_name: string; // 검사 행위명(fee_schedules 조인)
  status: string; // ordered(미수행)
  ordered_by_name: string | null; // 지시 의사(추적 라인)
  ordered_at: string;
  image_count: number; // 업로드 누적(수행 가능 신호 ≥1)
};

/** FastAPI EquipmentResponse 거울. 장비 목록·상태(읽기 전용·촬영 배정 참조). */
export type Equipment = {
  id: string;
  code: string;
  name: string;
  modality: string | null;
  status: string; // available · in_use · maintenance
  is_active: boolean;
};

/** FastAPI ExaminationImageResponse 거울. 서명 URL=조회 시점 발급(DB 경로만 저장). */
export type ExaminationImage = {
  id: string;
  examination_id: string;
  content_type: string;
  file_size: number | null;
  uploaded_by: string;
  uploaded_by_name: string | null;
  uploaded_at: string;
  signed_url: string;
};

/** 촬영 수행 요청 바디. equipment_id=배정 장비(선택). 영상≥1·전이는 서버/DB 강제. */
export type PerformExaminationBody = {
  equipment_id?: string | null;
};

/** 촬영 워크리스트(오늘 미수행 영상검사, GET). 게이트 examination.perform. */
export async function fetchRadiologyWorklist(): Promise<RadiologyWorklistItem[]> {
  return apiFetch<RadiologyWorklistItem[]>("/v1/radiology/worklist");
}

/** 장비 목록·상태(GET). 게이트 order.read. 읽기 전용. */
export async function fetchEquipment(): Promise<Equipment[]> {
  return apiFetch<Equipment[]>("/v1/equipment");
}

/** 한 검사의 촬영 영상 목록 + 서명 URL(GET). 게이트 order.read. */
export async function fetchExaminationImages(
  examinationId: string,
): Promise<ExaminationImage[]> {
  return apiFetch<ExaminationImage[]>(`/v1/examinations/${examinationId}/images`);
}

/** 촬영 영상 업로드(POST multipart). 게이트 examination.perform. 잘못된 형식/용량 422·lab 422·미존재 404. */
export async function uploadExaminationImage(
  examinationId: string,
  file: File,
): Promise<ExaminationImage> {
  const form = new FormData();
  form.append("file", file);
  // FormData → apiFetch 가 Content-Type 강제를 건너뛰어 브라우저가 multipart boundary 설정.
  return apiFetch<ExaminationImage>(`/v1/examinations/${examinationId}/images`, {
    method: "POST",
    body: form,
  });
}

/** 촬영 수행(POST). 게이트 examination.perform. 영상 0장 → 422 image_required·재수행 → 409. */
export async function performExamination(
  examinationId: string,
  body: PerformExaminationBody = {},
): Promise<unknown> {
  return apiFetch<unknown>(`/v1/examinations/${examinationId}/perform`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
