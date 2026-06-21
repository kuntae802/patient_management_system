import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConsultationWorkspace } from "@/components/encounters/consultation-workspace";
import { ApiError } from "@/lib/api/client";
import { type Encounter } from "@/lib/reception/encounters";

// 진료 작업영역(Story 4.7) — 자식(DiagnosisBlock·SoapLedger) 스텁 + diagnoses·active-session·sonner 모킹.
// 검증: 완료 성공(완료 패널·active 해제)·주상병 미지정(422→primaryError 전파, 무토스트)·기타 오류(토스트).
vi.mock("@/components/encounters/soap-ledger", () => ({
  SoapLedger: () => <div data-testid="soap" />,
}));
vi.mock("@/components/encounters/diagnosis-block", () => ({
  DiagnosisBlock: ({ primaryError }: { primaryError: boolean }) => (
    <div data-testid="dx-block">{primaryError ? "PRIMARY_ERROR" : "no-error"}</div>
  ),
}));
vi.mock("@/lib/encounters/diagnoses", () => ({ completeEncounter: vi.fn() }));
vi.mock("@/lib/encounters/active-session", () => ({ clearActiveEncounter: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { clearActiveEncounter } from "@/lib/encounters/active-session";
import { completeEncounter } from "@/lib/encounters/diagnoses";
import { toast } from "sonner";

const mockComplete = vi.mocked(completeEncounter);
const mockClear = vi.mocked(clearActiveEncounter);
const mockToastError = vi.mocked(toast.error);

afterEach(() => vi.clearAllMocks());

const ENC = { id: "e1" } as Encounter;

function renderWs() {
  return render(<ConsultationWorkspace encounter={ENC} today="2026-06-21" />);
}

describe("ConsultationWorkspace", () => {
  it("진료 완료 성공 → 완료 패널 + active 세션 해제", async () => {
    mockComplete.mockResolvedValue({ id: "e1", status: "completed" } as Encounter);
    renderWs();
    fireEvent.click(screen.getByRole("button", { name: "진료 완료" }));
    expect(await screen.findByText("진료가 완료되었습니다")).toBeInTheDocument();
    expect(mockClear).toHaveBeenCalledWith("e1");
  });

  it("⚠️ 주상병 미지정(422) → primaryError 를 진단 블록에 전파(무토스트)", async () => {
    mockComplete.mockRejectedValue(
      new ApiError("primary_diagnosis_required", "주상병을 1개 지정해야 합니다.", 422),
    );
    renderWs();
    expect(screen.getByTestId("dx-block")).toHaveTextContent("no-error");
    fireEvent.click(screen.getByRole("button", { name: "진료 완료" }));
    await waitFor(() => expect(screen.getByTestId("dx-block")).toHaveTextContent("PRIMARY_ERROR"));
    expect(mockToastError).not.toHaveBeenCalled(); // 인라인이 안내 → 토스트 없음
  });

  it("기타 완료 오류 → 토스트", async () => {
    mockComplete.mockRejectedValue(new ApiError("invalid_transition", "잘못된 상태 전이입니다.", 409));
    renderWs();
    fireEvent.click(screen.getByRole("button", { name: "진료 완료" }));
    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(screen.getByTestId("dx-block")).toHaveTextContent("no-error");
  });
});
