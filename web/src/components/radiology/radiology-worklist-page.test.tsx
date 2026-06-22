import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RadiologyWorklistPage } from "@/components/radiology/radiology-worklist-page";
import type { RadiologyWorklistItem } from "@/lib/radiology/imaging";

// 촬영 워크리스트(Story 5.8 AC1) — imaging 데이터 레이어·sonner 모킹.
// 검증: 미수행 영상검사 목록 렌더·빈 목록 안내·선택 시 캡처 패널 노출(placeholder 사라짐).
vi.mock("@/lib/radiology/imaging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/radiology/imaging")>();
  return {
    ...actual,
    fetchRadiologyWorklist: vi.fn(),
    fetchExaminationImages: vi.fn(),
    fetchEquipment: vi.fn(),
  };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import {
  fetchEquipment,
  fetchExaminationImages,
  fetchRadiologyWorklist,
} from "@/lib/radiology/imaging";

const mockWorklist = vi.mocked(fetchRadiologyWorklist);

afterEach(() => vi.clearAllMocks());

function makeItem(over: Partial<RadiologyWorklistItem> = {}): RadiologyWorklistItem {
  return {
    examination_id: "ex1",
    encounter_id: "e1",
    chart_no: "C0001",
    patient_name: "홍길동",
    department_name: "내과",
    fee_name: "흉부 단순촬영(1매)",
    status: "ordered",
    ordered_by_name: "김의사",
    ordered_at: "2026-06-22T00:00:00Z",
    image_count: 0,
    ...over,
  };
}

describe("RadiologyWorklistPage", () => {
  it("미수행 영상검사 목록을 렌더한다", async () => {
    mockWorklist.mockResolvedValue([makeItem()]);
    render(<RadiologyWorklistPage />);
    expect(await screen.findByText("홍길동")).toBeInTheDocument();
    expect(screen.getByText("흉부 단순촬영(1매)")).toBeInTheDocument();
  });

  it("빈 목록은 안내 문구", async () => {
    mockWorklist.mockResolvedValue([]);
    render(<RadiologyWorklistPage />);
    expect(await screen.findByText("촬영할 영상검사가 없습니다.")).toBeInTheDocument();
  });

  it("검사 선택 시 캡처 패널이 노출된다(placeholder 사라짐)", async () => {
    mockWorklist.mockResolvedValue([makeItem()]);
    vi.mocked(fetchExaminationImages).mockResolvedValue([]);
    vi.mocked(fetchEquipment).mockResolvedValue([]);
    render(<RadiologyWorklistPage />);
    fireEvent.click(await screen.findByText("홍길동"));
    await waitFor(() =>
      expect(screen.getByLabelText("영상 파일 선택")).toBeInTheDocument(),
    );
  });
});
