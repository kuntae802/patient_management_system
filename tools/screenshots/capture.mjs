// 도움말 스크린샷 캡처 러너 — 스펙(specs.mjs)을 순회하며 역할 로그인 → 화면 도달 →
// 번호 하이라이트(DOM 오버레이) → PNG 저장. 외부 이미지 편집 도구 의존 0(FR-252).
//
// 사용법:
//   node capture.mjs                 # 모든 스펙 캡처 → web/public/help/<role>/<screen>.png
//   node capture.mjs doctor          # doctor 역할만
//   node capture.mjs doctor hub      # doctor/hub 한 장만
//   node capture.mjs doctor --out=out/help   # 스크래치 디렉토리로(커밋 이미지 미덮어씀 — 검증용)
//   PMS_BASE=http://localhost:3002/patient_management_system node capture.mjs   # 로컬 캡처
//
// 출력 기본 = web/public/help (정적 임베드 대상·커밋). 도움말 페이지가 런타임 캡처 없이 임베드한다(AC4).
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { annotate, BASE, clearAnnotations, launchBrowser, login, newPage } from "./lib.mjs";
import { PASSWORD, SPECS } from "./specs.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// --out=<dir> → 스크래치 출력(상대=cwd 기준). 미지정 → web/public/help(레포 정식 경로).
const outFlag = process.argv.find((a) => a.startsWith("--out="));
const outDir = outFlag ? outFlag.slice("--out=".length).trim() : "";
if (outFlag && outDir === "") {
  console.error("--out= 에 디렉토리 경로를 지정하세요(빈 값은 cwd 오염 위험).");
  process.exit(1);
}
const OUT_ROOT = outDir
  ? resolve(process.cwd(), outDir)
  : resolve(here, "../../web/public/help");

// 위치 인자: [role] [screen] (--플래그 제외).
const [roleFilter, screenFilter] = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const targets = SPECS.filter(
  (s) => (!roleFilter || s.role === roleFilter) && (!screenFilter || s.screen === screenFilter),
);

if (targets.length === 0) {
  console.error(`매칭되는 스펙이 없습니다 (role=${roleFilter ?? "*"}, screen=${screenFilter ?? "*"}).`);
  console.error("사용 가능 스펙:", SPECS.map((s) => `${s.role}/${s.screen}`).join(", ") || "(없음)");
  process.exit(1);
}

// 계정별 그룹화 → 계정마다 새 컨텍스트로 로그인(세션 격리). 같은 계정 화면은 한 세션에서 연속 캡처.
const byAccount = new Map();
for (const spec of targets) {
  if (!byAccount.has(spec.account)) byAccount.set(spec.account, []);
  byAccount.get(spec.account).push(spec);
}

console.log(`BASE=${BASE}  출력=${OUT_ROOT}  대상 ${targets.length}장`);

const browser = await launchBrowser();
let ok = 0;
let failed = 0;
try {
  for (const [account, specs] of byAccount) {
    const { ctx, page } = await newPage(browser);
    try {
      // 계정별 비밀번호 — 직원은 공통 PASSWORD, 환자 데모(pms.patient.demo)는 spec.password 로 오버라이드.
      await login(page, account, specs[0].password ?? PASSWORD);
      for (const spec of specs) {
        try {
          await spec.goto(page, BASE);
          const nums = await annotate(page, spec.annotate(page));
          if (nums.length === 0) {
            console.warn(`  ⚠ ${spec.role}/${spec.screen} — 하이라이트 번호 0개(셀렉터·화면·뷰포트 확인 필요).`);
          }
          const out = resolve(OUT_ROOT, spec.role, `${spec.screen}.png`);
          await mkdir(dirname(out), { recursive: true });
          await page.screenshot({ path: out });
          await clearAnnotations(page);
          ok += 1;
          console.log(`  ✓ ${spec.role}/${spec.screen} — 번호 [${nums.join(", ")}] → ${out}`);
        } catch (err) {
          failed += 1;
          console.error(`  ✗ ${spec.role}/${spec.screen} — ${err.message}`);
        }
      }
    } catch (err) {
      // 로그인 실패 등 계정 단위 오류 → 이 계정 화면을 모두 실패로 집계하고 다음 계정 계속(전체 런 중단 방지).
      failed += specs.length;
      console.error(`  ✗ ${account} — ${err.message} (이 계정 ${specs.length}장 건너뜀)`);
    } finally {
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`완료: 성공 ${ok} / 실패 ${failed}`);
process.exit(failed > 0 ? 1 : 0);
