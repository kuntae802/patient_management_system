"use server";

import { redirect } from "next/navigation";

import { LOGIN_PATH } from "@/lib/auth/branch";
import { createClient } from "@/lib/supabase/server";

// 로그아웃 — 세션 쿠키 제거 후 로그인 화면으로(AC5).
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(LOGIN_PATH);
}
