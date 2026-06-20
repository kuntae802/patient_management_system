"use client";

import { useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { landingPathForRole } from "@/lib/auth/branch";
import { authErrorMessage } from "@/lib/auth/errors";
import { type LoginInput, loginSchema } from "@/lib/auth/schema";
import { createClient } from "@/lib/supabase/client";

// 로그인 폼 — RHF + Zod(클라 검증). 성공 시 auth_user_role()로 직원/환자 분기(§결정 D-1).
// 오류는 무PII 한국어 범용 메시지(AC3) — 원문 오류·이메일·토큰을 노출하지 않는다.
export function LoginForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginInput) {
    setFormError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });
    if (error) {
      setFormError(authErrorMessage(error));
      return;
    }
    const { data: role } = await supabase.rpc("auth_user_role");
    router.replace(landingPathForRole(role as string | null));
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
          autoComplete="current-password"
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? "password-error" : undefined}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          {...register("password")}
        />
        {errors.password && (
          <p id="password-error" className="text-[12px] text-status-cancelled">
            {errors.password.message}
          </p>
        )}
      </div>

      {formError && (
        <p role="alert" className="text-[13px] text-status-cancelled">
          {formError}
        </p>
      )}

      <Button type="submit" disabled={isSubmitting} className="w-full">
        로그인
      </Button>
    </form>
  );
}
