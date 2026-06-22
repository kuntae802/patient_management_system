"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/encounters/status-badge";
import { ApiError } from "@/lib/api/client";
import {
  createNursingRecord,
  fetchEncounterNursingRecords,
  fetchNursingWorklist,
  type NursingRecord,
  type NursingWorklistItem,
} from "@/lib/encounters/treatment-orders";

// 일상 간호기록 화면(Story 5.7 AC3, FR-094). 오늘 활성 내원 전체(좌) → 선택 시 간호기록 작성 폼 + 기록
// 목록(우). 오더 연결 없이 기록(처치 수행 연결은 처치 워크리스트 소유). useState 단일 로드.

function recordedTimeKST(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

export function NursingNotesPage() {
  const [worklist, setWorklist] = useState<NursingWorklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [records, setRecords] = useState<NursingRecord[] | null>(null);

  const loadWorklist = useCallback(async () => {
    try {
      const rows = await fetchNursingWorklist();
      setWorklist(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "워크리스트를 불러오지 못했습니다.");
    }
  }, []);

  const loadRecords = useCallback(async (encounterId: string) => {
    try {
      const rows = await fetchEncounterNursingRecords(encounterId);
      setRecords(rows);
    } catch {
      setRecords([]); // 조회 실패는 비치명(작성은 가능) — 빈 목록 강등
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadWorklist();
  }, [loadWorklist]);

  const select = useCallback(
    (encounterId: string) => {
      setSelectedId(encounterId);
      setRecords(null);
      void loadRecords(encounterId);
    },
    [loadRecords],
  );

  // 기록 성공 → 선택 내원 기록 목록 + 워크리스트(건수) 동시 갱신.
  const onRecorded = useCallback(() => {
    if (selectedId) void loadRecords(selectedId);
    void loadWorklist();
  }, [selectedId, loadRecords, loadWorklist]);

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
      {/* 좌: 오늘 활성 내원 전체 */}
      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border px-4 py-2.5">
          <h2 className="text-[13px] font-semibold text-foreground">오늘 활성 내원</h2>
          <p className="text-[11px] text-muted-foreground">간호기록을 남길 환자를 선택하세요</p>
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
                        {w.department_name} · 간호기록 {w.nursing_record_count}건
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

      {/* 우: 선택 내원의 기록 작성 + 목록 */}
      <section className="rounded-xl border border-border bg-card">
        {selected === null ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
            좌측에서 환자를 선택하면 간호기록을 남길 수 있습니다.
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

            <NursingNoteForm encounterId={selected.encounter_id} onRecorded={onRecorded} />

            <div className="rounded-lg border border-border/60 bg-background p-3">
              <h3 className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                간호기록
              </h3>
              {records === null ? (
                <ListSkeleton rows={2} />
              ) : (
                <NursingRecordList records={records} />
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/** 일상 간호기록 작성 폼 — content 필수(빈/공백 가드 1차선·서버 422 권위)·busy disable·toast. */
function NursingNoteForm({
  encounterId,
  onRecorded,
}: {
  encounterId: string;
  onRecorded: () => void;
}) {
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const canSubmit = !busy && content.trim() !== "";

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await createNursingRecord(encounterId, { content: content.trim() });
      setContent("");
      toast.success("간호기록을 남겼습니다.");
      onRecorded();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "간호기록 작성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-2"
    >
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        disabled={busy}
        rows={3}
        maxLength={2000}
        aria-label="간호기록 내용"
        placeholder="간호기록 내용(주민번호 등 민감정보 금지)"
        className="w-full resize-none rounded-md border border-border bg-card px-2 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-60"
      />
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">오더 연결 없이 기록됩니다</p>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "기록 중…" : "간호기록 저장"}
        </button>
      </div>
    </form>
  );
}

/** 간호기록 목록(읽기 전용·최신순). 처치 수행 연결 기록은 "처치" 태그. */
function NursingRecordList({ records }: { records: NursingRecord[] }) {
  if (records.length === 0) {
    return <p className="text-[12px] text-muted-foreground">작성된 간호기록이 없습니다.</p>;
  }
  return (
    <ul className="space-y-2">
      {records.map((r) => (
        <li key={r.id} className="rounded border border-border/60 bg-card p-2.5">
          <p className="whitespace-pre-wrap text-[12.5px] text-foreground">{r.content}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <span>{r.recorded_by_name ?? "—"}</span>
            <span>· {recordedTimeKST(r.recorded_at)}</span>
            {r.treatment_order_id ? (
              <span className="rounded border border-border bg-muted px-1 py-0.5 font-medium">
                처치
              </span>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
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
