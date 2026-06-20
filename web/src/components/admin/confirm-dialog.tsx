"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";

// 민감 권한 토글 확인 다이얼로그(UX-DR16·19). base-ui AlertDialog = 포커스 트랩·복원·Esc 닫기 내장.
// 버튼 순서 [취소, 확인] → 기본 초기 포커스가 안전한 '취소'에 위치(파괴적 확인 버튼 아님).
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel(); // Esc·백드롭·취소 모두 닫힘 = 변경 안 함.
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-foreground/30" />
        <AlertDialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 outline-none">
          <AlertDialog.Title className="text-[15px] font-semibold text-foreground">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
            >
              취소
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover"
            >
              {confirmLabel}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
