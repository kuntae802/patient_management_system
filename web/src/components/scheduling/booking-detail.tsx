"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api/client";
import {
  cancelAppointment,
  checkInReservation,
  noShowAppointment,
  rescheduleAppointment,
} from "@/lib/scheduling/appointments";
import { fetchAvailableSlots, formatSlotTime, type Slot } from "@/lib/scheduling/slots";

// 확정(booked) 예약 상세·액션 슬라이드오버(Story 6.4 / AC1·AC3). 확정 슬롯 클릭 시 환자·시각 표시 +
// 취소·노쇼·도착접수·변경. 취소/노쇼=사유 입력. 도착접수→reserved 내원 생성(대기 진입). 변경=같은 의사
// 가용 슬롯 재선택 후 PATCH(더블부킹 409·슬롯 불가 422 인라인). 이중제출 useRef 락. booking-peek 미러.
type Mode = "menu" | "cancel" | "no_show" | "reschedule" | "checked_in";

export function BookingDetail({
  open,
  onOpenChange,
  appointmentId,
  doctorId,
  doctorName,
  departmentName,
  scheduledStart,
  patientName,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentId: string;
  doctorId: string;
  doctorName: string;
  departmentName: string;
  scheduledStart: string; // ISO timestamptz(UTC)
  patientName: string | null;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode>("menu");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);

  // 변경(reschedule) 슬롯 재선택용 — 날짜·가용 슬롯.
  const [rescheduleDate, setRescheduleDate] = useState(kstDate(scheduledStart));
  const [slots, setSlots] = useState<Slot[]>([]);

  // 상태/폼은 부모가 appointmentId 별 key 로 remount(매 오픈 깨끗 — setState-in-effect 회피).

  // 변경 모드 진입 시 가용 슬롯 조회(같은 의사·선택 날짜).
  useEffect(() => {
    if (mode !== "reschedule") return;
    let active = true;
    fetchAvailableSlots(doctorId, rescheduleDate)
      .then((res) => {
        if (active) setSlots(res.slots.filter((s) => s.status === "available"));
      })
      .catch(() => {
        if (active) setSlots([]);
      });
    return () => {
      active = false;
    };
  }, [mode, doctorId, rescheduleDate]);

  function reset() {
    setError(null);
    setConflict(null);
  }

  async function runAction(fn: () => Promise<unknown>, onDone: () => void) {
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    reset();
    try {
      await fn();
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === "double_booking") {
        setConflict("같은 시간대에 이미 예약이 있습니다.");
      } else if (err instanceof ApiError && err.code === "slot_unavailable") {
        setConflict("선택한 시간은 예약할 수 없는 슬롯입니다.");
      } else {
        setError(err instanceof ApiError ? err.message : "처리하지 못했습니다.");
      }
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  const handleCancel = () =>
    runAction(
      () => cancelAppointment(appointmentId, reason.trim() || undefined),
      () => {
        onChanged();
        onOpenChange(false);
      },
    );

  const handleNoShow = () =>
    runAction(
      () => noShowAppointment(appointmentId, reason.trim() || undefined),
      () => {
        onChanged();
        onOpenChange(false);
      },
    );

  const handleCheckIn = () =>
    runAction(
      () => checkInReservation(appointmentId),
      () => {
        // 성공 시 즉시 닫지 않고 "대기 등록" 안내 후 갱신(원무 확인). 닫힘은 사용자가.
        setMode("checked_in");
        submitLock.current = false;
        setSubmitting(false);
        onChanged();
      },
    );

  const handleReschedule = (slotStart: string) =>
    runAction(
      () => rescheduleAppointment(appointmentId, { doctor_id: doctorId, scheduled_start: slotStart }),
      () => {
        onChanged();
        onOpenChange(false);
      },
    );

  const dateLabel = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(scheduledStart));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/30" />
        <Dialog.Popup className="fixed right-0 top-0 z-50 flex h-full w-[min(420px,100vw)] flex-col overflow-auto border-l border-border bg-card p-5 outline-none">
          <Dialog.Title className="text-[15px] font-semibold text-foreground">예약 상세</Dialog.Title>
          <Dialog.Description className="mt-1 text-[12.5px] text-muted-foreground">
            {departmentName} · {doctorName} · {dateLabel} {formatSlotTime(scheduledStart)}
          </Dialog.Description>

          <div className="mt-4 space-y-3">
            <div className="rounded-md border border-status-inprogress/40 bg-status-inprogress/8 px-3 py-2">
              <p className="text-[13px] font-medium text-foreground">
                {patientName ?? "(환자 정보 없음)"}
              </p>
              <p className="text-[11.5px] text-muted-foreground">확정 예약 · 30분</p>
            </div>

            {mode === "checked_in" && (
              <p
                role="status"
                aria-live="polite"
                className="rounded-md border border-status-done/40 bg-status-done/12 px-3 py-2 text-[12.5px] font-medium text-status-done-ink"
              >
                ✓ 도착 접수 완료 — 대기 현황판에 등록되었습니다.
              </p>
            )}

            {/* 취소·노쇼 사유 입력 */}
            {(mode === "cancel" || mode === "no_show") && (
              <div className="space-y-1">
                <span className="block text-[12px] font-medium text-foreground">
                  사유 <span className="text-muted-foreground">(선택)</span>
                </span>
                <textarea
                  className="min-h-14 w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="운영 사유(임상·민감정보 입력 금지)"
                />
              </div>
            )}

            {/* 변경 = 같은 의사 가용 슬롯 재선택 */}
            {mode === "reschedule" && (
              <div className="space-y-2">
                <label className="space-y-1">
                  <span className="block text-[12px] font-medium text-foreground">변경할 날짜</span>
                  <input
                    type="date"
                    className="h-9 w-44 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                    value={rescheduleDate}
                    onChange={(e) => setRescheduleDate(e.target.value)}
                  />
                </label>
                {slots.length === 0 ? (
                  <p className="text-[12.5px] text-muted-foreground">가용 슬롯이 없습니다.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {slots.map((s) => (
                      <button
                        key={s.start}
                        type="button"
                        className="h-8 rounded-md border border-primary/45 bg-primary/8 px-2.5 text-[12px] tabular-nums text-foreground hover:bg-primary/15 disabled:opacity-60"
                        onClick={() => handleReschedule(s.start)}
                        disabled={submitting}
                      >
                        {formatSlotTime(s.start)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {conflict && (
              <p
                role="alert"
                aria-live="assertive"
                className="rounded-md border border-status-cancelled/40 bg-status-cancelled/12 px-3 py-2 text-[12.5px] font-medium text-status-cancelled"
              >
                ✕ {conflict}
              </p>
            )}
            {error && (
              <p role="alert" className="text-[12.5px] text-status-cancelled">
                {error}
              </p>
            )}
          </div>

          <div className="mt-auto flex flex-wrap justify-end gap-2 pt-5">
            {mode === "menu" && (
              <>
                <button
                  type="button"
                  className="h-9 rounded-md border border-border px-4 text-[13px] text-foreground hover:bg-muted"
                  onClick={() => setMode("reschedule")}
                >
                  변경
                </button>
                <button
                  type="button"
                  className="h-9 rounded-md border border-status-received/50 px-4 text-[13px] text-status-received-ink hover:bg-status-received/10"
                  onClick={() => setMode("no_show")}
                >
                  노쇼
                </button>
                <button
                  type="button"
                  className="h-9 rounded-md border border-status-cancelled/50 px-4 text-[13px] text-status-cancelled hover:bg-status-cancelled/10"
                  onClick={() => setMode("cancel")}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="h-9 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
                  onClick={handleCheckIn}
                  disabled={submitting}
                >
                  도착 접수
                </button>
              </>
            )}

            {(mode === "cancel" || mode === "no_show") && (
              <>
                <button
                  type="button"
                  className="h-9 rounded-md border border-border px-4 text-[13px] text-foreground hover:bg-muted"
                  onClick={() => {
                    reset();
                    setMode("menu");
                  }}
                >
                  뒤로
                </button>
                <button
                  type="button"
                  className="h-9 rounded-md bg-status-cancelled px-4 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-60"
                  onClick={mode === "cancel" ? handleCancel : handleNoShow}
                  disabled={submitting}
                >
                  {submitting ? "처리 중…" : mode === "cancel" ? "예약 취소 확정" : "노쇼 처리 확정"}
                </button>
              </>
            )}

            {mode === "reschedule" && (
              <button
                type="button"
                className="h-9 rounded-md border border-border px-4 text-[13px] text-foreground hover:bg-muted"
                onClick={() => {
                  reset();
                  setMode("menu");
                }}
              >
                뒤로
              </button>
            )}

            {mode === "checked_in" && (
              <button
                type="button"
                className="h-9 rounded-md border border-border px-4 text-[13px] text-foreground hover:bg-muted"
                onClick={() => onOpenChange(false)}
              >
                닫기
              </button>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ISO timestamptz(UTC) → KST 날짜(YYYY-MM-DD·date input 기본값).
function kstDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
