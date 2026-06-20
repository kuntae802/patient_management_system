import { describe, expect, it } from "vitest";

import { filterNav, ROLE_LABELS, STAFF_NAV, type NavItem } from "./staff-nav";

const labels = (items: NavItem[]) => items.map((i) => i.label);

describe("filterNav", () => {
  it("admin + 전체 권한 → 관리 섹션 노출, 타 역할 항목 제외", () => {
    const items = filterNav(STAFF_NAV, "admin", () => true);
    expect(labels(items)).toContain("권한");
    expect(labels(items)).toContain("감사 로그");
    expect(labels(items)).not.toContain("대기 현황"); // reception 전용
  });

  it("admin 인데 권한 0 → requiredPermission 항목 숨김, 무권한 항목만", () => {
    const items = filterNav(STAFF_NAV, "admin", () => false);
    expect(labels(items)).not.toContain("권한"); // rbac.manage 필요
    expect(labels(items)).toContain("근무 스케줄"); // 권한 불필요
  });

  it("reception 권한 0 → 직무 항목(환자 등록·검색·수납 포함) 모두 노출, 관리 항목 제외", () => {
    const items = filterNav(STAFF_NAV, "reception", () => false);
    expect(labels(items)).toContain("대기 현황");
    expect(labels(items)).toContain("접수");
    expect(labels(items)).toContain("수납"); // 직무 본질 → 권한 게이트 없음
    expect(labels(items)).toContain("환자 등록"); // 직무 본질 → 권한 게이트 없음
    expect(labels(items)).toContain("환자 검색");
    expect(labels(items)).not.toContain("권한"); // admin 전용 관리 항목
  });

  it("nurse 권한 0 → 활력징후 입력 등 직무 항목 노출", () => {
    const items = filterNav(STAFF_NAV, "nurse", () => false);
    expect(labels(items)).toContain("처치 워크리스트");
    expect(labels(items)).toContain("활력징후 입력"); // 간호 직무 → 권한 게이트 없음
    expect(labels(items)).toContain("간호기록");
  });

  it("role null → 빈 배열", () => {
    expect(filterNav(STAFF_NAV, null, () => true)).toEqual([]);
  });

  it("역할 간 항목 교차 오염 없음(nurse 표본)", () => {
    const nurseItems = labels(filterNav(STAFF_NAV, "nurse", () => true));
    expect(nurseItems).toContain("처치 워크리스트");
    expect(nurseItems).not.toContain("촬영 워크리스트"); // radiologist 전용
  });
});

describe("ROLE_LABELS", () => {
  it("역할 코드 → 한글 표시명", () => {
    expect(ROLE_LABELS.reception).toBe("원무과");
    expect(ROLE_LABELS.admin).toBe("관리자");
    expect(ROLE_LABELS.patient).toBe("환자");
  });
});
