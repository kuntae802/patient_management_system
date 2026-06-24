import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api/client";
import {
  compactKrw,
  fetchDashboardOperations,
  formatPercent,
  monthDayLabel,
} from "@/lib/dashboard/operations";

// 운영 대시보드 lib(Story 8.5) — apiFetch URL 조립 + 표시 포맷 헬퍼 검증. 전 경로 snake_case·read-only.
vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn() }));
const mockApiFetch = vi.mocked(apiFetch);
afterEach(() => vi.clearAllMocks());

describe("fetchDashboardOperations — GET URL", () => {
  it("인자 없음 → 쿼리 없는 기본 경로", async () => {
    mockApiFetch.mockResolvedValueOnce({} as never);
    await fetchDashboardOperations();
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/dashboard/operations");
  });

  it("date·days → 쿼리스트링 부착", async () => {
    mockApiFetch.mockResolvedValueOnce({} as never);
    await fetchDashboardOperations("2026-06-24", 7);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/v1/dashboard/operations?date=2026-06-24&days=7",
    );
  });

  it("days 만 → days 쿼리만", async () => {
    mockApiFetch.mockResolvedValueOnce({} as never);
    await fetchDashboardOperations(undefined, 14);
    expect(mockApiFetch).toHaveBeenCalledWith("/v1/dashboard/operations?days=14");
  });
});

describe("표시 포맷 헬퍼", () => {
  it("formatPercent — 0~1 → 퍼센트(소수 1자리)", () => {
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(0.6667)).toBe("66.7%");
    expect(formatPercent(1)).toBe("100.0%");
  });

  it("compactKrw — 0 → 빈문자열, 큰 금액 → 압축", () => {
    expect(compactKrw(0)).toBe("");
    expect(compactKrw(13000)).toMatch(/만/); // ko-KR compact → "1.3만"
  });

  it("monthDayLabel — plain 날짜 → MM.DD(타임존 변환 없음)", () => {
    expect(monthDayLabel("2026-06-24")).toBe("06.24");
    expect(monthDayLabel("2020-03-15")).toBe("03.15");
    expect(monthDayLabel("bad")).toBe("bad");
  });
});
