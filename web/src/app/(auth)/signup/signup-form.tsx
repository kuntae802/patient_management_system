"use client";

import { useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { signupErrorMessage } from "@/lib/auth/errors";
import { type SignupInput, signupSchema } from "@/lib/auth/schema";
import { createClient } from "@/lib/supabase/client";

// 환자 자가가입 폼(Story 3.4) — RHF + Zod(클라 검증). supabase.auth.signUp 으로 계정 생성.
// enable_confirmations=false → 즉시 세션 → 본인인증·연결(/onboarding)로. 오류는 무PII 한국어.
export function SignupForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({ resolver: zodResolver(signupSchema) });

  async function onSubmit(values: SignupInput) {
    setFormError(null);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
    });
    if (error) {
      setFormError(signupErrorMessage(error));
      return;
    }
    // 즉시 세션(이메일 확인 비활성) → 본인 연결 단계로. 세션 미발급(확인 메일 활성 등)은 로그인 안내.
    if (!data.session) {
      setFormError("가입이 접수되었습니다. 로그인 후 본인 연결을 진행해 주세요.");
      return;
    }
    router.replace("/onboarding");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-[13px] font-medium text-foreground">
          이메일
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          aria-required
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? "email-error" : undefined}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          {...register("email")}
        />
        {errors.email && (
          <p id="email-error" className="text-[12px] text-status-cancelled">
            {errors.email.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-[13px] font-medium text-foreground">
          비밀번호
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          aria-required
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? "password-error" : "password-hint"}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          {...register("password")}
        />
        {errors.password ? (
          <p id="password-error" className="text-[12px] text-status-cancelled">
            {errors.password.message}
          </p>
        ) : (
          <p id="password-hint" className="text-[12px] text-muted-foreground">
            8자 이상, 영문 대·소문자와 숫자를 포함하세요.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="passwordConfirm" className="text-[13px] font-medium text-foreground">
          비밀번호 확인
        </label>
        <input
          id="passwordConfirm"
          type="password"
          autoComplete="new-password"
          aria-required
          aria-invalid={errors.passwordConfirm ? true : undefined}
          aria-describedby={errors.passwordConfirm ? "passwordConfirm-error" : undefined}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          {...register("passwordConfirm")}
        />
        {errors.passwordConfirm && (
          <p id="passwordConfirm-error" className="text-[12px] text-status-cancelled">
            {errors.passwordConfirm.message}
          </p>
        )}
      </div>

      {formError && (
        <p role="alert" className="text-[13px] text-status-cancelled">
          {formError}
        </p>
      )}

      <Button type="submit" disabled={isSubmitting} className="w-full">
        회원가입
      </Button>
    </form>
  );
}
