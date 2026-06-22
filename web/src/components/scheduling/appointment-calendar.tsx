"use client";

import { CalendarDays } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";
import {
  CALENDAR_STATUS_META,
  fetchDayCalendar,
  type CalendarResponse,
  type CalendarSlot,
  type CalendarSlotStatus,
} from "@/lib/scheduling/appointments";
import { formatSlotTime, todayKstISO } from "@/lib/scheduling/slots";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { BookingPeek } from "./booking-peek";

const FIELD =
  "h-9 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";
const LABEL = "block text-[12px] font-medium text-foreground";

type DeptOption = { id: string; name: string };
type PeekTarget = { doctorId: string; doctorName: string; start: string };

const LEGEND_ORDER: CalendarSlotStatus[] = [
  "available",
  "confirmed",
  "completed",
  "no_show",
  "cancelled",
  "time_off",
  "past",
];

// 예약 캘린더(Story 6.3, UX-DR15) — 시간레일 × 의사 열·일(Day) 보기·30분. 빈(available) 슬롯 클릭 →
// booking-peek. 슬롯 상태는 채움+테두리+패턴(음영 비의존). 근무 블록 사이 gap(점심 등)은 band 로 표시.
// 진료과(Supabase 직접조회) → 날짜(KST) → fetchDayCalendar. 예약 저장 후 캘린더 재조회.
export function AppointmentCalendar() {
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [deptId, setDeptId] = useState("");
  const [date, setDate] = useState(todayKstISO());
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [peek, setPeek] = useState<PeekTarget | null>(null);

  // 진료과(활성만) — Supabase 직접조회.
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("departments")
      .select("id, name")
      .eq("is_active", true)
      .order("code")
      .then(({ data, error: deptErr }) => {
        if (deptErr) setError("진료과 목록을 불러오지 못했습니다.");
        else setDepartments((data ?? []) as DeptOption[]);
      });
  }, []);

  const loadCalendar = useCallback(async () => {
    if (!deptId || !date) {
      setCalendar(null);
      return;
    }
    try {
      const res = await fetchDayCalendar(deptId, date);
      setCalendar(res);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "캘린더를 불러오지 못했습니다.");
      setCalendar(null);
    }
  }, [deptId, date]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCalendar();
  }, [loadCalendar]);

  const deptName = departments.find((d) => d.id === deptId)?.name ?? "";

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-2">
        <CalendarDays className="size-5 text-primary" aria-hidden />
        <div>
          <h1 className="text-[17px] font-semibold text-foreground">예약 관리</h1>
          <p className="text-[12.5px] text-muted-foreground">
            진료과·날짜를 선택하고 빈 슬롯을 클릭해 예약하세요.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className={LABEL}>진료과</span>
          <select
            className={cn(FIELD, "w-48")}
            value={deptId}
            onChange={(e) => setDeptId(e.target.value)}
          >
            <option value="">진료과 선택</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={LABEL}>날짜</span>
          <input
            type="date"
            className={cn(FIELD, "w-44")}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="text-[13px] text-status-cancelled">
          {error}
        </p>
      )}

      <CalendarLegend />

      {!deptId ? (
        <p className="text-[13px] text-muted-foreground">진료과를 선택하면 캘린더가 표시됩니다.</p>
      ) : calendar ? (
        <CalendarGrid
          calendar={calendar}
          onPickSlot={(doctorId, doctorName, start) =>
            setPeek({ doctorId, doctorName, start })
          }
        />
      ) : !error ? (
        <p className="text-[13px] text-muted-foreground" aria-live="polite">
          캘린더를 불러오는 중…
        </p>
      ) : null}

      {peek && (
        <BookingPeek
          key={`${peek.doctorId}|${peek.start}`}
          open
          onOpenChange={(o) => {
            if (!o) setPeek(null);
          }}
          departmentId={deptId}
          departmentName={deptName}
          doctorId={peek.doctorId}
          doctorName={peek.doctorName}
          scheduledStart={peek.start}
          onCreated={() => {
            setPeek(null);
            void loadCalendar();
          }}
        />
      )}
    </div>
  );
}

function CalendarLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {LEGEND_ORDER.map((status) => {
        const meta = CALENDAR_STATUS_META[status];
        return (
          <li key={status} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn("inline-block size-3 rounded-sm border", meta.tileClass)}
            />
            {meta.label}
          </li>
        );
      })}
    </ul>
  );
}

function CalendarGrid({
  calendar,
  onPickSlot,
}: {
  calendar: CalendarResponse;
  onPickSlot: (doctorId: string, doctorName: string, start: string) => void;
}) {
  if (calendar.doctors.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-[13px] text-muted-foreground">
        이 진료과에 재직 의사가 없습니다.
      </p>
    );
  }

  // 공유 시간축 = 전 의사 슬롯 시작의 합집합(정렬). 의사별 시작→슬롯 맵으로 셀 정렬.
  const startSet = new Set<string>();
  for (const col of calendar.doctors) for (const s of col.slots) startSet.add(s.start);
  const timeAxis = [...startSet].sort();
  const slotByDoctorStart = new Map<string, CalendarSlot>();
  for (const col of calendar.doctors) {
    for (const s of col.slots) slotByDoctorStart.set(`${col.doctor_id}|${s.start}`, s);
  }

  if (timeAxis.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-[13px] text-muted-foreground">
        이 날짜에 근무 슬롯이 없습니다.
      </p>
    );
  }

  const gapMs = calendar.slot_minutes * 60_000;
  const gridCols = `5rem repeat(${calendar.doctors.length}, minmax(120px, 1fr))`;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max" role="grid" aria-label="예약 캘린더">
        {/* 헤더 = 의사 열 */}
        <div className="grid items-center gap-1" style={{ gridTemplateColumns: gridCols }}>
          <span />
          {calendar.doctors.map((col) => (
            <span
              key={col.doctor_id}
              className="px-1 py-1 text-center text-[12.5px] font-semibold text-foreground"
            >
              {col.doctor_name}
            </span>
          ))}
        </div>

        {timeAxis.map((start, i) => {
          // 직전 슬롯과의 간격이 slot_minutes 초과 → 점심/휴게 band.
          const prev = i > 0 ? timeAxis[i - 1] : null;
          const lunch =
            prev !== null &&
            new Date(start).getTime() - new Date(prev).getTime() > gapMs;
          return (
            <div key={start}>
              {lunch && (
                <div className="my-1 rounded-sm bg-muted px-2 py-1 text-center text-[11px] text-muted-foreground">
                  점심시간 · 예약 불가
                </div>
              )}
              <div
                className="grid items-stretch gap-1 py-0.5"
                style={{ gridTemplateColumns: gridCols }}
              >
                <span className="flex items-center justify-end pr-1 text-[11px] tabular-nums text-muted-foreground">
                  {formatSlotTime(start)}
                </span>
                {calendar.doctors.map((col) => {
                  const slot = slotByDoctorStart.get(`${col.doctor_id}|${start}`);
                  if (!slot) return <span key={col.doctor_id} className="rounded-md bg-muted/30" />;
                  return (
                    <SlotCell
                      key={col.doctor_id}
                      slot={slot}
                      onPick={() => onPickSlot(col.doctor_id, col.doctor_name, slot.start)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SlotCell({ slot, onPick }: { slot: CalendarSlot; onPick: () => void }) {
  const meta = CALENDAR_STATUS_META[slot.status];
  const className = cn(
    "flex min-h-9 flex-col justify-center gap-0.5 rounded-md border px-2 py-1 text-left",
    meta.tileClass,
  );
  const body = (
    <>
      <span className="flex items-center gap-1 text-[11px] font-medium">
        <span aria-hidden className="text-[9px] leading-none">
          {meta.glyph}
        </span>
        {slot.patient_name ?? meta.label}
      </span>
    </>
  );
  if (meta.selectable) {
    return (
      <button type="button" data-status={slot.status} className={className} onClick={onPick}>
        {body}
      </button>
    );
  }
  return (
    <div data-status={slot.status} className={className}>
      {body}
    </div>
  );
}
