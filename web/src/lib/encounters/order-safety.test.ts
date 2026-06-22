import { describe, expect, it } from "vitest";

import {
  allergyMatch,
  allergyTokens,
  coverageLabel,
  elapsedMinutes,
  feePreview,
  isOverdue,
  OVERDUE_THRESHOLD_MIN,
} from "@/lib/encounters/order-safety";

// 오더 안전·표시 순수 유틸(Story 5.5) — 알레르기 매칭·디텍터 임계·수가 프리뷰. DB·네트워크 불요.

describe("allergyTokens / allergyMatch", () => {
  it("빈 알레르기는 토큰 없음", () => {
    expect(allergyTokens(null)).toEqual([]);
    expect(allergyTokens("")).toEqual([]);
    expect(allergyTokens("   ")).toEqual([]);
  });

  it("구분자로 토큰화·길이<2 제외·소문자", () => {
    expect(allergyTokens("아목시실린, 정 / 페니실린")).toEqual([
      "아목시실린",
      "페니실린",
    ]);
  });

  it("약품명 부분일치 시 매칭 토큰 반환", () => {
    expect(allergyMatch("아목시실린", "아목시실린캡슐250밀리그람")).toBe(
      "아목시실린",
    );
  });

  it("무관 알레르기는 null", () => {
    expect(allergyMatch("꽃가루", "타이레놀정500밀리그람")).toBeNull();
  });

  it("클래스 매칭 불가(페니실린 ⊄ 아목시실린)", () => {
    expect(allergyMatch("페니실린", "아목시실린캡슐250밀리그람")).toBeNull();
  });

  it("라틴 대소문자 무관", () => {
    expect(allergyMatch("ASPIRIN", "Aspirin 100mg")).toBe("aspirin");
  });
});

describe("isOverdue / elapsedMinutes", () => {
  const base = Date.parse("2026-06-22T00:00:00Z");

  it("ordered 상태 + 임계 초과 → 지연", () => {
    expect(
      isOverdue(
        "2026-06-22T00:00:00Z",
        "ordered",
        base + OVERDUE_THRESHOLD_MIN * 60_000,
      ),
    ).toBe(true);
  });

  it("임계 직전(29분)은 비지연", () => {
    expect(
      isOverdue("2026-06-22T00:00:00Z", "ordered", base + 29 * 60_000),
    ).toBe(false);
  });

  it("수행/완료/발행 상태는 비대상", () => {
    const later = base + 120 * 60_000;
    expect(isOverdue("2026-06-22T00:00:00Z", "performed", later)).toBe(false);
    expect(isOverdue("2026-06-22T00:00:00Z", "completed", later)).toBe(false);
    expect(isOverdue("2026-06-22T00:00:00Z", "issued", later)).toBe(false);
  });

  it("elapsedMinutes 는 음수 방지(0 하한)", () => {
    expect(elapsedMinutes("2026-06-22T01:00:00Z", base)).toBe(0);
    expect(elapsedMinutes("2026-06-22T00:00:00Z", base + 45 * 60_000)).toBe(45);
  });
});

describe("feePreview / coverageLabel", () => {
  it("급여/비급여 소계와 합계(처방 제외는 호출측 책임)", () => {
    const out = feePreview([
      { amount_krw: 3500, coverage_type: "covered" },
      { amount_krw: 9030, coverage_type: "covered" },
      { amount_krw: 3200, coverage_type: "non_covered" },
    ]);
    expect(out).toEqual({
      coveredKrw: 12530,
      nonCoveredKrw: 3200,
      totalKrw: 15730,
    });
  });

  it("빈 입력은 0", () => {
    expect(feePreview([])).toEqual({
      coveredKrw: 0,
      nonCoveredKrw: 0,
      totalKrw: 0,
    });
  });

  it("coverageLabel 한국어", () => {
    expect(coverageLabel("covered")).toBe("급여");
    expect(coverageLabel("non_covered")).toBe("비급여");
  });
});
