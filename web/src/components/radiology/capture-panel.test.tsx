import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CapturePanel } from "@/components/radiology/capture-panel";
import { ApiError } from "@/lib/api/client";
import type { Equipment, ExaminationImage } from "@/lib/radiology/imaging";

// 촬영 캡처 패널(Story 5.8 AC2·AC4) — imaging 데이터 레이어·sonner 모킹.
// 검증: 영상 0장 수행 버튼 disabled·영상≥1 enabled+썸네일·업로드 호출·수행 호출+onPerformed·409 재동기화.
vi.mock("@/lib/radiology/imaging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/radiology/imaging")>();
  return {
    ...actual,
    fetchExaminationImages: vi.fn(),
    fetchEquipment: vi.fn(),
    uploadExaminationImage: vi.fn(),
    performExamination: vi.fn(),
  };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import {
  fetchEquipment,
  fetchExaminationImages,
  performExamination,
  uploadExaminationImage,
} from "@/lib/radiology/imaging";

const mockImages = vi.mocked(fetchExaminationImages);
const mockEquipment = vi.mocked(fetchEquipment);
const mockUpload = vi.mocked(uploadExaminationImage);
const mockPerform = vi.mocked(performExamination);

afterEach(() => vi.clearAllMocks());

function makeImage(over: Partial<ExaminationImage> = {}): ExaminationImage {
  return {
    id: "img1",
    examination_id: "ex1",
    content_type: "image/png",
    file_size: 1234,
    uploaded_by: "r1",
    uploaded_by_name: "방사선사",
    uploaded_at: "2026-06-22T00:00:00Z",
    signed_url: "http://localhost/sign/img1.png",
    ...over,
  };
}

const seedEquipment: Equipment[] = [
  { id: "eq1", code: "XR-01", name: "제1일반촬영기", modality: "X-ray", status: "available", is_active: true },
];

function renderPanel() {
  const onPerformed = vi.fn();
  render(<CapturePanel examinationId="ex1" onPerformed={onPerformed} />);
  return { onPerformed };
}

describe("CapturePanel", () => {
  it("영상 0장이면 수행 버튼 비활성 + 안내 문구", async () => {
    mockImages.mockResolvedValue([]);
    mockEquipment.mockResolvedValue(seedEquipment);
    renderPanel();
    expect(await screen.findByText(/업로드된 영상이 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "촬영 수행" })).toBeDisabled();
  });

  it("영상 1장이면 썸네일 렌더 + 수행 버튼 활성", async () => {
    mockImages.mockResolvedValue([makeImage()]);
    mockEquipment.mockResolvedValue(seedEquipment);
    renderPanel();
    expect(await screen.findByAltText("촬영 영상")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "촬영 수행" })).toBeEnabled();
  });

  it("수행 클릭 → performExamination(장비 미배정=null) + onPerformed", async () => {
    mockImages.mockResolvedValue([makeImage()]);
    mockEquipment.mockResolvedValue(seedEquipment);
    mockPerform.mockResolvedValue({});
    const { onPerformed } = renderPanel();
    const btn = await screen.findByRole("button", { name: "촬영 수행" });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(mockPerform).toHaveBeenCalledWith("ex1", { equipment_id: null }),
    );
    await waitFor(() => expect(onPerformed).toHaveBeenCalled());
  });

  it("파일 선택 → uploadExaminationImage 호출", async () => {
    mockImages.mockResolvedValue([]);
    mockEquipment.mockResolvedValue(seedEquipment);
    mockUpload.mockResolvedValue(makeImage());
    renderPanel();
    const input = await screen.findByLabelText("영상 파일 선택");
    const file = new File([new Uint8Array([1, 2, 3])], "scan.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(mockUpload).toHaveBeenCalledWith("ex1", file));
  });

  it("수행 409(재수행) → onPerformed 로 재동기화", async () => {
    mockImages.mockResolvedValue([makeImage()]);
    mockEquipment.mockResolvedValue(seedEquipment);
    mockPerform.mockRejectedValue(
      new ApiError("invalid_transition", "잘못된 상태 전이입니다.", 409),
    );
    const { onPerformed } = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "촬영 수행" }));
    await waitFor(() => expect(onPerformed).toHaveBeenCalled());
  });
});
