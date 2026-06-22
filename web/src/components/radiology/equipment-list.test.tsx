import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EquipmentList } from "@/components/radiology/equipment-list";
import type { Equipment } from "@/lib/radiology/imaging";

// 장비 목록(Story 5.8 AC3) — fetchEquipment 모킹. 검증: 장비 행 렌더·상태 라벨·빈 목록.
vi.mock("@/lib/radiology/imaging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/radiology/imaging")>();
  return { ...actual, fetchEquipment: vi.fn() };
});

import { fetchEquipment } from "@/lib/radiology/imaging";

const mockEquipment = vi.mocked(fetchEquipment);

afterEach(() => vi.clearAllMocks());

const rows: Equipment[] = [
  { id: "eq1", code: "XR-01", name: "제1일반촬영기", modality: "X-ray", status: "available", is_active: true },
  { id: "eq2", code: "US-01", name: "초음파진단기", modality: "US", status: "maintenance", is_active: true },
];

describe("EquipmentList", () => {
  it("장비 목록과 상태 라벨을 렌더한다", async () => {
    mockEquipment.mockResolvedValue(rows);
    render(<EquipmentList />);
    expect(await screen.findByText("XR-01")).toBeInTheDocument();
    expect(screen.getByText("제1일반촬영기")).toBeInTheDocument();
    expect(screen.getByText("가용")).toBeInTheDocument();
    expect(screen.getByText("점검 중")).toBeInTheDocument();
  });

  it("빈 목록은 안내 문구", async () => {
    mockEquipment.mockResolvedValue([]);
    render(<EquipmentList />);
    expect(await screen.findByText("등록된 장비가 없습니다.")).toBeInTheDocument();
  });
});
