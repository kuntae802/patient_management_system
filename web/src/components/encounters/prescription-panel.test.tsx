import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrescriptionPanel } from "@/components/encounters/prescription-panel";
import type { Prescription } from "@/lib/encounters/prescriptions";
import type { Encounter } from "@/lib/reception/encounters";
import type { Patient } from "@/lib/reception/patients";

// 처방 패널(Story 5.2·5.5, controlled) — createPrescription·diagnoses·MasterSearchPicker(스텁)·sonner 모킹.
// prescriptions/patient 는 prop 주입(order-panel 소유), diagnoses 는 자체 로드. 검증: 드래프트·FR-052 중복
// (비차단)·발행(allergy_override_reason 포함)·UX-DR21② 알레르기 매칭→경고+사유→발행 게이트.
vi.mock("@/lib/encounters/prescriptions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/encounters/prescriptions")>();
  return { ...actual, createPrescription: vi.fn() };
});
vi.mock("@/lib/encounters/diagnoses", () => ({
  fetchEncounterDiagnoses: vi.fn(),
}));
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
import { createPrescription } from "@/lib/encounters/prescriptions";

const mockCreate = vi.mocked(createPrescription);
const mockDx = vi.mocked(fetchEncounterDiagnoses);

afterEach(() => vi.clearAllMocks());

const ENC = { id: "e1" } as Encounter;

function renderPanel(
  opts: {
    prescriptions?: Prescription[] | null;
    patient?: Patient | null;
  } = {},
) {
  mockDx.mockResolvedValue([]);
  const onReload = vi.fn().mockResolvedValue(undefined);
  render(
    <PrescriptionPanel
      encounter={ENC}
      today="2026-06-22"
      patient={opts.patient ?? null}
      prescriptions={opts.prescriptions ?? []}
      onReload={onReload}
    />,
  );
  return { onReload };
}

function addDrug(value: string) {
  fireEvent.change(screen.getByTestId("rx-picker"), { target: { value } });
}

function issueButton() {
  return screen.getByRole("button", {
    name: /처방 발행|알레르기 사유 입력 필요|발행 중/,
  });
}

describe("PrescriptionPanel (controlled)", () => {
  it("발행된 처방이 없으면 빈 상태를 표시한다", () => {
    renderPanel({ prescriptions: [] });
    expect(screen.getByText("발행된 처방 없음")).toBeInTheDocument();
  });

  it("약품 선택 시 드래프트 라인을 추가한다", async () => {
    renderPanel();
    addDrug("ING1");
    expect(await screen.findByText("D-ING1")).toBeInTheDocument();
    expect(screen.getByText("약품-ING1")).toBeInTheDocument();
  });

  it("동일 성분 재추가 시 비차단 중복 경고(FR-052)", async () => {
    renderPanel();
    addDrug("ING1#a");
    addDrug("ING1#b"); // 다른 약품·같은 성분(ING1)
    expect(
      await screen.findByText("동일 성분 중복 — 확인 후 발행"),
    ).toBeInTheDocument();
    expect(issueButton()).not.toBeDisabled(); // 비차단
  });

  it("서로 다른 성분은 중복 경고를 띄우지 않는다", async () => {
    renderPanel();
    addDrug("ING1#a");
    addDrug("ING2#a");
    expect(
      screen.queryByText("동일 성분 중복 — 확인 후 발행"),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(mockDx).toHaveBeenCalled()); // diagnoses 비동기 로드 flush
  });

  it("발행은 createPrescription(allergy_override_reason 포함)를 호출하고 onReload 한다", async () => {
    mockCreate.mockResolvedValue({ id: "rx1" } as never);
    const { onReload } = renderPanel();
    addDrug("ING1");
    fireEvent.click(issueButton());
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
          allergy_override_reason: null,
        },
      ],
    });
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
  });

  it("빈 드래프트에서는 발행 버튼이 비활성이다", async () => {
    renderPanel();
    expect(issueButton()).toBeDisabled();
    await waitFor(() => expect(mockDx).toHaveBeenCalled()); // diagnoses 비동기 로드 flush
  });

  it("기록 알레르기와 약품명 매칭 시 경고+사유 입력, 사유 없으면 발행 차단(UX-DR21②)", async () => {
    // 약품명 '약품-ING1' 에 알레르기 토큰 'ing1' 부분포함 → 매칭.
    renderPanel({ patient: { allergies: "ING1" } as Patient });
    addDrug("ING1");
    expect(await screen.findByText(/환자 알레르기 약품/)).toBeInTheDocument();
    expect(issueButton()).toBeDisabled(); // 사유 미입력 → 차단
  });

  it("알레르기 사유 입력 후 발행하면 override_reason 을 실어 호출한다", async () => {
    mockCreate.mockResolvedValue({ id: "rx1" } as never);
    renderPanel({ patient: { allergies: "ING1" } as Patient });
    addDrug("ING1");
    await screen.findByText(/환자 알레르기 약품/);
    fireEvent.change(screen.getByLabelText("알레르기 오버라이드 사유"), {
      target: { value: "재확인 결과 투여 가능" },
    });
    await waitFor(() => expect(issueButton()).not.toBeDisabled());
    fireEvent.click(issueButton());
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
          allergy_override_reason: "재확인 결과 투여 가능",
        },
      ],
    });
  });
});
