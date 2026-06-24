import 'config.dart';

/// 환자 포털의 기준 URL(설정의 [AppConfig.baseUrl]) — 내비 정책의 단일 출처.
/// scheme·host·경로 프리픽스를 한 곳에서 도출해, baseUrl만 바꾸면 정책이 함께 따라간다.
final Uri _portalBase = Uri.parse(AppConfig.baseUrl);

/// 포털 호스트(테스트·표시용).
final String portalHost = _portalBase.host;

/// 주어진 URL이 환자 포털 내부인지 판정한다.
///
/// 내부 = 기준 URL과 **scheme·host가 같고 경로가 포털 프리픽스 아래**일 때만이다.
/// host만 비교하면 같은 호스트의 다른 프로젝트(공유 도메인)나 http 다운그레이드까지
/// 통과하므로, PII 포털 경계를 좁게 잡는다(project-context: 모호하면 더 제한적 옵션).
///
/// 로그인은 `signInWithPassword`(OAuth/매직링크 아님)라 외부 콜백 리디렉션이 없어,
/// 정상 플로우에서 포털 밖으로 나갈 일이 없다 → 도메인 밖 내비는 안전하게 차단한다.
bool isInternalUrl(Uri uri) {
  if (uri.scheme != _portalBase.scheme) return false;
  if (uri.host != _portalBase.host) return false;
  final prefix = _portalBase.path; // 예: /patient_management_system
  // 프리픽스 자신 또는 그 하위 경로만 내부(`_x` 같은 경계 위장은 제외).
  return uri.path == prefix || uri.path.startsWith('$prefix/');
}
