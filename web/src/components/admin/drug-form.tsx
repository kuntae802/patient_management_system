"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog } from "@base-ui/react/dialog";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { apiFetch, ApiError } from "@/lib/api/client";
import {
  type Drug,
  type DrugCreateValues,
  drugCreateSchema,
  toDrugCreatePayload,
  toDrugUpdatePayload,
  todayISO,
} from "@/lib/admin/masters";
import { cn } from "@/lib/utils";

const FIELD =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";
const LABEL = "block text-[12px] font-medium text-foreground";

// 약품 생성/수정 폼(모달). RHF + Zod. 주성분코드·단위는 선택. 쓰기 = FastAPI(master.manage).
// editing 지정 시 수정(PATCH, code 불변), 미지정 시 생성(POST, 발효일 기본=오늘). 변경은 0007 자동 감사.
export function DrugForm({
  open,
  onOpenChange,
  onSaved,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (drug: Drug) => void;
  editing?: Drug | null;
}) {
  const values: DrugCreateValues = useMemo(
    () => ({
      code: editing?.code ?? "",
      name: editing?.name ?? "",
      ingredient_code: editing?.ingredient_code ?? "",
      unit: editing?.unit ?? "",
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
  } = useForm<DrugCreateValues>({
    resolver: zodResolver(drugCreateSchema),
    values,
  });

  async function onSubmit(formValues: DrugCreateValues) {
    try {
      const saved = editing
        ? await apiFetch<Drug>(`/v1/masters/drugs/${editing.id}`, {
            method: "PATCH",
            body: JSON.stringify(toDrugUpdatePayload(formValues)),
          })
        : await apiFetch<Drug>("/v1/masters/drugs", {
            method: "POST",
            body: JSON.stringify(toDrugCreatePayload(formValues)),
          });
      onSaved(saved);
      toast.success(`${saved.name} 약품이 ${editing ? "수정" : "생성"}되었습니다.`);
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "약품을 저장하지 못했습니다. 다시 시도해 주세요.";
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
            {editing ? "약품 수정" : "약품 추가"}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[12.5px] text-muted-foreground">
            {editing
              ? "코드는 변경할 수 없습니다. 명칭·주성분·단위·유효기간을 수정합니다."
              : "처방에서 선택할 약품 코드를 등록합니다."}
          </Dialog.Description>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3" noValidate>
            <Field label="코드" required error={errors.code?.message}>
              <input
                {...register("code")}
                className={FIELD}
                disabled={!!editing}
                aria-required
                aria-invalid={!!errors.code}
                placeholder="예: 642901230"
              />
            </Field>
            <Field label="이름" required error={errors.name?.message}>
              <input
                {...register("name")}
                className={FIELD}
                aria-required
                aria-invalid={!!errors.name}
                placeholder="예: 타이레놀정 500mg"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="주성분코드 (선택)" error={errors.ingredient_code?.message}>
                <input
                  {...register("ingredient_code")}
                  className={FIELD}
                  placeholder="예: 120901ATB"
                />
              </Field>
              <Field label="단위 (선택)" error={errors.unit?.message}>
                <input {...register("unit")} className={FIELD} placeholder="예: 정" />
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
