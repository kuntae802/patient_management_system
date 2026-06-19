# Deferred Work

작업 중·리뷰 중 식별됐으나 현재 스토리 범위 밖으로 미룬 항목. 해당 스토리 착수 시 참조.

## Deferred from: code review of 1-1-...-init (2026-06-19)

- **`SUPABASE_*` env fail-fast 없음** [docker-compose.yml] — `SUPABASE_DB_URL`/`JWKS_URL`/`SECRET_KEY`가 미설정이면 `os.getenv → None`으로 조용히 부팅 후, JWKS 검증 시점에 불투명 실패. → **Story 1.5**(config를 pydantic-settings로 승격하며 필수값 검증 추가).
- **config.toml auth 약한 기본값** [supabase/config.toml] — `minimum_password_length=6`, `enable_confirmations=false`, `enable_signup=true`, `db.allowed_cidrs=0.0.0.0/0`. `supabase init` 생성 기본값(로컬). → **Story 1.4**(분리 프로필 로그인) 착수 시 auth 정책 하드닝 + 클라우드 대시보드 동기화.
- **`API_INTERNAL_URL` 내부경로 주의** [docker-compose.yml] — SSR 서버사이드 fetch는 컨테이너 내부 `http://api:8000/v1/...`(prefix 없음)로 호출해야 함. 외부 경로(`/patient_management_system/api/v1/...`)와 다르므로 혼동 주의. → **Story 1.4+**(SSR fetch 도입 시).
- **WebView 에러/오프라인/네비게이션 핸들링 없음** [mobile/lib/webview_screen.dart] — `NavigationDelegate` 부재(onWebResourceError·로딩 상태·뒤로가기·오프라인 재시도 없음). 포털 불가 시 빈 화면. → 환자 포털이 라이브된 후(Story 8.x) 하드닝.
- **CI `supabase db lint` 무신호 게이트** [.github/workflows/ci.yml] — `|| true`로 실패를 삼켜 신호 없음(로컬 DB·링크 부재). 골격 단계 의도. → CI 강화는 Post-MVP(아키텍처 명시).
