"""방사선(radiology) 오케스트레이션(services 계층) — 워크리스트·장비·영상 업로드/조회·촬영 수행.

Story 5.8 / FR-100·FR-101·FR-103. 촬영 수행 = 전이 RPC(perform_examination, ordered→performed) —
db/DB 가 권한 재평가·재수행 차단·영상≥1·장비 배정을 동일 트랜잭션 소유. 영상 업로드 = 2단계:
서비스가 Storage(비공개 버킷) 업로드 → db 가 examination_images 경로 연결. 서명 URL 은 조회 시 생성.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import UploadFile

from app.core import db, storage
from app.core.errors import AppError
from app.schemas.orders import ExaminationResponse
from app.schemas.radiology import (
    CompleteExaminationBody,
    EquipmentResponse,
    ExaminationImageResponse,
    PerformExaminationBody,
    RadiologyWorklistItem,
    ReadingWorklistItem,
)

# 허용 MIME → 확장자(버킷 allowed_mime_types 0019 와 일치). 그 외 → 422.
_ALLOWED_MIME_EXT: dict[str, str] = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}
_MAX_IMAGE_BYTES = 52_428_800  # 50MiB(버킷 file_size_limit 와 일치)


async def list_radiology_worklist(sub: UUID) -> list[RadiologyWorklistItem]:
    """촬영 워크리스트(FR-100) — 활성 내원의 미수행 영상검사. 게이트=라우터(examination.perform)."""
    rows = await db.fetch_radiology_worklist(sub)
    return [RadiologyWorklistItem.model_validate(r) for r in rows]


async def list_equipment(sub: UUID) -> list[EquipmentResponse]:
    """장비 목록·상태(FR-103). 게이트=라우터(order.read)."""
    rows = await db.fetch_equipment(sub)
    return [EquipmentResponse.model_validate(r) for r in rows]


async def upload_examination_image(
    sub: UUID, examination_id: UUID, file: UploadFile
) -> ExaminationImageResponse:
    """촬영 영상 업로드(FR-101) — Storage(비공개 버킷) 저장 → examination_images 경로 연결.

    MIME 화이트리스트·용량(≤50MiB) 검증(위반 422). 객체 경로 = {examination_id}/{uuid4}.{ext}
    (🔒 PII 금지). 업로드 후 db INSERT(검사 imaging·ordered 선검사 — 404/422/409). 응답에 서명 URL.
    """
    content_type = (file.content_type or "").lower()
    ext = _ALLOWED_MIME_EXT.get(content_type)
    if ext is None:
        raise AppError(
            "지원하지 않는 영상 형식입니다(PNG·JPEG·WEBP).",
            code="invalid_mime",
            status_code=422,
        )
    # Content-Length 가 있으면 전체 바이트를 메모리에 읽기 전에 조기 거부(메모리 가드). 없으면(None)
    # 통과 후 읽은 길이로 최종 검사(권위).
    if file.size is not None and file.size > _MAX_IMAGE_BYTES:
        raise AppError(
            "영상 용량이 너무 큽니다(최대 50MiB).", code="file_too_large", status_code=422
        )
    data = await file.read()
    if not data:
        raise AppError("빈 파일은 업로드할 수 없습니다.", code="empty_file", status_code=422)
    if len(data) > _MAX_IMAGE_BYTES:
        raise AppError(
            "영상 용량이 너무 큽니다(최대 50MiB).", code="file_too_large", status_code=422
        )
    object_path = f"{examination_id}/{uuid4().hex}{ext}"  # 🔒 PII 없음(불투명 id + uuid)
    await storage.upload_object(storage.EXAMINATION_IMAGES_BUCKET, object_path, data, content_type)
    # 업로드는 db 트랜잭션 밖 → INSERT 실패(검증 404/422/409·FK 등) 시 롤백이 객체를 못 지운다.
    # orphan 방지: 실패 시 업로드 객체를 보상 삭제(best-effort)하고 원 오류를 전파.
    try:
        row = await db.insert_examination_image(
            sub,
            examination_id=examination_id,
            storage_path=object_path,
            content_type=content_type,
            file_size=len(data),
            uploaded_by=sub,
        )
    except Exception:  # noqa: BLE001 — orphan 객체 보상 후 원 오류 그대로 전파
        await storage.remove_object(storage.EXAMINATION_IMAGES_BUCKET, object_path)
        raise
    return await _to_image_response(row)


async def list_examination_images(
    sub: UUID, examination_id: UUID
) -> list[ExaminationImageResponse]:
    """한 검사의 촬영 영상 목록 + 서명 URL(FR-101). 게이트=라우터(order.read·5.9 판독의 재사용)."""
    rows = await db.fetch_examination_images(sub, examination_id)
    return [await _to_image_response(r) for r in rows]


async def perform_examination(
    sub: UUID, examination_id: UUID, payload: PerformExaminationBody
) -> ExaminationResponse:
    """촬영 수행(FR-101·FR-093) — ordered→performed. 영상≥1·장비 배정. 게이트=examination.perform.

    재수행 → 409 invalid_transition, 영상 0장 → 422 image_required, 미존재 404, 잘못된 장비 422
    (db/RPC raise). 응답 = 갱신된 검사 오더(performed_by/at·equipment_id 반영).
    """
    row = await db.call_perform_examination(
        sub, examination_id=examination_id, equipment_id=payload.equipment_id
    )
    return ExaminationResponse.model_validate(row)


async def list_reading_worklist(sub: UUID) -> list[ReadingWorklistItem]:
    """판독 워크리스트(FR-102) — 활성 내원의 미판독 영상검사. 게이트 examination.complete."""
    rows = await db.fetch_reading_worklist(sub)
    return [ReadingWorklistItem.model_validate(r) for r in rows]


async def complete_examination(
    sub: UUID, examination_id: UUID, payload: CompleteExaminationBody
) -> ExaminationResponse:
    """판독 완료(FR-102·FR-093) — performed→completed. 게이트 examination.complete.

    소견(필수)·결론(선택). 빈 소견 → 422 findings_required, 미수행/재완료 → 409 invalid_transition,
    lab → 422 not_imaging, 미존재 404. 결론 strip 후 빈→NULL. 응답 = 완료된 검사 오더.
    """
    findings = payload.findings  # Pydantic strip 완료 — 공백-only 면 빈 문자열.
    if not findings:
        raise AppError("판독 소견을 입력해 주세요.", code="findings_required", status_code=422)
    conclusion = (payload.reading_conclusion or "").strip() or None
    row = await db.call_complete_examination(
        sub,
        examination_id=examination_id,
        findings=findings,
        reading_conclusion=conclusion,
    )
    return ExaminationResponse.model_validate(row)


async def _to_image_response(row: dict[str, object]) -> ExaminationImageResponse:
    """db 영상 행(storage_path 포함) → 서명 URL 합성 응답(경로 비노출·URL 매 조회 생성)."""
    signed_url = await storage.create_signed_url(
        storage.EXAMINATION_IMAGES_BUCKET, str(row["storage_path"])
    )
    return ExaminationImageResponse.model_validate({**row, "signed_url": signed_url})
