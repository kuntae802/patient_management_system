import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExaminationPanel } from "@/components/encounters/examination-panel";
import type { Examination, ExamType } from "@/lib/encounters/examinations";
import type { Encounter } from "@/lib/reception/encounters";

// 검사·영상 패널(Story 5.3·5.5, controlled) — createExamination·MasterSearchPicker(스텁)·sonner 모킹.
// ⚠️ exam_type 토글 제거(탭이 examType prop 결정). 검증: 빈 상태·examType 으로 create+onReload·목록(pay-chip).
vi.mock("@/lib/encounters/examinations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/encounters/examinations")>();
  return { ...actual, createExamination: vi.fn() };
});
vi.mock("@/components/ui/master-search-picker", () => ({
  MasterSearchPicker: ({
    id,
    disabled,
    onValueChange,
  }: {
    id?: string;
    disabled?: boolean;
    onValueChange: (v: unknown) => void;
  }) => (
    <input
      id={id}
      data-testid="exam-picker"
      disabled={disabled}
      onChange={(e) =>
        onValueChange({
          id: e.target.value,
          code: `F-${e.target.value}`,
          name: `행위-${e.target.value}`,
          kind: "fee_schedule",
          is_active: true,
          effective_from: "2020-01-01",
          effective_to: null,
          category: "검사료",
          amount_krw: 3500,
        })
      }
    />
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { createExamination } from "@/lib/encounters/examinations";

const mockCreate = vi.mocked(createExamination);

afterEach(() => vi.clearAllMocks());

const ENC = { id: "e1" } as Encounter;
const NOW = Date.parse("2026-06-22T00:00:00Z");

function makeExam(over: Partial<Examination> = {}): Examination {
  return {
    id: "ex1",
    encounter_id: "e1",
    exam_type: "imaging",
    fee_schedule_id: "fs1",
    fee_code: "HA201",
    fee_name: "흉부 단순촬영(1매)",
    fee_category: "영상료",
    amount_krw: 9030,
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

function renderPanel(
  examType: ExamType,
  examinations: Examination[] | null,
  nowMs = NOW,
) {
  const onReload = vi.fn().mockResolvedValue(undefined);
  render(
    <ExaminationPanel
      encounter={ENC}
      today="2026-06-22"
      examType={examType}
      examinations={examinations}
      nowMs={nowMs}
      onReload={onReload}
    />,
  );
  return { onReload };
}

function pickFee(id: string) {
  fireEvent.change(screen.getByTestId("exam-picker"), {
    target: { value: id },
  });
}

describe("ExaminationPanel (controlled)", () => {
  it("빈 상태는 탭 유형 라벨로 표시한다(진단검사)", () => {
    renderPanel("lab", []);
    expect(screen.getByText("오더된 진단검사 없음")).toBeInTheDocument();
  });

  it("lab 탭에서 선택하면 exam_type=lab 으로 오더하고 onReload 한다", async () => {
    mockCreate.mockResolvedValue(makeExam({ exam_type: "lab" }));
    const { onReload } = renderPanel("lab", []);
    pickFee("C3800");
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith("e1", {
      exam_type: "lab",
      fee_schedule_id: "C3800",
    });
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
  });

  it("imaging 탭에서 선택하면 exam_type=imaging 으로 오더한다(FR-061 라우팅)", async () => {
    mockCreate.mockResolvedValue(makeExam());
    renderPanel("imaging", []);
    pickFee("HA201");
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith("e1", {
      exam_type: "imaging",
      fee_schedule_id: "HA201",
    });
  });

  it("오더된 목록을 렌더한다(행위·pay-chip 급여·추적 라인)", () => {
    renderPanel("imaging", [makeExam()]);
    expect(screen.getByText("HA201")).toBeInTheDocument();
    expect(screen.getByText("흉부 단순촬영(1매)")).toBeInTheDocument();
    expect(screen.getByText("급여")).toBeInTheDocument(); // pay-chip
    expect(screen.getByText("김의사")).toBeInTheDocument(); // 추적 라인
  });

  it("지시 후 임계치 초과 미수행이면 지연 배지를 표시한다", () => {
    renderPanel("lab", [makeExam({ exam_type: "lab" })], NOW + 35 * 60_000);
    expect(screen.getByText(/지연 35분/)).toBeInTheDocument();
  });
});
