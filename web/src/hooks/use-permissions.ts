"use client";

import { useContext } from "react";

import { PermissionsContext } from "@/components/auth/permissions-provider";

// 사이드바 노출 게이트·화면 내 액션 게이트가 소비하는 훅.
// Provider 밖 호출은 배선 실수 → 조용한 오작동 대신 즉시 에러로 드러낸다.
export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) {
    throw new Error("usePermissions 는 PermissionsProvider 내부에서만 사용할 수 있습니다");
  }
  return ctx;
}
