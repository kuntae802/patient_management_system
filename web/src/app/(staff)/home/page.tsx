import { LogoutButton } from "@/components/auth/logout-button";
import { createClient } from "@/lib/supabase/server";

// 직원 랜딩 placeholder. 역할별 화면(reception/doctor/nurse/radiology/admin)은 Epic 4+가 채운다.
export default async function StaffHomePage() {
  const supabase = await createClient();
  const { data: role } = await supabase.rpc("auth_user_role");

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">
          환영합니다{role ? ` · ${role as string}` : ""}
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          로그인 · 세션 · 분리 프로필 분기가 동작합니다. 역할별 화면은 이후 에픽에서 채워집니다.
        </p>
      </div>
      <LogoutButton />
    </div>
  );
}
