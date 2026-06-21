// 인증 오류 → 한국어 범용 메시지 매핑(Story 1.4 AC3).
// 계정 열거 방지: 자격증명 실패는 단일 메시지. 원문 오류·이메일·토큰은 절대 노출 금지(PII 경계).

const INVALID_CREDENTIALS = "이메일 또는 비밀번호가 올바르지 않습니다.";
const GENERIC = "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.";

/** Supabase AuthError(또는 임의 오류)를 무PII 한국어 메시지로 변환. */
export function authErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { status?: number; code?: string };
    // 자격증명 실패만 INVALID_CREDENTIALS. 403/429(가입차단·미확인·레이트리밋)은 일반 메시지로
    // (correct 비밀번호인데 "비밀번호 오류"라 오인시키지 않도록). 계정 열거는 여전히 방지.
    if (e.code === "invalid_credentials" || e.status === 400 || e.status === 401) {
      return INVALID_CREDENTIALS;
    }
  }
  return GENERIC;
}

// ── 자가가입(Story 3.4) 오류 → 한국어 메시지 ──────────────────────────────────
const EMAIL_IN_USE = "이미 가입된 이메일입니다. 로그인해 주세요.";
const WEAK_PASSWORD = "비밀번호가 보안 정책을 충족하지 않습니다.";
const SIGNUP_GENERIC = "회원가입에 실패했습니다. 잠시 후 다시 시도해 주세요.";
const ALREADY_USED_RE = /already (registered|exists)|user_already_exists/i;

/** Supabase signUp 오류를 무PII 한국어 메시지로 변환. */
export function signupErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { status?: number; code?: string; message?: string };
    if (
      e.code === "user_already_exists" ||
      e.code === "email_exists" ||
      (typeof e.message === "string" && ALREADY_USED_RE.test(e.message))
    ) {
      return EMAIL_IN_USE;
    }
    if (e.code === "weak_password") return WEAK_PASSWORD;
  }
  return SIGNUP_GENERIC;
}
