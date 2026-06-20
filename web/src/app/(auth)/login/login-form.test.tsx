import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithPassword = vi.fn();
const rpc = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword }, rpc }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

import { LoginForm } from "./login-form";

describe("LoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("빈/잘못된 입력 제출 시 검증 메시지 노출, signIn 미호출", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(await screen.findByText("이메일 형식이 올바르지 않습니다.")).toBeInTheDocument();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("자격증명 실패 시 무PII 범용 오류 노출(원문·이메일 비노출)", async () => {
    signInWithPassword.mockResolvedValue({
      error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" },
    });
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.type(screen.getByLabelText("이메일"), "staff@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "wrongpass");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("이메일 또는 비밀번호가 올바르지 않습니다.");
    expect(alert).not.toHaveTextContent("credentials");
    expect(replace).not.toHaveBeenCalled();
  });

  it("로그인 성공 시 역할 분기 라우팅(직원→/home)", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    rpc.mockResolvedValue({ data: "admin" });
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.type(screen.getByLabelText("이메일"), "admin@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "Password1");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/home"));
  });
});
