# 도움말 스크린샷 캡처 파이프라인 (Story 9.2)

직원 도움말 페이지(`/help`)에 임베드할 **번호 하이라이트 스크린샷**을 재현 가능하게 생성하는 도구.
playwright(headless chromium)로 역할 계정으로 로그인 → 화면 도달 → 핵심 동작요소에 **번호 원 + 빨강
테두리를 DOM 오버레이로 주입**(별도 이미지 편집 도구 0, FR-252) → PNG 저장. 도움말 페이지는 이 정적
이미지를 임베드한다(런타임 캡처 없음).

## 구성

| 파일 | 역할 |
|---|---|
| `lib.mjs` | 캡처 코어 — `BASE`/`VIEWPORT`/`launchBrowser`/`newPage`/`login`/`annotate`/`clearAnnotations`. 단일 출처. |
| `specs.mjs` | 캡처 스펙 레지스트리 — 화면 1장 = 엔트리 1개(role·account·screen·goto·annotate). 화면 추가 = 여기에 엔트리 추가. |
| `capture.mjs` | 러너 — 스펙을 순회해 로그인·도달·하이라이트·저장. role/screen 필터 지원. |

## 전제조건

```bash
cd tools/screenshots
npm install                      # playwright (package.json)
npx playwright install chromium  # 브라우저(머신에 없을 때만)
```

## 더미 데이터 선행 (빈 화면 방지)

캡처 대상 화면이 0행이면 안 되므로 **캡처 전 `supabase/demo_seed.sql`을 적용**한다. 시드는 오늘(KST)
기준 상대 날짜라 **캡처 직전 재적용**하면 대기시간 등이 가장 신선하다(멱등 재실행 안전).

- **로컬:** `docker exec -i <supabase_db_컨테이너> psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/demo_seed.sql`
- **클라우드(정식 캡처 대상):** 클라우드 Supabase에 같은 방식으로 적용(배포 운영 메모 참조). `BASE`가 가리키는 환경의 DB에 적용해야 화면에 보인다.

시드가 채우는 화면(직원 5역할): 대기 현황·진료 대기·진료 허브·판독 워크리스트(판독 대기 영상 1건)·촬영
워크리스트·영상 업로드·처치/활력/간호·수납(정산·선수납)·예약/리마인더·환자 검색·운영 대시보드·감사 로그 등.

## 실행

```bash
# 모든 스펙 → web/public/help/<role>/<screen>.png (정식·커밋 대상)
node capture.mjs

# 역할만 / 화면 한 장만
node capture.mjs doctor
node capture.mjs doctor hub

# 스크래치 출력(커밋 이미지 미덮어씀 — 검증용). out/ 은 .gitignore.
node capture.mjs doctor --out=out/help

# 로컬 환경 캡처(기본은 클라우드)
PMS_BASE=http://localhost:3002/patient_management_system node capture.mjs doctor
```

환경변수: `PMS_BASE`(기본 `https://kuntae802.mooo.com/patient_management_system`), `PMS_VW`/`PMS_VH`(뷰포트, 기본 1440×900).

## 산출 위치 · 임베드

- 기본 출력 = `web/public/help/<role>/<screen>.png`. **이 PNG는 커밋한다**(정적 임베드 대상).
- `web/src/lib/help/help-content.ts`의 `HelpScreen.image`(앱-내 절대경로, 예 `/help/doctor/waiting.png`)가
  이 파일을 가리킨다. basePath 전파는 `helpImageSrc`가 처리(Story 9.1).
- `node_modules/`·`out/`·`package-lock.json`은 `.gitignore`로 제외. `web/public/help/**`만 커밋.

## 데모 계정 (전부 비번 `Staff1234`)

`admin@pms.local` · `doctor@pms.local` · `reception@pms.local` · `nurse@pms.local` · `radiologist@pms.local`
(환자 포털 계정은 미시드 — Story 9.8 범위).

## 새 화면 캡처 추가하기 (9.3~9.8)

1. `specs.mjs`에 엔트리 1개 추가: `role`·`account`·`screen`·`goto(page, BASE)`(자기완결 내비게이션)·`annotate(page)`(번호↔요소).
2. **번호 정합 필수:** `annotate`의 `n`(①②③…)은 그 화면의 `help-content.ts` `hotspots[].num`과 1:1로 일치해야 한다.
3. `node capture.mjs <role>` 실행 → `web/public/help/<role>/<screen>.png` 생성 → 커밋.

### 캡처 함정 (작성 시 주의)

- **viewport 좌표:** `annotate()`는 `boundingBox`(viewport 기준) + `position:fixed` 오버레이를 쓴다. 따라서
  **하이라이트 대상은 현재 뷰포트(기본 1440×900) 안에 있어야** 번호가 정확히 입혀진다. 폴드 아래 요소는
  스펙 `goto`에서 스크롤 후 좌표화하거나, in-viewport 핵심 요소만 번호 매긴다. `fullPage` 스크린샷은
  `fixed` 오버레이를 깨므로 쓰지 않는다(러너는 viewport 캡처).
- **요소 못 찾으면 그 번호만 누락:** locator 가 안 맞으면 `annotate`가 그 번호를 조용히 건너뛴다(러너 로그의
  `번호 [...]`로 확인). 누락되면 locator 를 실제 화면 기준으로 고친다.
- **데이터 의존 화면:** "진료 계속"(in_progress 내원) 같은 상호작용은 시드 데이터가 있어야 도달한다. 캡처 전 demo_seed 적용을 확인.
