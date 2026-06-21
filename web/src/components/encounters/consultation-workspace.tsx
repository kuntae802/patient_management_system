"use client";

import { CheckCircle2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { DiagnosisBlock } from "@/components/encounters/diagnosis-block";
import { SoapLedger } from "@/components/encounters/soap-ledger";
import { ApiError } from "@/lib/api/client";
import { clearActiveEncounter } from "@/lib/encounters/active-session";
import { completeEncounter } from "@/lib/encounters/diagnoses";
import type { Encounter } from "@/lib/reception/encounters";

// 진료 허브 중앙 작업영역(Story 4.7) — 진단 블록(SOAP 위) + SOAP ledger + 진료 완료 최소 액션.
// 주상병 미지정 완료(422) 게이트의 인라인/포커스 상태(primaryError)를 소유해 DiagnosisBlock 에 내려준다.
// ⚠️ 완료 후 수납·sticky flow stepper·신원 확인은 Epic 7(수납) — 여기선 되돌릴 수 없음 힌트 + 완료 트리거만.

export function ConsultationWorkspace({
  encounter,
  today,
}: {
  encounter: Encounter;
  today: string;
}) {
  const [primaryError, setPrimaryError] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(false);

  // 콜백 참조 안정화 — DiagnosisBlock 의 reload/load/effect 의존성 체인이 부모 리렌더마다
  // 재생성돼 진단 목록을 불필요하게 재조회하는 것을 방지(코드리뷰 patch).
  const handlePrimaryResolved = useCallback(() => setPrimaryError(false), []);

  async function handleComplete() {
    if (completing) return; // 이중 제출 방지(mutation 중 disable 의 1차선 보강)
    setCompleting(true);
    try {
      await completeEncounter(encounter.id);
      clearActiveEncounter(encounter.id); // 활성 내원 해제 — 다음 환자 준비
      setPrimaryError(false);
      setCompleted(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "primary_diagnosis_required") {
        // 주상병 미지정 → 진단 블록이 인라인 메시지 + 피커 포커스(UX-DR18). 토스트 없음(인라인이 안내).
        setPrimaryError(true);
      } else {
        toast.error(err instanceof ApiError ? err.message : "진료 완료에 실패했습니다.");
      }
    } finally {
      setCompleting(false);
    }
  }

  if (completed) {
    return (
      <section className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-10 text-center">
        <CheckCircle2 className="size-8 text-status-done" aria-hidden />
        <p className="text-[14px] font-semibold text-foreground">진료가 완료되었습니다</p>
        <p className="text-[12.5px] text-muted-foreground">수납·정산은 후속 단계에서 진행됩니다.</p>
        <a
          href="/doctor/waiting"
          className="mt-1 rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
        >
          진료 대기로
        </a>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 진단 블록(SOAP 위, UX-DR12) */}
      <DiagnosisBlock
        encounter={encounter}
        today={today}
        primaryError={primaryError}
        onPrimaryResolved={handlePrimaryResolved}
      />

      {/* SOAP ledger(Story 4.6) */}
      <SoapLedger encounter={encounter} />

      {/* 진료 완료 최소 액션 — 되돌릴 수 없음 힌트 + 주상병 게이트(422→진단 블록 인라인). Epic 7 이 수납 핸드오프. */}
      <div className="flex flex-wrap items-center justify-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <span className="text-[12px] text-muted-foreground">
          완료하면 진료가 종결됩니다(되돌릴 수 없음).
        </span>
        <button
          type="button"
          onClick={() => void handleComplete()}
          disabled={completing}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {completing ? "완료 중…" : "진료 완료"}
        </button>
      </div>
    </div>
  );
}
