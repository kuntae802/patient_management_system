"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog } from "@base-ui/react/dialog";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { apiFetch, ApiError } from "@/lib/api/client";
import {
  LICENSE_TYPE_OPTIONS,
  STAFF_ROLE_OPTIONS,
  staffCreateSchema,
  toCreatePayload,
  type StaffCreateValues,
  type StaffMember,
} from "@/lib/admin/staff";
import { cn } from "@/lib/utils";

const FIELD =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";
const LABEL = "block text-[12px] font-medium text-foreground";

const DEFAULTS: StaffCreateValues = {
  employee_no: "",
  name: "",
  email: "",
  password: "",
  role_code: "",
  license_no: "",
  license_type: "",
  phone: "",
  hire_date: "",
};

// 직원 계정 생성 폼(모달). RHF + Zod(Pydantic 거울). 쓰기 = FastAPI(apiFetch) — Auth 사용자 + users 프로필.
// 🚫 비밀번호는 제출 후 폼에서 제거(reset)하고 로그·toast·URL 에 노출하지 않는다.
export function StaffCreateForm({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (member: StaffMember) => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<StaffCreateValues>({
    resolver: zodResolver(staffCreateSchema),
    defaultValues: DEFAULTS,
  });

  function close() {
    reset(DEFAULTS); // 비밀번호 포함 폼 상태 비우기.
    onOpenChange(false);
  }

  async function onSubmit(values: StaffCreateValues) {
    try {
      const created = await apiFetch<StaffMember>("/v1/admin/users", {
        method: "POST",
        body: JSON.stringify(toCreatePayload(values)),
      });
      onCreated(created);
      toast.success(`${created.name} 계정이 생성되었습니다.`);
      close();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "계정을 생성하지 못했습니다. 다시 시도해 주세요.";
      // 중복은 해당 필드에 인라인 표기, 그 외는 토스트.
      if (err instanceof ApiError && err.code === "employee_no_taken") {
        setError("employee_no", { message });
      } else if (err instanceof ApiError && err.code === "email_taken") {
        setError("email", { message });
      } else {
        toast.error(message);
      }
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(true);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/30" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-card p-5 outline-none">
          <Dialog.Title className="text-[15px] font-semibold text-foreground">
            직원 계정 추가
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[12.5px] text-muted-foreground">
            Supabase 인증 계정과 직원 프로필이 함께 생성됩니다. 임시 비밀번호는 본인이 로그인 후 변경합니다.
          </Dialog.Description>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3" noValidate>
            <div className="grid grid-cols-2 gap-3">
              <Field label="사번" required error={errors.employee_no?.message}>
                <input
                  {...register("employee_no")}
                  className={FIELD}
                  aria-required
                  aria-invalid={!!errors.employee_no}
                />
              </Field>
              <Field label="이름" required error={errors.name?.message}>
                <input
                  {...register("name")}
                  className={FIELD}
                  aria-required
                  aria-invalid={!!errors.name}
                />
              </Field>
            </div>

            <Field label="이메일" required error={errors.email?.message}>
              <input
                {...register("email")}
                type="email"
                className={FIELD}
                aria-required
                aria-invalid={!!errors.email}
              />
            </Field>

            <Field label="임시 비밀번호" required error={errors.password?.message}>
              <input
                {...register("password")}
                type="password"
                autoComplete="new-password"
                className={FIELD}
                aria-required
                aria-invalid={!!errors.password}
              />
            </Field>

            <Field label="역할" required error={errors.role_code?.message}>
              <select
                {...register("role_code")}
                className={FIELD}
                aria-required
                aria-invalid={!!errors.role_code}
              >
                <option value="">역할 선택…</option>
                {STAFF_ROLE_OPTIONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="면허종류 (선택)" error={errors.license_type?.message}>
                <select {...register("license_type")} className={FIELD}>
                  <option value="">없음</option>
                  {LICENSE_TYPE_OPTIONS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="면허번호 (선택)" error={errors.license_no?.message}>
                <input {...register("license_no")} className={FIELD} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="전화 (선택)" error={errors.phone?.message}>
                <input {...register("phone")} type="tel" className={FIELD} />
              </Field>
              <Field label="입사일 (선택)" error={errors.hire_date?.message}>
                <input {...register("hire_date")} type="date" className={FIELD} />
              </Field>
            </div>

            <p className="text-[11.5px] text-muted-foreground">
              소속 진료과는 진료과 마스터 구축 후 배정합니다.
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-60"
              >
                {isSubmitting ? "생성 중…" : "계정 생성"}
              </button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className={LABEL}>
        {label}
        {required && <span className="ml-0.5 text-status-cancelled">*</span>}
      </span>
      {children}
      {error && <span className={cn("block text-[11.5px] text-status-cancelled")}>{error}</span>}
    </label>
  );
}
