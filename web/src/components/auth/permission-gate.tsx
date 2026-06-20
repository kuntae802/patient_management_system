"use client";

import { Lock } from "lucide-react";
import { useId } from "react";

import { usePermissions } from "@/hooks/use-permissions";
import { cn } from "@/lib/utils";

// 권한 밖 액션 잠금 표현(UX-DR8·18·20): aria-disabled + 잠금 글리프 + 한국어 사유(aria-describedby).
// ⚠️ disabled 속성이 아님 → 포커스 가능(스크린리더 낭독·키보드 도달 = 학습 유도).
//    색만/툴팁만 금지 → 잠금 아이콘 + 사유 텍스트(상시 가시) 중복 인코딩.
export function LockedAction({
  label,
  reason,
  className,
}: {
  label: string;
  reason: string;
  className?: string;
}) {
  const reasonId = useId();
  return (
    <span className={cn("inline-flex flex-col gap-1", className)}>
      <button
        type="button"
        aria-disabled="true"
        aria-describedby={reasonId}
        className="inline-flex w-fit cursor-not-allowed items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-[13px] text-muted-foreground"
      >
        <Lock className="size-4 shrink-0" aria-hidden />
        {label}
      </button>
      <span id={reasonId} className="text-[12px] text-muted-foreground">
        {reason}
      </span>
    </span>
  );
}

// 권한 보유 시 children(실제 액션), 미보유 시 LockedAction(잠금+사유)을 렌더한다.
// ⚠️ UI 게이트일 뿐 보안 경계 아님 — 우회해도 FastAPI(403)·RLS 가 최종 차단.
export function PermissionGate({
  permission,
  lockedLabel,
  reason,
  className,
  children,
}: {
  permission: string;
  lockedLabel: string;
  reason: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { has } = usePermissions();
  if (has(permission)) return <>{children}</>;
  return <LockedAction label={lockedLabel} reason={reason} className={className} />;
}
