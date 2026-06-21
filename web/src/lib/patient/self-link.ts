import { z } from "zod";

import { rrnHardError } from "@/lib/reception/patients";

// 앱 자가가입 본인 연결(Story 3.4) — 타입·Zod(Pydantic PatientSelfLinkRequest 거울)·페이로드.
// 주민번호는 raw 로 서버에 보내고(서버가 정규화·blind_index 매칭), 클라는 HARD 사전체크(3중 1선)만.
// 🚫 raw 주민번호·성명은 로그·toast 에 남기지 않는다(PII 경계).

/** FastAPI PatientSelfSummary 거울(snake_case 유지) — 마스킹·식별 최소 필드. */
export type PatientSelfSummary = {
  id: string;
  chart_no: string;
  name: string;
  birth_date: string;
  sex: string;
  resident_no_masked: string;
};

export const selfLinkSchema = z.object({
  resident_no: z
    .string()
    .trim()
    .min(1, "주민등록번호를 입력하세요")
    .superRefine((v, ctx) => {
      const err = rrnHardError(v);
      if (err) ctx.addIssue({ code: "custom", message: err });
    }),
  name: z.string().trim().min(1, "이름을 입력하세요").max(100),
});
export type SelfLinkValues = z.infer<typeof selfLinkSchema>;

/** 연결 페이로드. resident_no 는 raw 전송(서버가 정규화·매칭). */
export function toSelfLinkPayload(v: SelfLinkValues): Record<string, unknown> {
  return { resident_no: v.resident_no, name: v.name };
}
