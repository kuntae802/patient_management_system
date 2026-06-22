"use client";

import { AlertTriangle } from "lucide-react";

import {
  coverageLabel,
  elapsedMinutes,
  isOverdue,
} from "@/lib/encounters/order-safety";

// 오더 아이템 공통 표시 조각(Story 5.5 / UX-DR13·DR21⑥) — 처방·검사·영상·처치 패널이 공유.
// 음영 비의존(색+테두리+라벨/글리프, UX-DR20). pay-chip(급여/비급여)·추적 라인(지시자·수행자)·지연 배지.

/** 급여/비급여 pay-chip — 색+라벨(음영 단독 금지). 급여=그린, 비급여=중립(지시 배지 앰버와 비충돌). */
export function PayChip({ coverageType }: { coverageType: string }) {
  const covered = coverageType !== "non_covered";
  return (
    <span
      className={
        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold " +
        (covered
          ? "border border-status-done/40 bg-status-done/12 text-status-done-ink"
          : "border border-border bg-muted text-muted-foreground")
      }
    >
      {coverageLabel(coverageType)}
    </span>
  );
}

/** 추적 라인(UX-DR21⑦) — 오더→수행: 지시자·수행자 이름. 수행 전이면 fallback("대기"/"약국 대기"). */
export function TrackingLine({
  ordererName,
  performerName,
  performerFallback = "수행 대기",
}: {
  ordererName: string | null;
  performerName?: string | null;
  performerFallback?: string;
}) {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 border-t border-muted pt-1 text-[10.5px] text-muted-foreground">
      <span className="text-foreground/65">오더</span>
      <span>{ordererName ?? "—"}</span>
      <span className="text-foreground/65">· 수행</span>
      <span>{performerName ?? performerFallback}</span>
    </p>
  );
}

/** 누락 0 디텍터 배지(UX-DR21⑥) — 지시 상태로 임계치 초과 미수행 시 "지연 N분"(색+글리프+라벨). */
export function OverdueBadge({
  orderedAt,
  status,
  nowMs,
}: {
  orderedAt: string;
  status: string;
  nowMs: number;
}) {
  if (!isOverdue(orderedAt, status, nowMs)) return null;
  return (
    <span
      role="status"
      className="inline-flex shrink-0 items-center gap-1 rounded border border-status-cancelled/45 bg-status-cancelled/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-status-cancelled"
    >
      <AlertTriangle className="size-3" aria-hidden />
      지연 {elapsedMinutes(orderedAt, nowMs)}분
    </span>
  );
}
