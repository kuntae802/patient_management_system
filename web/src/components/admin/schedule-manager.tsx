"use client";

import { CalendarClock, CalendarOff, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { AffectedAppointmentsPanel } from "@/components/admin/affected-appointments-panel";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { DoctorScheduleForm } from "@/components/admin/doctor-schedule-form";
import { DoctorTimeOffForm } from "@/components/admin/doctor-time-off-form";
import { apiFetch, ApiError } from "@/lib/api/client";
import {
  fetchAffectedAppointments,
  type AffectedAppointment,
} from "@/lib/scheduling/appointments";
import { activeMeta, departmentLabel, type Department, type Room } from "@/lib/admin/masters";
import {
  doctorLabel,
  fetchSchedulingDoctors,
  formatKstDateTime,
  formatTimeRange,
  roomLabel,
  weekdayLabel,
  type DoctorSchedule,
  type DoctorTimeOff,
  type SchedulingData,
  type SchedulingDoctor,
  type SchedulingLoadErrors,
} from "@/lib/admin/schedule";
import { cn } from "@/lib/utils";

type Tab = "schedules" | "timeOffs";

type PendingConfirm = { kind: Tab; id: string; name: string };

function sortSchedules(rows: DoctorSchedule[]): DoctorSchedule[] {
  return [...rows].sort(
    (a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time),
  );
}
function sortTimeOffs(rows: DoctorTimeOff[]): DoctorTimeOff[] {
  return [...rows].sort((a, b) => a.start_at.localeCompare(b.start_at));
}

function upsertSchedule(rows: DoctorSchedule[], saved: DoctorSchedule): DoctorSchedule[] {
  const exists = rows.some((r) => r.id === saved.id);
  return sortSchedules(exists ? rows.map((r) => (r.id === saved.id ? saved : r)) : [...rows, saved]);
}
function upsertTimeOff(rows: DoctorTimeOff[], saved: DoctorTimeOff): DoctorTimeOff[] {
  const exists = rows.some((r) => r.id === saved.id);
  return sortTimeOffs(exists ? rows.map((r) => (r.id === saved.id ? saved : r)) : [...rows, saved]);
}

// 근무표·휴진 관리(관리자, FR-220·221). 읽기 = RSC Supabase 직접조회 주입(initial: 근무표·휴진·진료과·
// 진료실), 단 **의사 목록은 마운트 시 클라 apiFetch**(users RLS 본인행 → RSC 직접조회 불가, 0030/0003).
// 쓰기 = FastAPI(apiFetch, master.manage). 비활성(soft delete)은 확인 다이얼로그, 활성 복귀는 즉시.
// 겹침은 서버 409(schedule_overlap) → 폼 인라인(생성·수정)·토스트(재활성). 변경은 0030 자동 감사.
export function ScheduleManager({
  initial,
  departments,
  rooms,
  loadErrors,
}: {
  initial: SchedulingData;
  departments: Department[];
  rooms: Room[];
  loadErrors?: SchedulingLoadErrors;
}) {
  const [tab, setTab] = useState<Tab>("schedules");
  const [schedules, setSchedules] = useState<DoctorSchedule[]>(sortSchedules(initial.schedules));
  const [timeOffs, setTimeOffs] = useState<DoctorTimeOff[]>(sortTimeOffs(initial.timeOffs));
  const [doctors, setDoctors] = useState<SchedulingDoctor[]>([]);
  const [doctorsError, setDoctorsError] = useState<string | null>(null);

  const [schedForm, setSchedForm] = useState<{ open: boolean; editing: DoctorSchedule | null }>({
    open: false,
    editing: null,
  });
  const [timeOffForm, setTimeOffForm] = useState<{ open: boolean; editing: DoctorTimeOff | null }>({
    open: false,
    editing: null,
  });
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  // 휴진 영향 예약 패널(Story 6.8) — 휴진 등록 후 자동 또는 행 "영향 예약" 액션으로 오픈. key 로 매 오픈 remount.
  const [affected, setAffected] = useState<{ doctorName: string; items: AffectedAppointment[] } | null>(
    null,
  );
  const [affectedKey, setAffectedKey] = useState(0);

  // 휴진의 영향 예약(그 의사·booked·기간 겹침)을 조회해 패널 오픈. openWhenEmpty=false 면 0건 시 조용히
  // (등록 토스트만·UX-DR15 "영향 예약 있으면 표시"). 비활성 휴진은 슬롯 차단 안 함 → 호출부가 거른다.
  const loadAffected = useCallback(
    async (timeOff: DoctorTimeOff, openWhenEmpty: boolean) => {
      try {
        const rows = await fetchAffectedAppointments(
          timeOff.doctor_id,
          timeOff.start_at,
          timeOff.end_at,
        );
        if (rows.length === 0 && !openWhenEmpty) return;
        setAffectedKey((k) => k + 1);
        setAffected({ doctorName: doctorLabel(doctors, timeOff.doctor_id), items: rows });
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "영향 예약을 불러오지 못했습니다.");
      }
    },
    [doctors],
  );

  // 의사 목록은 users RLS(본인행, 0003)라 RSC 직접조회 불가 → 마운트 시 FastAPI(service_role) 조회.
  const loadDoctors = useCallback(async () => {
    try {
      const data = await fetchSchedulingDoctors();
      setDoctors(data);
      setDoctorsError(null);
    } catch (err) {
      setDoctors([]);
      setDoctorsError(err instanceof ApiError ? err.message : "의사 목록을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    // 외부 시스템(FastAPI) 동기화 — load 의 setState 는 await 이후라 effect 동기 setState 아님.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDoctors();
  }, [loadDoctors]);

  function startPending(id: string) {
    setPendingIds((p) => new Set(p).add(id));
  }
  function endPending(id: string) {
    setPendingIds((p) => {
      const next = new Set(p);
      next.delete(id);
      return next;
    });
  }

  function openCreate() {
    if (tab === "schedules") setSchedForm({ open: true, editing: null });
    else setTimeOffForm({ open: true, editing: null });
  }

  async function applyActive(kind: Tab, id: string, name: string, next: boolean) {
    startPending(id);
    try {
      const body = JSON.stringify({ is_active: next });
      if (kind === "schedules") {
        const u = await apiFetch<DoctorSchedule>(
          `/v1/scheduling/doctor-schedules/${id}/active`,
          { method: "PATCH", body },
        );
        setSchedules((p) => sortSchedules(p.map((s) => (s.id === id ? u : s))));
      } else {
        const u = await apiFetch<DoctorTimeOff>(
          `/v1/scheduling/doctor-time-offs/${id}/active`,
          { method: "PATCH", body },
        );
        setTimeOffs((p) => sortTimeOffs(p.map((t) => (t.id === id ? u : t))));
      }
      toast.success(`${name} · ${next ? "활성화" : "비활성화"}되었습니다.`);
    } catch (err) {
      // 재활성 시 겹침(409 schedule_overlap) 등은 메시지 노출(겹치는 활성 근무표가 있으면 복귀 거부).
      toast.error(err instanceof ApiError ? err.message : "상태를 변경하지 못했습니다.");
    } finally {
      endPending(id);
    }
  }

  function onToggleSchedule(s: DoctorSchedule) {
    const name = `${doctorLabel(doctors, s.doctor_id)} ${weekdayLabel(s.weekday)}요일 ${formatTimeRange(s.start_time, s.end_time)}`;
    if (!s.is_active) {
      void applyActive("schedules", s.id, name, true); // 활성 복귀는 즉시
      return;
    }
    setConfirm({ kind: "schedules", id: s.id, name });
  }

  function onToggleTimeOff(t: DoctorTimeOff) {
    const name = `${doctorLabel(doctors, t.doctor_id)} 휴진`;
    if (!t.is_active) {
      void applyActive("timeOffs", t.id, name, true);
      return;
    }
    setConfirm({ kind: "timeOffs", id: t.id, name });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">
            근무 스케줄
          </h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            의사 근무표·휴진을 관리합니다 · 예약 가능 슬롯과 휴진 재배정의 근거 · 비활성해도 과거
            예약 참조는 보존되며 변경은 감사 로그에 기록됩니다
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-white hover:bg-primary-hover"
        >
          <Plus className="size-4" aria-hidden />
          {tab === "schedules" ? "근무표 추가" : "휴진·예외 등록"}
        </button>
      </div>

      <div role="tablist" aria-label="스케줄 종류" className="flex flex-wrap gap-1 border-b border-border">
        <TabButton active={tab === "schedules"} onClick={() => setTab("schedules")}>
          <CalendarClock className="size-4" aria-hidden /> 근무표
          <Count n={schedules.length} />
        </TabButton>
        <TabButton active={tab === "timeOffs"} onClick={() => setTab("timeOffs")}>
          <CalendarOff className="size-4" aria-hidden /> 휴진·예외
          <Count n={timeOffs.length} />
        </TabButton>
      </div>

      {/* 의사 목록 조회 실패 — 폼 의사 선택·이름 해석에 영향(부분 강등 안내). */}
      {doctorsError && (
        <p
          role="alert"
          className="rounded-md border border-status-cancelled/40 bg-status-cancelled/10 px-3 py-2 text-[12.5px] text-status-cancelled"
        >
          의사 목록을 불러오지 못했습니다: {doctorsError} · 새로고침 후 다시 시도해 주세요.
        </p>
      )}

      {/* 부분 강등: 활성 탭 조회가 실패했으면 그 탭만 에러로 강등(다른 탭은 정상). */}
      {loadErrors?.[tab] && (
        <p
          role="alert"
          className="rounded-md border border-status-cancelled/40 bg-status-cancelled/10 px-3 py-2 text-[12.5px] text-status-cancelled"
        >
          이 목록을 불러오지 못했습니다: {loadErrors[tab]} · 다른 탭은 정상 표시됩니다.
        </p>
      )}

      {tab === "schedules" && (
        <ScheduleTable
          schedules={schedules}
          doctors={doctors}
          departments={departments}
          rooms={rooms}
          pendingIds={pendingIds}
          onEdit={(s) => setSchedForm({ open: true, editing: s })}
          onToggleActive={onToggleSchedule}
        />
      )}
      {tab === "timeOffs" && (
        <TimeOffTable
          timeOffs={timeOffs}
          doctors={doctors}
          pendingIds={pendingIds}
          onEdit={(t) => setTimeOffForm({ open: true, editing: t })}
          onToggleActive={onToggleTimeOff}
          onShowAffected={(t) => void loadAffected(t, true)}
        />
      )}

      <DoctorScheduleForm
        open={schedForm.open}
        editing={schedForm.editing}
        doctors={doctors}
        departments={departments}
        rooms={rooms}
        onOpenChange={(open) => setSchedForm((s) => ({ ...s, open }))}
        onSaved={(s) => setSchedules((prev) => upsertSchedule(prev, s))}
      />
      <DoctorTimeOffForm
        open={timeOffForm.open}
        editing={timeOffForm.editing}
        doctors={doctors}
        onOpenChange={(open) => setTimeOffForm((s) => ({ ...s, open }))}
        onSaved={(t) => {
          setTimeOffs((prev) => upsertTimeOff(prev, t));
          // 활성 휴진 등록·수정 시 영향 예약이 있으면 재배정 패널을 띄운다(UX-DR15·AC2). 0건이면 조용히.
          if (t.is_active) void loadAffected(t, false);
        }}
      />

      {affected && (
        <AffectedAppointmentsPanel
          key={affectedKey}
          open
          onOpenChange={(open) => {
            if (!open) setAffected(null);
          }}
          doctorName={affected.doctorName}
          initial={affected.items}
        />
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? `${confirm.name} 비활성 처리 확인` : ""}
        description={
          confirm
            ? `'${confirm.name}'을(를) 비활성하면 예약 가능 슬롯·재배정 근거에서 제외됩니다. 과거 예약 참조는 그대로 유지됩니다. 진행하시겠습니까?`
            : ""
        }
        confirmLabel="비활성"
        onConfirm={() => {
          if (confirm) void applyActive(confirm.kind, confirm.id, confirm.name, false);
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[11px] font-normal tabular-nums text-muted-foreground">
      {n}
    </span>
  );
}

function ActiveBadge({ isActive }: { isActive: boolean }) {
  const meta = activeMeta(isActive);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[11px] font-bold",
        meta.badgeClass,
      )}
    >
      <span className="inline-block size-1.5 rounded-full bg-current" aria-hidden />
      {meta.label}
    </span>
  );
}

function RowActions({
  isActive,
  pending,
  onEdit,
  onToggleActive,
}: {
  isActive: boolean;
  pending: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
}) {
  return (
    <div className="flex gap-1.5">
      <button
        type="button"
        onClick={onEdit}
        disabled={pending}
        className="rounded-md border border-border bg-card px-2 py-1 text-[12px] text-foreground hover:bg-muted disabled:opacity-60"
      >
        수정
      </button>
      <button
        type="button"
        onClick={onToggleActive}
        disabled={pending}
        className="rounded-md border border-border bg-card px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted disabled:opacity-60"
      >
        {isActive ? "비활성" : "활성"}
      </button>
    </div>
  );
}

const TH = "border-b border-border px-4 py-2.5 text-left";
const TD = "border-b border-border px-4 py-2.5";

function TableShell({
  empty,
  children,
  emptyLabel,
}: {
  empty: boolean;
  children: React.ReactNode;
  emptyLabel: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      {empty ? (
        <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-[13px]">{children}</table>
        </div>
      )}
    </section>
  );
}

function ScheduleTable({
  schedules,
  doctors,
  departments,
  rooms,
  pendingIds,
  onEdit,
  onToggleActive,
}: {
  schedules: DoctorSchedule[];
  doctors: SchedulingDoctor[];
  departments: Department[];
  rooms: Room[];
  pendingIds: Set<string>;
  onEdit: (s: DoctorSchedule) => void;
  onToggleActive: (s: DoctorSchedule) => void;
}) {
  return (
    <TableShell
      empty={schedules.length === 0}
      emptyLabel="등록된 근무표가 없습니다. “근무표 추가”로 시작하세요."
    >
      <thead>
        <tr className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
          <th scope="col" className={TH}>의사</th>
          <th scope="col" className={TH}>진료과</th>
          <th scope="col" className={TH}>요일</th>
          <th scope="col" className={TH}>시간대</th>
          <th scope="col" className={TH}>진료실</th>
          <th scope="col" className={TH}>상태</th>
          <th scope="col" className={TH}>관리</th>
        </tr>
      </thead>
      <tbody>
        {schedules.map((s) => (
          <tr key={s.id} className="hover:bg-muted/50">
            <th scope="row" className={cn(TD, "text-left font-medium text-foreground")}>
              {doctorLabel(doctors, s.doctor_id)}
            </th>
            <td className={cn(TD, "text-muted-foreground")}>
              {departmentLabel(departments, s.department_id)}
            </td>
            <td className={cn(TD, "text-foreground")}>{weekdayLabel(s.weekday)}</td>
            <td className={cn(TD, "tabular-nums text-foreground")}>
              {formatTimeRange(s.start_time, s.end_time)}
            </td>
            <td className={cn(TD, "text-muted-foreground")}>{roomLabel(rooms, s.room_id)}</td>
            <td className={TD}>
              <ActiveBadge isActive={s.is_active} />
            </td>
            <td className={TD}>
              <RowActions
                isActive={s.is_active}
                pending={pendingIds.has(s.id)}
                onEdit={() => onEdit(s)}
                onToggleActive={() => onToggleActive(s)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function TimeOffTable({
  timeOffs,
  doctors,
  pendingIds,
  onEdit,
  onToggleActive,
  onShowAffected,
}: {
  timeOffs: DoctorTimeOff[];
  doctors: SchedulingDoctor[];
  pendingIds: Set<string>;
  onEdit: (t: DoctorTimeOff) => void;
  onToggleActive: (t: DoctorTimeOff) => void;
  onShowAffected: (t: DoctorTimeOff) => void;
}) {
  return (
    <TableShell
      empty={timeOffs.length === 0}
      emptyLabel="등록된 휴진·예외가 없습니다. “휴진·예외 등록”으로 시작하세요."
    >
      <thead>
        <tr className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
          <th scope="col" className={TH}>의사</th>
          <th scope="col" className={TH}>기간</th>
          <th scope="col" className={TH}>사유</th>
          <th scope="col" className={TH}>상태</th>
          <th scope="col" className={TH}>관리</th>
        </tr>
      </thead>
      <tbody>
        {timeOffs.map((t) => (
          <tr key={t.id} className="hover:bg-muted/50">
            <th scope="row" className={cn(TD, "text-left font-medium text-foreground")}>
              {doctorLabel(doctors, t.doctor_id)}
            </th>
            <td className={cn(TD, "tabular-nums text-foreground")}>
              {formatKstDateTime(t.start_at)} ~ {formatKstDateTime(t.end_at)}
            </td>
            <td className={cn(TD, "text-muted-foreground")}>
              {t.reason || <span className="text-muted-foreground/60">—</span>}
            </td>
            <td className={TD}>
              <ActiveBadge isActive={t.is_active} />
            </td>
            <td className={TD}>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onShowAffected(t)}
                  className="rounded-md border border-primary/45 bg-primary/8 px-2 py-1 text-[12px] text-foreground hover:bg-primary/15"
                >
                  영향 예약
                </button>
                <RowActions
                  isActive={t.is_active}
                  pending={pendingIds.has(t.id)}
                  onEdit={() => onEdit(t)}
                  onToggleActive={() => onToggleActive(t)}
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}
