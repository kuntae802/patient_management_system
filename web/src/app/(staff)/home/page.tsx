import Link from "next/link";

import { LogoutButton } from "@/components/auth/logout-button";
import { PermissionGate } from "@/components/auth/permission-gate";
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
          로그인 · 세션 · 분리 프로필 분기가 동작합니다. 좌측 메뉴는 역할·권한에 따라 노출됩니다.
        </p>
      </div>

      {/* RBAC UI 게이트 데모(AC3): rbac.manage 권한이 없으면 잠금 표현(학습), 있으면 진입 버튼. */}
      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold text-foreground">접근 제어 예시</h2>
        <PermissionGate
          permission="rbac.manage"
          lockedLabel="권한 관리"
          reason="이 작업은 '권한 매트릭스 관리' 권한이 필요합니다 (관리자 전용)"
        >
          <Link
            href="/admin/permissions"
            className="inline-flex w-fit items-center gap-2 rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-white hover:bg-primary-hover"
          >
            권한 관리
          </Link>
        </PermissionGate>
      </section>

      <LogoutButton />
    </div>
  );
}
