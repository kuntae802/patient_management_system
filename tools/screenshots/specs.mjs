// 캡처 스펙 레지스트리 — 화면 1장 = 1 엔트리. 러너(capture.mjs)가 role/screen 으로 필터해 처리한다.
// 새 화면 추가 = 이 배열에 엔트리 1개 추가(새 스크립트 작성 금지). 9.3~9.8 이 자기 역할 스펙을 여기에 더한다.
//
// ⚠️ 번호 정합(필수): 각 엔트리 annotate 의 n(①②③…) 은 그 화면의
//    web/src/lib/help/help-content.ts → HELP_GUIDES[href].screens[].hotspots[].num 과 1:1로 일치해야 한다.
//    어긋나면 도움말 설명이 엉뚱한 번호를 가리킨다.
//
// 각 엔트리:
//   role     : 역할(출력 디렉토리 web/public/help/<role>/ 결정 + 로그인 계정 그룹화)
//   account  : 로그인 이메일(데모 5직원 *@pms.local, 비번은 PASSWORD 공통)
//   screen   : 화면 키(출력 파일 <screen>.png + help-content image 경로와 정합)
//   goto     : async (page, BASE) => {}  로그인 후 그 화면으로 도달(자기완결 — URL 이동 또는 상호작용)
//   annotate : (page) => [{ n, locator }]  번호 하이라이트 대상(viewport 안에 있어야 정확)

export const PASSWORD = "Staff1234";

export const SPECS = [
  // ── 의사(doctor) — 9.1 의 의사 시범 콘텐츠와 정합(워크드 예제) ──
  {
    role: "doctor",
    account: "doctor@pms.local",
    screen: "waiting", // → web/public/help/doctor/waiting.png · help-content "/doctor/waiting" screens[0]
    async goto(page, BASE) {
      // 로그인 시 역할 홈(=진료 대기)으로 이미 착지하지만, 자기완결을 위해 명시 이동.
      await page.goto(`${BASE}/doctor/waiting`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2500);
    },
    annotate: (page) => [
      { n: 1, locator: page.getByRole("link", { name: "진료 대기" }) },
      { n: 2, locator: page.locator("select").first() },
      { n: 3, locator: page.getByRole("button", { name: "진료 시작" }).first() },
      { n: 4, locator: page.getByRole("button", { name: /진료 계속/ }).first() },
    ],
  },
  {
    role: "doctor",
    account: "doctor@pms.local",
    screen: "hub", // → web/public/help/doctor/hub.png · help-content "/doctor/waiting" screens[1]
    async goto(page, BASE) {
      // 진료 허브는 in_progress 내원의 "진료 계속" 클릭으로 도달(자기완결 — 진료 대기에서 시작).
      await page.goto(`${BASE}/doctor/waiting`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: /진료 계속/ }).first().click();
      await page.waitForURL("**/encounter/**", { timeout: 30000 });
      await page.waitForTimeout(3500);
    },
    annotate: (page) => [
      { n: 1, locator: page.getByText(/^내원 \d/).first() },
      { n: 2, locator: page.getByRole("button", { name: /표시/ }).first() },
      { n: 3, locator: page.getByText("활력징후").first() },
      { n: 4, locator: page.getByText("진단").first() },
      { n: 5, locator: page.getByText("진료 기록").first() },
      { n: 6, locator: page.getByRole("region", { name: "오더 패널" }) },
    ],
  },

  // ── 9.3~9.8: 원무/간호/방사선사/관리자/환자 스펙을 여기에 추가 ──
  // 예) { role: "reception", account: "reception@pms.local", screen: "waiting",
  //       async goto(page, BASE) { await page.goto(`${BASE}/reception/waiting`, ...); },
  //       annotate: (page) => [ { n: 1, locator: ... }, ... ] },
];
