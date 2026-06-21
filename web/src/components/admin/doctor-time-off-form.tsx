"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog } from "@base-ui/react/dialog";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { apiFetch, ApiError } from "@/lib/api/client";
import {
  type DoctorTimeOff,
  type DoctorTimeOffCreateValues,
  type SchedulingDoctor,
  doctorTimeOffCreateSchema,
  isoToLocalInput,
  toTimeOffCreatePayload,
  toTimeOffUpdatePayload,
} from "@/lib/admin/schedule";
import { cn } from "@/lib/utils";

const FIELD =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";
const LABEL = "block text-[12px] font-medium text-foreground";

// 휴진·예외 생성/수정 폼(모달). RHF + Zod. 의사 select(수정 시 불변)·기간(datetime-local)·사유.
// ⚠️ 사유는 저민감 운영 사유(휴가·학회)만 — 임상/PII 자유텍스트 금지(0030 reason). 변경은 0030 자동 감사.
// editing 지정 시 수정(PATCH, 기간·사유만), 미지정 시 생성(POST).
export function DoctorTimeOffForm({
  open,
  onOpenChange,
  onSaved,
  doctors,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (timeOff: DoctorTimeOff) => void;
  doctors: SchedulingDoctor[];
  editing?: DoctorTimeOff | null;
}) {
  const values: DoctorTimeOffCreateValues = useMemo(
    () => ({
      doctor_id: editing?.doctor_id ?? "",
      start_at: editing ? isoToLocalInput(editing.start_at) : "",
      end_at: editing ? isoToLocalInput(editing.end_at) : "",
      reason: editing?.reason ?? "",
    }),
    [editing],
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DoctorTimeOffCreateValues>({
    resolver: zodResolver(doctorTimeOffCreateSchema),
    values,
  });

  const doctorOptions = useMemo(() => {
    if (editing?.doctor_id && !doctors.some((d) => d.id === editing.doctor_id)) {
      return [{ id: editing.doctor_id, name: "(현재 의사)", department_id: null }, ...doctors];
    }
    return doctors;
  }, [doctors, editing]);

  async function onSubmit(formValues: DoctorTimeOffCreateValues) {
    try {
      const saved = editing
        ? await apiFetch<DoctorTimeOff>(`/v1/scheduling/doctor-time-offs/${editing.id}`, {
            method: "PATCH",
            body: JSON.stringify(toTimeOffUpdatePayload(formValues)),
          })
        : await apiFetch<DoctorTimeOff>("/v1/scheduling/doctor-time-offs", {
            method: "POST",
            body: JSON.stringify(toTimeOffCreatePayload(formValues)),
          });
      onSaved(saved);
      toast.success(`휴진·예외가 ${editing ? "수정" : "등록"}되었습니다.`);
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "휴진을 저장하지 못했습니다. 다시 시도해 주세요.";
      toast.error(message);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/30" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-card p-5 outline-none">
          <Dialog.Title className="text-[15px] font-semibold text-foreground">
            {editing ? "휴진·예외 수정" : "휴진·예외 등록"}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[12.5px] text-muted-foreground">
            휴가·학회 등 휴진 기간을 등록합니다. 이 기간은 예약 가능 슬롯에서 제외됩니다.
          </Dialog.Description>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3" noValidate>
            <Field label="의사" required error={errors.doctor_id?.message}>
              <select
                {...register("doctor_id")}
                className={FIELD}
                disabled={!!editing}
                aria-required
                aria-invalid={!!errors.doctor_id}
              >
                <option value="">의사 선택</option>
                {doctorOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="시작 일시" required error={errors.start_at?.message}>
                <input
                  {...register("start_at")}
                  type="datetime-local"
                  className={FIELD}
                  aria-required
                  aria-invalid={!!errors.start_at}
                />
              </Field>
              <Field label="종료 일시" required error={errors.end_at?.message}>
                <input
                  {...register("end_at")}
                  type="datetime-local"
                  className={FIELD}
                  aria-required
                  aria-invalid={!!errors.end_at}
                />
              </Field>
            </div>

            <Field label="사유 (선택)" error={errors.reason?.message}>
              <input
                {...register("reason")}
                className={FIELD}
                placeholder="예: 학회 참석, 연차"
                aria-invalid={!!errors.reason}
              />
            </Field>

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
                {isSubmitting ? "저장 중…" : editing ? "수정" : "등록"}
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
