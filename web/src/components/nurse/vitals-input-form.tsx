"use client";

import { useState } from "react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api/client";
import {
  createVitalSigns,
  hasAnyVital,
  isAbnormal,
  VITAL_FIELDS,
  VITAL_LABELS,
  type VitalField,
  type VitalSignsCreateBody,
} from "@/lib/encounters/vitals";

// 활력징후 입력 폼(Story 5.6 AC1, 간호사 전용). 6 항목 number 입력(전부 선택) + 메모. 빈 값 제출은
// hasAnyVital 가드(클라 1차선) + 서버 422(권위). 비정상 수치는 입력 즉시 danger 강조. busy disable로
// 이중 제출(중복 기록) 방지. 성공 → 폼 리셋 + onRecorded(부모 워크리스트 갱신).

const EMPTY: Record<VitalField, string> = {
  systolic: "",
  diastolic: "",
  pulse: "",
  body_temp: "",
  respiratory_rate: "",
  spo2: "",
};

/** 빈 문자열 → undefined, 그 외 → number(빈/NaN 은 미측정). body_temp 만 소수 허용. */
function parseField(field: VitalField, raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = field === "body_temp" ? Number.parseFloat(trimmed) : Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function VitalsInputForm({
  encounterId,
  onRecorded,
}: {
  encounterId: string;
  onRecorded: () => void;
}) {
  const [values, setValues] = useState<Record<VitalField, string>>(EMPTY);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const body: VitalSignsCreateBody = {};
  for (const f of VITAL_FIELDS) body[f] = parseField(f, values[f]);
  const canSubmit = !busy && hasAnyVital(body);

  async function submit() {
    if (!canSubmit) return; // 빈 활력 가드(서버 422 권위)
    setBusy(true);
    try {
      const trimmedNotes = notes.trim();
      await createVitalSigns(encounterId, {
        ...body,
        notes: trimmedNotes === "" ? null : trimmedNotes,
      });
      setValues(EMPTY);
      setNotes("");
      toast.success("활력징후를 기록했습니다.");
      onRecorded();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "활력징후 기록에 실패했습니다.");
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
      className="space-y-3"
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {VITAL_FIELDS.map((f) => {
          const { label, unit } = VITAL_LABELS[f];
          const parsed = parseField(f, values[f]);
          const abnormal = parsed !== undefined && isAbnormal(f, parsed);
          return (
            <label key={f} className="block">
              <span className="text-[11.5px] font-medium text-foreground">
                {label}
                <span className="ml-1 text-[10.5px] font-normal text-muted-foreground">{unit}</span>
              </span>
              <input
                type="number"
                inputMode={f === "body_temp" ? "decimal" : "numeric"}
                step={f === "body_temp" ? "0.1" : "1"}
                value={values[f]}
                onChange={(e) => setValues((prev) => ({ ...prev, [f]: e.target.value }))}
                disabled={busy}
                aria-label={`${label} (${unit})`}
                aria-invalid={abnormal}
                className={
                  "mt-1 h-8 w-full rounded-md border bg-card px-2 text-[13px] tabular-nums outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-60 " +
                  (abnormal ? "border-destructive/60 text-destructive" : "border-border")
                }
              />
            </label>
          );
        })}
      </div>

      <label className="block">
        <span className="text-[11.5px] font-medium text-foreground">메모(선택)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={busy}
          rows={2}
          maxLength={500}
          aria-label="활력징후 메모"
          placeholder="임상 메모(주민번호 등 민감정보 금지)"
          className="mt-1 w-full resize-none rounded-md border border-border bg-card px-2 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-60"
        />
      </label>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">측정한 항목만 입력(최소 1개)</p>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "기록 중…" : "활력징후 기록"}
        </button>
      </div>
    </form>
  );
}
