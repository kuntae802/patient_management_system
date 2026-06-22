"use client";

import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api/client";
import {
  createSelfAppointment,
  fetchSelfBookableDoctors,
  fetchSelfSlots,
  formatKstDateLong,
  formatSlotTime12h,
} from "@/lib/scheduling/patient-booking";
import { todayKstISO, type BookableDoctor, type Slot } from "@/lib/scheduling/slots";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// 환자 앱 예약(Story 6.5·UX-DR17): 진료과 → 의사 → 날짜 칩 레일 → 시간 슬롯 그리드 → 선택 요약 →
// "예약 확정하기"(sticky CTA·≥44px). 12시간 표기(오후 2:30)·쉬운 말·큰 터치·음영 비의존. patient_id 는
// 서버가 세션에서 도출(클라 미전송). 미연결(self-link 미완)은 온보딩 유도. 변경·취소(마이 메뉴)=후속.

type DeptOption = { id: string; name: string };
type LinkState = "checking" | "linked" | "unlinked";
const DATE_CHIP_DAYS = 14; // 오늘부터 2주 — per-date 휴진/마감 배지는 이월(슬롯 선택 시 확인)

const PILL =
  "flex min-h-[44px] w-full items-center justify-between rounded-xl border bg-card px-4 text-[15px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50";
const LABEL = "block text-[13px] font-semibold text-foreground";

type DateChip = { iso: string; weekday: string; day: string; label: string; isSunday: boolean };

/** 오늘(KST)부터 count 일의 날짜 칩(요일·일·오늘/내일 라벨·일요일 플래그). */
function buildDateChips(count: number): DateChip[] {
  const base = new Date(`${todayKstISO()}T12:00:00Z`); // 정오 UTC 앵커(KST 날짜 경계 안전)
  const isoFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });
  const wdFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", weekday: "short" });
  const dayFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", day: "numeric" });
  const chips: DateChip[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base.getTime() + i * 86_400_000);
    const weekday = wdFmt.format(d);
    chips.push({
      iso: isoFmt.format(d),
      weekday,
      day: dayFmt.format(d),
      label: i === 0 ? "오늘" : i === 1 ? "내일" : weekday,
      isSunday: weekday === "일",
    });
  }
  return chips;
}

const SLOT_META: Record<Slot["status"], { label: string; selectable: boolean }> = {
  available: { label: "예약 가능", selectable: true },
  booked: { label: "마감", selectable: false },
  time_off: { label: "휴진", selectable: false },
  past: { label: "지남", selectable: false },
};

export function PatientBooking() {
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [doctors, setDoctors] = useState<BookableDoctor[]>([]);

  const [deptId, setDeptId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState("");
  const [slotStart, setSlotStart] = useState("");

  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ dateISO: string; slotStart: string; doctorName: string } | null>(
    null,
  );
  const submitLock = useRef(false);
  // 최신 슬롯 요청 키 — 슬롯 effect·409 재조회가 공유해 늦게 도착한 stale 응답을 버린다(이전 의사/날짜).
  const slotReqRef = useRef("");
  const chips = buildDateChips(DATE_CHIP_DAYS);

  // 마운트 시 본인 연결 확인 — 미연결(404 no_self_patient)이면 온보딩 유도(예약 폼 미표시).
  useEffect(() => {
    let cancelled = false;
    apiFetch("/v1/patients/self")
      .then(() => !cancelled && setLinkState("linked"))
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.code === "no_self_patient")) {
          setLinkState("unlinked");
        } else {
          setLinkState("linked"); // 일시 오류는 폼 진입 허용(서버 409 백스톱)
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 진료과(Supabase 직접조회·활성만·RLS authenticated) 1회 로드.
  const loadDepartments = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error: dErr } = await supabase
        .from("departments")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (dErr) {
        setError("진료과 목록을 불러오지 못했습니다.");
        return;
      }
      setDepartments((data ?? []) as DeptOption[]);
    } catch {
      setError("진료과 목록을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    if (linkState !== "linked") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDepartments();
  }, [linkState, loadDepartments]);

  // 의사 + 날짜가 정해지면 슬롯 로드(cancelled + reqKey 가드로 빠른 전환 stale-write 차단).
  useEffect(() => {
    if (!doctorId || !date) return;
    const reqKey = `${doctorId}|${date}`;
    slotReqRef.current = reqKey;
    let cancelled = false;
    fetchSelfSlots(doctorId, date)
      .then((res) => {
        if (cancelled || slotReqRef.current !== reqKey) return;
        setSlots(res.slots);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled || slotReqRef.current !== reqKey) return;
        setError(err instanceof ApiError ? err.message : "슬롯을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [doctorId, date]);

  // 진료과 선택 시 의사 목록 로드(cancelled 가드로 빠른 전환 stale-write 차단·슬롯 effect 패턴 미러).
  useEffect(() => {
    if (!deptId) return;
    let cancelled = false;
    fetchSelfBookableDoctors(deptId)
      .then((res) => {
        if (cancelled) return;
        setDoctors(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "의사 목록을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [deptId]);

  function onDeptChange(value: string) {
    // 의사 목록 fetch 는 [deptId] effect 가 가드와 함께 수행(stale-write 방지). 여기선 리셋만.
    setDeptId(value);
    setDoctorId("");
    setDoctors([]);
    setDate("");
    setSlots(null);
    setSlotStart("");
    setError(null);
  }

  function onDoctorChange(value: string) {
    setDoctorId(value);
    setDate("");
    setSlots(null);
    setSlotStart("");
    setError(null);
  }

  function onDateChange(value: string) {
    setDate(value);
    setSlots(null);
    setSlotStart("");
    setError(null);
  }

  const doctorName = doctors.find((d) => d.id === doctorId)?.name ?? "";

  async function onConfirm() {
    if (submitLock.current || !deptId || !doctorId || !slotStart) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await createSelfAppointment({
        department_id: deptId,
        doctor_id: doctorId,
        scheduled_start: slotStart,
        sms_opt_in: true,
      });
      setDone({ dateISO: date, slotStart, doctorName });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "double_booking") {
          setError("방금 마감된 시간입니다. 다른 시간을 선택해 주세요.");
          setSlotStart("");
          if (doctorId && date) {
            // reqKey 가드: 재조회 중 날짜/의사 전환 시 stale 응답 폐기(setError 미클리어 → 경고 보존).
            const reqKey = `${doctorId}|${date}`;
            slotReqRef.current = reqKey;
            fetchSelfSlots(doctorId, date)
              .then((res) => {
                if (slotReqRef.current !== reqKey) return;
                setSlots(res.slots);
              })
              .catch(() => {});
          }
        } else if (err.code === "no_self_patient") {
          setLinkState("unlinked");
        } else if (err.code === "no_show_threshold_exceeded") {
          // 노쇼 누적 차단(6.7) — 쉬운 말 + 병원 문의 안내. 슬롯 선택은 유지(사용자가 사유 인지).
          setError(
            "미방문(노쇼)이 누적되어 앱에서 바로 예약하기 어려워요. 병원으로 문의해 주세요.",
          );
        } else {
          setError(err.message);
        }
      } else {
        setError("예약을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  function resetForNew() {
    setDone(null);
    setDeptId("");
    setDoctorId("");
    setDoctors([]);
    setDate("");
    setSlots(null);
    setSlotStart("");
    setError(null);
  }

  // ── 연결 확인 / 미연결 ─────────────────────────────────────────────────────
  if (linkState === "checking") {
    return (
      <p className="flex items-center gap-2 px-1 py-10 text-[15px] text-muted-foreground" aria-live="polite">
        <Loader2 className="size-4 animate-spin" aria-hidden /> 불러오는 중…
      </p>
    );
  }
  if (linkState === "unlinked") {
    return (
      <div className="space-y-4 px-1 py-8 text-center">
        <h1 className="text-[18px] font-bold text-foreground">예약하기</h1>
        <p className="text-[15px] text-muted-foreground">
          예약하려면 본인 진료기록을 먼저 연결해 주세요.
        </p>
        <Link
          href="/onboarding"
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-primary px-5 text-[15px] font-bold text-primary-foreground"
        >
          본인 진료기록 연결
        </Link>
      </div>
    );
  }

  // ── 예약 완료(쉬운 말 확인) ────────────────────────────────────────────────
  if (done) {
    return (
      <div className="space-y-5 px-1 py-10 text-center" aria-live="polite">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/12 text-primary">
          <Check className="size-7" aria-hidden />
        </div>
        <h1 className="text-[20px] font-bold text-foreground">예약이 완료되었어요</h1>
        <p className="text-[16px] font-semibold text-primary">
          {formatKstDateLong(done.dateISO)} {formatSlotTime12h(done.slotStart)}
          {done.doctorName && ` · ${done.doctorName} 선생님`}
        </p>
        <p className="text-[13.5px] text-muted-foreground">
          예약 후 변경·취소는 마이 메뉴에서 하실 수 있어요.
        </p>
        <button
          type="button"
          onClick={resetForNew}
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-border bg-card px-5 text-[15px] font-semibold text-foreground"
        >
          새 예약하기
        </button>
      </div>
    );
  }

  // ── 예약 흐름 ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 px-1 pb-28">
      <header className="space-y-1">
        <h1 className="text-[21px] font-bold text-foreground">원하시는 시간을 선택해 주세요</h1>
        <p className="text-[14px] text-muted-foreground">진료과와 의사, 날짜·시간을 차례로 고르세요.</p>
      </header>

      <label className="space-y-2">
        <span className={LABEL}>진료과</span>
        <select
          aria-label="진료과"
          className={cn(PILL, "appearance-none")}
          value={deptId}
          onChange={(e) => onDeptChange(e.target.value)}
        >
          <option value="">진료과 선택</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-2">
        <span className={LABEL}>의사</span>
        <select
          aria-label="의사"
          className={cn(PILL, "appearance-none")}
          value={doctorId}
          onChange={(e) => onDoctorChange(e.target.value)}
          disabled={!deptId || doctors.length === 0}
        >
          <option value="">{deptId ? "의사 선택" : "진료과 먼저 선택"}</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      {doctorId && (
        <div className="space-y-2">
          <span className={LABEL}>날짜</span>
          <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="예약 날짜 선택">
            {chips.map((c) => {
              const selected = c.iso === date;
              return (
                <li key={c.iso} className="shrink-0">
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onDateChange(c.iso)}
                    className={cn(
                      "flex min-h-[44px] w-[62px] flex-col items-center gap-0.5 rounded-xl border px-1 py-2",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "text-[11px]",
                        selected
                          ? "text-primary-foreground/90"
                          : c.isSunday
                            ? "text-status-cancelled"
                            : "text-muted-foreground",
                      )}
                    >
                      {c.label}
                    </span>
                    <span className="text-[18px] font-bold tabular-nums">{c.day}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="text-[14px] text-status-cancelled">
          {error}
        </p>
      )}

      {doctorId && date && (
        <div className="space-y-2">
          <span className={LABEL}>시간</span>
          {!slots ? (
            <p className="py-4 text-[14px] text-muted-foreground" aria-live="polite">
              시간을 불러오는 중…
            </p>
          ) : slots.length === 0 || slots.every((s) => s.status !== "available") ? (
            <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-[14px] text-muted-foreground">
              이 날짜에 예약 가능한 시간이 없어요. 다른 날짜를 선택해 주세요.
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-2" aria-label="예약 가능 시간">
              {slots.map((s) => {
                const meta = SLOT_META[s.status];
                const selected = s.start === slotStart;
                return (
                  <li key={s.start}>
                    <button
                      type="button"
                      disabled={!meta.selectable}
                      aria-pressed={selected}
                      onClick={() => setSlotStart(s.start)}
                      className={cn(
                        "flex min-h-[46px] w-full flex-col items-center justify-center rounded-xl border text-[14px] font-semibold",
                        meta.selectable && selected && "border-primary bg-primary text-primary-foreground",
                        meta.selectable && !selected && "border-primary/50 bg-primary/5 text-primary",
                        !meta.selectable && "border-border bg-muted text-muted-foreground",
                      )}
                    >
                      {meta.selectable ? (
                        <span className="tabular-nums">{formatSlotTime12h(s.start)}</span>
                      ) : (
                        <>
                          <span className="tabular-nums text-[12.5px]">{formatSlotTime12h(s.start)}</span>
                          <span className="text-[10.5px]">{meta.label}</span>
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {slotStart && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
          <p className="text-[11.5px] font-bold uppercase tracking-wide text-primary">선택한 예약</p>
          <p className="text-[15px] font-semibold text-primary">
            {formatKstDateLong(date)} {formatSlotTime12h(slotStart)}
            {doctorName && ` · ${doctorName} 선생님`}
          </p>
        </div>
      )}

      {/* sticky CTA(≥44px) — 선택 완료 시에만 활성 */}
      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-md border-t border-border bg-background/95 px-5 py-3 backdrop-blur">
        <p className="mb-1 text-center text-[12.5px] text-muted-foreground">
          예약 후 변경·취소는 마이 메뉴에서 하실 수 있어요.
        </p>
        <button
          type="button"
          disabled={!slotStart || submitting}
          onClick={onConfirm}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[16px] font-bold text-primary-foreground disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <Check className="size-4" aria-hidden />
          )}
          예약 확정하기
        </button>
      </div>
    </div>
  );
}
