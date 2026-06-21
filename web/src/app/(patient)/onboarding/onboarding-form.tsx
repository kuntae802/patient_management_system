"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { apiFetch, ApiError } from "@/lib/api/client";
import {
  type PatientSelfSummary,
  type SelfLinkValues,
  selfLinkSchema,
  toSelfLinkPayload,
} from "@/lib/patient/self-link";
import { rrnChecksumOk, rrnHardError } from "@/lib/reception/patients";
import { cn } from "@/lib/utils";

const FIELD =
  "h-10 w-full rounded-md border border-border bg-card px-3 text-[14px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";
const LABEL = "block text-[13px] font-medium text-foreground";

const EMPTY: SelfLinkValues = { resident_no: "", name: "" };

// 자가가입 본인 연결(Story 3.4) — 본인인증 시뮬 + 주민번호·성명 입력 → POST /v1/patients/self-link.
// 연결/멱등 성공 → 포털로. 폴백(미존재·정보불일치·이미연결)은 화면 내 안내(색 비의존 aria).
export function OnboardingForm() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<SelfLinkValues>({ resolver: zodResolver(selfLinkSchema), defaultValues: EMPTY });

  // SOFT 경고(체크섬) — HARD 통과 시에만, 비차단(2020 개편 대비). polite 라이브 리전.
  const rrnValue = useWatch({ control, name: "resident_no" });
  const showChecksumWarning =
    !!rrnValue && rrnHardError(rrnValue) === null && !rrnChecksumOk(rrnValue);

  async function onSubmit(values: SelfLinkValues) {
    try {
      const summary = await apiFetch<PatientSelfSummary>("/v1/patients/self-link", {
        method: "POST",
        body: JSON.stringify(toSelfLinkPayload(values)),
      });
      toast.success(`${summary.name} 님, 진료 기록과 연결되었습니다.`);
      router.replace("/portal");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "invalid_rrn") {
          setError("resident_no", { message: "주민등록번호가 올바르지 않습니다." });
          return;
        }
        // 안전 폴백(404 no_patient_record·422 identity_mismatch·409 연결충돌) + 기타 ApiError —
        // 서버 봉투의 한국어 message 를 그대로 안내(코드별 메시지는 서버가 권위, 원본 PII 미포함).
        setError("root", { message: err.message });
        return;
      }
      setError("root", { message: "연결을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    }
  }

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">
          본인 확인
        </h1>
        <p className="text-[14px] text-muted-foreground">
          주민등록번호와 성명을 입력하시면 병원에 등록된 진료 기록과 안전하게 연결됩니다.
        </p>
      </header>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3">
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
            <span role="status" className="block text-[12px] text-status-received-ink">
              체크섬이 일치하지 않습니다. 2020년 이후 발급 번호일 수 있어 진행은 가능합니다.
            </span>
          )}
        </Field>

        {errors.root && (
          <p role="alert" className="flex items-start gap-1.5 text-[13px] text-status-cancelled">
            <span aria-hidden>⚠</span>
            <span>{errors.root.message}</span>
          </p>
        )}

        <div className="mt-5">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-primary px-4 py-2.5 text-[14px] font-medium text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {isSubmitting ? "연결 중…" : "본인 확인하고 연결하기"}
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
        {required && <span className="ml-0.5 text-status-cancelled">(필수)</span>}
      </span>
      {children}
      {error && <span className="block text-[12px] text-status-cancelled">{error}</span>}
    </label>
  );
}
