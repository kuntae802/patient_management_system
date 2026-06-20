// 인증 오류 → 한국어 범용 메시지 매핑(Story 1.4 AC3).
// 계정 열거 방지: 자격증명 실패는 단일 메시지. 원문 오류·이메일·토큰은 절대 노출 금지(PII 경계).

const INVALID_CREDENTIALS = "이메일 또는 비밀번호가 올바르지 않습니다.";
const GENERIC = "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.";

/** Supabase AuthError(또는 임의 오류)를 무PII 한국어 메시지로 변환. */
export function authErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { status?: number; code?: string };
    if (e.code === "invalid_credentials" || e.status === 400 || e.status === 401 || e.status === 403) {
      return INVALID_CREDENTIALS;
    }
  }
  return GENERIC;
}
