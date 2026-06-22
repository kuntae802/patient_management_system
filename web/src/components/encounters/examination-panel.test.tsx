import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExaminationPanel } from "@/components/encounters/examination-panel";
import type { Examination } from "@/lib/encounters/examinations";
import type { Encounter } from "@/lib/reception/encounters";

// 검사·영상 패널(Story 5.3) — examinations lib·MasterSearchPicker(스텁)·sonner 모킹.
// 검증: 빈 상태·exam_type 토글(기본 lab)·행위 선택→현재 exam_type 으로 createExamination→reload·목록 렌더.
vi.mock("@/lib/encounters/examinations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/encounters/examinations")>();
  return { ...actual, fetchExaminations: vi.fn(), createExamination: vi.fn() };
});
// MasterSearchPicker 는 Supabase 직접조회 → 스텁. onChange 값 = fee_schedule_id.
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

import { createExamination, fetchExaminations } from "@/lib/encounters/examinations";

const mockFetch = vi.mocked(fetchExaminations);
const mockCreate = vi.mocked(createExamination);

afterEach(() => vi.clearAllMocks());

const ENC = { id: "e1" } as Encounter;

function renderPanel() {
  return render(<ExaminationPanel encounter={ENC} today="2026-06-22" />);
}

function pickFee(id: string) {
  fireEvent.change(screen.getByTestId("exam-picker"), { target: { value: id } });
}

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
    status: "ordered",
    ordered_by: "d1",
    ordered_at: "2026-06-22T00:00:00Z",
    equipment_id: null,
    performed_by: null,
    performed_at: null,
    completed_by: null,
    completed_at: null,
    is_active: true,
    created_at: "2026-06-22T00:00:00Z",
    updated_at: "2026-06-22T00:00:00Z",
    ...over,
  };
}

describe("ExaminationPanel", () => {
  it("오더된 검사·영상이 없으면 빈 상태를 표시한다", async () => {
    mockFetch.mockResolvedValue([]);
    renderPanel();
    expect(await screen.findByText("오더된 검사·영상 없음")).toBeInTheDocument();
  });

  it("행위 선택 시 현재 exam_type(기본 lab)으로 createExamination 을 호출하고 재조회한다", async () => {
    mockFetch.mockResolvedValue([]);
    mockCreate.mockResolvedValue(makeExam({ exam_type: "lab" }));
    renderPanel();
    await screen.findByText("오더된 검사·영상 없음");
    pickFee("C3800");
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith("e1", { exam_type: "lab", fee_schedule_id: "C3800" });
    expect(mockFetch).toHaveBeenCalledTimes(2); // 초기 로드 + 오더 후 reload
  });

  it("영상검사 토글 후 선택하면 exam_type=imaging 으로 오더한다(FR-061 라우팅 분류)", async () => {
    mockFetch.mockResolvedValue([]);
    mockCreate.mockResolvedValue(makeExam());
    renderPanel();
    await screen.findByText("오더된 검사·영상 없음");
    fireEvent.click(screen.getByRole("button", { name: "영상검사" }));
    pickFee("HA201");
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith("e1", {
      exam_type: "imaging",
      fee_schedule_id: "HA201",
    });
  });

  it("오더된 검사·영상 목록을 렌더한다(행위 코드·명칭)", async () => {
    mockFetch.mockResolvedValue([makeExam()]);
    renderPanel();
    expect(await screen.findByText("HA201")).toBeInTheDocument();
    expect(screen.getByText("흉부 단순촬영(1매)")).toBeInTheDocument();
  });
});
