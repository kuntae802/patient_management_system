"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PayChip } from "@/components/encounters/order-item-meta";
import { ApiError } from "@/lib/api/client";
import { formatKrw } from "@/lib/admin/masters";
import { buildPayment, type Payment, type PaymentDetail } from "@/lib/billing/payments";

// 수납 집계 상세(Story 7.2 / FR-110·UX-DR14) — 진입 시 build_payment(POST·payment.manage) 멱등 호출 →
// 자동발생 수가(fee_items)를 draft 수납 건으로 집계·표시. 헤더 요약(총/급여/비급여 + "자동 산정" teal
// 마커) + 분류별 라인(code·행위명·pay-chip·금액·"자동" 마커). 본인부담 산정=7.3·finalize·결제=7.4(버튼 없음).
// useState 단일 로드(TanStack 미사용). 금액 KRW 정수·tabular-nums·"원".

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

  const load = useCallback(async () => {
    try {
      // 진입 시 자동 집계(멱등 빌드) — 그 사이 수행된 오더의 수가까지 영속 집계 후 표시.
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
          {/* 헤더 요약 — 총/급여/비급여 + "자동 산정" 마커. 본인부담·공단부담 산정은 7.3. */}
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-[14px] font-semibold text-foreground">수납 집계</h2>
              <AutoTag />
              <span className="ml-auto text-[11px] text-muted-foreground">자동 산정 수가</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <AmountCell label="총 진료비" amount={payment.total_amount_krw} />
              <AmountCell label="급여" amount={payment.covered_amount_krw} />
              <AmountCell label="비급여" amount={payment.non_covered_amount_krw} />
            </div>
            <p className="mt-2 text-[10.5px] text-muted-foreground">
              본인부담금·공단부담금 산정과 결제는 다음 단계에서 진행합니다.
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
