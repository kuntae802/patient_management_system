"""본인인증(PASS) 시뮬 seam — 실연동 자리(Story 3.4).

아키텍처 §시뮬 범위: 본인인증(PASS/NICE)은 "연결 가능한 이음매(seam)"로 설계한다(실연동 범위 밖).
현재는 시뮬 — 항상 통과(부수효과·외부호출 없음). 실 연동 도입 시 이 함수가 단일 교체점이 된다
(PASS API 호출 + 인증 실패 시 예외).

⚠️ 시뮬 시대의 사칭 방지 1차선은 이 함수가 아니라 **self-link 의 성명 일치 가드**
   (`core/db.link_self_patient`)다 — 여기서 막지 않는다(주민번호 소유의 암호학적 증명은 실 PASS 몫).
🚫 raw 주민번호·성명은 로깅하지 않는다(PII 경계).
"""

from __future__ import annotations


def simulate_identity_verification(*, resident_no: str, name: str) -> None:
    """본인인증 시뮬 — 통과만(no-op). 실 PASS 연동 시 호출·실패 처리로 교체.

    인자(resident_no·name)는 실 연동 시 PASS 요청에 사용될 자리표시 — 시뮬에선 사용하지 않으며
    로깅하지 않는다. 통과 = 반환 None, 실패(미래) = 예외.
    """
    # 시뮬: 외부 인증 없이 통과. 실 연동 시 여기서 PASS API 호출 후 실패면 raise.
    return None
