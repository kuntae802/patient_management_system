"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog } from "@base-ui/react/dialog";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { apiFetch, ApiError } from "@/lib/api/client";
import {
  type FeeSchedule,
  type FeeScheduleCreateValues,
  feeScheduleCreateSchema,
  toFeeScheduleCreatePayload,
  toFeeScheduleUpdatePayload,
  todayISO,
} from "@/lib/admin/masters";
import { cn } from "@/lib/utils";

const FIELD =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";
const LABEL = "block text-[12px] font-medium text-foreground";

// EDI 수가 생성/수정 폼(모달). RHF + Zod. 금액=KRW 정수(소수 없음). 쓰기 = FastAPI(master.manage).
// editing 지정 시 수정(PATCH, code 불변), 미지정 시 생성(POST, 발효일 기본=오늘). 변경은 0007 자동 감사.
export function FeeScheduleForm({
  open,
  onOpenChange,
  onSaved,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (fee: FeeSchedule) => void;
  editing?: FeeSchedule | null;
}) {
  const values: FeeScheduleCreateValues = useMemo(
    () => ({
      code: editing?.code ?? "",
      name: editing?.name ?? "",
      amount_krw: editing ? String(editing.amount_krw) : "",
      category: editing?.category ?? "",
      effective_from: editing?.effective_from ?? todayISO(),
      effective_to: editing?.effective_to ?? "",
    }),
    [editing],
  );

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FeeScheduleCreateValues>({
    resolver: zodResolver(feeScheduleCreateSchema),
    values,
  });

  async function onSubmit(formValues: FeeScheduleCreateValues) {
    try {
      const saved = editing
        ? await apiFetch<FeeSchedule>(`/v1/masters/fee-schedules/${editing.id}`, {
            method: "PATCH",
            body: JSON.stringify(toFeeScheduleUpdatePayload(formValues)),
          })
        : await apiFetch<FeeSchedule>("/v1/masters/fee-schedules", {
            method: "POST",
            body: JSON.stringify(toFeeScheduleCreatePayload(formValues)),
          });
      onSaved(saved);
      toast.success(`${saved.name} 수가가 ${editing ? "수정" : "생성"}되었습니다.`);
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "수가를 저장하지 못했습니다. 다시 시도해 주세요.";
      if (err instanceof ApiError && err.code === "code_taken") {
        setError("code", { message });
      } else {
        toast.error(message);
      }
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/30" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-card p-5 outline-none">
          <Dialog.Title className="text-[15px] font-semibold text-foreground">
            {editing ? "수가 수정" : "수가 추가"}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[12.5px] text-muted-foreground">
            {editing
              ? "코드는 변경할 수 없습니다. 명칭·금액·분류·유효기간을 수정합니다."
              : "정산에서 산정할 EDI 행위 수가 코드를 등록합니다."}
          </Dialog.Description>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3" noValidate>
            <Field label="코드 (EDI)" required error={errors.code?.message}>
              <input
                {...register("code")}
                className={FIELD}
                disabled={!!editing}
                aria-required
                aria-invalid={!!errors.code}
                placeholder="예: AA157"
              />
            </Field>
            <Field label="이름" required error={errors.name?.message}>
              <input
                {...register("name")}
                className={FIELD}
                aria-required
                aria-invalid={!!errors.name}
                placeholder="예: 재진 진찰료"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="금액 (원)" required error={errors.amount_krw?.message}>
                <input
                  {...register("amount_krw")}
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  className={cn(FIELD, "tabular-nums")}
                  aria-required
                  aria-invalid={!!errors.amount_krw}
                  placeholder="예: 12000"
                />
              </Field>
              <Field label="분류 (선택)" error={errors.category?.message}>
                <input {...register("category")} className={FIELD} placeholder="예: 진찰료" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="발효일" required error={errors.effective_from?.message}>
                <input
                  {...register("effective_from")}
                  type="date"
                  className={FIELD}
                  aria-required
                  aria-invalid={!!errors.effective_from}
                />
              </Field>
              <Field label="만료일 (선택)" error={errors.effective_to?.message}>
                <input
                  {...register("effective_to")}
                  type="date"
                  className={FIELD}
                  aria-invalid={!!errors.effective_to}
                />
              </Field>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-60"
              >
                {isSubmitting ? "저장 중…" : editing ? "수정" : "생성"}
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
