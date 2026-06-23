import { formatKstDate } from "@/lib/billing/format";
import type { PaymentDetail, Receipt } from "@/lib/billing/payments";
import { LegalDocumentFooter, LegalDocumentHeader, Won } from "@/components/reception/legal-document";

// 진료비 세부산정내역서 법정 서식(Story 7.6 / FR-114 · UX-DR14 · UX-DR22). 영수증(7.5)과 동일 데이터
// (ReceiptResponse)의 "다른 렌더링" — 대분류 집계가 아니라 라인별 전개. 라인별 10컬럼: 항목분류·일자·코드·
// 명칭·단가·횟수·일수·금액·본인부담·공단부담. Batang serif(.receipt-paper 재사용 = @media print 타깃·CSS 0).
// 일자 = 내원 진료일(외래 단일내원 = 전 라인 동일·fee_items 라인별 임상 날짜 없음)·일수 = 1(상수).
// 합계 = 라인 직접 합(line-derived) — 헤더 금액과 정합(Σ금액=total·Σ본인=copay·Σ공단=insurer). 금액=DB 산정값.

/** 분류 라벨(스냅샷 category) — null/빈값은 "기타"(billing-detail·receipt 와 동일 규칙). */
function categoryLabel(category: string | null): string {
  return category && category.trim() ? category : "기타";
}

/** 라인 합계(line-derived) — 금액·본인부담·공단부담. 헤더 금액 정합 불변식의 출처. */
function sumLines(details: PaymentDetail[]) {
  return details.reduce(
    (s, d) => ({
      amount: s.amount + d.amount_krw,
      copay: s.copay + d.copay_amount_krw,
      insurer: s.insurer + d.insurer_amount_krw,
    }),
    { amount: 0, copay: 0, insurer: 0 },
  );
}

export function StatementDocument({ data }: { data: Receipt }) {
  // 일자 = 내원 진료일(전 라인 동일·외래 단일내원·설계 결정 ③). detail.created_at(집계시각) 사용 금지.
  const serviceDate = formatKstDate(data.encounter.treatment_started_on);
  const total = sumLines(data.details);

  return (
    <div className="receipt-paper mx-auto max-w-[900px] bg-white p-8 font-legal-serif text-[13px] text-black">
      <LegalDocumentHeader
        data={data}
        title="진료비 세부산정내역서"
        subtitleEn="DETAILED MEDICAL FEE STATEMENT"
      />

      {/* 라인별 산정 내역 (FR-114: 항목분류·일자·코드·명칭·단가·횟수·일수·금액·본인부담·공단부담) */}
      <div className="mt-4 mb-1 text-[12px] font-bold">산정 내역</div>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="border border-black bg-neutral-100 px-1.5 py-1">항목분류</th>
            <th className="border border-black bg-neutral-100 px-1.5 py-1">일자</th>
            <th className="border border-black bg-neutral-100 px-1.5 py-1">코드</th>
            <th className="border border-black bg-neutral-100 px-1.5 py-1 text-left">명칭</th>
            <th className="border border-black bg-neutral-100 px-1.5 py-1">단가</th>
            <th className="border border-black bg-neutral-100 px-1.5 py-1">횟수</th>
            <th className="border border-black bg-neutral-100 px-1.5 py-1">일수</th>
            <th className="border border-black bg-neutral-100 px-1.5 py-1">금액</th>
            <th className="border border-black bg-neutral-100 px-1.5 py-1">본인부담</th>
            <th className="border border-black bg-neutral-100 px-1.5 py-1">공단부담</th>
          </tr>
        </thead>
        <tbody>
          {data.details.length === 0 ? (
            <tr>
              <td
                colSpan={10}
                className="border border-black px-2 py-3 text-center text-neutral-500"
              >
                청구 항목이 없습니다.
              </td>
            </tr>
          ) : (
            data.details.map((line) => (
              <tr key={line.id}>
                <td className="border border-black px-1.5 py-1">{categoryLabel(line.category)}</td>
                <td className="border border-black px-1.5 py-1 text-center tabular-nums">
                  {serviceDate}
                </td>
                <td className="border border-black px-1.5 py-1 tabular-nums">{line.code ?? "—"}</td>
                <td className="border border-black px-1.5 py-1 text-left">{line.name ?? "—"}</td>
                <td className="border border-black px-1.5 py-1 text-right">
                  <Won amount={line.unit_amount_krw} />
                </td>
                <td className="border border-black px-1.5 py-1 text-center tabular-nums">
                  {line.quantity}
                </td>
                <td className="border border-black px-1.5 py-1 text-center tabular-nums">1</td>
                <td className="border border-black px-1.5 py-1 text-right">
                  <Won amount={line.amount_krw} />
                </td>
                <td className="border border-black px-1.5 py-1 text-right">
                  <Won amount={line.copay_amount_krw} />
                </td>
                <td className="border border-black px-1.5 py-1 text-right">
                  <Won amount={line.insurer_amount_krw} />
                </td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td colSpan={7} className="border border-black bg-neutral-100 px-1.5 py-1 text-center">
              합계
            </td>
            <td className="border border-black bg-neutral-100 px-1.5 py-1 text-right">
              <Won amount={total.amount} />
            </td>
            <td className="border border-black bg-neutral-100 px-1.5 py-1 text-right">
              <Won amount={total.copay} />
            </td>
            <td className="border border-black bg-neutral-100 px-1.5 py-1 text-right">
              <Won amount={total.insurer} />
            </td>
          </tr>
        </tfoot>
      </table>

      <LegalDocumentFooter
        data={data}
        legalNote={
          <>
            본 세부산정내역서는 「국민건강보험법 시행규칙」에 따른 진료비 계산서·영수증의 항목별 산정
            근거입니다. 급여 항목은 본인부담금과 공단부담금으로 구분되며, 비급여 항목은 전액
            본인부담입니다. 금액 단위는 원(KRW)입니다.
          </>
        }
      />
    </div>
  );
}
