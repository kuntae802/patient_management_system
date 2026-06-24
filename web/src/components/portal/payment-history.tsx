"use client";

import Link from "next/link";
import { ChevronRight, CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api/client";
import { formatKrw } from "@/lib/admin/masters";
import { PAYMENT_METHOD_LABEL } from "@/lib/billing/format";
import { fetchSelfPayments, type PatientPaymentCard } from "@/lib/patient/payments";
import { formatVisitDate, formatVisitTime } from "@/lib/patient/records";

// 환자 포털 '마이' 탭 수납·영수증(Story 8.3·FR-122·UX-DR17): 본인 finalized 수납 카드(날짜·요양기관·
// 진료과·납부액·완료 배지)를 최근순으로, 상단 신뢰 노트(RLS·UX-DR22) 상시. 본인 외 0건(서버 세션 uid
// 스코프). 쉬운 말·큰 터치·12시간·색 비의존. 카드 탭 → 영수증 상세(/receipts/{encounter_id}). 미연결
// (self-link 미완·404)이면 온보딩 유도(VisitHistory 패턴 재사용·이름/신뢰 노트도 self 호출로 동시 획득).

type LinkState = "checking" | "linked" | "unlinked";

export function PaymentHistory() {
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [patientName, setPatientName] = useState("");
  const [cards, setCards] = useState<PatientPaymentCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ name: string }>("/v1/patients/self")
      .then(async (self) => {
        if (cancelled) return;
        setPatientName(self.name);
        setLinkState("linked");
        const rows = await fetchSelfPayments();
        if (!cancelled) setCards(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.code === "no_self_patient")) {
          setLinkState("unlinked");
          return;
        }
        setError(
          err instanceof ApiError ? err.message : "결제 내역을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
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
          <h1 className="text-[17px] font-semibold text-foreground">내 진료비·영수증 보기</h1>
          <p className="text-[13px] text-muted-foreground">
            결제 내역을 안전하게 보려면 먼저 본인 확인이 필요해요.
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

  return (
    <div className="pb-24">
      <header className="flex items-center gap-3 pb-5">
        <div className="flex flex-col">
          <span className="text-[17px] font-bold text-foreground">마이</span>
          <span className="text-[12px] text-muted-foreground">{patientName} 님</span>
        </div>
        <span
          aria-hidden
          className="ml-auto flex size-9 items-center justify-center rounded-full bg-primary/12 text-[14px] font-bold text-primary"
        >
          {patientName.slice(0, 1) || "·"}
        </span>
      </header>

      <div className="space-y-1 pb-4">
        <h2 className="text-[20px] font-bold text-foreground">내 진료비 · 영수증</h2>
        <p className="text-[13px] text-muted-foreground">결제를 마친 진료의 영수증을 보여 드려요.</p>
      </div>

      {/* 신뢰 노트(RLS·UX-DR22) — 상시. 본인 외 0건을 시스템이 보장함을 전달. */}
      <div className="mb-5 flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          <b className="font-semibold text-foreground">{patientName} 님 본인</b>의 결제 내역만 안전하게
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
          아직 결제 내역이 없어요.
        </p>
      )}

      {cards !== null && cards.length > 0 && (
        <ul className="space-y-3">
          {cards.map((card) => (
            <li key={card.encounter_id}>
              <PaymentCard card={card} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 수납 1건 카드 — 날짜·요양기관/진료과·납부액·완료 배지. 탭 → 영수증 상세(≥44px·셰브런·색 비의존). */
function PaymentCard({ card }: { card: PatientPaymentCard }) {
  // 대표 일시: 결제완료 시각(timestamptz·시·분 의미 있음) 우선, 없으면 진료일(date·시각 미표시).
  const repDate = card.finalized_at ?? card.treatment_date;
  const time = card.finalized_at ? formatVisitTime(card.finalized_at) : null;
  const method = card.payment_method ? PAYMENT_METHOD_LABEL[card.payment_method] : null;

  return (
    <Link
      href={`/receipts/${card.encounter_id}`}
      className="flex min-h-[44px] items-center gap-3 rounded-2xl border border-border bg-card p-4 hover:bg-muted/40"
    >
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
      >
        <CreditCard className="size-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-semibold tabular-nums text-foreground">
          {repDate ? formatVisitDate(repDate) : "—"}
          {time && <span className="ml-1 font-normal text-muted-foreground">{time}</span>}
        </span>
        <span className="truncate text-[12px] text-muted-foreground">
          {card.clinic_name} · {card.department_name}
        </span>
        <span className="text-[13px] text-foreground">
          납부 <b className="font-bold tabular-nums">{formatKrw(card.paid_amount_krw)}원</b>
          {method && <span className="text-muted-foreground"> · {method}</span>}
          <span className="ml-1.5 inline-flex items-center gap-0.5 text-[12px] font-semibold text-status-done">
            <span aria-hidden>✓</span> 완료
          </span>
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
