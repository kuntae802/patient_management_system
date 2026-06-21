"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog } from "@base-ui/react/dialog";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { apiFetch, ApiError } from "@/lib/api/client";
import { type Department, type Room } from "@/lib/admin/masters";
import {
  type DoctorSchedule,
  type DoctorScheduleCreateValues,
  type SchedulingDoctor,
  WEEKDAY_LABELS,
  doctorScheduleCreateSchema,
  hhmm,
  toScheduleCreatePayload,
  toScheduleUpdatePayload,
} from "@/lib/admin/schedule";
import { cn } from "@/lib/utils";

const FIELD =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";
const LABEL = "block text-[12px] font-medium text-foreground";

// 근무표 생성/수정 폼(모달). RHF + Zod(Pydantic 거울). 의사·진료과·진료실 select + 요일·시각.
// 쓰기 = FastAPI(apiFetch, master.manage). 겹침(409 schedule_overlap)은 시작 시각 필드에 인라인 표시.
// editing 지정 시 수정(PATCH, 전 필드 교체), 미지정 시 생성(POST). 변경은 0030 자동 감사.
export function DoctorScheduleForm({
  open,
  onOpenChange,
  onSaved,
  doctors,
  departments,
  rooms,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (schedule: DoctorSchedule) => void;
  doctors: SchedulingDoctor[];
  departments: Department[];
  rooms: Room[];
  editing?: DoctorSchedule | null;
}) {
  const values: DoctorScheduleCreateValues = useMemo(
    () => ({
      doctor_id: editing?.doctor_id ?? "",
      department_id: editing?.department_id ?? "",
      room_id: editing?.room_id ?? "",
      weekday: editing ? String(editing.weekday) : "1",
      start_time: editing ? hhmm(editing.start_time) : "09:00",
      end_time: editing ? hhmm(editing.end_time) : "12:00",
    }),
    [editing],
  );

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DoctorScheduleCreateValues>({
    resolver: zodResolver(doctorScheduleCreateSchema),
    values,
  });

  // 의사: 재직 목록(활성). 수정 중인 근무표의 의사가 목록에 없으면(휴직 등) 이탈 강요 금지로 포함.
  const doctorOptions = useMemo(() => {
    if (editing?.doctor_id && !doctors.some((d) => d.id === editing.doctor_id)) {
      return [{ id: editing.doctor_id, name: "(현재 의사)", department_id: null }, ...doctors];
    }
    return doctors;
  }, [doctors, editing]);

  // 진료과·진료실: 활성만 노출하되 수정 중인 현 소속이 비활성이면 포함(room-form 정책 동형).
  const deptOptions = useMemo(
    () => activeWithCurrent(departments, editing?.department_id ?? null),
    [departments, editing],
  );
  const roomOptions = useMemo(
    () => activeWithCurrent(rooms, editing?.room_id ?? null),
    [rooms, editing],
  );

  async function onSubmit(formValues: DoctorScheduleCreateValues) {
    try {
      const saved = editing
        ? await apiFetch<DoctorSchedule>(`/v1/scheduling/doctor-schedules/${editing.id}`, {
            method: "PATCH",
            body: JSON.stringify(toScheduleUpdatePayload(formValues)),
          })
        : await apiFetch<DoctorSchedule>("/v1/scheduling/doctor-schedules", {
            method: "POST",
            body: JSON.stringify(toScheduleCreatePayload(formValues)),
          });
      onSaved(saved);
      toast.success(`근무표가 ${editing ? "수정" : "생성"}되었습니다.`);
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "근무표를 저장하지 못했습니다. 다시 시도해 주세요.";
      // 겹침(409) → 시작 시각 필드에 인라인 표시(시간대 충돌 → 시각 필드가 의미적 위치).
      if (err instanceof ApiError && err.code === "schedule_overlap") {
        setError("start_time", { message });
      } else {
        toast.error(message);
      }
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/30" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-card p-5 outline-none">
          <Dialog.Title className="text-[15px] font-semibold text-foreground">
            {editing ? "근무표 수정" : "근무표 추가"}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[12.5px] text-muted-foreground">
            의사의 요일·시간대·진료실을 등록합니다. 같은 의사·요일에 시간이 겹치면 저장되지 않습니다.
          </Dialog.Description>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3" noValidate>
            <Field label="의사" required error={errors.doctor_id?.message}>
              <select
                {...register("doctor_id")}
                className={FIELD}
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
              <Field label="진료과" required error={errors.department_id?.message}>
                <select
                  {...register("department_id")}
                  className={FIELD}
                  aria-required
                  aria-invalid={!!errors.department_id}
                >
                  <option value="">진료과 선택</option>
                  {deptOptions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.is_active ? "" : " (비활성)"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="진료실 (선택)" error={errors.room_id?.message}>
                <select {...register("room_id")} className={FIELD}>
                  <option value="">진료실 없음</option>
                  {roomOptions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.is_active ? "" : " (비활성)"}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="요일" required error={errors.weekday?.message}>
              <select
                {...register("weekday")}
                className={FIELD}
                aria-required
                aria-invalid={!!errors.weekday}
              >
                {WEEKDAY_LABELS.map((label, i) => (
                  <option key={i} value={i}>
                    {label}요일
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="시작 시각" required error={errors.start_time?.message}>
                <input
                  {...register("start_time")}
                  type="time"
                  step={300}
                  className={FIELD}
                  aria-required
                  aria-invalid={!!errors.start_time}
                />
              </Field>
              <Field label="종료 시각" required error={errors.end_time?.message}>
                <input
                  {...register("end_time")}
                  type="time"
                  step={300}
                  className={FIELD}
                  aria-required
                  aria-invalid={!!errors.end_time}
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

// 활성 항목 + (수정 중 현 소속이 비활성이면) 그 항목 포함 — 이탈 강요 금지(room-form 동형).
function activeWithCurrent<T extends { id: string; is_active: boolean }>(
  items: T[],
  currentId: string | null,
): T[] {
  const active = items.filter((i) => i.is_active);
  if (currentId && !active.some((i) => i.id === currentId)) {
    const current = items.find((i) => i.id === currentId);
    if (current) return [current, ...active];
  }
  return active;
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
