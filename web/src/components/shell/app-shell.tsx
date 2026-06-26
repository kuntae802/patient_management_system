"use client";

import { useState } from "react";

import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

// 전역 셸 골격(UX-DR4). 6역할 공통 상속. 사이드바 접힘은 로컬 UI 상태(useState).
// 인증·RBAC 노출 게이트·route group (staff) 배선은 Story 1.4/1.6 소유.
export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar collapsed={collapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          collapsed={collapsed}
          onToggleSidebar={() => setCollapsed((c) => !c)}
        />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
