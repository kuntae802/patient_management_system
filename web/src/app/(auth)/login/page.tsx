import Link from "next/link";

import { LoginForm } from "./login-form";

// 로그인 화면((auth) 영역 — AppShell 없음, 인증 전). 디자인 토큰·Pretendard는 루트 레이아웃 상속.
export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-8">
        <div className="space-y-1 text-center">
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">
            환자 관리 시스템
          </h1>
          <p className="text-[13px] text-muted-foreground">계정으로 로그인하세요</p>
        </div>
        <LoginForm />
        {/* 환자 자가가입(Story 3.4) — 직원은 관리자 생성이므로 이 링크는 환자용. */}
        <p className="text-center text-[13px] text-muted-foreground">
          처음 오셨나요?{" "}
          <Link href="/signup" className="font-medium text-primary hover:text-primary-hover">
            환자 회원가입
          </Link>
        </p>
      </div>
    </main>
  );
}
