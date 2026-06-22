import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrderPanel } from "@/components/encounters/order-panel";
import type { Examination } from "@/lib/encounters/examinations";
import type { Prescription } from "@/lib/encounters/prescriptions";
import type { TreatmentOrder } from "@/lib/encounters/treatment-orders";
import type { Encounter } from "@/lib/reception/encounters";

// 오더 패널 오케스트레이터(Story 5.5) — 4종 fetch·diagnoses·picker·sonner 모킹. 데이터 리프트 후 탭/카운트/
// 수가 프리뷰/디텍터 집계 검증. 자식 패널은 실제 렌더(controlled). Date.now 고정(디텍터 결정성).
vi.mock("@/lib/encounters/prescriptions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/encounters/prescriptions")>();
  return {
    ...actual,
    fetchPrescriptions: vi.fn(),
    createPrescription: vi.fn(),
  };
});
vi.mock("@/lib/encounters/examinations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/encounters/examinations")>();
  return { ...actual, fetchExaminations: vi.fn(), createExamination: vi.fn() };
});
vi.mock("@/lib/encounters/treatment-orders", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/encounters/treatment-orders")>();
  return {
    ...actual,
    fetchTreatmentOrders: vi.fn(),
    createTreatmentOrder: vi.fn(),
  };
});
vi.mock("@/lib/encounters/diagnoses", () => ({
  fetchEncounterDiagnoses: vi.fn(),
}));
vi.mock("@/components/ui/master-search-picker", () => ({
  MasterSearchPicker: ({ id }: { id?: string }) => (
    <input id={id} data-testid={id} />
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { fetchEncounterDiagnoses } from "@/lib/encounters/diagnoses";
import { fetchExaminations } from "@/lib/encounters/examinations";
import { fetchPrescriptions } from "@/lib/encounters/prescriptions";
import { fetchTreatmentOrders } from "@/lib/encounters/treatment-orders";

const mockRx = vi.mocked(fetchPrescriptions);
const mockEx = vi.mocked(fetchExaminations);
const mockTr = vi.mocked(fetchTreatmentOrders);
const mockDx = vi.mocked(fetchEncounterDiagnoses);

const NOW = Date.parse("2026-06-22T00:00:00Z");

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  mockDx.mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

const ENC = { id: "e1" } as Encounter;

function makeRx(): Prescription {
  return {
    id: "rx1",
    encounter_id: "e1",
    encounter_diagnosis_id: null,
    status: "issued",
    ordered_by: "d1",
    ordered_by_name: "김의사",
    ordered_at: "2026-06-22T00:00:00Z",
    dispensed_at: null,
    is_active: true,
    created_at: "2026-06-22T00:00:00Z",
    updated_at: "2026-06-22T00:00:00Z",
    details: [
      {
        id: "pd1",
        prescription_id: "rx1",
        drug_id: "dr1",
        drug_code: "645100250",
        drug_name: "타이레놀정500밀리그람",
        ingredient_code: "153002ATB",
        coverage_type: "covered",
        dose: null,
        frequency: null,
        duration_days: null,
        usage_instruction: null,
        is_active: true,
        created_at: "x",
        updated_at: "x",
      },
    ],
  };
}

function makeExam(over: Partial<Examination>): Examination {
  return {
    id: "ex1",
    encounter_id: "e1",
    exam_type: "lab",
    fee_schedule_id: "fs1",
    fee_code: "C3800",
    fee_name: "일반혈액검사(CBC)",
    fee_category: "검사료",
    amount_krw: 3500,
    coverage_type: "covered",
    status: "ordered",
    ordered_by: "d1",
    ordered_by_name: "김의사",
    ordered_at: "2026-06-22T00:00:00Z",
    equipment_id: null,
    performed_by: null,
    performed_by_name: null,
    performed_at: null,
    completed_by: null,
    completed_at: null,
    is_active: true,
    created_at: "2026-06-22T00:00:00Z",
    updated_at: "2026-06-22T00:00:00Z",
    ...over,
  };
}

function makeTreatment(over: Partial<TreatmentOrder> = {}): TreatmentOrder {
  return {
    id: "tr1",
    encounter_id: "e1",
    fee_schedule_id: "fs9",
    fee_code: "MM151",
    fee_name: "TENS",
    fee_category: "처치료",
    amount_krw: 3200,
    coverage_type: "non_covered",
    status: "ordered",
    ordered_by: "d1",
    ordered_by_name: "김의사",
    ordered_at: "2026-06-22T00:00:00Z",
    performed_by: null,
    performed_by_name: null,
    performed_at: null,
    is_active: true,
    created_at: "2026-06-22T00:00:00Z",
    updated_at: "2026-06-22T00:00:00Z",
    ...over,
  };
}

function setup(
  opts: {
    rx?: Prescription[];
    ex?: Examination[];
    tr?: TreatmentOrder[];
  } = {},
) {
  mockRx.mockResolvedValue(opts.rx ?? []);
  mockEx.mockResolvedValue(opts.ex ?? []);
  mockTr.mockResolvedValue(opts.tr ?? []);
  render(<OrderPanel encounter={ENC} patient={null} today="2026-06-22" />);
}

describe("OrderPanel (orchestrator)", () => {
  it("4개 탭(처방/검사/영상/처치)을 카운트와 함께 렌더한다", async () => {
    setup({
      rx: [makeRx()],
      ex: [
        makeExam({ exam_type: "lab" }),
        makeExam({ id: "ex2", exam_type: "imaging" }),
      ],
      tr: [makeTreatment()],
    });
    expect(
      await screen.findByRole("tab", { name: /처방/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /검사/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /영상/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /처치/ })).toBeInTheDocument();
  });

  it("기본 탭은 처방 — 처방 목록을 보여준다", async () => {
    setup({ rx: [makeRx()] });
    expect(
      await screen.findByText("타이레놀정500밀리그람"),
    ).toBeInTheDocument();
  });

  it("검사 탭 클릭 시 lab 검사를 보여준다", async () => {
    setup({
      ex: [
        makeExam({ exam_type: "lab" }),
        makeExam({ id: "ex2", exam_type: "imaging" }),
      ],
    });
    await screen.findByRole("tab", { name: /검사/ });
    fireEvent.click(screen.getByRole("tab", { name: /검사/ }));
    expect(await screen.findByText("C3800")).toBeInTheDocument();
  });

  it("수가 자동 산정 프리뷰 — 급여/비급여 소계와 합계(처방 제외)", async () => {
    setup({
      rx: [makeRx()], // 처방은 약가 없음 → 프리뷰 제외
      ex: [makeExam({ amount_krw: 3500, coverage_type: "covered" })],
      tr: [makeTreatment({ amount_krw: 3200, coverage_type: "non_covered" })],
    });
    const marker = await screen.findByText("자동 산정");
    const box = marker.closest(".rounded-md");
    expect(box?.textContent).toContain("6,700"); // 3500 급여 + 3200 비급여
    expect(box?.textContent).toContain("급여 3,500");
    expect(box?.textContent).toContain("비급여 3,200");
  });

  it("미수행 지연 오더가 있으면 디텍터 배너를 표시한다", async () => {
    setup({
      ex: [makeExam({ ordered_at: "2026-06-21T23:20:00Z" })], // 40분 전(임계 30 초과)
    });
    expect(await screen.findByText(/지연 미수행 오더 1건/)).toBeInTheDocument();
  });

  it("지연 오더가 없으면 디텍터 배너를 표시하지 않는다", async () => {
    setup({ ex: [makeExam({ ordered_at: "2026-06-22T00:00:00Z" })] }); // 0분 경과
    await screen.findByRole("tab", { name: /검사/ });
    expect(screen.queryByText(/지연 미수행 오더/)).not.toBeInTheDocument();
  });
});
