# mobile — 환자 포털 Android 셸 (Flutter WebView)

환자 포털(반응형 웹, Next.js `(patient)` 라우트 그룹)을 띄우는 **얇은 네이티브 셸**이다.
설치형 Android 앱(APK)으로 패키징되어, 환자가 폰에서 브라우저 주소 입력 없이 바로
예약·내 기록·수납내역을 확인한다. (NFR-011, Story 8.4)

비즈니스 로직·화면·검증은 **전부 웹이 소유**한다. 셸의 책임은 네 가지뿐이다:

1. 포털 URL 로드 (`lib/config.dart`의 `baseUrl`)
2. 하드웨어 뒤로가기 = 웹 히스토리 추적 (루트에서만 앱 종료)
3. 로딩 인디케이터 · 네트워크 오류 재시도 화면
4. 포털 경로(scheme+host+프리픽스) 내부만 허용하는 내비게이션 정책 (`lib/url_policy.dart`)

## 구조

```
lib/
  main.dart           # 앱 진입 + 라이트·임상 틸 테마
  config.dart         # baseUrl(공개 도메인 서브패스) — 단일 출처
  url_policy.dart     # isInternalUrl(Uri) — 내비 정책 순수 함수(테스트 대상)
  webview_screen.dart # 웹뷰 + 뒤로가기/로딩/오류/내비 정책
test/
  widget_test.dart    # config·isInternalUrl 단위 테스트
android/app/...       # applicationId com.kuntae802.mobile, minSdk 24, 적응형 아이콘
```

로드 대상: `https://kuntae802.mooo.com/patient_management_system`
(108 nginx → 110 web 컨테이너, Next `basePath` 보존)

## 사전 요건

- **Flutter 3.44.x** (Dart 3.12.x). `flutter --version`으로 확인.
- **Android SDK** (cmdline-tools + platform-tools + platform + build-tools). APK 빌드에 필수.
  - 이 저장소 클론 직후엔 Android SDK가 없을 수 있다(`flutter doctor`가 "Unable to locate
    Android SDK" 경고). 아래 "Android SDK 설치"를 1회 수행한다.
- **JDK 17+** (Gradle/AGP 실행용).

### Android SDK 설치 (1회)

```bash
# 예시 — cmdline-tools를 ~/android-sdk 에 설치
export ANDROID_SDK_ROOT="$HOME/android-sdk"
mkdir -p "$ANDROID_SDK_ROOT/cmdline-tools"
# 1) https://developer.android.com/studio#command-line-tools 에서 Linux용 zip 다운로드
#    → $ANDROID_SDK_ROOT/cmdline-tools/latest 로 풀기
yes | "$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/sdkmanager" --licenses
"$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/sdkmanager" \
  "platform-tools" "platforms;android-36" "build-tools;36.0.0"
flutter config --android-sdk "$ANDROID_SDK_ROOT"
```

> 다운로드 용량은 **빌드 도구(Android SDK) 기준 ~1–3GB(일회성)**다.
> 산출되는 **APK 자체는 웹뷰 셸이라 작다(약 15–50MB)**.

## 빌드

```bash
flutter pub get
flutter analyze              # 정적 분석 — 경고 0
flutter test                 # config·내비 정책 단위 테스트
flutter build apk --release  # → build/app/outputs/flutter-apk/app-release.apk
```

`build/`는 `.gitignore` 대상이라 APK 바이너리는 커밋되지 않는다. 제출 시 산출 APK를
별도 경로로 복사해 제출한다.

### 버전

`pubspec.yaml`의 `version: 1.0.0+1` → Android `versionName 1.0.0` / `versionCode 1`.
배포마다 `+build` 번호를 올린다(예: `1.0.1+2`).

### 서명

릴리스 APK는 **debug 키로 서명**한다(`android/app/build.gradle.kts`). 본 앱은 Play Store에
게시하지 않고 **사이드로드(파일 직접 설치)**로 배포하므로 debug 서명으로 충분하다.
프로덕션 배포가 필요하면 `keytool`로 릴리스 keystore를 만들고 `key.properties`(gitignore)로
주입한다.

## 배포 (사이드로드)

스토어가 아닌 경로로 APK를 받아 직접 설치한다:

1. `app-release.apk`를 환자 기기로 전달(과제 제출물 = 이 파일).
2. 기기에서 APK 실행 → "알 수 없는 출처(이 출처의 앱 설치 허용)"를 한 번 허용 → 설치.
3. 앱 실행 시 공개 도메인 포털이 로드된다.

## 알려진 한계

- **영수증 인쇄(`window.print()`)**: 환자 포털의 영수증 인쇄 버튼은 데스크톱 브라우저에선
  동작하지만, **Android 시스템 WebView에서는 기본적으로 동작하지 않는다**(인쇄 다이얼로그
  미노출). 네이티브 인쇄 위임 배선은 MVP 범위 밖이다. 영수증은 화면에서 확인 가능하다.
- **로그인 redirect**: 로그인은 `signInWithPassword`(이메일/비밀번호)라 OAuth/매직링크
  콜백 리디렉션이 없다. 세션은 WebView 쿠키로 지속된다(앱 재실행 후 유지).
- iOS·푸시 알림·생체 인증·딥링크·오프라인 캐시는 범위 밖(추후 확장 여지).
