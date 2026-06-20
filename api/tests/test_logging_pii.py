"""Story 1.9 — PII 로그 마스킹 백스톱 단위 테스트(AC3 "raw 미로깅", 스택 불요)."""

from __future__ import annotations

import logging

import pytest

from app.core.logging import PiiMaskingFilter, mask_pii


@pytest.mark.parametrize(
    "text,expected",
    [
        ("환자 주민번호 710314-2345678 조회", "환자 주민번호 710314-2****** 조회"),
        ("rrn=7103142345678 end", "rrn=710314-2****** end"),
        ("two 710314-2345678 and 900101-1234568", "two 710314-2****** and 900101-1******"),
    ],
)
def test_mask_pii_redacts_rrn(text: str, expected: str) -> None:
    assert mask_pii(text) == expected


def test_mask_pii_never_leaks_tail() -> None:
    assert "345678" not in mask_pii("710314-2345678")


@pytest.mark.parametrize("text", ["no pii here", "phone 010-1234-5678"])
def test_mask_pii_leaves_non_rrn(text: str) -> None:
    # 13자리 RRN 형태(6+7 연속)가 없는 텍스트는 변형하지 않는다(전화=3·4자리 토막이라 비매칭).
    assert mask_pii(text) == text


@pytest.mark.parametrize(
    "text",
    [
        "710314 2345678",      # 공백 구분
        "rrn7103142345678end",  # 영문 인접(연속 13자리)
        "71031423456789",      # 14자리(숫자 인접) — 과대마스킹
    ],
)
def test_mask_pii_over_masks_adjacent(text: str) -> None:
    # 백스톱은 과대마스킹 선호: RRN이 숫자·공백에 인접해도 뒷 6자리(PII)를 노출하지 않는다.
    assert "345678" not in mask_pii(text)


def test_filter_masks_log_record() -> None:
    """포매팅된 로그 메시지(args 병합 후)에서 주민번호가 마스킹된다."""
    record = logging.LogRecord(
        name="app.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="환자 %s 등록",
        args=("710314-2345678",),
        exc_info=None,
    )
    assert PiiMaskingFilter().filter(record) is True
    assert record.getMessage() == "환자 710314-2****** 등록"
    assert "2345678" not in record.getMessage()
