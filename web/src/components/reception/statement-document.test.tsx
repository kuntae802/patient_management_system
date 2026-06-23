import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatementDocument } from "@/components/reception/statement-document";
import type { PaymentDetail, Receipt } from "@/lib/billing/payments";

// 진료비 세부산정내역서 법정 서식(Story 7.6 / FR-114). 라인별 10컬럼(항목분류·일자·코드·명칭·단가·횟수·
// 일수·금액·본인부담·공단부담)·합계=헤더 금액 정합·일자=진료일·일수=1·masked RRN(full 부재)·비급여 라인.

function line(over: Partial<PaymentDetail> = {}): PaymentDetail {
  return {
    id: `pd-${Math.random()}`,
    payment_id: "pay-1",
    fee_item_id: "fi-1",
    fee_schedule_id: "fs-1",
    code: "AA154",
    name: "초진진찰료",
    category: "진찰료",
    quantity: 1,
    unit_amount_krw: 17610,
    amount_krw: 17610,
    coverage_type: "covered",
    copay_rate: 0.3,
    copay_amount_krw: 5280,
    insurer_amount_krw: 12330,
    created_at: "2026-06-23T01:00:00Z",
    updated_at: "2026-06-23T01:00:00Z",
    ...over,
  };
}

// 3 라인: 진찰료(급여 5280/12330)·검사료(급여 1000/2000)·비급여처치(비급여 3000 전액 본인).
function makeReceipt(over: Partial<Receipt> = {}): Receipt {
  return {
    clinic: {
      name: "○○의원",
      biz_no: "123-45-67890",
      hira_no: "31234567",
      address: "서울특별시 ○○구 ○○로 123",
      ceo_name: "박○○",
      phone: "02-123-4567",
    },
    patient: {
      name: "홍길동",
      chart_no: "C-0001",
      resident_no_masked: "900101-1******",
      insurance_type: "health_insurance",
    },
    encounter: {
      department_name: "내과",
      doctor_name: "이정훈",
      treatment_started_on: "2026-06-23",
      treatment_ended_on: "2026-06-23",
    },
    status: "finalized",
    payment_no: "R-20260623-000042",
    payment_method: "card",
    finalized_at: "2026-06-23T05:00:00Z",
    issued_by_name: "김원무",
    total_amount_krw: 23610,
    covered_amount_krw: 20610,
    non_covered_amount_krw: 3000,
    copay_amount_krw: 9280, // 급여 본인 6280 + 비급여 3000
    insurer_amount_krw: 14330,
    paid_amount_krw: 9280,
    due_amount_krw: 0,
    details: [
      line(),
      line({ code: "C3800", name: "CBC", category: "검사료", amount_krw: 3000, unit_amount_krw: 3000, copay_amount_krw: 1000, insurer_amount_krw: 2000 }),
      line({
        code: "X9999",
        name: "비급여처치",
        category: "처치료",
        coverage_type: "non_covered",
        amount_krw: 3000,
        unit_amount_krw: 3000,
        copay_amount_krw: 3000,
        insurer_amount_krw: 0,
      }),
    ],
    ...over,
  };
}

describe("StatementDocument", () => {
  it("문서 제목·요양기관·환자·발급 헤더 렌더", () => {
    render(<StatementDocument data={makeReceipt()} />);
    expect(screen.getByText("진료비 세부산정내역서")).toBeInTheDocument();
    expect(screen.getAllByText("○○의원").length).toBeGreaterThanOrEqual(1); // 헤더 + 서명
    expect(screen.getByText("31234567")).toBeInTheDocument(); // 요양기관기호
    expect(screen.getByText("R-20260623-000042", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("내과 · 이정훈")).toBeInTheDocument();
    expect(screen.getByText("김원무")).toBeInTheDocument(); // 발급담당
  });

  it("주민번호는 masked 만(full RRN 부재·PII 경계)", () => {
    render(<StatementDocument data={makeReceipt()} />);
    expect(screen.getByText("900101-1******")).toBeInTheDocument();
    expect(screen.queryByText(/\d{6}-\d{7}/)).toBeNull();
  });

  it("라인별 10컬럼 헤더(항목분류·일자·코드·명칭·단가·횟수·일수·금액·본인부담·공단부담)", () => {
    render(<StatementDocument data={makeReceipt()} />);
    for (const col of [
      "항목분류",
      "일자",
      "코드",
      "명칭",
      "단가",
      "횟수",
      "일수",
      "금액",
      "본인부담",
      "공단부담",
    ]) {
      expect(screen.getByText(col)).toBeInTheDocument();
    }
  });

  it("라인별 행 — 항목분류·코드·명칭·일자(진료일)·횟수↔일수 구분(일수=1 상수)", () => {
    // 횟수 2 라인을 두어 횟수(2 셀)와 일수(1 상수 셀)를 한 행에서 구분 검증
    // (약한 getAllByText("1") 카운트 단언 회피 — 횟수=1 과 일수=1 이 섞이지 않도록).
    const data = makeReceipt({
      details: [
        line({ quantity: 2, unit_amount_krw: 8805, amount_krw: 17610 }),
        line({
          code: "C3800",
          name: "CBC",
          category: "검사료",
          unit_amount_krw: 3000,
          amount_krw: 3000,
          copay_amount_krw: 1000,
          insurer_amount_krw: 2000,
        }),
      ],
    });
    render(<StatementDocument data={data} />);
    const row = screen.getByText("초진진찰료").closest("tr") as HTMLElement;
    const cells = within(row);
    expect(cells.getByText("AA154")).toBeInTheDocument();
    // 일자 = 진료일(외래 단일내원·전 라인 동일·ko-KR 2026 형식).
    expect(cells.getByText(/2026/)).toBeInTheDocument();
    // 횟수 = 2(라인 quantity) · 일수 = 1(상수) — 한 행에서 별개 셀로 구분 렌더.
    expect(cells.getByText("2")).toBeInTheDocument();
    expect(cells.getByText("1")).toBeInTheDocument();
  });

  it("합계 행 = 라인 직접 합(헤더 금액 정합: Σ금액=total·Σ본인=copay·Σ공단=insurer)", () => {
    const data = makeReceipt();
    render(<StatementDocument data={data} />);
    const total = screen.getByText("합계").closest("tr") as HTMLElement;
    const cells = within(total);
    // Σ금액 = 23,610(total_amount_krw) · Σ본인부담 = 9,280(copay) · Σ공단부담 = 14,330(insurer).
    expect(cells.getByText("23,610")).toBeInTheDocument();
    expect(cells.getByText("9,280")).toBeInTheDocument();
    expect(cells.getByText("14,330")).toBeInTheDocument();
    // 헤더 금액과의 정합(불변식) — 라인 합이 헤더 금액과 같음.
    const sumAmount = data.details.reduce((s, d) => s + d.amount_krw, 0);
    const sumCopay = data.details.reduce((s, d) => s + d.copay_amount_krw, 0);
    const sumInsurer = data.details.reduce((s, d) => s + d.insurer_amount_krw, 0);
    expect(sumAmount).toBe(data.total_amount_krw);
    expect(sumCopay).toBe(data.copay_amount_krw);
    expect(sumInsurer).toBe(data.insurer_amount_krw);
  });

  it("합계는 헤더가 아니라 라인에서 도출(line-derived) — 헤더 값과 어긋나도 라인 합 출력", () => {
    // 헤더 금액(total/copay/insurer)을 라인 합과 다른 bogus 값으로 둠 → 합계 행이 헤더가 아닌
    // 라인 합을 렌더함을 실증(픽스처 자기충족 false green 제거). 정상 DB 경로는 헤더=Σ라인(0047 롤업).
    const data = makeReceipt({
      total_amount_krw: 999999,
      copay_amount_krw: 888888,
      insurer_amount_krw: 777777,
    });
    render(<StatementDocument data={data} />);
    const total = screen.getByText("합계").closest("tr") as HTMLElement;
    const cells = within(total);
    // 라인 합(23,610 / 9,280 / 14,330) 렌더 — 헤더 bogus 값 아님.
    expect(cells.getByText("23,610")).toBeInTheDocument();
    expect(cells.getByText("9,280")).toBeInTheDocument();
    expect(cells.getByText("14,330")).toBeInTheDocument();
    // 헤더 bogus 값은 문서 어디에도 렌더되지 않음(헤더 미참조).
    expect(screen.queryByText("999,999")).toBeNull();
    expect(screen.queryByText("888,888")).toBeNull();
    expect(screen.queryByText("777,777")).toBeNull();
  });

  it("비급여 라인 = 본인부담 전액·공단부담 0(DB 산정값 표시)", () => {
    const data = makeReceipt();
    render(<StatementDocument data={data} />);
    const row = screen.getByText("비급여처치").closest("tr") as HTMLElement;
    const cells = within(row);
    expect(cells.getAllByText("3,000").length).toBeGreaterThanOrEqual(1); // 본인부담 = 금액
    expect(cells.getByText("0")).toBeInTheDocument(); // 공단부담 = 0
  });

  it("라인 0건이면 빈 상태", () => {
    render(<StatementDocument data={makeReceipt({ details: [] })} />);
    expect(screen.getByText("청구 항목이 없습니다.")).toBeInTheDocument();
  });

  it("법적 고지(세부산정내역서)", () => {
    render(<StatementDocument data={makeReceipt()} />);
    expect(screen.getByText(/항목별 산정/)).toBeInTheDocument();
  });
});
