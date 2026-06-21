import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiagnosisBlock } from "@/components/encounters/diagnosis-block";
import { type EncounterDiagnosis } from "@/lib/encounters/diagnoses";
import { type Encounter } from "@/lib/reception/encounters";

// 진단 블록(Story 4.7) — diagnoses lib·MasterSearchPicker(스텁)·sonner 모킹.
// 검증: 빈 상태·칩(주/부상병 배지)·선택 시 부착·토글·제거·주상병 미지정(422) 인라인+aria+포커스.
vi.mock("@/lib/encounters/diagnoses", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/encounters/diagnoses")>();
  return {
    ...actual,
    fetchEncounterDiagnoses: vi.fn(),
    attachDiagnosis: vi.fn(),
    setDiagnosisPrimary: vi.fn(),
    removeDiagnosis: vi.fn(),
  };
});
// MasterSearchPicker 는 Supabase 직접조회 → 스텁으로 격리(부착 어더·aria 전파만 검증).
vi.mock("@/components/ui/master-search-picker", () => ({
  MasterSearchPicker: ({
    id,
    ariaInvalid,
    ariaDescribedby,
    disabled,
    onValueChange,
  }: {
    id?: string;
    ariaInvalid?: boolean;
    ariaDescribedby?: string;
    disabled?: boolean;
    onValueChange: (v: { id: string } | null) => void;
  }) => (
    <input
      id={id}
      data-testid="dx-picker"
      aria-invalid={ariaInvalid || undefined}
      aria-describedby={ariaDescribedby}
      disabled={disabled}
      onChange={(e) =>
        onValueChange({
          id: e.target.value,
          code: "I10",
          name: "고혈압",
          kind: "diagnosis",
          is_active: true,
          effective_from: "2020-01-01",
          effective_to: null,
        } as { id: string })
      }
    />
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import {
  attachDiagnosis,
  fetchEncounterDiagnoses,
  removeDiagnosis,
  setDiagnosisPrimary,
} from "@/lib/encounters/diagnoses";

const mockFetch = vi.mocked(fetchEncounterDiagnoses);
const mockAttach = vi.mocked(attachDiagnosis);
const mockSetPrimary = vi.mocked(setDiagnosisPrimary);
const mockRemove = vi.mocked(removeDiagnosis);

afterEach(() => vi.clearAllMocks());

const ENC = { id: "e1" } as Encounter;

function makeDx(over: Partial<EncounterDiagnosis>): EncounterDiagnosis {
  return {
    id: "ed1",
    encounter_id: "e1",
    diagnosis_id: "dx1",
    diagnosis_code: "I10",
    diagnosis_name: "본태성 고혈압",
    is_primary: false,
    recorded_by: "doc1",
    is_active: true,
    created_at: "2026-06-21T00:00:00Z",
    updated_at: "2026-06-21T00:00:00Z",
    ...over,
  };
}

function renderBlock(primaryError = false, onResolved = vi.fn()) {
  return render(
    <DiagnosisBlock
      encounter={ENC}
      today="2026-06-21"
      primaryError={primaryError}
      onPrimaryResolved={onResolved}
    />,
  );
}

describe("DiagnosisBlock", () => {
  it("부착 진단이 없으면 '부착된 진단 없음'을 표시한다(빈 상태)", async () => {
    mockFetch.mockResolvedValue([]);
    renderBlock();
    expect(await screen.findByText("부착된 진단 없음")).toBeInTheDocument();
  });

  it("부착 진단을 코드·명칭·주/부상병 배지로 표시한다(색+글리프+라벨)", async () => {
    mockFetch.mockResolvedValue([
      makeDx({ id: "a", diagnosis_code: "I10", diagnosis_name: "고혈압", is_primary: true }),
      makeDx({ id: "b", diagnosis_code: "J00", diagnosis_name: "감기", is_primary: false }),
    ]);
    renderBlock();
    expect(await screen.findByText("I10")).toBeInTheDocument();
    expect(screen.getByText("고혈압")).toBeInTheDocument();
    expect(screen.getByText("주상병")).toBeInTheDocument(); // 주상병 배지
    expect(screen.getByText("부상병")).toBeInTheDocument(); // 부상병 배지
  });

  it("피커에서 진단 선택 시 부착(부상병 기본)한다", async () => {
    mockFetch.mockResolvedValue([]);
    mockAttach.mockResolvedValue(makeDx({}));
    renderBlock();
    await screen.findByText("부착된 진단 없음");
    fireEvent.change(screen.getByTestId("dx-picker"), { target: { value: "dx1" } });
    expect(mockAttach).toHaveBeenCalledWith("e1", { diagnosis_id: "dx1", is_primary: false });
  });

  it("부상병 칩의 토글 버튼은 주상병으로 승격을 요청한다", async () => {
    mockFetch.mockResolvedValue([makeDx({ id: "b", is_primary: false })]);
    mockSetPrimary.mockResolvedValue(makeDx({ id: "b", is_primary: true }));
    renderBlock();
    const toggle = await screen.findByRole("button", { name: /주상병으로 지정/ });
    fireEvent.click(toggle);
    expect(mockSetPrimary).toHaveBeenCalledWith("e1", "b", true);
  });

  it("제거 버튼은 진단 제거를 요청한다", async () => {
    mockFetch.mockResolvedValue([makeDx({ id: "b", diagnosis_name: "감기" })]);
    mockRemove.mockResolvedValue(undefined);
    renderBlock();
    const remove = await screen.findByRole("button", { name: "감기 제거" });
    fireEvent.click(remove);
    expect(mockRemove).toHaveBeenCalledWith("e1", "b");
  });

  it("⚠️ 주상병 미지정 완료(422): 인라인 메시지 + aria-invalid + 피커 포커스(UX-DR18)", async () => {
    mockFetch.mockResolvedValue([]);
    renderBlock(true);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("주상병을 1개 지정해야 합니다");
    const picker = screen.getByTestId("dx-picker");
    expect(picker).toHaveAttribute("aria-invalid", "true");
    expect(picker).toHaveAttribute("aria-describedby", "diagnosis-primary-error");
    expect(picker).toHaveFocus(); // 포커스 이동
  });
});
