"use client";

import Link from "next/link";

import { DiagnosisBlock } from "@/components/encounters/diagnosis-block";
import { SoapLedger } from "@/components/encounters/soap-ledger";
import { clearActiveEncounter } from "@/lib/encounters/active-session";
import type { Encounter } from "@/lib/reception/encounters";

// 진료 허브 중앙 작업영역(Story 4.7 + 7.4 billing-completes) — 진단 블록(SOAP 위) + SOAP ledger.
// ⚠️ 진료 완료는 의사가 트리거하지 않는다(billing-completes 모델 · Finding #9): 내원은 in_progress 로
// 유지되고, 수납 finalize(원무)가 complete_encounter 를 호출해 완료한다. 주상병 미지정(PT422) 게이트도
// finalize 가 강제한다. 의사가 완료를 누르면 내원이 완료돼 수납 워크리스트에서 빠지고 정산이 막히므로
// (정산 누락), 완료 버튼을 두지 않는다. 의사는 진단·SOAP·오더 후 "진료 대기로" 복귀(활성 내원 해제).
export function ConsultationWorkspace({
  encounter,
  today,
}: {
  encounter: Encounter;
  today: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* 진단 블록(SOAP 위, UX-DR12). 주상병 게이트는 수납 finalize 가 강제 → 여기선 인라인 게이트 비활성. */}
      <DiagnosisBlock
        encounter={encounter}
        today={today}
        primaryError={false}
        onPrimaryResolved={() => {}}
      />

      {/* SOAP ledger(Story 4.6) */}
      <SoapLedger encounter={encounter} />

      {/* 진료 마무리 — 완료(complete_encounter)는 원무 수납 finalize 가 트리거(billing-completes 모델).
          의사는 활성 내원 해제 후 대기로 복귀. */}
      <div className="flex flex-wrap items-center justify-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <span className="text-[12px] text-muted-foreground">
          진단·기록·오더 후 수납·완료는 원무에서 진행됩니다.
        </span>
        <Link
          href="/doctor/waiting"
          onClick={() => clearActiveEncounter(encounter.id)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3.5 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
        >
          진료 대기로
        </Link>
      </div>
    </div>
  );
}
