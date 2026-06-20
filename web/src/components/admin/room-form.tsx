"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog } from "@base-ui/react/dialog";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { apiFetch, ApiError } from "@/lib/api/client";
import {
  type Department,
  type Room,
  type RoomCreateValues,
  roomCreateSchema,
  toRoomCreatePayload,
  toRoomUpdatePayload,
} from "@/lib/admin/masters";
import { cn } from "@/lib/utils";

const FIELD =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";
const LABEL = "block text-[12px] font-medium text-foreground";

// 진료실 생성/수정 폼(모달). RHF + Zod. 진료과 select(활성 진료과만; 선택사항). 쓰기 = FastAPI(master.manage).
// editing 지정 시 수정(PATCH, code 불변), 미지정 시 생성(POST). 변경은 0006 자동 감사.
export function RoomForm({
  open,
  onOpenChange,
  onSaved,
  departments,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (room: Room) => void;
  departments: Department[];
  editing?: Room | null;
}) {
  const values: RoomCreateValues = useMemo(
    () => ({
      code: editing?.code ?? "",
      name: editing?.name ?? "",
      department_id: editing?.department_id ?? "",
    }),
    [editing],
  );

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RoomCreateValues>({
    resolver: zodResolver(roomCreateSchema),
    values,
  });

  // 활성 진료과만 선택지로 노출(비활성은 신규 배정 대상 아님). 단, 수정 중인 진료실의 현 소속이
  // 비활성이라면 이탈을 강요하지 않게 그 항목도 포함(선택 유지).
  const options = useMemo(() => {
    const active = departments.filter((d) => d.is_active);
    if (editing?.department_id && !active.some((d) => d.id === editing.department_id)) {
      const current = departments.find((d) => d.id === editing.department_id);
      if (current) return [current, ...active];
    }
    return active;
  }, [departments, editing]);

  async function onSubmit(formValues: RoomCreateValues) {
    try {
      const saved = editing
        ? await apiFetch<Room>(`/v1/masters/rooms/${editing.id}`, {
            method: "PATCH",
            body: JSON.stringify(toRoomUpdatePayload(formValues)),
          })
        : await apiFetch<Room>("/v1/masters/rooms", {
            method: "POST",
            body: JSON.stringify(toRoomCreatePayload(formValues)),
          });
      onSaved(saved);
      toast.success(`${saved.name} 진료실이 ${editing ? "수정" : "생성"}되었습니다.`);
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "진료실을 저장하지 못했습니다. 다시 시도해 주세요.";
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
            {editing ? "진료실 수정" : "진료실 추가"}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[12.5px] text-muted-foreground">
            {editing
              ? "코드는 변경할 수 없습니다. 이름·소속 진료과를 수정합니다."
              : "대기열·근무표가 참조할 물리적 진료 공간을 등록합니다."}
          </Dialog.Description>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3" noValidate>
            <Field label="코드" required error={errors.code?.message}>
              <input
                {...register("code")}
                className={FIELD}
                disabled={!!editing}
                aria-required
                aria-invalid={!!errors.code}
                placeholder="예: R101"
              />
            </Field>
            <Field label="이름" required error={errors.name?.message}>
              <input
                {...register("name")}
                className={FIELD}
                aria-required
                aria-invalid={!!errors.name}
                placeholder="예: 1진료실"
              />
            </Field>
            <Field label="소속 진료과 (선택)" error={errors.department_id?.message}>
              <select {...register("department_id")} className={FIELD}>
                <option value="">소속 없음</option>
                {options.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.is_active ? "" : " (비활성)"}
                  </option>
                ))}
              </select>
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
