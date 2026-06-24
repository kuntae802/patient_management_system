import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'config.dart';
import 'url_policy.dart';

/// 환자 포털(반응형 웹)을 띄우는 얇은 네이티브 셸 화면.
///
/// 셸의 책임은 딱 네 가지다(비즈니스 로직·도메인은 모두 웹이 소유):
///  1) 포털 URL 로드, 2) 하드웨어 뒤로가기 = 웹 히스토리 추적,
///  3) 로딩/오류 상태 표시, 4) 도메인 내부만 허용하는 내비게이션 정책.
class WebViewScreen extends StatefulWidget {
  const WebViewScreen({super.key});

  @override
  State<WebViewScreen> createState() => _WebViewScreenState();
}

class _WebViewScreenState extends State<WebViewScreen> {
  late final WebViewController _controller;

  /// 메인 프레임 로딩 진행 중 여부(스피너 표시).
  bool _isLoading = true;

  /// 메인 프레임 로드 실패 여부(오류·재시도 화면 표시).
  bool _hasError = false;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted) // 포털은 JS 앱(Next.js)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (_) {
            if (!mounted) return;
            setState(() {
              _isLoading = true;
              _hasError = false;
            });
          },
          onPageFinished: (_) {
            if (!mounted) return;
            setState(() => _isLoading = false);
          },
          onWebResourceError: (WebResourceError error) {
            // 서브리소스(아이콘·폰트·광고 등) 실패로 전체 오류화면이 뜨지 않게
            // 메인 프레임 오류만 처리한다.
            if (error.isForMainFrame != true) return;
            if (!mounted) return;
            setState(() {
              _isLoading = false;
              _hasError = true;
            });
          },
          onNavigationRequest: (NavigationRequest request) {
            final uri = Uri.tryParse(request.url);
            // 포털 경로(scheme+host+프리픽스) 내부만 웹뷰에서 연다.
            // 외부(tel:/mailto:/타 도메인·타 프로젝트·http 다운그레이드)는 차단.
            if (uri != null && isInternalUrl(uri)) {
              return NavigationDecision.navigate;
            }
            return NavigationDecision.prevent;
          },
        ),
      )
      ..loadRequest(Uri.parse(AppConfig.baseUrl));
  }

  void _reload() {
    setState(() {
      _hasError = false;
      _isLoading = true;
    });
    // reload()는 첫 로드 실패(커밋된 페이지 없음) 시 무동작이라 콜드스타트 오프라인에서
    // 복구가 안 된다. 항상 base를 재요청해 어떤 실패 상태에서도 다시 시도되게 한다.
    _controller.loadRequest(Uri.parse(AppConfig.baseUrl));
  }

  @override
  Widget build(BuildContext context) {
    // 하드웨어 뒤로가기: 웹 히스토리가 있으면 뒤로, 루트면 앱 종료.
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        if (await _controller.canGoBack()) {
          await _controller.goBack();
        } else {
          await SystemNavigator.pop();
        }
      },
      child: Scaffold(
        body: SafeArea(
          child: Stack(
            children: [
              // 웹뷰는 항상 트리에 유지(플랫폼 뷰 재생성 방지). 위에 상태 오버레이.
              WebViewWidget(controller: _controller),
              if (_isLoading && !_hasError) const _LoadingView(),
              if (_hasError) _ErrorView(onRetry: _reload),
            ],
          ),
        ),
      ),
    );
  }
}

/// 로딩 인디케이터 — 중립·차분한 임상 톤(최소 텍스트).
class _LoadingView extends StatelessWidget {
  const _LoadingView();

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: const Center(child: CircularProgressIndicator()),
    );
  }
}

/// 네트워크 오류 화면 — 도메인 다운·오프라인 시 빈 화면 대신 재시도 어포던스.
class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.wifi_off_rounded,
                size: 48,
                color: Theme.of(context).colorScheme.outline,
              ),
              const SizedBox(height: 16),
              const Text(
                '연결할 수 없어요',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 8),
              Text(
                '네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 14,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 20),
              FilledButton(onPressed: onRetry, child: const Text('다시 시도')),
            ],
          ),
        ),
      ),
    );
  }
}
