// 웹뷰 셸 스모크 테스트.
// WebView는 플랫폼 채널이 필요해 위젯 펌프 대신 설정값을 검증한다.

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/config.dart';

void main() {
  test('baseUrl은 공개 도메인 서브패스를 가리킨다', () {
    expect(AppConfig.baseUrl, startsWith('https://'));
    expect(AppConfig.baseUrl, contains('/patient_management_system'));
  });
}
