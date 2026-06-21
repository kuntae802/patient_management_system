"use client";

import { Bell, CircleUserRound, PanelLeft } from "lucide-react";

import { Clock } from "./clock";
import { PatientSearchCommand } from "./patient-search-command";

export function Topbar({
  collapsed,
  onToggleSidebar,
}: {
  collapsed: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-border bg-card px-3">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="사이드바 접기/펼치기"
        aria-expanded={!collapsed}
        aria-controls="app-sidebar"
        className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
      >
        <PanelLeft className="size-4" aria-hidden />
      </button>

      {/* 페이지 타이틀/브레드크럼 슬롯 */}
      <div className="min-w-0 truncate text-sm font-semibold text-foreground">대기 현황</div>

      {/* 전역 환자 검색 — Ctrl K 커맨드 팔레트(Story 3.5). 트리거+단축키+팔레트 일체(patient.read 게이트). */}
      <PatientSearchCommand />

      <div className="ml-auto flex shrink-0 items-center gap-3">
        {/* 실시간 인디케이터 슬롯 */}
        <span className="hidden items-center gap-1.5 text-[12px] text-muted-foreground md:flex">
          <span className="size-2 rounded-full bg-status-done" aria-hidden />
          실시간
        </span>

        <Clock />

        {/* 알림 벨 + 배지 슬롯 */}
        <button
          type="button"
          aria-label="알림 3건"
          className="relative grid size-8 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted"
        >
          <Bell className="size-4" aria-hidden />
          <span
            className="absolute -top-1.5 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold tabular-nums text-white"
            aria-hidden
          >
            3
          </span>
        </button>

        {/* 아바타/역할 메뉴 슬롯 */}
        <button
          type="button"
          aria-label="내 계정"
          className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <CircleUserRound className="size-5" aria-hidden />
        </button>
      </div>
    </header>
  );
}
