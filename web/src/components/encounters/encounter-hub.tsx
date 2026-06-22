"use client";

import { AlertTriangle, ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ConsultationWorkspace } from "@/components/encounters/consultation-workspace";
import { PatientBanner } from "@/components/encounters/patient-banner";
import { PatientContextPanel } from "@/components/encounters/patient-context-panel";
import { PrescriptionPanel } from "@/components/encounters/prescription-panel";
import { StatusBadge } from "@/components/encounters/status-badge";
import { useActiveEncounter } from "@/hooks/use-active-encounter";
import { ApiError } from "@/lib/api/client";
import {
  type Encounter,
  ENCOUNTER_STATUS_META,
  fetchEncounter,
} from "@/lib/reception/encounters";

// 진료 허브 셸(Story 4.4) + 환자 배너·좌 컨텍스트(Story 4.5). 진찰 시작(start_consult) 후 진입.
// 세션당 활성 내원 1개 가드(UX-DR21⑨). 상시 환자 배너(신원·민감정보 reveal·알레르기 can't-miss)는
// 3-pane 위에, 좌 컨텍스트(임상 프로필·과거 이력·활력)는 좌 pane. 중앙 SOAP(4.6)·우 오더(Epic5)는
// placeholder 유지(은폐 아닌 명시). 헤더는 encounter_no·status·시작시각(환자명 PII 는 배너가 다룸).

function timeHmKST(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

export function EncounterHub({ encounterId, today }: { encounterId: string; today: string }) {
  const [encounter, setEncounter] = useState<Encounter | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const enc = await fetchEncounter(encounterId);
      setEncounter(enc);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "진료 정보를 불러오지 못했습니다.");
    }
  }, [encounterId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load 의 setState 는 await 이후(비동기)
    void load();
  }, [load]);

  // 세션당 활성 내원 1개 가드(UX-DR21⑨). id 기준 점유, encounter_no 는 표시용(로드 전 빈 문자열).
  const { conflict, superseded, active, takeOver } = useActiveEncounter(
    encounterId,
    encounter?.encounter_no ?? "",
  );

  return (
    <div className="space-y-4">
      {/* 헤더 — 대기로 복귀 + 내원 식별 */}
      <div className="flex flex-wrap items-center gap-3">
        <a
          href="/doctor/waiting"
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[12.5px] text-muted-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          진료 대기
        </a>
        {encounter && (
          <>
            <h1 className="text-[18px] font-semibold tracking-[-0.02em] text-foreground tabular-nums">
              내원 {encounter.encounter_no}
            </h1>
            <StatusBadge status={encounter.status} />
            <span className="text-[12.5px] text-muted-foreground">
              진료 시작 {timeHmKST(encounter.consult_started_at)}
            </span>
          </>
        )}
      </div>

      {/* 세션 가드 배너 — 다른 내원이 활성(conflict) / 다른 탭이 가져감(superseded) */}
      {superseded ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-status-cancelled/40 bg-status-cancelled/10 px-4 py-2.5 text-[12.5px] text-status-cancelled"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span className="font-medium">이 진료는 다른 탭에서 활성화되어 보류되었습니다.</span>
          <span className="text-muted-foreground">
            잘못된 환자에 작업이 새는 것을 막기 위해 한 세션에 진료 1개만 활성화됩니다.
          </span>
          <button
            type="button"
            onClick={takeOver}
            className="ml-auto rounded-md border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-foreground hover:bg-muted"
          >
            이 진료 다시 활성화
          </button>
        </div>
      ) : conflict ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-status-received/40 bg-status-received/10 px-4 py-2.5 text-[12.5px] text-status-received-ink">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span className="font-medium">
            다른 진료가 이미 열려 있습니다{active ? ` (내원 ${active.encounter_no})` : ""}.
          </span>
          <span className="text-muted-foreground">
            이 진료를 활성화하면 기존 진료 탭은 보류됩니다.
          </span>
          <button
            type="button"
            onClick={takeOver}
            className="ml-auto rounded-md border border-primary/40 bg-primary/[0.07] px-2.5 py-1 text-[12px] font-semibold text-primary hover:bg-primary/15"
          >
            이 진료 활성화
          </button>
        </div>
      ) : null}

      {/* 로드 상태 */}
      {error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-10 text-center">
          <p className="text-[13px] text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
          >
            다시 시도
          </button>
        </div>
      ) : encounter === null ? (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4" aria-busy="true" aria-label="진료 정보 불러오는 중">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : encounter.status !== "in_progress" ? (
        // 진행중이 아닌 내원(종결/예약 — 직접 URL·북마크 진입) → 진료 화면 대신 안내(오표시 방지, Patch P3).
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-10 text-center">
          <p className="text-[13px] text-muted-foreground">
            이 내원은 진행중이 아닙니다(현재 {ENCOUNTER_STATUS_META[encounter.status].label}). 진료 화면은
            진찰을 시작한 진행중 내원에서만 열립니다.
          </p>
          <a
            href="/doctor/waiting"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
          >
            진료 대기로
          </a>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 상시 환자 배너(Story 4.5) — 신원·민감정보 reveal·알레르기 can't-miss. 3-pane 위. */}
          <PatientBanner encounter={encounter} />

          {/* 3-pane: 좌 컨텍스트(4.5 실콘텐츠) / 중앙 SOAP(4.6) / 우 오더(Epic5 placeholder). */}
          <div className="grid gap-3 md:grid-cols-[280px_1fr_320px]">
            <PatientContextPanel
              patientId={encounter.patient_id}
              currentEncounterId={encounter.id}
            />
            {/* 중앙 작성 = 진단 블록(4.7) + SOAP ledger(4.6) + 진료 완료 액션(4.7). */}
            <ConsultationWorkspace encounter={encounter} today={today} />
            {/* 우 오더 pane = 처방(5.2). 검사/영상/처치 탭·전체 UX-DR13 통합은 5.3/5.4/5.5. */}
            <PrescriptionPanel encounter={encounter} today={today} />
          </div>
        </div>
      )}
    </div>
  );
}
