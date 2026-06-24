import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentHistory } from "@/components/portal/payment-history";
import { ApiError } from "@/lib/api/client";
import type { PatientPaymentCard } from "@/lib/patient/payments";

// 마이 탭 수납·영수증(Story 8.3·FR-122·UX-DR17·DR22) — PaymentHistory 검증: 신뢰 노트 상시·수납 카드
// (날짜·요양기관·진료과·납부액·완료 배지·결제수단)·영수증 라우팅 링크·빈 상태·미연결(404) 온보딩.
// apiFetch(/patients/self)·fetchSelfPayments 모킹. ApiError 는 실제(instanceof 분기).

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});
vi.mock("@/lib/patient/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/patient/payments")>();
  return { ...actual, fetchSelfPayments: vi.fn() };
});
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { apiFetch } from "@/lib/api/client";
import { fetchSelfPayments } from "@/lib/patient/payments";

const mockApiFetch = vi.mocked(apiFetch);
const mockFetchPayments = vi.mocked(fetchSelfPayments);

function payCard(over: Partial<PatientPaymentCard> = {}): PatientPaymentCard {
  return {
    encounter_id: "enc-0001",
    payment_no: "R-20260619-000001",
    clinic_name: "○○의원",
    department_name: "내과",
    treatment_date: "2026-06-19",
    finalized_at: "2026-06-19T05:30:00Z",
    total_amount_krw: 17610,
    paid_amount_krw: 5280,
    payment_method: "card",
    status: "finalized",
    ...over,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("PaymentHistory", () => {
  it("연결된 환자: 신뢰 노트 상시 + 카드(요양기관·진료과·납부액·완료 배지·결제수단·영수증 링크)", async () => {
    mockApiFetch.mockResolvedValue({ name: "이수진" });
    mockFetchPayments.mockResolvedValue([payCard({})]);

    render(<PaymentHistory />);

    // 신뢰 노트(RLS·UX-DR22).
    expect(await screen.findByText(/결제 내역만 안전하게 표시됩니다/)).toBeInTheDocument();
    expect(screen.getByText(/다른 사람은 볼 수 없어요/)).toBeInTheDocument();
    // 카드: 요양기관·진료과·납부액(원)·완료 배지·결제수단.
    expect(screen.getByText(/○○의원/)).toBeInTheDocument();
    expect(screen.getByText(/내과/)).toBeInTheDocument();
    expect(screen.getByText(/5,280원/)).toBeInTheDocument();
    expect(screen.getByText("완료")).toBeInTheDocument();
    expect(screen.getByText(/카드/)).toBeInTheDocument();
    // 영수증 상세 라우팅(encounter_id·불투명 UUID).
    expect(screen.getByRole("link").closest("a")).toHaveAttribute("href", "/receipts/enc-0001");
  });

  it("결제 0건: 빈 상태 안내", async () => {
    mockApiFetch.mockResolvedValue({ name: "이수진" });
    mockFetchPayments.mockResolvedValue([]);

    render(<PaymentHistory />);

    expect(await screen.findByText("아직 결제 내역이 없어요.")).toBeInTheDocument();
  });

  it("결제완료 시각 없으면(finalized_at NULL) 진료일만 표시·시각 생략", async () => {
    mockApiFetch.mockResolvedValue({ name: "이수진" });
    mockFetchPayments.mockResolvedValue([payCard({ finalized_at: null })]);

    render(<PaymentHistory />);

    // 날짜는 진료일 기준 표시(시각 라벨 없음). 카드 자체는 렌더(납부액 노출).
    expect(await screen.findByText(/5,280원/)).toBeInTheDocument();
  });

  it("미연결(404 no_self_patient): 온보딩 유도 CTA·수납 조회 미호출", async () => {
    mockApiFetch.mockRejectedValue(
      new ApiError("no_self_patient", "연결된 환자 기록이 없습니다.", 404),
    );

    render(<PaymentHistory />);

    const cta = await screen.findByText("본인 진료기록 연결하기");
    expect(cta.closest("a")).toHaveAttribute("href", "/onboarding");
    expect(mockFetchPayments).not.toHaveBeenCalled();
  });
});
