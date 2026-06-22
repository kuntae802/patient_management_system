"use client";

import { CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { PayChip, TrackingLine } from "@/components/encounters/order-item-meta";
import { ApiError } from "@/lib/api/client";
import { formatKrw } from "@/lib/admin/masters";
import {
  fetchTreatmentOrders,
  performTreatmentOrder,
  type TreatmentOrder,
} from "@/lib/encounters/treatment-orders";

// 처치 수행 패널(Story 5.7 AC1·AC2). 선택 내원의 처치 오더 — ordered=수행 폼(처치기록 내용 선택·busy
// disable 1차선), performed=잠금("수행 완료"·수행자·시각, UX-DR21 ⑤ already-done). 재수행은 상태머신
// (409 invalid_transition) 최종선 — 409 시 토스트 + 재로드. useState 단일 로드(진료 허브 패널 선례).

function timeHmKST(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

export function TreatmentPerformPanel({
  encounterId,
  onPerformed,
}: {
  encounterId: string;
  onPerformed: () => void;
}) {
  const [orders, setOrders] = useState<TreatmentOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setOrders(null);
    try {
      const rows = await fetchTreatmentOrders(encounterId);
      setOrders(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "처치 오더를 불러오지 못했습니다.");
    }
  }, [encounterId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // 수행 성공/409 후 오더 재로드 + 부모 워크리스트(미수행 건수) 갱신.
  const reloadAll = useCallback(() => {
    void load();
    onPerformed();
  }, [load, onPerformed]);

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="text-[12.5px] text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium hover:bg-muted"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (orders === null) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="불러오는 중">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="h-16 animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <p className="rounded-lg border border-border/60 bg-background px-4 py-6 text-center text-[12.5px] text-muted-foreground">
        지시된 처치 오더가 없습니다.
      </p>
    );
  }

  return (
    <ul className="space-y-2.5">
      {orders.map((o) =>
        o.status === "ordered" ? (
          <PerformableOrder key={o.id} order={o} onDone={reloadAll} />
        ) : (
          <PerformedOrder key={o.id} order={o} />
        ),
      )}
    </ul>
  );
}

/** 미수행(ordered) 처치 — 수행 폼(처치기록 내용 선택 + 수행 버튼·busy disable). */
function PerformableOrder({ order, onDone }: { order: TreatmentOrder; onDone: () => void }) {
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  async function perform() {
    if (busy) return; // 이중 제출(재수행) 방지 1차선
    setBusy(true);
    try {
      const trimmed = content.trim();
      await performTreatmentOrder(order.encounter_id, order.id, {
        content: trimmed === "" ? null : trimmed,
      });
      toast.success("처치를 수행 처리했습니다.");
      onDone();
    } catch (err) {
      // 409 invalid_transition(이미 수행·stale 탭)·404(오더 삭제/레이스) = stale 상태 → 재로드로 동기화.
      toast.error(err instanceof ApiError ? err.message : "처치 수행에 실패했습니다.");
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground">{order.fee_name}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
            {order.fee_code} · {formatKrw(order.amount_krw)}
          </p>
        </div>
        <PayChip coverageType={order.coverage_type} />
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        disabled={busy}
        rows={2}
        maxLength={2000}
        aria-label="처치기록 내용(선택)"
        placeholder="처치기록 내용(선택 — 주민번호 등 민감정보 금지)"
        className="mt-2 w-full resize-none rounded-md border border-border bg-card px-2 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-60"
      />
      <div className="mt-2 flex items-center justify-between">
        <TrackingLine ordererName={order.ordered_by_name} />
        <button
          type="button"
          onClick={() => void perform()}
          disabled={busy}
          className="shrink-0 rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "수행 중…" : "수행"}
        </button>
      </div>
    </li>
  );
}

/** 수행 완료(performed/completed) 처치 — 잠금 표시(수행 버튼 미노출, UX-DR21 ⑤ already-done). */
function PerformedOrder({ order }: { order: TreatmentOrder }) {
  return (
    <li className="rounded-lg border border-status-done/30 bg-status-done/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground">{order.fee_name}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
            {order.fee_code} · {formatKrw(order.amount_krw)}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded border border-status-done/40 bg-status-done/12 px-1.5 py-0.5 text-[10.5px] font-bold text-status-done-ink">
          <CheckCircle2 className="size-3" aria-hidden />
          수행 완료
        </span>
      </div>
      <TrackingLine
        ordererName={order.ordered_by_name}
        performerName={
          order.performed_at
            ? `${order.performed_by_name ?? "—"} · ${timeHmKST(order.performed_at)}`
            : order.performed_by_name
        }
      />
    </li>
  );
}
