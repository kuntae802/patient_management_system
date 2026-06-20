"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Lock } from "lucide-react";

import {
  ACTION_META,
  actorLabel,
  diffSnapshot,
  DIFF_KIND_META,
  formatAuditTime,
  maskSnapshotValue,
  targetTableLabel,
  type AuditLogEntry,
} from "@/lib/admin/audit";
import { cn } from "@/lib/utils";

// 감사 상세 — 변경 전/후 스냅샷의 **읽기전용 diff 뷰어**(UX-DR22). 편집·삭제 어포던스 없음(append-only).
// 스냅샷에 잠재된 민감 필드는 maskSnapshotValue 로 표시 단에서 차단(per-row reveal 없음).

/** 한 쪽(이전/이후) 셀 — 해당 쪽에 키가 없으면(추가/삭제) "—". 있으면 마스킹 적용 표시. */
function ValueCell({
  present,
  fieldKey,
  value,
}: {
  present: boolean;
  fieldKey: string;
  value: unknown;
}) {
  if (!present) return <span className="text-muted-foreground/50">—</span>;
  const { masked, display } = maskSnapshotValue(fieldKey, value);
  if (masked) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground" title="민감 정보(마스킹)">
        <Lock className="size-3" aria-hidden />
        {display}
      </span>
    );
  }
  return <span className="break-all text-foreground">{display}</span>;
}

export function AuditLogDetail({
  entry,
  onClose,
}: {
  entry: AuditLogEntry | null;
  onClose: () => void;
}) {
  const rows = entry ? diffSnapshot(entry.before_data, entry.after_data) : [];
  const action = entry ? ACTION_META[entry.action] : null;

  return (
    <Dialog.Root
      open={entry !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/30" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(680px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-card p-5 outline-none">
          <Dialog.Title className="text-[15px] font-semibold text-foreground">
            감사 상세 {action ? `· ${action.label}` : ""}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[12.5px] text-muted-foreground">
            읽기 전용 — 변경 전/후 스냅샷은 수정·삭제할 수 없습니다.
          </Dialog.Description>

          {entry && (
            <>
              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
                <dt className="text-muted-foreground">시각</dt>
                <dd className="tabular-nums text-foreground">{formatAuditTime(entry.created_at)}</dd>
                <dt className="text-muted-foreground">행위자</dt>
                <dd className="text-foreground">{actorLabel(entry)}</dd>
                <dt className="text-muted-foreground">대상</dt>
                <dd className="text-foreground">
                  {targetTableLabel(entry.target_table)}
                  {entry.target_id ? (
                    <span className="ml-1 tabular-nums text-muted-foreground">
                      #{entry.target_id}
                    </span>
                  ) : null}
                </dd>
              </dl>

              <div className="mt-4 overflow-hidden rounded-lg border border-border">
                <table className="w-full border-separate border-spacing-0 text-[12.5px]">
                  <caption className="sr-only">변경 전후 스냅샷 비교 (읽기 전용)</caption>
                  <thead>
                    <tr className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="border-b border-border px-3 py-2 text-left">필드</th>
                      <th scope="col" className="border-b border-border px-3 py-2 text-left">이전</th>
                      <th scope="col" className="border-b border-border px-3 py-2 text-left">이후</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-3 py-6 text-center text-muted-foreground"
                        >
                          표시할 스냅샷이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => {
                        const meta = DIFF_KIND_META[row.kind];
                        return (
                          <tr
                            key={row.key}
                            className={cn(row.kind === "unchanged" && "opacity-60")}
                          >
                            <th
                              scope="row"
                              className="border-b border-border px-3 py-2 text-left font-medium text-foreground"
                            >
                              <span
                                className={cn("mr-1.5 font-bold tabular-nums", meta.className)}
                                aria-label={meta.label}
                              >
                                {meta.glyph}
                              </span>
                              {row.key}
                            </th>
                            <td className="border-b border-border px-3 py-2 align-top">
                              <ValueCell
                                present={row.kind !== "added"}
                                fieldKey={row.key}
                                value={row.before}
                              />
                            </td>
                            <td className="border-b border-border px-3 py-2 align-top">
                              <ValueCell
                                present={row.kind !== "removed"}
                                fieldKey={row.key}
                                value={row.after}
                              />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
            >
              닫기
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
