"""알레르기 교차검증 순수 헬퍼(`_allergy_conflicts`) 단위 테스트 — DB 불요(Story 5.5 UX-DR21②).

자유텍스트 알레르기 ↔ 약품명 토큰 부분일치 휴리스틱. 클래스 매칭 불가(직접 토큰 일치만)·빈 알레르기
스킵·복수 conflict·구분자 토큰화를 검증한다. 통합(서버 409/감사)은 test_orders_integration 소관.
"""

from __future__ import annotations

from app.core.db import _allergy_conflicts


def test_no_allergies_returns_empty():
    """빈/None 알레르기 → conflict 없음(체크 스킵)."""
    drugs = {"d1": "타이레놀정500밀리그람(아세트아미노펜)"}
    assert _allergy_conflicts(None, drugs) == {}
    assert _allergy_conflicts("", drugs) == {}
    assert _allergy_conflicts("   ", drugs) == {}


def test_direct_token_match():
    """알레르기 토큰이 약품명에 부분 포함 → conflict(매칭 토큰 반환)."""
    drugs = {"d1": "타이레놀정500밀리그람(아세트아미노펜)"}
    out = _allergy_conflicts("타이레놀", drugs)
    assert out == {"d1": "타이레놀"}


def test_delimiter_tokenization_multiple():
    """구분자(쉼표·공백)로 복수 토큰 → 각 약품 매칭."""
    drugs = {
        "d1": "아목시실린캡슐250밀리그람",
        "d2": "노바스크정5밀리그람(암로디핀)",
        "d3": "타이레놀정500밀리그람",
    }
    out = _allergy_conflicts("아목시실린, 암로디핀", drugs)
    assert out == {"d1": "아목시실린", "d2": "암로디핀"}
    assert "d3" not in out  # 무관 약품


def test_no_false_positive_for_unrelated():
    """무관 알레르기(꽃가루) → 매칭 없음."""
    drugs = {"d1": "타이레놀정500밀리그람"}
    assert _allergy_conflicts("꽃가루", drugs) == {}


def test_class_match_not_supported():
    """클래스 매칭 불가(정직한 한계) — '페니실린' ⊄ '아목시실린' 약품명 → 매칭 없음."""
    drugs = {"d1": "아목시실린캡슐250밀리그람"}
    assert _allergy_conflicts("페니실린", drugs) == {}


def test_short_token_ignored():
    """길이 <2 토큰은 무시(과매칭 방지)."""
    drugs = {"d1": "정주용 수액"}
    # '정'(1자) 무시 → 매칭 없음.
    assert _allergy_conflicts("정", drugs) == {}


def test_case_insensitive_latin():
    """라틴 약품명은 대소문자 무관 매칭."""
    drugs = {"d1": "Aspirin 100mg"}
    assert _allergy_conflicts("ASPIRIN", drugs) == {"d1": "aspirin"}
