import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VitalsDisplay } from "@/components/encounters/vitals-display";
import type { VitalSigns } from "@/lib/encounters/vitals";

// 활력 표시(Story 5.6 AC2, 읽기전용) — 최신 1건·혈압 합산·비정상 강조·빈상태. 네트워크 불요.

function vital(over: Partial<VitalSigns> = {}): VitalSigns {
  return {
    id: "v1",
    encounter_id: "e1",
    systolic: 120,
    diastolic: 80,
    pulse: 72,
    body_temp: 36.5,
    respiratory_rate: 16,
    spo2: 98,
    notes: null,
    recorded_by: "n1",
    recorded_by_name: "간호사김",
    recorded_at: "2026-06-22T01:00:00Z",
    is_active: true,
    created_at: "2026-06-22T01:00:00Z",
    updated_at: "2026-06-22T01:00:00Z",
    ...over,
  };
}

describe("VitalsDisplay", () => {
  it("빈 목록은 빈-상태 문구", () => {
    render(<VitalsDisplay vitals={[]} />);
    expect(screen.getByText("측정된 활력징후가 없습니다.")).toBeInTheDocument();
  });

  it("최신 1건 값·측정자·혈압 합산 표시", () => {
    render(<VitalsDisplay vitals={[vital()]} />);
    expect(screen.getByText("간호사김")).toBeInTheDocument();
    expect(screen.getByText("120/80")).toBeInTheDocument(); // 혈압 합산
    expect(screen.getByText("72")).toBeInTheDocument(); // 맥박
    expect(screen.getByText("98")).toBeInTheDocument(); // SpO2
  });

  it("정상 수치는 비정상 표식 없음", () => {
    render(<VitalsDisplay vitals={[vital()]} />);
    expect(screen.queryByText("(정상범위 밖)")).not.toBeInTheDocument();
  });

  it("비정상 수치는 sr-only 표식 + danger 클래스", () => {
    render(<VitalsDisplay vitals={[vital({ spo2: 90 })]} />);
    const flags = screen.getAllByText("(정상범위 밖)");
    expect(flags.length).toBeGreaterThan(0);
    // SpO2 값 셀이 danger 색을 가진다
    const spo2 = screen.getByText("90");
    expect(spo2.className).toContain("text-destructive");
  });

  it("부분 측정(혈압+체온만)은 측정 항목만 렌더", () => {
    render(
      <VitalsDisplay
        vitals={[
          vital({ pulse: null, respiratory_rate: null, spo2: null, body_temp: 37.2 }),
        ]}
      />,
    );
    expect(screen.getByText("120/80")).toBeInTheDocument();
    expect(screen.getByText("37.2")).toBeInTheDocument();
    // 맥박/호흡/SpO2 라벨 미렌더
    expect(screen.queryByText("맥박")).not.toBeInTheDocument();
    expect(screen.queryByText("SpO₂")).not.toBeInTheDocument();
  });

  it("다중 측정 시 최신(첫 항목) 표시 + 회수 안내", () => {
    render(<VitalsDisplay vitals={[vital({ spo2: 99 }), vital({ id: "v0", spo2: 95 })]} />);
    expect(screen.getByText("99")).toBeInTheDocument();
    expect(screen.getByText("최근 2회 측정 중 최신")).toBeInTheDocument();
  });

  it("메모가 있으면 표시", () => {
    render(<VitalsDisplay vitals={[vital({ notes: "안정적" })]} />);
    expect(screen.getByText("안정적")).toBeInTheDocument();
  });
});
