"""구조적 로깅 — JSON(level + request_id). PII(주민번호 등) 절대 미기록·마스킹.

도메인 감사로그(audit_logs)는 별개(DB 트리거, append-only). 후속 스토리에서 설정.
"""

# TODO: PII 마스킹 필터 + 구조적 JSON 로거 설정
