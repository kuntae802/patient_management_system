import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PrescriptionDocument } from "@/components/reception/prescription-document";
import type {
  PrescriptionDocItem,
  PrescriptionDocument as PrescriptionDoc,
} from "@/lib/billing/prescriptions";

// 원외처방전 법정 서식(Story 7.7 / FR-115·FR-050). 문서 제목·요양기관·환자(masked RRN·full 부재)·
// 질병분류기호(KCD)·처방 의약품 표(명칭·1회량·1일횟수·총일수·용법)·처방의 면허·사용기간·법적 고지.

function makeDoc(over: Partial<PrescriptionDoc> = {}): PrescriptionDoc {
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
      birth_date: "1990-01-01",
      sex: "male",
    },
    encounter: { department_name: "내과", doctor_name: "이정훈" },
    prescriptions: [],
    ...over,
  };
}

function makeRx(over: Partial<PrescriptionDocItem> = {}): PrescriptionDocItem {
  return {
    id: "11112222-3333-4444-5555-666677778888",
    status: "issued",
    ordered_at: "2026-06-24T01:00:00Z",
    dispensed_at: null,
    prescriber: { name: "이정훈", license_type: "doctor", license_no: "12345" },
    diagnosis: { code: "I10", name: "본태성 고혈압" },
    drugs: [
      {
        drug_code: "645100250",
        drug_name: "타이레놀정500mg",
        drug_unit: "정",
        dose: 1,
        frequency: "TID",
        duration_days: 3,
        usage_instruction: "식후 30분",
      },
    ],
    ...over,
  };
}

describe("PrescriptionDocument", () => {
  it("문서 제목·요양기관·환자 헤더 렌더", () => {
    render(<PrescriptionDocument data={makeDoc()} prescription={makeRx()} />);
    expect(screen.getByText("원외처방전")).toBeInTheDocument();
    expect(screen.getByText("31234567")).toBeInTheDocument(); // 요양기관기호
    expect(screen.getByText("홍길동")).toBeInTheDocument();
    expect(screen.getByText("C-0001")).toBeInTheDocument();
    expect(screen.getByText("내과 · 건강보험")).toBeInTheDocument();
  });

  it("주민번호는 masked 만(full RRN 부재·PII 경계)", () => {
    render(<PrescriptionDocument data={makeDoc()} prescription={makeRx()} />);
    expect(screen.getByText("900101-1******")).toBeInTheDocument();
    expect(screen.queryByText(/\d{6}-\d{7}/)).toBeNull();
  });

  it("질병분류기호(KCD code+명칭) 렌더", () => {
    render(<PrescriptionDocument data={makeDoc()} prescription={makeRx()} />);
    expect(screen.getByText(/I10/)).toBeInTheDocument();
    expect(screen.getByText(/본태성 고혈압/)).toBeInTheDocument();
  });

  it("처방 의약품 표 — 명칭·1회량·1일횟수·총일수·용법(FR-050)", () => {
    render(<PrescriptionDocument data={makeDoc()} prescription={makeRx()} />);
    expect(screen.getByText("처방 의약품의 명칭")).toBeInTheDocument();
    expect(screen.getByText("1회 투약량")).toBeInTheDocument();
    expect(screen.getByText("1일 투여횟수")).toBeInTheDocument();
    expect(screen.getByText("총 투여일수")).toBeInTheDocument();
    // 라인 값 — 약품 행으로 스코프(일수 "3일"은 사용기간 문구와 충돌하므로 행 내부 단언).
    const drugRow = screen
      .getByText("타이레놀정500mg")
      .closest("tr") as HTMLElement;
    expect(within(drugRow).getByText("1 정")).toBeInTheDocument();
    expect(within(drugRow).getByText("TID")).toBeInTheDocument();
    expect(within(drugRow).getByText("3일")).toBeInTheDocument();
    expect(within(drugRow).getByText("식후 30분")).toBeInTheDocument();
  });

  it("처방 의료인 면허(종류·번호) + 미발급 표시", () => {
    render(<PrescriptionDocument data={makeDoc()} prescription={makeRx()} />);
    expect(screen.getByText(/의사 면허번호/)).toBeInTheDocument();
    expect(screen.getByText("12345")).toBeInTheDocument();
    // issued(미발급) → 발급일자 "미발급".
    expect(screen.getByText("미발급")).toBeInTheDocument();
  });

  it("발급(dispensed) 처방 → 발급일자 렌더(미발급 부재)", () => {
    render(
      <PrescriptionDocument
        data={makeDoc()}
        prescription={makeRx({
          status: "dispensed",
          dispensed_at: "2026-06-24T02:00:00Z",
        })}
      />,
    );
    expect(screen.queryByText("미발급")).toBeNull();
  });

  it("약품 0건 → 빈 상태 행", () => {
    render(
      <PrescriptionDocument
        data={makeDoc()}
        prescription={makeRx({ drugs: [] })}
      />,
    );
    expect(screen.getByText("처방 의약품이 없습니다.")).toBeInTheDocument();
  });

  it("근거 진단 없으면 질병분류기호 — (FR-051 nullable)", () => {
    render(
      <PrescriptionDocument
        data={makeDoc()}
        prescription={makeRx({ diagnosis: null })}
      />,
    );
    const label = screen.getByText("질병분류기호");
    const cell = label.nextElementSibling as HTMLElement;
    expect(within(cell).getByText("—")).toBeInTheDocument();
  });

  it("사용기간·법적 고지(원외 약국 조제)", () => {
    render(<PrescriptionDocument data={makeDoc()} prescription={makeRx()} />);
    expect(screen.getByText(/교부일로부터/)).toBeInTheDocument();
    expect(screen.getByText(/원외 약국/)).toBeInTheDocument();
    expect(screen.getByText(/국민건강보험법 시행규칙/)).toBeInTheDocument();
  });
});
