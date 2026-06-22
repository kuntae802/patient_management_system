import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReadingPanel } from "@/components/doctor/reading-panel";
import { ApiError } from "@/lib/api/client";
import type { ExaminationImage } from "@/lib/radiology/imaging";

// 판독 패널(Story 5.9 AC2·AC3·AC4) — reading/imaging 데이터 레이어·sonner 모킹.
// 검증: 빈 소견 완료 버튼 disabled·소견 입력 시 enabled+썸네일·완료 호출(결론 null)+onCompleted·409 재동기화.
vi.mock("@/lib/doctor/reading", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/doctor/reading")>();
  return { ...actual, completeExamination: vi.fn() };
});
vi.mock("@/lib/radiology/imaging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/radiology/imaging")>();
  return { ...actual, fetchExaminationImages: vi.fn() };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { completeExamination } from "@/lib/doctor/reading";
import { fetchExaminationImages } from "@/lib/radiology/imaging";

const mockImages = vi.mocked(fetchExaminationImages);
const mockComplete = vi.mocked(completeExamination);

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

function renderPanel() {
  const onCompleted = vi.fn();
  render(<ReadingPanel examinationId="ex1" onCompleted={onCompleted} />);
  return { onCompleted };
}

describe("ReadingPanel", () => {
  it("소견이 비었으면 판독 완료 버튼 비활성", async () => {
    mockImages.mockResolvedValue([makeImage()]);
    renderPanel();
    expect(await screen.findByAltText("판독 영상")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "판독 완료" })).toBeDisabled();
  });

  it("소견 입력 시 완료 버튼 활성", async () => {
    mockImages.mockResolvedValue([makeImage()]);
    renderPanel();
    const textarea = await screen.findByPlaceholderText("영상 판독 소견을 입력하세요.");
    fireEvent.change(textarea, { target: { value: "정상 흉부." } });
    expect(screen.getByRole("button", { name: "판독 완료" })).toBeEnabled();
  });

  it("완료 클릭 → completeExamination(결론 미입력=null) + onCompleted", async () => {
    mockImages.mockResolvedValue([makeImage()]);
    mockComplete.mockResolvedValue({});
    const { onCompleted } = renderPanel();
    const textarea = await screen.findByPlaceholderText("영상 판독 소견을 입력하세요.");
    fireEvent.change(textarea, { target: { value: "이상 소견 없음." } });
    fireEvent.click(screen.getByRole("button", { name: "판독 완료" }));
    await waitFor(() =>
      expect(mockComplete).toHaveBeenCalledWith("ex1", {
        findings: "이상 소견 없음.",
        reading_conclusion: null,
      }),
    );
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
  });

  it("결론 입력 시 completeExamination 에 결론 전달", async () => {
    mockImages.mockResolvedValue([makeImage()]);
    mockComplete.mockResolvedValue({});
    renderPanel();
    fireEvent.change(await screen.findByPlaceholderText("영상 판독 소견을 입력하세요."), {
      target: { value: "소견." },
    });
    fireEvent.change(screen.getByPlaceholderText("결론·임프레션(선택)."), {
      target: { value: "정상." },
    });
    fireEvent.click(screen.getByRole("button", { name: "판독 완료" }));
    await waitFor(() =>
      expect(mockComplete).toHaveBeenCalledWith("ex1", {
        findings: "소견.",
        reading_conclusion: "정상.",
      }),
    );
  });

  it("완료 진행 중 버튼 비활성(이중 제출 가드)", async () => {
    mockImages.mockResolvedValue([makeImage()]);
    // 완료 in-flight: resolve 보류 → completing=true 동안 버튼 라벨 "완료 중…" + disabled 단언.
    let resolveComplete: (v: unknown) => void = () => {};
    mockComplete.mockReturnValue(
      new Promise<unknown>((res) => {
        resolveComplete = res;
      }),
    );
    const { onCompleted } = renderPanel();
    fireEvent.change(await screen.findByPlaceholderText("영상 판독 소견을 입력하세요."), {
      target: { value: "소견." },
    });
    fireEvent.click(screen.getByRole("button", { name: "판독 완료" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "완료 중…" })).toBeDisabled(),
    );
    resolveComplete({});
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
  });

  it("완료 409(재완료) → onCompleted 로 재동기화", async () => {
    mockImages.mockResolvedValue([makeImage()]);
    mockComplete.mockRejectedValue(
      new ApiError("invalid_transition", "잘못된 상태 전이입니다.", 409),
    );
    const { onCompleted } = renderPanel();
    fireEvent.change(await screen.findByPlaceholderText("영상 판독 소견을 입력하세요."), {
      target: { value: "소견." },
    });
    fireEvent.click(screen.getByRole("button", { name: "판독 완료" }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
  });
});
