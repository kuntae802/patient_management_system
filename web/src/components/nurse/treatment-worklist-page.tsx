"use client";

import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { StatusBadge } from "@/components/encounters/status-badge";
import { TreatmentPerformPanel } from "@/components/nurse/treatment-perform-panel";
import { ApiError } from "@/lib/api/client";
import {
  elapsedMinutes,
  OVERDUE_THRESHOLD_MIN,
} from "@/lib/encounters/order-safety";
import {
  fetchNursingWorklist,
  type NursingWorklistItem,
} from "@/lib/encounters/treatment-orders";

// 처치 워크리스트 화면(Story 5.7 AC1·AC2, 간호사 전용). 미수행 처치(ordered>0) 보유 내원 목록(좌) →
// 선택 시 처치 오더 수행 패널(우). 간호사는 encounter.read 0 → 이 워크리스트(treatment.perform 게이트)가
// 처치 수행 진입점. 지연 디텍터(UX-DR21 ⑥) = oldest_pending_ordered_at 임계 초과 surface. useState 단일 로드.

/** 미수행 처치가 임계 초과 지연이면 "지연 N분" 배지(UX-DR21 ⑥). 5.5 elapsedMinutes 재사용. */
function OverduePill({
  oldestPendingOrderedAt,
  nowMs,
}: {
  oldestPendingOrderedAt: string | null;
  nowMs: number;
}) {
  if (!oldestPendingOrderedAt || nowMs === 0) return null; // nowMs=0=미로드(SSR/초기) → 미표시
  const mins = elapsedMinutes(oldestPendingOrderedAt, nowMs);
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

export function TreatmentWorklistPage() {
  const [worklist, setWorklist] = useState<NursingWorklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(0); // 지연 디텍터 기준 시각(로드 시점) — 0=미로드

  const loadWorklist = useCallback(async () => {
    try {
      const rows = await fetchNursingWorklist();
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

  // 처치 워크리스트 = 미수행 처치 보유 내원만(FR-090 지시된 처치 오더 조회).
  const pending = worklist?.filter((w) => w.pending_treatment_count > 0) ?? null;
  const selected = pending?.find((w) => w.encounter_id === selectedId) ?? null;

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
      {/* 좌: 미수행 처치 보유 내원 */}
      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border px-4 py-2.5">
          <h2 className="text-[13px] font-semibold text-foreground">수행 대기 처치</h2>
          <p className="text-[11px] text-muted-foreground">처치를 수행할 환자를 선택하세요</p>
        </header>
        {pending === null ? (
          <ListSkeleton />
        ) : pending.length === 0 ? (
          <p className="px-4 py-6 text-[12.5px] text-muted-foreground">
            수행할 처치가 없습니다.
          </p>
        ) : (
          <ul>
            {pending.map((w) => {
              const active = w.encounter_id === selectedId;
              return (
                <li key={w.encounter_id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(w.encounter_id)}
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
                        <span>{w.department_name}</span>
                        <span className="rounded border border-status-received/40 bg-status-received/12 px-1.5 py-0.5 text-[10.5px] font-bold text-status-received-ink">
                          미수행 {w.pending_treatment_count}
                        </span>
                        <OverduePill
                          oldestPendingOrderedAt={w.oldest_pending_ordered_at}
                          nowMs={nowMs}
                        />
                      </p>
                    </div>
                    <StatusBadge status={w.status} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 우: 선택 내원의 처치 오더 수행 */}
      <section className="rounded-xl border border-border bg-card">
        {selected === null ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
            좌측에서 환자를 선택하면 처치를 수행할 수 있습니다.
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
              <p className="text-[11.5px] text-muted-foreground">{selected.department_name}</p>
            </header>
            <TreatmentPerformPanel
              encounterId={selected.encounter_id}
              onPerformed={loadWorklist}
            />
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
