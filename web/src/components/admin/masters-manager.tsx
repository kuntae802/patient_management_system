"use client";

import { Building2, DoorClosed, Pill, Plus, Receipt, Stethoscope } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { DepartmentForm } from "@/components/admin/department-form";
import { DiagnosisForm } from "@/components/admin/diagnosis-form";
import { DrugForm } from "@/components/admin/drug-form";
import { FeeScheduleForm } from "@/components/admin/fee-schedule-form";
import { RoomForm } from "@/components/admin/room-form";
import { apiFetch, ApiError } from "@/lib/api/client";
import {
  activeMeta,
  CODE_STATUS_META,
  codeStatus,
  departmentLabel,
  formatKrw,
  todayISO,
  type Department,
  type Diagnosis,
  type Drug,
  type FeeSchedule,
  type MastersData,
  type Room,
} from "@/lib/admin/masters";
import { cn } from "@/lib/utils";

type Tab = "departments" | "rooms" | "diagnoses" | "feeSchedules" | "drugs";

// 비활성 확인 다이얼로그·상태 토글이 필요로 하는 최소 정보(전 마스터 공통: code·name·id).
type PendingConfirm = { kind: Tab; id: string; name: string; code: string };

// kind → /masters/<segment> URL 세그먼트(수가만 하이픈).
const RESOURCE: Record<Tab, string> = {
  departments: "departments",
  rooms: "rooms",
  diagnoses: "diagnoses",
  feeSchedules: "fee-schedules",
  drugs: "drugs",
};

const ADD_LABEL: Record<Tab, string> = {
  departments: "진료과 추가",
  rooms: "진료실 추가",
  diagnoses: "진단 추가",
  feeSchedules: "수가 추가",
  drugs: "약품 추가",
};

function sortByCode<T extends { code: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.code.localeCompare(b.code));
}

function upsert<T extends { id: string; code: string }>(rows: T[], saved: T): T[] {
  const exists = rows.some((r) => r.id === saved.id);
  return sortByCode(exists ? rows.map((r) => (r.id === saved.id ? saved : r)) : [...rows, saved]);
}

// 마스터 관리(관리자, FR-200·201·203). 읽기 = RSC Supabase 직접조회 주입(initial), 쓰기 = FastAPI(apiFetch,
// master.manage). 비활성(soft delete)은 확인 다이얼로그, 활성 복귀는 즉시. 변경은 0006·0007 자동 감사.
// 조직 마스터(진료과·진료실, 2.1) + 코드 마스터(진단·수가·약품 + 유효기간, 2.2)를 탭으로 통합.
// today 는 RSC 서버 주입(KST, DB 권위) — 코드 마스터 시점 배지와 2.3 검색 피커가 동일 today 를 공유해
// 자정 경계·비-KST 브라우저 불일치를 제거(2.2 이월 해소). 미주입 시 클라 todayISO() 폴백(하위호환).
export function MastersManager({ initial, today }: { initial: MastersData; today?: string }) {
  const serverToday = today ?? todayISO();
  const [tab, setTab] = useState<Tab>("departments");
  const [departments, setDepartments] = useState<Department[]>(sortByCode(initial.departments));
  const [rooms, setRooms] = useState<Room[]>(sortByCode(initial.rooms));
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>(sortByCode(initial.diagnoses));
  const [feeSchedules, setFeeSchedules] = useState<FeeSchedule[]>(sortByCode(initial.feeSchedules));
  const [drugs, setDrugs] = useState<Drug[]>(sortByCode(initial.drugs));

  const [deptForm, setDeptForm] = useState<{ open: boolean; editing: Department | null }>({
    open: false,
    editing: null,
  });
  const [roomForm, setRoomForm] = useState<{ open: boolean; editing: Room | null }>({
    open: false,
    editing: null,
  });
  const [dxForm, setDxForm] = useState<{ open: boolean; editing: Diagnosis | null }>({
    open: false,
    editing: null,
  });
  const [feeForm, setFeeForm] = useState<{ open: boolean; editing: FeeSchedule | null }>({
    open: false,
    editing: null,
  });
  const [drugForm, setDrugForm] = useState<{ open: boolean; editing: Drug | null }>({
    open: false,
    editing: null,
  });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);

  function openCreate() {
    if (tab === "departments") setDeptForm({ open: true, editing: null });
    else if (tab === "rooms") setRoomForm({ open: true, editing: null });
    else if (tab === "diagnoses") setDxForm({ open: true, editing: null });
    else if (tab === "feeSchedules") setFeeForm({ open: true, editing: null });
    else setDrugForm({ open: true, editing: null });
  }

  async function applyActive(kind: Tab, id: string, name: string, next: boolean) {
    setPendingId(id);
    try {
      const path = `/v1/masters/${RESOURCE[kind]}/${id}/active`;
      const body = JSON.stringify({ is_active: next });
      switch (kind) {
        case "departments": {
          const u = await apiFetch<Department>(path, { method: "PATCH", body });
          setDepartments((p) => p.map((d) => (d.id === id ? u : d)));
          break;
        }
        case "rooms": {
          const u = await apiFetch<Room>(path, { method: "PATCH", body });
          setRooms((p) => p.map((r) => (r.id === id ? u : r)));
          break;
        }
        case "diagnoses": {
          const u = await apiFetch<Diagnosis>(path, { method: "PATCH", body });
          setDiagnoses((p) => p.map((d) => (d.id === id ? u : d)));
          break;
        }
        case "feeSchedules": {
          const u = await apiFetch<FeeSchedule>(path, { method: "PATCH", body });
          setFeeSchedules((p) => p.map((f) => (f.id === id ? u : f)));
          break;
        }
        case "drugs": {
          const u = await apiFetch<Drug>(path, { method: "PATCH", body });
          setDrugs((p) => p.map((d) => (d.id === id ? u : d)));
          break;
        }
      }
      toast.success(`${name} · ${next ? "활성화" : "비활성화"}되었습니다.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "상태를 변경하지 못했습니다.");
    } finally {
      setPendingId(null);
    }
  }

  function onToggleActive(
    kind: Tab,
    item: { id: string; name: string; code: string; is_active: boolean },
  ) {
    if (item.is_active) {
      setConfirm({ kind, id: item.id, name: item.name, code: item.code });
    } else {
      void applyActive(kind, item.id, item.name, true);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">마스터</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            진료과·진료실 · 진단·수가·약품 관리 · 비활성/만료 시 신규 선택에서 제외(과거 기록은 보존) ·
            변경은 감사 로그에 기록됩니다
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-white hover:bg-primary-hover"
        >
          <Plus className="size-4" aria-hidden />
          {ADD_LABEL[tab]}
        </button>
      </div>

      {/* 탭 전환 */}
      <div role="tablist" aria-label="마스터 종류" className="flex flex-wrap gap-1 border-b border-border">
        <TabButton active={tab === "departments"} onClick={() => setTab("departments")}>
          <Building2 className="size-4" aria-hidden /> 진료과
          <Count n={departments.length} />
        </TabButton>
        <TabButton active={tab === "rooms"} onClick={() => setTab("rooms")}>
          <DoorClosed className="size-4" aria-hidden /> 진료실
          <Count n={rooms.length} />
        </TabButton>
        <TabButton active={tab === "diagnoses"} onClick={() => setTab("diagnoses")}>
          <Stethoscope className="size-4" aria-hidden /> 진단(KCD)
          <Count n={diagnoses.length} />
        </TabButton>
        <TabButton active={tab === "feeSchedules"} onClick={() => setTab("feeSchedules")}>
          <Receipt className="size-4" aria-hidden /> 수가(EDI)
          <Count n={feeSchedules.length} />
        </TabButton>
        <TabButton active={tab === "drugs"} onClick={() => setTab("drugs")}>
          <Pill className="size-4" aria-hidden /> 약품
          <Count n={drugs.length} />
        </TabButton>
      </div>

      {tab === "departments" && (
        <DepartmentTable
          departments={departments}
          pendingId={pendingId}
          onEdit={(d) => setDeptForm({ open: true, editing: d })}
          onToggleActive={(d) => onToggleActive("departments", d)}
        />
      )}
      {tab === "rooms" && (
        <RoomTable
          rooms={rooms}
          departments={departments}
          pendingId={pendingId}
          onEdit={(r) => setRoomForm({ open: true, editing: r })}
          onToggleActive={(r) => onToggleActive("rooms", r)}
        />
      )}
      {tab === "diagnoses" && (
        <DiagnosisTable
          diagnoses={diagnoses}
          pendingId={pendingId}
          today={serverToday}
          onEdit={(d) => setDxForm({ open: true, editing: d })}
          onToggleActive={(d) => onToggleActive("diagnoses", d)}
        />
      )}
      {tab === "feeSchedules" && (
        <FeeScheduleTable
          feeSchedules={feeSchedules}
          pendingId={pendingId}
          today={serverToday}
          onEdit={(f) => setFeeForm({ open: true, editing: f })}
          onToggleActive={(f) => onToggleActive("feeSchedules", f)}
        />
      )}
      {tab === "drugs" && (
        <DrugTable
          drugs={drugs}
          pendingId={pendingId}
          today={serverToday}
          onEdit={(d) => setDrugForm({ open: true, editing: d })}
          onToggleActive={(d) => onToggleActive("drugs", d)}
        />
      )}

      <DepartmentForm
        open={deptForm.open}
        editing={deptForm.editing}
        onOpenChange={(open) => setDeptForm((s) => ({ ...s, open }))}
        onSaved={(d) => setDepartments((prev) => upsert(prev, d))}
      />
      <RoomForm
        open={roomForm.open}
        editing={roomForm.editing}
        departments={departments}
        onOpenChange={(open) => setRoomForm((s) => ({ ...s, open }))}
        onSaved={(r) => setRooms((prev) => upsert(prev, r))}
      />
      <DiagnosisForm
        open={dxForm.open}
        editing={dxForm.editing}
        onOpenChange={(open) => setDxForm((s) => ({ ...s, open }))}
        onSaved={(d) => setDiagnoses((prev) => upsert(prev, d))}
      />
      <FeeScheduleForm
        open={feeForm.open}
        editing={feeForm.editing}
        onOpenChange={(open) => setFeeForm((s) => ({ ...s, open }))}
        onSaved={(f) => setFeeSchedules((prev) => upsert(prev, f))}
      />
      <DrugForm
        open={drugForm.open}
        editing={drugForm.editing}
        onOpenChange={(open) => setDrugForm((s) => ({ ...s, open }))}
        onSaved={(d) => setDrugs((prev) => upsert(prev, d))}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? `${confirm.name} 비활성 처리 확인` : ""}
        description={
          confirm
            ? `'${confirm.name}'(${confirm.code})을(를) 비활성하면 신규 선택에서 제외됩니다. 과거 기록의 참조는 그대로 유지됩니다. 진행하시겠습니까?`
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

// 코드 마스터 시점 상태 배지(유효/발효 전/만료/비활성) — 색+글리프+라벨 3중(음영 비의존, UX-DR20).
// today 는 서버 주입(DB 권위) — 피커의 "현재 유효" 필터와 동일 today 로 일관(2.2 이월 해소).
function CodeStatusBadge({
  row,
  today,
}: {
  row: { is_active: boolean; effective_from: string; effective_to: string | null };
  today: string;
}) {
  const meta = CODE_STATUS_META[codeStatus(row, today)];
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

function DateCell({ value }: { value: string | null }) {
  return value ? (
    <span className="tabular-nums">{value}</span>
  ) : (
    <span className="text-muted-foreground/60">—</span>
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

function DepartmentTable({
  departments,
  pendingId,
  onEdit,
  onToggleActive,
}: {
  departments: Department[];
  pendingId: string | null;
  onEdit: (d: Department) => void;
  onToggleActive: (d: Department) => void;
}) {
  return (
    <TableShell empty={departments.length === 0} emptyLabel="등록된 진료과가 없습니다. “진료과 추가”로 시작하세요.">
      <thead>
        <tr className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
          <th scope="col" className={TH}>코드</th>
          <th scope="col" className={TH}>이름</th>
          <th scope="col" className={TH}>설명</th>
          <th scope="col" className={TH}>상태</th>
          <th scope="col" className={TH}>관리</th>
        </tr>
      </thead>
      <tbody>
        {departments.map((d) => (
          <tr key={d.id} className="hover:bg-muted/50">
            <th scope="row" className={cn(TD, "text-left font-medium tabular-nums text-foreground")}>
              {d.code}
            </th>
            <td className={cn(TD, "text-foreground")}>{d.name}</td>
            <td className={cn(TD, "text-muted-foreground")}>
              {d.description || <span className="text-muted-foreground/60">—</span>}
            </td>
            <td className={TD}>
              <ActiveBadge isActive={d.is_active} />
            </td>
            <td className={TD}>
              <RowActions
                isActive={d.is_active}
                pending={pendingId === d.id}
                onEdit={() => onEdit(d)}
                onToggleActive={() => onToggleActive(d)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function RoomTable({
  rooms,
  departments,
  pendingId,
  onEdit,
  onToggleActive,
}: {
  rooms: Room[];
  departments: Department[];
  pendingId: string | null;
  onEdit: (r: Room) => void;
  onToggleActive: (r: Room) => void;
}) {
  return (
    <TableShell empty={rooms.length === 0} emptyLabel="등록된 진료실이 없습니다. “진료실 추가”로 시작하세요.">
      <thead>
        <tr className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
          <th scope="col" className={TH}>코드</th>
          <th scope="col" className={TH}>이름</th>
          <th scope="col" className={TH}>소속 진료과</th>
          <th scope="col" className={TH}>상태</th>
          <th scope="col" className={TH}>관리</th>
        </tr>
      </thead>
      <tbody>
        {rooms.map((r) => (
          <tr key={r.id} className="hover:bg-muted/50">
            <th scope="row" className={cn(TD, "text-left font-medium tabular-nums text-foreground")}>
              {r.code}
            </th>
            <td className={cn(TD, "text-foreground")}>{r.name}</td>
            <td className={cn(TD, "text-muted-foreground")}>
              {departmentLabel(departments, r.department_id)}
            </td>
            <td className={TD}>
              <ActiveBadge isActive={r.is_active} />
            </td>
            <td className={TD}>
              <RowActions
                isActive={r.is_active}
                pending={pendingId === r.id}
                onEdit={() => onEdit(r)}
                onToggleActive={() => onToggleActive(r)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function DiagnosisTable({
  diagnoses,
  pendingId,
  today,
  onEdit,
  onToggleActive,
}: {
  diagnoses: Diagnosis[];
  pendingId: string | null;
  today: string;
  onEdit: (d: Diagnosis) => void;
  onToggleActive: (d: Diagnosis) => void;
}) {
  return (
    <TableShell empty={diagnoses.length === 0} emptyLabel="등록된 진단(KCD)이 없습니다. “진단 추가”로 시작하세요.">
      <thead>
        <tr className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
          <th scope="col" className={TH}>코드</th>
          <th scope="col" className={TH}>이름</th>
          <th scope="col" className={TH}>발효일</th>
          <th scope="col" className={TH}>만료일</th>
          <th scope="col" className={TH}>상태</th>
          <th scope="col" className={TH}>관리</th>
        </tr>
      </thead>
      <tbody>
        {diagnoses.map((d) => (
          <tr key={d.id} className="hover:bg-muted/50">
            <th scope="row" className={cn(TD, "text-left font-medium tabular-nums text-foreground")}>
              {d.code}
            </th>
            <td className={cn(TD, "text-foreground")}>{d.name}</td>
            <td className={cn(TD, "text-muted-foreground")}>
              <DateCell value={d.effective_from} />
            </td>
            <td className={cn(TD, "text-muted-foreground")}>
              <DateCell value={d.effective_to} />
            </td>
            <td className={TD}>
              <CodeStatusBadge row={d} today={today} />
            </td>
            <td className={TD}>
              <RowActions
                isActive={d.is_active}
                pending={pendingId === d.id}
                onEdit={() => onEdit(d)}
                onToggleActive={() => onToggleActive(d)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function FeeScheduleTable({
  feeSchedules,
  pendingId,
  today,
  onEdit,
  onToggleActive,
}: {
  feeSchedules: FeeSchedule[];
  pendingId: string | null;
  today: string;
  onEdit: (f: FeeSchedule) => void;
  onToggleActive: (f: FeeSchedule) => void;
}) {
  return (
    <TableShell empty={feeSchedules.length === 0} emptyLabel="등록된 수가(EDI)가 없습니다. “수가 추가”로 시작하세요.">
      <thead>
        <tr className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
          <th scope="col" className={TH}>코드</th>
          <th scope="col" className={TH}>이름</th>
          <th scope="col" className={cn(TH, "text-right")}>금액(원)</th>
          <th scope="col" className={TH}>분류</th>
          <th scope="col" className={TH}>발효일</th>
          <th scope="col" className={TH}>만료일</th>
          <th scope="col" className={TH}>상태</th>
          <th scope="col" className={TH}>관리</th>
        </tr>
      </thead>
      <tbody>
        {feeSchedules.map((f) => (
          <tr key={f.id} className="hover:bg-muted/50">
            <th scope="row" className={cn(TD, "text-left font-medium tabular-nums text-foreground")}>
              {f.code}
            </th>
            <td className={cn(TD, "text-foreground")}>{f.name}</td>
            <td className={cn(TD, "text-right tabular-nums text-foreground")}>
              {formatKrw(f.amount_krw)}
            </td>
            <td className={cn(TD, "text-muted-foreground")}>
              {f.category || <span className="text-muted-foreground/60">—</span>}
            </td>
            <td className={cn(TD, "text-muted-foreground")}>
              <DateCell value={f.effective_from} />
            </td>
            <td className={cn(TD, "text-muted-foreground")}>
              <DateCell value={f.effective_to} />
            </td>
            <td className={TD}>
              <CodeStatusBadge row={f} today={today} />
            </td>
            <td className={TD}>
              <RowActions
                isActive={f.is_active}
                pending={pendingId === f.id}
                onEdit={() => onEdit(f)}
                onToggleActive={() => onToggleActive(f)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function DrugTable({
  drugs,
  pendingId,
  today,
  onEdit,
  onToggleActive,
}: {
  drugs: Drug[];
  pendingId: string | null;
  today: string;
  onEdit: (d: Drug) => void;
  onToggleActive: (d: Drug) => void;
}) {
  return (
    <TableShell empty={drugs.length === 0} emptyLabel="등록된 약품이 없습니다. “약품 추가”로 시작하세요.">
      <thead>
        <tr className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
          <th scope="col" className={TH}>코드</th>
          <th scope="col" className={TH}>이름</th>
          <th scope="col" className={TH}>주성분코드</th>
          <th scope="col" className={TH}>단위</th>
          <th scope="col" className={TH}>발효일</th>
          <th scope="col" className={TH}>만료일</th>
          <th scope="col" className={TH}>상태</th>
          <th scope="col" className={TH}>관리</th>
        </tr>
      </thead>
      <tbody>
        {drugs.map((d) => (
          <tr key={d.id} className="hover:bg-muted/50">
            <th scope="row" className={cn(TD, "text-left font-medium tabular-nums text-foreground")}>
              {d.code}
            </th>
            <td className={cn(TD, "text-foreground")}>{d.name}</td>
            <td className={cn(TD, "tabular-nums text-muted-foreground")}>
              {d.ingredient_code || <span className="text-muted-foreground/60">—</span>}
            </td>
            <td className={cn(TD, "text-muted-foreground")}>
              {d.unit || <span className="text-muted-foreground/60">—</span>}
            </td>
            <td className={cn(TD, "text-muted-foreground")}>
              <DateCell value={d.effective_from} />
            </td>
            <td className={cn(TD, "text-muted-foreground")}>
              <DateCell value={d.effective_to} />
            </td>
            <td className={TD}>
              <CodeStatusBadge row={d} today={today} />
            </td>
            <td className={TD}>
              <RowActions
                isActive={d.is_active}
                pending={pendingId === d.id}
                onEdit={() => onEdit(d)}
                onToggleActive={() => onToggleActive(d)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}
