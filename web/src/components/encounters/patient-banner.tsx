"use client";

import { Eye, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/encounters/status-badge";
import { ApiError } from "@/lib/api/client";
import { type Encounter, waitMinutes } from "@/lib/reception/encounters";
import {
  ageFromBirthDate,
  bloodTypeLabel,
  fetchPatient,
  insuranceLabel,
  maskPhone,
  type Patient,
  revealContact,
  revealRrn,
  sexLabel,
} from "@/lib/reception/patients";

// 진료 허브 상시 환자 배너(Story 4.5, FR-005 / UX-DR9·10·22) — 신원·민감정보 reveal·알레르기 can't-miss.
// 환자는 encounter.patient_id 로 GET /patients/{id} 로드(마스킹 + 임상 프로필 — RLS 본인행이라 서버 경유).
// RRN/연락처는 기본 마스킹, "표시"(눈 + "감사기록") 누르면 서버 reveal(권한 게이트 + 감사) → full 값 인라인.
// 🚫 full RRN/연락처는 로그·toast 미노출(화면 인라인 전용 — PII 경계).

export function PatientBanner({ encounter }: { encounter: Encounter }) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPatient(await fetchPatient(encounter.patient_id));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "환자 정보를 불러오지 못했습니다.");
    }
  }, [encounter.patient_id]);

  useEffect(() => {
    // load 의 setState 는 await 이후(patient-detail 동형 — 외부 시스템 동기화의 정당한 예외).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error && !patient) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
        {error}{" "}
        <button type="button" onClick={() => void load()} className="font-medium text-foreground underline">
          다시 시도
        </button>
      </div>
    );
  }

  if (!patient) {
    return (
      <div
        className="h-20 animate-pulse rounded-xl bg-muted"
        aria-busy="true"
        aria-label="환자 정보 불러오는 중"
      />
    );
  }

  const elapsed = waitMinutes(encounter.consult_started_at);
  const age = ageFromBirthDate(patient.birth_date);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="환자 배너">
      {/* 알레르기 can't-miss(누락 0, UX-DR10) — 있을 때만 상단 상시 노출. 음영 비의존·무-truncate. */}
      {patient.allergies && <AllergyAlert allergies={patient.allergies} />}

      {/* 신원 행 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-foreground">{patient.name}</h2>
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {age !== null ? `${sexLabel(patient.sex)} · 만 ${age}세` : sexLabel(patient.sex)} · {patient.birth_date}
        </span>
        <span className="text-[12.5px] text-muted-foreground">혈액형 {bloodTypeLabel(patient.blood_type)}</span>
        <span className="text-[12.5px] text-muted-foreground">{insuranceLabel(patient.insurance_type)}</span>
        <span className="text-[12.5px] text-muted-foreground tabular-nums">차트 {patient.chart_no}</span>
        <StatusBadge status={encounter.status} />
        {elapsed !== null && (
          <span className="text-[12.5px] text-muted-foreground tabular-nums">진료 {elapsed}분</span>
        )}
      </div>

      {/* 민감정보 행 — 기본 마스킹 + reveal(권한 게이트 + 감사) */}
      <dl className="grid grid-cols-[72px_1fr] items-center gap-x-3 gap-y-1.5 border-t border-border bg-muted/30 px-4 py-2.5 text-[12.5px]">
        <RevealField
          label="주민번호"
          masked={patient.resident_no_masked}
          revealName="주민등록번호"
          reveal={async () => {
            const raw = (await revealRrn(patient.id)).resident_no;
            return raw.length === 13 ? `${raw.slice(0, 6)}-${raw.slice(6)}` : raw;
          }}
        />
        <RevealField
          label="연락처"
          masked={maskPhone(patient.phone)}
          revealName="연락처"
          reveal={async () => (await revealContact(patient.id)).phone ?? "—"}
        />
      </dl>
    </section>
  );
}

// 알레르기 can't-miss 경고(UX-DR10) — role="alert"·assertive, 음영 비의존(채움+테두리+danger 글리프+굵은
// 라벨). 전체 텍스트 무-truncate(critical 은닉 금지). 약물 상호작용 경고는 Epic 5(5.5) — 여기선 알레르기만.
function AllergyAlert({ allergies }: { allergies: string }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-2.5 border-b border-destructive/30 bg-destructive/10 px-4 py-2.5"
    >
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-destructive text-white">
        <TriangleAlert className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-destructive">
          환자 안전 경고 · 알레르기
        </span>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] font-semibold text-foreground">
          {allergies}
        </p>
      </div>
    </div>
  );
}

// 민감정보 단일 필드 — 기본 마스킹 표시 + "표시"(눈 + "감사기록") reveal. reveal 시 full 값 인라인 +
// polite 라이브 리전 낭독. 버튼 접근가능명에 "조회 시 감사 로그 기록됨" 포함(UX-DR9·20). reveal 중 disable.
function RevealField({
  label,
  masked,
  revealName,
  reveal,
}: {
  label: string;
  masked: string;
  revealName: string;
  reveal: () => Promise<string>;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onReveal() {
    if (pending || value !== null) return;
    setPending(true);
    try {
      setValue(await reveal());
    } catch (err) {
      // 🚫 raw 값은 절대 미노출 — 봉투 message(한국어)만.
      toast.error(err instanceof ApiError ? err.message : `${label}를 표시하지 못했습니다.`);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2 text-foreground">
        <span className="tabular-nums" aria-live="polite">
          {value ?? masked}
        </span>
        {value === null && (
          <button
            type="button"
            onClick={() => void onReveal()}
            disabled={pending}
            aria-label={`${revealName} 표시 — 조회 시 감사 로그 기록됨`}
            className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-60"
          >
            <Eye className="size-3" aria-hidden />
            표시
            <span className="text-[8.5px] uppercase tracking-wide text-muted-foreground/80">감사기록</span>
          </button>
        )}
      </dd>
    </>
  );
}
