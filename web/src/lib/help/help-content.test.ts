import { describe, expect, it } from "vitest";

import { HELP_GUIDES, helpHrefSlug, helpImageSrc } from "@/lib/help/help-content";
import { STAFF_NAV } from "@/lib/nav/staff-nav";

describe("helpHrefSlug", () => {
  it("href 를 안정적인 앵커 슬러그로 변환한다(인덱스 링크 ↔ 섹션 id 단일 출처)", () => {
    expect(helpHrefSlug("/doctor/waiting")).toBe("help-doctor-waiting");
    expect(helpHrefSlug("/reception/billing/history")).toBe("help-reception-billing-history");
    expect(helpHrefSlug("/patients")).toBe("help-patients");
  });
});

describe("helpImageSrc", () => {
  it("이미지 앱-내 경로에 basePath 를 부여한다(next/image basePath 함정 회피)", () => {
    // NEXT_PUBLIC_BASE_PATH 미설정 시 next.config 와 동일 폴백.
    expect(helpImageSrc("/help/doctor/waiting.png")).toBe(
      "/patient_management_system/help/doctor/waiting.png",
    );
  });
});

describe("HELP_GUIDES 무결성", () => {
  const navHrefs = new Set(STAFF_NAV.map((n) => n.href));

  it("모든 가이드 키는 STAFF_NAV 의 href 다(죽은 키·오타 방지)", () => {
    for (const key of Object.keys(HELP_GUIDES)) {
      expect(navHrefs.has(key)).toBe(true);
    }
  });

  it("각 가이드의 href 필드는 맵 키와 일치한다", () => {
    for (const [key, guide] of Object.entries(HELP_GUIDES)) {
      expect(guide.href).toBe(key);
    }
  });

  it("화면 이미지는 앱-내 절대경로(/help/...)이고 치수가 양수다(next/image 레이아웃 안정)", () => {
    for (const guide of Object.values(HELP_GUIDES)) {
      for (const s of guide.screens) {
        expect(s.image.startsWith("/help/")).toBe(true);
        expect(s.imageWidth).toBeGreaterThan(0);
        expect(s.imageHeight).toBeGreaterThan(0);
      }
    }
  });

  it("hotspot 번호는 1부터 연속이다(이미지에 구워진 번호와 1:1)", () => {
    for (const guide of Object.values(HELP_GUIDES)) {
      for (const s of guide.screens) {
        const nums = s.hotspots.map((h) => h.num);
        expect(nums).toEqual(nums.map((_, i) => i + 1));
      }
    }
  });

  it("각 화면은 hotspot 이 1개 이상이고 screens 가 비어있지 않다", () => {
    for (const guide of Object.values(HELP_GUIDES)) {
      expect(guide.screens.length).toBeGreaterThan(0);
      for (const s of guide.screens) {
        expect(s.hotspots.length).toBeGreaterThan(0);
      }
    }
  });

  it("원무(reception)에 보이는 모든 메뉴는 가이드가 채워져 있다(Story 9.3 — 준비 중 0)", () => {
    // reception 역할 메뉴는 권한 게이트가 없어 전부 노출 → 전부 가이드가 있어야 빠짐없이 수록(FR-253).
    const receptionHrefs = STAFF_NAV.filter((n) => n.roles.includes("reception")).map((n) => n.href);
    for (const href of receptionHrefs) {
      expect(HELP_GUIDES[href], `원무 메뉴 가이드 누락: ${href}`).toBeDefined();
    }
  });
});
