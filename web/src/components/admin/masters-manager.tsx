"use client";

import { Building2, DoorClosed, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { DepartmentForm } from "@/components/admin/department-form";
import { RoomForm } from "@/components/admin/room-form";
import { apiFetch, ApiError } from "@/lib/api/client";
import {
  activeMeta,
  departmentLabel,
  type Department,
  type MastersData,
  type Room,
} from "@/lib/admin/masters";
import { cn } from "@/lib/utils";

type Tab = "departments" | "rooms";
type PendingDeactivate =
  | { kind: "department"; item: Department }
  | { kind: "room"; item: Room };

function sortByCode<T extends { code: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.code.localeCompare(b.code));
}

function upsert<T extends { id: string; code: string }>(rows: T[], saved: T): T[] {
  const exists = rows.some((r) => r.id === saved.id);
  return sortByCode(exists ? rows.map((r) => (r.id === saved.id ? saved : r)) : [...rows, saved]);
}

// 진료과·진료실 마스터 관리(관리자, FR-200·203). 읽기 = RSC Supabase 직접조회 주입(initial), 쓰기 =
// FastAPI(apiFetch, master.manage). 비활성(soft delete)은 확인 다이얼로그, 활성 복귀는 즉시. 변경은 0006 자동 감사.
export function MastersManager({ initial }: { initial: MastersData }) {
  const [tab, setTab] = useState<Tab>("departments");
  const [departments, setDepartments] = useState<Department[]>(sortByCode(initial.departments));
  const [rooms, setRooms] = useState<Room[]>(sortByCode(initial.rooms));

  const [deptForm, setDeptForm] = useState<{ open: boolean; editing: Department | null }>({
    open: false,
    editing: null,
  });
  const [roomForm, setRoomForm] = useState<{ open: boolean; editing: Room | null }>({
    open: false,
    editing: null,
  });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingDeactivate | null>(null);

  async function applyActive(kind: Tab, id: string, name: string, next: boolean) {
    setPendingId(id);
    try {
      const path =
        kind === "departments"
          ? `/v1/masters/departments/${id}/active`
          : `/v1/masters/rooms/${id}/active`;
      const body = JSON.stringify({ is_active: next });
      if (kind === "departments") {
        const updated = await apiFetch<Department>(path, { method: "PATCH", body });
        setDepartments((prev) => prev.map((d) => (d.id === id ? updated : d)));
      } else {
        const updated = await apiFetch<Room>(path, { method: "PATCH", body });
        setRooms((prev) => prev.map((r) => (r.id === id ? updated : r)));
      }
      toast.success(`${name} · ${next ? "활성화" : "비활성화"}되었습니다.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "상태를 변경하지 못했습니다.");
    } finally {
      setPendingId(null);
    }
  }

  function onToggleActive(kind: Tab, item: Department | Room) {
    if (item.is_active) {
      // 비활성(신규 선택 제외) → 확인. 활성 복귀는 즉시.
      setConfirm({ kind: kind === "departments" ? "department" : "room", item } as PendingDeactivate);
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
            진료과·진료실 관리 · 비활성 시 신규 선택에서 제외(과거 기록은 보존) · 변경은 감사 로그에 기록됩니다
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            tab === "departments"
              ? setDeptForm({ open: true, editing: null })
              : setRoomForm({ open: true, editing: null })
          }
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-white hover:bg-primary-hover"
        >
          <Plus className="size-4" aria-hidden />
          {tab === "departments" ? "진료과 추가" : "진료실 추가"}
        </button>
      </div>

      {/* 탭 전환 */}
      <div role="tablist" aria-label="마스터 종류" className="flex gap-1 border-b border-border">
        <TabButton active={tab === "departments"} onClick={() => setTab("departments")}>
          <Building2 className="size-4" aria-hidden /> 진료과
          <Count n={departments.length} />
        </TabButton>
        <TabButton active={tab === "rooms"} onClick={() => setTab("rooms")}>
          <DoorClosed className="size-4" aria-hidden /> 진료실
          <Count n={rooms.length} />
        </TabButton>
      </div>

      {tab === "departments" ? (
        <DepartmentTable
          departments={departments}
          pendingId={pendingId}
          onEdit={(d) => setDeptForm({ open: true, editing: d })}
          onToggleActive={(d) => onToggleActive("departments", d)}
        />
      ) : (
        <RoomTable
          rooms={rooms}
          departments={departments}
          pendingId={pendingId}
          onEdit={(r) => setRoomForm({ open: true, editing: r })}
          onToggleActive={(r) => onToggleActive("rooms", r)}
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

      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? `${confirm.item.name} 비활성 처리 확인` : ""}
        description={
          confirm
            ? `'${confirm.item.name}'(${confirm.item.code})을(를) 비활성하면 신규 선택(예약·접수·근무표 등)에서 제외됩니다. 과거 기록의 참조는 그대로 유지됩니다. 진행하시겠습니까?`
            : ""
        }
        confirmLabel="비활성"
        onConfirm={() => {
          if (confirm) {
            void applyActive(
              confirm.kind === "department" ? "departments" : "rooms",
              confirm.item.id,
              confirm.item.name,
              false,
            );
          }
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
