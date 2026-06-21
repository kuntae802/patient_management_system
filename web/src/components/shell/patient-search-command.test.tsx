import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PatientSearchCommand } from "@/components/shell/patient-search-command";
import { usePermissions } from "@/hooks/use-permissions";
import { searchPatients, type PatientListItem } from "@/lib/reception/patients";

// 라우터·권한·검색 API 모킹(sexLabel 등 순수 헬퍼는 실제 유지).
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/hooks/use-permissions", () => ({ usePermissions: vi.fn() }));
vi.mock("@/lib/reception/patients", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reception/patients")>();
  return { ...actual, searchPatients: vi.fn() };
});

// Base UI Dialog(floating-ui)가 jsdom 에서 요구하는 브라우저 API 스텁(master-search-picker.test 패턴).
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

const PATIENT_A: PatientListItem = {
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
const PATIENT_B: PatientListItem = {
  id: "22222222-2222-2222-2222-222222222222",
  chart_no: "00000043",
  name: "홍길순",
  birth_date: "1985-12-25",
  sex: "female",
  resident_no_masked: "851225-2******",
  phone: "010-9999-0000",
  is_active: true,
  created_at: "2026-06-21T00:00:00Z",
};

beforeEach(() => {
  vi.mocked(usePermissions).mockReturnValue({ role: "reception", has: () => true });
  vi.mocked(searchPatients).mockResolvedValue([PATIENT_A, PATIENT_B]);
});

afterEach(() => vi.clearAllMocks());

describe("PatientSearchCommand — AC1 전역 Ctrl K · 검색 · aria-live", () => {
  it("Ctrl K 로 팔레트가 열린다(검색 입력 노출)", async () => {
    render(<PatientSearchCommand />);
    expect(screen.queryByRole("combobox", { name: "환자 검색" })).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });

    expect(await screen.findByRole("combobox", { name: "환자 검색" })).toBeInTheDocument();
  });

  it("입력 → 결과 행에 이름·차트번호·생년월일·마스킹 주민번호·연락처(오환자 단서)를 표시한다", async () => {
    const user = userEvent.setup();
    render(<PatientSearchCommand />);
    await user.click(screen.getByRole("button", { name: "전역 환자 검색 (Ctrl K)" }));

    await user.type(screen.getByRole("combobox", { name: "환자 검색" }), "홍길");

    const option = await screen.findByRole("option", { name: /홍길동/ });
    expect(option).toHaveTextContent("00000042"); // 차트번호
    expect(option).toHaveTextContent("1990-01-01"); // 생년월일(동명이인 단서)
    expect(option).toHaveTextContent("900101-1******"); // 마스킹 주민번호
    expect(option).toHaveTextContent("010-1234-5678"); // 연락처
    expect(searchPatients).toHaveBeenCalledWith("홍길", expect.any(AbortSignal), 20);
  });

  it("결과에 마스킹되지 않은 전체 주민번호(13자리)는 노출되지 않는다(UX-DR22)", async () => {
    const user = userEvent.setup();
    render(<PatientSearchCommand />);
    await user.click(screen.getByRole("button", { name: "전역 환자 검색 (Ctrl K)" }));
    await user.type(screen.getByRole("combobox", { name: "환자 검색" }), "홍");

    await screen.findByRole("option", { name: /홍길동/ });
    expect(screen.queryByText(/\d{6}-\d{7}/)).not.toBeInTheDocument(); // raw RRN 패턴 부재
    expect(screen.getByText("900101-1******")).toBeInTheDocument();
  });

  it("결과 개수를 aria-live(status)로 안내한다(PII 미낭독 — 개수만)", async () => {
    const user = userEvent.setup();
    render(<PatientSearchCommand />);
    await user.click(screen.getByRole("button", { name: "전역 환자 검색 (Ctrl K)" }));
    await user.type(screen.getByRole("combobox", { name: "환자 검색" }), "홍");

    const status = await screen.findByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("2명 검색됨"));
  });

  it("검색 결과 없음 → 안내 문구(색 비의존 텍스트)", async () => {
    vi.mocked(searchPatients).mockResolvedValue([]);
    const user = userEvent.setup();
    render(<PatientSearchCommand />);
    await user.click(screen.getByRole("button", { name: "전역 환자 검색 (Ctrl K)" }));
    await user.type(screen.getByRole("combobox", { name: "환자 검색" }), "없는환자");

    // 시각적 안내(<p>)와 aria-live(status) 양쪽에 노출 → 시각 문구만 한정해 단언.
    expect(await screen.findByText("검색 결과 없음", { selector: "p" })).toBeInTheDocument();
  });

  it("결과가 상한(20)에 도달하면 '더 정확히 입력' 잘림 안내를 표시한다(오환자·누락 방지)", async () => {
    // 상한(20)만큼 결과 → 더 많은 동명이인이 잘렸을 수 있음을 안내.
    const many: PatientListItem[] = Array.from({ length: 20 }, (_, i) => ({
      ...PATIENT_A,
      id: `id-${i}`,
      name: `김환자${i}`,
    }));
    vi.mocked(searchPatients).mockResolvedValue(many);
    const user = userEvent.setup();
    render(<PatientSearchCommand />);
    await user.click(screen.getByRole("button", { name: "전역 환자 검색 (Ctrl K)" }));
    await user.type(screen.getByRole("combobox", { name: "환자 검색" }), "김");

    // footer 고유 문구("…만 표시됩니다")로 한정(status 의 "상위 N명 표시 —" 와 중복 회피).
    expect(await screen.findByText(/상위 20명만 표시됩니다/)).toBeInTheDocument();
  });
});

describe("PatientSearchCommand — AC2 선택 → 환자 상세 이동", () => {
  it("결과 클릭 시 /patients/{id}(UUID)로 이동한다", async () => {
    const user = userEvent.setup();
    render(<PatientSearchCommand />);
    await user.click(screen.getByRole("button", { name: "전역 환자 검색 (Ctrl K)" }));
    await user.type(screen.getByRole("combobox", { name: "환자 검색" }), "홍길");

    await user.click(await screen.findByRole("option", { name: /홍길순/ }));

    expect(push).toHaveBeenCalledWith(`/patients/${PATIENT_B.id}`);
  });

  it("키보드(↓ Enter)로 선택해 이동한다", async () => {
    const user = userEvent.setup();
    render(<PatientSearchCommand />);
    await user.click(screen.getByRole("button", { name: "전역 환자 검색 (Ctrl K)" }));
    const input = screen.getByRole("combobox", { name: "환자 검색" });
    await user.type(input, "홍길");
    await screen.findByRole("option", { name: /홍길동/ });

    await user.keyboard("{ArrowDown}{Enter}"); // index 0 → 1(홍길순) 선택

    expect(push).toHaveBeenCalledWith(`/patients/${PATIENT_B.id}`);
  });
});

describe("PatientSearchCommand — AC4 RBAC 노출 게이트", () => {
  it("patient.read 미보유 직원에게는 트리거가 렌더되지 않는다", () => {
    vi.mocked(usePermissions).mockReturnValue({ role: "radiologist", has: () => false });
    render(<PatientSearchCommand />);
    expect(
      screen.queryByRole("button", { name: "전역 환자 검색 (Ctrl K)" }),
    ).not.toBeInTheDocument();
  });

  it("미보유 시 Ctrl K 단축키도 동작하지 않는다", () => {
    vi.mocked(usePermissions).mockReturnValue({ role: "radiologist", has: () => false });
    render(<PatientSearchCommand />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    expect(screen.queryByRole("combobox", { name: "환자 검색" })).not.toBeInTheDocument();
  });
});
