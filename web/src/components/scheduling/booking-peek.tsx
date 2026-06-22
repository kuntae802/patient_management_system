"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { maskPhone, searchPatients, sexLabel, type PatientListItem } from "@/lib/reception/patients";
import { createAppointment } from "@/lib/scheduling/appointments";
import { formatSlotTime } from "@/lib/scheduling/slots";

const FIELD =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";
const LABEL = "block text-[12px] font-medium text-foreground";

// 예약 생성 슬라이드오버(Story 6.3 / AC2·AC3). 빈 슬롯 클릭 시 진료과·의사·시각 프리필 → 환자검색(3.5
// searchPatients 재사용·디바운스·abort) + 메모 + SMS → createAppointment. 더블부킹 409 → 인라인 경고
// 칩(저장 안 됨·드로어 유지). 이중제출 useRef 락. 우측 슬라이드오버(Dialog Popup 우측 고정).
export function BookingPeek({
  open,
  onOpenChange,
  departmentId,
  departmentName,
  doctorId,
  doctorName,
  scheduledStart,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departmentId: string;
  departmentName: string;
  doctorId: string;
  doctorName: string;
  scheduledStart: string; // ISO timestamptz(UTC)
  onCreated: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientListItem[]>([]);
  const [selected, setSelected] = useState<PatientListItem | null>(null);
  const [note, setNote] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);

  // 폼 초기화는 부모가 슬롯별 key 로 remount(매 오픈마다 깨끗 — 동기 setState-in-effect 회피).

  // 환자 검색(디바운스 + abort — PatientSearchCommand 패턴). 🚫 검색어 로그/toast 금지.
  // 결과 표시는 query 로 게이트(빈 검색어 시 동기 setResults 불요).
  useEffect(() => {
    const term = query.trim();
    if (term.length < 1) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchPatients(term, controller.signal, 20)
        .then((list) => setResults(list))
        .catch(() => {
          /* abort·일시 오류는 조용히 무시(결과 비움) */
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  async function handleSave() {
    if (!selected || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    setConflict(false);
    try {
      await createAppointment({
        department_id: departmentId,
        doctor_id: doctorId,
        patient_id: selected.id,
        scheduled_start: scheduledStart,
        note: note.trim() || null,
        sms_opt_in: smsOptIn,
      });
      onCreated();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "double_booking") {
        setConflict(true);
      } else {
        setError(err instanceof ApiError ? err.message : "예약을 저장하지 못했습니다.");
      }
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  // 슬롯 시각의 KST 날짜 라벨(저장 UTC·표시 KST). AC2 "날짜/시간" — 시각만이 아니라 날짜도 표시.
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
          <Dialog.Title className="text-[15px] font-semibold text-foreground">
            예약 생성
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[12.5px] text-muted-foreground">
            {departmentName} · {doctorName} · {dateLabel} {formatSlotTime(scheduledStart)}
          </Dialog.Description>

          <div className="mt-4 space-y-3">
            {/* 진료과·의사·시각 = 슬롯에서 프리필(읽기 전용) */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className={LABEL}>진료과</span>
                <p className={`${FIELD} flex items-center bg-muted`}>{departmentName}</p>
              </div>
              <div className="space-y-1">
                <span className={LABEL}>담당의</span>
                <p className={`${FIELD} flex items-center bg-muted`}>{doctorName}</p>
              </div>
            </div>

            {/* 환자 검색(필수) */}
            <div className="space-y-1">
              <span className={LABEL}>
                환자 <span className="text-status-cancelled">(필수)</span>
              </span>
              {selected ? (
                <div className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/8 px-3 py-2">
                  <span className="text-[13px] font-medium text-foreground">
                    {selected.name} · {selected.chart_no}
                  </span>
                  <button
                    type="button"
                    className="text-[12px] text-muted-foreground underline"
                    onClick={() => setSelected(null)}
                  >
                    변경
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <input
                      className={`${FIELD} pl-8`}
                      placeholder="이름·차트번호·연락처 검색"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      aria-required
                    />
                  </div>
                  {query.trim().length > 0 && results.length > 0 && (
                    <ul className="max-h-44 overflow-auto rounded-md border border-border">
                      {results.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            className="flex w-full flex-col gap-0.5 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-muted"
                            onClick={() => setSelected(p)}
                          >
                            <span className="text-[13px] font-medium text-foreground">
                              {p.name} · {p.chart_no}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {p.birth_date} · {sexLabel(p.sex)} · {p.resident_no_masked} ·{" "}
                              {maskPhone(p.phone)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>

            {/* 날짜/시간 = 슬롯 프리필(읽기) */}
            <div className="space-y-1">
              <span className={LABEL}>날짜·시간</span>
              <p className={`${FIELD} flex items-center bg-muted`}>
                {dateLabel} {formatSlotTime(scheduledStart)} 시작 · 30분
              </p>
            </div>

            {/* 메모 */}
            <div className="space-y-1">
              <span className={LABEL}>메모</span>
              <textarea
                className="min-h-16 w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="운영 메모(임상·민감정보 입력 금지)"
              />
            </div>

            {/* SMS */}
            <label className="flex items-center gap-2 text-[13px] text-foreground">
              <input
                type="checkbox"
                checked={smsOptIn}
                onChange={(e) => setSmsOptIn(e.target.checked)}
              />
              예약 확정 SMS 발송
            </label>

            {/* 더블부킹 인라인 경고 칩(AC3) */}
            {conflict && (
              <p
                role="alert"
                aria-live="assertive"
                className="rounded-md border border-status-cancelled/40 bg-status-cancelled/12 px-3 py-2 text-[12.5px] font-medium text-status-cancelled"
              >
                ✕ 더블부킹 차단 — 같은 시간대에 이미 예약이 있습니다.
              </p>
            )}
            {error && (
              <p role="alert" className="text-[12.5px] text-status-cancelled">
                {error}
              </p>
            )}
          </div>

          <div className="mt-auto flex justify-end gap-2 pt-5">
            <button
              type="button"
              className="h-9 rounded-md border border-border px-4 text-[13px] text-foreground hover:bg-muted"
              onClick={() => onOpenChange(false)}
            >
              취소
            </button>
            <button
              type="button"
              className="h-9 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
              onClick={handleSave}
              disabled={!selected || submitting}
            >
              {submitting ? "저장 중…" : "예약 저장"}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
