// 도움말 스토리보드 캡처 코어 — 클라우드 로그인 · 번호 하이라이트 · 오버레이 정리.
// 단일 출처: 캡처 러너(capture.mjs)와 스펙(specs.mjs)이 이 모듈만 호출한다. 재구현 금지.
import { chromium } from "playwright";

// 캡처 대상 URL. 기본 = 클라우드 실데이터(정식). 로컬 캡처 시 PMS_BASE 로 오버라이드.
//   예) PMS_BASE=http://localhost:3002/patient_management_system node capture.mjs doctor
export const BASE = process.env.PMS_BASE ?? "https://kuntae802.mooo.com/patient_management_system";

// 캡처 뷰포트. annotate() 가 viewport 좌표(position:fixed)를 쓰므로 하이라이트 대상은
// 이 뷰포트 안에 있어야 정확히 입혀진다(폴드 아래 요소 주의 — README 참고). 9.1 의사 캡처와 동일.
export const VIEWPORT = {
  width: Number(process.env.PMS_VW) || 1440,
  height: Number(process.env.PMS_VH) || 900,
};

/** headless chromium 기동(브라우저 1개). 컨텍스트·페이지는 newPage 로 계정마다 새로 연다. */
export function launchBrowser() {
  return chromium.launch();
}

/** 계정별 새 컨텍스트 + 페이지 — 세션 격리(역할 전환 시 쿠키 누수 방지). 러너가 계정마다 1회 호출. */
export async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  return { ctx, page };
}

/** 로그인 → 역할 홈 리다이렉트·데이터 로드 대기. 데모 계정 비번은 전부 동일(specs.PASSWORD). */
export async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForLoadState("networkidle", { timeout: 45000 });
  await page.waitForTimeout(2500);
  // 인증 성공 검증 — 실패 시 /login 잔류. 던져서 오캡처(빈/로그인 페이지)가 커밋 이미지를 덮어쓰지 않게 한다.
  if (new URL(page.url()).pathname.endsWith("/login")) {
    throw new Error(`로그인 실패: ${email} (인증 후에도 /login 에 머무름 — 계정·비밀번호 확인)`);
  }
}

/** locators=[{n, locator}] 에 번호 원 + 빨강 테두리를 DOM 오버레이로 주입(FR-252, 외부 편집 도구 0).
 *  boundingBox(viewport 좌표) → position:fixed 오버레이. 반환 = 성공적으로 입힌 번호 배열. */
export async function annotate(page, locators) {
  const marks = [];
  for (const { n, locator } of locators) {
    try {
      const box = await locator.boundingBox();
      if (box) marks.push({ n, ...box });
    } catch {
      /* 요소 없으면 스킵(스펙이 화면과 안 맞으면 그 번호만 누락 — 러너 로그로 식별) */
    }
  }
  await page.evaluate((marks) => {
    for (const m of marks) {
      const box = document.createElement("div");
      box.className = "__hl";
      box.style.cssText = `position:fixed;left:${m.x - 4}px;top:${m.y - 4}px;width:${m.width + 8}px;height:${m.height + 8}px;border:3px solid #e11d48;border-radius:8px;z-index:99998;pointer-events:none;box-sizing:border-box;`;
      document.body.appendChild(box);
      const badge = document.createElement("div");
      badge.className = "__hl";
      badge.textContent = String(m.n);
      badge.style.cssText = `position:fixed;left:${m.x - 14}px;top:${m.y - 14}px;width:26px;height:26px;background:#e11d48;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;font-family:sans-serif;z-index:99999;pointer-events:none;`;
      document.body.appendChild(badge);
    }
  }, marks);
  return marks.map((m) => m.n);
}

/** 다음 화면 재캡처 전 오버레이 제거(같은 페이지를 재사용할 때). */
export async function clearAnnotations(page) {
  await page.evaluate(() => document.querySelectorAll(".__hl").forEach((e) => e.remove()));
}
