import { formatKrw } from "@/lib/admin/masters";
import { PAYMENT_METHOD_LABEL } from "@/lib/billing/format";
import type { PaymentDetail, Receipt } from "@/lib/billing/payments";
import { LegalDocumentFooter, LegalDocumentHeader, Won } from "@/components/reception/legal-document";

// 진료비 계산서·영수증 법정 서식(Story 7.5 / FR-113 · UX-DR14 · UX-DR22). 「국민건강보험법 시행규칙」
// 별지 서식 풍 — Batang serif(legal-serif 예외)·흰 종이·검은 잉크·하드 보더(앱 미학과 의도적 대비).
// 항목별 금액표 = 대분류(category) × 급여(본인/공단)·비급여 + 합계. 납부 3행(본인부담총액·기납부·납부할).
// 미리보기(화면)·인쇄(@media print = .receipt-paper 만 출력) 공용. 주민번호는 masked 만(full reveal 이월).
// 금액은 전부 DB 산정값 — 클라는 category 그룹 합산(표시)만(pricing 재구현 금지·project-context).
// 문서 제목 바·요양기관/환자 헤더·발급/서명·법적 고지는 legal-document.tsx 공유(세부산정내역서 7.6 와 공용).

/** 대분류(category) 집계 행 — 급여 본인/공단·비급여·합계. */
type CategoryRow = {
  category: string;
  copayCovered: number; // 급여 본인부담금
  insurerCovered: number; // 급여 공단부담금
  nonCovered: number; // 비급여(전액 본인)
  total: number; // 금액 합계
};

/** 라인을 대분류별로 묶어 금액을 합산(적재 순서 보존·진찰료 먼저). category null/빈값 → "기타". */
function aggregateByCategory(details: PaymentDetail[]): CategoryRow[] {
  const order: string[] = [];
  const rows = new Map<string, CategoryRow>();
  for (const d of details) {
    const category = d.category?.trim() ? d.category : "기타";
    let row = rows.get(category);
    if (!row) {
      row = { category, copayCovered: 0, insurerCovered: 0, nonCovered: 0, total: 0 };
      rows.set(category, row);
      order.push(category);
    }
    if (d.coverage_type === "covered") {
      row.copayCovered += d.copay_amount_krw;
      row.insurerCovered += d.insurer_amount_krw;
    } else {
      row.nonCovered += d.amount_krw; // 비급여 = 전액 본인부담(7.3: copay=amount·insurer=0)
    }
    row.total += d.amount_krw;
  }
  return order.map((c) => rows.get(c) as CategoryRow);
}

export function ReceiptDocument({ data }: { data: Receipt }) {
  const categories = aggregateByCategory(data.details);
  // 소계 = category 행의 합(라인 출처) — 헤더 산술 대신 본문과 동일 출처로 자기정합 확보(금액=DB 산정값).
  const subtotal = categories.reduce(
    (s, r) => ({
      copayCovered: s.copayCovered + r.copayCovered,
      insurerCovered: s.insurerCovered + r.insurerCovered,
      nonCovered: s.nonCovered + r.nonCovered,
      total: s.total + r.total,
    }),
    { copayCovered: 0, insurerCovered: 0, nonCovered: 0, total: 0 },
  );
  const billedCopayTotal = subtotal.copayCovered + subtotal.nonCovered; // 본인부담 총액(급여 본인 + 비급여)

  return (
    <div className="receipt-paper mx-auto max-w-[820px] bg-white p-8 font-legal-serif text-[13px] text-black">
      <LegalDocumentHeader
        data={data}
        title="진료비 계산서 · 영수증"
        subtitleEn="MEDICAL FEE STATEMENT & RECEIPT"
      />

      {/* 항목별 금액 (급여 본인/공단 · 비급여 · 합계) */}
      <div className="mt-4 mb-1 text-[12px] font-bold">항목별 금액</div>
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th rowSpan={2} className="w-[32%] border border-black bg-neutral-100 px-2 py-1">
              항목
            </th>
            <th colSpan={2} className="border border-black bg-neutral-100 px-2 py-1">
              급여
            </th>
            <th rowSpan={2} className="border border-black bg-neutral-100 px-2 py-1">
              비급여
            </th>
            <th rowSpan={2} className="border border-black bg-neutral-100 px-2 py-1">
              금액 합계
            </th>
          </tr>
          <tr>
            <th className="border border-black bg-neutral-100 px-2 py-1">본인부담금</th>
            <th className="border border-black bg-neutral-100 px-2 py-1">공단부담금</th>
          </tr>
        </thead>
        <tbody>
          {categories.length === 0 ? (
            <tr>
              <td colSpan={5} className="border border-black px-2 py-3 text-center text-neutral-500">
                청구 항목이 없습니다.
              </td>
            </tr>
          ) : (
            categories.map((row) => (
              <tr key={row.category}>
                <td className="border border-black px-2 py-1">{row.category}</td>
                <td className="border border-black px-2 py-1 text-right">
                  <Won amount={row.copayCovered} />
                </td>
                <td className="border border-black px-2 py-1 text-right">
                  <Won amount={row.insurerCovered} />
                </td>
                <td className="border border-black px-2 py-1 text-right">
                  <Won amount={row.nonCovered} />
                </td>
                <td className="border border-black px-2 py-1 text-right">
                  <Won amount={row.total} />
                </td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="font-medium">
            <td className="border border-black bg-neutral-50 px-2 py-1">소계</td>
            <td className="border border-black bg-neutral-50 px-2 py-1 text-right">
              <Won amount={subtotal.copayCovered} />
            </td>
            <td className="border border-black bg-neutral-50 px-2 py-1 text-right">
              <Won amount={subtotal.insurerCovered} />
            </td>
            <td className="border border-black bg-neutral-50 px-2 py-1 text-right">
              <Won amount={subtotal.nonCovered} />
            </td>
            <td className="border border-black bg-neutral-50 px-2 py-1 text-right">
              <Won amount={subtotal.total} />
            </td>
          </tr>
          <tr className="font-bold">
            <td className="border border-black bg-neutral-100 px-2 py-1">
              본인부담 총액 (납부할 금액)
            </td>
            <td
              colSpan={3}
              className="border border-black bg-neutral-100 px-2 py-1 text-left text-[11px] font-normal text-neutral-700"
            >
              본인부담금 {formatKrw(subtotal.copayCovered)} + 비급여 {formatKrw(subtotal.nonCovered)}
            </td>
            <td className="border border-black bg-neutral-100 px-2 py-1 text-right">
              <Won amount={billedCopayTotal} />
            </td>
          </tr>
        </tfoot>
      </table>

      {/* 납부 정보 (3행 합계: 본인부담총액 · 기납부 · 납부할금액) */}
      <div className="mt-4 mb-1 text-[12px] font-bold">납부 정보</div>
      <table className="w-full border-collapse text-[12px]">
        <tbody>
          <tr>
            <th className="w-1/2 border border-black bg-neutral-100 px-2 py-1 text-left font-medium">
              본인부담 총액
            </th>
            <td className="border border-black px-2 py-1 text-right">
              <Won amount={data.copay_amount_krw} /> 원
            </td>
          </tr>
          <tr>
            <th className="border border-black bg-neutral-100 px-2 py-1 text-left font-medium">
              이미 납부한 금액
            </th>
            <td className="border border-black px-2 py-1 text-right">
              <Won amount={data.paid_amount_krw} /> 원
            </td>
          </tr>
          <tr className="font-bold">
            <th className="border border-black bg-neutral-100 px-2 py-1 text-left">납부할 금액</th>
            <td className="border border-black px-2 py-1 text-right">
              <Won amount={data.due_amount_krw} /> 원
            </td>
          </tr>
          <tr>
            <th className="border border-black bg-neutral-100 px-2 py-1 text-left font-medium">
              결제 수단
            </th>
            <td className="border border-black px-2 py-1 text-right">
              {data.payment_method ? (PAYMENT_METHOD_LABEL[data.payment_method] ?? data.payment_method) : "—"}
            </td>
          </tr>
        </tbody>
      </table>

      <LegalDocumentFooter
        data={data}
        legalNote={
          <>
            본 계산서·영수증은 「국민건강보험법 시행규칙」 별지 서식에 따른 진료비 계산서·영수증입니다.
            연말정산 의료비 공제 자료는 국세청 홈택스에 자동 제출되며, 본 영수증으로도 증빙할 수 있습니다.
          </>
        }
      />
    </div>
  );
}
