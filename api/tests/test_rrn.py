"""Story 1.9 — 주민번호 검증·정규화·마스킹 순수 함수 단위 테스트(스택 불요).

HARD(형식·성별/세기 자리·생년월일) = 거부, SOFT(체크섬) = 경고 통과, 마스킹 = `710314-2******`.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.services.rrn import (
    RrnValidation,
    mask_rrn,
    normalize_rrn,
    parse_rrn,
    validate_rrn,
)

# 체크섬 일치 표본: 9001011234568 → Σ(가중치)=124, (11-124%11)%10=8 = 13번째 자리(경고 없음).
_VALID_NO_WARN = "900101-1234568"


# ── normalize ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("900101-1234568", "9001011234568"),
        ("9001011234568", "9001011234568"),
        ("  900101 - 1234568 ", "9001011234568"),
        ("", ""),
    ],
)
def test_normalize_rrn(raw: str, expected: str) -> None:
    assert normalize_rrn(raw) == expected


# ── HARD 통과 + SOFT 경고 ─────────────────────────────────────────────────────


def test_valid_no_warning() -> None:
    res = validate_rrn(_VALID_NO_WARN)
    assert res == RrnValidation(is_valid=True, errors=(), warnings=())


def test_valid_hard_but_checksum_warning() -> None:
    # 9001011234567: HARD 통과(형식·자리·생년월일), 체크섬만 불일치 → SOFT 경고로 통과.
    res = validate_rrn("900101-1234567")
    assert res.is_valid is True
    assert res.errors == ()
    assert res.warnings == ("checksum_mismatch",)


@pytest.mark.parametrize("gender_digit", ["5", "6", "7", "8"])
def test_foreign_gender_digit_allowed(gender_digit: str) -> None:
    # 외국인 자리(5–8)도 HARD 통과(생년월일·형식 충족 시). 체크섬 경고는 무관.
    res = validate_rrn(f"900101-{gender_digit}234567")
    assert res.is_valid is True
    assert "invalid_gender_digit" not in res.errors


# ── HARD 거부 ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("raw", ["12345", "900101-123456", "9001011234", "900101-12345678"])
def test_invalid_format(raw: str) -> None:
    res = validate_rrn(raw)
    assert res.is_valid is False
    assert res.errors == ("invalid_format",)


@pytest.mark.parametrize("gender_digit", ["0", "9"])
def test_invalid_gender_digit(gender_digit: str) -> None:
    res = validate_rrn(f"900101-{gender_digit}234567")
    assert res.is_valid is False
    assert res.errors == ("invalid_gender_digit",)


@pytest.mark.parametrize("raw", ["901301-1234567", "900230-1234567", "010229-3234567"])
def test_invalid_birthdate(raw: str) -> None:
    # 13월 / 1990-02-30 / 2001-02-29(비윤년) → 생년월일 무효.
    res = validate_rrn(raw)
    assert res.is_valid is False
    assert "invalid_birthdate" in res.errors


def test_leap_day_2000_is_valid() -> None:
    # 2000-02-29: 2000은 400으로 나눠떨어져 윤년 → 생년월일 유효(HARD 통과).
    res = validate_rrn("000229-3234567")
    assert res.is_valid is True
    assert "invalid_birthdate" not in res.errors


# ── 마스킹 ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("raw", ["900101-1234568", "9001011234568"])
def test_mask_canonical(raw: str) -> None:
    assert mask_rrn(raw) == "900101-1******"


def test_mask_never_reveals_last_six() -> None:
    masked = mask_rrn("710314-2345678")
    assert masked == "710314-2******"
    assert "345678" not in masked  # 뒷자리 비노출


@pytest.mark.parametrize("raw", ["12345", "", "abcd"])
def test_mask_non_canonical_fully_masked(raw: str) -> None:
    # 형식 외 입력은 부분 노출 없이 전부 마스킹(또는 최소 1개).
    masked = mask_rrn(raw)
    assert set(masked) <= {"*"} and len(masked) >= 1


# ── 파생(parse_rrn) — birth_date·sex (Story 3.1) ──────────────────────────────


@pytest.mark.parametrize(
    "raw,expected_date,expected_sex",
    [
        ("900101-1234568", date(1990, 1, 1), "male"),    # 1·세기 1900·홀수=male
        ("900101-2234567", date(1990, 1, 1), "female"),  # 2·세기 1900·짝수=female
        ("100101-3234567", date(2010, 1, 1), "male"),    # 3·세기 2000·홀수=male
        ("100101-4234567", date(2010, 1, 1), "female"),  # 4·세기 2000·짝수=female
    ],
)
def test_parse_rrn_derives_birth_and_sex(raw, expected_date, expected_sex) -> None:
    birth, sex = parse_rrn(raw)
    assert birth == expected_date
    assert sex == expected_sex


def test_parse_rrn_accepts_hyphenless() -> None:
    """정규화 입력 — 하이픈 유/무 동일 결과."""
    assert parse_rrn("9001011234568") == parse_rrn("900101-1234568")


@pytest.mark.parametrize("raw", ["123", "", "9001011", "900101-9234567"])
def test_parse_rrn_rejects_invalid(raw: str) -> None:
    """검증 미통과 입력(형식·세기 자리 0/9)에는 ValueError(서버 파생은 검증 통과 전제)."""
    with pytest.raises(ValueError):
        parse_rrn(raw)
