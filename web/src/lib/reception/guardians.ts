import { z } from "zod";

// 보호자(Story 3.3, FR-006) — 타입·Zod 스키마(Pydantic Guardian* 거울)·페이로드 변환.
// 환자의 sub-resource(1:N). 읽기/쓰기 모두 FastAPI(apiFetch). relationship 은 자유텍스트(enum
// 미강제 — 실제 가족관계 다양성), 프리셋은 datalist 제안용. phone 은 평문(환자 phone 동형, reveal 이월).

/** FastAPI GuardianResponse 거울(snake_case 유지 — camelCase 변환 금지). */
export type Guardian = {
  id: string;
  patient_id: string;
  name: string;
  relationship: string;
  phone: string | null;
  created_at: string;
  updated_at: string;
};

/** 관계 프리셋 — <datalist> 제안용(자유 입력 허용, 폐쇄어휘 아님). */
export const RELATIONSHIP_PRESETS: string[] = [
  "배우자",
  "부모",
  "자녀",
  "형제자매",
  "조부모",
  "손자녀",
  "기타",
];

// ── 검증(Zod) — Pydantic GuardianCreate/Update 의 거울(3중 검증 클라 1선) ──────────
// name·relationship 필수(빈 값 거부), phone 옵셔널(빈 허용). max_length 는 서버 거울.
export const guardianSchema = z.object({
  name: z.string().trim().min(1, "보호자 성명을 입력하세요").max(100),
  relationship: z.string().trim().min(1, "관계를 입력하세요").max(50),
  phone: z.string().trim().max(20, "20자 이내로 입력하세요"),
});
export type GuardianValues = z.infer<typeof guardianSchema>;

/** 보호자 → 폼 기본값(현재값 프리필). null → "" (빈 입력). */
export function toGuardianValues(g: Guardian): GuardianValues {
  return {
    name: g.name,
    relationship: g.relationship,
    phone: g.phone ?? "",
  };
}

/** 추가·수정 페이로드. 빈 phone 은 null 로 전송(서버 None=값없음 계약 — 명시 삭제 지원). */
export function toGuardianPayload(v: GuardianValues): Record<string, unknown> {
  return {
    name: v.name,
    relationship: v.relationship,
    phone: v.phone || null,
  };
}
