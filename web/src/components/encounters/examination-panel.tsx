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
  cancelExamination,
  createExamination,
  type Examination,
  type ExamType,
} from "@/lib/encounters/examinations";
import type { Encounter } from "@/lib/reception/encounters";

// 검사·영상 패널(Story 5.3·5.5, FR-060·061 / UX-DR13 검사·영상 탭) — order-panel(5.5) 의 controlled 자식.
// ⚠️ exam_type 토글 제거 — 탭 선택(검사=lab / 영상=imaging)이 examType 을 결정(order-panel 이 분할 렌더).
// 데이터·reload·nowMs 는 order-panel 소유. 본 패널은 피커 어더(즉시 오더) + 목록(pay-chip·추적·지연) 렌더만.

const TYPE_LABEL: Record<ExamType, string> = {
  lab: "진단검사",
  imaging: "영상검사",
};

function timeHmKST(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

export function ExaminationPanel({
  encounter,
  today,
  examType,
  examinations,
  nowMs,
  onReload,
}: {
  encounter: Encounter;
  today: string;
  examType: ExamType; // 탭이 결정(검사=lab / 영상=imaging)
  examinations: Examination[] | null; // 해당 유형으로 필터된 슬라이스(null=로딩)
  nowMs: number;
  onReload: () => Promise<void> | void;
}) {
  const encounterId = encounter.id;
  const [busy, setBusy] = useState(false);
  const label = TYPE_LABEL[examType];

  // 행위 선택 = 즉시 오더(현재 탭의 exam_type 으로 POST → order-panel reload). 이중 제출은 busy 가드.
  async function order(item: MasterPickerItem | null) {
    if (!item || busy) return;
    setBusy(true);
    try {
      await createExamination(encounterId, {
        exam_type: examType,
        fee_schedule_id: item.id,
      });
      await onReload();
      toast.success(`${label} 오더를 생성했습니다.`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : `${label} 오더에 실패했습니다.`,
      );
    } finally {
      setBusy(false);
    }
  }

  // 미수행 오더 취소(0056) — order() 미러 + confirm. 409(이미 수행)/404 → onReload 로 상태 동기화.
  async function cancel(examinationId: string) {
    if (busy) return;
    if (!window.confirm(`${label} 오더를 취소하시겠습니까?`)) return;
    setBusy(true);
    try {
      await cancelExamination(encounterId, examinationId);
      await onReload();
      toast.success(`${label} 오더를 취소했습니다.`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : `${label} 취소에 실패했습니다.`,
      );
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        await onReload();
      }
    } finally {
      setBusy(false);
    }
  }

  const ordered = examinations ?? [];

  return (
    <div className="space-y-3">
      {/* EDI 행위 마스터 검색(free-text 차단). 선택 = 현재 탭 유형으로 즉시 오더. */}
      <MasterSearchPicker
        kind="fee_schedule"
        today={today}
        id={`examination-fee-picker-${examType}`}
        ariaLabel={`${label} 행위 검색`}
        placeholder="행위 코드·명칭 검색"
        value={null}
        onValueChange={order}
        disabled={busy}
      />

      {/* 오더된 목록(최신순). */}
      <div className="border-t border-border pt-3">
        {examinations === null ? (
          <div
            className="h-8 animate-pulse rounded-md bg-muted"
            aria-label={`${label} 불러오는 중`}
          />
        ) : ordered.length === 0 ? (
          <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span aria-hidden>○</span>오더된 {label} 없음
          </p>
        ) : (
          <ul className="space-y-2">
            {ordered.map((ex) => (
              <li
                key={ex.id}
                className={`rounded-md border border-border bg-card px-2.5 py-2${
                  ex.status === "cancelled" ? " opacity-60" : ""
                }`}
              >
                <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                  {ex.status === "cancelled" ? (
                    <span className="rounded border border-status-cancelled/40 bg-status-cancelled/12 px-1.5 py-0.5 font-medium text-status-cancelled">
                      취소됨
                    </span>
                  ) : (
                    <span className="rounded border border-status-received/40 bg-status-received/12 px-1.5 py-0.5 font-medium text-status-received-ink">
                      지시
                    </span>
                  )}
                  <span className="tabular-nums">
                    {timeHmKST(ex.ordered_at)}
                  </span>
                  <OverdueBadge
                    orderedAt={ex.ordered_at}
                    status={ex.status}
                    nowMs={nowMs}
                  />
                  {ex.status === "ordered" && (
                    <button
                      type="button"
                      onClick={() => void cancel(ex.id)}
                      disabled={busy}
                      className="ml-auto shrink-0 rounded border border-status-cancelled/40 px-1.5 py-0.5 text-[11px] font-medium text-status-cancelled hover:bg-status-cancelled/10 disabled:opacity-50"
                    >
                      취소
                    </button>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[12.5px] text-foreground">
                  <span className="font-semibold tabular-nums">
                    {ex.fee_code}
                  </span>
                  <span className="truncate">{ex.fee_name}</span>
                  <PayChip coverageType={ex.coverage_type} />
                  <span className="ml-auto shrink-0 tabular-nums text-[11.5px] text-muted-foreground">
                    {formatKrw(ex.amount_krw)}
                  </span>
                </div>
                <TrackingLine
                  ordererName={ex.ordered_by_name}
                  performerName={ex.performed_by_name}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
