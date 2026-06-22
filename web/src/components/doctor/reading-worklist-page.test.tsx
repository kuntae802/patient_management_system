import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReadingWorklistPage } from "@/components/doctor/reading-worklist-page";
import type { ReadingWorklistItem } from "@/lib/doctor/reading";

// 판독 워크리스트(Story 5.9 AC1) — reading/imaging 데이터 레이어·sonner 모킹.
// 검증: 미판독 영상검사 목록 렌더·빈 목록 안내·선택 시 판독 패널 노출(소견 textarea).
vi.mock("@/lib/doctor/reading", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/doctor/reading")>();
  return { ...actual, fetchReadingWorklist: vi.fn(), completeExamination: vi.fn() };
});
vi.mock("@/lib/radiology/imaging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/radiology/imaging")>();
  return { ...actual, fetchExaminationImages: vi.fn() };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { fetchReadingWorklist } from "@/lib/doctor/reading";
import { fetchExaminationImages } from "@/lib/radiology/imaging";

const mockWorklist = vi.mocked(fetchReadingWorklist);

afterEach(() => vi.clearAllMocks());

function makeItem(over: Partial<ReadingWorklistItem> = {}): ReadingWorklistItem {
  return {
    examination_id: "ex1",
    encounter_id: "e1",
    chart_no: "C0001",
    patient_name: "홍길동",
    department_name: "내과",
    fee_name: "흉부 단순촬영(1매)",
    status: "performed",
    ordered_by_name: "김의사",
    ordered_at: "2026-06-22T00:00:00Z",
    performed_by_name: "이방사",
    performed_at: "2026-06-22T01:00:00Z",
    image_count: 1,
    ...over,
  };
}

describe("ReadingWorklistPage", () => {
  it("미판독 영상검사 목록을 렌더한다", async () => {
    mockWorklist.mockResolvedValue([makeItem()]);
    render(<ReadingWorklistPage />);
    expect(await screen.findByText("홍길동")).toBeInTheDocument();
    expect(screen.getByText("흉부 단순촬영(1매)")).toBeInTheDocument();
  });

  it("빈 목록은 안내 문구", async () => {
    mockWorklist.mockResolvedValue([]);
    render(<ReadingWorklistPage />);
    expect(await screen.findByText("판독할 영상검사가 없습니다.")).toBeInTheDocument();
  });

  it("검사 선택 시 판독 패널이 노출된다(소견 입력란)", async () => {
    mockWorklist.mockResolvedValue([makeItem()]);
    vi.mocked(fetchExaminationImages).mockResolvedValue([]);
    render(<ReadingWorklistPage />);
    fireEvent.click(await screen.findByText("홍길동"));
    await waitFor(() =>
      expect(screen.getByPlaceholderText("영상 판독 소견을 입력하세요.")).toBeInTheDocument(),
    );
  });
});
