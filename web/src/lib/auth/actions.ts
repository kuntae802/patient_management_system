"use server";

import { redirect } from "next/navigation";

import { LOGIN_PATH } from "@/lib/auth/branch";
import { createClient } from "@/lib/supabase/server";

// 로그아웃 — 세션 쿠키 제거 후 로그인 화면으로(AC5).
// scope:'local' = Auth 서버 도달 실패와 무관하게 이 브라우저 세션 쿠키를 확실히 제거
// (서버 장애 시에도 "로그아웃했는데 세션 잔존" 방지 — 공용 PC 프라이버시).
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect(LOGIN_PATH);
}
