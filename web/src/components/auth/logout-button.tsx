"use client";

import { signOut } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

// 로그아웃 버튼 — 서버 액션(signOut) 폼 제출.
export function LogoutButton() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="outline">
        로그아웃
      </Button>
    </form>
  );
}
