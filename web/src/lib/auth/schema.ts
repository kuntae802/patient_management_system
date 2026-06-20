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
