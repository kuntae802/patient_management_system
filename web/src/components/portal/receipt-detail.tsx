"use client";

import Link from "next/link";
import { ChevronLeft, Loader2, Printer } from "lucide-react";
import { useEffect, useState } from "react";

import { ReceiptDocument } from "@/components/reception/receipt-document";
import { formatKrw } from "@/lib/admin/masters";
import { ApiError } from "@/lib/api/client";
import type { Receipt } from "@/lib/billing/payments";
import { PAYMENT_METHOD_LABEL } from "@/lib/billing/format";
import { aggregateAmountByCategory, fetchSelfReceipt } from "@/lib/patient/payments";
import { formatVisitDate } from "@/lib/patient/records";

// 환자 포털 영수증 상세(Story 8.3·FR-122·UX-DR23): 화면=쉬운 말 친화 요약(요양기관·항목 대분류·총
// 진료비·건강보험 부담·내가 낸 금액), 인쇄="영수증 인쇄·저장"으로 7.5 법정 서식(ReceiptDocument·Batang
// serif)을 @media print(.receipt-paper)로만 출력(화면엔 hidden print:block). 동일 Receipt 데이터 공유.
// DESIGN: legal-serif=화면 UI 미사용 → 친화 요약이 화면, 법정 서식은 인쇄 전용. 본인 외 비소유 → 404.

export function ReceiptDetail({ encounterId }: { encounterId: string }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchSelfReceipt(encounterId)
      .then((data) => {
        if (!cancelled) setReceipt(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setError("영수증을 찾을 수 없어요.");
          return;
        }
        setError(
          err instanceof ApiError ? err.message : "영수증을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [encounterId]);

  // 인쇄/PDF 파일명 PII 금지 — 브라우저 기본 파일명(document.title)을 불투명 chart_no 로(이름·주민번호
  // 금지). 언마운트 시 원복(7.5 선례). chart_no 는 불투명 식별자(PII 아님·워크리스트 노출 posture 계승).
  useEffect(() => {
    if (!receipt) return;
    const prev = document.title;
    document.title = `영수증_${receipt.patient.chart_no}`;
    return () => {
      document.title = prev;
    };
  }, [receipt]);

  return (
    <div className="pb-24">
      <Link
        href="/portal"
        className="-ml-1 inline-flex min-h-[44px] items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden /> 마이로
      </Link>

      {loading && (
        <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
          <span className="sr-only">불러오는 중</span>
        </div>
      )}

      {error && (
        <p className="mt-8 rounded-xl border border-border bg-muted/40 px-4 py-8 text-center text-[14px] text-muted-foreground" role="alert">
          {error}
        </p>
      )}

      {receipt && <FriendlySummary receipt={receipt} />}

      {/* 인쇄 전용 법정 서식(7.5 ReceiptDocument 재사용·Batang serif) — 화면엔 숨기고 @media print
          (.receipt-paper)로만 출력. DESIGN: legal-serif 화면 미사용. */}
      {receipt && (
        <div className="hidden print:block">
          <ReceiptDocument data={receipt} />
        </div>
      )}
    </div>
  );
}

/** 화면용 친화 요약 — 쉬운 말·큰 타입·12h·금액 강조. 법정 serif 미사용(DESIGN). 금액은 DB 산정값. */
function FriendlySummary({ receipt }: { receipt: Receipt }) {
  const categories = aggregateAmountByCategory(receipt.details);
  const method = receipt.payment_method ? PAYMENT_METHOD_LABEL[receipt.payment_method] : null;

  return (
    <div className="mt-4 space-y-5">
      <div className="space-y-1">
        <h1 className="text-[20px] font-bold text-foreground">진료비 영수증</h1>
        <p className="text-[13px] text-muted-foreground">
          {formatVisitDate(receipt.encounter.treatment_started_on)} · {receipt.clinic.name}
        </p>
        <p className="text-[12px] text-muted-foreground">
          {receipt.encounter.department_name}
          {receipt.encounter.doctor_name && ` · ${receipt.encounter.doctor_name}`}
        </p>
      </div>

      {/* 항목 대분류별 금액(쉬운 말·표시 그룹핑) */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="pb-2 text-[13px] font-semibold text-foreground">진료 항목</h2>
        {categories.length === 0 ? (
          <p className="py-2 text-[13px] text-muted-foreground">청구 항목이 없어요.</p>
        ) : (
          <ul className="divide-y divide-border">
            {categories.map((row) => (
              <li key={row.category} className="flex items-center justify-between py-2 text-[13px]">
                <span className="text-foreground">{row.category}</span>
                <span className="tabular-nums text-muted-foreground">{formatKrw(row.amount)}원</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 합계 — 총 진료비 · 건강보험 부담 · 내가 낸 금액(강조) */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <dl className="space-y-2.5">
          <div className="flex items-center justify-between text-[13px]">
            <dt className="text-muted-foreground">총 진료비</dt>
            <dd className="tabular-nums font-medium text-foreground">
              {formatKrw(receipt.total_amount_krw)}원
            </dd>
          </div>
          <div className="flex items-center justify-between text-[13px]">
            <dt className="text-muted-foreground">건강보험에서 낸 금액</dt>
            <dd className="tabular-nums text-muted-foreground">
              {formatKrw(receipt.insurer_amount_krw)}원
            </dd>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-2.5 text-[15px]">
            <dt className="font-bold text-foreground">내가 낸 금액</dt>
            <dd className="tabular-nums font-bold text-primary">
              {formatKrw(receipt.paid_amount_krw)}원
            </dd>
          </div>
        </dl>
        {method && (
          <p className="pt-2 text-right text-[12px] text-muted-foreground">{method} 결제</p>
        )}
      </div>

      {/* 영수증 인쇄·저장 — 7.5 법정 서식을 브라우저 인쇄(Ctrl P)/PDF 로 출력. */}
      <button
        type="button"
        onClick={() => window.print()}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-[14px] font-bold text-foreground hover:bg-muted"
      >
        <Printer className="size-4" aria-hidden /> 영수증 인쇄·저장
      </button>
      <p className="text-center text-[12px] text-muted-foreground">
        「국민건강보험법」 별지 서식의 진료비 계산서·영수증으로 인쇄돼요.
      </p>
    </div>
  );
}
