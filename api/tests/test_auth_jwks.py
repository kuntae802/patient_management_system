"""JWKS 토큰 검증 단위 테스트 (AC1) — 실 네트워크 없이 로컬 ES256 키로 검증 로직만 격리.

`_resolve_signing_key`(JWKS fetch)를 로컬 공개키로 monkeypatch → 유효/만료/위조/aud 불일치/
누락/malformed 각 케이스가 통과 또는 401 봉투로 거부되는지 확인.
"""

from __future__ import annotations

import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.core import security
from app.core.config import settings
from app.core.errors import init_error_handlers
from app.core.security import CurrentUser, get_current_user


@pytest.fixture(scope="module")
def keypair() -> tuple[ec.EllipticCurvePrivateKey, ec.EllipticCurvePrivateKey]:
    """검증용 ES256 키쌍 + 위조 검증용 별도 키."""
    signer = ec.generate_private_key(ec.SECP256R1())
    attacker = ec.generate_private_key(ec.SECP256R1())
    return signer, attacker


def _mint(signer: ec.EllipticCurvePrivateKey, **overrides: object) -> str:
    now = int(time.time())
    claims: dict[str, object] = {
        "sub": str(uuid.uuid4()),
        "aud": settings.supabase_jwt_aud,
        "iss": settings.jwt_issuer,
        "role": "authenticated",
        "email": "tester@pms.local",
        "iat": now,
        "exp": now + 3600,
    }
    claims.update(overrides)
    return jwt.encode(claims, signer, algorithm="ES256")


@pytest.fixture
def client(
    keypair: tuple[ec.EllipticCurvePrivateKey, ec.EllipticCurvePrivateKey],
    monkeypatch: pytest.MonkeyPatch,
) -> TestClient:
    signer, _ = keypair

    async def _fake_resolve(_token: str) -> object:
        return signer.public_key()

    monkeypatch.setattr(security, "_resolve_signing_key", _fake_resolve)

    app = FastAPI()
    init_error_handlers(app)

    @app.get("/whoami")
    async def whoami(user: CurrentUser = Depends(get_current_user)) -> dict[str, str]:
        return {"sub": str(user.sub)}

    return TestClient(app)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_valid_token_passes(client: TestClient, keypair) -> None:
    signer, _ = keypair
    sub = str(uuid.uuid4())
    res = client.get("/whoami", headers=_auth(_mint(signer, sub=sub)))
    assert res.status_code == 200
    assert res.json()["sub"] == sub


def test_expired_token_rejected(client: TestClient, keypair) -> None:
    signer, _ = keypair
    res = client.get("/whoami", headers=_auth(_mint(signer, exp=int(time.time()) - 10)))
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthenticated"


def test_wrong_audience_rejected(client: TestClient, keypair) -> None:
    signer, _ = keypair
    res = client.get("/whoami", headers=_auth(_mint(signer, aud="some-other-aud")))
    assert res.status_code == 401


def test_forged_signature_rejected(client: TestClient, keypair) -> None:
    _, attacker = keypair  # 다른 키로 서명 → 검증 키와 불일치
    res = client.get("/whoami", headers=_auth(_mint(attacker)))
    assert res.status_code == 401


def test_missing_header_rejected(client: TestClient) -> None:
    res = client.get("/whoami")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthenticated"


def test_malformed_token_rejected(client: TestClient) -> None:
    res = client.get("/whoami", headers=_auth("not-a-jwt"))
    assert res.status_code == 401


def test_non_uuid_sub_rejected(client: TestClient, keypair) -> None:
    # 서명·aud·exp 유효하나 sub 가 UUID 아님 → CurrentUser 구성 실패 → 401(500 아님).
    signer, _ = keypair
    res = client.get("/whoami", headers=_auth(_mint(signer, sub="not-a-uuid")))
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthenticated"


def test_wrong_issuer_rejected(client: TestClient, keypair) -> None:
    if settings.jwt_issuer is None:
        pytest.skip("iss 미검증 구성(jwt_issuer None) — 검증 불가")
    signer, _ = keypair
    res = client.get("/whoami", headers=_auth(_mint(signer, iss="https://evil.example/auth")))
    assert res.status_code == 401


class _FakeJWKClient:
    """get_signing_key_from_jwt 가 지정 예외를 던지는 가짜 클라이언트(실 키해석 경로 검증용)."""

    def __init__(self, exc: Exception) -> None:
        self._exc = exc

    def get_signing_key_from_jwt(self, token: str) -> object:
        raise self._exc


def _app_real_resolve() -> TestClient:
    app = FastAPI()
    init_error_handlers(app)

    @app.get("/whoami")
    async def whoami(user: CurrentUser = Depends(get_current_user)) -> dict[str, str]:
        return {"sub": str(user.sub)}

    return TestClient(app)


def test_jwks_unreachable_returns_503(monkeypatch: pytest.MonkeyPatch) -> None:
    # JWKS 엔드포인트 도달 불가 → 503(전면 500 금지). 실 _resolve_signing_key except 순서 검증.
    from jwt.exceptions import PyJWKClientConnectionError

    fake = _FakeJWKClient(PyJWKClientConnectionError("unreachable"))
    monkeypatch.setattr(security, "_get_jwks_client", lambda: fake)
    res = _app_real_resolve().get("/whoami", headers=_auth("a.b.c"))
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "service_unavailable"


def test_jwks_key_error_returns_401(monkeypatch: pytest.MonkeyPatch) -> None:
    # 매칭 키 없음/파싱 실패(PyJWTError) → 401. connection 오류와 구분되는 분기.
    fake = _FakeJWKClient(jwt.DecodeError("no matching key"))
    monkeypatch.setattr(security, "_get_jwks_client", lambda: fake)
    res = _app_real_resolve().get("/whoami", headers=_auth("a.b.c"))
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthenticated"
