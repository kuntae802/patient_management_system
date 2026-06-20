import { z } from "zod";

// web 공개 환경변수(빌드타임 인라인) 검증 — 미설정/오타를 불투명 런타임 오류 대신 명확히 fail-fast.
// (deferred-work: Story 1.4 → 1.6 재이월) 클라 번들엔 publishable 키만, secret/service_role 금지.
//
// ⚠️ NEXT_PUBLIC_* 는 반드시 정적 참조(`process.env.NEXT_PUBLIC_X`)해야 Next 가 빌드타임 인라인한다.
//    동적 접근(`process.env[key]`)은 인라인이 깨져 클라에서 undefined 가 되므로 금지.
const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url("NEXT_PUBLIC_SUPABASE_URL 이 유효한 URL 이어야 합니다"),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 가 설정되어야 합니다"),
  NEXT_PUBLIC_BASE_PATH: z.string().optional(),
  // FastAPI 베이스 URL(`/v1` 미포함 — 호출부가 `/v1/...` 를 append). Story 1.7 web→API 쓰기 호출.
  //   dev = http://localhost:8000 (fastapi dev; root_path 는 OpenAPI/프록시용 메타라 dev 는 /v1 루트 서빙)
  //   prod = https://kuntae802.mooo.com/patient_management_system/api (nginx 가 프리픽스 스트립)
  NEXT_PUBLIC_API_BASE_URL: z.url("NEXT_PUBLIC_API_BASE_URL 이 유효한 URL 이어야 합니다"),
});

export type Env = z.infer<typeof envSchema>;

/** 주어진 원시 env 를 검증해 반환(테스트·재사용 가능한 순수 함수). 실패 시 메시지를 모아 throw. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    // 경로(변수명)를 메시지에 포함 — 키 자체가 누락돼 타입 에러가 나도 어떤 변수인지 드러난다.
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`환경변수 검증 실패: ${issues}`);
  }
  return result.data;
}

// 모듈 레벨 단일 평가. 정적 참조로 빌드타임 인라인을 보장한다.
export const env = parseEnv({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH,
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
});
