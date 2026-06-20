"""에러 봉투 일관성 단위 테스트 (AC3·AC6) — 모든 오류가 {error:{code,message,detail}} 형태,
422 검증 detail 에 원본 입력값(PII 가능) 미노출, 500 에 내부 정보 미노출.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.core.errors import ConflictError, ForbiddenError, NotFoundError, init_error_handlers


class _Body(BaseModel):
    name: str
    age: int


def _client() -> TestClient:
    app = FastAPI()
    init_error_handlers(app)

    @app.post("/echo")
    async def echo(body: _Body) -> _Body:
        return body

    @app.get("/forbidden")
    async def forbidden() -> None:
        raise ForbiddenError(detail={"required_permission": "rbac.manage"})

    @app.get("/conflict")
    async def conflict() -> None:
        raise ConflictError()

    @app.get("/notfound")
    async def notfound() -> None:
        raise NotFoundError()

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("내부비밀 환자주민 900101-1234567 노출되면 안됨")

    # raise_server_exceptions=False → Exception 핸들러가 500 봉투를 반환하게 함
    return TestClient(app, raise_server_exceptions=False)


def _assert_envelope(body: dict) -> dict:
    assert set(body.keys()) == {"error"}
    err = body["error"]
    assert set(err.keys()) == {"code", "message", "detail"}
    assert isinstance(err["code"], str) and err["code"]
    assert isinstance(err["message"], str) and err["message"]
    return err


def test_validation_error_422_envelope_no_input_leak() -> None:
    client = _client()
    res = client.post("/echo", json={"name": "테스트환자", "age": "열살아님"})
    assert res.status_code == 422
    err = _assert_envelope(res.json())
    assert err["code"] == "validation_error"
    assert isinstance(err["detail"], list) and err["detail"]
    for item in err["detail"]:
        assert set(item.keys()) == {"loc", "type", "msg"}  # input/ctx 미포함
    # 제출한 원본 값이 응답에 echo 되지 않아야 함(PII 경계)
    assert "열살아님" not in res.text
    assert "테스트환자" not in res.text


def test_forbidden_403_envelope() -> None:
    res = _client().get("/forbidden")
    assert res.status_code == 403
    err = _assert_envelope(res.json())
    assert err["code"] == "forbidden"
    assert err["detail"] == {"required_permission": "rbac.manage"}


def test_conflict_409_envelope() -> None:
    res = _client().get("/conflict")
    assert res.status_code == 409
    assert _assert_envelope(res.json())["code"] == "conflict"


def test_not_found_404_envelope() -> None:
    res = _client().get("/notfound")
    assert res.status_code == 404
    assert _assert_envelope(res.json())["code"] == "not_found"


def test_unhandled_500_hides_internals() -> None:
    res = _client().get("/boom")
    assert res.status_code == 500
    err = _assert_envelope(res.json())
    assert err["code"] == "internal_error"
    assert err["detail"] is None
    # 내부 예외 메시지·PII 가 응답에 새지 않아야 함
    assert "900101-1234567" not in res.text
    assert "내부비밀" not in res.text


def test_framework_404_korean_envelope() -> None:
    # 프레임워크 생성 404(미지 경로) → 표준 한국어 봉투(영문 "Not Found" 비노출).
    res = _client().get("/nonexistent-path")
    assert res.status_code == 404
    err = _assert_envelope(res.json())
    assert err["code"] == "not_found"
    assert err["message"] == "대상을 찾을 수 없습니다."
    assert "Not Found" not in res.text
