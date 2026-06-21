"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Users } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { PermissionGate } from "@/components/auth/permission-gate";
import { apiFetch, ApiError } from "@/lib/api/client";
import {
  type Guardian,
  type GuardianValues,
  guardianSchema,
  RELATIONSHIP_PRESETS,
  toGuardianPayload,
  toGuardianValues,
} from "@/lib/reception/guardians";

const FIELD =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";
const LABEL = "block text-[12px] font-medium text-foreground";

// 보호자 섹션(Story 3.3) — 환자 상세 풀페이지에 거주. 읽기·쓰기 = FastAPI(apiFetch). 목록 + 추가/수정/
// 삭제(patient.update 게이트). 연락처는 평문 표시(환자 phone 동형, reveal 이월). 삭제는 확인 단계.
export function PatientGuardians({ patientId }: { patientId: string }) {
  const [guardians, setGuardians] = useState<Guardian[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Guardian | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 첫 setState 가 await 이후라 effect 내 동기 setState 가 아님(set-state-in-effect 회피, patient-detail 동형).
  const load = useCallback(async () => {
    try {
      const data = await apiFetch<Guardian[]>(`/v1/patients/${patientId}/guardians`);
      setGuardians(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "보호자 정보를 불러오지 못했습니다.");
    }
  }, [patientId]);

  useEffect(() => {
    // 마운트 시 FastAPI 보호자 목록 조회. load 의 setState 는 await 이후지만 린트가 정적 추적 →
    // 외부 시스템 동기화의 정당한 예외(patient-detail 동형)로 비활성.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function handleDelete() {
    // 재진입 가드(더블클릭 방지) + 대상 id 로컬 고정(클로저 stale 회피).
    if (!pendingDelete || deleting) return;
    const target = pendingDelete;
    setDeleting(true);
    try {
      await apiFetch(`/v1/patients/${patientId}/guardians/${target.id}`, {
        method: "DELETE",
      });
      setGuardians((prev) => prev?.filter((g) => g.id !== target.id) ?? null);
      toast.success("보호자가 삭제되었습니다.");
      setPendingDelete(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "보호자를 삭제하지 못했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-foreground">보호자</h2>
        {!adding && editingId === null && (
          <PermissionGate
            permission="patient.update"
            lockedLabel="보호자 추가"
            reason="보호자 정보 수정 권한이 없습니다."
          >
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted"
            >
              보호자 추가
            </button>
          </PermissionGate>
        )}
      </div>

      {adding && (
        <GuardianForm
          patientId={patientId}
          onSaved={(created) => {
            setGuardians((prev) => [...(prev ?? []), created]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {loadError && !guardians && (
        <div className="space-y-2">
          <p className="text-[13px] text-muted-foreground" role="status">
            {loadError}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground hover:bg-muted"
          >
            다시 시도
          </button>
        </div>
      )}

      {!loadError && !guardians && (
        <p className="text-[13px] text-muted-foreground" role="status" aria-live="polite">
          불러오는 중…
        </p>
      )}

      {guardians && guardians.length === 0 && !adding && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-4 py-2.5 text-[13px] text-muted-foreground">
          <Users className="size-4 shrink-0" aria-hidden />
          <span>등록된 보호자 없음</span>
        </div>
      )}

      {guardians && guardians.length > 0 && (
        <ul className="divide-y divide-border">
          {guardians.map((g) =>
            editingId === g.id ? (
              <li key={g.id} className="py-3">
                <GuardianForm
                  patientId={patientId}
                  guardian={g}
                  onSaved={(updated) => {
                    setGuardians(
                      (prev) => prev?.map((x) => (x.id === updated.id ? updated : x)) ?? null,
                    );
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li key={g.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{g.name}</span>
                  <span className="ml-2 text-muted-foreground">{g.relationship}</span>
                  <span className="ml-2 tabular-nums text-muted-foreground">
                    {g.phone || "연락처 없음"}
                  </span>
                </div>
                <PermissionGate
                  permission="patient.update"
                  lockedLabel="수정"
                  reason="보호자 정보 수정 권한이 없습니다."
                  className="shrink-0"
                >
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => setEditingId(g.id)}
                      className="rounded-md border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-foreground hover:bg-muted"
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(g)}
                      className="rounded-md border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-status-cancelled hover:bg-muted"
                    >
                      삭제
                    </button>
                  </span>
                </PermissionGate>
              </li>
            ),
          )}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `${pendingDelete.name} 보호자 삭제 확인` : ""}
        description="삭제하면 되돌릴 수 없습니다. 이 보호자 정보를 삭제하시겠습니까?"
        confirmLabel={deleting ? "삭제 중…" : "삭제"}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (!deleting) setPendingDelete(null);
        }}
      />
    </div>
  );
}

// 보호자 추가/수정 폼 — RHF + Zod(Pydantic 거울). 추가=POST, 수정=PUT(전체 교체). 쓰기 = FastAPI(patient.update).
function GuardianForm({
  patientId,
  guardian,
  onSaved,
  onCancel,
}: {
  patientId: string;
  guardian?: Guardian;
  onSaved: (saved: Guardian) => void;
  onCancel: () => void;
}) {
  // 추가 폼과 행 수정 폼이 동시에 렌더될 수 있으므로 datalist id 는 인스턴스별 고유(중복 id 회피).
  const relationshipsId = useId();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<GuardianValues>({
    resolver: zodResolver(guardianSchema),
    defaultValues: guardian
      ? toGuardianValues(guardian)
      : { name: "", relationship: "", phone: "" },
  });

  async function onSubmit(values: GuardianValues) {
    try {
      const body = JSON.stringify(toGuardianPayload(values));
      const saved = guardian
        ? await apiFetch<Guardian>(`/v1/patients/${patientId}/guardians/${guardian.id}`, {
            method: "PUT",
            body,
          })
        : await apiFetch<Guardian>(`/v1/patients/${patientId}/guardians`, {
            method: "POST",
            body,
          });
      onSaved(saved);
      toast.success(guardian ? "보호자 정보가 수정되었습니다." : "보호자가 추가되었습니다.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "보호자 정보를 저장하지 못했습니다.");
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-3 rounded-lg border border-border bg-muted/40 p-4"
      noValidate
    >
      <Field label="성명" error={errors.name?.message}>
        <input {...register("name")} className={FIELD} aria-invalid={!!errors.name} />
      </Field>

      <Field label="관계" error={errors.relationship?.message}>
        <input
          {...register("relationship")}
          list={relationshipsId}
          className={FIELD}
          aria-invalid={!!errors.relationship}
          placeholder="예: 배우자, 자녀"
        />
        <datalist id={relationshipsId}>
          {RELATIONSHIP_PRESETS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </Field>

      <Field label="연락처" error={errors.phone?.message}>
        <input
          {...register("phone")}
          className={`${FIELD} tabular-nums`}
          aria-invalid={!!errors.phone}
          placeholder="예: 010-1234-5678"
        />
      </Field>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-md border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground hover:bg-muted disabled:opacity-60"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {isSubmitting ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className={LABEL}>{label}</span>
      {children}
      {error && <span className="block text-[11.5px] text-status-cancelled">{error}</span>}
    </label>
  );
}
