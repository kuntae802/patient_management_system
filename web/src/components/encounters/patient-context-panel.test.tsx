import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PatientContextPanel } from "@/components/encounters/patient-context-panel";
import { type EncounterListItem } from "@/lib/reception/encounters";
import { type Patient } from "@/lib/reception/patients";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/reception/patients", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reception/patients")>();
  return { ...actual, fetchPatient: vi.fn(), fetchPatientEncounters: vi.fn() };
});

import { fetchPatient, fetchPatientEncounters } from "@/lib/reception/patients";

const mockFetchPatient = vi.mocked(fetchPatient);
const mockFetchEncounters = vi.mocked(fetchPatientEncounters);

afterEach(() => vi.clearAllMocks());

function patient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: "p1",
    chart_no: "00000042",
    name: "홍길동",
    birth_date: "1990-01-01",
    sex: "male",
    resident_no_masked: "900101-1******",
    phone: "010-1234-5678",
    address: null,
    email: null,
    insurance_type: "health_insurance",
    insurance_no: null,
    blood_type: "A+",
    allergies: null,
    chronic_diseases: "고혈압",
    medications: null,
    notes: null,
    is_active: true,
    created_at: "2026-06-21T00:00:00Z",
    updated_at: "2026-06-21T00:00:00Z",
    ...overrides,
  };
}

function encounter(id: string): EncounterListItem {
  return {
    id,
    encounter_no: id,
    patient_id: "p1",
    department_id: "d1",
    room_id: null,
    doctor_id: null,
    visit_type: "walk_in",
    status: "completed",
    registered_at: "2026-05-21T00:00:00Z",
    consult_started_at: null,
    called_at: null,
    call_count: 0,
    is_active: true,
    created_at: "2026-05-21T00:00:00Z",
    patient_name: "홍길동",
    chart_no: "00000042",
    department_name: "내과",
    room_name: null,
    doctor_name: "이정훈",
  };
}

describe("PatientContextPanel — 활력 빈-상태(데이터 현실, AC1)", () => {
  it("활력 테이블 미구축 → 명시 빈-상태(Epic 5 안내), 가짜 데이터 없음", async () => {
    mockFetchPatient.mockResolvedValueOnce(patient());
    mockFetchEncounters.mockResolvedValueOnce([]);
    render(<PatientContextPanel patientId="p1" currentEncounterId="cur" />);

    expect(await screen.findByText("측정된 활력징후가 없습니다.")).toBeInTheDocument();
    expect(screen.getByText(/간호 활력징후 기록은 Epic 5/)).toBeInTheDocument();
  });
});

describe("PatientContextPanel — 임상 프로필 + 과거 이력(AC1)", () => {
  it("임상 프로필을 읽기전용 표시(혈액형·기저질환)", async () => {
    mockFetchPatient.mockResolvedValueOnce(patient());
    mockFetchEncounters.mockResolvedValueOnce([]);
    render(<PatientContextPanel patientId="p1" currentEncounterId="cur" />);

    expect(await screen.findByText("A+")).toBeInTheDocument();
    expect(screen.getByText("고혈압")).toBeInTheDocument();
    expect(screen.getByText("과거 내원 이력이 없습니다(첫 내원).")).toBeInTheDocument();
  });

  it("과거 내원 이력에서 현재 진행중 내원은 제외한다", async () => {
    mockFetchPatient.mockResolvedValueOnce(patient());
    mockFetchEncounters.mockResolvedValueOnce([encounter("cur"), encounter("past-1")]);
    render(<PatientContextPanel patientId="p1" currentEncounterId="cur" />);

    // 과거 이력엔 진료과·담당의 표시가 1건(past-1)만 — 현재(cur)는 제외.
    expect(await screen.findByText("내과 · 이정훈")).toBeInTheDocument();
    expect(screen.getByText(/진단·처방 이력은 향후 표시됩니다/)).toBeInTheDocument();
  });
});
