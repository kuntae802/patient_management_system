"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";

// 디자인 시스템 프리뷰 전용: Toaster(sonner) 동작 검증용 트리거. 실제 토스트 호출은 후속 스토리.
export function ToastDemo() {
  return (
    <Button
      variant="outline"
      onClick={() => toast.success("저장되었습니다", { description: "방금 전" })}
    >
      토스트 미리보기
    </Button>
  );
}
