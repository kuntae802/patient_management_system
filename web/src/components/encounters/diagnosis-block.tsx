"use client";

import { AlertCircle, Star, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { MasterSearchPicker } from "@/components/ui/master-search-picker";
import { ApiError } from "@/lib/api/client";
import {
  attachDiagnosis,
  type EncounterDiagnosis,
  fetchEncounterDiagnoses,
  removeDiagnosis,
  setDiagnosisPrimary,
} from "@/lib/encounters/diagnoses";
import type { MasterPickerItem } from "@/lib/admin/masters";
import type { Encounter } from "@/lib/reception/encounters";

// 진단 블록(Story 4.7, FR-042 / UX-DR12) — SOAP 위. KCD-8 검색 피커(free-text 차단)로 진단을 부착하고
// 주/부상병을 구분한다. 부착 진단 = 커스텀 칩(주상병=status-inprogress 잉크·토글·제거). 주상병 미지정
// 완료(422) 시 부모(consultation-workspace)가 primaryError 를 내려보내 인라인 메시지 + 피커 포커스를 띄운다.
// 마스터 피커는 단일 선택 "어더"(선택→부착→리셋) — 피커 기본 multiple-칩은 주/부상병 토글을 못 하기 때문.

const PICKER_ID = "diagnosis-picker";
const ERROR_ID = "diagnosis-primary-error";

export function DiagnosisBlock({
  encounter,
  today,
  primaryError,
  onPrimaryResolved,
}: {
  encounter: Encounter;
  today: string;
  primaryError: boolean;
  onPrimaryResolved: () => void;
}) {
  const encounterId = encounter.id;
  const [diagnoses, setDiagnoses] = useState<EncounterDiagnosis[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 목록 동기화 — 부착/토글/제거 후 재조회(주상병 강등·정렬 일관). 주상병이 생기면 422 인라인 해제.
  const reload = useCallback(async () => {
    const rows = await fetchEncounterDiagnoses(encounterId);
    setDiagnoses(rows);
    if (rows.some((d) => d.is_primary)) onPrimaryResolved();
  }, [encounterId, onPrimaryResolved]);

  const load = useCallback(async () => {
    try {
      await reload();
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "진단을 불러오지 못했습니다.");
    }
  }, [reload]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load 의 setState 는 await 이후(비동기)
    void load();
  }, [load]);

  // 주상병 미지정 완료(422) → 피커로 포커스 이동(UX-DR18).
  useEffect(() => {
    if (primaryError) document.getElementById(PICKER_ID)?.focus();
  }, [primaryError]);

  // 마스터 피커 "어더": 선택 → 부착(부상병 기본) → 목록 갱신. value 는 항상 null(선택 표시 안 함).
  function handleSelect(item: MasterPickerItem | null) {
    if (!item || busy) return;
    void runMutation(() => attachDiagnosis(encounterId, { diagnosis_id: item.id, is_primary: false }));
  }

  async function runMutation(op: () => Promise<unknown>) {
    setBusy(true);
    try {
      await op();
      await reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "진단 처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError && diagnoses === null) {
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

  const list = diagnoses ?? [];

  return (
    <section aria-label="진단 (KCD)" className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center gap-2 px-4 pb-2.5 pt-3.5">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">진단</h2>
        <span className="text-[11.5px] text-muted-foreground">KCD-8</span>
        {list.length > 0 && (
          <span className="text-[11.5px] text-muted-foreground tabular-nums">· {list.length}건</span>
        )}
      </header>

      <div className="px-4 pb-4">
        {/* KCD 검색 피커(free-text 차단, UX-DR12). 선택=즉시 부착(부상병 기본). */}
        <MasterSearchPicker
          kind="diagnosis"
          today={today}
          id={PICKER_ID}
          ariaLabel="KCD 진단 검색"
          placeholder="진단 코드·명칭 검색(KCD-8)"
          value={null}
          onValueChange={handleSelect}
          disabled={busy}
          ariaInvalid={primaryError}
          ariaDescribedby={primaryError ? ERROR_ID : undefined}
        />

        {/* 주상병 미지정 완료(422) 인라인 — role=alert(AT 낭독) + 색+글리프+라벨(UX-DR18·DR20). */}
        {primaryError && (
          <p
            id={ERROR_ID}
            role="alert"
            className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-status-cancelled"
          >
            <AlertCircle className="size-3.5 shrink-0" aria-hidden />
            주상병을 1개 지정해야 합니다
          </p>
        )}

        {/* 부착 진단 칩 — 주상병 우선 정렬(서버). 색+글리프+라벨(UX-DR20). */}
        {diagnoses === null ? (
          <div className="mt-3 h-8 animate-pulse rounded-md bg-muted" aria-label="진단 불러오는 중" />
        ) : list.length === 0 ? (
          <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span aria-hidden>○</span>부착된 진단 없음
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5">
            {list.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-[12.5px]"
              >
                <span className="font-semibold tabular-nums text-foreground">{d.diagnosis_code}</span>
                <span className="text-foreground">{d.diagnosis_name}</span>
                {/* 주/부상병 토글 버튼 — 색+글리프+라벨(UX-DR20). aria-pressed 로 상태 노출. */}
                <button
                  type="button"
                  onClick={() => void runMutation(() => setDiagnosisPrimary(encounterId, d.id, !d.is_primary))}
                  disabled={busy}
                  aria-pressed={d.is_primary}
                  aria-label={`${d.diagnosis_name} ${d.is_primary ? "주상병 해제" : "주상병으로 지정"}`}
                  className={`ml-auto inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium disabled:opacity-60 ${
                    d.is_primary
                      ? "border-status-inprogress/40 bg-status-inprogress/12 text-status-inprogress"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Star
                    className="size-3"
                    aria-hidden
                    fill={d.is_primary ? "currentColor" : "none"}
                  />
                  {d.is_primary ? "주상병" : "부상병"}
                </button>
                <button
                  type="button"
                  onClick={() => void runMutation(() => removeDiagnosis(encounterId, d.id))}
                  disabled={busy}
                  aria-label={`${d.diagnosis_name} 제거`}
                  className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
