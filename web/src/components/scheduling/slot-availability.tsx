"use client";

import { CalendarSearch } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";
import {
  fetchAvailableSlots,
  fetchBookableDoctors,
  todayKstISO,
  type BookableDoctor,
  type Slot,
} from "@/lib/scheduling/slots";
import { createClient } from "@/lib/supabase/client";

import { SlotGrid } from "./slot-grid";

const FIELD =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";
const LABEL = "block text-[12px] font-medium text-foreground";

type DeptOption = { id: string; name: string };

// 예약 가용 슬롯 조회(원무, Story 6.2). 진료과(Supabase 직접조회·전역 참조) → 의사(FastAPI
// bookable-doctors·users RLS 우회, 클라 필터) → 날짜(KST) → 슬롯(FastAPI 계산). 6.2 는 읽기 전용
// 미리보기 — 슬롯 선택→예약 생성·캘린더(UX-DR15)·booking-peek 는 6.3/6.4 가 이 라우트를 확장한다.
export function SlotAvailability() {
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [allDoctors, setAllDoctors] = useState<BookableDoctor[]>([]);
  const [deptId, setDeptId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState(todayKstISO());

  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 진료과(Supabase 직접조회·활성만, 0006 RLS) + 예약 가능 의사(FastAPI·users RLS 우회)를 마운트 시
  // 1회 로드. setState 가 await 이후라 effect 동기 setState 가 아님(staff-directory 패턴).
  const loadRefs = useCallback(async () => {
    try {
      const supabase = createClient();
      const [deptRes, doctors] = await Promise.all([
        supabase.from("departments").select("id, name").eq("is_active", true).order("code"),
        fetchBookableDoctors(),
      ]);
      setDepartments((deptRes.data ?? []) as DeptOption[]);
      setAllDoctors(doctors);
      if (deptRes.error) setError("진료과 목록을 불러오지 못했습니다.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "참조 데이터를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRefs();
  }, [loadRefs]);

  // 의사 + 날짜가 정해지면 슬롯 계산 로드(FastAPI). slots 리셋은 피커 onChange(이벤트 핸들러)가 수행 →
  // effect 는 fetch 후 setState(await 이후)만. cancelled 가드로 빠른 전환의 stale 응답 차단.
  useEffect(() => {
    if (!doctorId || !date) return;
    let cancelled = false;
    fetchAvailableSlots(doctorId, date)
      .then((res) => {
        if (cancelled) return;
        setSlots(res.slots);
        setError(null); // 성공 시 이전 에러 클리어(핸들러 리셋에만 의존하지 않게 방어)
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "슬롯을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [doctorId, date]);

  const visibleDoctors = deptId
    ? allDoctors.filter((d) => d.department_id === deptId)
    : [];

  // 피커 변경 = 이벤트 핸들러(effect 아님) → setState 자유. 의존 변경 시 slots/error 리셋해 stale·로딩 표시.
  function onDeptChange(value: string) {
    setDeptId(value);
    setDoctorId("");
    setSlots(null);
    setError(null);
  }
  function onDoctorChange(value: string) {
    setDoctorId(value);
    setSlots(null);
    setError(null);
  }
  function onDateChange(value: string) {
    setDate(value);
    setSlots(null);
    setError(null);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-2">
        <CalendarSearch className="size-5 text-primary" aria-hidden />
        <div>
          <h1 className="text-[17px] font-semibold text-foreground">예약 관리</h1>
          <p className="text-[12.5px] text-muted-foreground">
            진료과·의사·날짜를 선택해 예약 가능한 슬롯을 확인하세요.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="space-y-1">
          <span className={LABEL}>진료과</span>
          <select className={FIELD} value={deptId} onChange={(e) => onDeptChange(e.target.value)}>
            <option value="">진료과 선택</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className={LABEL}>의사</span>
          <select
            className={FIELD}
            value={doctorId}
            onChange={(e) => onDoctorChange(e.target.value)}
            disabled={!deptId || visibleDoctors.length === 0}
          >
            <option value="">{deptId ? "의사 선택" : "진료과 먼저 선택"}</option>
            {visibleDoctors.map((d) => (
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
            className={FIELD}
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="text-[13px] text-status-cancelled">
          {error}
        </p>
      )}

      {!doctorId ? (
        <p className="text-[13px] text-muted-foreground">의사를 선택하면 가용 슬롯이 표시됩니다.</p>
      ) : !date ? (
        <p className="text-[13px] text-muted-foreground">날짜를 선택하세요.</p>
      ) : !slots && !error ? (
        <p className="text-[13px] text-muted-foreground" aria-live="polite">
          슬롯을 불러오는 중…
        </p>
      ) : slots ? (
        <SlotGrid slots={slots} />
      ) : null}
    </div>
  );
}
