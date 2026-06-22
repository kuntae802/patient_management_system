"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { formatKstDateTime } from "@/lib/admin/schedule";
import {
  cancelAppointment,
  recordChangeNotice,
  rescheduleAppointment,
  type AffectedAppointment,
} from "@/lib/scheduling/appointments";
import {
  fetchAvailableSlots,
  fetchBookableDoctors,
  formatSlotTime,
  type BookableDoctor,
  type Slot,
} from "@/lib/scheduling/slots";

// 휴진 영향 예약 재배정 패널 (Story 6.8 / AC2·AC3·AC4·UX-DR15 "휴진 등록 시 영향 예약 표시·재배정 prompt").
// 휴진 등록(또는 휴진 행 "영향 예약" 액션) 후 그 기간에 걸린 booked 예약을 나열하고, 각 예약을
// 재배정(같은 진료과 의사·슬롯 재선택 → reschedule + 안내) 또는 취소·안내(cancel + 안내)로 해소한다.
// booking-detail.tsx 재배정 모드 미러 + 의사 피커 추가. 안내 = 6.6 notification_logs 이음매(best-effort).
// ⚠️ 부모(schedule-manager)가 affected 를 미리 조회해 `initial` 로 주입 + 매 오픈 key remount(깨끗 시작).
type RowMode = "reschedule" | "cancel";

export function AffectedAppointmentsPanel({
  open,
  onOpenChange,
  doctorName,
  initial,
  onResolved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doctorName: string;
  initial: AffectedAppointment[];
  onResolved?: () => void;
}) {
  // 해소된 행은 목록에서 제거(부모는 key remount 로 initial 갱신). 한 번에 한 행만 액션 패널 오픈.
  const [items, setItems] = useState<AffectedAppointment[]>(initial);
  const [active, setActive] = useState<{ id: string; mode: RowMode } | null>(null);

  function resolveRow(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setActive(null);
    onResolved?.();
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/30" />
        <Dialog.Popup className="fixed right-0 top-0 z-50 flex h-full w-[min(460px,100vw)] flex-col overflow-auto border-l border-border bg-card p-5 outline-none">
          <Dialog.Title className="text-[15px] font-semibold text-foreground">
            휴진 영향 예약 · 재배정
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[12.5px] text-muted-foreground">
            {doctorName} 휴진 기간에 걸린 확정 예약입니다. 다른 슬롯으로 재배정하거나 취소·안내해 주세요.
          </Dialog.Description>

          <div className="mt-4 flex-1 space-y-2">
            {items.length === 0 ? (
              <p
                role="status"
                className="rounded-md border border-status-done/40 bg-status-done/12 px-3 py-2 text-[12.5px] font-medium text-status-done-ink"
              >
                ✓ 처리할 영향 예약이 없습니다.
              </p>
            ) : (
              items.map((appt) => (
                <div
                  key={appt.id}
                  className="rounded-md border border-border bg-card px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[13px] font-medium text-foreground">{appt.patient_name}</p>
                      <p className="text-[11.5px] tabular-nums text-muted-foreground">
                        {formatKstDateTime(appt.scheduled_start)} · 확정 예약
                      </p>
                    </div>
                    {active?.id !== appt.id && (
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          type="button"
                          className="h-8 rounded-md border border-primary/45 bg-primary/8 px-2.5 text-[12px] font-medium text-foreground hover:bg-primary/15"
                          onClick={() => setActive({ id: appt.id, mode: "reschedule" })}
                        >
                          재배정
                        </button>
                        <button
                          type="button"
                          className="h-8 rounded-md border border-status-cancelled/50 px-2.5 text-[12px] text-status-cancelled hover:bg-status-cancelled/10"
                          onClick={() => setActive({ id: appt.id, mode: "cancel" })}
                        >
                          취소·안내
                        </button>
                      </div>
                    )}
                  </div>

                  {active?.id === appt.id && active.mode === "reschedule" && (
                    <ReassignControls
                      appt={appt}
                      onCancelMode={() => setActive(null)}
                      onDone={() => resolveRow(appt.id)}
                    />
                  )}
                  {active?.id === appt.id && active.mode === "cancel" && (
                    <CancelControls
                      appt={appt}
                      onCancelMode={() => setActive(null)}
                      onDone={() => resolveRow(appt.id)}
                    />
                  )}
                </div>
              ))
            )}
          </div>

          <div className="mt-4 flex justify-end pt-3">
            <button
              type="button"
              className="h-9 rounded-md border border-border px-4 text-[13px] text-foreground hover:bg-muted"
              onClick={() => onOpenChange(false)}
            >
              닫기
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── 재배정: 같은 진료과 의사 + 가용 슬롯 재선택 (booking-detail reschedule 모드 미러 + 의사 피커) ──
function ReassignControls({
  appt,
  onDone,
  onCancelMode,
}: {
  appt: AffectedAppointment;
  onDone: () => void;
  onCancelMode: () => void;
}) {
  const [doctors, setDoctors] = useState<BookableDoctor[]>([]);
  const [doctorId, setDoctorId] = useState(appt.doctor_id);
  const [date, setDate] = useState(kstDate(appt.scheduled_start));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const submitLock = useRef(false);

  // 같은 진료과 재직 의사(예약된 진료과로 제한 — department_id 정합 유지).
  useEffect(() => {
    let mounted = true;
    fetchBookableDoctors(appt.department_id)
      .then((d) => {
        if (mounted) setDoctors(d);
      })
      .catch(() => {
        if (mounted) setDoctors([]);
      });
    return () => {
      mounted = false;
    };
  }, [appt.department_id]);

  // 선택 의사·날짜의 available 슬롯(booking-detail 패턴).
  useEffect(() => {
    let mounted = true;
    fetchAvailableSlots(doctorId, date)
      .then((res) => {
        if (mounted) setSlots(res.slots.filter((s) => s.status === "available"));
      })
      .catch(() => {
        if (mounted) setSlots([]);
      });
    return () => {
      mounted = false;
    };
  }, [doctorId, date]);

  async function pick(slotStart: string) {
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setConflict(null);
    try {
      await rescheduleAppointment(appt.id, { doctor_id: doctorId, scheduled_start: slotStart });
      // 환자 재배정 안내(best-effort·6.6 이음매 — 실패가 재배정을 되돌리지 않음).
      await recordChangeNotice(appt.id, "reschedule_notice").catch(() => {});
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === "double_booking") {
        setConflict("같은 시간대에 이미 예약이 있습니다.");
      } else if (err instanceof ApiError && err.code === "slot_unavailable") {
        setConflict("선택한 시간은 예약할 수 없는 슬롯입니다.");
      } else {
        setConflict(err instanceof ApiError ? err.message : "재배정하지 못했습니다.");
      }
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="block text-[11.5px] font-medium text-foreground">의사</span>
          <select
            className="h-8 w-full rounded-md border border-border bg-card px-2 text-[12px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            aria-label="재배정 의사"
          >
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-[11.5px] font-medium text-foreground">날짜</span>
          <input
            type="date"
            className="h-8 w-full rounded-md border border-border bg-card px-2 text-[12px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="재배정 날짜"
          />
        </label>
      </div>

      {slots.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">가용 슬롯이 없습니다.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {slots.map((s) => (
            <button
              key={s.start}
              type="button"
              className="h-8 rounded-md border border-primary/45 bg-primary/8 px-2.5 text-[12px] tabular-nums text-foreground hover:bg-primary/15 disabled:opacity-60"
              onClick={() => pick(s.start)}
              disabled={submitting}
            >
              {formatSlotTime(s.start)}
            </button>
          ))}
        </div>
      )}

      {conflict && (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-status-cancelled/40 bg-status-cancelled/12 px-2.5 py-1.5 text-[12px] font-medium text-status-cancelled"
        >
          ✕ {conflict}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          className="h-7 rounded-md border border-border px-3 text-[12px] text-foreground hover:bg-muted"
          onClick={onCancelMode}
        >
          뒤로
        </button>
      </div>
    </div>
  );
}

// ── 취소·안내: 예약 취소(사유=의사 휴진) + 환자 안내 기록 ───────────────────────────────────
function CancelControls({
  appt,
  onDone,
  onCancelMode,
}: {
  appt: AffectedAppointment;
  onDone: () => void;
  onCancelMode: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitLock = useRef(false);

  async function confirm() {
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await cancelAppointment(appt.id, "의사 휴진");
      // 환자 취소 안내(best-effort·6.6 이음매).
      await recordChangeNotice(appt.id, "cancellation_notice").catch(() => {});
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "취소하지 못했습니다.");
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <p className="text-[12px] text-muted-foreground">
        예약을 취소하고 환자에게 휴진 안내를 기록합니다(사유: 의사 휴진).
      </p>
      {error && (
        <p role="alert" className="text-[12px] text-status-cancelled">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          className="h-7 rounded-md border border-border px-3 text-[12px] text-foreground hover:bg-muted"
          onClick={onCancelMode}
        >
          뒤로
        </button>
        <button
          type="button"
          className="h-7 rounded-md bg-status-cancelled px-3 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-60"
          onClick={confirm}
          disabled={submitting}
        >
          {submitting ? "처리 중…" : "취소·안내 확정"}
        </button>
      </div>
    </div>
  );
}

// ISO timestamptz(UTC) → KST 날짜(YYYY-MM-DD·date input 기본값). booking-detail.kstDate 미러.
function kstDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
