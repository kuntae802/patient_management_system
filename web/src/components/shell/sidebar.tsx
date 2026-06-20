import {
  CalendarDays,
  CircleHelp,
  LayoutDashboard,
  Printer,
  Search,
  Settings,
  UserPlus,
  UserRoundPlus,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  icon: LucideIcon;
  count?: number;
  active?: boolean;
};

// 정적 placeholder 내비(원무 역할 예시). RBAC 노출 게이트(usePermissions)·실제 라우트 연결은 Story 1.6.
const primaryNav: NavItem[] = [
  { label: "대기 현황", icon: LayoutDashboard, count: 11, active: true },
  { label: "접수", icon: UserPlus },
  { label: "예약 관리", icon: CalendarDays },
  { label: "환자 등록", icon: UserRoundPlus },
  { label: "환자 검색", icon: Search },
  { label: "수납", icon: Wallet },
  { label: "문서 출력", icon: Printer },
];

const footerNav: NavItem[] = [
  { label: "설정", icon: Settings },
  { label: "도움말", icon: CircleHelp },
];

function NavButton({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      aria-label={item.label}
      aria-current={item.active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
        collapsed && "justify-center px-0",
        item.active
          ? "bg-primary/10 font-semibold text-primary-hover before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-primary before:content-['']"
          : "text-foreground hover:bg-muted",
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          item.active ? "text-primary-hover" : "text-muted-foreground",
        )}
        aria-hidden
      />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {!collapsed && item.count != null && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
            item.active
              ? "bg-primary/15 text-primary-hover"
              : "bg-muted text-muted-foreground",
          )}
        >
          {item.count}
        </span>
      )}
    </button>
  );
}

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  return (
    <aside
      id="app-sidebar"
      aria-label="주 메뉴"
      className={cn(
        "flex shrink-0 flex-col border-r border-border bg-sidebar transition-[width]",
        collapsed ? "w-sidebar-collapsed" : "w-sidebar",
      )}
    >
      {/* 로고 + 병원명 */}
      <div className="flex h-topbar shrink-0 items-center gap-2.5 border-b border-border px-3">
        <div className="size-7 shrink-0 rounded-md bg-primary" aria-hidden />
        {!collapsed && (
          <span className="truncate text-sm font-semibold text-foreground">
            한빛 정형외과
          </span>
        )}
      </div>

      {/* 주 내비 */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {primaryNav.map((item) => (
          <NavButton key={item.label} item={item} collapsed={collapsed} />
        ))}
      </nav>

      {/* 푸터: 보조 내비 + 사용자/역할 */}
      <div className="shrink-0 space-y-0.5 border-t border-border p-2">
        {footerNav.map((item) => (
          <NavButton key={item.label} item={item} collapsed={collapsed} />
        ))}
        <div className="mt-1 flex items-center gap-2 px-2 py-1.5">
          <div className="size-7 shrink-0 rounded-full bg-muted" aria-hidden />
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-[13px] text-foreground">정해린</div>
              <div className="truncate text-[11px] text-muted-foreground">원무</div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
