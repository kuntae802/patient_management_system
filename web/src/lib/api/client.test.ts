import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch, ApiError } from "@/lib/api/client";

const getSession = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession } }),
}));

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  }) as unknown as typeof fetch;
}

function mockFetchText(status: number, raw: string) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => raw,
  }) as unknown as typeof fetch;
}

function lastInit(): RequestInit {
  return (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
}

describe("apiFetch", () => {
  afterEach(() => vi.clearAllMocks());

  it("성공 시 JSON 을 반환하고 Bearer·절대 URL 을 첨부한다", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "tok123" } } });
    mockFetchOnce(200, { changed: true });

    const res = await apiFetch<{ changed: boolean }>("/v1/admin/rbac/grants", {
      method: "PUT",
      body: "{}",
    });

    expect(res).toEqual({ changed: true });
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://localhost:8000/v1/admin/rbac/grants");
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer tok123");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("호출자가 Authorization 을 넘겨도 세션 토큰이 우선(덮어쓰기 불가) + 커스텀 헤더 보존", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "tok123" } } });
    mockFetchOnce(200, {});
    await apiFetch("/v1/x", { headers: { Authorization: "Bearer EVIL", "X-Test": "1" } });
    const headers = lastInit().headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer tok123");
    expect(headers.get("X-Test")).toBe("1");
  });

  it("비-봉투/비-JSON 에러 본문 → code=http_<status>", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    mockFetchText(502, "<html>bad gateway</html>");
    await expect(apiFetch("/v1/x")).rejects.toMatchObject({ code: "http_502", status: 502 });
  });

  it("세션이 없으면 ApiError(no_session, 401)", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await expect(apiFetch("/v1/x")).rejects.toMatchObject({
      name: "ApiError",
      code: "no_session",
      status: 401,
    });
  });

  it("에러 봉투를 파싱해 ApiError(code·한국어 message·status) 로 throw", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    mockFetchOnce(409, {
      error: { code: "role_locked", message: "관리자 역할의 권한은 변경할 수 없습니다.", detail: {} },
    });

    const err = (await apiFetch("/v1/x").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("role_locked");
    expect(err.status).toBe(409);
    expect(err.message).toBe("관리자 역할의 권한은 변경할 수 없습니다.");
  });

  it("네트워크 실패 → ApiError(network_error)", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    global.fetch = vi.fn().mockRejectedValue(new Error("down")) as unknown as typeof fetch;
    await expect(apiFetch("/v1/x")).rejects.toMatchObject({ code: "network_error" });
  });
});
