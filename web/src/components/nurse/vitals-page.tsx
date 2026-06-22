"use client";

import { useCallback, useEffect, useState } from "react";

import { StatusBadge } from "@/components/encounters/status-badge";
import { VitalsDisplay } from "@/components/encounters/vitals-display";
import { VitalsInputForm } from "@/components/nurse/vitals-input-form";
import { ApiError } from "@/lib/api/client";
import {
  fetchEncounterVitals,
  fetchVitalsWorklist,
  type VitalSigns,
  type VitalsWorklistItem,
} from "@/lib/encounters/vitals";

// 활력 워크리스트 화면(Story 5.6 AC3, 간호사 전용). 오늘 활성 내원 목록(좌) → 선택 시 기존 활력 + 입력
// 폼(우). 간호사는 encounter.read 0 → 이 워크리스트(vital.record 게이트)가 작업 대상 진입점(5.7 확장 토대).
// 데이터 로드 = useState/useEffect 단일 로드(진료 허브 패널 선례, TanStack Query 미사용).

function recordedTimeKST(iso: string | null): string {
  if (!iso) return "미측정";
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  });
}

export function VitalsWorklistPage() {
  const [worklist, setWorklist] = useState<VitalsWorklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [vitals, setVitals] = useState<VitalSigns[] | null>(null);

  const loadWorklist = useCallback(async () => {
    try {
      const rows = await fetchVitalsWorklist();
      setWorklist(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "워크리스트를 불러오지 못했습니다.");
    }
  }, []);

  const loadVitals = useCallback(async (encounterId: string) => {
    try {
      const rows = await fetchEncounterVitals(encounterId);
      setVitals(rows);
    } catch {
      setVitals([]); // 활력 조회 실패는 비치명(입력은 가능) — 빈 목록으로 강등
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadWorklist();
  }, [loadWorklist]);

  const select = useCallback(
    (encounterId: string) => {
      setSelectedId(encounterId);
      setVitals(null);
      void loadVitals(encounterId);
    },
    [loadVitals],
  );

  // 기록 성공 → 선택 내원 활력 + 워크리스트(latest 시각) 동시 갱신.
  const onRecorded = useCallback(() => {
    if (selectedId) void loadVitals(selectedId);
    void loadWorklist();
  }, [selectedId, loadVitals, loadWorklist]);

  const selected = worklist?.find((w) => w.encounter_id === selectedId) ?? null;

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
      {/* 좌: 오늘 활성 내원 목록 */}
      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border px-4 py-2.5">
          <h2 className="text-[13px] font-semibold text-foreground">오늘 활성 내원</h2>
          <p className="text-[11px] text-muted-foreground">활력을 기록할 환자를 선택하세요</p>
        </header>
        {worklist === null ? (
          <ListSkeleton />
        ) : worklist.length === 0 ? (
          <p className="px-4 py-6 text-[12.5px] text-muted-foreground">
            오늘 접수·진행 중인 내원이 없습니다.
          </p>
        ) : (
          <ul>
            {worklist.map((w) => {
              const active = w.encounter_id === selectedId;
              return (
                <li key={w.encounter_id}>
                  <button
                    type="button"
                    onClick={() => select(w.encounter_id)}
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
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {w.department_name} · 최근 활력 {recordedTimeKST(w.latest_vital_recorded_at)}
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

      {/* 우: 선택 내원의 기존 활력 + 입력 폼 */}
      <section className="rounded-xl border border-border bg-card">
        {selected === null ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
            좌측에서 환자를 선택하면 활력징후를 입력할 수 있습니다.
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

            <div className="rounded-lg border border-border/60 bg-background p-3">
              <h3 className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                최근 활력
              </h3>
              {vitals === null ? <ListSkeleton rows={2} /> : <VitalsDisplay vitals={vitals} />}
            </div>

            <VitalsInputForm encounterId={selected.encounter_id} onRecorded={onRecorded} />
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
