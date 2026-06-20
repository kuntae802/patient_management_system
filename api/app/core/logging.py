"""구조적 로깅 보조 — PII(주민번호 등) 로그 마스킹 백스톱.

도메인 감사로그(audit_logs)는 별개(DB 트리거 + decrypt 자가-감사, append-only). 여기서는 운영 로그에
raw 주민번호가 우발적으로 섞여도 마스킹하는 방어심층 필터를 제공한다(Story 1.9 AC3 "raw 미로깅",
project-context §PII 경계). 마스킹은 표시 마스크와 동일 형식: `710314-2******`.

core 레이어는 services 를 import 하지 않으므로(레이어 규칙) 마스킹 정규식을 자급한다.
구조적 JSON·request_id 상관관계는 본 스토리 범위 밖(최소 골격, 후속 이월).
"""

from __future__ import annotations

import logging
import re

# 주민번호 패턴 6+(하이픈/공백)+7자리. 백스톱은 과대마스킹 선호 — 숫자·공백 인접에도 마스킹해
# raw 누출 차단(이 도메인의 13자리+ 순수 숫자열은 사실상 PII; 누출 > 과대마스킹 위험).
_RRN_RE = re.compile(r"(\d{6})[-\s]?(\d{7})")


def _mask_match(m: re.Match[str]) -> str:
    # 생년월일 6 + 성별자리 1 노출, 뒤 6자리 마스킹(services.rrn.mask_rrn 과 동일 형식).
    return f"{m.group(1)}-{m.group(2)[0]}{'*' * 6}"


def mask_pii(text: str) -> str:
    """문자열 내 주민번호 패턴을 마스킹한다(로그·진단 출력 백스톱)."""
    return _RRN_RE.sub(_mask_match, text)


class PiiMaskingFilter(logging.Filter):
    """로그 레코드의 최종 메시지에서 주민번호를 마스킹하는 핸들러 필터(우발적 PII 로깅 방어)."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # noqa: BLE001 — 포매팅 실패가 로깅을 깨지 않게(백스톱 보수성)
            return True
        masked = mask_pii(message)
        if masked != message:
            # 이미 병합된 메시지로 치환(args 제거) → 다운스트림 포매터가 마스킹본을 출력.
            record.msg = masked
            record.args = ()
        return True


def configure_logging() -> None:
    """PII 마스킹 필터를 루트 로거의 모든 핸들러에 부착한다(앱 부팅 시 1회, 멱등).

    핸들러가 없으면 StreamHandler 를 추가한다. 필터는 핸들러에 부착해야 자식 로거에서 전파된
    레코드까지 마스킹된다(로거 레벨 필터는 전파분을 못 잡는다).
    """
    root = logging.getLogger()
    if not root.handlers:
        root.addHandler(logging.StreamHandler())
    for handler in root.handlers:
        if not any(isinstance(f, PiiMaskingFilter) for f in handler.filters):
            handler.addFilter(PiiMaskingFilter())
