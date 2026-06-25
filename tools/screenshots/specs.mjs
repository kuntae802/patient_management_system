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
  {
    role: "doctor",
    account: "doctor@pms.local",
    screen: "radiology", // 판독 워크리스트 /doctor/radiology (Story 9.4)
    async goto(page, BASE) {
      // 좌측 판독 대기 목록(imaging·performed·활성내원=demo x05) 첫 항목 클릭 → 우측 ReadingPanel 표시.
      await page.goto(`${BASE}/doctor/radiology`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2200);
      // 목록 첫 항목 클릭 → 우측 ReadingPanel 표시. 데모 x05=오세훈 흉부촬영 우선,
      // 텍스트가 안 맞으면 좌측 판독 대기 목록(section ul li button)의 첫 항목으로 폴백.
      let item = page.getByRole("button").filter({ hasText: /흉부|오세훈/ }).first();
      if (!(await item.count())) item = page.locator("section ul li button").first();
      if (await item.count()) {
        await item.click();
        await page.waitForTimeout(2000); // ReadingPanel 렌더
      }
    },
    annotate: (page) => [
      { n: 1, locator: page.getByRole("heading", { name: "판독 대기 영상검사" }) },
      { n: 2, locator: page.getByPlaceholder("영상 판독 소견을 입력하세요.") },
      { n: 3, locator: page.getByPlaceholder("결론·임프레션(선택).") },
      { n: 4, locator: page.getByRole("button", { name: "판독 완료" }) },
    ],
  },

  // ── 원무(reception) — Story 9.3 (계정 reception@pms.local) ──
  // ⚠️ 상태 의존 화면이 많다(검색·진료과 선택·리마인더 실행·행 클릭 후라야 데이터가 보임). goto 가 그 상태까지 만든다.
  // ⚠️ 재현 전제(미충족 시 일부 화면이 빈 화면 → annotate 가 그 번호만 누락, 러너는 "번호 0개" 경고만 — fail-soft):
  //    · 평일(월~금)에 캡처 — 데모 근무표가 평일만이라 주말엔 schedule 그리드가 "근무 슬롯 없음"으로 뜬다.
  //    · 캡처 대상 DB(클라우드/로컬)에 demo_seed 적용 + reception RBAC 그랜트 존재 — 미적용 시 권한 가드가 홈으로 리다이렉트.
  //    · 오늘 활성 내원(registered/in_progress) 존재 — 대기 호출·수납 정산·리마인더 대상의 데이터 원천.
  {
    role: "reception",
    account: "reception@pms.local",
    screen: "waiting", // 대기 현황 /reception/waiting (로그인 후 원무 홈·직접 도달)
    async goto(page, BASE) {
      await page.goto(`${BASE}/reception/waiting`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2800);
    },
    annotate: (page) => [
      { n: 1, locator: page.getByRole("combobox", { name: "진료과" }) },
      { n: 2, locator: page.getByRole("button", { name: "다음 날짜" }) },
      { n: 3, locator: page.getByRole("button", { name: "새로고침" }) },
      { n: 4, locator: page.getByRole("button", { name: "호출" }).first() },
      { n: 5, locator: page.getByRole("button", { name: /재호출|호출/ }).last() },
    ],
  },
  {
    role: "reception",
    account: "reception@pms.local",
    screen: "intake", // 접수 /reception/intake (환자 검색·선택 + 진료과 선택까지)
    async goto(page, BASE) {
      await page.goto(`${BASE}/reception/intake`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1500);
      await page.getByRole("combobox", { name: "환자 검색" }).fill("김");
      await page.waitForTimeout(2200); // 디바운스 + 결과
      const opt = page.getByRole("option").first();
      if (await opt.count()) {
        await opt.click();
        await page.waitForTimeout(900);
      }
      try {
        await page.getByRole("combobox", { name: "진료과" }).selectOption({ label: "내과" });
      } catch {
        /* 진료과 라벨 불일치 시 스킵 — 캡처는 진행 */
      }
      await page.waitForTimeout(1000);
    },
    // 환자 선택 후엔 검색창이 "선택된 환자 카드"로 대체됨 → n1 은 그 카드(변경 버튼)를 가리킨다.
    annotate: (page) => [
      { n: 1, locator: page.getByRole("button", { name: "변경" }) },
      { n: 2, locator: page.getByRole("combobox", { name: "진료과" }) },
      { n: 3, locator: page.getByRole("button", { name: "접수" }) },
    ],
  },
  {
    role: "reception",
    account: "reception@pms.local",
    screen: "schedule", // 예약 관리 /reception/schedule (진료과 선택해야 그리드 표시)
    async goto(page, BASE) {
      await page.goto(`${BASE}/reception/schedule`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1500);
      try {
        await page.getByRole("combobox").first().selectOption({ label: "내과" }); // 데모 근무표=내과만 슬롯 존재
      } catch {
        /* 진료과 select 미발견/라벨 불일치 시 스킵 */
      }
      await page.waitForTimeout(2500); // 슬롯 그리드 로드
    },
    annotate: (page) => [
      { n: 1, locator: page.getByRole("combobox").first() },
      { n: 2, locator: page.locator('input[type="date"]').first() },
      { n: 3, locator: page.getByRole("grid", { name: "예약 캘린더" }) },
    ],
  },
  {
    role: "reception",
    account: "reception@pms.local",
    screen: "reminders", // 리마인더 /reception/reminders (실행 클릭해야 로그·요약)
    async goto(page, BASE) {
      await page.goto(`${BASE}/reception/reminders`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1500);
      try {
        await page.getByRole("button", { name: "리마인더 실행" }).click();
        await page.waitForTimeout(2500); // 발송 시뮬 + 로그 렌더
      } catch {
        /* 실행 버튼 미발견(권한 등) — 빈 상태라도 캡처 */
      }
    },
    annotate: (page) => [
      { n: 1, locator: page.locator('input[type="date"]').first() },
      { n: 2, locator: page.getByRole("button", { name: "리마인더 실행" }) },
      { n: 3, locator: page.getByText("수신처").first() },
    ],
  },
  {
    role: "reception",
    account: "reception@pms.local",
    screen: "register", // 환자 등록 /reception/register (빈 폼)
    async goto(page, BASE) {
      await page.goto(`${BASE}/reception/register`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2000);
    },
    annotate: (page) => [
      { n: 1, locator: page.getByPlaceholder("예: 홍길동") },
      { n: 2, locator: page.getByPlaceholder("예: 900101-1234567") },
      { n: 3, locator: page.getByLabel("보험유형") },
      { n: 4, locator: page.getByPlaceholder("예: 010-1234-5678") },
      { n: 5, locator: page.getByRole("button", { name: "환자 등록" }) },
    ],
  },
  {
    role: "reception",
    account: "reception@pms.local",
    screen: "patients", // 환자 검색 /patients (검색어 입력해야 결과)
    async goto(page, BASE) {
      await page.goto(`${BASE}/patients`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1500);
      await page.getByRole("searchbox", { name: "환자 검색" }).fill("김");
      await page.waitForTimeout(1800); // 디바운스 + 결과
    },
    annotate: (page) => [
      { n: 1, locator: page.getByRole("searchbox", { name: "환자 검색" }) },
      { n: 2, locator: page.getByRole("status").first() },
      { n: 3, locator: page.getByRole("button").filter({ hasText: "김" }).first() },
    ],
  },
  {
    role: "reception",
    account: "reception@pms.local",
    screen: "billing", // 수납 워크리스트 /reception/billing (직접·데이터 있음)
    async goto(page, BASE) {
      await page.goto(`${BASE}/reception/billing`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2500);
    },
    annotate: (page) => [
      { n: 1, locator: page.getByRole("heading", { name: "수납 대상 내원" }) },
      { n: 2, locator: page.getByRole("link").filter({ hasText: "정산 대상" }).first() },
      { n: 3, locator: page.getByRole("link").filter({ hasText: "선수납 가능" }).first() },
    ],
  },
  {
    role: "reception",
    account: "reception@pms.local",
    screen: "billing-detail", // 수납 상세 (워크리스트 정산대상 행 클릭 → 집계·결제)
    async goto(page, BASE) {
      await page.goto(`${BASE}/reception/billing`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2000);
      // 정산 대상(진찰중) 행 우선, 없으면 첫 행 클릭
      const settle = page.getByRole("link").filter({ hasText: "정산 대상" }).first();
      const target = (await settle.count()) ? settle : page.getByRole("link").filter({ hasText: /선수납 가능|정산 대상/ }).first();
      await target.click();
      await page.waitForURL("**/reception/billing/**", { timeout: 30000 });
      await page.waitForTimeout(3000); // buildPayment 집계 렌더
    },
    annotate: (page) => [
      { n: 1, locator: page.getByText("본인부담금 (환자 청구)") },
      { n: 2, locator: page.getByText("총 진료비") },
      { n: 3, locator: page.getByRole("radiogroup", { name: "결제 수단" }) },
      { n: 4, locator: page.getByRole("button", { name: "결제·내원 완료" }) },
    ],
  },
  {
    role: "reception",
    account: "reception@pms.local",
    screen: "history", // 수납 내역 /reception/billing/history (자동 전체 로드)
    async goto(page, BASE) {
      await page.goto(`${BASE}/reception/billing/history`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2500);
    },
    annotate: (page) => [
      { n: 1, locator: page.getByPlaceholder(/김근태/) },
      { n: 2, locator: page.getByLabel("정산 시작일") },
      { n: 3, locator: page.getByRole("table") },
      { n: 4, locator: page.getByRole("link", { name: "영수증 보기" }).first() },
    ],
  },

  // ── 9.4~9.8: 간호/방사선사/관리자/환자 스펙을 여기에 추가 ──
];
