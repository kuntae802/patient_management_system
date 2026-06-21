import { describe, expect, it } from "vitest";

import { type SelfLinkValues, selfLinkSchema, toSelfLinkPayload } from "./self-link";

// 자가연결 클라 1선 검증(Pydantic PatientSelfLinkRequest 거울) + 페이로드(Story 3.4).

const VALID: SelfLinkValues = { resident_no: "9001011234567", name: "홍길동" };

describe("selfLinkSchema", () => {
  it("정상 입력을 통과", () => {
    expect(selfLinkSchema.safeParse(VALID).success).toBe(true);
  });

  it("성명 누락 → 실패", () => {
    expect(selfLinkSchema.safeParse({ ...VALID, name: "  " }).success).toBe(false);
  });

  it("주민번호 미입력 → 실패", () => {
    expect(selfLinkSchema.safeParse({ ...VALID, resident_no: "" }).success).toBe(false);
  });

  it("주민번호 HARD 오류(성별·세기 자리 9) → 실패", () => {
    expect(selfLinkSchema.safeParse({ ...VALID, resident_no: "9001019234567" }).success).toBe(
      false,
    );
  });

  it("주민번호 길이 미달 → 실패", () => {
    expect(selfLinkSchema.safeParse({ ...VALID, resident_no: "123" }).success).toBe(false);
  });

  it("하이픈 입력도 HARD 통과(서버가 정규화)", () => {
    expect(selfLinkSchema.safeParse({ ...VALID, resident_no: "900101-1234567" }).success).toBe(
      true,
    );
  });
});

describe("toSelfLinkPayload", () => {
  it("resident_no·name 만 전송(raw resident_no — 서버가 정규화·매칭)", () => {
    expect(toSelfLinkPayload(VALID)).toEqual({ resident_no: "9001011234567", name: "홍길동" });
  });
});
