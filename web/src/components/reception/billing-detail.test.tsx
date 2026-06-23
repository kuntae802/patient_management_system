import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BillingDetail } from "@/components/reception/billing-detail";

// 수납 집계·결제 상세(Story 7.2/7.3/7.4) — build/finalizePayment 모킹. 검증: 진입 시 build 호출(멱등)·헤더·
// "자동 산정" 마커·라인·pay-chip·빈 상태·403·신원 배너·결제수단 토글·신원 재진술 confirm·finalize·완료 패널.
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));
vi.mock("@/lib/billing/payments", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/billing/payments")>();
  return {
    ...actual,
    buildPayment: vi.fn(),
    finalizePayment: vi.fn(),
    fetchReceipt: vi.fn(),
    exportReceipt: vi.fn(),
  };
});
vi.mock("@/lib/billing/prescriptions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/billing/prescriptions")>();
  return {
    ...actual,
    fetchPrescriptionDocument: vi.fn(),
    dispensePrescription: vi.fn(),
    exportPrescriptionDocument: vi.fn(),
  };
});
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

import { ApiError } from "@/lib/api/client";
import {
  buildPayment,
  exportReceipt,
  fetchReceipt,
  finalizePayment,
  type Payment,
  type PaymentDetail,
  type Receipt,
} from "@/lib/billing/payments";

import {
  dispensePrescription,
  exportPrescriptionDocument,
  fetchPrescriptionDocument,
  type PrescriptionDocument as PrescriptionDoc,
} from "@/lib/billing/prescriptions";

const mockBuild = vi.mocked(buildPayment);
const mockFinalize = vi.mocked(finalizePayment);
const mockFetchReceipt = vi.mocked(fetchReceipt);
const mockExportReceipt = vi.mocked(exportReceipt);
const mockFetchRx = vi.mocked(fetchPrescriptionDocument);
const mockDispense = vi.mocked(dispensePrescription);
const mockExportRx = vi.mocked(exportPrescriptionDocument);

function makePrescriptionDoc(
  over: Partial<PrescriptionDoc> = {},
): PrescriptionDoc {
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
    prescriptions: [
      {
        id: "rx-1",
        status: "issued",
        ordered_at: "2026-06-24T01:00:00Z",
        dispensed_at: null,
        prescriber: {
          name: "이정훈",
          license_type: "doctor",
          license_no: "12345",
        },
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
      },
    ],
    ...over,
  };
}

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
    total_amount_krw: 17610,
    covered_amount_krw: 17610,
    non_covered_amount_krw: 0,
    copay_amount_krw: 5280,
    insurer_amount_krw: 12330,
    paid_amount_krw: 5280,
    due_amount_krw: 0,
    details: [makeLine({ copay_amount_krw: 5280, insurer_amount_krw: 12330 })],
    ...over,
  };
}

function makeLine(over: Partial<PaymentDetail> = {}): PaymentDetail {
  return {
    id: "pd-1",
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
    copay_rate: null,
    copay_amount_krw: 0,
    insurer_amount_krw: 0,
    created_at: "2026-06-23T01:00:00Z",
    updated_at: "2026-06-23T01:00:00Z",
    ...over,
  };
}

function makePayment(over: Partial<Payment> = {}): Payment {
  return {
    id: "pay-1",
    encounter_id: "enc-1",
    status: "draft",
    billing_type: "postpaid",
    insurance_type: "health_insurance",
    patient_name: "홍길동",
    chart_no: "C-0001",
    total_amount_krw: 17610,
    covered_amount_krw: 17610,
    non_covered_amount_krw: 0,
    copay_amount_krw: 0,
    insurer_amount_krw: 0,
    paid_amount_krw: 0,
    payment_method: null,
    payment_no: null,
    finalized_at: null,
    finalized_by: null,
    cancelled_at: null,
    cancel_reason: null,
    created_at: "2026-06-23T01:00:00Z",
    updated_at: "2026-06-23T01:00:00Z",
    details: [makeLine()],
    ...over,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("BillingDetail", () => {
  it("진입 시 build_payment 멱등 호출 + 헤더 총/급여/비급여 + 자동 산정 마커", async () => {
    mockBuild.mockResolvedValue(
      makePayment({
        total_amount_krw: 20810,
        covered_amount_krw: 17610,
        non_covered_amount_krw: 3200,
      }),
    );
    render(<BillingDetail encounterId="enc-1" />);

    await waitFor(() => expect(mockBuild).toHaveBeenCalledWith("enc-1"));
    expect(await screen.findByText("자동 산정")).toBeInTheDocument(); // UX-DR14 teal 마커
    expect(screen.getByText("20,810")).toBeInTheDocument(); // 총 진료비
    expect(screen.getByText("3,200")).toBeInTheDocument(); // 비급여
  });

  it("본인부담금·공단부담금 + 보험유형 근거 렌더(7.3)", async () => {
    mockBuild.mockResolvedValue(
      makePayment({
        insurance_type: "health_insurance",
        total_amount_krw: 15790,
        covered_amount_krw: 12590,
        non_covered_amount_krw: 3200,
        copay_amount_krw: 6970,
        insurer_amount_krw: 8820,
      }),
    );
    render(<BillingDetail encounterId="enc-1" />);
    expect(await screen.findByText("6,970")).toBeInTheDocument(); // 본인부담금(환자 청구)
    expect(screen.getByText("8,820")).toBeInTheDocument(); // 공단부담금
    expect(screen.getByText("건강보험")).toBeInTheDocument(); // 보험유형 근거 칩
  });

  it("상세 라인 — code·행위명·금액·pay-chip(급여) 렌더", async () => {
    mockBuild.mockResolvedValue(makePayment());
    render(<BillingDetail encounterId="enc-1" />);
    expect(await screen.findByText("AA154")).toBeInTheDocument();
    expect(screen.getByText("초진진찰료")).toBeInTheDocument();
    // "급여" = 헤더 금액 라벨 + 라인 PayChip(coverageLabel) 둘 다 렌더(covered 라인).
    expect(screen.getAllByText("급여").length).toBeGreaterThanOrEqual(2);
  });

  it("집계 라인 0건이면 빈 상태", async () => {
    mockBuild.mockResolvedValue(
      makePayment({ details: [], total_amount_krw: 0, covered_amount_krw: 0 }),
    );
    render(<BillingDetail encounterId="enc-1" />);
    expect(
      await screen.findByText(/집계된 수가 항목이 없습니다/),
    ).toBeInTheDocument();
  });

  it("권한(403) 에러 시 '수납 권한이 없습니다' 표시", async () => {
    mockBuild.mockRejectedValue(
      new ApiError("forbidden", "권한이 없습니다.", 403),
    );
    render(<BillingDetail encounterId="enc-1" />);
    expect(
      await screen.findByText("수납 권한이 없습니다."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "다시 시도" }),
    ).toBeInTheDocument();
  });

  // ── Story 7.4: 결제·내원 완료 ──────────────────────────────────────────────

  it("상시 신원 배너(이름·차트번호) + 미수납 배지(draft)", async () => {
    mockBuild.mockResolvedValue(makePayment());
    render(<BillingDetail encounterId="enc-1" />);
    expect(await screen.findByText("홍길동")).toBeInTheDocument();
    expect(screen.getByText("차트 C-0001")).toBeInTheDocument();
    expect(screen.getByText("미수납")).toBeInTheDocument();
  });

  it("결제수단 토글 + 신원 재진술 confirm → finalize 성공 시 완료 패널", async () => {
    mockBuild.mockResolvedValue(makePayment({ copay_amount_krw: 5280 }));
    mockFinalize.mockResolvedValue(
      makePayment({
        status: "finalized",
        payment_method: "cash",
        payment_no: "R-20260623-000042",
        copay_amount_krw: 5280,
        paid_amount_krw: 5280,
        finalized_at: "2026-06-23T05:00:00Z",
      }),
    );
    render(<BillingDetail encounterId="enc-1" />);
    // 결제수단 현금 선택.
    await userEvent.click(await screen.findByRole("radio", { name: "현금" }));
    // 결제 버튼 → 신원 재진술 confirm(이름·차트번호 표시).
    await userEvent.click(
      screen.getByRole("button", { name: "결제·내원 완료" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/홍길동/)).toBeInTheDocument();
    expect(within(dialog).getByText(/C-0001/)).toBeInTheDocument();
    // 확정 → finalize(선택한 현금) 호출.
    await userEvent.click(
      within(dialog).getByRole("button", { name: "결제·내원 완료" }),
    );
    await waitFor(() =>
      expect(mockFinalize).toHaveBeenCalledWith("enc-1", "cash"),
    );
    // 완료 패널(영수증번호·성공 토스트).
    expect(await screen.findByText("결제 완료")).toBeInTheDocument();
    expect(screen.getByText("R-20260623-000042")).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("finalized 상태 → 완료 패널·결제수단 토글 없음·완료 배지", async () => {
    mockBuild.mockResolvedValue(
      makePayment({
        status: "finalized",
        payment_method: "transfer",
        payment_no: "R-20260623-000001",
        paid_amount_krw: 5280,
        finalized_at: "2026-06-23T05:00:00Z",
      }),
    );
    render(<BillingDetail encounterId="enc-1" />);
    expect(await screen.findByText("결제 완료")).toBeInTheDocument();
    expect(screen.getByText("R-20260623-000001")).toBeInTheDocument();
    expect(screen.getByText("계좌이체")).toBeInTheDocument();
    // "완료" 배지 = 상시 신원 배너 + 완료 패널 양쪽(finalized 상태).
    expect(screen.getAllByText("완료").length).toBeGreaterThanOrEqual(2);
    expect(
      screen.queryByRole("button", { name: "결제·내원 완료" }),
    ).not.toBeInTheDocument();
    // 문서 출력(7.5) = 활성 버튼(UX-DR14 "결제 완료 → 문서 출력" 게이트·클릭 시 영수증 미리보기).
    const docBtn = screen.getByRole("button", { name: /문서 출력/ });
    expect(docBtn).toBeInTheDocument();
    expect(docBtn).toBeEnabled();
  });

  // ── Story 7.5: 진료비 계산서·영수증 문서 출력 ───────────────────────────────

  it("문서 출력 클릭 → fetchReceipt → 법정 서식 미리보기(병원·항목별 금액·납부 3행)", async () => {
    mockBuild.mockResolvedValue(
      makePayment({
        status: "finalized",
        payment_no: "R-20260623-000042",
        paid_amount_krw: 5280,
      }),
    );
    mockFetchReceipt.mockResolvedValue(makeReceipt());
    render(<BillingDetail encounterId="enc-1" />);
    await userEvent.click(
      await screen.findByRole("button", { name: /문서 출력/ }),
    );
    await waitFor(() => expect(mockFetchReceipt).toHaveBeenCalledWith("enc-1"));
    // 법정 서식 렌더(요양기관·문서 제목·납부 3행 라벨·masked RRN).
    expect(
      await screen.findByText("진료비 계산서 · 영수증"),
    ).toBeInTheDocument();
    expect(screen.getByText("31234567")).toBeInTheDocument(); // 요양기관기호
    expect(screen.getByText("900101-1******")).toBeInTheDocument(); // masked RRN
    expect(screen.getByText("납부할 금액")).toBeInTheDocument(); // 3행 합계
    expect(screen.getByText("항목별 금액")).toBeInTheDocument();
  });

  it("인쇄 버튼 → window.print + beforeprint 시 exportReceipt 감사 호출", async () => {
    mockBuild.mockResolvedValue(
      makePayment({ status: "finalized", paid_amount_krw: 5280 }),
    );
    mockFetchReceipt.mockResolvedValue(makeReceipt());
    mockExportReceipt.mockResolvedValue(undefined);
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<BillingDetail encounterId="enc-1" />);
    await userEvent.click(
      await screen.findByRole("button", { name: /문서 출력/ }),
    );
    await screen.findByText("진료비 계산서 · 영수증");
    // 인쇄 버튼 → window.print().
    await userEvent.click(
      screen.getByRole("button", { name: /인쇄 \/ PDF 저장/ }),
    );
    expect(printSpy).toHaveBeenCalled();
    // 인쇄/내보내기 = 감사(beforeprint 리스너 — 네이티브 Ctrl P 포함). 각 인쇄 1 감사.
    window.dispatchEvent(new Event("beforeprint"));
    await waitFor(() =>
      expect(mockExportReceipt).toHaveBeenCalledWith("enc-1", "receipt"),
    );
    printSpy.mockRestore();
  });

  it("문서 출력 실패(403) → 에러 토스트·미리보기 미표시", async () => {
    mockBuild.mockResolvedValue(
      makePayment({ status: "finalized", paid_amount_krw: 5280 }),
    );
    mockFetchReceipt.mockRejectedValue(
      new ApiError("forbidden", "수납 권한이 없습니다.", 403),
    );
    render(<BillingDetail encounterId="enc-1" />);
    await userEvent.click(
      await screen.findByRole("button", { name: /문서 출력/ }),
    );
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(
      screen.queryByText("진료비 계산서 · 영수증"),
    ).not.toBeInTheDocument();
  });

  it("finalize 실패(주상병 미지정 422) → 에러 토스트", async () => {
    mockBuild.mockResolvedValue(makePayment());
    mockFinalize.mockRejectedValue(
      new ApiError(
        "primary_diagnosis_required",
        "주상병을 1개 지정해야 합니다.",
        422,
      ),
    );
    render(<BillingDetail encounterId="enc-1" />);
    await userEvent.click(
      await screen.findByRole("button", { name: "결제·내원 완료" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "결제·내원 완료" }),
    );
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  // ── Story 7.6: 진료비 세부산정내역서 문서 탭 ────────────────────────────────

  it("미리보기 = 문서 탭 2개(영수증 기본·세부산정내역서 전환 시 라인별 표 렌더)", async () => {
    mockBuild.mockResolvedValue(
      makePayment({ status: "finalized", paid_amount_krw: 5280 }),
    );
    mockFetchReceipt.mockResolvedValue(makeReceipt());
    render(<BillingDetail encounterId="enc-1" />);
    await userEvent.click(
      await screen.findByRole("button", { name: /문서 출력/ }),
    );
    // 기본 탭 = 영수증(7.5).
    expect(
      await screen.findByText("진료비 계산서 · 영수증"),
    ).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    // 세부산정내역서 탭 클릭 → 라인별 표(StatementDocument) 렌더·영수증 미렌더.
    await userEvent.click(screen.getByRole("tab", { name: "세부산정내역서" }));
    expect(
      await screen.findByText("진료비 세부산정내역서"),
    ).toBeInTheDocument();
    expect(screen.getByText("항목분류")).toBeInTheDocument(); // FR-114 라인별 컬럼
    expect(
      screen.queryByText("진료비 계산서 · 영수증"),
    ).not.toBeInTheDocument();
  });

  it("세부산정내역서 탭 활성 시 beforeprint → exportReceipt(eid, 'statement') 감사", async () => {
    mockBuild.mockResolvedValue(
      makePayment({ status: "finalized", paid_amount_krw: 5280 }),
    );
    mockFetchReceipt.mockResolvedValue(makeReceipt());
    mockExportReceipt.mockResolvedValue(undefined);
    render(<BillingDetail encounterId="enc-1" />);
    await userEvent.click(
      await screen.findByRole("button", { name: /문서 출력/ }),
    );
    await screen.findByText("진료비 계산서 · 영수증");
    // 세부산정내역서 탭으로 전환 → beforeprint 감사 document_type 도 statement.
    await userEvent.click(screen.getByRole("tab", { name: "세부산정내역서" }));
    await screen.findByText("진료비 세부산정내역서");
    window.dispatchEvent(new Event("beforeprint"));
    await waitFor(() =>
      expect(mockExportReceipt).toHaveBeenCalledWith("enc-1", "statement"),
    );
  });

  // ── Story 7.7: 원외처방전 출력·발급 ─────────────────────────────────────────

  it("발행 처방 있으면 원외처방전 섹션 노출(발급 확정·출력 버튼·payment draft 무관)", async () => {
    mockBuild.mockResolvedValue(makePayment({ status: "draft" }));
    mockFetchRx.mockResolvedValue(makePrescriptionDoc());
    render(<BillingDetail encounterId="enc-1" />);
    await waitFor(() => expect(mockFetchRx).toHaveBeenCalledWith("enc-1"));
    expect(await screen.findByText("원외처방전")).toBeInTheDocument();
    expect(screen.getByText("발행")).toBeInTheDocument(); // issued 상태 배지
    expect(
      screen.getByRole("button", { name: "발급 확정" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "출력" })).toBeInTheDocument();
  });

  it("발급 확정 → 신원 재진술 confirm → dispensePrescription 호출 + 재조회", async () => {
    mockBuild.mockResolvedValue(makePayment({ status: "draft" }));
    mockFetchRx.mockResolvedValue(makePrescriptionDoc());
    mockDispense.mockResolvedValue(undefined);
    render(<BillingDetail encounterId="enc-1" />);
    await userEvent.click(
      await screen.findByRole("button", { name: "발급 확정" }),
    );
    // confirm 다이얼로그의 발급 확정 클릭(신원 재진술·UX-DR21).
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "발급 확정" }),
    );
    await waitFor(() =>
      expect(mockDispense).toHaveBeenCalledWith("enc-1", "rx-1"),
    );
    expect(toastSuccess).toHaveBeenCalled();
    // 발급 후 문서 재조회(상태 갱신) — fetchRx 2회(초기 + 발급 후).
    await waitFor(() => expect(mockFetchRx).toHaveBeenCalledTimes(2));
  });

  it("이미 발급(dispensed)된 처방 → 발급 확정 버튼 없음(출력만)", async () => {
    mockBuild.mockResolvedValue(makePayment({ status: "draft" }));
    mockFetchRx.mockResolvedValue(
      makePrescriptionDoc({
        prescriptions: [
          {
            id: "rx-1",
            status: "dispensed",
            ordered_at: "2026-06-24T01:00:00Z",
            dispensed_at: "2026-06-24T02:00:00Z",
            prescriber: {
              name: "이정훈",
              license_type: "doctor",
              license_no: "12345",
            },
            diagnosis: null,
            drugs: [],
          },
        ],
      }),
    );
    render(<BillingDetail encounterId="enc-1" />);
    expect(await screen.findByText("발급")).toBeInTheDocument(); // dispensed 배지
    expect(
      screen.queryByRole("button", { name: "발급 확정" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "출력" })).toBeInTheDocument();
  });

  it("출력 → 처방전 미리보기 + beforeprint → exportPrescriptionDocument 감사", async () => {
    mockBuild.mockResolvedValue(makePayment({ status: "draft" }));
    mockFetchRx.mockResolvedValue(makePrescriptionDoc());
    mockExportRx.mockResolvedValue(undefined);
    render(<BillingDetail encounterId="enc-1" />);
    await userEvent.click(await screen.findByRole("button", { name: "출력" }));
    // 법정 서식 미리보기(처방전 컴포넌트 — "원외처방전" 제목 + 약품 라인).
    expect(await screen.findByText("타이레놀정500mg")).toBeInTheDocument();
    // 인쇄=감사(beforeprint → 활성 처방 1매 export).
    window.dispatchEvent(new Event("beforeprint"));
    await waitFor(() =>
      expect(mockExportRx).toHaveBeenCalledWith("enc-1", "rx-1"),
    );
  });
});
