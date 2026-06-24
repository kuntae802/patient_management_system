plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.kuntae802.mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.kuntae802.mobile"
        // webview_flutter 최신은 minSdk 21 요구 → 24로 명시(아키텍처 타깃 API 24+)
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        // versionCode/Name = pubspec.yaml의 version(1.0.0+1) → versionName 1.0.0 / versionCode 1
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // 사이드로드 제출용 — debug 키로 서명(Play Store 미게시).
            // 프로덕션 배포 시에는 keytool 릴리스 keystore + key.properties 주입이 필요하다.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
