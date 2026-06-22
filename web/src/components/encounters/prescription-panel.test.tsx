import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrescriptionPanel } from "@/components/encounters/prescription-panel";
import type { Encounter } from "@/lib/reception/encounters";

// 처방 패널(Story 5.2) — prescriptions/diagnoses lib·MasterSearchPicker(스텁)·sonner 모킹.
// 검증: 약품 선택→드래프트 라인 추가·동일 성분 재추가→중복 경고(비차단)·발행→createPrescription·빈 드래프트→발행 disable.
// issuedIngredientCodes(순수 함수)는 실제 구현 유지(importOriginal).
vi.mock("@/lib/encounters/prescriptions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/encounters/prescriptions")>();
  return { ...actual, fetchPrescriptions: vi.fn(), createPrescription: vi.fn() };
});
vi.mock("@/lib/encounters/diagnoses", () => ({ fetchEncounterDiagnoses: vi.fn() }));
// MasterSearchPicker 는 Supabase 직접조회 → 스텁. ingredient_code = 입력값(테스트가 동일/상이 성분 제어).
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
      data-testid="rx-picker"
      disabled={disabled}
      onChange={(e) =>
        onValueChange({
          id: e.target.value,
          code: `D-${e.target.value}`,
          name: `약품-${e.target.value}`,
          kind: "drug",
          is_active: true,
          effective_from: "2020-01-01",
          effective_to: null,
          ingredient_code: e.target.value.split("#")[0], // "#" 앞 = 성분(다른 값이 같은 성분 가능)
          unit: "정",
        })
      }
    />
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { fetchEncounterDiagnoses } from "@/lib/encounters/diagnoses";
import { createPrescription, fetchPrescriptions } from "@/lib/encounters/prescriptions";

const mockFetch = vi.mocked(fetchPrescriptions);
const mockCreate = vi.mocked(createPrescription);
const mockDx = vi.mocked(fetchEncounterDiagnoses);

afterEach(() => vi.clearAllMocks());

const ENC = { id: "e1" } as Encounter;

function renderPanel() {
  mockDx.mockResolvedValue([]);
  return render(<PrescriptionPanel encounter={ENC} today="2026-06-22" />);
}

function addDrug(ingredient: string) {
  fireEvent.change(screen.getByTestId("rx-picker"), { target: { value: ingredient } });
}

describe("PrescriptionPanel", () => {
  it("발행된 처방이 없으면 '발행된 처방 없음'을 표시한다", async () => {
    mockFetch.mockResolvedValue([]);
    renderPanel();
    expect(await screen.findByText("발행된 처방 없음")).toBeInTheDocument();
  });

  it("약품 선택 시 드래프트 라인을 추가한다", async () => {
    mockFetch.mockResolvedValue([]);
    renderPanel();
    await screen.findByText("발행된 처방 없음");
    addDrug("ING1");
    expect(await screen.findByText("D-ING1")).toBeInTheDocument();
    expect(screen.getByText("약품-ING1")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); // 1줄 — 중복 아님
  });

  it("동일 성분을 다시 추가하면 비차단 중복 경고를 표시한다(FR-052)", async () => {
    mockFetch.mockResolvedValue([]);
    renderPanel();
    await screen.findByText("발행된 처방 없음");
    addDrug("ING1#a");
    addDrug("ING1#b"); // 다른 약품이지만 같은 성분(ING1) 재추가
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("동일 성분 중복");
    // 비차단: 발행 버튼은 여전히 활성
    expect(screen.getByRole("button", { name: /처방 발행/ })).not.toBeDisabled();
  });

  it("서로 다른 성분은 중복 경고를 띄우지 않는다", async () => {
    mockFetch.mockResolvedValue([]);
    renderPanel();
    await screen.findByText("발행된 처방 없음");
    addDrug("ING1#a");
    addDrug("ING2#a");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("처방 발행 버튼은 createPrescription 을 호출하고 목록을 재조회한다", async () => {
    mockFetch.mockResolvedValue([]);
    mockCreate.mockResolvedValue({ id: "rx1" } as never);
    renderPanel();
    await screen.findByText("발행된 처방 없음");
    addDrug("ING1");
    fireEvent.click(screen.getByRole("button", { name: /처방 발행/ }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith("e1", {
      encounter_diagnosis_id: null,
      details: [
        {
          drug_id: "ING1",
          dose: null,
          frequency: null,
          duration_days: null,
          usage_instruction: null,
        },
      ],
    });
    expect(mockFetch).toHaveBeenCalledTimes(2); // 초기 로드 + 발행 후 reload
  });

  it("빈 드래프트에서는 처방 발행 버튼이 비활성이다", async () => {
    mockFetch.mockResolvedValue([]);
    renderPanel();
    await screen.findByText("발행된 처방 없음");
    expect(screen.getByRole("button", { name: /처방 발행/ })).toBeDisabled();
  });
});
