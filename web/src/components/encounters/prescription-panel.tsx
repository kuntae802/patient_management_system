"use client";

import { AlertTriangle, Pill, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { MasterSearchPicker } from "@/components/ui/master-search-picker";
import type { MasterPickerItem } from "@/lib/admin/masters";
import { ApiError } from "@/lib/api/client";
import {
  type EncounterDiagnosis,
  fetchEncounterDiagnoses,
} from "@/lib/encounters/diagnoses";
import {
  createPrescription,
  fetchPrescriptions,
  issuedIngredientCodes,
  type Prescription,
  type PrescriptionDetail,
} from "@/lib/encounters/prescriptions";
import type { Encounter } from "@/lib/reception/encounters";

// 처방 패널(Story 5.2, FR-050·051·052 / UX-DR13) — 진료 허브 우 오더 pane(처방만; 검사/영상/처치 탭은
// 5.3/5.4, 전체 패널 통합은 5.5). 약품 마스터 검색 피커(free-text 차단)로 드래프트 라인을 쌓고, 라인별
// 용량·횟수·일수·용법을 입력해 한 번에 발행한다. 동일 성분(ingredient_code) 중복은 인라인 비차단 경고.
// 패턴: diagnosis-block(useState/useEffect/useCallback + apiFetch·busy 직렬화), TanStack/Zustand 미사용.

const PICKER_ID = "prescription-drug-picker";

type DraftLine = {
  key: number;
  drug: MasterPickerItem;
  dose: string;
  frequency: string;
  duration_days: string;
  usage_instruction: string;
};

function timeHmKST(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

/** 상세 라인 표시 텍스트 — 용량·횟수·일수·용법(채워진 것만 · 으로 결합). */
function detailSummary(d: PrescriptionDetail): string {
  const parts = [
    d.dose != null ? `${d.dose}` : null,
    d.frequency,
    d.duration_days != null ? `${d.duration_days}일` : null,
    d.usage_instruction,
  ].filter(Boolean);
  return parts.join(" · ");
}

export function PrescriptionPanel({
  encounter,
  today,
}: {
  encounter: Encounter;
  today: string;
}) {
  const encounterId = encounter.id;
  const [prescriptions, setPrescriptions] = useState<Prescription[] | null>(null);
  const [diagnoses, setDiagnoses] = useState<EncounterDiagnosis[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [basisEdId, setBasisEdId] = useState<string>(""); // "" = 근거 진단 없음
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(0);

  const reload = useCallback(async () => {
    const [rx, dx] = await Promise.all([
      fetchPrescriptions(encounterId),
      fetchEncounterDiagnoses(encounterId).catch(() => [] as EncounterDiagnosis[]),
    ]);
    setPrescriptions(rx);
    setDiagnoses(dx);
  }, [encounterId]);

  const load = useCallback(async () => {
    try {
      await reload();
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "처방을 불러오지 못했습니다.");
    }
  }, [reload]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load 의 setState 는 await 이후
    void load();
  }, [load]);

  // 이미 처방된 성분(발행 처방 활성 상세) — 중복 경고 기준(FR-052).
  const issuedCodes = issuedIngredientCodes(prescriptions ?? []);

  function addDrug(item: MasterPickerItem | null) {
    if (!item || busy) return;
    setDraft((prev) => [
      ...prev,
      {
        key: keyRef.current++,
        drug: item,
        dose: "",
        frequency: "",
        duration_days: "",
        usage_instruction: "",
      },
    ]);
  }

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setDraft((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: number) {
    setDraft((prev) => prev.filter((l) => l.key !== key));
  }

  // 라인 index 의 중복 여부(FR-052): 비-null 성분이 기존 발행 처방 또는 앞선 드래프트 라인에 이미 존재.
  function isDuplicate(index: number): boolean {
    const code = draft[index].drug.ingredient_code;
    if (!code) return false; // 성분 미상 → 동일성 판정 불가
    if (issuedCodes.has(code)) return true;
    return draft.slice(0, index).some((l) => l.drug.ingredient_code === code);
  }

  async function issue() {
    if (busy || draft.length === 0) return; // 이중 제출·빈 드래프트 방지
    setBusy(true);
    try {
      await createPrescription(encounterId, {
        encounter_diagnosis_id: basisEdId || null,
        details: draft.map((l) => ({
          drug_id: l.drug.id,
          dose: l.dose ? Number(l.dose) : null,
          frequency: l.frequency || null,
          duration_days: l.duration_days ? Number(l.duration_days) : null,
          usage_instruction: l.usage_instruction || null,
        })),
      });
      setDraft([]);
      setBasisEdId("");
      await reload();
      toast.success("처방전을 발행했습니다.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "처방 발행에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError && prescriptions === null) {
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

  const issued = prescriptions ?? [];
  const inputCls =
    "h-7 w-full rounded border border-border bg-card px-1.5 text-[12px] text-foreground outline-none focus:border-ring";

  return (
    <section aria-label="오더 · 처방" className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center gap-2 px-4 pb-2.5 pt-3.5">
        <Pill className="size-4 text-primary" aria-hidden />
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">처방</h2>
        {issued.length > 0 && (
          <span className="text-[11.5px] text-muted-foreground tabular-nums">
            · {issued.length}건
          </span>
        )}
      </header>

      <div className="space-y-3 px-4 pb-4">
        {/* 약품 마스터 검색(free-text 차단). 선택=드래프트 라인 추가(어더). */}
        <MasterSearchPicker
          kind="drug"
          today={today}
          id={PICKER_ID}
          ariaLabel="약품 검색"
          placeholder="약품 코드·명칭 검색"
          value={null}
          onValueChange={addDrug}
          disabled={busy}
        />

        {/* 근거 진단 셀렉터(FR-051) — 부착 진단이 있을 때만. 미선택 허용. */}
        {diagnoses.length > 0 && (
          <label className="block text-[12px] text-muted-foreground">
            <span className="mb-1 block">근거 진단(선택)</span>
            <select
              value={basisEdId}
              onChange={(e) => setBasisEdId(e.target.value)}
              disabled={busy}
              className={inputCls + " h-8"}
            >
              <option value="">— 없음 —</option>
              {diagnoses.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.diagnosis_code} {d.diagnosis_name}
                  {d.is_primary ? " (주)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* 드래프트 라인 — 라인별 용량·횟수·일수·용법 입력 + 중복 경고. */}
        {draft.length > 0 && (
          <ul className="space-y-2">
            {draft.map((l, i) => {
              const dup = isDuplicate(i);
              return (
                <li
                  key={l.key}
                  className="rounded-md border border-border bg-muted/30 px-2.5 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold tabular-nums text-[12.5px] text-foreground">
                      {l.drug.code}
                    </span>
                    <span className="truncate text-[12.5px] text-foreground">{l.drug.name}</span>
                    <button
                      type="button"
                      onClick={() => removeLine(l.key)}
                      disabled={busy}
                      aria-label={`${l.drug.name} 제거`}
                      className="ml-auto inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </div>

                  {/* 동일 성분 중복 경고(FR-052) — 비차단·색+글리프+라벨·aria-live(UX-DR20·DR18). */}
                  {dup && (
                    <p
                      role="alert"
                      className="mt-1 flex items-center gap-1 text-[11.5px] font-medium text-status-received-ink"
                    >
                      <AlertTriangle className="size-3 shrink-0" aria-hidden />
                      동일 성분 중복 — 확인 후 발행
                    </p>
                  )}

                  <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      value={l.dose}
                      onChange={(e) => updateLine(l.key, { dose: e.target.value })}
                      disabled={busy}
                      aria-label="용량"
                      placeholder="용량"
                      className={inputCls}
                    />
                    <input
                      type="text"
                      value={l.frequency}
                      onChange={(e) => updateLine(l.key, { frequency: e.target.value })}
                      disabled={busy}
                      aria-label="횟수"
                      placeholder="횟수(예 TID)"
                      className={inputCls}
                    />
                    <input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={l.duration_days}
                      onChange={(e) => updateLine(l.key, { duration_days: e.target.value })}
                      disabled={busy}
                      aria-label="일수"
                      placeholder="일수"
                      className={inputCls}
                    />
                    <input
                      type="text"
                      value={l.usage_instruction}
                      onChange={(e) => updateLine(l.key, { usage_instruction: e.target.value })}
                      disabled={busy}
                      aria-label="용법"
                      placeholder="용법(예 식후 30분)"
                      className={inputCls}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* 발행 액션 — 빈 드래프트·발행 중 disable(이중 제출 1차선). */}
        <button
          type="button"
          onClick={() => void issue()}
          disabled={busy || draft.length === 0}
          className="w-full rounded-md bg-primary px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {busy ? "발행 중…" : "처방 발행"}
        </button>

        {/* 발행된 처방전 목록(최신순). */}
        <div className="border-t border-border pt-3">
          {prescriptions === null ? (
            <div className="h-8 animate-pulse rounded-md bg-muted" aria-label="처방 불러오는 중" />
          ) : issued.length === 0 ? (
            <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span aria-hidden>○</span>발행된 처방 없음
            </p>
          ) : (
            <ul className="space-y-2">
              {issued.map((p) => (
                <li key={p.id} className="rounded-md border border-border bg-card px-2.5 py-2">
                  <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                    <span className="rounded border border-status-done/40 bg-status-done/12 px-1.5 py-0.5 font-medium text-status-done-ink">
                      발행
                    </span>
                    <span className="tabular-nums">{timeHmKST(p.ordered_at)}</span>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {p.details.map((d) => (
                      <li key={d.id} className="text-[12.5px] text-foreground">
                        <span className="font-medium">{d.drug_name}</span>
                        {detailSummary(d) && (
                          <span className="ml-1.5 text-[11.5px] text-muted-foreground">
                            {detailSummary(d)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
