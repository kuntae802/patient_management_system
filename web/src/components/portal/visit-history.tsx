"use client";

import Link from "next/link";
import { ChevronDown, Loader2, ShieldCheck } from "lucide-react";
import { Fragment, useEffect, useState } from "react";

import { EncounterDetail } from "@/components/portal/encounter-detail";
import { PatientStatusBadge } from "@/components/portal/patient-status-badge";
import { ApiError, apiFetch } from "@/lib/api/client";
import {
  fetchSelfEncounterDetail,
  type PatientEncounterDetail,
} from "@/lib/patient/encounter-detail";
import {
  fetchSelfEncounters,
  formatVisitDate,
  formatVisitTime,
  visitTimeSuffix,
  visitTimestamp,
  visitYear,
  type PatientEncounterCard,
} from "@/lib/patient/records";
import { cn } from "@/lib/utils";

// 환자 포털 "내 기록"(Story 8.1·FR-120·UX-DR17): 본인 내원 이력 카드(날짜·상태배지·의사·진단 쉬운 말)를
// 최근순으로, 상단 신뢰 노트(RLS·UX-DR22) 상시. 본인 외 데이터 0건(서버 세션 uid 스코프). 쉬운 말·큰 터치·
// 색 비의존. 카드 펼침 상세(처방·검사 결과)는 Story 8.2(아래 VisitCard 지연 로드). patient_id 는 서버
// 도출(클라 미전송). 자가연결(self-link) 미완(404 no_self_patient)이면 온보딩 유도(예약 화면 패턴 재사용).

type LinkState = "checking" | "linked" | "unlinked";

export function VisitHistory() {
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [patientName, setPatientName] = useState("");
  const [cards, setCards] = useState<PatientEncounterCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 1) 본인 연결 확인(이름·신뢰 노트용) → 미연결(404)이면 온보딩 유도. 2) 연결됐으면 내원 카드 조회.
    apiFetch<{ name: string }>("/v1/patients/self")
      .then(async (self) => {
        if (cancelled) return;
        setPatientName(self.name);
        setLinkState("linked");
        const rows = await fetchSelfEncounters();
        if (!cancelled) setCards(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.code === "no_self_patient")) {
          setLinkState("unlinked");
          return;
        }
        setError(
          err instanceof ApiError ? err.message : "진료 내역을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (linkState === "checking") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">불러오는 중</span>
      </div>
    );
  }

  if (linkState === "unlinked") {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-2 text-center">
        <ShieldCheck className="size-9 text-muted-foreground" aria-hidden />
        <div className="space-y-1">
          <h1 className="text-[17px] font-semibold text-foreground">내 진료 기록 보기</h1>
          <p className="text-[13px] text-muted-foreground">
            진료 기록을 안전하게 보려면 먼저 본인 확인이 필요해요.
          </p>
        </div>
        <Link
          href="/onboarding"
          className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-primary px-5 text-[14px] font-bold text-primary-foreground hover:bg-primary/90"
        >
          본인 진료기록 연결하기
        </Link>
      </div>
    );
  }

  const avatar = patientName.slice(0, 1) || "·";

  return (
    <div className="pb-24">
      {/* 상단 앱바 — 로고·"내 기록"·본인 이름·아바타(자체 폰 셸). */}
      <header className="flex items-center gap-3 pb-5">
        <div className="flex flex-col">
          <span className="text-[17px] font-bold text-foreground">내 기록</span>
          <span className="text-[12px] text-muted-foreground">{patientName} 님</span>
        </div>
        <span
          aria-hidden
          className="ml-auto flex size-9 items-center justify-center rounded-full bg-primary/12 text-[14px] font-bold text-primary"
        >
          {avatar}
        </span>
      </header>

      <div className="space-y-1 pb-4">
        <h2 className="text-[20px] font-bold text-foreground">지난 진료 내역</h2>
        <p className="text-[13px] text-muted-foreground">최근 진료부터 차례대로 보여 드려요.</p>
      </div>

      {/* 신뢰 노트(RLS·UX-DR22) — 상시. 본인 외 데이터 0건을 시스템이 보장함을 사용자에게 전달. */}
      <div className="mb-5 flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          <b className="font-semibold text-foreground">{patientName} 님 본인</b>의 정보만 안전하게
          표시됩니다. 다른 사람은 볼 수 없어요.
        </p>
      </div>

      {error && (
        <p className="rounded-xl border border-status-cancelled/30 bg-status-cancelled/5 px-3 py-2.5 text-[13px] text-status-cancelled" role="alert">
          {error}
        </p>
      )}

      {cards !== null && cards.length === 0 && (
        <p className="py-12 text-center text-[14px] text-muted-foreground">
          아직 진료 내역이 없어요.
        </p>
      )}

      {cards !== null && cards.length > 0 && (
        <ul className="space-y-3">
          {cards.map((card, i) => {
            const year = visitYear(card);
            const showYear = i === 0 || year !== visitYear(cards[i - 1]);
            return (
              <Fragment key={card.id}>
                {showYear && (
                  <li
                    aria-hidden
                    className="pb-1 pt-2 text-[12px] font-semibold tracking-wide text-muted-foreground"
                  >
                    {year}년
                  </li>
                )}
                <li>
                  <VisitCard card={card} />
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 내원 1건 카드. 임상 활동(완료·진료중) 내원은 펼치면 처방·검사 결과 상세(Story 8.2·지연 로드). */
function VisitCard({ card }: { card: PatientEncounterCard }) {
  const at = visitTimestamp(card);
  const doctor = card.doctor_name ?? "담당 의료진";
  const isCancelled = card.status === "cancelled";
  const isNoShow = card.status === "no_show";
  // 펼침 = 임상 활동이 있는 내원만(완료·진료중). 예약/접수/취소/노쇼는 상세 없음(8.1 표시 전용 유지).
  const canExpand = card.status === "completed" || card.status === "in_progress";

  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<PatientEncounterDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const panelId = `visit-detail-${card.id}`;

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    // 첫 펼침에만 지연 로드(이후 상태 캐시). 8.1 plain useState/fetch 패턴 일치(TanStack 미도입).
    if (next && detail === null && !loading) {
      setLoading(true);
      setDetailError(null);
      fetchSelfEncounterDetail(card.id)
        .then((d) => setDetail(d))
        .catch((err: unknown) =>
          setDetailError(
            err instanceof ApiError ? err.message : "내용을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
          ),
        )
        .finally(() => setLoading(false));
    }
  }

  return (
    <article className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold tabular-nums text-foreground">
          {formatVisitDate(at)}
        </span>
        <PatientStatusBadge status={card.status} />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-bold text-muted-foreground"
        >
          {doctor.slice(0, 1)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[14px] font-semibold text-foreground">{doctor}</span>
          <span className="text-[12px] text-muted-foreground">
            {card.department_name} · {formatVisitTime(at)} {visitTimeSuffix(card)}
          </span>
        </span>
      </div>

      {isCancelled || isNoShow ? (
        // 취소·노쇼는 사유가 있으면 사유를, 없으면(cancel_encounter reason 기본 NULL) 상태 안내문을
        // 보인다 — 카드 본문이 비지 않게(AC4 "상태에 맞는 안내"·색 비의존). 빈 문자열도 폴백.
        <div className="mt-3 flex gap-2 border-t border-border pt-3">
          <span className="shrink-0 text-[12px] font-semibold text-muted-foreground">
            {isCancelled ? "사유" : "안내"}
          </span>
          <span className="text-[13px] text-muted-foreground">
            {card.cancel_reason ||
              (isCancelled ? "예약이 취소되었어요." : "방문하지 않은 진료예요.")}
          </span>
        </div>
      ) : card.primary_diagnosis_name ? (
        <div className="mt-3 flex gap-2 border-t border-border pt-3">
          <span className="shrink-0 text-[12px] font-semibold text-muted-foreground">진단</span>
          <span className="text-[14px] font-medium text-foreground">
            {card.primary_diagnosis_name}
            {card.primary_diagnosis_friendly_note && (
              <span className="ml-1 text-[13px] font-normal text-muted-foreground">
                ({card.primary_diagnosis_friendly_note})
              </span>
            )}
          </span>
        </div>
      ) : null}

      {canExpand && (
        <>
          {/* 펼침 토글 — 색 비의존(라벨+셰브런)·≥44px 터치(UX-DR17). aria-expanded/controls 로 상세 연결. */}
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            aria-controls={panelId}
            className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-1 border-t border-border pt-3 text-[13px] font-semibold text-primary"
          >
            {expanded ? "접기" : "처방·검사 결과 보기"}
            <ChevronDown
              className={cn("size-4 transition-transform", expanded && "rotate-180")}
              aria-hidden
            />
          </button>
          {expanded && (
            <div id={panelId}>
              {loading && (
                <p
                  className="py-3 text-center text-[13px] text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  불러오는 중…
                </p>
              )}
              {detailError && (
                <p className="py-2 text-[13px] text-status-cancelled" role="alert">
                  {detailError}
                </p>
              )}
              {detail && <EncounterDetail detail={detail} />}
            </div>
          )}
        </>
      )}
    </article>
  );
}
