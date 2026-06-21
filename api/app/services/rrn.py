"""주민번호(resident_no) 검증·정규화·마스킹 순수 함수 — Story 1.9 프리미티브.

DB·테이블·엔드포인트 비의존(순수). Epic 3(환자 등록)이 Pydantic 경계에서 소비:
HARD 실패 → 422 거부, SOFT 경고는 통과(클라가 경고 표시). 암호화·HMAC blind index 는 DB
RPC(0005_crypto.sql)가 Vault 키로 수행한다(여기서 키를 다루지 않는다).

⚠️ PII 경계: raw 주민번호는 로그·에러·응답에 노출 금지. 검증 결과(`RrnValidation`)는 기계용 코드만
담고 원본 값을 절대 echo 하지 않는다(에러봉투 PII 누출 방지, core/errors.py 정합).

검증 규칙(architecture.md §주민번호 유효성):
  HARD(거부) = 형식(13자리) + 성별·세기 자리(내국 1–4·외국 5–8) + 생년월일 유효.
  SOFT(경고)  = 전통 가중치 mod-11 체크섬(2020 개편으로 신규 번호가 안 따를 수 있어 차단 아님).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

# 성별·세기 자리 → 출생 세기(앞 2자리에 더할 기준연도). 9·0(1800년대)은 HARD 범위(1–8) 밖이라 제외.
_CENTURY_BY_GENDER: dict[int, int] = {
    1: 1900, 2: 1900, 5: 1900, 6: 1900,  # 1900년대(내국 1·2, 외국 5·6)
    3: 2000, 4: 2000, 7: 2000, 8: 2000,  # 2000년대(내국 3·4, 외국 7·8)
}
# 체크섬 가중치(앞 12자리). check = (11 - (Σ dᵢ·wᵢ mod 11)) mod 10.
_CHECKSUM_WEIGHTS = (2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5)
_NON_DIGIT = re.compile(r"\D")
_DAYS_IN_MONTH = (31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


@dataclass(frozen=True)
class RrnValidation:
    """검증 결과 — 원본 값 미포함(PII 경계). `errors` 가 비면 HARD 통과."""

    is_valid: bool
    errors: tuple[str, ...]
    warnings: tuple[str, ...]


def normalize_rrn(raw: str) -> str:
    """하이픈·공백 등 비숫자를 제거해 13자리 숫자 문자열로 정규화한다(검증/HMAC 입력 공용)."""
    return _NON_DIGIT.sub("", raw or "")


def _is_valid_birthdate(digits: str) -> bool:
    """성별 자리로 세기를 정해 YYMMDD 가 실재하는 날짜인지 검사(윤년 2/29 포함)."""
    gender = int(digits[6])
    century = _CENTURY_BY_GENDER.get(gender)
    if century is None:
        return False
    year = century + int(digits[0:2])
    month = int(digits[2:4])
    day = int(digits[4:6])
    if not 1 <= month <= 12 or day < 1:
        return False
    max_day = _DAYS_IN_MONTH[month - 1]
    if month == 2 and not (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)):
        max_day = 28
    return day <= max_day


def _checksum_ok(digits: str) -> bool:
    """전통 가중치 mod-11 체크섬 일치 여부(SOFT)."""
    total = sum(int(digits[i]) * _CHECKSUM_WEIGHTS[i] for i in range(12))
    return (11 - (total % 11)) % 10 == int(digits[12])


def validate_rrn(raw: str) -> RrnValidation:
    """주민번호를 HARD/SOFT 검증한다. raw 는 하이픈 포함/미포함 모두 허용(정규화 후 평가)."""
    digits = normalize_rrn(raw)
    errors: list[str] = []
    warnings: list[str] = []

    # HARD-1 형식: 정규화 후 정확히 13자리 숫자. 실패 시 후속 검사 무의미 → 조기 반환.
    if len(digits) != 13:
        return RrnValidation(is_valid=False, errors=("invalid_format",), warnings=())

    # HARD-2 성별·세기 자리 ∈ {1..8}(내국 1–4·외국 5–8).
    if int(digits[6]) not in _CENTURY_BY_GENDER:
        errors.append("invalid_gender_digit")
        # 세기 미상이면 생년월일 검사 불가 → 형식상 통과한 자리만으로 종료.
        return RrnValidation(is_valid=False, errors=tuple(errors), warnings=())

    # HARD-3 생년월일 유효.
    if not _is_valid_birthdate(digits):
        errors.append("invalid_birthdate")

    # SOFT 체크섬(경고만 — 통과 가능).
    if not _checksum_ok(digits):
        warnings.append("checksum_mismatch")

    return RrnValidation(is_valid=not errors, errors=tuple(errors), warnings=tuple(warnings))


def mask_rrn(raw: str) -> str:
    """정규 13자리 → `710314-2******` 마스킹(생년월일+성별자리만 노출, 뒤 6자리 가림).

    형식 외 입력은 정보 누출 방지를 위해 전부 마스킹한다(부분 노출 안 함).
    """
    digits = normalize_rrn(raw)
    if len(digits) == 13:
        return f"{digits[:6]}-{digits[6]}{'*' * 6}"
    return "*" * (len(digits) or 1)


def parse_rrn(raw: str) -> tuple[date, str]:
    """검증 통과한 주민번호에서 (생년월일, 성별)을 파생한다. 성별 = 자리 홀수→male·짝수→female.

    ⚠️ 호출 전 `validate_rrn(...).is_valid` 가 참이어야 한다(HARD 통과). 형식·세기·생년월일이 이미
    검증됐다는 전제이며, 부정 입력에는 ValueError 를 던진다(서버 파생=입력 불일치 제거 단일 진실).
    """
    digits = normalize_rrn(raw)
    if len(digits) != 13:
        raise ValueError("주민번호 형식 오류 — parse_rrn 은 검증 통과 입력만 받는다")
    gender = int(digits[6])
    century = _CENTURY_BY_GENDER.get(gender)
    if century is None:
        raise ValueError("성별·세기 자리 오류 — parse_rrn 은 검증 통과 입력만 받는다")
    birth = date(century + int(digits[0:2]), int(digits[2:4]), int(digits[4:6]))
    sex = "male" if gender % 2 == 1 else "female"
    return birth, sex
