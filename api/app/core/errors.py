"""에러 봉투 — {error: {code, message, detail}} + HTTP(401/403/404/409/422/500/503).

code=기계용 영문, message=한국어. 내부정보·PII(토큰·sub·이메일·주민번호) 절대 노출 금지.
모든 오류는 단일 봉투 형태로 직렬화 → OpenAPI·클라가 일관 처리(§Story1.5 AC3·AC6).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("app.errors")

# HTTP 상태 → (기계용 code, 범용 한국어 message). 핸들러가 detail 미상정 시 사용.
_STATUS_DEFAULTS: dict[int, tuple[str, str]] = {
    400: ("bad_request", "잘못된 요청입니다."),
    401: ("unauthenticated", "인증이 필요합니다."),
    403: ("forbidden", "권한이 없습니다."),
    404: ("not_found", "대상을 찾을 수 없습니다."),
    409: ("conflict", "잘못된 상태 전이입니다."),
    422: ("validation_error", "입력값이 올바르지 않습니다."),
    500: ("internal_error", "서버 오류가 발생했습니다."),
    503: ("service_unavailable", "일시적으로 서비스를 사용할 수 없습니다."),
}


def _envelope(code: str, message: str, detail: Any = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "detail": detail}}


class AppError(Exception):
    """도메인 오류 베이스. status_code·code·message(한국어)·detail 을 봉투로 직렬화한다."""

    status_code: int = 500
    code: str = "internal_error"
    default_message: str = "서버 오류가 발생했습니다."

    def __init__(
        self,
        message: str | None = None,
        *,
        detail: Any = None,
        code: str | None = None,
        status_code: int | None = None,
    ) -> None:
        self.message = message or self.default_message
        self.detail = detail
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        super().__init__(self.message)


class AuthError(AppError):
    """인증 실패 — 토큰 부재/만료/위조/aud 불일치 (401)."""

    status_code = 401
    code = "unauthenticated"
    default_message = "인증이 필요합니다."


class ForbiddenError(AppError):
    """권한 없음 — 인증됐으나 has_permission 불충족 또는 비직원 (403)."""

    status_code = 403
    code = "forbidden"
    default_message = "권한이 없습니다."


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"
    default_message = "대상을 찾을 수 없습니다."


class ConflictError(AppError):
    """잘못된 상태 전이 — 상태머신이 허용하지 않는 동작 (409)."""

    status_code = 409
    code = "conflict"
    default_message = "잘못된 상태 전이입니다."


class ServiceUnavailableError(AppError):
    """일시적 의존성 장애 — JWKS/DB 도달 불가 등 (503). 전면 500 대신 명시 폴백."""

    status_code = 503
    code = "service_unavailable"
    default_message = "일시적으로 서비스를 사용할 수 없습니다."


def _sanitize_validation_errors(raw_errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """검증 오류에서 위치·종류·메시지만 남긴다. `input`(원본값=PII 가능)·`ctx`(객체) 제거."""
    cleaned: list[dict[str, Any]] = []
    for err in raw_errors:
        cleaned.append(
            {
                "loc": [str(part) for part in err.get("loc", [])],
                "type": err.get("type"),
                "msg": err.get("msg"),
            }
        )
    return cleaned


async def _app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=_envelope(exc.code, exc.message, jsonable_encoder(exc.detail)),
    )


async def _validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    code, message = _STATUS_DEFAULTS[422]
    return JSONResponse(
        status_code=422,
        content=_envelope(code, message, _sanitize_validation_errors(exc.errors())),
    )


async def _http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    known = _STATUS_DEFAULTS.get(exc.status_code)
    if known is not None:
        # 알려진 상태코드는 표준 한국어 메시지 강제 — 프레임워크 영문("Not Found")·라우터 detail·
        # 내부정보 누출 차단(code=영문·message=한국어, AC3/AC6).
        code, message = known
    else:
        # 미지 상태코드만 라우터가 명시한 문자열 detail 을 노출(없으면 일반 문구).
        code = "error"
        message = (
            exc.detail
            if isinstance(exc.detail, str) and exc.detail
            else "요청을 처리할 수 없습니다."
        )
    return JSONResponse(status_code=exc.status_code, content=_envelope(code, message, None))


async def _unhandled_handler(_: Request, exc: Exception) -> JSONResponse:
    code, message = _STATUS_DEFAULTS[500]
    # 서버측에만 예외 '종류'를 남긴다(스택·메시지에 PII 가능 → 본문/응답엔 비노출).
    logger.exception("처리되지 않은 예외: %s", type(exc).__name__)
    return JSONResponse(status_code=500, content=_envelope(code, message, None))


def init_error_handlers(app: FastAPI) -> None:
    """모든 예외를 단일 봉투로 변환하는 핸들러를 등록한다."""
    app.add_exception_handler(AppError, _app_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, _validation_handler)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, _unhandled_handler)
