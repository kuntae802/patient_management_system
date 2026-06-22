"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  OverdueBadge,
  PayChip,
  TrackingLine,
} from "@/components/encounters/order-item-meta";
import { MasterSearchPicker } from "@/components/ui/master-search-picker";
import { formatKrw, type MasterPickerItem } from "@/lib/admin/masters";
import { ApiError } from "@/lib/api/client";
import {
  createTreatmentOrder,
  type TreatmentOrder,
} from "@/lib/encounters/treatment-orders";
import type { Encounter } from "@/lib/reception/encounters";

// 처치 패널(Story 5.4·5.5, FR-070 / UX-DR13 처치 탭) — order-panel(5.5) 의 controlled 자식. 데이터·reload 는
// order-panel 이 소유(탭 카운트·수가 프리뷰·디텍터 집계 위해 리프트). 본 패널은 피커 어더(즉시 오더) + 목록
// (pay-chip·추적 라인·지연 배지) 렌더만. EDI 처치 행위 마스터 검색(free-text 차단) → 즉시 오더(간호 단일 라우팅).

const PICKER_ID = "treatment-fee-picker";

function timeHmKST(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

export function TreatmentPanel({
  encounter,
  today,
  treatments,
  nowMs,
  onReload,
}: {
  encounter: Encounter;
  today: string;
  treatments: TreatmentOrder[] | null; // null=로딩(order-panel 소유)
  nowMs: number;
  onReload: () => Promise<void> | void;
}) {
  const encounterId = encounter.id;
  const [busy, setBusy] = useState(false);

  // 행위 선택 = 즉시 오더(POST → order-panel reload). 이중 제출은 busy 가드.
  async function order(item: MasterPickerItem | null) {
    if (!item || busy) return;
    setBusy(true);
    try {
      await createTreatmentOrder(encounterId, { fee_schedule_id: item.id });
      await onReload();
      toast.success("처치 오더를 생성했습니다.");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "처치 오더에 실패했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  const ordered = treatments ?? [];

  return (
    <div className="space-y-3">
      {/* EDI 처치 행위 마스터 검색(free-text 차단). 선택 = 즉시 오더(간호 워크리스트 전달). */}
      <MasterSearchPicker
        kind="fee_schedule"
        today={today}
        id={PICKER_ID}
        ariaLabel="처치 행위 검색"
        placeholder="행위 코드·명칭 검색"
        value={null}
        onValueChange={order}
        disabled={busy}
      />

      {/* 오더된 처치 목록(최신순). */}
      <div className="border-t border-border pt-3">
        {treatments === null ? (
          <div
            className="h-8 animate-pulse rounded-md bg-muted"
            aria-label="처치 불러오는 중"
          />
        ) : ordered.length === 0 ? (
          <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span aria-hidden>○</span>오더된 처치 없음
          </p>
        ) : (
          <ul className="space-y-2">
            {ordered.map((tr) => (
              <li
                key={tr.id}
                className="rounded-md border border-border bg-card px-2.5 py-2"
              >
                <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                  <span className="rounded border border-status-received/40 bg-status-received/12 px-1.5 py-0.5 font-medium text-status-received-ink">
                    지시
                  </span>
                  <span className="tabular-nums">
                    {timeHmKST(tr.ordered_at)}
                  </span>
                  <OverdueBadge
                    orderedAt={tr.ordered_at}
                    status={tr.status}
                    nowMs={nowMs}
                  />
                </div>
                <div className="mt-1 flex items-center gap-2 text-[12.5px] text-foreground">
                  <span className="font-semibold tabular-nums">
                    {tr.fee_code}
                  </span>
                  <span className="truncate">{tr.fee_name}</span>
                  <PayChip coverageType={tr.coverage_type} />
                  <span className="ml-auto shrink-0 tabular-nums text-[11.5px] text-muted-foreground">
                    {formatKrw(tr.amount_krw)}
                  </span>
                </div>
                <TrackingLine
                  ordererName={tr.ordered_by_name}
                  performerName={tr.performed_by_name}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
