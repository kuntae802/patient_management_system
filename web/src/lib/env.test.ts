import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

const VALID = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk_test",
};

describe("parseEnv", () => {
  it("유효한 env → 파싱 통과", () => {
    expect(parseEnv(VALID).NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
  });

  it("URL 누락 → throw", () => {
    expect(() =>
      parseEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk_test" }),
    ).toThrow(/환경변수 검증 실패/);
  });

  it("publishable 키 누락 → throw", () => {
    expect(() =>
      parseEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }),
    ).toThrow(/PUBLISHABLE_KEY/);
  });

  it("URL 형식 오타 → throw", () => {
    expect(() =>
      parseEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: "not-a-url" }),
    ).toThrow(/유효한 URL/);
  });

  it("BASE_PATH 는 선택값(없어도 통과)", () => {
    expect(parseEnv(VALID).NEXT_PUBLIC_BASE_PATH).toBeUndefined();
  });
});
