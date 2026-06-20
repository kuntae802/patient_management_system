"use client";

import { Check, Lock, TriangleAlert, Zap } from "lucide-react";
import { Fragment, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { apiFetch, ApiError } from "@/lib/api/client";
import {
  ADMIN_ROLE,
  grantKey,
  resourceLabel,
  SENSITIVE_PERMISSIONS,
  type MatrixPermission,
  type MatrixRole,
  type PermissionMatrix,
} from "@/lib/auth/rbac-matrix";
import { cn } from "@/lib/utils";

type PendingConfirm = {
  role: MatrixRole;
  permission: MatrixPermission;
  next: boolean;
};

function nowHm(): string {
  return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

// 역할 × 권한 매트릭스(관리자). 읽기 데이터는 서버(RSC)가 주입, 토글 쓰기는 FastAPI(apiFetch).
// 즉시 적용(저장 버튼 없음) · 낙관적 갱신 + 실패 롤백 · 민감 권한은 확인 다이얼로그 경유 · 2D 화살표 키보드.
export function PermissionMatrix({ initial }: { initial: PermissionMatrix }) {
  const { roles, permissions } = initial;
  const [granted, setGranted] = useState<Set<string>>(() => new Set(initial.grants));
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [focusPos, setFocusPos] = useState<{ row: number; col: number }>({ row: 0, col: 0 });

  // 셀 ref(2D 격자, 키 `${row}:${col}`) — 화살표 키 이동 시 포커스 이전.
  const cellRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  // in-flight 키(동기 가드). pending 상태는 렌더 스냅샷이라 같은 tick 내 더블클릭(네이티브 dblclick)을
  // 못 막는다(둘 다 옛 스냅샷 통과). ref 는 즉시 반영되므로 동기적으로 이중 제출을 차단한다.
  const inFlight = useRef<Set<string>>(new Set());
  const rowCount = permissions.length;
  const colCount = roles.length;

  // 역할별 부여 권한 수(열 헤더 메타). admin 은 전권.
  const grantCountByRole = useMemo(() => {
    const counts = new Map<string, number>();
    for (const role of roles) {
      if (role.code === ADMIN_ROLE) {
        counts.set(role.code, permissions.length);
        continue;
      }
      let n = 0;
      for (const p of permissions) if (granted.has(grantKey(role.code, p.code))) n += 1;
      counts.set(role.code, n);
    }
    return counts;
  }, [roles, permissions, granted]);

  function setGrant(key: string, value: boolean) {
    setGranted((prev) => {
      const next = new Set(prev);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function setPendingKey(key: string, value: boolean) {
    setPending((prev) => {
      const next = new Set(prev);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function applyToggle(role: MatrixRole, permission: MatrixPermission, next: boolean) {
    const key = grantKey(role.code, permission.code);
    if (inFlight.current.has(key)) return; // 동기 이중 제출 가드(처치 중복방지 1차선과 동일 원칙).
    inFlight.current.add(key);

    setPendingKey(key, true);
    setGrant(key, next); // 낙관적 갱신.
    try {
      await apiFetch("/v1/admin/rbac/grants", {
        method: "PUT",
        body: JSON.stringify({
          role_code: role.code,
          permission_code: permission.code,
          granted: next,
        }),
      });
      setSavedAt(nowHm());
    } catch (err) {
      setGrant(key, !next); // 롤백.
      const message =
        err instanceof ApiError ? err.message : "변경을 적용하지 못했습니다. 다시 시도해 주세요.";
      toast.error(message);
    } finally {
      inFlight.current.delete(key);
      setPendingKey(key, false);
    }
  }

  function onCellActivate(role: MatrixRole, permission: MatrixPermission) {
    if (role.code === ADMIN_ROLE) return; // admin 열 고정(변경 불가).
    const key = grantKey(role.code, permission.code);
    const next = !granted.has(key);
    if (SENSITIVE_PERMISSIONS.has(permission.code)) {
      setConfirm({ role, permission, next }); // 민감 권한 → 확인 다이얼로그.
      return;
    }
    void applyToggle(role, permission, next);
  }

  function focusCell(row: number, col: number) {
    setFocusPos({ row, col });
    cellRefs.current.get(`${row}:${col}`)?.focus();
  }

  function onCellKeyDown(e: React.KeyboardEvent, row: number, col: number) {
    // 2D 화살표 roving(Tab 순회 금지). Enter/Space 는 네이티브 button click 이 활성화.
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        focusCell(Math.max(0, row - 1), col);
        break;
      case "ArrowDown":
        e.preventDefault();
        focusCell(Math.min(rowCount - 1, row + 1), col);
        break;
      case "ArrowLeft":
        e.preventDefault();
        focusCell(row, Math.max(0, col - 1));
        break;
      case "ArrowRight":
        e.preventDefault();
        focusCell(row, Math.min(colCount - 1, col + 1));
        break;
      case "Home":
        e.preventDefault();
        focusCell(row, 0);
        break;
      case "End":
        e.preventDefault();
        focusCell(row, colCount - 1);
        break;
    }
  }

  return (
    <div className="space-y-4">
      {/* 페이지 헤더 + autosave */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">권한 관리</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            역할별 기능 접근 권한 · 변경 즉시 적용
          </p>
        </div>
        <div
          className="flex items-center gap-2 text-[11.5px] text-muted-foreground"
          aria-live="polite"
        >
          {savedAt ? (
            <>
              <span className="inline-flex size-[15px] items-center justify-center rounded-full bg-status-done text-white">
                <Check className="size-3" aria-hidden />
              </span>
              <span className="font-medium text-foreground">변경사항 자동 저장됨</span>
              <span>· {savedAt}</span>
            </>
          ) : (
            <span>변경 시 자동 저장됩니다</span>
          )}
        </div>
      </div>

      {/* 즉시 적용 + 감사 안내 배너 */}
      <div className="flex items-center gap-3 rounded-lg border border-primary/25 bg-primary/5 px-4 py-2.5 text-[12.5px] text-foreground">
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-white">
          <Zap className="size-3.5" aria-hidden />
        </span>
        <span>
          <b className="font-semibold">변경은 즉시 적용되며 감사 로그에 기록됩니다.</b>{" "}
          <span className="text-muted-foreground">
            별도 저장 버튼 없이 체크 변경 시 곧바로 반영됩니다. 관리자 역할은 항상 전체 허용이라 변경할 수 없습니다.
          </span>
        </span>
      </div>

      {/* 범례 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex size-[18px] items-center justify-center rounded-[5px] border border-primary-hover bg-primary text-white">
            <Check className="size-3" aria-hidden />
          </span>
          <b className="font-medium text-foreground">허용</b>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex size-[18px] rounded-[5px] border border-border bg-card" />
          <b className="font-medium text-foreground">차단</b>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex size-[18px] items-center justify-center rounded-[5px] border border-primary-hover bg-primary/60 text-white">
            <Lock className="size-3" aria-hidden />
          </span>
          <b className="font-medium text-foreground">고정 (관리자)</b>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-[5px] border border-status-received/40 bg-status-received/15 px-1.5 py-0.5 text-[10px] font-bold text-status-received-ink">
            <TriangleAlert className="size-3" aria-hidden />
            민감
          </span>
          <span>주의가 필요한 권한</span>
        </span>
      </div>

      {/* 매트릭스 */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-foreground">
            역할 × 권한 매트릭스
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-normal tabular-nums text-muted-foreground">
              {permissions.length}개 권한 · {roles.length}개 역할
            </span>
          </span>
        </div>

        <div className="max-h-[560px] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 top-0 z-40 w-[280px] border-b border-r border-border bg-background px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground"
                >
                  권한
                </th>
                {roles.map((role) => {
                  const isAdmin = role.code === ADMIN_ROLE;
                  return (
                    <th
                      scope="col"
                      key={role.code}
                      className={cn(
                        "sticky top-0 z-30 border-b border-border bg-background px-1.5 py-2.5 align-bottom",
                        isAdmin && "border-l border-l-primary/25 bg-primary/[0.08]",
                      )}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <span
                          className={cn(
                            "whitespace-nowrap text-[12.5px] font-semibold text-foreground",
                            isAdmin && "text-primary",
                          )}
                        >
                          {role.name}
                        </span>
                        {isAdmin ? (
                          <span className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/15 px-1.5 text-[9px] font-bold text-primary">
                            <Lock className="size-2.5" aria-hidden />전체
                          </span>
                        ) : (
                          <span className="text-[10px] tabular-nums text-muted-foreground">
                            {grantCountByRole.get(role.code) ?? 0}개
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {permissions.map((permission, rowIndex) => {
                const prev = permissions[rowIndex - 1];
                const isNewGroup = !prev || prev.resource !== permission.resource;
                const groupCount = permissions.filter(
                  (p) => p.resource === permission.resource,
                ).length;
                const isSensitive = SENSITIVE_PERMISSIONS.has(permission.code);
                return (
                  <Fragment key={permission.code}>
                    {isNewGroup && (
                      <tr>
                        <td
                          colSpan={roles.length + 1}
                          className="sticky left-0 z-10 border-b border-border bg-muted px-4 py-1.5"
                        >
                          <span className="inline-flex items-center gap-2">
                            <span className="inline-block h-3.5 w-1.5 rounded-sm bg-primary/80" />
                            <span className="text-[11.5px] font-bold tracking-wide text-foreground">
                              {resourceLabel(permission.resource)}
                            </span>
                            <span className="rounded-full border border-border bg-card px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                              {groupCount}
                            </span>
                          </span>
                        </td>
                      </tr>
                    )}
                    <tr className="group">
                      <th
                        scope="row"
                        className={cn(
                          "sticky left-0 z-10 h-[42px] border-b border-r border-border bg-card px-4 text-left font-normal group-hover:bg-muted",
                          isSensitive && "shadow-[inset_3px_0_0_var(--color-status-received)]",
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-foreground">
                            {permission.name}
                          </span>
                          {isSensitive && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-[5px] border border-status-received/40 bg-status-received/15 px-1.5 py-0.5 text-[10px] font-bold text-status-received-ink">
                              <TriangleAlert className="size-3" aria-hidden />
                              민감
                            </span>
                          )}
                        </span>
                      </th>
                      {roles.map((role, col) => {
                        const isAdmin = role.code === ADMIN_ROLE;
                        const key = grantKey(role.code, permission.code);
                        const isGranted = isAdmin || granted.has(key);
                        const isPending = pending.has(key);
                        const stateLabel = isAdmin
                          ? "고정 · 변경 불가"
                          : isGranted
                            ? "허용"
                            : "차단";
                        return (
                          <td
                            key={role.code}
                            className={cn(
                              "h-[42px] border-b border-border p-1.5 text-center group-hover:bg-muted",
                              isAdmin && "border-l border-l-primary/20 bg-primary/[0.06]",
                            )}
                          >
                            <button
                              type="button"
                              ref={(el) => {
                                cellRefs.current.set(`${rowIndex}:${col}`, el);
                              }}
                              tabIndex={focusPos.row === rowIndex && focusPos.col === col ? 0 : -1}
                              aria-label={`${role.name} — ${permission.name} — ${stateLabel}`}
                              aria-pressed={isAdmin ? undefined : isGranted}
                              aria-disabled={isAdmin || isPending ? true : undefined}
                              onFocus={() => setFocusPos({ row: rowIndex, col })}
                              onKeyDown={(e) => onCellKeyDown(e, rowIndex, col)}
                              onClick={() => onCellActivate(role, permission)}
                              className={cn(
                                "inline-flex size-[22px] items-center justify-center rounded-md border-[1.5px] leading-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                                isAdmin
                                  ? "cursor-not-allowed border-primary-hover bg-primary/60 text-white"
                                  : isGranted
                                    ? "border-primary-hover bg-primary text-white hover:bg-primary-hover"
                                    : "border-[#c4d2d2] bg-card hover:border-ring",
                                isPending && "opacity-60",
                              )}
                            >
                              {isAdmin ? (
                                <Lock className="size-3" aria-hidden />
                              ) : isGranted ? (
                                <Check className="size-3.5" aria-hidden />
                              ) : null}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2 border-t border-border bg-background px-4 py-2.5 text-[11.5px] text-muted-foreground">
          체크 변경은 <b className="font-semibold text-foreground">즉시 적용</b>되며 누가·언제·무엇을
          바꿨는지 <b className="font-semibold text-foreground">감사 로그에 자동 기록</b>됩니다.
        </div>
      </section>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.next ? "권한 부여 확인" : "권한 회수 확인"}
        description={
          confirm
            ? `'${confirm.permission.name}' 권한을 '${confirm.role.name}'에 ${
                confirm.next ? "부여" : "회수"
              }하시겠습니까? 이 변경은 즉시 적용되며 감사 로그에 기록됩니다.`
            : ""
        }
        confirmLabel={confirm?.next ? "부여" : "회수"}
        onConfirm={() => {
          if (confirm) void applyToggle(confirm.role, confirm.permission, confirm.next);
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
