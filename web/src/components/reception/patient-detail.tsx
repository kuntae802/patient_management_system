"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { PermissionGate } from "@/components/auth/permission-gate";
import { apiFetch, ApiError } from "@/lib/api/client";
import {
  BLOOD_TYPES,
  bloodTypeLabel,
  type ClinicalProfileValues,
  clinicalProfileSchema,
  insuranceLabel,
  type Patient,
  sexLabel,
  toClinicalProfilePayload,
  toClinicalProfileValues,
} from "@/lib/reception/patients";
import { cn } from "@/lib/utils";

const FIELD =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";
const TEXTAREA =
  "min-h-[72px] w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";
const LABEL = "block text-[12px] font-medium text-foreground";

// 환자 상세(공유 풀페이지) — 마스킹 요약 + 임상 프로필 조회/갱신(Story 3.2). 읽기·쓰기 = FastAPI(apiFetch).
// 알레르기는 can't-miss(role="alert"·danger, 음영 비의존). 편집은 patient.update 게이트(PermissionGate).
export function PatientDetail({ patientId }: { patientId: string }) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // 첫 setState 가 await 이후라 effect 내 동기 setState 가 아님(set-state-in-effect 회피, staff-directory 동형).
  const load = useCallback(async () => {
    try {
      const data = await apiFetch<Patient>(`/v1/patients/${patientId}`);
      setPatient(data);
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setLoadError("환자를 찾을 수 없습니다.");
      } else {
        setLoadError(err instanceof ApiError ? err.message : "환자 정보를 불러오지 못했습니다.");
      }
    }
  }, [patientId]);

  useEffect(() => {
    // 마운트 시 FastAPI 상세 조회(환자 RLS 본인행 → 서버 직접조회 불가). load 의 setState 는 await
    // 이후지만 린트가 정적 추적 → 외부 시스템 동기화의 정당한 예외(staff-directory 동형)로 비활성.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (loadError && !patient) {
    return (
      <section className="space-y-4">
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
      </section>
    );
  }

  if (!patient) {
    return (
      <p className="text-[13px] text-muted-foreground" role="status" aria-live="polite">
        불러오는 중…
      </p>
    );
  }

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">
          {patient.name}
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          차트번호 <span className="tabular-nums">{patient.chart_no}</span> · 환자 상세
        </p>
      </header>

      {/* 알레르기 = can't-miss(누락 0). 안전 신호 최우선 → role="alert"·assertive. 음영 비의존(채움+테두리+굵은 라벨+아이콘). */}
      <AllergyBanner allergies={patient.allergies} />

      <PatientSummary patient={patient} />

      <div className="space-y-3 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-foreground">임상 프로필</h2>
          {!editing && (
            <PermissionGate
              permission="patient.update"
              lockedLabel="수정"
              reason="임상 프로필 수정 권한이 없습니다."
            >
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted"
              >
                수정
              </button>
            </PermissionGate>
          )}
        </div>

        {editing ? (
          <ClinicalProfileForm
            patient={patient}
            onSaved={(updated) => {
              setPatient(updated);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <ClinicalProfileView patient={patient} />
        )}
      </div>
    </section>
  );
}

// 알레르기 배너 — 있으면 danger can't-miss, 없으면 중립(색 단독 의존 금지: 아이콘+라벨 병행).
function AllergyBanner({ allergies }: { allergies: string | null }) {
  if (!allergies) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-4 py-2.5 text-[13px] text-muted-foreground">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        <span>알레르기 기록 없음</span>
      </div>
    );
  }
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-lg border border-destructive bg-destructive/10 px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded bg-destructive text-white">
          <TriangleAlert className="size-3.5" aria-hidden />
        </span>
        <span className="text-[13px] font-bold text-destructive">알레르기 주의</span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] font-medium text-foreground">
        {allergies}
      </p>
    </div>
  );
}

function PatientSummary({ patient }: { patient: Patient }) {
  return (
    <dl className="grid grid-cols-[120px_1fr] gap-y-2.5 rounded-xl border border-border bg-card p-5 text-[13px]">
      <dt className="text-muted-foreground">생년월일 · 성별</dt>
      <dd className="tabular-nums text-foreground">
        {patient.birth_date} · {sexLabel(patient.sex)}
      </dd>
      <dt className="text-muted-foreground">주민등록번호</dt>
      <dd className="tabular-nums text-foreground">{patient.resident_no_masked}</dd>
      <dt className="text-muted-foreground">보험유형</dt>
      <dd className="text-foreground">{insuranceLabel(patient.insurance_type)}</dd>
      {patient.phone && (
        <>
          <dt className="text-muted-foreground">연락처</dt>
          <dd className="tabular-nums text-foreground">{patient.phone}</dd>
        </>
      )}
      {patient.address && (
        <>
          <dt className="text-muted-foreground">주소</dt>
          <dd className="text-foreground">{patient.address}</dd>
        </>
      )}
    </dl>
  );
}

function ClinicalProfileView({ patient }: { patient: Patient }) {
  return (
    <dl className="grid grid-cols-[120px_1fr] gap-y-2.5 text-[13px]">
      <dt className="text-muted-foreground">혈액형</dt>
      <dd className="text-foreground">{bloodTypeLabel(patient.blood_type)}</dd>
      <ProfileRow label="기저질환" value={patient.chronic_diseases} />
      <ProfileRow label="복용약" value={patient.medications} />
      <ProfileRow label="특이사항" value={patient.notes} />
    </dl>
  );
}

function ProfileRow({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("whitespace-pre-wrap break-words", value ? "text-foreground" : "text-muted-foreground")}>
        {value || "기록 없음"}
      </dd>
    </>
  );
}

// 임상 프로필 편집 폼 — RHF + Zod(Pydantic 거울). 현재값 프리필 → PUT 전체 교체. 쓰기 = FastAPI(patient.update).
function ClinicalProfileForm({
  patient,
  onSaved,
  onCancel,
}: {
  patient: Patient;
  onSaved: (updated: Patient) => void;
  onCancel: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ClinicalProfileValues>({
    resolver: zodResolver(clinicalProfileSchema),
    defaultValues: toClinicalProfileValues(patient),
  });

  async function onSubmit(values: ClinicalProfileValues) {
    try {
      const updated = await apiFetch<Patient>(`/v1/patients/${patient.id}/clinical-profile`, {
        method: "PUT",
        body: JSON.stringify(toClinicalProfilePayload(values)),
      });
      onSaved(updated);
      toast.success("임상 프로필이 저장되었습니다.");
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "임상 프로필을 저장하지 못했습니다. 다시 시도해 주세요.";
      toast.error(message);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
      <Field label="혈액형" error={errors.blood_type?.message}>
        <select {...register("blood_type")} className={FIELD} aria-invalid={!!errors.blood_type}>
          <option value="">미확인</option>
          {BLOOD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>

      <Field label="알레르기" error={errors.allergies?.message}>
        <textarea
          {...register("allergies")}
          className={TEXTAREA}
          aria-invalid={!!errors.allergies}
          placeholder="예: 페니실린, 아스피린"
        />
      </Field>

      <Field label="기저질환" error={errors.chronic_diseases?.message}>
        <textarea
          {...register("chronic_diseases")}
          className={TEXTAREA}
          aria-invalid={!!errors.chronic_diseases}
          placeholder="예: 고혈압, 당뇨"
        />
      </Field>

      <Field label="복용약" error={errors.medications?.message}>
        <textarea
          {...register("medications")}
          className={TEXTAREA}
          aria-invalid={!!errors.medications}
          placeholder="예: 와파린 5mg"
        />
      </Field>

      <Field label="특이사항" error={errors.notes?.message}>
        <textarea {...register("notes")} className={TEXTAREA} aria-invalid={!!errors.notes} />
      </Field>

      <div className="mt-4 flex justify-end gap-2">
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
