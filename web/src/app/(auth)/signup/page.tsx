import Link from "next/link";

import { SignupForm } from "./signup-form";

// 환자 자가가입 화면((auth) 영역 — AppShell 없음, 인증 전). Story 3.4.
// 가입 후 본인인증·연결(/onboarding)로 이동. 직원 계정은 관리자 생성(여기서 가입 불가).
export default function SignupPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-8">
        <div className="space-y-1 text-center">
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">
            환자 회원가입
          </h1>
          <p className="text-[13px] text-muted-foreground">
            가입 후 본인 확인으로 진료 기록과 연결됩니다
          </p>
        </div>
        <SignupForm />
        <p className="text-center text-[13px] text-muted-foreground">
          이미 계정이 있으신가요?{" "}
          <Link href="/login" className="font-medium text-primary hover:text-primary-hover">
            로그인
          </Link>
        </p>
      </div>
    </main>
  );
}
