import { z } from "zod";

// 로그인 폼 검증(클라 1차선 — 서버 Pydantic·DB가 권위). Zod 4: 이메일은 top-level z.email().
export const loginSchema = z.object({
  // 트림 후 이메일 검증(공백 붙은 붙여넣기·자동완성 대응 — .email() 전에 .trim()).
  email: z
    .string()
    .trim()
    .pipe(z.email({ error: "이메일 형식이 올바르지 않습니다." })),
  password: z.string().min(1, { error: "비밀번호를 입력해 주세요." }),
});

export type LoginInput = z.infer<typeof loginSchema>;

// 환자 자가가입 폼 검증(Story 3.4, 클라 1차선 — supabase Auth·config 정책이 권위).
// 비밀번호 정책 = config.toml `minimum_password_length=8` + `lower_upper_letters_digits` 의 거울.
export const signupSchema = z
  .object({
    email: z
      .string()
      .trim()
      .pipe(z.email({ error: "이메일 형식이 올바르지 않습니다." })),
    password: z
      .string()
      .min(8, { error: "비밀번호는 8자 이상이어야 합니다." })
      .regex(/[a-z]/, { error: "소문자를 포함해야 합니다." })
      .regex(/[A-Z]/, { error: "대문자를 포함해야 합니다." })
      .regex(/\d/, { error: "숫자를 포함해야 합니다." }),
    passwordConfirm: z.string().min(1, { error: "비밀번호를 다시 입력해 주세요." }),
  })
  .refine((v) => v.password === v.passwordConfirm, {
    error: "비밀번호가 일치하지 않습니다.",
    path: ["passwordConfirm"],
  });

export type SignupInput = z.infer<typeof signupSchema>;
