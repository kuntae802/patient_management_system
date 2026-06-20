import { describe, expect, it } from "vitest";

import { loginSchema } from "./schema";

describe("loginSchema", () => {
  it("유효 입력 통과", () => {
    expect(loginSchema.safeParse({ email: "staff@example.com", password: "secret" }).success).toBe(
      true,
    );
  });

  it("잘못된 이메일 거부", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });

  it("빈 비밀번호 거부", () => {
    expect(loginSchema.safeParse({ email: "staff@example.com", password: "" }).success).toBe(false);
  });
});
