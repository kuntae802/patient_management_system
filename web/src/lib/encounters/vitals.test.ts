import { describe, expect, it } from "vitest";

import { hasAnyVital, isAbnormal } from "@/lib/encounters/vitals";

// 활력 표시·입력 순수 유틸(Story 5.6) — 정상범위 판정·최소1개 가드. DB·네트워크 불요.

describe("isAbnormal", () => {
  it("null(미측정)은 비정상 아님", () => {
    expect(isAbnormal("spo2", null)).toBe(false);
    expect(isAbnormal("systolic", null)).toBe(false);
  });

  it("정상범위 내는 false", () => {
    expect(isAbnormal("systolic", 120)).toBe(false);
    expect(isAbnormal("diastolic", 80)).toBe(false);
    expect(isAbnormal("pulse", 72)).toBe(false);
    expect(isAbnormal("body_temp", 36.5)).toBe(false);
    expect(isAbnormal("respiratory_rate", 16)).toBe(false);
    expect(isAbnormal("spo2", 98)).toBe(false);
  });

  it("범위 밖(저·고)은 true", () => {
    expect(isAbnormal("systolic", 160)).toBe(true); // 고혈압
    expect(isAbnormal("systolic", 85)).toBe(true); // 저혈압
    expect(isAbnormal("spo2", 92)).toBe(true); // 저산소
    expect(isAbnormal("body_temp", 38.5)).toBe(true); // 발열
    expect(isAbnormal("pulse", 110)).toBe(true); // 빈맥
    expect(isAbnormal("respiratory_rate", 8)).toBe(true); // 서호흡
  });

  it("경계값은 정상(포함)", () => {
    expect(isAbnormal("spo2", 95)).toBe(false); // 하한 포함
    expect(isAbnormal("systolic", 139)).toBe(false); // 상한 포함
    expect(isAbnormal("systolic", 90)).toBe(false);
  });
});

describe("hasAnyVital", () => {
  it("전부 빈 값(undefined/null)은 false", () => {
    expect(hasAnyVital({})).toBe(false);
    expect(
      hasAnyVital({
        systolic: undefined,
        diastolic: null,
        pulse: undefined,
        body_temp: null,
        respiratory_rate: undefined,
        spo2: null,
      }),
    ).toBe(false);
  });

  it("하나라도 측정값 있으면 true", () => {
    expect(hasAnyVital({ spo2: 98 })).toBe(true);
    expect(hasAnyVital({ systolic: 120, diastolic: null })).toBe(true);
    expect(hasAnyVital({ body_temp: 36.5 })).toBe(true);
  });

  it("notes 만 있고 측정값 없으면 false(빈 활력)", () => {
    expect(hasAnyVital({ notes: "메모만" })).toBe(false);
  });

  it("0 은 측정값으로 인정(미측정 아님)", () => {
    expect(hasAnyVital({ respiratory_rate: 0 })).toBe(true);
  });
});
