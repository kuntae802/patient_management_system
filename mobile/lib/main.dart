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
    return const MaterialApp(
      title: '환자 포털',
      home: WebViewScreen(),
    );
  }
}
