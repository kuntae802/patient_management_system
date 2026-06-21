"""자가연결 보조 로직 단위 테스트(Story 3.4) — 스택 비의존(순수 함수)."""

from __future__ import annotations

import unicodedata

from app.core.db import _norm_name
from app.services import identity


def test_norm_name_trims_and_collapses_whitespace():
    assert _norm_name("홍길동") == "홍길동"
    assert _norm_name("  홍길동  ") == "홍길동"
    assert _norm_name("홍  길동") == "홍 길동"  # 내부 연속 공백 1개로 축약
    assert _norm_name("\t김 철수\n") == "김 철수"


def test_norm_name_equal_after_normalization():
    # 표시 변형(앞뒤·내부 공백)이 같은 canonical 로 수렴 → 성명 일치 비교 안정.
    assert _norm_name(" 이 영희 ") == _norm_name("이  영희")


def test_norm_name_unicode_nfc_equivalence():
    # iOS/macOS 분해형(NFD) 한글이 저장 조합형(NFC)과 같은 canonical 로 수렴(false-reject 방지).
    nfc = unicodedata.normalize("NFC", "강감찬")
    nfd = unicodedata.normalize("NFD", "강감찬")
    assert nfd != nfc  # 분해형은 바이트가 다름
    assert _norm_name(nfd) == _norm_name(nfc)  # 정규화 후 동일 → 매칭 성공


def test_simulate_identity_verification_passes_silently():
    # 시뮬 seam — 통과(None). 실 PASS 도입 시 실패 분기가 추가될 교체점.
    assert (
        identity.simulate_identity_verification(resident_no="9001011234567", name="홍길동") is None
    )
