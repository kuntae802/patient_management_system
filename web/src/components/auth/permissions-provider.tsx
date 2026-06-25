"use client";

import { createContext, useMemo } from "react";

export type StaffDepartment = { id: string; code: string; name: string };

export type PermissionsContextValue = {
  role: string | null;
  /** 권한 코드(`<resource>.<action>`) 보유 여부. O(1). */
  has: (code: string) => boolean;
  /** 현재 직원의 소속 진료과(의사 진료대기 본인 과 고정 등). 미배정 → null. optional(테스트 mock 호환·
   *  Provider 는 항상 null/값을 제공). */
  department?: StaffDepartment | null;
};

export const PermissionsContext = createContext<PermissionsContextValue | null>(null);

// 서버(레이아웃)에서 fetch 한 role·permissions 를 클라 트리에 제공.
// 권한은 세션 준-정적 → React Context 로 충분(TanStack Query 미사용; §Dev Notes 상태/Provider 결정).
// ⚠️ UI 노출 게이트일 뿐 보안 경계 아님 — 쓰기 권위=FastAPI(403), 행 권위=RLS.
export function PermissionsProvider({
  role,
  permissions,
  department = null,
  children,
}: {
  role: string | null;
  permissions: string[];
  department?: StaffDepartment | null;
  children: React.ReactNode;
}) {
  // permissions 는 (서버 레이아웃이) 매 렌더 새 배열을 넘기므로, 안정 키(정렬+join)로 memo 식별성을 확보한다
  // → 권한이 실제로 바뀔 때만 value 가 갱신돼 불필요한 consumer 재렌더를 막는다. department 도 id 키로 안정화.
  const permissionsKey = [...permissions].sort().join(",");
  const deptKey = department?.id ?? "";
  const value = useMemo<PermissionsContextValue>(() => {
    const set = new Set(permissionsKey ? permissionsKey.split(",") : []);
    return { role, has: (code: string) => set.has(code), department };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- department 는 deptKey(id)로 식별
  }, [role, permissionsKey, deptKey]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}
