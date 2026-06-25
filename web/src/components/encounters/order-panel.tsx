"use client";

import { AlertTriangle, ClipboardList } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ExaminationPanel } from "@/components/encounters/examination-panel";
import { PrescriptionPanel } from "@/components/encounters/prescription-panel";
import { TreatmentPanel } from "@/components/encounters/treatment-panel";
import { formatKrw } from "@/lib/admin/masters";
import { ApiError } from "@/lib/api/client";
import {
  type Examination,
  fetchExaminations,
} from "@/lib/encounters/examinations";
import { feePreview, isOverdue } from "@/lib/encounters/order-safety";
import {
  fetchPrescriptions,
  type Prescription,
} from "@/lib/encounters/prescriptions";
import {
  fetchTreatmentOrders,
  type TreatmentOrder,
} from "@/lib/encounters/treatment-orders";
import type { Encounter } from "@/lib/reception/encounters";
import type { Patient } from "@/lib/reception/patients";

// 오더 패널(Story 5.5 / UX-DR13) — 진료 허브 우 오더 pane 의 탭 통합 오케스트레이터. 처방(5.2)·검사·영상
// (5.3)·처치(5.4) 의 개별 패널을 처방/검사/영상/처치 탭으로 묶고, 안전 레이어를 얹는다: ① 추적 라인·
// pay-chip(자식 패널)·수가 자동 산정 프리뷰 ② 알레르기↔오더 교차검증(처방 패널) ③ 누락 0 디텍터(지연 surface).
// 데이터는 본 컴포넌트가 리프트(4종 병렬 로드) — 탭 카운트·프리뷰 소계·디텍터 집계의 단일 진실. 자식 패널은
// controlled(데이터+reload 주입). 검사·영상은 한 테이블 두 탭(exam_type 분할). web 현행 패턴(apiFetch·useState).

type TabKey = "prescription" | "imaging" | "treatment";

// "검사"(lab 진단검사) 탭 제거 — 검체 채취 수행 경로(주체) 미구현(Finding #2). 영상(방사선사)·처치
// (간호)는 수행 경로 실재. examination 인프라(exam_type)는 백엔드 유지(향후 검체 수행 구현 시 부활).
const TABS: { key: TabKey; label: string }[] = [
  { key: "prescription", label: "처방" },
  { key: "imaging", label: "영상" },
  { key: "treatment", label: "처치" },
];

export function OrderPanel({
  encounter,
  patient,
  today,
}: {
  encounter: Encounter;
  patient: Patient | null;
  today: string;
}) {
  const encounterId = encounter.id;
  const [prescriptions, setPrescriptions] = useState<Prescription[] | null>(
    null,
  );
  const [examinations, setExaminations] = useState<Examination[] | null>(null);
  const [treatments, setTreatments] = useState<TreatmentOrder[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("prescription");
  const [nowMs, setNowMs] = useState<number>(0); // 디텍터 기준 시각(로드 시점) — 0=미로드

  const reload = useCallback(async () => {
    const [rx, ex, tr] = await Promise.all([
      fetchPrescriptions(encounterId),
      fetchExaminations(encounterId),
      fetchTreatmentOrders(encounterId),
    ]);
    setPrescriptions(rx);
    setExaminations(ex);
    setTreatments(tr);
    setNowMs(Date.now());
  }, [encounterId]);

  const load = useCallback(async () => {
    try {
      await reload();
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "오더를 불러오지 못했습니다.",
      );
    }
  }, [reload]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load 의 setState 는 await 이후
    void load();
  }, [load]);

  const imagingExams = (examinations ?? []).filter(
    (e) => e.exam_type === "imaging",
  );
  // 탭 카운트 = 활성 오더 수(취소건 제외 — 취소됨은 목록에 이력으로만 표시·0056).
  const isActive = (o: { status: string }) => o.status !== "cancelled";
  const counts: Record<TabKey, number> = {
    prescription: (prescriptions ?? []).filter(isActive).length,
    imaging: imagingExams.filter(isActive).length,
    treatment: (treatments ?? []).filter(isActive).length,
  };

  // 수가 자동 산정 프리뷰 — fee_schedule 기반(검사·영상·처치)만(처방=약가 없음). 표시 전용(산정=Epic7).
  // 취소 오더는 수가 미발생(0056·0021 트리거=performed 전이) → 프리뷰에서도 제외.
  const feeItems = [...(examinations ?? []), ...(treatments ?? [])]
    .filter(isActive)
    .map((o) => ({
      amount_krw: o.amount_krw,
      coverage_type: o.coverage_type,
    }));
  const preview = feePreview(feeItems);

  // 누락 0 디텍터 — 미수행(ordered) 지연 건수(검사·영상·처치). nowMs=0(미로드) 이면 0.
  const overdueCount = nowMs
    ? [...(examinations ?? []), ...(treatments ?? [])].filter((o) =>
        isOverdue(o.ordered_at, o.status, nowMs),
      ).length
    : 0;

  if (
    loadError &&
    prescriptions === null &&
    examinations === null &&
    treatments === null
  ) {
    return (
      <section
        aria-label="오더 패널"
        className="rounded-xl border border-border bg-card px-4 py-5 text-center"
      >
        <p className="text-[13px] text-muted-foreground">{loadError}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
        >
          다시 시도
        </button>
      </section>
    );
  }

  return (
    <section
      aria-label="오더 패널"
      className="rounded-xl border border-border bg-card"
    >
      <header className="flex items-center gap-2 px-4 pb-2 pt-3.5">
        <ClipboardList className="size-4 text-primary" aria-hidden />
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">
          오더
        </h2>
      </header>

      {/* 탭 바(UX-DR13) — 처방/검사/영상/처치 + 카운트 배지. 색+채움(음영 비의존, UX-DR20). */}
      <div role="tablist" aria-label="오더 유형" className="flex gap-0 px-4">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={
                "flex-1 border-b-2 px-1 py-1.5 text-[12.5px] font-medium " +
                (active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              {t.label}
              {counts[t.key] > 0 && (
                <span className="ml-1 text-[10.5px] tabular-nums opacity-80">
                  {counts[t.key]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="space-y-3 px-4 pb-4 pt-3">
        {/* 누락 0 디텍터 배너(UX-DR21⑥) — 지연 미수행 건수 surface(색+글리프+라벨). */}
        {overdueCount > 0 && (
          <div
            role="status"
            className="flex items-center gap-1.5 rounded-md border border-status-cancelled/40 bg-status-cancelled/10 px-2.5 py-1.5 text-[11.5px] font-medium text-status-cancelled"
          >
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            지연 미수행 오더 {overdueCount}건 — 수행 확인 필요
          </div>
        )}

        {/* 활성 탭 콘텐츠 — controlled 자식(데이터+reload 주입). */}
        <div role="tabpanel">
          {tab === "prescription" && (
            <PrescriptionPanel
              encounter={encounter}
              today={today}
              patient={patient}
              prescriptions={prescriptions}
              onReload={load}
            />
          )}
          {tab === "imaging" && (
            <ExaminationPanel
              encounter={encounter}
              today={today}
              examType="imaging"
              examinations={examinations === null ? null : imagingExams}
              nowMs={nowMs}
              onReload={load}
            />
          )}
          {tab === "treatment" && (
            <TreatmentPanel
              encounter={encounter}
              today={today}
              treatments={treatments}
              nowMs={nowMs}
              onReload={load}
            />
          )}
        </div>

        {/* 수가 자동 산정 프리뷰(UX-DR13) — "자동 산정" 마커 + 급여/비급여 소계. 표시 전용(산정=Epic7). */}
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              예상 수가
              <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-bold tracking-[0.02em] text-primary">
                자동 산정
              </span>
            </span>
            <span className="text-[13px] font-semibold tabular-nums text-foreground">
              {formatKrw(preview.totalKrw)}{" "}
              <span className="text-[10.5px] font-normal">원</span>
            </span>
          </div>
          <p className="mt-1 text-[10.5px] text-muted-foreground tabular-nums">
            급여 {formatKrw(preview.coveredKrw)} · 비급여{" "}
            {formatKrw(preview.nonCoveredKrw)}
            <span className="ml-1 not-italic">
              — 검사·영상·처치 기준. 진찰료·약가·본인부담 산정은 수납에서.
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
