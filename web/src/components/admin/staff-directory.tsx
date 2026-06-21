"use client";

import { Plus, RefreshCw, UserCog } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { StaffCreateForm } from "@/components/admin/staff-create-form";
import { apiFetch, ApiError } from "@/lib/api/client";
import { departmentLabel, type Department } from "@/lib/admin/masters";
import {
  assignDepartment,
  EMPLOYMENT_STATUS_META,
  EMPLOYMENT_STATUS_ORDER,
  isBlockingStatus,
  roleLabel,
  type EmploymentStatus,
  type StaffMember,
} from "@/lib/admin/staff";
import { cn } from "@/lib/utils";

type PendingConfirm = { member: StaffMember; next: EmploymentStatus };

// 신규 배정 가능한 진료과(활성)만 노출하되, 현 소속이 비활성이면 이탈 강요 금지로 그 항목도 포함
// (room-form 정책 동형). "소속 없음"(null)은 옵션 value="" 로 표현.
function departmentOptions(departments: Department[], currentId: string | null): Department[] {
  const active = departments.filter((d) => d.is_active);
  if (currentId && !active.some((d) => d.id === currentId)) {
    const current = departments.find((d) => d.id === currentId);
    if (current) return [current, ...active];
  }
  return active;
}

// 직원 계정 관리(관리자). 목록·생성·재직상태 변경 = 모두 FastAPI 경유(users RLS 본인행 → 직접조회 불가).
// 재직상태 변경: 휴직/퇴사(접근·로그인 차단)는 확인 다이얼로그, 복귀(active)는 즉시. 변경은 0004 자동 감사.
export function StaffDirectory({ departments }: { departments: Department[] }) {
  const [members, setMembers] = useState<StaffMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  // per-id pending 집합(AC3) — 여러 행을 빠르게 토글해도 각 행이 독립적으로 disable/해제된다(단일
  // pendingId 가 늦은 finally 로 무관한 행을 조기 해제하던 경합 제거).
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);

  const startPending = useCallback((id: string) => {
    setPending((p) => new Set(p).add(id));
  }, []);
  const endPending = useCallback((id: string) => {
    setPending((p) => {
      const next = new Set(p);
      next.delete(id);
      return next;
    });
  }, []);

  // 첫 setState 가 await 이후라 effect 내 동기 setState 가 아님(set-state-in-effect 회피).
  const load = useCallback(async () => {
    try {
      const data = await apiFetch<StaffMember[]>("/v1/admin/users");
      setMembers(data);
      setLoadError(null);
    } catch (err) {
      setMembers([]);
      setLoadError(err instanceof ApiError ? err.message : "직원 목록을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    // 마운트 시 FastAPI 목록 조회(users RLS 본인행 → 서버 직접조회 불가, 클라 fetch 가 유일). load 의
    // setState 는 await 이후지만 린트가 정적으로 추적 → 외부 시스템 동기화의 정당한 예외로 비활성.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function applyStatus(member: StaffMember, next: EmploymentStatus) {
    startPending(member.id);
    try {
      const updated = await apiFetch<StaffMember>(
        `/v1/admin/users/${member.id}/employment-status`,
        { method: "PATCH", body: JSON.stringify({ employment_status: next }) },
      );
      setMembers((prev) => prev?.map((m) => (m.id === member.id ? updated : m)) ?? null);
      toast.success(`${member.name} · ${EMPLOYMENT_STATUS_META[next].label} 처리되었습니다.`);
    } catch (err) {
      // 실패 시 목록 상태는 그대로(서버 권위) — 자가-락아웃(409) 등은 봉투 메시지로 안내.
      toast.error(err instanceof ApiError ? err.message : "재직상태를 변경하지 못했습니다.");
    } finally {
      endPending(member.id);
    }
  }

  function onStatusSelect(member: StaffMember, next: EmploymentStatus) {
    if (next === member.employment_status) return;
    if (isBlockingStatus(next)) {
      setConfirm({ member, next }); // 휴직/퇴사 → 접근 차단 경고 확인.
      return;
    }
    void applyStatus(member, next); // 복귀(active)는 즉시.
  }

  // 소속 진료과 배정/변경/해제(Story 2.6, AC2) — FastAPI(user.manage). 비활성/미존재 → 422 토스트.
  async function applyDepartment(member: StaffMember, departmentId: string | null) {
    startPending(member.id);
    try {
      const updated = await assignDepartment(member.id, departmentId);
      setMembers((prev) => prev?.map((m) => (m.id === member.id ? updated : m)) ?? null);
      toast.success(`${member.name} · 소속 진료과가 변경되었습니다.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "소속 진료과를 변경하지 못했습니다.");
    } finally {
      endPending(member.id);
    }
  }

  function onDepartmentSelect(member: StaffMember, value: string) {
    const next = value || null; // "" = 소속 없음(null)
    if (next === member.department_id) return;
    void applyDepartment(member, next);
  }

  function onCreated(member: StaffMember) {
    setMembers((prev) => (prev ? [...prev, member].sort((a, b) => a.employee_no.localeCompare(b.employee_no)) : [member]));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">직원 계정</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            계정 생성 · 역할 · 재직상태 관리 · 변경은 감사 로그에 기록됩니다
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-white hover:bg-primary-hover"
        >
          <Plus className="size-4" aria-hidden />
          계정 추가
        </button>
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-foreground">
            <UserCog className="size-4 text-muted-foreground" aria-hidden />
            직원 목록
            {members && (
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-normal tabular-nums text-muted-foreground">
                {members.length}명
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            새로고침
          </button>
        </div>

        {members === null ? (
          <div className="space-y-2 p-4" aria-busy="true" aria-label="직원 목록 불러오는 중">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-[13px] text-muted-foreground">{loadError}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
            >
              다시 시도
            </button>
          </div>
        ) : members.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
            등록된 직원이 없습니다. “계정 추가”로 시작하세요.
          </p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="border-b border-border px-4 py-2.5 text-left">사번</th>
                  <th scope="col" className="border-b border-border px-4 py-2.5 text-left">이름</th>
                  <th scope="col" className="border-b border-border px-4 py-2.5 text-left">역할</th>
                  <th scope="col" className="border-b border-border px-4 py-2.5 text-left">소속 진료과</th>
                  <th scope="col" className="border-b border-border px-4 py-2.5 text-left">면허</th>
                  <th scope="col" className="border-b border-border px-4 py-2.5 text-left">재직상태</th>
                  <th scope="col" className="border-b border-border px-4 py-2.5 text-left">변경</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const meta = EMPLOYMENT_STATUS_META[m.employment_status];
                  const isPending = pending.has(m.id);
                  return (
                    <tr key={m.id} className="hover:bg-muted/50">
                      <th
                        scope="row"
                        className="border-b border-border px-4 py-2.5 text-left font-medium tabular-nums text-foreground"
                      >
                        {m.employee_no}
                      </th>
                      <td className="border-b border-border px-4 py-2.5 text-foreground">{m.name}</td>
                      <td className="border-b border-border px-4 py-2.5 text-muted-foreground">
                        {roleLabel(m.role_code)}
                      </td>
                      <td className="border-b border-border px-4 py-2.5">
                        <select
                          aria-label={`${m.name} 소속 진료과 변경 (현재 ${departmentLabel(departments, m.department_id)})`}
                          value={m.department_id ?? ""}
                          disabled={isPending}
                          onChange={(e) => onDepartmentSelect(m, e.target.value)}
                          className="h-8 rounded-md border border-border bg-card px-2 text-[12.5px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60"
                        >
                          <option value="">소속 없음</option>
                          {departmentOptions(departments, m.department_id).map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                              {d.is_active ? "" : " (비활성)"}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="border-b border-border px-4 py-2.5 text-muted-foreground">
                        {m.license_no ? (
                          <span>
                            {m.license_type === "doctor"
                              ? "의사 "
                              : m.license_type === "radiologist"
                                ? "방사선사 "
                                : ""}
                            {m.license_no}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="border-b border-border px-4 py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[11px] font-bold",
                            meta.badgeClass,
                          )}
                        >
                          <span className="inline-block size-1.5 rounded-full bg-current" aria-hidden />
                          {meta.label}
                        </span>
                      </td>
                      <td className="border-b border-border px-4 py-2.5">
                        <select
                          aria-label={`${m.name} 재직상태 변경`}
                          value={m.employment_status}
                          disabled={isPending}
                          onChange={(e) => onStatusSelect(m, e.target.value as EmploymentStatus)}
                          className="h-8 rounded-md border border-border bg-card px-2 text-[12.5px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60"
                        >
                          {EMPLOYMENT_STATUS_ORDER.map((s) => (
                            <option key={s} value={s}>
                              {EMPLOYMENT_STATUS_META[s].label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <StaffCreateForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={onCreated}
        departments={departments}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? `${EMPLOYMENT_STATUS_META[confirm.next].label} 처리 확인` : ""}
        description={
          confirm
            ? `'${confirm.member.name}'(${confirm.member.employee_no}) 직원을 ${EMPLOYMENT_STATUS_META[confirm.next].label} 처리하면 로그인과 시스템 접근이 차단됩니다. 진행하시겠습니까?`
            : ""
        }
        confirmLabel={confirm ? EMPLOYMENT_STATUS_META[confirm.next].label : ""}
        onConfirm={() => {
          if (confirm) void applyStatus(confirm.member, confirm.next);
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
