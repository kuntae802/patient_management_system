import { describe, expect, it } from "vitest";

// 캡처 스펙(번호를 이미지에 굽는 단일 출처) — 콘텐츠 num 과의 정합을 자동 대조하기 위해 직접 import.
// SPECS 의 annotate 함수는 import 시 실행되지 않으며(아래 테스트에서 stub page 로 호출), playwright 미의존.
import { SPECS } from "../../../../tools/screenshots/specs.mjs";
import { PATIENT_HELP_GUIDES } from "@/lib/help/patient-help-content";

// annotate(page) 가 page.getBy*(...).filter(...).first() 를 호출해도 throw 하지 않도록, 어떤 속성 접근·
// 호출에도 자기 자신을 반환하는 체이너블 stub. 반환 배열의 { n } 만 쓰므로 locator 는 무엇이든 무방.
const PAGE_STUB: unknown = new Proxy(function () { return PAGE_STUB; }, {
  get: () => PAGE_STUB,
  apply: () => PAGE_STUB,
});

describe("PATIENT_HELP_GUIDES 무결성(Story 9.8)", () => {
  it("환자 4개 메뉴(예약·내 진료기록·처방·검사 결과·수납·영수증)가 채워져 있다", () => {
    expect(PATIENT_HELP_GUIDES).toHaveLength(4);
    expect(PATIENT_HELP_GUIDES.map((g) => g.label)).toEqual([
      "예약",
      "내 진료기록",
      "처방·검사 결과",
      "수납·영수증",
    ]);
  });

  it("각 메뉴는 화면이 1개 이상이고 키가 고유하다(앵커 중복 방지)", () => {
    const keys = new Set<string>();
    for (const g of PATIENT_HELP_GUIDES) {
      expect(g.screens.length, `화면 없음: ${g.label}`).toBeGreaterThan(0);
      expect(keys.has(g.key), `중복 키: ${g.key}`).toBe(false);
      keys.add(g.key);
    }
  });

  it("화면 이미지는 환자 경로(/help/patient/)이고 치수가 양수다(next/image 레이아웃 안정)", () => {
    for (const g of PATIENT_HELP_GUIDES) {
      for (const s of g.screens) {
        expect(s.image.startsWith("/help/patient/"), s.image).toBe(true);
        expect(s.imageWidth).toBeGreaterThan(0);
        expect(s.imageHeight).toBeGreaterThan(0);
      }
    }
  });

  it("hotspot 번호는 화면마다 1부터 연속이다(갭·비연속·중복 금지)", () => {
    for (const g of PATIENT_HELP_GUIDES) {
      for (const s of g.screens) {
        expect(s.hotspots.length, `hotspot 없음: ${s.title}`).toBeGreaterThan(0);
        const nums = s.hotspots.map((h) => h.num);
        // [1,2,…,n] 과 정확히 일치 → 갭([1,2,4])·비연속([1,3,2])·중복([1,2,2])·1-미시작을 모두 차단.
        expect(nums).toEqual(nums.map((_, i) => i + 1));
      }
    }
  });

  it("캡처 스펙 번호(이미지에 구운 n) = 콘텐츠 hotspot num — 화면별 정합(이미지↔설명 어긋남·갭 방지)", () => {
    // 번호의 단일 출처는 specs.mjs annotate 의 n(실제로 이미지에 구워짐). 콘텐츠 num 이 그것과 화면별로
    // 정확히 같아야 사용자가 보는 이미지 번호와 설명 번호가 어긋나지 않는다. 수기 동기화의 어긋남을 봉쇄.
    const patientSpecs = SPECS.filter((s: { role: string }) => s.role === "patient");
    const byScreen = new Map(patientSpecs.map((s: { screen: string }) => [s.screen, s]));

    for (const g of PATIENT_HELP_GUIDES) {
      for (const s of g.screens) {
        const key = s.image.replace("/help/patient/", "").replace(".png", "");
        const spec = byScreen.get(key) as { annotate: (p: unknown) => { n: number }[] } | undefined;
        expect(spec, `캡처 스펙 없음: ${key}`).toBeDefined();
        const specNums = spec!.annotate(PAGE_STUB).map((a) => a.n);
        const contentNums = s.hotspots.map((h) => h.num);
        expect(specNums, `이미지↔설명 번호 불일치: ${key}`).toEqual(contentNums);
      }
    }
  });
});
