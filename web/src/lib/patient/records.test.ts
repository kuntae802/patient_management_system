import { describe, expect, it } from "vitest";

import {
  PATIENT_STATUS_LABEL,
  formatVisitDate,
  formatVisitTime,
  visitTimeSuffix,
  visitTimestamp,
  visitYear,
  type PatientEncounterCard,
} from "@/lib/patient/records";

// 내 기록 표시 헬퍼(Story 8.1·UX-DR17·AC5) — 12시간 KST·날짜·연도·대표 일시 폴백·접미 라벨·환자 톤 라벨.

function base(overrides: Partial<PatientEncounterCard> = {}): PatientEncounterCard {
  return {
    id: "e1",
    encounter_no: "00000001",
    status: "completed",
    visit_type: "reserved",
    department_name: "내과",
    doctor_name: "이정훈",
    scheduled_start: null,
    registered_at: null,
    consult_started_at: null,
    completed_at: null,
    cancelled_at: null,
    created_at: "2026-06-19T05:10:00Z",
    cancel_reason: null,
    primary_diagnosis_name: null,
    primary_diagnosis_friendly_note: null,
    ...overrides,
  };
}

describe("records 표시 헬퍼", () => {
  it("formatVisitTime: KST 12시간 변환(14:30→2:30)", () => {
    // 05:30 UTC = 14:30 KST → 12시간이면 "2:30"(오후, period 워드는 환경 ICU 의존이라 미단언).
    expect(formatVisitTime("2026-06-19T05:30:00Z")).toContain("2:30");
    // 23:00 UTC = 08:00 KST(다음날) → "8:00".
    expect(formatVisitTime("2026-06-18T23:00:00Z")).toContain("8:00");
  });

  it("formatVisitDate: KST 연·월·일·요일", () => {
    expect(formatVisitDate("2026-06-19T05:30:00Z")).toContain("2026");
    expect(formatVisitDate("2026-06-19T05:30:00Z")).toContain("6");
    expect(formatVisitDate("2026-06-19T05:30:00Z")).toContain("19");
  });

  it("visitTimestamp: 진찰시작 → 접수 → 예약 → 생성 순 폴백", () => {
    expect(visitTimestamp(base({ consult_started_at: "C", registered_at: "R" }))).toBe("C");
    expect(visitTimestamp(base({ registered_at: "R", scheduled_start: "S" }))).toBe("R");
    expect(visitTimestamp(base({ scheduled_start: "S" }))).toBe("S");
    expect(visitTimestamp(base())).toBe("2026-06-19T05:10:00Z");
  });

  it("visitYear: KST 연도(그룹 캡션)", () => {
    expect(visitYear(base({ consult_started_at: "2025-12-31T16:00:00Z" }))).toBe("2026");
  });

  it("visitTimeSuffix: 진료/예약/접수", () => {
    expect(visitTimeSuffix(base({ consult_started_at: "C" }))).toBe("진료");
    expect(visitTimeSuffix(base({ visit_type: "reserved" }))).toBe("예약");
    expect(visitTimeSuffix(base({ visit_type: "walk_in" }))).toBe("접수");
  });

  it("PATIENT_STATUS_LABEL: 환자 톤(노쇼→미방문)", () => {
    expect(PATIENT_STATUS_LABEL.no_show).toBe("미방문");
    expect(PATIENT_STATUS_LABEL.in_progress).toBe("진료 중");
    expect(PATIENT_STATUS_LABEL.completed).toBe("완료");
  });
});
