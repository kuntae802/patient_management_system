import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PatientHelpGuide } from "@/components/portal/patient-help-guide";

// next/image 는 jsdom 에서 단순 img 로 대체(loader·최적화 경로 우회). src/alt 만 유지.
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element -- 테스트 stub: next/image 최적화 경로 우회
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

describe("PatientHelpGuide — 환자 4메뉴 안내(Story 9.8)", () => {
  it("4개 메뉴가 모두 콘텐츠로 렌더된다(준비 중 0)", () => {
    render(<PatientHelpGuide />);

    // 메뉴 라벨 = 섹션 heading(h2). 화면 title 은 <p>라 heading 중복 없음.
    expect(screen.getByRole("heading", { name: "예약" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "내 진료기록" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "처방·검사 결과" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "수납·영수증" })).toBeInTheDocument();
    // 직원 도움말의 "준비 중" 플레이스홀더는 환자엔 없다(고정 4메뉴 전수).
    expect(screen.queryByText("이 메뉴의 안내는 준비 중입니다.")).not.toBeInTheDocument();
  });

  it("본인 데이터만 보임(RLS) 안내가 노출된다(AC#3)", () => {
    render(<PatientHelpGuide />);
    // 신뢰 노트 hotspot(내 기록·수납 두 화면)에 "다른 사람은 볼 수 없어요" 안내.
    expect(screen.getAllByText(/다른 사람은 볼 수 없어요/).length).toBeGreaterThanOrEqual(2);
  });

  it("핵심 요소가 안내에 포함된다(예약 확정·처방받은 약·영수증 인쇄)", () => {
    render(<PatientHelpGuide />);
    expect(screen.getByText("예약 확정하기")).toBeInTheDocument();
    expect(screen.getByText("처방받은 약")).toBeInTheDocument();
    expect(screen.getByText("영수증 인쇄·저장")).toBeInTheDocument();
  });
});
