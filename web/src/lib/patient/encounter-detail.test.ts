import { describe, expect, it } from "vitest";

import {
  formatDosage,
  RESULT_FLAG_META,
  type PatientPrescriptionItem,
} from "@/lib/patient/encounter-detail";

// Story 8.2 — 복약 안내 조립(formatDosage)·결과 플래그 메타 단위 테스트. frequency/usage_instruction 은
// 저장된 한국어를 그대로 결합(코드 매핑 금지) — 누락 필드는 우아하게 생략.

function rx(overrides: Partial<PatientPrescriptionItem>): PatientPrescriptionItem {
  return {
    drug_name: "노바스크정5밀리그람(암로디핀)",
    unit: "정",
    dose: 1,
    frequency: "1일 3회",
    usage_instruction: "매 식후 30분",
    duration_days: 28,
    coverage_type: "covered",
    ...overrides,
  };
}

describe("formatDosage", () => {
  it("저장된 한국어 필드를 그대로 결합한다(코드 매핑 없이)", () => {
    expect(formatDosage(rx({}))).toBe("1일 3회, 매 식후 30분, 1정");
  });

  it("dose+unit 를 1정으로 조립한다", () => {
    expect(formatDosage(rx({ frequency: "1일 1회", usage_instruction: "취침 전", dose: 1, unit: "정" }))).toBe(
      "1일 1회, 취침 전, 1정",
    );
  });

  it("소수 용량·다른 단위도 그대로 표기한다", () => {
    expect(formatDosage(rx({ dose: 0.5, unit: "mL", frequency: "필요시", usage_instruction: null }))).toBe(
      "필요시, 0.5mL",
    );
  });

  it("dose 없으면 용량 파트를 생략한다", () => {
    expect(formatDosage(rx({ dose: null, unit: null, frequency: "1일 2회", usage_instruction: "아침·저녁 식후" }))).toBe(
      "1일 2회, 아침·저녁 식후",
    );
  });

  it("모든 필드 NULL 이면 빈 문자열(클라가 줄 생략)", () => {
    expect(
      formatDosage(rx({ dose: null, unit: null, frequency: null, usage_instruction: null })),
    ).toBe("");
  });
});

describe("RESULT_FLAG_META", () => {
  it("정상/주의 라벨·글리프(색 비의존 접근가능명)", () => {
    expect(RESULT_FLAG_META.normal.label).toBe("정상");
    expect(RESULT_FLAG_META.attention.label).toBe("주의");
    // 색 비의존: 글리프가 색과 별개로 상태를 전달.
    expect(RESULT_FLAG_META.normal.glyph).toBeTruthy();
    expect(RESULT_FLAG_META.attention.glyph).toBeTruthy();
  });
});
