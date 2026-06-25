"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { formatKrw } from "@/lib/admin/masters";
import { ApiError } from "@/lib/api/client";
import { fetchPaymentHistory, type PaymentHistoryItem } from "@/lib/billing/payments";

// 수납 내역(완료 finalized 수납 재조회·재출력) — 환자명·차트·영수증번호(q) + 기간 검색 → 목록.
// 행의 "영수증 보기" → 기존 영수증 화면(/reception/billing/{encounter_id})으로 이동, finalized 완료
// 패널에서 영수증·세부산정내역서·원외처방전을 재출력(브라우저 인쇄=감사). 게이트=서버 page(payment.read).
// useState 단일 로드 + 디바운스(billing-worklist·patient-search 패턴). 🚫 q(환자명 PII)는 로그 금지.

const FIELD =
  "h-9 rounded-md border border-border bg-card px-2.5 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

/** ISO(UTC) → KST 날짜·시각 표시. 없으면 "—". */
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(new Date(iso));
}

export function PaymentHistory() {
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [items, setItems] = useState<PaymentHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await fetchPaymentHistory({
        q: q.trim() || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setItems(page.data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "수납 내역을 불러오지 못했습니다.");
    }
  }, [q, dateFrom, dateTo]);

  // 디바운스(검색어/기간 변경) — 250ms 후 조회. 첫 마운트 시 전체(최신순) 로드.
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">수납 내역</h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          완료된 수납을 환자명·차트번호·영수증번호로 검색해 영수증을 재출력합니다.
        </p>
      </div>

      {/* 검색바 */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            검색 (환자명·차트번호·영수증번호)
          </span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="예: 김근태 · R-20260625-000003"
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">시작일</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="정산 시작일"
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">종료일</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="정산 종료일"
            className={FIELD}
          />
        </label>
      </div>

      {/* 목록 */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        {error ? (
          <p className="px-4 py-6 text-[13px] text-muted-foreground">{error}</p>
        ) : items === null ? (
          <div className="space-y-2 p-4" aria-busy="true" aria-label="수납 내역 불러오는 중">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
            조건에 해당하는 수납 내역이 없습니다.
          </p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="border-b border-border px-3 py-2 text-left">영수증번호</th>
                  <th scope="col" className="border-b border-border px-3 py-2 text-left">환자</th>
                  <th scope="col" className="border-b border-border px-3 py-2 text-left">진료과</th>
                  <th scope="col" className="border-b border-border px-3 py-2 text-right">본인부담</th>
                  <th scope="col" className="border-b border-border px-3 py-2 text-left">정산일시</th>
                  <th scope="col" className="border-b border-border px-3 py-2 text-right">영수증</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.encounter_id} className="hover:bg-muted/40">
                    <td className="border-b border-border px-3 py-2 tabular-nums text-muted-foreground">
                      {it.payment_no ?? "—"}
                    </td>
                    <td className="border-b border-border px-3 py-2">
                      <span className="font-medium text-foreground">{it.patient_name}</span>
                      <span className="ml-1.5 tabular-nums text-[11px] text-muted-foreground">
                        {it.chart_no}
                      </span>
                    </td>
                    <td className="border-b border-border px-3 py-2 text-muted-foreground">
                      {it.department_name}
                    </td>
                    <td className="border-b border-border px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                      {formatKrw(it.copay_amount_krw)}
                      <span className="text-[10.5px] font-normal"> 원</span>
                    </td>
                    <td className="border-b border-border px-3 py-2 tabular-nums text-muted-foreground">
                      {fmtDateTime(it.finalized_at)}
                    </td>
                    <td className="border-b border-border px-3 py-2 text-right">
                      <Link
                        href={`/reception/billing/${it.encounter_id}`}
                        className="inline-flex items-center rounded-md border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-foreground hover:bg-muted"
                      >
                        영수증 보기
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
