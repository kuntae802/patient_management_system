import { describe, expect, it } from "vitest";

import {
  type Guardian,
  type GuardianValues,
  guardianSchema,
  RELATIONSHIP_PRESETS,
  toGuardianPayload,
  toGuardianValues,
} from "./guardians";

// 보호자 클라 1선 검증(Pydantic Guardian* 거울) + 페이로드 변환(Story 3.3).

const VALID: GuardianValues = { name: "김보호", relationship: "배우자", phone: "010-1234-5678" };

describe("guardianSchema (Pydantic 거울)", () => {
  it("유효 입력 통과", () => {
    expect(guardianSchema.safeParse(VALID).success).toBe(true);
  });

  it("phone 빈 값 허용(옵셔널)", () => {
    expect(guardianSchema.safeParse({ ...VALID, phone: "" }).success).toBe(true);
  });

  it("name 빈 값 → 실패(필수)", () => {
    expect(guardianSchema.safeParse({ ...VALID, name: "" }).success).toBe(false);
    expect(guardianSchema.safeParse({ ...VALID, name: "   " }).success).toBe(false); // trim 후 빈 값
  });

  it("relationship 빈 값 → 실패(필수)", () => {
    expect(guardianSchema.safeParse({ ...VALID, relationship: "" }).success).toBe(false);
  });

  it("max_length 초과 → 실패", () => {
    expect(guardianSchema.safeParse({ ...VALID, name: "가".repeat(101) }).success).toBe(false);
    expect(
      guardianSchema.safeParse({ ...VALID, relationship: "가".repeat(51) }).success,
    ).toBe(false);
    expect(guardianSchema.safeParse({ ...VALID, phone: "0".repeat(21) }).success).toBe(false);
  });
});

describe("toGuardianPayload", () => {
  it("빈 phone 은 null 로 전송(명시 삭제 — PUT 전체 교체)", () => {
    const payload = toGuardianPayload({ name: "김보호", relationship: "자녀", phone: "" });
    expect(payload).toEqual({ name: "김보호", relationship: "자녀", phone: null });
  });

  it("채워진 값은 그대로 전송", () => {
    const payload = toGuardianPayload(VALID);
    expect(payload).toEqual({ name: "김보호", relationship: "배우자", phone: "010-1234-5678" });
  });
});

describe("toGuardianValues", () => {
  it("보호자 → 폼 기본값(null phone → 빈 문자열)", () => {
    const g: Guardian = {
      id: "g1",
      patient_id: "p1",
      name: "이보호",
      relationship: "부모",
      phone: null,
      created_at: "2026-06-21T00:00:00Z",
      updated_at: "2026-06-21T00:00:00Z",
    };
    expect(toGuardianValues(g)).toEqual({ name: "이보호", relationship: "부모", phone: "" });
  });
});

describe("RELATIONSHIP_PRESETS", () => {
  it("공통 관계 프리셋 제공(자유 입력 허용 — 폐쇄어휘 아님)", () => {
    expect(RELATIONSHIP_PRESETS).toContain("배우자");
    expect(RELATIONSHIP_PRESETS).toContain("기타");
    expect(RELATIONSHIP_PRESETS.length).toBeGreaterThan(0);
  });
});
