---
baseline_commit: 70b84d7
---

# Story 8.4: 환자 앱 APK 패키징 · 배포

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 환자,
I want 환자 포털을 Android 앱(APK)으로 설치해 폰에서 바로 열기를,
so that 매번 브라우저 주소를 입력하지 않고 편하게 예약·내 기록·수납내역을 확인한다.

## Acceptance Criteria

**AC1 — 웹뷰 셸 APK 빌드**
**Given** 환자 포털 화면(예약·내 기록·마이)이 완성된 상태에서(8.1~8.3 done)
**When** Flutter 웹뷰 셸을 `flutter build apk --release`로 빌드하면
**Then** 설치 가능한 APK 산출물이 생성되고, 실행 시 공개 도메인 서브패스(`https://kuntae802.mooo.com/patient_management_system`)를 로드한다(NFR-011, UX-DR17).

**AC2 — 서브패스 전파·로그인·조회 정상**
**Given** 서브패스 전파(웹뷰 base URL·Supabase Auth redirect 허용목록·외부 내비)에 대해
**When** APK에서 로그인(`signInWithPassword`)·본인 데이터 조회·실시간을 검증하면
**Then** 로그인이 성공하고 세션이 앱 재실행 후에도 지속되며, 본인 내원·처방·검사·수납 조회가 정상 동작한다.

**AC3 — 앱처럼 동작하는 셸(견고화)** _(AC1·AC2를 "실제처럼" 충족시키기 위한 비기능 요건 — 사용자 목표 "최대한 실제처럼")_
**Given** 얇은 네이티브 셸에서
**When** 하드웨어 뒤로가기·페이지 로딩·네트워크 오류·외부 링크 상황이 발생하면
**Then** 뒤로가기는 웹뷰 히스토리를 따라가고(루트에서만 종료), 로딩 인디케이터·오류 재시도 화면이 표시되며, 포털 도메인 밖 이동은 정책으로 처리된다(빈 화면·죽은 앱 방지).

## Tasks / Subtasks

- [x] **Task 1 — 하드웨어 뒤로가기 처리** (AC: #3)
  - [x] `lib/webview_screen.dart`: `PopScope(canPop: false, onPopInvokedWithResult:)`로 감싸 `controller.canGoBack()`면 `controller.goBack()`, 아니면 `SystemNavigator.pop()`(루트에서만 종료). 토이 동작(즉시 종료) 교정 완료.
  - [x] `flutter analyze` 경고 0 유지.
- [x] **Task 2 — 로딩·오류 상태** (AC: #2, #3)
  - [x] `setNavigationDelegate`의 `onPageStarted`/`onPageFinished` → `_isLoading` 토글 → 중앙 `CircularProgressIndicator` 오버레이.
  - [x] `onWebResourceError`(메인 프레임 한정: `error.isForMainFrame != true` 가드) → `_ErrorView`(아이콘+한국어 안내+"다시 시도" `_reload()`). 빈 화면 방지.
- [x] **Task 3 — 내비게이션 정책** (AC: #2, #3)
  - [x] 순수 함수 `bool isInternalUrl(Uri)`를 `lib/url_policy.dart`로 추출(호스트=`AppConfig.baseUrl`에서 도출, 단일 출처). `onNavigationRequest`에서 내부는 `navigate`, 외부(`tel:`/`mailto:`/타 도메인/비-http)는 `prevent`.
  - [x] 로그인 `signInWithPassword`라 콜백 redirect 불필요 — `url_policy.dart`·`webview_screen.dart` 주석에 명시.
- [x] **Task 4 — 릴리스 빌드 설정** (AC: #1)
  - [x] `android/app/build.gradle.kts` 릴리스 서명 = **debug 키 유지** — 보일러플레이트 TODO 주석을 확정 결정 주석으로 정리. `versionName 1.0.0`/`versionCode 1`(pubspec `1.0.0+1`) 확인.
  - [x] `AndroidManifest.xml`: `INTERNET`·`label="환자 포털"` 유지 확인(변경 불요, HTTPS만 로드 → cleartext 불요). APK badging으로 재확인.
  - [x] (선택) 런처 아이콘 = 임상 틸 적응형 아이콘으로 교체(`mipmap-anydpi-v26/ic_launcher.xml` + `drawable/ic_launcher_foreground.xml`(흰 십자) + `values/colors.xml`(teal-600), 바이너리 무첨가). APK badging `icon='res/BW.xml'`로 적용 확인.
- [x] **Task 5 — Android SDK 셋업 + APK 빌드 (필수 — 과제 제출물)** (AC: #1)
  - [x] `cmdline-tools`(sdkmanager 12.0) 설치 → 라이선스 수락 → `platform-tools`·`platforms;android-35/36`·`build-tools;35.0.0/36.0.0` 설치(Flutter 3.44는 compileSdk 36 요구). NDK 28.2·CMake는 빌드가 자동 설치. `flutter config --android-sdk` 등록. **무-sudo Temurin JDK 17** 다운로드(시스템 java는 JRE라 javac 부재)→ `flutter config --jdk-dir`.
  - [x] `flutter build apk --release` → `build/app/outputs/flutter-apk/app-release.apk` **43.6MB** 생성. badging: `com.kuntae802.mobile` / `versionName 1.0.0` / `targetSdk 36`.
  - [x] 산출 APK를 제출용 안정 경로로 복사: **`~/patient-portal-app-release-v1.0.0.apk`**. `build/`는 gitignore → git 미추적 확인.
  - [x] SDK 설치 성공(중단점 미발동). Dart 코드는 SDK 전 `analyze`+`test`로 선검증.
- [x] **Task 6 — 서브패스 전파·세션·실시간 검증** (AC: #2)
  - [x] `lib/config.dart` `baseUrl = https://kuntae802.mooo.com/patient_management_system` 확인(무변경).
  - [x] 세션 지속: Android 시스템 WebView 기본 쿠키 지속(by-design) + README 명시. ⚠️ 실기기 로그인-재실행 라운드트립 관찰은 사용자 수용 단계(이 환경엔 Android 런타임 화면 없음).
  - [x] Supabase 로컬 `config.toml` `additional_redirect_urls`에 프로덕션 도메인 포함 확인(L164). 클라우드 대시보드 일치는 사용자 확인(이미 라이브 배포 중이라 정상 추정).
  - [x] 실시간 WS: `deploy/nginx_*.conf`의 `Upgrade`/`Connection "upgrade"` 헤더로 웹뷰 내 WS 경로 정적 확인.
  - [x] **알려진 한계 기록**: `window.print()`(receipt-detail.tsx:160) Android WebView 기본 미동작 → README "알려진 한계"에 명시.
- [x] **Task 7 — 배포·문서** (AC: #1)
  - [x] `mobile/README.md` 전면 교체: 목적·구조·사전요건·SDK 설치·빌드·버전·서명·사이드로드 배포·알려진 한계.
  - [x] APK 배포 = **(B) 파일 제출 + 문서** — 사이드로드 절차 README 기재. web/deploy/nginx 변경 0.
  - [x] glossary 신규 식별자 0(스키마/API 무변경) 확인.
- [x] **Task 8 — 테스트·정적분석** (AC: 전체)
  - [x] `flutter test`: config 스모크 + `isInternalUrl` 7케이스(내부 https/http·baseUrl 자신·외부 도메인·tel·mailto·about:blank) = **8/8 통과**.
  - [x] `flutter analyze` **경고 0**.

## Dev Notes

### ⚠️ 착수 전 필독 — 이 스토리는 Epic 8의 유일한 비-웹/비-DB 스토리다

8.1~8.3은 전부 FastAPI(`/me/*`)+Next 환자 포털 읽기였다. **8.4는 Flutter/Dart 셸 패키징** — 도메인·스키마·API를 전혀 건드리지 않는다. 이 점이 가장 큰 함정: "또 self-read 엔드포인트 만들기"가 아니다. **마이그레이션 0, API 0, web 변경은 선택적(배포 페이지 정도).** 작업 표면은 `mobile/`에 거의 갇혀 있다.

- 데이터/조회는 이미 8.1~8.3에서 완성됨(환자 포털이 기능적으로 완비). 8.4는 그 **완성된 반응형 웹을 네이티브 셸로 감싸 설치형 APK로 만드는 것**.
- `project-context.md`: "Dart(셸): 표면적 최소" — 셸에 비즈니스 로직·도메인 모델을 넣지 말 것. 모든 화면·상태·검증은 웹(Next)이 소유. 셸은 (1) 웹뷰 로드 (2) 뒤로가기 (3) 로딩/오류 (4) 내비 정책 — 딱 이 4가지만.

### 이 스토리의 본질 — "토이 웹뷰 → 실제 앱"

현 `mobile/` 셸은 1.1 스캐폴드 그대로다(이후 미수정, 마지막 커밋 `4c1dee8`). 동작은 하지만 **토이 수준**:
- `webview_screen.dart`: URL 로드만 한다. 뒤로가기 핸들링·로딩 표시·오류 처리·내비 정책이 전부 없음.
- 하드웨어 뒤로가기를 누르면 웹 히스토리를 무시하고 **앱이 즉시 종료**됨 → 실사용 불가 수준.
- 네트워크가 끊기거나 도메인이 다운되면 **흰 화면**만 보임(죽은 앱처럼 보임).

사용자 목표가 "최대한 실제처럼"이므로, AC1(빌드)·AC2(로그인/조회)만 형식 충족하는 게 아니라 **AC3(견고화)으로 진짜 앱처럼** 만든다. 이 4가지(뒤로가기·로딩·오류·내비)가 webview 셸을 토이에서 제품으로 끌어올리는 표준 최소 세트다.

### 기존 자산 — 무엇이 이미 있고 무엇을 고치나 (재발명 금지)

| 파일 | 현 상태 | 8.4에서 |
|---|---|---|
| `mobile/lib/config.dart` | `baseUrl = https://kuntae802.mooo.com/patient_management_system` ✅ | **무변경**(이미 정답). 서브패스 전파 검증만. |
| `mobile/lib/main.dart` | `MaterialApp(title:'환자 포털', home: WebViewScreen())` | 거의 무변경(테마/로케일 미세 보정 가능). |
| `mobile/lib/webview_screen.dart` | `WebViewController..setJavaScriptMode(unrestricted)..loadRequest(baseUrl)` + `SafeArea(WebViewWidget)` | **핵심 수정 대상** — PopScope·NavigationDelegate(progress/error/navRequest)·로딩/오류 위젯 추가. |
| `mobile/android/app/build.gradle.kts` | `applicationId com.kuntae802.mobile`, `minSdk 24`, 릴리스=**debug 키 서명(TODO)** | 서명 결정 반영, 버전 확인. |
| `mobile/android/app/src/main/AndroidManifest.xml` | `INTERNET` ✅, `label "환자 포털"` ✅, icon=기본 ic_launcher | 확인(거의 무변경). 아이콘은 선택. |
| `mobile/test/widget_test.dart` | config baseUrl 스모크 1건 | `isInternalUrl` 단위 테스트 추가. |
| `mobile/README.md` | Flutter 기본 보일러플레이트 | 실제 빌드/배포 문서로 교체. |
| `mobile/pubspec.yaml` | `webview_flutter ^4.14.0`, sdk ^3.12.2 ✅ | **무변경**(새 의존성 추가 금지 — 셸 표면 최소). |

### 🔑 로그인 메커니즘 — redirect 콜백이 없다 (오해 주의)

환자 로그인은 `web/src/app/(auth)/login/login-form.tsx`의 **`supabase.auth.signInWithPassword({email, password})`** 다. 즉:
- **OAuth/매직링크/이메일 콜백 리디렉션이 없다.** AC2의 "Supabase Auth redirect 검증"은 콜백 처리 배선이 아니라 **`additional_redirect_urls` 허용목록에 프로덕션 도메인이 있는지** 확인하는 의미(이미 `config.toml`에 등록, 클라우드 대시보드 일치만 확인).
- 따라서 웹뷰에서 신경 쓸 것은 **세션 지속**(쿠키/localStorage가 앱 재실행 후 유지)뿐. Android 시스템 WebView는 쿠키를 기본 지속하므로 대개 OK. 끊기면 원인을 기록.
- 셸에 redirect intercept·딥링크 스킴 핸들러를 만들지 말 것(불필요·표면 증가).

### ⚠️ 환경 제약 — Android SDK 미설치 (스토리 핵심 리스크)

이 환경에는 **Flutter 3.44.2(/snap/bin/flutter)는 있으나 Android SDK가 없다**(`flutter doctor`: "Unable to locate Android SDK"). `local.properties`엔 `flutter.sdk`만, `sdk.dir`(Android SDK) 없음. 즉 **`flutter build apk`가 즉시 실행되지 않는다.** 기존 APK 산출물도 없음.

- **빌드는 필수다(✅ 확정):** 과제로 apk 파일을 제출해야 하므로 Task 5에서 `cmdline-tools`를 설치(sdkmanager로 platform/build-tools 받고 라이선스 `yes` 수락)한 뒤 `flutter build apk --release`로 실 산출물을 만든다.
- **용량 오해 주의(사용자 확인 포인트):** "수 GB"는 **앱이 아니라 빌드 도구(Android SDK) 일회성 다운로드** 용량(~1–3GB)이다. 산출 **APK 자체는 웹뷰 셸이라 작다(예상 15–50MB)**. 제출물 = 이 작은 apk 하나.
- **SDK 설치가 끝내 막히면 즉시 보고(중단점)** — 빌드 산출물이 제출 핵심이라 무음 스킵 금지. 단 Dart 셸·gradle은 SDK 없이 `flutter analyze`+`flutter test`로 먼저 완비·검증 가능하니 코드부터 끝내고 빌드를 시도.
- 빌드 산출물(`build/`)은 `.gitignore` 대상 → 커밋되지 않음. 커밋되는 건 셸 소스·gradle·README뿐(apk는 제출용 별도 보존).

### 서명 결정 (✅ 사용자 확정 2026-06-26 — debug 키 유지)

`build.gradle.kts` 릴리스 블록의 `signingConfig = signingConfigs.getByName("debug")`를 **그대로 유지**한다. 사이드로드 제출용(Play Store 미게시)이라 debug 서명으로 충분. 코드 변경은 TODO 주석 정리 수준. README에 "프로덕션 배포 시 `keytool` 릴리스 keystore + `key.properties` 필요"만 한 줄 명시. 릴리스 keystore 생성은 범위 밖(데모엔 과함).

### 배포 방법 (✅ 사용자 확정 2026-06-26 — (B) 파일 제출 + 문서)

APK는 Play Store가 아닌 **사이드로드**로 배포한다(스토어 외 경로로 apk 받아 '알 수 없는 출처 허용' 후 설치). 확정 방식:
- **apk 파일 자체를 과제 산출물로 제출** + 사이드로드 설치 절차를 `mobile/README.md`에 설명.
- **web/deploy/nginx 변경 0** — 다운로드 페이지·정적 서빙(웹 다운로드 링크 안)은 채택 안 함. 작업 표면이 `mobile/`에 갇힘.
- 빌드 후 산출 apk를 안정 경로로 복사해 사용자에게 제출 경로를 안내(`build/`는 gitignore).

### webview_flutter 4.x API 메모 (LLM 흔한 실수 방지)

- 뒤로가기: Flutter 3.16+ **`PopScope(canPop:false, onPopInvokedWithResult: (didPop, result) async { if (didPop) return; if (await controller.canGoBack()) controller.goBack(); else SystemNavigator.pop(); })`**. (구식 `WillPopScope` 쓰지 말 것 — deprecated.)
- 내비/로딩: `controller.setNavigationDelegate(NavigationDelegate(onProgress:, onPageStarted:, onPageFinished:, onWebResourceError:, onNavigationRequest:))`. 4.x는 setter 메서드 체인(생성자 인자 아님).
- 오류 필터: `onWebResourceError`는 서브리소스 오류도 부른다 → `error.isForMainFrame == true`일 때만 오류 화면 표시(아이콘·광고 로드 실패로 전체 오류화면 뜨는 것 방지).
- `setJavaScriptMode(JavaScriptMode.unrestricted)`는 유지(포털이 JS 앱).

### UX 명세 (UX-DR17 / DESIGN patient-app)

- 셸은 **크롬리스**(앱바 없이 `SafeArea`만) — 포털 자체가 하단 3탭(`예약/내 기록/마이`, `patient-tab-bar.tsx`)을 그린다. 셸이 또 다른 앱바·탭을 넣지 말 것(중복 내비 금지).
- 로딩/오류 화면은 임상 톤(중립·차분)으로 — 포털 디자인 언어와 충돌하지 않게 최소 텍스트.

### 범위 경계 (넘지 말 것)

- ⛔ iOS 빌드·푸시 알림·생체 인증·딥링크 스킴·오프라인 캐시 = 범위 밖(architecture에 "추후 확장 여지"로만). NFR-011은 **Android APK**만.
- ⛔ window.print() 위임 배선·네이티브 인쇄 = 범위 밖(한계로 문서화만).
- ⛔ 환자 포털 화면 신규/수정 = 범위 밖(8.1~8.3 done). 8.5=운영 대시보드(다음·별개).
- ⛔ 새 Dart 의존성 추가 = 금지(셸 표면 최소; webview_flutter로 충분).

### Project Structure Notes

- 작업 표면: `mobile/lib/*`, `mobile/android/app/*`, `mobile/test/*`, `mobile/README.md`. (배포 1안 선택 시에만 `web/` 또는 `deploy/nginx_*.conf` 소폭 변경.)
- `project-context.md` 구조 규칙 부합: `mobile/ = Flutter 웹뷰 셸(환자 APK)`. Dart 파일 `snake_case`, 클래스 `PascalCase`, 변수 `lowerCamelCase` 준수.
- 스키마/타입 생성물(`database.types.ts`) 무관(DB 무변경).

### 이전 스토리(8.1·8.2·8.3) 인텔리전스 — 반복 회피

- 8.1~8.3은 `_assemble_*` 추출·self-scope·`get_current_patient` 패턴이었다. **8.4엔 해당 없음**(API 무변경). 그 머슬 메모리로 엔드포인트를 또 만들지 말 것.
- 공통 교훈은 유지: 마이그레이션 번호 정합(이번엔 마이그 0)·범위 경계 엄수·커밋은 의미 단위(셸 소스 / README / (선택)배포)로 분리·승인 시에만 커밋.
- 코드리뷰 관행: done 시 자동 커밋(코드/산출물 분리). 8.4도 동일.

### Git 인텔리전스 (최근 작업 패턴)

- `mobile/`는 `4c1dee8 feat(mobile): Flutter 웹뷰 셸 — webview_flutter·minSdk 24` 한 번만 손댐. 8.4가 두 번째 손길.
- 최근 8.x 커밋 형식: `feat(web)/feat(api)/test(...)/chore(bmad)`. 8.4는 `feat(mobile)` + `test(mobile)` + `docs`(README) + `chore(bmad)` 조합 예상.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-8.4 (L1403–1417)] — AC 원문(APK 빌드·서브패스·로그인/실시간/조회).
- [Source: _bmad-output/planning-artifacts/architecture.md#L104] — Flutter 3.44 + webview_flutter 4.x, 얇은 셸, Dart 표면 최소.
- [Source: _bmad-output/planning-artifacts/architecture.md#L150-159] — 셸 스캐폴드 절차·`webview_flutter`·Android API 24+ 타깃.
- [Source: _bmad-output/planning-artifacts/architecture.md#L210-212, L234] — 배포(`flutter build apk`)·서브패스 전파(basePath/root_path/Auth redirect/CORS/**웹뷰 base URL/APK base URL**).
- [Source: _bmad-output/planning-artifacts/architecture.md#L370-372, L399, L413] — `mobile/` 구조, Flutter→웹 https 웹뷰, 빌드=`flutter build apk`.
- [Source: docs/project-context.md] — Dart 규칙(셸 표면 최소), 서브패스 전 서피스 전파, 새 라이브러리 임의 추가 금지.
- [Source: mobile/lib/config.dart, webview_screen.dart, main.dart] — 현 셸 상태(baseUrl 정답·핸들링 부재).
- [Source: mobile/android/app/build.gradle.kts, src/main/AndroidManifest.xml] — applicationId·minSdk 24·debug 서명 TODO·INTERNET·label.
- [Source: deploy/nginx_patient_management_system.conf] — 실시간 WS `Upgrade` 헤더(웹뷰 내 실시간 경로).
- [Source: web/src/app/(auth)/login/login-form.tsx] — 로그인=`signInWithPassword`(OAuth/콜백 redirect 없음).
- [Source: web/src/components/portal/receipt-detail.tsx:160] — `window.print()` 영수증 인쇄(WebView 기본 미동작 한계).
- [Source: PRD prd.md#NFR-011] — 환자 클라이언트 = Android APK 배포.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — claude-opus-4-8[1m]

### Debug Log References

- `flutter analyze` → No issues found (0 경고).
- `flutter test` → 8/8 통과 (config 스모크 + isInternalUrl 7케이스).
- `flutter build apk --release` → `build/app/outputs/flutter-apk/app-release.apk` 43.6MB.
- APK badging: `package: com.kuntae802.mobile`, `versionName 1.0.0`, `versionCode 1`, `targetSdk 36`, `INTERNET`, `application-label:'환자 포털'`, `icon='res/BW.xml'`(적응형 아이콘 적용).

### Completion Notes List

- **본질 = 패키징(비-DB/비-API/비-web).** 마이그 0·API 0·web 0. 작업 표면 전부 `mobile/`. 8.1~8.3 self-read 패턴 미적용(엔드포인트 신규 0).
- **셸 견고화(토이→앱):** 뒤로가기(PopScope→웹 히스토리/루트만 종료)·로딩 스피너·네트워크 오류 재시도 화면·도메인 내부 한정 내비 정책 추가. 셸 표면 최소 유지(새 Dart 의존성 0 — webview_flutter만).
- **내비 정책은 순수 함수(`isInternalUrl`)로 추출** → 위젯 펌프 불가한 웹뷰 대신 단위 테스트로 커버. 호스트는 `AppConfig.baseUrl`에서 도출(서브패스 단일 출처).
- **로그인 redirect 오해 차단:** `signInWithPassword`(이메일/비번)라 OAuth/매직링크 콜백 없음 → 셸에 redirect/딥링크 핸들러 미추가(불필요). 세션=WebView 쿠키 지속.
- **Task 5 환경 셋업(스토리 핵심 리스크 해소):** 이 머신에 Android SDK·전체 JDK 모두 부재였음. (1) Android cmdline-tools→platform/build-tools 35·36 설치(Flutter 3.44=compileSdk 36), (2) 시스템 java가 JRE(javac 부재)라 빌드 실패 → **무-sudo Temurin JDK 17** 받아 `flutter config --jdk-dir`로 해결. 최종 빌드 성공.
- **제출물:** `~/patient-portal-app-release-v1.0.0.apk`(43.6MB, debug 서명, 사이드로드). `build/`는 gitignore라 미커밋.
- **적응형 아이콘:** 바이너리 없이 XML(틸 배경 + 흰 십자)로 추가, <26은 기존 PNG 폴백. APK badging으로 적용 확인.
- **기기 수용 테스트(사용자 단계):** 이 환경엔 Android 런타임 화면이 없어 실기기/에뮬레이터에서의 로그인 round-trip·세션 재실행 지속·실시간 푸시 관찰은 사용자 수용 단계로 남김. config 정합(baseUrl·redirect allowlist·nginx WS)은 정적 검증 완료.
- **알려진 한계:** 환자 영수증 `window.print()`는 Android WebView 기본 미동작(README 명시, 인쇄 위임 배선=범위 밖).

### File List

**신규 (mobile/):**
- `mobile/lib/url_policy.dart` — `isInternalUrl(Uri)` 내비 정책 순수 함수
- `mobile/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` — 적응형 아이콘
- `mobile/android/app/src/main/res/drawable/ic_launcher_foreground.xml` — 전경 벡터(흰 십자)
- `mobile/android/app/src/main/res/values/colors.xml` — 아이콘 배경색(teal-600)

**수정 (mobile/):**
- `mobile/lib/webview_screen.dart` — PopScope 뒤로가기 + NavigationDelegate(로딩/오류/내비) + 상태 오버레이
- `mobile/lib/main.dart` — 라이트·임상 틸 테마, debug 배너 off
- `mobile/test/widget_test.dart` — `isInternalUrl` 7케이스 추가
- `mobile/android/app/build.gradle.kts` — 릴리스 서명 결정 주석 정리(debug 유지), 버전 주석
- `mobile/README.md` — 실제 빌드/배포 문서로 전면 교체

**제출 산출물(비-git):** `~/patient-portal-app-release-v1.0.0.apk` (43.6MB)

### Change Log

- 2026-06-26: Story 8.4 구현 — Flutter 웹뷰 셸 견고화(뒤로가기·로딩·오류·내비 정책) + 적응형 아이콘 + 릴리스 빌드 설정 + Android SDK/JDK17 셋업 + `flutter build apk --release`(app-release.apk 43.6MB) + README/테스트. analyze 0 / test 8 통과. 마이그·API·web 변경 0.
- 2026-06-26: 코드리뷰 patch 2건 적용 — (1) 콜드스타트 오프라인 재시도 `loadRequest(baseUrl)` 복구, (2) `isInternalUrl` scheme+host+경로프리픽스 강화(공유 호스트 경계 축소·http 다운그레이드 차단). test 8→11, analyze 0. APK 재빌드·제출본 갱신(sha256 1139d7f4…). Status → done.

### Review Findings

코드리뷰(2026-06-26, Blind Hunter·Edge Case Hunter·Acceptance Auditor 3레이어). Acceptance Auditor: AC1·AC2·AC3 전부 SATISFIED, 제약 위반 0(마이그/API/web 0·새 의존성 0·셸 표면 최소·네이밍 준수). patch 2 / decision-needed 0 / defer 0 / dismiss 11.

**Patch (적용 대상):**

- [x] [Review][Patch] 콜드스타트 오프라인 시 "다시 시도"가 복구 불가 — 첫 `loadRequest` 실패(미커밋 페이지) 후 `_controller.reload()`는 무동작 → 사용자가 오류화면에 갇힘. 재시도는 `loadRequest(AppConfig.baseUrl)`로 항상 base 재시도 [mobile/lib/webview_screen.dart:_reload] **✅ 적용**
- [x] [Review][Patch] 내비 정책이 host만 비교(경로 프리픽스 무시) + http 다운그레이드 허용 → 공유 호스트(`kuntae802.mooo.com`은 타 프로젝트도 서빙) 경계 과대. baseUrl의 `scheme+host+경로프리픽스(/patient_management_system)`로 강화 — project-context "모호하면 더 제한적 옵션(보안·PII)" 규칙 적용. 경계 false-positive(`/patient_management_system_x`)·userinfo 컨퓨저블 테스트 추가 [mobile/lib/url_policy.dart:isInternalUrl] **✅ 적용 (test 8→11)**

**Dismiss (근거):**

- window.print() 영수증 인쇄 미동작(Edge=High) — 스토리 범위 명시 제외 + README "알려진 한계" 문서화 완료(이 변경이 만든 결함 아님).
- 외부 링크 차단 시 피드백 없음(dead tap) — 정상 플로우에 외부 링크 없음 + 외부 위임=url_launcher 신규 의존성(범위 금지). by-design.
- 뒤로가기 루트에서 무확인 종료 — AC3 "루트에서만 종료" 명시 충족(by-design). 재진입 더블탭=이론적 저위험.
- 콜백 순서 desync(error after finished / prevented top-level nav stale) — 표준 webview 패턴, SPA 정상 플로우에 top-level off-host nav 미발생.
- controller dispose 없음 — webview_flutter 4.x `WebViewController`는 dispose() 미노출(누수 아님). 프로세스 사망 시 base 재로드=세션 쿠키 유지(위치만 손실, 허용).
- 적응형 아이콘 API 24-25 폴백=기본 Flutter 아이콘 — 아이콘은 "(선택)" 폴리시 + 2026 기준 API 24-25 점유 무시 가능 + 26+는 정상. PNG 재생성(바이너리)은 과대.
- _reload setState mounted 미가드 — 동기 버튼 호출이라 mounted 보장(결함 아님).
- 릴리스 debug 서명 — 사용자 확정 결정(사이드로드·Play 미게시), README/gradle 문서화.
- 첫 loadRequest가 onNavigationRequest 미경유 — 정보성(예상 동작).
- PopScope 라우트 pop 가능시도 종료 — 단일 home 셸이라 무관(by-design).
- isInternalUrl 서브도메인 strict equality — 단일 호스트 포털, 미발생(강화 패치가 prefix로 더 명확화).
