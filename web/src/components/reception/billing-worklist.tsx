"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { formatKrw } from "@/lib/admin/masters";
import { fetchBillingWorklist, type BillingWorklistItem } from "@/lib/billing/payments";
import { cn } from "@/lib/utils";

// 수납 워크리스트(Story 7.2/7.8 / FR-110·FR-117) — 오늘 수납 대상 내원(registered=선수납 가능 /
// in_progress=정산 대상) 목록. 행 선택 시 집계 상세로 이동(/reception/billing/{encounter_id}). 예상 총액 =
// Σ fee_items(라이브 프리뷰 — registered 는 수가 미발생 0). 상태 칩으로 선수납/정산 구분(A3·색비의존).
// useState 단일 로드(TanStack 미사용 — order-panel/reading-worklist 패턴). 금액 tabular-nums·"원".

/** KST 시:분(진찰 시작 시각 표기) — consult_started_at(ISO UTC) → ko-KR 시:분. */
function timeHm(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(new Date(iso));
}

/** 내원 상태 칩(7.8·A3 색비의존 — 글리프+라벨). 접수=선수납 가능(앰버)·진찰중=정산 대상(중립). */
function WorklistStatusChip({ status }: { status: string }) {
  const meta =
    status === "registered"
      ? {
          label: "접수 · 선수납 가능",
          glyph: "●",
          cls: "border-status-received/40 bg-status-received/10 text-status-received-ink",
        }
      : {
          label: "진찰중 · 정산 대상",
          glyph: "◐",
          cls: "border-border bg-muted text-muted-foreground",
        };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        meta.cls,
      )}
    >
      <span aria-hidden className="text-[8px] leading-none">
        {meta.glyph}
      </span>
      {meta.label}
    </span>
  );
}

export function BillingWorklist() {
  const [items, setItems] = useState<BillingWorklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await fetchBillingWorklist();
      setItems(page.data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "수납 대상을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load 의 setState 는 await 이후
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-[13px] text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 rounded-md border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium hover:bg-muted"
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-foreground">수납 대상 내원</h2>
        <p className="text-[11px] text-muted-foreground">
          정산(진찰중) 또는 선수납(접수)할 내원을 선택하세요
        </p>
      </header>
      {items === null ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <p className="px-4 py-6 text-[12.5px] text-muted-foreground">수납 대상 내원이 없습니다.</p>
      ) : (
        <ul>
          {items.map((it) => (
            <li key={it.encounter_id}>
              <Link
                href={`/reception/billing/${it.encounter_id}`}
                className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5 last:border-0 hover:bg-muted/60"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {it.patient_name}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      {it.chart_no}
                    </span>
                    <WorklistStatusChip status={it.status} />
                  </div>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <span className="tabular-nums">{it.encounter_no}</span>
                    <span aria-hidden>·</span>
                    <span className="truncate">{it.department_name}</span>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">진찰 {timeHm(it.consult_started_at)}</span>
                  </p>
                </div>
                <span className="shrink-0 text-[13px] font-semibold text-foreground tabular-nums">
                  {formatKrw(it.estimated_total_krw)}{" "}
                  <span className="text-[10.5px] font-normal">원</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
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
