import 'package:flutter/material.dart';

import 'webview_screen.dart';

void main() {
  runApp(const PmsApp());
}

/// 환자 모바일 셸 — Flutter 웹뷰가 환자 포털을 로드하는 얇은 네이티브 컨테이너.
class PmsApp extends StatelessWidget {
  const PmsApp({super.key});

  @override
  Widget build(BuildContext context) {
    // 라이트·임상 틸 시드 — 셸의 로딩/오류 화면이 포털 디자인 언어와 어울리게.
    // (실제 화면은 모두 웹이 그리므로 셸 테마는 상태 오버레이에만 적용된다.)
    return MaterialApp(
      title: '환자 포털',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF0D9488), // teal-600 (임상 틸)
        scaffoldBackgroundColor: Colors.white,
      ),
      home: const WebViewScreen(),
    );
  }
}
