"use client";

import Link from "next/link";
import { Calendar, FileText, User } from "lucide-react";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// 환자 폰 셸 하단 3탭 네비(Story 8.1·UX-DR17 IA: 예약/내 기록/마이). 자체 폰 셸(직원 데스크톱 미상속).
// ⚠️ 예약 화면(/booking)은 sticky CTA(fixed bottom-0)를 써서 탭바와 충돌 — 따라서 탭바는 전역 (patient)
// layout 이 아니라 "내 기록" 화면이 로컬 렌더(예약 화면 무변경·회귀 0). 마이=포털 홈(placeholder).
const TABS = [
  { href: "/booking", label: "예약", Icon: Calendar },
  { href: "/records", label: "내 기록", Icon: FileText },
  { href: "/portal", label: "마이", Icon: User },
] as const;

/** 하단 고정 3탭 바. 활성 탭=usePathname 매칭(aria-current). 최대 폭 max-w-md(모바일 셸). */
export function PatientTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="환자 포털 메뉴"
      className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-md border-t border-border bg-card"
    >
      {TABS.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon aria-hidden className="size-5" strokeWidth={active ? 2.4 : 1.8} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
