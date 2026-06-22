import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VitalsInputForm } from "@/components/nurse/vitals-input-form";

// 활력 입력 폼(Story 5.6 AC1) — createVitalSigns·sonner 모킹. 검증: 최소1개 가드(빈 값 제출 disable)·
// 측정값 입력→제출 호출(파싱·notes)·성공 토스트+onRecorded·비정상 aria-invalid.
vi.mock("@/lib/encounters/vitals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/encounters/vitals")>();
  return { ...actual, createVitalSigns: vi.fn() };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { createVitalSigns } from "@/lib/encounters/vitals";
import { toast } from "sonner";

const mockCreate = vi.mocked(createVitalSigns);

afterEach(() => {
  vi.clearAllMocks();
});

describe("VitalsInputForm", () => {
  it("빈 값(측정 0개)이면 제출 버튼 disable(최소1개 가드)", () => {
    render(<VitalsInputForm encounterId="e1" onRecorded={vi.fn()} />);
    expect(screen.getByRole("button", { name: "활력징후 기록" })).toBeDisabled();
  });

  it("측정값 1개 입력 시 제출 활성·createVitalSigns 호출(파싱)", async () => {
    mockCreate.mockResolvedValue({} as never);
    const onRecorded = vi.fn();
    render(<VitalsInputForm encounterId="e1" onRecorded={onRecorded} />);

    fireEvent.change(screen.getByLabelText("SpO₂ (%)"), { target: { value: "98" } });
    const submit = screen.getByRole("button", { name: "활력징후 기록" });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const [eid, body] = mockCreate.mock.calls[0];
    expect(eid).toBe("e1");
    expect(body.spo2).toBe(98); // 정수 파싱
    expect(body.systolic).toBeUndefined(); // 미입력은 undefined
    expect(toast.success).toHaveBeenCalled();
    await waitFor(() => expect(onRecorded).toHaveBeenCalled());
  });

  it("body_temp 는 소수 파싱", async () => {
    mockCreate.mockResolvedValue({} as never);
    render(<VitalsInputForm encounterId="e1" onRecorded={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("체온 (°C)"), { target: { value: "37.2" } });
    fireEvent.click(screen.getByRole("button", { name: "활력징후 기록" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0][1].body_temp).toBe(37.2);
  });

  it("비정상 수치 입력 시 aria-invalid", () => {
    render(<VitalsInputForm encounterId="e1" onRecorded={vi.fn()} />);
    const spo2 = screen.getByLabelText("SpO₂ (%)");
    fireEvent.change(spo2, { target: { value: "90" } });
    expect(spo2).toHaveAttribute("aria-invalid", "true");
  });

  it("실패 시 error 토스트·onRecorded 미호출", async () => {
    mockCreate.mockRejectedValue(new Error("boom"));
    const onRecorded = vi.fn();
    render(<VitalsInputForm encounterId="e1" onRecorded={onRecorded} />);
    fireEvent.change(screen.getByLabelText("맥박 (bpm)"), { target: { value: "72" } });
    fireEvent.click(screen.getByRole("button", { name: "활력징후 기록" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onRecorded).not.toHaveBeenCalled();
  });
});
