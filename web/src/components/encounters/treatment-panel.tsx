"use client";

import { Syringe } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { MasterSearchPicker } from "@/components/ui/master-search-picker";
import { formatKrw, type MasterPickerItem } from "@/lib/admin/masters";
import { ApiError } from "@/lib/api/client";
import {
  createTreatmentOrder,
  fetchTreatmentOrders,
  type TreatmentOrder,
} from "@/lib/encounters/treatment-orders";
import type { Encounter } from "@/lib/reception/encounters";

// 처치 패널(Story 5.4, FR-070 / UX-DR13) — 진료 허브 우 오더 pane(처치; 처방=5.2, 검사·영상=5.3,
// 전체 탭 통합=5.5). EDI 처치 행위 마스터 검색 피커(free-text 차단)로 행위를 선택하면 즉시 오더
// (지시 상태)를 생성하고 간호 워크리스트로 전달된다(단일 라우팅 — 검사의 exam_type 분기 없음).
// 패턴: examination-panel(useState/useEffect/useCallback + apiFetch·busy 직렬화), TanStack/Zustand 미사용.

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
}: {
  encounter: Encounter;
  today: string;
}) {
  const encounterId = encounter.id;
  const [treatments, setTreatments] = useState<TreatmentOrder[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setTreatments(await fetchTreatmentOrders(encounterId));
  }, [encounterId]);

  const load = useCallback(async () => {
    try {
      await reload();
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "처치 오더를 불러오지 못했습니다.");
    }
  }, [reload]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load 의 setState 는 await 이후
    void load();
  }, [load]);

  // 행위 선택 = 즉시 오더(POST → 목록 reload). 이중 제출은 busy 가드.
  async function order(item: MasterPickerItem | null) {
    if (!item || busy) return;
    setBusy(true);
    try {
      await createTreatmentOrder(encounterId, { fee_schedule_id: item.id });
      await reload();
      toast.success("처치 오더를 생성했습니다.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "처치 오더에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError && treatments === null) {
    return (
      <section className="rounded-xl border border-border bg-card px-4 py-5 text-center">
        <p className="text-[13px] text-muted-foreground">{loadError}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
        >
          다시 시도
        </button>
      </section>
    );
  }

  const ordered = treatments ?? [];

  return (
    <section aria-label="오더 · 처치" className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center gap-2 px-4 pb-2.5 pt-3.5">
        <Syringe className="size-4 text-primary" aria-hidden />
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">처치</h2>
        {ordered.length > 0 && (
          <span className="text-[11.5px] text-muted-foreground tabular-nums">
            · {ordered.length}건
          </span>
        )}
      </header>

      <div className="space-y-3 px-4 pb-4">
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
            <div className="h-8 animate-pulse rounded-md bg-muted" aria-label="처치 불러오는 중" />
          ) : ordered.length === 0 ? (
            <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span aria-hidden>○</span>오더된 처치 없음
            </p>
          ) : (
            <ul className="space-y-2">
              {ordered.map((tr) => (
                <li key={tr.id} className="rounded-md border border-border bg-card px-2.5 py-2">
                  <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                    <span className="rounded border border-status-received/40 bg-status-received/12 px-1.5 py-0.5 font-medium text-status-received-ink">
                      지시
                    </span>
                    <span className="tabular-nums">{timeHmKST(tr.ordered_at)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[12.5px] text-foreground">
                    <span className="font-semibold tabular-nums">{tr.fee_code}</span>
                    <span className="truncate">{tr.fee_name}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-[11.5px] text-muted-foreground">
                      {formatKrw(tr.amount_krw)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
