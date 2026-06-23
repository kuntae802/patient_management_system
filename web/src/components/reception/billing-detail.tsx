"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { PayChip } from "@/components/encounters/order-item-meta";
import { PrescriptionDocument } from "@/components/reception/prescription-document";
import { ReceiptDocument } from "@/components/reception/receipt-document";
import { StatementDocument } from "@/components/reception/statement-document";
import { ApiError } from "@/lib/api/client";
import { formatAuditTime } from "@/lib/admin/audit";
import { formatKrw } from "@/lib/admin/masters";
import { formatKstDate } from "@/lib/billing/format";
import {
  buildPayment,
  exportReceipt,
  fetchReceipt,
  finalizePayment,
  prepayPayment,
  settleCancelledVisit,
  type DocumentType,
  type Payment,
  type PaymentDetail,
  type PaymentMethod,
  type Receipt,
} from "@/lib/billing/payments";
import {
  dispensePrescription,
  exportPrescriptionDocument,
  fetchPrescriptionDocument,
  type PrescriptionDocItem,
  type PrescriptionDocument as PrescriptionDoc,
} from "@/lib/billing/prescriptions";
import { insuranceLabel } from "@/lib/reception/patients";
import { cn } from "@/lib/utils";

// 수납 집계·결제·문서 상세(Story 7.2/7.3/7.4/7.5/7.6 / FR-110~114·UX-DR14·UX-DR21·UX-DR22) — 진입 시
// build_payment(POST·payment.manage) 멱등 호출 → 자동발생 수가 집계 + 본인부담 산정. 헤더 요약(본인부담금
// headline + 총/급여/비급여/공단부담 + "자동 산정" teal 마커·보험유형 근거) + 분류별 라인 + **결제(결제수단
// 토글 → 신원 재진술 confirm → finalize)**. finalized 시 완료 패널 + **문서 출력 미리보기(문서 탭: 진료비
// 계산서·영수증 7.5 / 세부산정내역서 7.6·동일 데이터·다른 렌더) → 브라우저 인쇄/PDF·인쇄=감사 beforeprint
// (활성 탭 document_type)**. 상시 신원 배너(이름·차트번호·UX-DR21). useState 단일 로드(TanStack 미사용).
// 금액 KRW 정수·tabular-nums·"원".

/** 결제 수단 선택지(카드/현금/계좌이체 — DB CHECK·Pydantic Literal 거울). */
const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "card", label: "카드" },
  { value: "cash", label: "현금" },
  { value: "transfer", label: "계좌이체" },
];

/** 선결제 금액 상한(1억원) — Pydantic Field(le) 거울. int4 overflow·fat-finger 방어. */
const MAX_PREPAY_KRW = 100_000_000;

/** 결제 수단 라벨(완료 패널·confirm 표시). */
function paymentMethodLabel(method: string | null): string {
  return (
    PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method ?? "—"
  );
}

/** 결제상태 배지 A3(UX-DR14·색비의존 — 글리프+라벨). 미수납=로즈·부분=앰버·완료=그린·취소=취소선.
 * 부분(◐) = draft 인데 선결제(paid>0)된 상태(7.8 선수납) — 미정산 차액 잔존. */
function PaymentStatusBadge({
  status,
  paidAmount = 0,
  className,
}: {
  status: string;
  paidAmount?: number;
  className?: string;
}) {
  const partial = status === "draft" && paidAmount > 0;
  const meta =
    status === "finalized"
      ? {
          label: "완료",
          glyph: "✓",
          cls: "border-status-done/40 bg-status-done/12 text-status-done-ink",
        }
      : status === "cancelled"
        ? {
            label: "취소",
            glyph: "✕",
            cls: "border-status-cancelled/40 bg-status-cancelled/12 text-status-cancelled line-through",
          }
        : partial
          ? {
              label: "부분",
              glyph: "◐",
              cls: "border-status-received/40 bg-status-received/12 text-status-received-ink",
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
    if (err.code === "invalid_transition")
      return "이미 처리되었거나 정산할 수 없는 수납입니다.";
    return err.message;
  }
  return "결제 처리에 실패했습니다.";
}

/** 선결제 실패 → 사용자 메시지(7.8). 권한·이미 결제/취소·미존재·일반. */
function prepayErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "forbidden") return "수납 권한이 없습니다.";
    if (err.code === "invalid_transition")
      return "이미 처리되었거나 선결제할 수 없는 수납입니다.";
    return err.message;
  }
  return "선결제 처리에 실패했습니다.";
}

/** 내원 취소·환급 실패 → 사용자 메시지(7.9). 권한·이미 종결/비-registered·미존재·일반. */
function settleCancelErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "forbidden") return "내원 취소 권한이 없습니다.";
    if (err.code === "invalid_transition")
      return "이미 종결되었거나 취소할 수 없는 내원입니다.";
    if (err.code === "not_found") return "내원을 찾을 수 없습니다.";
    return err.message;
  }
  return "내원 취소 처리에 실패했습니다.";
}

/** 처방전 발급 실패 → 사용자 메시지(7.7). 이미 발급·권한·미존재·일반. */
function dispenseErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "invalid_transition") return "이미 발급된 처방입니다.";
    if (err.code === "forbidden") return "처방전 발급 권한이 없습니다.";
    if (err.code === "not_found") return "처방을 찾을 수 없습니다.";
    return err.message;
  }
  return "처방전 발급에 실패했습니다.";
}

/** 처방 상태 배지 A3(색비의존 — 글리프+라벨). 발행=중립·발급=그린(완료). */
function RxStatusBadge({ status }: { status: string }) {
  const meta =
    status === "dispensed"
      ? {
          label: "발급",
          glyph: "✓",
          cls: "border-status-done/40 bg-status-done/12 text-status-done-ink",
        }
      : {
          label: "발행",
          glyph: "○",
          cls: "border-border bg-muted text-muted-foreground",
        };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11.5px] font-medium",
        meta.cls,
      )}
    >
      <span aria-hidden className="text-[9px] leading-none">
        {meta.glyph}
      </span>
      {meta.label}
    </span>
  );
}

/** 분류 라벨(스냅샷 category) — null/빈값은 "기타". */
function categoryLabel(category: string | null): string {
  return category && category.trim() ? category : "기타";
}

/** 라인을 분류(category)별로 묶는다 — 적재 순서 보존(진찰료가 먼저). */
function groupByCategory(
  details: PaymentDetail[],
): { category: string; lines: PaymentDetail[] }[] {
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
        {formatKrw(amount)}{" "}
        <span className="text-[10.5px] font-normal">원</span>
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
  // 선결제(선수납·7.8) — 금액 입력(문자열)·신원 confirm·mutation 가드.
  const [prepayAmount, setPrepayAmount] = useState("");
  const [showPrepayConfirm, setShowPrepayConfirm] = useState(false);
  const [prepaying, setPrepaying] = useState(false);
  // 내원 취소·환급(7.9) — 신원 confirm·mutation 가드. 취소·노쇼=수가 미발생 + 선납 전액 환급.
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loadingReceipt, setLoadingReceipt] = useState(false);
  // 미리보기 활성 문서 탭 — receipt=진료비 계산서·영수증 / statement=세부산정내역서(7.6·동일 데이터·다른 렌더).
  const [activeDoc, setActiveDoc] = useState<DocumentType>("receipt");
  // 원외처방전(7.7) — payment 무관(발행 처방이면 노출). doc=문서 데이터·activeRx=미리보기 중인 처방 1매.
  const [prescriptionDoc, setPrescriptionDoc] =
    useState<PrescriptionDoc | null>(null);
  const [activeRx, setActiveRx] = useState<PrescriptionDocItem | null>(null);
  const [dispensing, setDispensing] = useState(false);
  const [pendingDispense, setPendingDispense] =
    useState<PrescriptionDocItem | null>(null);

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

  // 원외처방전 문서(7.7) — 진입 시 best-effort 조회(prescription.dispense 게이트·payment 무관). 처방
  // 없거나 권한 없으면 섹션 미표시(에러 토스트 없음 — 선택 기능). 발급 후 갱신 위해 콜백 분리.
  const loadPrescriptions = useCallback(async () => {
    try {
      setPrescriptionDoc(await fetchPrescriptionDocument(encounterId));
    } catch {
      setPrescriptionDoc(null);
    }
  }, [encounterId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadPrescriptions 의 setState 는 await 이후
    void loadPrescriptions();
  }, [loadPrescriptions]);

  // 문서 출력 — finalized 패널에서 클릭 시 문서 데이터 로드 → 미리보기(7.5/7.6·영수증·세부내역서 공용 데이터).
  async function handleOpenReceipt() {
    if (loadingReceipt) return;
    setLoadingReceipt(true);
    setActiveRx(null); // 처방전 미리보기와 상호배타(인쇄 .receipt-paper 1개만).
    try {
      const doc = await fetchReceipt(encounterId);
      setReceipt(doc);
      setActiveDoc("receipt"); // 진입 기본 탭 = 영수증.
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "문서를 불러오지 못했습니다.",
      );
    } finally {
      setLoadingReceipt(false);
    }
  }

  // 인쇄/내보내기 = 감사(UX-DR22) — 미리보기 열린 동안 beforeprint 리스너(버튼·PDF 저장·네이티브 Ctrl P
  // 전부 포착·각 인쇄 1 감사·fire-and-forget). 감사 document_type·파일명은 **활성 탭** 기준(activeDoc 의존성).
  // document.title 은 불투명값(영수증_/세부내역서_{차트}·파일명 PII 금지).
  useEffect(() => {
    if (!receipt) return;
    const onBeforePrint = () => {
      void exportReceipt(encounterId, activeDoc).catch(() => {});
    };
    const prevTitle = document.title;
    const docLabel = activeDoc === "statement" ? "세부내역서" : "영수증";
    document.title = `${docLabel}_${receipt.patient.chart_no}`;
    window.addEventListener("beforeprint", onBeforePrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      document.title = prevTitle;
    };
  }, [receipt, encounterId, activeDoc]);

  // 처방전 미리보기 — 영수증/세부내역서 미리보기와 상호배타(둘 다 .receipt-paper → 인쇄에 1개만 잡히도록).
  function handleOpenPrescription(rx: PrescriptionDocItem) {
    setReceipt(null);
    setActiveRx(rx);
  }

  // 처방전 인쇄=감사(UX-DR22·7.5 계승) — 미리보기 열린 동안 beforeprint → exportPrescriptionDocument
  // (활성 처방 1매·fire-and-forget). document.title=처방전_{차트}(파일명 PII 금지·불투명). receipt 미리보기와
  // 상호배타라 둘 중 하나만 리스너 활성(activeRx 없으면 early return).
  useEffect(() => {
    if (!prescriptionDoc || !activeRx) return;
    const onBeforePrint = () => {
      void exportPrescriptionDocument(encounterId, activeRx.id).catch(() => {});
    };
    const prevTitle = document.title;
    document.title = `처방전_${prescriptionDoc.patient.chart_no}`;
    window.addEventListener("beforeprint", onBeforePrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      document.title = prevTitle;
    };
  }, [prescriptionDoc, activeRx, encounterId]);

  // 발급 확정(issued→dispensed) — 신원 재진술 confirm 후 호출. 비가역 1방향·mutation 중 가드. 성공 시 갱신.
  async function handleDispense() {
    if (!pendingDispense || dispensing) return;
    setDispensing(true);
    try {
      await dispensePrescription(encounterId, pendingDispense.id);
      toast.success("원외처방전이 발급되었습니다.");
      setPendingDispense(null);
      await loadPrescriptions();
    } catch (err) {
      toast.error(dispenseErrorMessage(err));
    } finally {
      setDispensing(false);
    }
  }

  // 선결제(선수납·7.8) — 신원 재진술 confirm 후 호출. paid 누적·billing_type prepaid 전환·내원 미완료.
  async function handlePrepay() {
    if (!payment || prepaying) return;
    const amount = Number(prepayAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      toast.error("선결제 금액을 원 단위 양의 정수로 입력하세요.");
      return;
    }
    if (amount > MAX_PREPAY_KRW) {
      toast.error(`선결제 금액은 ${formatKrw(MAX_PREPAY_KRW)}원을 넘을 수 없습니다.`);
      return;
    }
    setPrepaying(true);
    try {
      const result = await prepayPayment(payment.encounter_id, amount, method);
      setPayment(result);
      setShowPrepayConfirm(false);
      setPrepayAmount("");
      toast.success(`선결제 ${formatKrw(amount)}원이 기록되었습니다.`);
    } catch (err) {
      toast.error(prepayErrorMessage(err));
    } finally {
      setPrepaying(false);
    }
  }

  // 결제·내원 완료(finalize) — 신원 재진술 confirm 후 호출. mutation 중 가드(이중제출 방지·UX-DR21).
  async function handleFinalize() {
    if (!payment || finalizing) return;
    setFinalizing(true);
    try {
      const result = await finalizePayment(payment.encounter_id, method);
      setPayment(result);
      setShowConfirm(false);
      toast.success(
        `결제·내원 완료되었습니다 · 영수증 ${result.payment_no ?? ""}`,
      );
    } catch (err) {
      toast.error(finalizeErrorMessage(err));
    } finally {
      setFinalizing(false);
    }
  }

  // 내원 취소·환급(7.9) — 신원 재진술 confirm 후 호출. cancel_encounter + draft void + 선납 전액 환급
  // 원자(서버). mutation 중 가드(이중제출 방지·UX-DR21·고위험 비가역).
  async function handleSettleCancel() {
    if (!payment || cancelling) return;
    setCancelling(true);
    try {
      const result = await settleCancelledVisit(payment.encounter_id);
      setPayment(result);
      setShowCancelConfirm(false);
      toast.success(
        result.refunded_amount_krw > 0
          ? `내원이 취소되었습니다 · 환급 ${formatKrw(result.refunded_amount_krw)}원`
          : "내원이 취소되었습니다.",
      );
    } catch (err) {
      toast.error(settleCancelErrorMessage(err));
    } finally {
      setCancelling(false);
    }
  }

  // 차액(납부할 금액) = 본인부담금 − 이미 납부. 음수면 과납(환급 대상·7.9). 선결제 안 했으면 = copay.
  const due = payment ? payment.copay_amount_krw - payment.paid_amount_krw : 0;

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
            <span className="text-[13px] font-semibold text-foreground">
              {payment.patient_name}
            </span>
            <span className="text-[12px] text-muted-foreground tabular-nums">
              차트 {payment.chart_no}
            </span>
            <PaymentStatusBadge
              status={payment.status}
              paidAmount={payment.paid_amount_krw}
              className="ml-auto"
            />
          </section>

          {/* 헤더 요약 — 본인부담금(환자 청구액) headline + 총/급여/비급여/공단부담 + "자동 산정" 마커·보험유형 근거. */}
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-[14px] font-semibold text-foreground">
                수납 집계
              </h2>
              <AutoTag />
              <span className="ml-auto text-[11px] font-medium text-muted-foreground">
                {insuranceLabel(payment.insurance_type)}
              </span>
            </div>
            {/* 본인부담금 = 환자 실청구액(headline 강조·산정 결과의 핵심). */}
            <div className="mb-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3">
              <p className="text-[11px] text-muted-foreground">
                본인부담금 (환자 청구)
              </p>
              <p className="mt-0.5 text-[22px] font-bold text-foreground tabular-nums">
                {formatKrw(payment.copay_amount_krw)}{" "}
                <span className="text-[12px] font-normal">원</span>
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <AmountCell label="총 진료비" amount={payment.total_amount_krw} />
              <AmountCell label="급여" amount={payment.covered_amount_krw} />
              <AmountCell
                label="비급여"
                amount={payment.non_covered_amount_krw}
              />
              <AmountCell
                label="공단부담금"
                amount={payment.insurer_amount_krw}
              />
            </div>
            <p className="mt-2 text-[10.5px] text-muted-foreground">
              {insuranceLabel(payment.insurance_type)} 기준 급여 본인부담률을
              적용해 산정했습니다.
            </p>
          </section>

          {/* 상세 라인 — 분류별 그룹. 각 라인 code·행위명·pay-chip·금액·"자동" 마커. */}
          <section className="rounded-xl border border-border bg-card">
            <header className="border-b border-border px-4 py-2.5">
              <h3 className="text-[13px] font-semibold text-foreground">
                수납 상세
              </h3>
            </header>
            {/* 부분 수행(7.10) — 미수행(ordered) 오더가 있으면 finalize 전 안내. 수행분만 청구(미수행=fee 0
                구조적 제외). draft 만(종결 후 미표시). 색비의존(⚠ 글리프 + 라벨·앰버 주의 톤). */}
            {payment.status === "draft" && payment.pending_orders_count > 0 ? (
              <div className="flex items-start gap-2 border-b border-border bg-status-received/10 px-4 py-2.5 text-[12px] text-status-received-ink">
                <span aria-hidden className="mt-0.5 shrink-0 font-bold">
                  ⚠
                </span>
                <p>
                  부분 수행 — 미수행 오더{" "}
                  <span className="font-semibold tabular-nums">
                    {payment.pending_orders_count}
                  </span>
                  건은 청구에서 제외됩니다(수행분만 정산).
                </p>
              </div>
            ) : null}
            {payment.details.length === 0 ? (
              <p className="px-4 py-6 text-[12.5px] text-muted-foreground">
                집계된 수가 항목이 없습니다. 진찰·검사·처치 수행 후 자동
                산정됩니다.
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
                          <span className="shrink-0 font-semibold tabular-nums">
                            {line.code ?? "—"}
                          </span>
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
                            <span className="text-[10.5px] font-normal">
                              원
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 결제 — draft: 결제수단 토글 + 선결제(선수납·7.8) + "결제·내원 완료"(신원 confirm). finalized: 완료 패널. */}
          {payment.status === "draft" ? (
            <section className="space-y-4 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-semibold text-foreground">
                  결제
                </h3>
                {payment.billing_type === "prepaid" ? (
                  <span className="rounded border border-status-received/40 bg-status-received/10 px-1.5 py-0.5 text-[10px] font-medium text-status-received-ink">
                    선수납
                  </span>
                ) : null}
              </div>

              {/* 결제수단 토글(선결제·정산 공용). */}
              <div
                role="radiogroup"
                aria-label="결제 수단"
                className="flex gap-2"
              >
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

              {/* 납부 현황 — 선결제(paid>0) 시 이미 납부 + 납부할 차액(또는 환급 대상·과납). */}
              {payment.paid_amount_krw > 0 ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-[12px]">
                  <dt className="text-muted-foreground">이미 납부 (선결제)</dt>
                  <dd className="text-right font-medium text-foreground tabular-nums">
                    {formatKrw(payment.paid_amount_krw)}{" "}
                    <span className="text-[10px] font-normal">원</span>
                  </dd>
                  {payment.total_amount_krw > 0 ? (
                    due >= 0 ? (
                      <>
                        <dt className="text-muted-foreground">납부할 차액</dt>
                        <dd className="text-right font-semibold text-foreground tabular-nums">
                          {formatKrw(due)}{" "}
                          <span className="text-[10px] font-normal">원</span>
                        </dd>
                      </>
                    ) : (
                      <>
                        <dt className="text-status-received-ink">
                          환급 대상 (과납)
                        </dt>
                        <dd className="text-right font-semibold text-status-received-ink tabular-nums">
                          {formatKrw(-due)}{" "}
                          <span className="text-[10px] font-normal">원</span>
                        </dd>
                      </>
                    )
                  ) : null}
                </dl>
              ) : null}

              {/* 선결제(선수납) — 금액 입력 + 선결제 버튼. 내원 미완료(정산 시점만 앞당김). */}
              <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <label
                    htmlFor="prepay-amount"
                    className="text-[12px] font-medium text-foreground"
                  >
                    선결제 (선수납)
                  </label>
                  <span className="text-[10.5px] text-muted-foreground">
                    {payment.total_amount_krw > 0
                      ? "본인부담금 일부/전부를 미리 받습니다"
                      : "진찰 전 — 수가 미발생, 예치금으로 기록됩니다"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    id="prepay-amount"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_PREPAY_KRW}
                    step={1}
                    value={prepayAmount}
                    onChange={(e) => setPrepayAmount(e.target.value)}
                    placeholder="금액(원)"
                    className="w-40 rounded-md border border-border bg-card px-3 py-2 text-[12.5px] tabular-nums focus:border-primary focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPrepayConfirm(true)}
                    disabled={
                      prepaying ||
                      !prepayAmount ||
                      !Number.isInteger(Number(prepayAmount)) ||
                      Number(prepayAmount) <= 0 ||
                      Number(prepayAmount) > MAX_PREPAY_KRW
                    }
                    className="rounded-md border border-primary/40 bg-primary/5 px-4 py-2 text-[12.5px] font-semibold text-primary hover:bg-primary/10 disabled:opacity-60"
                  >
                    선결제
                  </button>
                </div>
              </div>

              {/* 결제·내원 완료(차액 정산 + 완료) — 수가 발생(total>0) 시만. registered(수가 0)는 선결제만. */}
              {payment.total_amount_krw > 0 ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowConfirm(true)}
                    disabled={finalizing}
                    className="w-full rounded-lg bg-primary px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                  >
                    결제·내원 완료
                  </button>
                  <p className="text-[10.5px] text-muted-foreground">
                    {payment.paid_amount_krw > 0
                      ? due > 0
                        ? `확정 시 차액 ${formatKrw(due)}원이 결제되고 내원이 완료됩니다.`
                        : "확정 시 추가 결제 없이 내원이 완료됩니다(선결제 완납)."
                      : `확정 시 본인부담금 ${formatKrw(payment.copay_amount_krw)}원이 결제되고 내원이 완료됩니다.`}{" "}
                    완료 후 취소할 수 없습니다.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground">
                    진찰·수행 후 수가가 산정되면 결제·내원 완료를 진행할 수
                    있습니다.
                  </p>
                  {/* 내원 취소·환급(7.9) — 진찰 전(수가 미발생) 내원 취소. 선납(paid>0) 시 전액 환급.
                      total>0(진찰 후=in_progress)은 취소 불가(완료만·부분수행 정산=7.10) → 버튼 미노출. */}
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(true)}
                    disabled={cancelling}
                    className="w-full rounded-lg border border-status-cancelled/40 bg-status-cancelled/5 px-4 py-2.5 text-[12.5px] font-semibold text-status-cancelled hover:bg-status-cancelled/10 disabled:opacity-60"
                  >
                    내원 취소{payment.paid_amount_krw > 0 ? "·환급" : ""}
                  </button>
                  <p className="text-[10.5px] text-muted-foreground">
                    {payment.paid_amount_krw > 0
                      ? `취소 시 선납 ${formatKrw(payment.paid_amount_krw)}원이 ${paymentMethodLabel(payment.payment_method)}(으)로 환급되고 수가는 발생하지 않습니다.`
                      : "취소 시 수가가 발생하지 않습니다. 취소 후 되돌릴 수 없습니다."}
                  </p>
                </div>
              )}
            </section>
          ) : payment.status === "finalized" ? (
            <section className="space-y-2 rounded-xl border border-status-done/40 bg-status-done/5 p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-semibold text-foreground">
                  결제 완료
                </h3>
                <PaymentStatusBadge status="finalized" />
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
                <dt className="text-muted-foreground">영수증번호</dt>
                <dd className="font-medium text-foreground tabular-nums">
                  {payment.payment_no}
                </dd>
                <dt className="text-muted-foreground">결제수단</dt>
                <dd className="text-foreground">
                  {paymentMethodLabel(payment.payment_method)}
                </dd>
                <dt className="text-muted-foreground">납부액</dt>
                <dd className="text-foreground tabular-nums">
                  {formatKrw(payment.paid_amount_krw)}{" "}
                  <span className="text-[10.5px]">원</span>
                </dd>
                <dt className="text-muted-foreground">결제일시</dt>
                <dd className="text-foreground tabular-nums">
                  {payment.finalized_at
                    ? formatAuditTime(payment.finalized_at)
                    : "—"}
                </dd>
              </dl>
              <button
                type="button"
                onClick={() => void handleOpenReceipt()}
                disabled={loadingReceipt}
                className="w-full rounded-lg border border-primary/40 bg-primary/5 px-4 py-2.5 text-[12.5px] font-semibold text-primary hover:bg-primary/10 disabled:opacity-60"
              >
                문서 출력 (진료비 계산서·영수증 · 세부산정내역서)
              </button>
            </section>
          ) : payment.status === "cancelled" ? (
            /* 취소·노쇼 정산 완료(7.9) — 수가 미발생·선납 전액 환급. 결제/선결제 섹션 미노출(종결). */
            <section className="space-y-2 rounded-xl border border-status-cancelled/40 bg-status-cancelled/5 p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-semibold text-foreground">
                  내원 취소됨
                </h3>
                <PaymentStatusBadge status="cancelled" />
              </div>
              <p className="text-[12px] text-muted-foreground">
                취소·노쇼로 종결된 내원입니다. 수가가 발생하지 않습니다.
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
                {payment.refunded_amount_krw > 0 ? (
                  <>
                    <dt className="text-muted-foreground">환급액</dt>
                    <dd className="font-semibold text-foreground tabular-nums">
                      {formatKrw(payment.refunded_amount_krw)}{" "}
                      <span className="text-[10.5px] font-normal">원</span>
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                        ({paymentMethodLabel(payment.payment_method)})
                      </span>
                    </dd>
                  </>
                ) : null}
                {payment.cancel_reason ? (
                  <>
                    <dt className="text-muted-foreground">취소 사유</dt>
                    <dd className="text-foreground">{payment.cancel_reason}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">취소일시</dt>
                <dd className="text-foreground tabular-nums">
                  {payment.cancelled_at
                    ? formatAuditTime(payment.cancelled_at)
                    : "—"}
                </dd>
              </dl>
            </section>
          ) : null}

          {/* 원외처방전(7.7) — payment 무관(발행 처방이면 노출). 발급 확정(issued→dispensed)·출력(미리보기). */}
          {prescriptionDoc && prescriptionDoc.prescriptions.length > 0 ? (
            <section className="space-y-2 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-semibold text-foreground">
                  원외처방전
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  발행된 처방을 발급·출력합니다
                </span>
              </div>
              <ul className="divide-y divide-border/60">
                {prescriptionDoc.prescriptions.map((rx) => (
                  <li
                    key={rx.id}
                    className="flex flex-wrap items-center gap-2 py-2 text-[12.5px]"
                  >
                    <RxStatusBadge status={rx.status} />
                    <span className="text-muted-foreground">
                      {rx.prescriber.name ?? "—"} ·{" "}
                      {formatKstDate(rx.ordered_at)}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      약품 {rx.drugs.length}건
                    </span>
                    <div className="ml-auto flex gap-2">
                      {rx.status === "issued" ? (
                        <button
                          type="button"
                          onClick={() => setPendingDispense(rx)}
                          disabled={dispensing}
                          className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                        >
                          발급 확정
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleOpenPrescription(rx)}
                        className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium hover:bg-muted"
                      >
                        출력
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* 처방전 미리보기 — 법정 서식(Batang serif·.receipt-paper) + 브라우저 인쇄/PDF. 영수증 미리보기와 */}
          {/* 상호배타(activeRx 설정 시 receipt=null). 인쇄=감사(beforeprint·처방 1매·document_type=prescription). */}
          {prescriptionDoc && activeRx ? (
            <section className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[13px] font-semibold text-foreground">
                  원외처방전 미리보기
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
                    onClick={() => setActiveRx(null)}
                    className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium hover:bg-muted"
                  >
                    닫기
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto rounded-md border border-border bg-muted/30 p-3">
                <PrescriptionDocument
                  data={prescriptionDoc}
                  prescription={activeRx}
                />
              </div>
            </section>
          ) : null}

          {/* 문서 출력 미리보기 — 문서 탭 토글(영수증 7.5 / 세부산정내역서 7.6·동일 데이터·다른 렌더). */}
          {/* Batang serif 법정 서식 + 브라우저 인쇄/PDF. @media print: 활성 탭 .receipt-paper 만 출력 */}
          {/* (아래 툴바·앱 셸은 인쇄에서 숨김). 인쇄=감사(beforeprint·활성 탭 document_type). */}
          {receipt ? (
            <section className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[13px] font-semibold text-foreground">
                  문서 출력 미리보기
                  <span className="ml-1.5 rounded border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                    법정 서식
                  </span>
                </h3>
                {/* 문서 탭 — 활성 탭 = 렌더·인쇄·감사 대상(A3 색비의존: 배경 + 밑줄 강조). */}
                <div
                  role="tablist"
                  aria-label="문서 선택"
                  className="flex gap-1"
                >
                  {(
                    [
                      { value: "receipt", label: "진료비 계산서·영수증" },
                      { value: "statement", label: "세부산정내역서" },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      role="tab"
                      aria-selected={activeDoc === tab.value}
                      onClick={() => setActiveDoc(tab.value)}
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                        activeDoc === tab.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
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
              {/* 활성 탭 문서만 렌더 — 인쇄(.receipt-paper)에 1개만 잡히도록 조건부 렌더(둘 다 렌더 금지). */}
              <div className="overflow-x-auto rounded-md border border-border bg-muted/30 p-3">
                {activeDoc === "statement" ? (
                  <StatementDocument data={receipt} />
                ) : (
                  <ReceiptDocument data={receipt} />
                )}
              </div>
            </section>
          ) : null}

          {/* 신원 재진술 confirm(UX-DR21·수동 확인) — 이름·차트번호·결제액(선납 시 차액) 재진술. */}
          <ConfirmDialog
            open={showConfirm}
            title="결제·내원 완료 확인"
            description={`환자 ${payment.patient_name} · 차트 ${payment.chart_no} · ${
              payment.paid_amount_krw > 0
                ? due > 0
                  ? `차액 ${formatKrw(due)}원을 ${paymentMethodLabel(method)}(으)로 결제하고`
                  : `추가 결제 없이(선결제 완납)`
                : `본인부담금 ${formatKrw(payment.copay_amount_krw)}원을 ${paymentMethodLabel(method)}(으)로 결제하고`
            } 내원을 완료합니다. 완료 후 취소할 수 없습니다.`}
            confirmLabel="결제·내원 완료"
            onConfirm={() => void handleFinalize()}
            onCancel={() => setShowConfirm(false)}
          />

          {/* 선결제 confirm(UX-DR21·신원 재진술) — 이름·차트번호·선결제액. 내원 미완료(차액은 정산 시). */}
          <ConfirmDialog
            open={showPrepayConfirm}
            title="선결제 확인"
            description={`환자 ${payment.patient_name} · 차트 ${payment.chart_no} · 선결제 ${formatKrw(Number(prepayAmount) || 0)}원을 ${paymentMethodLabel(method)}(으)로 받습니다. 진료 후 차액을 정산합니다.`}
            confirmLabel="선결제"
            onConfirm={() => void handlePrepay()}
            onCancel={() => setShowPrepayConfirm(false)}
          />

          {/* 내원 취소·환급 confirm(UX-DR21·신원 재진술·7.9) — 이름·차트번호 + 선납 시 환급액·원결제수단.
              취소=수가 미발생·비가역. 후수납(paid=0)은 환급 없이 취소만. */}
          <ConfirmDialog
            open={showCancelConfirm}
            title="내원 취소 확인"
            description={`환자 ${payment.patient_name} · 차트 ${payment.chart_no}의 내원을 취소합니다.${
              payment.paid_amount_krw > 0
                ? ` 선납 ${formatKrw(payment.paid_amount_krw)}원을 ${paymentMethodLabel(payment.payment_method)}(으)로 환급합니다.`
                : ""
            } 수가는 발생하지 않으며, 취소 후 되돌릴 수 없습니다.`}
            confirmLabel={payment.paid_amount_krw > 0 ? "취소·환급" : "내원 취소"}
            onConfirm={() => void handleSettleCancel()}
            onCancel={() => setShowCancelConfirm(false)}
          />

          {/* 처방전 발급 confirm(UX-DR21·신원 재진술) — 발급은 비가역(issued→dispensed). */}
          <ConfirmDialog
            open={pendingDispense !== null}
            title="원외처방전 발급 확인"
            description={`환자 ${payment.patient_name} · 차트 ${payment.chart_no}의 원외처방전을 발급합니다. 발급 후 취소할 수 없습니다.`}
            confirmLabel="발급 확정"
            onConfirm={() => void handleDispense()}
            onCancel={() => setPendingDispense(null)}
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
