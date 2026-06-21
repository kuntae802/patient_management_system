import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PatientIntake } from "@/components/reception/patient-intake";
import { ApiError } from "@/lib/api/client";
import { fetchDepartments } from "@/lib/admin/masters";
import { createWalkInEncounter, type Encounter } from "@/lib/reception/encounters";
import { searchPatients, type PatientListItem } from "@/lib/reception/patients";

// 접수 화면(Story 4.2) — 검색 API·진료과 조회·생성 호출·토스트를 모킹(순수 헬퍼 sexLabel 등은 유지).
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/admin/masters", () => ({ fetchDepartments: vi.fn() }));
vi.mock("@/lib/reception/patients", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reception/patients")>();
  return { ...actual, searchPatients: vi.fn() };
});
vi.mock("@/lib/reception/encounters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reception/encounters")>();
  return { ...actual, createWalkInEncounter: vi.fn() };
});
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) } }));

const PATIENT: PatientListItem = {
  id: "11111111-1111-1111-1111-111111111111",
  chart_no: "00000042",
  name: "홍길동",
  birth_date: "1990-01-01",
  sex: "male",
  resident_no_masked: "900101-1******",
  phone: "010-1234-5678",
  is_active: true,
  created_at: "2026-06-21T00:00:00Z",
};

const ENCOUNTER: Encounter = {
  id: "e1",
  encounter_no: "00000007",
  patient_id: PATIENT.id,
  department_id: "d1",
  room_id: null,
  doctor_id: null,
  visit_type: "walk_in",
  status: "registered",
  cancel_reason: null,
  registered_at: "2026-06-21T00:00:00Z",
  consult_started_at: null,
  completed_at: null,
  cancelled_at: null,
  no_show_at: null,
  called_at: null,
  call_count: 0,
  last_called_by: null,
  created_by: "u1",
  is_active: true,
  created_at: "2026-06-21T00:00:00Z",
  updated_at: "2026-06-21T00:00:00Z",
};

beforeEach(() => {
  vi.mocked(fetchDepartments).mockResolvedValue([
    {
      id: "d1",
      code: "IM",
      name: "내과",
      description: null,
      is_active: true,
      created_at: "2026-06-21T00:00:00Z",
      updated_at: "2026-06-21T00:00:00Z",
    },
    {
      id: "d2",
      code: "OLD",
      name: "폐과(비활성)",
      description: null,
      is_active: false, // 비활성 진료과 — 옵션에 노출되지 않아야 한다.
      created_at: "2026-06-21T00:00:00Z",
      updated_at: "2026-06-21T00:00:00Z",
    },
  ]);
  vi.mocked(searchPatients).mockResolvedValue([PATIENT]);
});

afterEach(() => vi.clearAllMocks());

/** 환자 검색→선택 + 진료과 선택까지 진행(공통 셋업). */
async function selectPatientAndDepartment(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("combobox", { name: "환자 검색" }), "홍길동");
  const option = await screen.findByRole("option", { name: /홍길동/ });
  await user.click(option);
  // 진료과 select(활성만 노출).
  const deptSelect = await screen.findByRole("combobox", { name: "진료과" });
  await user.selectOptions(deptSelect, "d1");
}

describe("PatientIntake — 환자 접수(walk-in)", () => {
  it("활성 진료과만 옵션으로 노출한다(폐과 제외)", async () => {
    render(<PatientIntake />);
    expect(await screen.findByRole("option", { name: "내과" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "폐과(비활성)" })).not.toBeInTheDocument();
  });

  it("환자·진료과 선택 전에는 접수 버튼이 비활성", async () => {
    render(<PatientIntake />);
    await screen.findByRole("option", { name: "내과" });
    expect(screen.getByRole("button", { name: "접수" })).toBeDisabled();
  });

  it("환자 검색·선택 + 진료과 지정 후 접수 → createWalkInEncounter 호출 + 성공 카드(내원번호)", async () => {
    vi.mocked(createWalkInEncounter).mockResolvedValueOnce(ENCOUNTER);
    const user = userEvent.setup();
    render(<PatientIntake />);
    await screen.findByRole("option", { name: "내과" });

    await selectPatientAndDepartment(user);
    const submit = screen.getByRole("button", { name: "접수" });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() =>
      expect(createWalkInEncounter).toHaveBeenCalledWith({
        patient_id: PATIENT.id,
        department_id: "d1",
      }),
    );
    // 성공 카드 — 내원번호 노출 + 성공 토스트.
    expect(await screen.findByText("접수 완료")).toBeInTheDocument();
    expect(screen.getByText("00000007")).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("접수 실패(비활성 환자 422) → 에러 토스트, 성공 카드 미노출", async () => {
    vi.mocked(createWalkInEncounter).mockRejectedValueOnce(
      new ApiError("patient_inactive", "비활성", 422),
    );
    const user = userEvent.setup();
    render(<PatientIntake />);
    await screen.findByRole("option", { name: "내과" });

    await selectPatientAndDepartment(user);
    const submit = screen.getByRole("button", { name: "접수" });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.queryByText("접수 완료")).not.toBeInTheDocument();
  });
});
