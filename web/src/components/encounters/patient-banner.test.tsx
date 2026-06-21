import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PatientBanner } from "@/components/encounters/patient-banner";
import { type Encounter } from "@/lib/reception/encounters";
import { type Patient } from "@/lib/reception/patients";

// 배너(Story 4.5) — fetchPatient/revealRrn/revealContact 를 모킹(순수 헬퍼 maskPhone 등은 유지).
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/reception/patients", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reception/patients")>();
  return { ...actual, fetchPatient: vi.fn(), revealRrn: vi.fn(), revealContact: vi.fn() };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { fetchPatient, revealContact, revealRrn } from "@/lib/reception/patients";

const mockFetchPatient = vi.mocked(fetchPatient);
const mockRevealRrn = vi.mocked(revealRrn);
const mockRevealContact = vi.mocked(revealContact);

afterEach(() => vi.clearAllMocks());

const ENCOUNTER: Encounter = {
  id: "e1",
  encounter_no: "00000007",
  patient_id: "p1",
  department_id: "d1",
  room_id: null,
  doctor_id: "doc1",
  visit_type: "walk_in",
  status: "in_progress",
  cancel_reason: null,
  registered_at: "2026-06-21T00:00:00Z",
  consult_started_at: "2026-06-21T00:05:00Z",
  completed_at: null,
  cancelled_at: null,
  no_show_at: null,
  called_at: null,
  call_count: 0,
  last_called_by: null,
  created_by: "u1",
  is_active: true,
  created_at: "2026-06-21T00:00:00Z",
  updated_at: "2026-06-21T00:05:00Z",
};

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
    chronic_diseases: null,
    medications: null,
    notes: null,
    is_active: true,
    created_at: "2026-06-21T00:00:00Z",
    updated_at: "2026-06-21T00:00:00Z",
    ...overrides,
  };
}

describe("PatientBanner — 알레르기 can't-miss(AC3)", () => {
  it("알레르기가 있으면 role='alert' 로 전체 텍스트를 무-truncate 노출한다", async () => {
    const longAllergy = "페니실린(중증), 아스피린, 조영제, 땅콩, 라텍스 — 전부 표시되어야 함";
    mockFetchPatient.mockResolvedValueOnce(patient({ allergies: longAllergy }));

    render(<PatientBanner encounter={ENCOUNTER} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("환자 안전 경고");
    // critical 은닉 금지 — 전체 텍스트가 그대로 존재(truncation/"더보기" 없음).
    expect(alert).toHaveTextContent(longAllergy);
  });

  it("알레르기가 없으면 경고를 렌더하지 않는다(빈 경고 금지)", async () => {
    mockFetchPatient.mockResolvedValueOnce(patient({ allergies: null }));
    render(<PatientBanner encounter={ENCOUNTER} />);
    await screen.findByText("홍길동");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("PatientBanner — 민감정보 reveal(AC2)", () => {
  it("기본은 마스킹 — full RRN 미표시, '표시' 버튼은 감사 경고 접근가능명을 가진다", async () => {
    mockFetchPatient.mockResolvedValueOnce(patient());
    render(<PatientBanner encounter={ENCOUNTER} />);

    await screen.findByText("900101-1******"); // 마스킹 기본
    const revealBtn = screen.getByRole("button", { name: /주민등록번호 표시 — 조회 시 감사 로그 기록됨/ });
    expect(revealBtn).toBeInTheDocument();
    // 연락처도 마스킹(010-****-5678) + 표시 버튼.
    expect(screen.getByText("010-****-5678")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /연락처 표시 — 조회 시 감사 로그 기록됨/ })).toBeInTheDocument();
  });

  it("'표시' 클릭 시 서버 reveal 호출 → full RRN 인라인 치환·버튼 사라짐", async () => {
    mockFetchPatient.mockResolvedValueOnce(patient());
    mockRevealRrn.mockResolvedValueOnce({ resident_no: "9001011234567" });
    const user = userEvent.setup();

    render(<PatientBanner encounter={ENCOUNTER} />);
    const revealBtn = await screen.findByRole("button", { name: /주민등록번호 표시/ });
    await user.click(revealBtn);

    await waitFor(() => expect(mockRevealRrn).toHaveBeenCalledWith("p1"));
    // full RRN 이 하이픈 포맷으로 인라인 노출.
    expect(await screen.findByText("900101-1234567")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /주민등록번호 표시/ })).toBeNull();
  });

  it("연락처 '표시' 클릭 시 revealContact 호출 → full 연락처 노출", async () => {
    mockFetchPatient.mockResolvedValueOnce(patient());
    mockRevealContact.mockResolvedValueOnce({ phone: "010-1234-5678", address: null, email: null });
    const user = userEvent.setup();

    render(<PatientBanner encounter={ENCOUNTER} />);
    const btn = await screen.findByRole("button", { name: /연락처 표시/ });
    await user.click(btn);

    await waitFor(() => expect(mockRevealContact).toHaveBeenCalledWith("p1"));
    expect(await screen.findByText("010-1234-5678")).toBeInTheDocument();
  });
});
