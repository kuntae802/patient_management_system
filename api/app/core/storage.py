"""Supabase Storage 래퍼 — 영상 자료 업로드·서명 URL(supabase-py service_role).

영상검사 촬영 영상(Story 5.8)을 비공개 버킷(examination-images, 0019)에 올리고, 읽기는 서버 발급
단기 서명 URL 로만 한다(DB 엔 객체 경로만 — architecture.md:217). supabase_admin 의 service_role
클라이언트 싱글톤을 재사용한다(2번째 클라 생성 금지 — Auth admin 과 동일 클라).

⚠️ storage3(supabase-py)의 Storage 클라이언트는 **동기** → asyncpg 이벤트 루프 블로킹을 막기 위해
   모든 호출을 `anyio.to_thread.run_sync` 로 스레드 오프로드한다(supabase_admin.py 선례).
🔒 객체 경로/파일명에 PII 금지(호출부가 보장 — `{examination_id}/{uuid4}.{ext}`). secret 키·경로는
   로그/응답/예외 메시지에 노출하지 않는다.
"""

from __future__ import annotations

import logging
from functools import partial

import anyio

from app.core.errors import ServiceUnavailableError
from app.core.supabase_admin import _get_admin_client

logger = logging.getLogger("app.storage")

# 영상 자료 비공개 버킷(0019 생성). 접근 = service_role 서명 URL 전용(public=false).
EXAMINATION_IMAGES_BUCKET = "examination-images"
# 단기 서명 URL TTL(초) — 읽을 때마다 재생성(DB 미저장). 5분.
SIGNED_URL_TTL_SECONDS = 300


async def upload_object(bucket: str, path: str, data: bytes, content_type: str) -> None:
    """바이트를 버킷 객체 경로에 업로드(service_role). 동기 storage3 호출 → 스레드 오프로드.

    path = 버킷 내 객체 경로(PII 금지). content_type = MIME(검증은 호출부). 실패 시 예외 전파
    (서비스 계층/전역 핸들러가 매핑). 미설정 secret 키 → _get_admin_client 가 503.
    """
    client = _get_admin_client()
    await anyio.to_thread.run_sync(
        partial(
            client.storage.from_(bucket).upload,
            path,
            data,
            {"content-type": content_type},
        )
    )


async def remove_object(bucket: str, path: str) -> None:
    """버킷 객체 삭제(보상용·best-effort). 실패해도 원 오류를 가리지 않도록 삼킨다.

    업로드 후 DB INSERT 실패(검증 404/422/409·FK 등) 시 orphan 객체 정리 — Storage 업로드는
    asyncpg 트랜잭션 밖이라 롤백이 객체를 못 지운다(admin_delete_user 보상 선례). 동기 → 오프로드.
    """
    try:
        client = _get_admin_client()
        await anyio.to_thread.run_sync(partial(client.storage.from_(bucket).remove, [path]))
    except Exception as exc:  # noqa: BLE001 — 보상은 어떤 실패에도 원 오류를 가리지 않는다
        logger.warning("영상 객체 보상 삭제 실패(orphan 가능): %s", type(exc).__name__)


async def create_signed_url(
    bucket: str, path: str, expires_in: int = SIGNED_URL_TTL_SECONDS
) -> str:
    """객체 경로에 대한 단기 서명 URL 발급(service_role). 비공개 버킷 읽기 전용.

    storage3 create_signed_url 은 동기·`{"signedURL": <full url>}` 반환 → 오프로드 후 추출.
    URL 미발급(빈 응답) → 503(불투명 실패 방지). DB 엔 경로만 저장하고 URL 은 매 조회 시 재생성한다.
    """
    client = _get_admin_client()
    resp = await anyio.to_thread.run_sync(
        partial(client.storage.from_(bucket).create_signed_url, path, expires_in)
    )
    url = resp.get("signedURL") if isinstance(resp, dict) else None
    if not url:
        logger.warning("서명 URL 발급 실패(빈 응답) — bucket=%s", bucket)
        raise ServiceUnavailableError("영상 서명 URL 발급에 실패했습니다.")
    return url
