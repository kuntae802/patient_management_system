import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VisitHistory } from "@/components/portal/visit-history";
import { ApiError } from "@/lib/api/client";
import type { PatientEncounterCard } from "@/lib/patient/records";

// 내 기록(Story 8.1·FR-120·UX-DR17·DR22) — VisitHistory 검증: 신뢰 노트 상시·내원 카드(날짜·환자 상태
// 라벨·의사·진료과·진단 쉬운 말 부연)·취소 사유·연도 그룹·빈 상태·미연결(404) 온보딩 유도.
// apiFetch(/patients/self)·fetchSelfEncounters 모킹. ApiError 는 실제(instanceof 분기).

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});
vi.mock("@/lib/patient/records", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/patient/records")>();
  return { ...actual, fetchSelfEncounters: vi.fn() };
});
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { apiFetch } from "@/lib/api/client";
import { fetchSelfEncounters } from "@/lib/patient/records";

const mockApiFetch = vi.mocked(apiFetch);
const mockFetchEncounters = vi.mocked(fetchSelfEncounters);

function card(overrides: Partial<PatientEncounterCard>): PatientEncounterCard {
  return {
    id: crypto.randomUUID(),
    encounter_no: "00000001",
    status: "completed",
    visit_type: "reserved",
    department_name: "내과",
    doctor_name: "이정훈",
    scheduled_start: "2026-06-19T05:30:00Z",
    registered_at: "2026-06-19T05:20:00Z",
    consult_started_at: "2026-06-19T05:30:00Z",
    completed_at: "2026-06-19T05:50:00Z",
    cancelled_at: null,
    created_at: "2026-06-19T05:10:00Z",
    cancel_reason: null,
    primary_diagnosis_name: "본태성(원발성) 고혈압",
    primary_diagnosis_friendly_note: "혈압이 높은 상태",
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("VisitHistory", () => {
  it("연결된 환자: 신뢰 노트 상시 + 카드(날짜·완료 배지·의사·진료과·진단 쉬운 말 부연)", async () => {
    mockApiFetch.mockResolvedValue({ name: "이수진" });
    mockFetchEncounters.mockResolvedValue([card({})]);

    render(<VisitHistory />);

    // 신뢰 노트(RLS·UX-DR22) — 본인 이름 + 프라이버시 카피("본인"은 <b> 분리 → 뒤 텍스트로 매칭).
    expect(await screen.findByText(/정보만 안전하게 표시됩니다/)).toBeInTheDocument();
    expect(screen.getByText(/다른 사람은 볼 수 없어요/)).toBeInTheDocument();
    expect(screen.getAllByText(/이수진/).length).toBeGreaterThan(0);
    // 카드: 의사·진료과·환자 상태 라벨·진단 쉬운 말 부연.
    expect(screen.getByText("이정훈")).toBeInTheDocument();
    expect(screen.getByText(/내과/)).toBeInTheDocument();
    expect(screen.getByText("완료")).toBeInTheDocument();
    expect(screen.getByText(/본태성\(원발성\) 고혈압/)).toBeInTheDocument();
    expect(screen.getByText(/\(혈압이 높은 상태\)/)).toBeInTheDocument();
    // 연도 그룹 캡션.
    expect(screen.getByText("2026년")).toBeInTheDocument();
  });

  it("취소 내원: 진단 대신 취소 사유(쉬운 말)를 보인다", async () => {
    mockApiFetch.mockResolvedValue({ name: "이수진" });
    mockFetchEncounters.mockResolvedValue([
      card({
        status: "cancelled",
        cancelled_at: "2026-02-05T07:00:00Z",
        consult_started_at: null,
        cancel_reason: "본인 사정으로 예약을 취소했어요",
        primary_diagnosis_name: null,
        primary_diagnosis_friendly_note: null,
      }),
    ]);

    render(<VisitHistory />);

    expect(await screen.findByText("취소")).toBeInTheDocument();
    expect(screen.getByText("사유")).toBeInTheDocument();
    expect(screen.getByText("본인 사정으로 예약을 취소했어요")).toBeInTheDocument();
    expect(screen.queryByText("진단")).not.toBeInTheDocument();
  });

  it("미방문(no_show): 환자 톤 라벨 + 사유 NULL 시 상태 안내문", async () => {
    mockApiFetch.mockResolvedValue({ name: "김영희" });
    mockFetchEncounters.mockResolvedValue([
      card({
        status: "no_show",
        consult_started_at: null,
        cancel_reason: null,
        primary_diagnosis_name: null,
      }),
    ]);

    render(<VisitHistory />);

    expect(await screen.findByText("미방문")).toBeInTheDocument();
    expect(screen.getByText("방문하지 않은 진료예요.")).toBeInTheDocument();
  });

  it("취소 + 사유 NULL: 카드 본문이 비지 않고 중립 안내문 폴백", async () => {
    mockApiFetch.mockResolvedValue({ name: "이수진" });
    mockFetchEncounters.mockResolvedValue([
      card({
        status: "cancelled",
        consult_started_at: null,
        cancel_reason: null,
        primary_diagnosis_name: null,
      }),
    ]);

    render(<VisitHistory />);

    expect(await screen.findByText("취소")).toBeInTheDocument();
    expect(screen.getByText("예약이 취소되었어요.")).toBeInTheDocument();
  });

  it("내원 0건: 빈 상태 안내", async () => {
    mockApiFetch.mockResolvedValue({ name: "이수진" });
    mockFetchEncounters.mockResolvedValue([]);

    render(<VisitHistory />);

    expect(await screen.findByText("아직 진료 내역이 없어요.")).toBeInTheDocument();
  });

  it("미연결(404 no_self_patient): 온보딩 유도 CTA", async () => {
    mockApiFetch.mockRejectedValue(new ApiError("no_self_patient", "연결된 환자 기록이 없습니다.", 404));

    render(<VisitHistory />);

    const cta = await screen.findByText("본인 진료기록 연결하기");
    expect(cta).toBeInTheDocument();
    expect(cta.closest("a")).toHaveAttribute("href", "/onboarding");
    expect(mockFetchEncounters).not.toHaveBeenCalled();
  });
});
