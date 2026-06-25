import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PermissionsProvider } from "@/components/auth/permissions-provider";
import { HelpGuide } from "@/components/help/help-guide";
import { helpHrefSlug } from "@/lib/help/help-content";

// next/image 는 jsdom 에서 단순 img 로 대체(loader·최적화 경로 우회). src/alt 만 유지.
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element -- 테스트 stub: next/image 최적화 경로 우회
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

function renderAs(role: string | null, permissions: string[] = []) {
  return render(
    <PermissionsProvider role={role} permissions={permissions}>
      <HelpGuide />
    </PermissionsProvider>,
  );
}

describe("HelpGuide — 현재 계정 메뉴만 동적 렌더(FR-251)", () => {
  it("원무 계정은 원무 메뉴만 보이고 관리자 전용 메뉴는 인덱스·본문에 없다", () => {
    renderAs("reception");

    expect(screen.getByRole("link", { name: "대기 현황" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "수납" })).toBeInTheDocument();
    // 관리자 전용(역할/권한 게이트) 메뉴 미노출
    expect(screen.queryByText("권한")).not.toBeInTheDocument();
    expect(screen.queryByText("감사 로그")).not.toBeInTheDocument();
  });

  it("원무 계정은 8개 메뉴가 모두 안내 콘텐츠로 채워진다(Story 9.3 — 준비 중 플레이스홀더 0)", () => {
    renderAs("reception");

    // 모든 원무 메뉴에 콘텐츠가 있어 플레이스홀더가 하나도 없어야 한다(FR-253 빠짐없이 수록).
    expect(screen.queryByText("이 메뉴의 안내는 준비 중입니다.")).not.toBeInTheDocument();
    // 핵심 흐름 요소 spot-check(대기 현황·수납 상세 hotspot).
    expect(screen.getByText("다음 호출")).toBeInTheDocument();
    expect(screen.getByText("결제·내원 완료")).toBeInTheDocument();
  });

  it("의사 계정은 모든 메뉴(진료 대기·판독·환자 검색)가 콘텐츠로 채워진다(Story 9.4 — 준비 중 0)", () => {
    renderAs("doctor");

    expect(screen.getByRole("heading", { name: "진료 대기" })).toBeInTheDocument();
    // 진료 대기 hotspot(9.1 시범)
    expect(screen.getByText("진료 시작")).toBeInTheDocument();
    // 판독 메뉴 섹션 + hotspot(9.4 신규)
    expect(screen.getByRole("heading", { name: "판독" })).toBeInTheDocument();
    expect(screen.getByText("판독 대기 영상검사")).toBeInTheDocument();
    // 의사 3메뉴 모두 콘텐츠 → 플레이스홀더 0(환자 검색은 9.3 공유 /patients 가이드).
    expect(screen.queryByText("이 메뉴의 안내는 준비 중입니다.")).not.toBeInTheDocument();
  });

  it("간호 계정은 3개 메뉴(처치 워크리스트·활력징후 입력·간호기록)가 모두 콘텐츠로 채워진다(Story 9.5 — 준비 중 0)", () => {
    renderAs("nurse");

    expect(screen.getByRole("heading", { name: "처치 워크리스트" })).toBeInTheDocument();
    // worklist hotspot(고유 텍스트 — "오늘 활성 내원"은 vitals·notes 중복이라 사용 안 함)
    expect(screen.getByText("수행 대기 처치")).toBeInTheDocument();
    expect(screen.queryByText("이 메뉴의 안내는 준비 중입니다.")).not.toBeInTheDocument();
  });

  it("관리자라도 권한이 없으면 권한 게이트 메뉴가 전혀 노출되지 않는다", () => {
    renderAs("admin", []); // 권한 0 — admin 메뉴는 전부 requiredPermission 보유

    expect(screen.queryByText("권한")).not.toBeInTheDocument();
    expect(screen.getByText("현재 계정에 표시되는 메뉴가 없습니다.")).toBeInTheDocument();
  });

  it("관리자에게 보유한 권한의 메뉴만 노출된다", () => {
    renderAs("admin", ["dashboard.read"]);

    expect(screen.getByRole("link", { name: "운영/대시보드" })).toBeInTheDocument();
    expect(screen.queryByText("권한")).not.toBeInTheDocument(); // rbac.manage 미보유
  });

  it("인덱스 앵커 href 와 섹션 id 가 슬러그로 일치한다", () => {
    const { container } = renderAs("doctor");

    const link = screen.getByRole("link", { name: "진료 대기" });
    expect(link).toHaveAttribute("href", `#${helpHrefSlug("/doctor/waiting")}`);
    expect(container.querySelector(`#${helpHrefSlug("/doctor/waiting")}`)).not.toBeNull();
  });

  it("역할이 없으면 안내 메시지를 보여준다", () => {
    renderAs(null);

    expect(screen.getByText("현재 계정에 표시되는 메뉴가 없습니다.")).toBeInTheDocument();
  });
});
