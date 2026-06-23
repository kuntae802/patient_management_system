"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { PayChip } from "@/components/encounters/order-item-meta";
import { ReceiptDocument } from "@/components/reception/receipt-document";
import { ApiError } from "@/lib/api/client";
import { formatAuditTime } from "@/lib/admin/audit";
import { formatKrw } from "@/lib/admin/masters";
import {
  buildPayment,
  exportReceipt,
  fetchReceipt,
  finalizePayment,
  type Payment,
  type PaymentDetail,
  type PaymentMethod,
  type Receipt,
} from "@/lib/billing/payments";
import { insuranceLabel } from "@/lib/reception/patients";
import { cn } from "@/lib/utils";

// 수납 집계·결제·문서 상세(Story 7.2/7.3/7.4/7.5 / FR-110~113·UX-DR14·UX-DR21·UX-DR22) — 진입 시
// build_payment(POST·payment.manage) 멱등 호출 → 자동발생 수가 집계 + 본인부담 산정. 헤더 요약(본인부담금
// headline + 총/급여/비급여/공단부담 + "자동 산정" teal 마커·보험유형 근거) + 분류별 라인 + **결제(결제수단
// 토글 → 신원 재진술 confirm → finalize)**. finalized 시 완료 패널 + **문서 출력(진료비 계산서·영수증
// 미리보기 → 브라우저 인쇄/PDF·인쇄=감사 beforeprint·7.5)**. 상시 신원 배너(이름·차트번호·UX-DR21).
// useState 단일 로드(TanStack 미사용). 금액 KRW 정수·tabular-nums·"원".

/** 결제 수단 선택지(카드/현금/계좌이체 — DB CHECK·Pydantic Literal 거울). */
const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "card", label: "카드" },
  { value: "cash", label: "현금" },
  { value: "transfer", label: "계좌이체" },
];

/** 결제 수단 라벨(완료 패널·confirm 표시). */
function paymentMethodLabel(method: string | null): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method ?? "—";
}

/** 결제상태 배지 A3(UX-DR14·색비의존 — 글리프+라벨). 미수납=로즈·완료=그린·취소=취소선. */
function PaymentStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta =
    status === "finalized"
      ? { label: "완료", glyph: "✓", cls: "border-status-done/40 bg-status-done/12 text-status-done-ink" }
      : status === "cancelled"
        ? {
            label: "취소",
            glyph: "✕",
            cls: "border-status-cancelled/40 bg-status-cancelled/12 text-status-cancelled line-through",
          }
        : {
            label: "미수납",
            glyph: "○",
            cls: "border-status-cancelled/40 bg-status-cancelled/12 text-status-cancelled",
          };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11.5px] font-medium",
        meta.cls,
        className,
      )}
    >
      <span aria-hidden className="text-[9px] leading-none">
        {meta.glyph}
      </span>
      {meta.label}
    </span>
  );
}

/** finalize 실패 → 사용자 메시지(에러 code 매핑). 주상병 미지정·권한·이중결제·일반. */
function finalizeErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "primary_diagnosis_required")
      return "주상병이 지정되지 않았습니다. 의사 진단 완료 후 다시 시도하세요.";
    if (err.code === "forbidden") return "수납 권한이 없습니다.";
    if (err.code === "invalid_transition") return "이미 처리되었거나 정산할 수 없는 수납입니다.";
    return err.message;
  }
  return "결제 처리에 실패했습니다.";
}

/** 분류 라벨(스냅샷 category) — null/빈값은 "기타". */
function categoryLabel(category: string | null): string {
  return category && category.trim() ? category : "기타";
}

/** 라인을 분류(category)별로 묶는다 — 적재 순서 보존(진찰료가 먼저). */
function groupByCategory(details: PaymentDetail[]): { category: string; lines: PaymentDetail[] }[] {
  const groups: { category: string; lines: PaymentDetail[] }[] = [];
  for (const line of details) {
    const label = categoryLabel(line.category);
    const last = groups.at(-1);
    if (last && last.category === label) last.lines.push(line);
    else groups.push({ category: label, lines: [line] });
  }
  return groups;
}

/** "자동 산정" teal 마커(UX-DR14·order-panel 미러) — 자동발생 수가 표시(액션/브랜드 teal). */
function AutoTag({ small = false }: { small?: boolean }) {
  return (
    <span
      className={
        "rounded border border-primary/30 bg-primary/10 font-bold tracking-[0.02em] text-primary " +
        (small ? "px-1 py-0.5 text-[9px]" : "px-1.5 py-0.5 text-[9.5px]")
      }
    >
      {small ? "자동" : "자동 산정"}
    </span>
  );
}

/** 헤더 금액 한 칸 — 라벨 + KRW 정수(tabular-nums·"원"). */
function AmountCell({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <p className="text-[10.5px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[15px] font-semibold text-foreground tabular-nums">
        {formatKrw(amount)} <span className="text-[10.5px] font-normal">원</span>
      </p>
    </div>
  );
}

export function BillingDetail({ encounterId }: { encounterId: string }) {
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [showConfirm, setShowConfirm] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loadingReceipt, setLoadingReceipt] = useState(false);

  const load = useCallback(async () => {
    try {
      // 진입 시 자동 집계(멱등 빌드) — 그 사이 수행된 오더의 수가까지 영속 집계 후 표시.
      // finalized 수납이면 build/price 는 status≠draft no-op → 완료 상태 그대로 반환.
      const built = await buildPayment(encounterId);
      setPayment(built);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === "forbidden"
            ? "수납 권한이 없습니다."
            : err.message
          : "수납 건을 불러오지 못했습니다.",
      );
    }
  }, [encounterId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load 의 setState 는 await 이후
    void load();
  }, [load]);

  // 문서 출력(진료비 계산서·영수증) — finalized 패널에서 클릭 시 영수증 데이터 로드 → 미리보기(7.5).
  async function handleOpenReceipt() {
    if (loadingReceipt) return;
    setLoadingReceipt(true);
    try {
      const doc = await fetchReceipt(encounterId);
      setReceipt(doc);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "영수증을 불러오지 못했습니다.");
    } finally {
      setLoadingReceipt(false);
    }
  }

  // 인쇄/내보내기 = 감사(UX-DR22) — 미리보기 열린 동안 beforeprint 리스너(버튼·PDF 저장·네이티브 Ctrl P
  // 전부 포착·각 인쇄 1 감사·fire-and-forget). document.title 은 불투명값(영수증_{차트}·파일명 PII 금지).
  useEffect(() => {
    if (!receipt) return;
    const onBeforePrint = () => {
      void exportReceipt(encounterId, "receipt").catch(() => {});
    };
    const prevTitle = document.title;
    document.title = `영수증_${receipt.patient.chart_no}`;
    window.addEventListener("beforeprint", onBeforePrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      document.title = prevTitle;
    };
  }, [receipt, encounterId]);

  // 결제·내원 완료(finalize) — 신원 재진술 confirm 후 호출. mutation 중 가드(이중제출 방지·UX-DR21).
  async function handleFinalize() {
    if (!payment || finalizing) return;
    setFinalizing(true);
    try {
      const result = await finalizePayment(payment.encounter_id, method);
      setPayment(result);
      setShowConfirm(false);
      toast.success(`결제·내원 완료되었습니다 · 영수증 ${result.payment_no ?? ""}`);
    } catch (err) {
      toast.error(finalizeErrorMessage(err));
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <div className="space-y-5">
      <Link
        href="/reception/billing"
        className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground"
      >
        ← 수납 목록
      </Link>

      {error ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-[13px] text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 rounded-md border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium hover:bg-muted"
          >
            다시 시도
          </button>
        </div>
      ) : payment === null ? (
        <DetailSkeleton />
      ) : (
        <>
          {/* 상시 신원 배너(UX-DR21) — 결제 확정 전 잘못 열린 탭 오류 차단(이름·차트번호 + 결제상태). */}
          <section className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3">
            <span className="text-[13px] font-semibold text-foreground">{payment.patient_name}</span>
            <span className="text-[12px] text-muted-foreground tabular-nums">
              차트 {payment.chart_no}
            </span>
            <PaymentStatusBadge status={payment.status} className="ml-auto" />
          </section>

          {/* 헤더 요약 — 본인부담금(환자 청구액) headline + 총/급여/비급여/공단부담 + "자동 산정" 마커·보험유형 근거. */}
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-[14px] font-semibold text-foreground">수납 집계</h2>
              <AutoTag />
              <span className="ml-auto text-[11px] font-medium text-muted-foreground">
                {insuranceLabel(payment.insurance_type)}
              </span>
            </div>
            {/* 본인부담금 = 환자 실청구액(headline 강조·산정 결과의 핵심). */}
            <div className="mb-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3">
              <p className="text-[11px] text-muted-foreground">본인부담금 (환자 청구)</p>
              <p className="mt-0.5 text-[22px] font-bold text-foreground tabular-nums">
                {formatKrw(payment.copay_amount_krw)}{" "}
                <span className="text-[12px] font-normal">원</span>
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <AmountCell label="총 진료비" amount={payment.total_amount_krw} />
              <AmountCell label="급여" amount={payment.covered_amount_krw} />
              <AmountCell label="비급여" amount={payment.non_covered_amount_krw} />
              <AmountCell label="공단부담금" amount={payment.insurer_amount_krw} />
            </div>
            <p className="mt-2 text-[10.5px] text-muted-foreground">
              {insuranceLabel(payment.insurance_type)} 기준 급여 본인부담률을 적용해 산정했습니다.
            </p>
          </section>

          {/* 상세 라인 — 분류별 그룹. 각 라인 code·행위명·pay-chip·금액·"자동" 마커. */}
          <section className="rounded-xl border border-border bg-card">
            <header className="border-b border-border px-4 py-2.5">
              <h3 className="text-[13px] font-semibold text-foreground">수납 상세</h3>
            </header>
            {payment.details.length === 0 ? (
              <p className="px-4 py-6 text-[12.5px] text-muted-foreground">
                집계된 수가 항목이 없습니다. 진찰·검사·처치 수행 후 자동 산정됩니다.
              </p>
            ) : (
              <div className="divide-y divide-border/60">
                {groupByCategory(payment.details).map((group, gi) => (
                  <div key={`${group.category}-${gi}`} className="px-4 py-2.5">
                    <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                      {group.category}
                    </p>
                    <ul className="space-y-1.5">
                      {group.lines.map((line) => (
                        <li
                          key={line.id}
                          className="flex items-center gap-2 text-[12.5px] text-foreground"
                        >
                          <span className="shrink-0 font-semibold tabular-nums">{line.code ?? "—"}</span>
                          <span className="truncate">{line.name ?? "—"}</span>
                          <PayChip coverageType={line.coverage_type} />
                          {line.fee_item_id ? <AutoTag small /> : null}
                          {line.quantity > 1 ? (
                            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                              ×{line.quantity}
                            </span>
                          ) : null}
                          <span className="ml-auto shrink-0 font-semibold tabular-nums">
                            {formatKrw(line.amount_krw)}{" "}
                            <span className="text-[10.5px] font-normal">원</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 결제 — draft: 결제수단 토글 + "결제·내원 완료"(신원 재진술 confirm). finalized: 완료 패널. */}
          {payment.status === "draft" ? (
            <section className="space-y-3 rounded-xl border border-border bg-card p-4">
              <h3 className="text-[13px] font-semibold text-foreground">결제</h3>
              <div role="radiogroup" aria-label="결제 수단" className="flex gap-2">
                {PAYMENT_METHODS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={method === m.value}
                    onClick={() => setMethod(m.value)}
                    className={cn(
                      "flex-1 rounded-md border px-3 py-2 text-[12.5px] font-medium transition-colors",
                      method === m.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-foreground hover:bg-muted",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                disabled={finalizing}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              >
                결제·내원 완료
              </button>
              <p className="text-[10.5px] text-muted-foreground">
                확정 시 본인부담금 {formatKrw(payment.copay_amount_krw)}원이 결제되고 내원이 완료됩니다.
                완료 후 취소할 수 없습니다.
              </p>
            </section>
          ) : payment.status === "finalized" ? (
            <section className="space-y-2 rounded-xl border border-status-done/40 bg-status-done/5 p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-semibold text-foreground">결제 완료</h3>
                <PaymentStatusBadge status="finalized" />
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
                <dt className="text-muted-foreground">영수증번호</dt>
                <dd className="font-medium text-foreground tabular-nums">{payment.payment_no}</dd>
                <dt className="text-muted-foreground">결제수단</dt>
                <dd className="text-foreground">{paymentMethodLabel(payment.payment_method)}</dd>
                <dt className="text-muted-foreground">납부액</dt>
                <dd className="text-foreground tabular-nums">
                  {formatKrw(payment.paid_amount_krw)} <span className="text-[10.5px]">원</span>
                </dd>
                <dt className="text-muted-foreground">결제일시</dt>
                <dd className="text-foreground tabular-nums">
                  {payment.finalized_at ? formatAuditTime(payment.finalized_at) : "—"}
                </dd>
              </dl>
              <button
                type="button"
                onClick={() => void handleOpenReceipt()}
                disabled={loadingReceipt}
                className="w-full rounded-lg border border-primary/40 bg-primary/5 px-4 py-2.5 text-[12.5px] font-semibold text-primary hover:bg-primary/10 disabled:opacity-60"
              >
                문서 출력 (진료비 계산서·영수증)
              </button>
            </section>
          ) : null}

          {/* 진료비 계산서·영수증 미리보기 — Batang serif 법정 서식 + 브라우저 인쇄/PDF(7.5·FR-113). */}
          {/* @media print: .receipt-paper 만 출력(아래 툴바·앱 셸은 인쇄에서 숨김). 인쇄=감사(beforeprint). */}
          {receipt ? (
            <section className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-semibold text-foreground">
                  문서 출력 미리보기
                  <span className="ml-1.5 rounded border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                    법정 서식
                  </span>
                </h3>
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-primary-hover"
                  >
                    인쇄 / PDF 저장 (Ctrl P)
                  </button>
                  <button
                    type="button"
                    onClick={() => setReceipt(null)}
                    className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium hover:bg-muted"
                  >
                    닫기
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto rounded-md border border-border bg-muted/30 p-3">
                <ReceiptDocument data={receipt} />
              </div>
            </section>
          ) : null}

          {/* 신원 재진술 confirm(UX-DR21·수동 확인) — 이름·차트번호·본인부담금 재진술. */}
          <ConfirmDialog
            open={showConfirm}
            title="결제·내원 완료 확인"
            description={`환자 ${payment.patient_name} · 차트 ${payment.chart_no} · 본인부담금 ${formatKrw(payment.copay_amount_krw)}원을 ${paymentMethodLabel(method)}(으)로 결제하고 내원을 완료합니다. 완료 후 취소할 수 없습니다.`}
            confirmLabel="결제·내원 완료"
            onConfirm={() => void handleFinalize()}
            onCancel={() => setShowConfirm(false)}
          />
        </>
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="불러오는 중">
      <div className="h-28 animate-pulse rounded-xl bg-muted" />
      <div className="h-40 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
