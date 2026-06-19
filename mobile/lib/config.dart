/// 앱 설정 — 웹뷰가 로드할 공개 도메인 서브패스.
///
/// 직원 웹과 동일한 Next.js 앱의 (patient) 포털을 띄운다(basePath 반영).
/// 얇은 네이티브 셸이므로 Dart 표면적은 최소.
class AppConfig {
  const AppConfig._();

  /// 환자 포털 URL — 108 nginx → 110 web 컨테이너(basePath=/patient_management_system).
  static const String baseUrl =
      'https://kuntae802.mooo.com/patient_management_system';
}
