import { HelpGuide } from "@/components/help/help-guide";

// 도움말(Story 9.1 / FR-250~253). 부모 (staff)/layout 이 인증(proxy: 미인증 → /login)·직원(requireStaff:
// 비직원 → /portal)을 이미 보장하므로 여기서 가드를 다시 두지 않는다(중복 금지). 현재 계정에 보이는 메뉴만
// 안내하는 동적 인덱스/섹션은 HelpGuide(클라)가 usePermissions + filterNav 로 렌더한다.
export default function HelpPage() {
  return (
    // 도움말은 스크린샷 가시성이 핵심이라 메인 영역 전체 폭을 사용(다른 화면의 max-w-5xl 관습과 의도적으로 다름).
    <div className="px-6 py-8">
      <header className="mb-5">
        <h1 className="text-[18px] font-semibold text-foreground">도움말</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          지금 계정에서 사용할 수 있는 메뉴의 사용법입니다. 위쪽 메뉴를 누르면 해당 안내로 바로 이동합니다.
        </p>
      </header>
      <HelpGuide />
    </div>
  );
}
