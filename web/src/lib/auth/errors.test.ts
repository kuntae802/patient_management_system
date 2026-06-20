import { describe, expect, it } from "vitest";

import { authErrorMessage } from "./errors";

describe("authErrorMessage", () => {
  it("자격증명 실패(invalid_credentials/400) → 범용 메시지, 원문·이메일 비노출", () => {
    const msg = authErrorMessage({
      status: 400,
      code: "invalid_credentials",
      message: "Invalid login credentials for user@example.com",
    });
    expect(msg).toBe("이메일 또는 비밀번호가 올바르지 않습니다.");
    expect(msg).not.toContain("@");
    expect(msg).not.toContain("credentials");
  });

  it("401은 자격증명 메시지, 403(가입차단·미확인·레이트리밋 등)은 일반 메시지로 분리", () => {
    expect(authErrorMessage({ status: 401 })).toBe("이메일 또는 비밀번호가 올바르지 않습니다.");
    // 403은 correct 비밀번호인데 차단된 케이스라 "비밀번호 오류" 오인 방지 → 일반 메시지
    expect(authErrorMessage({ status: 403 })).toContain("실패");
  });

  it("기타/네트워크 오류 → 일반 실패 메시지", () => {
    expect(authErrorMessage(new Error("network down"))).toContain("실패");
    expect(authErrorMessage(undefined)).toContain("실패");
  });
});
