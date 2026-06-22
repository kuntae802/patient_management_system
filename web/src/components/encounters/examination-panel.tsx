"use client";

import { FlaskConical, Scan } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { MasterSearchPicker } from "@/components/ui/master-search-picker";
import { formatKrw, type MasterPickerItem } from "@/lib/admin/masters";
import { ApiError } from "@/lib/api/client";
import {
  createExamination,
  type Examination,
  type ExamType,
  fetchExaminations,
} from "@/lib/encounters/examinations";
import type { Encounter } from "@/lib/reception/encounters";

// 검사·영상 패널(Story 5.3, FR-060·061 / UX-DR13) — 진료 허브 우 오더 pane(검사·영상; 처방=5.2, 처치=5.4,
// 전체 탭 통합=5.5). exam_type 토글(진단검사/영상검사)로 워크리스트 라우팅 분류 축을 정하고, EDI 행위
// 마스터 검색 피커(free-text 차단)로 행위를 선택하면 즉시 오더(지시 상태)를 생성한다. 검사·영상엔 처방의
// 라인별 파라미터가 없어 드래프트 단계 불요(단순·정확). 패턴: prescription-panel(useState/useEffect/
// useCallback + apiFetch·busy 직렬화), TanStack/Zustand 미사용.

const PICKER_ID = "examination-fee-picker";

const EXAM_TYPES: { value: ExamType; label: string; short: string }[] = [
  { value: "lab", label: "진단검사", short: "검사" },
  { value: "imaging", label: "영상검사", short: "영상" },
];

function examTypeShort(t: string): string {
  return EXAM_TYPES.find((e) => e.value === t)?.short ?? t;
}

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
}: {
  encounter: Encounter;
  today: string;
}) {
  const encounterId = encounter.id;
  const [examinations, setExaminations] = useState<Examination[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [examType, setExamType] = useState<ExamType>("lab");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setExaminations(await fetchExaminations(encounterId));
  }, [encounterId]);

  const load = useCallback(async () => {
    try {
      await reload();
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "검사·영상 오더를 불러오지 못했습니다.",
      );
    }
  }, [reload]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load 의 setState 는 await 이후
    void load();
  }, [load]);

  // 행위 선택 = 즉시 오더(현재 exam_type 과 함께 POST → 목록 reload). 이중 제출은 busy 가드.
  async function order(item: MasterPickerItem | null) {
    if (!item || busy) return;
    setBusy(true);
    try {
      await createExamination(encounterId, { exam_type: examType, fee_schedule_id: item.id });
      await reload();
      const label = EXAM_TYPES.find((e) => e.value === examType)?.label ?? "검사·영상";
      toast.success(`${label} 오더를 생성했습니다.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "검사·영상 오더에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError && examinations === null) {
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

  const ordered = examinations ?? [];

  return (
    <section aria-label="오더 · 검사·영상" className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center gap-2 px-4 pb-2.5 pt-3.5">
        <FlaskConical className="size-4 text-primary" aria-hidden />
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">검사·영상</h2>
        {ordered.length > 0 && (
          <span className="text-[11.5px] text-muted-foreground tabular-nums">
            · {ordered.length}건
          </span>
        )}
      </header>

      <div className="space-y-3 px-4 pb-4">
        {/* 검사 유형 토글 — 워크리스트 라우팅 분류 축(FR-061). 색+라벨(음영 단독 금지, UX-DR20). */}
        <div role="group" aria-label="검사 유형" className="flex gap-1.5">
          {EXAM_TYPES.map((t) => {
            const active = examType === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setExamType(t.value)}
                disabled={busy}
                aria-pressed={active}
                className={
                  "flex-1 rounded-md border px-2 py-1.5 text-[12.5px] font-medium disabled:opacity-60 " +
                  (active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:bg-muted")
                }
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* EDI 행위 마스터 검색(free-text 차단). 선택 = 현재 exam_type 으로 즉시 오더. */}
        <MasterSearchPicker
          kind="fee_schedule"
          today={today}
          id={PICKER_ID}
          ariaLabel="검사·영상 행위 검색"
          placeholder="행위 코드·명칭 검색"
          value={null}
          onValueChange={order}
          disabled={busy}
        />

        {/* 오더된 검사·영상 목록(최신순). */}
        <div className="border-t border-border pt-3">
          {examinations === null ? (
            <div
              className="h-8 animate-pulse rounded-md bg-muted"
              aria-label="검사·영상 불러오는 중"
            />
          ) : ordered.length === 0 ? (
            <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span aria-hidden>○</span>오더된 검사·영상 없음
            </p>
          ) : (
            <ul className="space-y-2">
              {ordered.map((ex) => (
                <li key={ex.id} className="rounded-md border border-border bg-card px-2.5 py-2">
                  <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                      {ex.exam_type === "imaging" ? (
                        <Scan className="size-3" aria-hidden />
                      ) : (
                        <FlaskConical className="size-3" aria-hidden />
                      )}
                      {examTypeShort(ex.exam_type)}
                    </span>
                    <span className="rounded border border-status-received/40 bg-status-received/12 px-1.5 py-0.5 font-medium text-status-received-ink">
                      지시
                    </span>
                    <span className="tabular-nums">{timeHmKST(ex.ordered_at)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[12.5px] text-foreground">
                    <span className="font-semibold tabular-nums">{ex.fee_code}</span>
                    <span className="truncate">{ex.fee_name}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-[11.5px] text-muted-foreground">
                      {formatKrw(ex.amount_krw)}
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
