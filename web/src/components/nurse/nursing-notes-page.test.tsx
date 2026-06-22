import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NursingNotesPage } from "@/components/nurse/nursing-notes-page";
import type {
  NursingRecord,
  NursingWorklistItem,
} from "@/lib/encounters/treatment-orders";

// 일상 간호기록(Story 5.7 AC3) — fetchNursingWorklist·fetchEncounterNursingRecords·createNursingRecord 모킹.
// 검증: 활성 내원 전체 노출·선택→폼·빈 content 제출 disable·작성 호출·기록 목록(처치 태그).
vi.mock("@/lib/encounters/treatment-orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/encounters/treatment-orders")>();
  return {
    ...actual,
    fetchNursingWorklist: vi.fn(),
    fetchEncounterNursingRecords: vi.fn(),
    createNursingRecord: vi.fn(),
  };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import {
  createNursingRecord,
  fetchEncounterNursingRecords,
  fetchNursingWorklist,
} from "@/lib/encounters/treatment-orders";

const mockWorklist = vi.mocked(fetchNursingWorklist);
const mockRecords = vi.mocked(fetchEncounterNursingRecords);
const mockCreate = vi.mocked(createNursingRecord);

afterEach(() => vi.clearAllMocks());

function makeItem(over: Partial<NursingWorklistItem> = {}): NursingWorklistItem {
  return {
    encounter_id: "e1",
    chart_no: "C0001",
    patient_name: "홍길동",
    department_name: "내과",
    status: "registered",
    created_at: "2026-06-22T00:00:00Z",
    pending_treatment_count: 0,
    oldest_pending_ordered_at: null,
    nursing_record_count: 0,
    ...over,
  };
}

function makeRecord(over: Partial<NursingRecord> = {}): NursingRecord {
  return {
    id: "nr1",
    encounter_id: "e1",
    treatment_order_id: null,
    content: "오전 라운딩",
    recorded_by: "n1",
    recorded_by_name: "이간호",
    recorded_at: "2026-06-22T01:00:00Z",
    is_active: true,
    created_at: "2026-06-22T01:00:00Z",
    updated_at: "2026-06-22T01:00:00Z",
    ...over,
  };
}

describe("NursingNotesPage", () => {
  it("오늘 활성 내원 전체를 노출(pending 0 도 포함)", async () => {
    mockWorklist.mockResolvedValue([makeItem({ patient_name: "환자A" })]);
    render(<NursingNotesPage />);
    expect(await screen.findByText("환자A")).toBeInTheDocument();
  });

  it("내원 선택 → 빈 content 는 제출 disable, 입력 시 작성 호출", async () => {
    mockWorklist.mockResolvedValue([makeItem()]);
    mockRecords.mockResolvedValue([]);
    mockCreate.mockResolvedValue(makeRecord());
    render(<NursingNotesPage />);
    fireEvent.click(await screen.findByText("홍길동"));

    const save = await screen.findByRole("button", { name: "간호기록 저장" });
    expect(save).toBeDisabled(); // 빈 content 가드

    const textarea = screen.getByLabelText("간호기록 내용");
    fireEvent.change(textarea, { target: { value: "처치 후 안정" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith("e1", { content: "처치 후 안정" }),
    );
  });

  it("처치 수행 연결 기록은 '처치' 태그", async () => {
    mockWorklist.mockResolvedValue([makeItem()]);
    mockRecords.mockResolvedValue([makeRecord({ treatment_order_id: "tr1", content: "드레싱" })]);
    render(<NursingNotesPage />);
    fireEvent.click(await screen.findByText("홍길동"));
    expect(await screen.findByText("드레싱")).toBeInTheDocument();
    expect(screen.getByText("처치")).toBeInTheDocument();
  });
});
