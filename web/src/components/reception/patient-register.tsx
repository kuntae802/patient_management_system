"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { apiFetch, ApiError } from "@/lib/api/client";
import {
  INSURANCE_TYPES,
  insuranceLabel,
  type Patient,
  type PatientCreateValues,
  patientCreateSchema,
  rrnChecksumOk,
  rrnHardError,
  sexLabel,
  toPatientCreatePayload,
} from "@/lib/reception/patients";
import { cn } from "@/lib/utils";

const FIELD =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";
const LABEL = "block text-[12px] font-medium text-foreground";

const EMPTY: PatientCreateValues = {
  resident_no: "",
  name: "",
  phone: "",
  address: "",
  email: "",
  insurance_type: "",
  insurance_no: "",
};

// 환자 등록(원무 직접 등록, FR-002). RHF + Zod(Pydantic 거울). 쓰기 = FastAPI(apiFetch, patient.create).
// 성공 시 chart_no + 마스킹 요약을 확인 표시(주민번호 reveal 없음 — 암호화·마스킹까지가 본 스토리).
export function PatientRegister() {
  const [created, setCreated] = useState<Patient | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<PatientCreateValues>({
    resolver: zodResolver(patientCreateSchema),
    defaultValues: EMPTY,
  });

  // SOFT 경고(체크섬) — HARD 통과 시에만, 비차단(2020 개편 대비). polite 라이브 리전으로 안내.
  // useWatch(구독형 훅)로 값 추적 — useForm().watch() 는 React Compiler 메모이즈 비호환(stale UI).
  const rrnValue = useWatch({ control, name: "resident_no" });
  const showChecksumWarning =
    !!rrnValue && rrnHardError(rrnValue) === null && !rrnChecksumOk(rrnValue);

  async function onSubmit(values: PatientCreateValues) {
    try {
      const patient = await apiFetch<Patient>("/v1/patients", {
        method: "POST",
        body: JSON.stringify(toPatientCreatePayload(values)),
      });
      setCreated(patient);
      reset(EMPTY);
      toast.success(`${patient.name} 환자가 등록되었습니다. (차트번호 ${patient.chart_no})`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "patient_exists") {
        // 동일 주민번호 중복 — 기존 차트번호로 안내(주민번호 원본은 노출하지 않는다).
        const chartNo = (err.detail as { chart_no?: string } | undefined)?.chart_no;
        setError("resident_no", {
          message: chartNo
            ? `이미 등록된 주민등록번호입니다. (기존 차트번호 ${chartNo})`
            : "이미 등록된 주민등록번호입니다.",
        });
        return;
      }
      if (err instanceof ApiError && err.code === "invalid_rrn") {
        setError("resident_no", { message: "주민등록번호가 올바르지 않습니다." });
        return;
      }
      const message =
        err instanceof ApiError ? err.message : "환자를 등록하지 못했습니다. 다시 시도해 주세요.";
      toast.error(message);
    }
  }

  if (created) {
    return (
      <section className="space-y-5">
        <header>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">환자 등록 완료</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            환자 레코드가 생성되고 차트번호가 부여되었습니다.
          </p>
        </header>

        <dl className="grid grid-cols-[120px_1fr] gap-y-2.5 rounded-xl border border-border bg-card p-5 text-[13px]">
          <dt className="text-muted-foreground">차트번호</dt>
          <dd className="font-semibold tabular-nums text-foreground">{created.chart_no}</dd>
          <dt className="text-muted-foreground">이름</dt>
          <dd className="text-foreground">{created.name}</dd>
          <dt className="text-muted-foreground">생년월일 · 성별</dt>
          <dd className="tabular-nums text-foreground">
            {created.birth_date} · {sexLabel(created.sex)}
          </dd>
          <dt className="text-muted-foreground">주민등록번호</dt>
          <dd className="tabular-nums text-foreground">{created.resident_no_masked}</dd>
          <dt className="text-muted-foreground">보험유형</dt>
          <dd className="text-foreground">{insuranceLabel(created.insurance_type)}</dd>
          {created.phone && (
            <>
              <dt className="text-muted-foreground">연락처</dt>
              <dd className="tabular-nums text-foreground">{created.phone}</dd>
            </>
          )}
        </dl>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCreated(null)}
            className="rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-white hover:bg-primary-hover"
          >
            새 환자 등록
          </button>
          {/* 임상 프로필(혈액형·알레르기 등) 입력 — 상세 풀페이지로 이동(Story 3.2). 전역 검색 진입은 3.5. */}
          <Link
            href={`/patients/${created.id}`}
            className="rounded-md border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground hover:bg-muted"
          >
            임상 프로필 입력 →
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <header>
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">환자 등록</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          앱을 사용하지 않는 환자(전화·방문·고령자)의 레코드를 직접 생성합니다.
        </p>
      </header>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
        <Field label="이름" required error={errors.name?.message}>
          <input
            {...register("name")}
            className={FIELD}
            aria-required
            aria-invalid={!!errors.name}
            placeholder="예: 홍길동"
          />
        </Field>

        <Field label="주민등록번호" required error={errors.resident_no?.message}>
          <input
            {...register("resident_no")}
            className={cn(FIELD, "tabular-nums")}
            aria-required
            aria-invalid={!!errors.resident_no}
            inputMode="numeric"
            autoComplete="off"
            placeholder="예: 900101-1234567"
          />
          {showChecksumWarning && (
            <span role="status" className="block text-[11.5px] text-status-received-ink">
              체크섬이 일치하지 않습니다. 2020년 이후 발급 번호일 수 있어 등록은 가능합니다.
            </span>
          )}
        </Field>

        <Field label="보험유형" required error={errors.insurance_type?.message}>
          <select
            {...register("insurance_type")}
            className={FIELD}
            aria-required
            aria-invalid={!!errors.insurance_type}
            defaultValue=""
          >
            <option value="" disabled>
              선택하세요
            </option>
            {INSURANCE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="보험번호 (선택)" error={errors.insurance_no?.message}>
          <input {...register("insurance_no")} className={FIELD} />
        </Field>

        <Field label="휴대전화 (선택)" error={errors.phone?.message}>
          <input
            {...register("phone")}
            className={cn(FIELD, "tabular-nums")}
            inputMode="tel"
            placeholder="예: 010-1234-5678"
          />
        </Field>

        <Field label="주소 (선택)" error={errors.address?.message}>
          <input {...register("address")} className={FIELD} />
        </Field>

        <Field label="이메일 (선택)" error={errors.email?.message}>
          <input {...register("email")} className={FIELD} inputMode="email" />
        </Field>

        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {isSubmitting ? "등록 중…" : "환자 등록"}
          </button>
        </div>
      </form>
    </section>
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
