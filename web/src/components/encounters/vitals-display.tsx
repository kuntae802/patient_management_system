import {
  isAbnormal,
  VITAL_LABELS,
  type VitalField,
  type VitalSigns,
} from "@/lib/encounters/vitals";

// 진료 허브 좌 컨텍스트 패널 "활력징후" 표시(Story 5.6 AC2 / FR-032, 읽기전용). 최신 측정 1건을
// 6 항목 그리드로 + 측정시각·측정자. 정상범위 밖 수치 = danger 강조(표시 전용·능동 경고 아님).
// 입력은 간호사 전용(/nurse/vitals) — 여기선 의사가 진료 전 활력 컨텍스트만 본다.

function recordedAtKST(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  });
}

/** 혈압은 수축기/이완기 합쳐 한 칸(s/d), 나머지는 개별. 표시 순서. */
const SINGLE_FIELDS: VitalField[] = ["pulse", "body_temp", "respiratory_rate", "spo2"];

export function VitalsDisplay({ vitals }: { vitals: VitalSigns[] }) {
  if (vitals.length === 0) {
    return <p className="text-[12px] text-muted-foreground">측정된 활력징후가 없습니다.</p>;
  }

  const latest = vitals[0]; // 목록은 최신순(recorded_at desc)
  const bpAbnormal = isAbnormal("systolic", latest.systolic) || isAbnormal("diastolic", latest.diastolic);
  const hasBp = latest.systolic !== null || latest.diastolic !== null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{latest.recorded_by_name ?? "측정자 미상"}</span>
        <time dateTime={latest.recorded_at} className="tabular-nums">
          {recordedAtKST(latest.recorded_at)}
        </time>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px]">
        {hasBp && (
          <VitalCell
            label="혈압"
            unit="mmHg"
            value={
              latest.systolic !== null || latest.diastolic !== null
                ? `${latest.systolic ?? "—"}/${latest.diastolic ?? "—"}`
                : null
            }
            abnormal={bpAbnormal}
          />
        )}
        {SINGLE_FIELDS.map((f) => {
          const value = latest[f];
          if (value === null) return null;
          const { label, unit } = VITAL_LABELS[f];
          return (
            <VitalCell
              key={f}
              label={shortLabel(f, label)}
              unit={unit}
              value={String(value)}
              abnormal={isAbnormal(f, value)}
            />
          );
        })}
      </dl>

      {latest.notes && (
        <p className="whitespace-pre-wrap break-words text-[11.5px] text-muted-foreground">
          {latest.notes}
        </p>
      )}

      {vitals.length > 1 && (
        <p className="text-[11px] text-muted-foreground/80">최근 {vitals.length}회 측정 중 최신</p>
      )}
    </div>
  );
}

// 패널 폭이 좁아 라벨을 짧게(SpO₂·체온·맥박·호흡).
function shortLabel(field: VitalField, fallback: string): string {
  switch (field) {
    case "respiratory_rate":
      return "호흡";
    case "spo2":
      return "SpO₂";
    default:
      return fallback;
  }
}

function VitalCell({
  label,
  unit,
  value,
  abnormal,
}: {
  label: string;
  unit: string;
  value: string | null;
  abnormal: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd
        className={
          abnormal
            ? "font-semibold text-destructive tabular-nums"
            : "font-medium text-foreground tabular-nums"
        }
      >
        {value ?? "—"}
        <span className="ml-1 text-[10.5px] font-normal text-muted-foreground">{unit}</span>
        {abnormal && <span className="sr-only"> (정상범위 밖)</span>}
      </dd>
    </div>
  );
}
