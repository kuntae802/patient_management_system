"use client";

import { AlertTriangle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { PayChip, TrackingLine } from "@/components/encounters/order-item-meta";
import { MasterSearchPicker } from "@/components/ui/master-search-picker";
import type { MasterPickerItem } from "@/lib/admin/masters";
import { ApiError } from "@/lib/api/client";
import {
  type EncounterDiagnosis,
  fetchEncounterDiagnoses,
} from "@/lib/encounters/diagnoses";
import { allergyMatch } from "@/lib/encounters/order-safety";
import {
  createPrescription,
  issuedIngredientCodes,
  type Prescription,
  type PrescriptionDetail,
} from "@/lib/encounters/prescriptions";
import type { Encounter } from "@/lib/reception/encounters";
import type { Patient } from "@/lib/reception/patients";

// 처방 패널(Story 5.2·5.5, FR-050·051·052 + UX-DR21② 알레르기 / UX-DR13 처방 탭) — order-panel(5.5) 의
// controlled 자식. prescriptions 데이터·reload 는 order-panel 소유(리프트). 본 패널은 피커 드래프트 + 발행 +
// 목록 렌더. ⚠️ 알레르기↔오더 교차검증(UX-DR21②): 기록 알레르기와 약품명 매칭 시 danger 경고 + 사유 입력
// (서버가 권위·409 차단·감사). 동일 성분 중복(FR-052)은 별도 비차단 amber 경고. diagnoses 는 자체 로드(독립).

const PICKER_ID = "prescription-drug-picker";

type DraftLine = {
  key: number;
  drug: MasterPickerItem;
  dose: string;
  frequency: string;
  duration_days: string;
  usage_instruction: string;
  allergy_override_reason: string; // 알레르기 매칭 시 발행 사유(UX-DR21②)
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
  patient,
  prescriptions,
  onReload,
}: {
  encounter: Encounter;
  today: string;
  patient: Patient | null; // 알레르기 교차검증용(UX-DR21②)
  prescriptions: Prescription[] | null; // null=로딩(order-panel 소유)
  onReload: () => Promise<void> | void;
}) {
  const encounterId = encounter.id;
  const [diagnoses, setDiagnoses] = useState<EncounterDiagnosis[]>([]);
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [basisEdId, setBasisEdId] = useState<string>(""); // "" = 근거 진단 없음
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(0);

  // 근거 진단(FR-051)은 패널 자체 로드(독립·order-panel 미소유). 실패는 무시(셀렉터 미노출).
  const loadDiagnoses = useCallback(async () => {
    const dx = await fetchEncounterDiagnoses(encounterId).catch(
      () => [] as EncounterDiagnosis[],
    );
    setDiagnoses(dx);
  }, [encounterId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState 는 await 이후(비동기)
    void loadDiagnoses();
  }, [loadDiagnoses]);

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
        allergy_override_reason: "",
      },
    ]);
  }

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setDraft((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
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

  // 알레르기 매칭(UX-DR21②) — 기록 알레르기 토큰이 약품명에 부분포함되면 매칭 토큰(서버 거울). null=무관.
  function conflictToken(l: DraftLine): string | null {
    return allergyMatch(patient?.allergies, l.drug.name);
  }

  // 발행 차단(클라 1차선): 알레르기 매칭 라인에 사유 미입력이 하나라도 있으면 차단(서버가 최종 409).
  const hasUnresolvedConflict = draft.some(
    (l) => conflictToken(l) !== null && !l.allergy_override_reason.trim(),
  );

  async function issue() {
    if (busy || draft.length === 0 || hasUnresolvedConflict) return; // 이중 제출·빈·미해결 알레르기 방지
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
          allergy_override_reason: conflictToken(l)
            ? l.allergy_override_reason || null
            : null,
        })),
      });
      setDraft([]);
      setBasisEdId("");
      await onReload();
      toast.success("처방전을 발행했습니다.");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "처방 발행에 실패했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  const issued = prescriptions ?? [];
  const inputCls =
    "h-7 w-full rounded border border-border bg-card px-1.5 text-[12px] text-foreground outline-none focus:border-ring";

  return (
    <div className="space-y-3">
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

      {/* 드래프트 라인 — 라인별 용량·횟수·일수·용법 + 중복 경고 + 알레르기 교차검증. */}
      {draft.length > 0 && (
        <ul className="space-y-2">
          {draft.map((l, i) => {
            const dup = isDuplicate(i);
            const allergen = conflictToken(l);
            return (
              <li
                key={l.key}
                className="rounded-md border border-border bg-muted/30 px-2.5 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums text-[12.5px] text-foreground">
                    {l.drug.code}
                  </span>
                  <span className="truncate text-[12.5px] text-foreground">
                    {l.drug.name}
                  </span>
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

                {/* 알레르기 교차검증(UX-DR21②) — danger can't-miss + 사유 필수(서버 강제·감사). */}
                {allergen && (
                  <div
                    role="alert"
                    aria-live="assertive"
                    className="mt-1.5 rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5"
                  >
                    <p className="flex items-center gap-1 text-[11.5px] font-semibold text-destructive">
                      <AlertTriangle
                        className="size-3.5 shrink-0"
                        aria-hidden
                      />
                      환자 알레르기 약품 — “{allergen}”. 발행하려면 사유 입력
                    </p>
                    <input
                      type="text"
                      value={l.allergy_override_reason}
                      onChange={(e) =>
                        updateLine(l.key, {
                          allergy_override_reason: e.target.value,
                        })
                      }
                      disabled={busy}
                      aria-label="알레르기 오버라이드 사유"
                      placeholder="오버라이드 사유(감사 기록)"
                      className={inputCls + " mt-1 border-destructive/40"}
                    />
                  </div>
                )}

                {/* 동일 성분 중복 경고(FR-052) — 비차단·amber·확인만(알레르기와 시각 구분). */}
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
                    onChange={(e) =>
                      updateLine(l.key, { dose: e.target.value })
                    }
                    disabled={busy}
                    aria-label="용량"
                    placeholder="용량"
                    className={inputCls}
                  />
                  <input
                    type="text"
                    value={l.frequency}
                    onChange={(e) =>
                      updateLine(l.key, { frequency: e.target.value })
                    }
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
                    onChange={(e) =>
                      updateLine(l.key, { duration_days: e.target.value })
                    }
                    disabled={busy}
                    aria-label="일수"
                    placeholder="일수"
                    className={inputCls}
                  />
                  <input
                    type="text"
                    value={l.usage_instruction}
                    onChange={(e) =>
                      updateLine(l.key, { usage_instruction: e.target.value })
                    }
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

      {/* 발행 액션 — 빈 드래프트·발행 중·미해결 알레르기 disable(이중 제출·안전 1차선). */}
      <button
        type="button"
        onClick={() => void issue()}
        disabled={busy || draft.length === 0 || hasUnresolvedConflict}
        className="w-full rounded-md bg-primary px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
      >
        {busy
          ? "발행 중…"
          : hasUnresolvedConflict
            ? "알레르기 사유 입력 필요"
            : "처방 발행"}
      </button>

      {/* 발행된 처방전 목록(최신순). */}
      <div className="border-t border-border pt-3">
        {prescriptions === null ? (
          <div
            className="h-8 animate-pulse rounded-md bg-muted"
            aria-label="처방 불러오는 중"
          />
        ) : issued.length === 0 ? (
          <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span aria-hidden>○</span>발행된 처방 없음
          </p>
        ) : (
          <ul className="space-y-2">
            {issued.map((p) => (
              <li
                key={p.id}
                className="rounded-md border border-border bg-card px-2.5 py-2"
              >
                <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                  <span className="rounded border border-status-done/40 bg-status-done/12 px-1.5 py-0.5 font-medium text-status-done-ink">
                    발행
                  </span>
                  <span className="tabular-nums">
                    {timeHmKST(p.ordered_at)}
                  </span>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {p.details.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center gap-1.5 text-[12.5px] text-foreground"
                    >
                      <span className="font-medium">{d.drug_name}</span>
                      {detailSummary(d) && (
                        <span className="text-[11.5px] text-muted-foreground">
                          {detailSummary(d)}
                        </span>
                      )}
                      <PayChip coverageType={d.coverage_type} />
                    </li>
                  ))}
                </ul>
                <TrackingLine
                  ordererName={p.ordered_by_name}
                  performerFallback="약국 대기"
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
