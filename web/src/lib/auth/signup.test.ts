import { describe, expect, it } from "vitest";

import { SIGNUP_PATH } from "./branch";
import { signupErrorMessage } from "./errors";
import { type SignupInput, signupSchema } from "./schema";

// 자가가입 폼 검증(config 비밀번호 정책 거울) + 공개 경로 상수 + 오류 매핑(Story 3.4).

const VALID: SignupInput = {
  email: "patient@example.com",
  password: "Patient1234",
  passwordConfirm: "Patient1234",
};

describe("signupSchema", () => {
  it("정상 입력을 통과", () => {
    expect(signupSchema.safeParse(VALID).success).toBe(true);
  });

  it("이메일 형식 오류 → 실패", () => {
    expect(signupSchema.safeParse({ ...VALID, email: "not-an-email" }).success).toBe(false);
  });

  it("비밀번호 8자 미만 → 실패", () => {
    const bad = { email: VALID.email, password: "Pa1", passwordConfirm: "Pa1" };
    expect(signupSchema.safeParse(bad).success).toBe(false);
  });

  it("대문자 누락 → 실패", () => {
    const bad = { email: VALID.email, password: "patient1234", passwordConfirm: "patient1234" };
    expect(signupSchema.safeParse(bad).success).toBe(false);
  });

  it("숫자 누락 → 실패", () => {
    const bad = { email: VALID.email, password: "PatientPass", passwordConfirm: "PatientPass" };
    expect(signupSchema.safeParse(bad).success).toBe(false);
  });

  it("비밀번호 확인 불일치 → 실패(passwordConfirm 경로)", () => {
    const result = signupSchema.safeParse({ ...VALID, passwordConfirm: "Patient9999" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("passwordConfirm"))).toBe(true);
    }
  });
});

describe("SIGNUP_PATH", () => {
  it("미들웨어 공개 경로 상수", () => {
    expect(SIGNUP_PATH).toBe("/signup");
  });
});

describe("signupErrorMessage", () => {
  it("이미 가입된 이메일", () => {
    expect(signupErrorMessage({ code: "user_already_exists" })).toContain("이미 가입");
    expect(signupErrorMessage({ message: "User already registered" })).toContain("이미 가입");
  });

  it("약한 비밀번호", () => {
    expect(signupErrorMessage({ code: "weak_password" })).toContain("보안 정책");
  });

  it("그 외는 일반 메시지(무PII)", () => {
    expect(signupErrorMessage({ status: 500 })).toContain("회원가입");
  });
});
