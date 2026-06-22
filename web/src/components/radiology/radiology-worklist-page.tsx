"use client";

import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { CapturePanel } from "@/components/radiology/capture-panel";
import { ApiError } from "@/lib/api/client";
import { elapsedMinutes, OVERDUE_THRESHOLD_MIN } from "@/lib/encounters/order-safety";
import {
  fetchRadiologyWorklist,
  type RadiologyWorklistItem,
} from "@/lib/radiology/imaging";

// 촬영 워크리스트 화면(Story 5.8 AC1·AC2·AC4, 방사선사 전용). 오늘 미수행 영상검사(imaging·ordered)
// 목록(좌) → 선택 시 촬영 캡처 패널(우: 영상 업로드·장비 배정·수행). 수행 시 ordered 아님 → 재로드로
// 목록에서 제거(선택 해제). 지연 디텍터(UX-DR21 ⑥) = ordered_at 임계 초과. useState 단일 로드.

/** 지시 후 임계 초과 지연이면 "지연 N분" 배지(UX-DR21 ⑥). 5.5 elapsedMinutes 재사용. */
function OverduePill({ orderedAt, nowMs }: { orderedAt: string; nowMs: number }) {
  if (nowMs === 0) return null; // 미로드(SSR/초기)
  const mins = elapsedMinutes(orderedAt, nowMs);
  if (mins < OVERDUE_THRESHOLD_MIN) return null;
  return (
    <span
      role="status"
      className="inline-flex shrink-0 items-center gap-1 rounded border border-status-cancelled/45 bg-status-cancelled/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-status-cancelled"
    >
      <AlertTriangle className="size-3" aria-hidden />
      지연 {mins}분
    </span>
  );
}

export function RadiologyWorklistPage() {
  const [worklist, setWorklist] = useState<RadiologyWorklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(0); // 지연 디텍터 기준 시각(로드 시점) — 0=미로드

  const loadWorklist = useCallback(async () => {
    try {
      const rows = await fetchRadiologyWorklist();
      setWorklist(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "워크리스트를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowMs(Date.now());
    void loadWorklist();
  }, [loadWorklist]);

  // 선택 오더가 수행되어 목록에서 빠지면 selected=null → 우측 안내로 복귀(자동).
  const selected = worklist?.find((w) => w.examination_id === selectedId) ?? null;

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-[13px] text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={() => void loadWorklist()}
          className="mt-2 rounded-md border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium hover:bg-muted"
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* 좌: 미수행 영상검사 오더 */}
      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border px-4 py-2.5">
          <h2 className="text-[13px] font-semibold text-foreground">촬영 대기 영상검사</h2>
          <p className="text-[11px] text-muted-foreground">촬영할 검사를 선택하세요</p>
        </header>
        {worklist === null ? (
          <ListSkeleton />
        ) : worklist.length === 0 ? (
          <p className="px-4 py-6 text-[12.5px] text-muted-foreground">
            촬영할 영상검사가 없습니다.
          </p>
        ) : (
          <ul>
            {worklist.map((w) => {
              const active = w.examination_id === selectedId;
              return (
                <li key={w.examination_id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(w.examination_id)}
                    aria-current={active}
                    className={
                      "flex w-full items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5 text-left last:border-0 hover:bg-muted/60 " +
                      (active ? "bg-muted" : "")
                    }
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-foreground">
                          {w.patient_name}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                          {w.chart_no}
                        </span>
                      </div>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                        <span className="truncate">{w.fee_name}</span>
                        {w.image_count > 0 ? (
                          <span className="shrink-0 rounded border border-status-done/40 bg-status-done/12 px-1.5 py-0.5 text-[10.5px] font-bold text-status-done-ink">
                            영상 {w.image_count}
                          </span>
                        ) : null}
                        <OverduePill orderedAt={w.ordered_at} nowMs={nowMs} />
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {w.department_name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 우: 선택 검사의 촬영 캡처 */}
      <section className="rounded-xl border border-border bg-card">
        {selected === null ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
            좌측에서 검사를 선택하면 영상을 업로드하고 촬영을 수행할 수 있습니다.
          </p>
        ) : (
          <div className="space-y-4 p-4">
            <header>
              <h2 className="text-[14px] font-semibold text-foreground">
                {selected.patient_name}
                <span className="ml-2 text-[12px] font-normal text-muted-foreground tabular-nums">
                  {selected.chart_no}
                </span>
              </h2>
              <p className="text-[11.5px] text-muted-foreground">
                {selected.fee_name} · {selected.department_name}
              </p>
            </header>
            <CapturePanel examinationId={selected.examination_id} onPerformed={loadWorklist} />
          </div>
        )}
      </section>
    </div>
  );
}

function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}
