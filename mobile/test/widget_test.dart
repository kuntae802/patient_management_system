// 웹뷰 셸 스모크 테스트.
// WebView 위젯은 플랫폼 채널이 필요해 펌프 대신 설정값·내비 정책(순수 함수)을 검증한다.

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/config.dart';
import 'package:mobile/url_policy.dart';

void main() {
  group('AppConfig', () {
    test('baseUrl은 공개 도메인 서브패스를 가리킨다', () {
      expect(AppConfig.baseUrl, startsWith('https://'));
      expect(AppConfig.baseUrl, contains('/patient_management_system'));
    });
  });

  group('isInternalUrl — 내비게이션 정책', () {
    test('포털 baseUrl 자신은 내부다', () {
      expect(isInternalUrl(Uri.parse(AppConfig.baseUrl)), isTrue);
    });

    test('포털 프리픽스 하위 경로(https)는 내부다', () {
      expect(
        isInternalUrl(
          Uri.parse('https://$portalHost/patient_management_system/records'),
        ),
        isTrue,
      );
    });

    test('http 다운그레이드(같은 호스트·경로)는 외부다 → 차단', () {
      expect(
        isInternalUrl(
          Uri.parse('http://$portalHost/patient_management_system/records'),
        ),
        isFalse,
      );
    });

    test('같은 호스트의 다른 프로젝트 경로는 외부다 → 차단', () {
      expect(
        isInternalUrl(Uri.parse('https://$portalHost/other_project/admin')),
        isFalse,
      );
    });

    test('프리픽스 경계 위장(…_x)은 외부다 → 차단', () {
      expect(
        isInternalUrl(
          Uri.parse('https://$portalHost/patient_management_system_x'),
        ),
        isFalse,
      );
    });

    test('userinfo 컨퓨저블(@evil.com)은 외부다 → 차단', () {
      expect(
        isInternalUrl(
          Uri.parse('https://$portalHost@evil.com/patient_management_system'),
        ),
        isFalse,
      );
    });

    test('다른 도메인(https)은 외부다 → 차단', () {
      expect(isInternalUrl(Uri.parse('https://evil.example.com/login')), isFalse);
    });

    test('tel: 스킴은 외부다 → 차단', () {
      expect(isInternalUrl(Uri.parse('tel:01012345678')), isFalse);
    });

    test('mailto: 스킴은 외부다 → 차단', () {
      expect(isInternalUrl(Uri.parse('mailto:clinic@example.com')), isFalse);
    });

    test('about:blank 등 비-http 스킴은 외부다 → 차단', () {
      expect(isInternalUrl(Uri.parse('about:blank')), isFalse);
    });
  });
}
