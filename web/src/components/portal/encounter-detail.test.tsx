import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EncounterDetail } from "@/components/portal/encounter-detail";
import type {
  PatientEncounterDetail,
  PatientExaminationItem,
  PatientPrescriptionItem,
} from "@/lib/patient/encounter-detail";

// Story 8.2(FR-121·UX-DR20·23) — EncounterDetail 검증: 처방(약명·복약 쉬운 말·일수 칩)·검사 결과(요약·
// 정상/주의 배지)·빈 상세 안내·완료 전/플래그 NULL 폴백·하단 안내 노트. 표시 전용(fetch 없음).

function rx(overrides: Partial<PatientPrescriptionItem> = {}): PatientPrescriptionItem {
  return {
    drug_name: "노바스크정5밀리그람(암로디핀)",
    unit: "정",
    dose: 1,
    frequency: "1일 1회",
    usage_instruction: "아침 식후",
    duration_days: 28,
    coverage_type: "covered",
    ...overrides,
  };
}

function exam(overrides: Partial<PatientExaminationItem> = {}): PatientExaminationItem {
  return {
    exam_name: "일반혈액검사(CBC)",
    exam_type: "lab",
    status: "completed",
    patient_result_summary: "피검사 수치가 모두 정상 범위예요.",
    patient_result_flag: "normal",
    completed_at: "2026-06-19T06:00:00Z",
    ...overrides,
  };
}

function detail(overrides: Partial<PatientEncounterDetail> = {}): PatientEncounterDetail {
  return { prescriptions: [], examinations: [], ...overrides };
}

describe("EncounterDetail", () => {
  it("처방: 약명 + 복약 안내 쉬운 말 + 일수 칩", () => {
    render(<EncounterDetail detail={detail({ prescriptions: [rx({})] })} />);

    expect(screen.getByText("처방받은 약")).toBeInTheDocument();
    expect(screen.getByText(/노바스크정5밀리그람/)).toBeInTheDocument();
    expect(screen.getByText("1일 1회, 아침 식후, 1정")).toBeInTheDocument();
    expect(screen.getByText("28일분")).toBeInTheDocument();
  });

  it("비급여 약은 비급여 표시", () => {
    render(<EncounterDetail detail={detail({ prescriptions: [rx({ coverage_type: "non_covered" })] })} />);
    expect(screen.getByText("비급여")).toBeInTheDocument();
  });

  it("검사 정상: 요약 + 정상 배지(색 비의존 라벨)", () => {
    render(<EncounterDetail detail={detail({ examinations: [exam({})] })} />);

    expect(screen.getByText("검사 결과 요약")).toBeInTheDocument();
    expect(screen.getByText("일반혈액검사(CBC)")).toBeInTheDocument();
    expect(screen.getByText("피검사 수치가 모두 정상 범위예요.")).toBeInTheDocument();
    expect(screen.getByText("정상")).toBeInTheDocument();
  });

  it("검사 주의: 주의 배지", () => {
    render(
      <EncounterDetail
        detail={detail({
          examinations: [
            exam({
              exam_name: "당화혈색소(HbA1c)",
              patient_result_summary: "혈당 조절이 조금 더 필요해요.",
              patient_result_flag: "attention",
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText("주의")).toBeInTheDocument();
    expect(screen.getByText("혈당 조절이 조금 더 필요해요.")).toBeInTheDocument();
  });

  it("완료 검사·결과 NULL: 배지 없이 안내 폴백", () => {
    render(
      <EncounterDetail
        detail={detail({
          examinations: [exam({ patient_result_summary: null, patient_result_flag: null })],
        })}
      />,
    );
    expect(screen.queryByText("정상")).not.toBeInTheDocument();
    expect(screen.queryByText("주의")).not.toBeInTheDocument();
    expect(screen.getByText(/결과가 확인되었어요/)).toBeInTheDocument();
  });

  it("완료 전 검사: '아직 결과가 나오지 않았어요' 폴백(플래그 없음)", () => {
    render(
      <EncounterDetail
        detail={detail({
          examinations: [
            exam({ status: "performed", patient_result_summary: null, patient_result_flag: null }),
          ],
        })}
      />,
    );
    expect(screen.getByText("아직 결과가 나오지 않았어요.")).toBeInTheDocument();
    expect(screen.queryByText("정상")).not.toBeInTheDocument();
  });

  it("처방·검사 0건: 안내 문구(둘 다 없음)", () => {
    render(<EncounterDetail detail={detail({})} />);
    expect(screen.getByText("이 진료에는 처방·검사 내역이 없어요.")).toBeInTheDocument();
  });

  it("하단 안내 노트 상시(수치 부재를 덮는 카피)", () => {
    render(<EncounterDetail detail={detail({ examinations: [exam({})] })} />);
    expect(screen.getByText(/자세한 검사 수치와 진료 기록은/)).toBeInTheDocument();
  });
});
