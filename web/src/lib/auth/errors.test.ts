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

  it("401/403도 동일 범용 메시지", () => {
    expect(authErrorMessage({ status: 401 })).toBe("이메일 또는 비밀번호가 올바르지 않습니다.");
    expect(authErrorMessage({ status: 403 })).toBe("이메일 또는 비밀번호가 올바르지 않습니다.");
  });

  it("기타/네트워크 오류 → 일반 실패 메시지", () => {
    expect(authErrorMessage(new Error("network down"))).toContain("실패");
    expect(authErrorMessage(undefined)).toContain("실패");
  });
});
