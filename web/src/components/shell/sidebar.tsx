"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LogoutButton } from "@/components/auth/logout-button";
import { usePermissions } from "@/hooks/use-permissions";
import {
  filterNav,
  ROLE_LABELS,
  STAFF_FOOTER_NAV,
  STAFF_NAV,
  type NavItem,
} from "@/lib/nav/staff-nav";
import { cn } from "@/lib/utils";

// 현재 경로가 항목(또는 그 하위)인지 — 활성 표시 판정. usePathname 은 basePath 제외 앱-내 경로 반환.
// best-match: 하위 경로일 때 더 구체적(긴) href 가 매칭하면 부모는 양보 — 예: /reception/billing/history
// 진입 시 부모 /reception/billing(수납)까지 동시 하이라이트되는 prefix 중복을 막는다.
function isNavActive(pathname: string, href: string, allHrefs: string[]): boolean {
  if (pathname === href) return true;
  if (!pathname.startsWith(`${href}/`)) return false;
  return !allHrefs.some(
    (h) =>
      h !== href &&
      h.startsWith(`${href}/`) &&
      (pathname === h || pathname.startsWith(`${h}/`)),
  );
}

function NavLink({
  item,
  collapsed,
  active,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
        collapsed && "justify-center px-0",
        active
          ? "bg-primary/10 font-semibold text-primary-hover before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-primary before:content-['']"
          : "text-foreground hover:bg-muted",
      )}
    >
      <Icon
        className={cn("size-4 shrink-0", active ? "text-primary-hover" : "text-muted-foreground")}
        aria-hidden
      />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
    </Link>
  );
}

// 역할별 셸 — RBAC 노출 게이트(UX-DR4): 권한 없는 항목은 렌더하지 않는다(숨김; 트리에서 제외).
// 메뉴 정의·노출 규칙은 lib/nav/staff-nav. 활성=좌측 teal 액센트 바.
export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  const { role, has } = usePermissions();

  const items = filterNav(STAFF_NAV, role, has);
  const footerItems = filterNav(STAFF_FOOTER_NAV, role, has);
  const allHrefs = [...items, ...footerItems].map((i) => i.href);

  // 섹션 순서를 보존하며 그룹핑(빈 섹션은 자연히 생기지 않음 → 캡션 깨짐 없음).
  const sections: { name: string; items: NavItem[] }[] = [];
  for (const it of items) {
    let group = sections.find((s) => s.name === it.section);
    if (!group) {
      group = { name: it.section, items: [] };
      sections.push(group);
    }
    group.items.push(it);
  }

  const roleLabel = role ? (ROLE_LABELS[role] ?? role) : "";

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
          <span className="truncate text-sm font-semibold text-foreground">한빛 정형외과</span>
        )}
      </div>

      {/* 주 내비 — 섹션별 그룹(권한으로 필터됨) */}
      <nav className="flex-1 space-y-3 overflow-y-auto p-2">
        {sections.map((section) => (
          <div key={section.name} className="space-y-0.5">
            {!collapsed && (
              <div className="px-2.5 pt-1 pb-1 text-[10px] font-bold tracking-[0.09em] text-muted-foreground uppercase">
                {section.name}
              </div>
            )}
            {section.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                collapsed={collapsed}
                active={isNavActive(pathname, item.href, allHrefs)}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* 푸터: 보조 내비 + 역할 표시 */}
      <div className="shrink-0 space-y-0.5 border-t border-border p-2">
        {footerItems.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            collapsed={collapsed}
            active={isNavActive(pathname, item.href, allHrefs)}
          />
        ))}
        {/* 프로필(좌) + 로그아웃(우) 한 줄 — Finding #5(셸 푸터 이동) + 푸터 1행 레이아웃. */}
        <div className="mt-1 flex items-center gap-2 px-2 py-1.5">
          <div className="size-7 shrink-0 rounded-full bg-muted" aria-hidden />
          {!collapsed && roleLabel && (
            <div className="min-w-0">
              <div className="truncate text-[11px] text-muted-foreground">{roleLabel}</div>
            </div>
          )}
          {!collapsed && (
            <div className="ml-auto shrink-0">
              <LogoutButton />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
