import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";

// web→FastAPI 인증 호출 클라이언트(Story 1.7 최초). 브라우저 Supabase 세션의 access_token 을 Bearer 로
// 첨부하고, FastAPI 표준 봉투 {error:{code,message,detail}} 를 파싱해 실패 시 ApiError 로 throw 한다.
// 🚫 토큰·PII 는 로그·toast 에 남기지 않는다(봉투 message 만 사용자 노출).
// ⚠️ 보안 경계는 서버다 — 이 클라가 우회돼도 FastAPI require_permission(403)·RLS 가 최종 차단.

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type ErrorEnvelope = { error?: { code?: string; message?: string; detail?: unknown } };

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 인증된 FastAPI 호출. `path` 는 `/v1/...`(베이스 URL 은 env 가 보유, basePath 와 무관한 절대 URL).
 * 성공 → 파싱된 JSON(T). 실패 → ApiError(code·message(한국어)·status·detail).
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) {
    throw new ApiError("no_session", "세션이 만료되었습니다. 다시 로그인해 주세요.", 401);
  }

  // 헤더 정규화: 호출자 헤더(Headers/튜플배열/객체 어떤 형태든) 흡수 후 Authorization 을 **마지막에**
  // set → 인증 헤더가 실수로 덮어써지거나 형태 차이로 소실되지 않게 한다. Content-Type 은 미지정 시만.
  const headers = new Headers(init?.headers);
  // FormData(멀티파트 업로드, Story 5.8 영상)는 브라우저가 boundary 포함 Content-Type 을 직접
  // 설정하므로 JSON 강제를 건너뛴다 — 강제 시 boundary 누락으로 서버 파싱이 실패한다.
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("network_error", "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.", 0);
  }

  const text = await res.text();
  const body = text ? safeJson(text) : null;

  if (!res.ok) {
    const envelope = (body ?? {}) as ErrorEnvelope;
    // 봉투가 아니면(프록시 5xx HTML·비-JSON 등) status 기반 code 로 진단성 부여(범용 "error" 와 구분).
    throw new ApiError(
      envelope.error?.code ?? `http_${res.status}`,
      envelope.error?.message ?? "요청을 처리하지 못했습니다.",
      res.status,
      envelope.error?.detail,
    );
  }
  return body as T;
}
