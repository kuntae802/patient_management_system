"""방사선 촬영 워크리스트·영상 업로드·촬영 수행·장비(Story 5.8) 통합 테스트 — TestClient + 0019.

실 Supabase 토큰 + 0015/0019 스키마 + Storage(examination-images 버킷). 로컬 스택/부트스트랩/
SUPABASE_SECRET_KEY(Storage) 없으면 skip. 검증:
  · AC1(FR-100): 촬영 워크리스트 — radiologist 200(imaging·ordered). reception/doctor 403.
  · AC2(FR-101): 영상 업로드 — radiologist 201(서명 URL·examination_images 1행). 잘못된 MIME 422·
        lab 오더 422 not_imaging·미존재 404·reception 403.
  · AC3(FR-103): 장비 목록 — order.read 보유(doctor·radiologist) 200(XR-01)·reception 403.
  · AC4(FR-101·FR-093): 촬영 수행 — 영상≥1 후 200(performed·performed_by=radiologist·equipment_id).
        영상 0장 422 image_required·재수행 409 invalid_transition·미존재 404·미존재 장비 422·
        reception/doctor(perform 무) 403.
  · AC5: 영상 조회 — 업로드 후 200(signed_url). doctor(order.read) 200.

⚠️ 생성행 잔존(db reset 초기화)·주민번호 매 실행 고유. ⚠️ DB 검증 = 'db reset && kong 대기 && pytest'.
"""

from __future__ import annotations

import itertools
import os
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from tests.conftest import Psql

_API = os.getenv("SUPABASE_API_URL", "http://127.0.0.1:54321")
_PUBLISHABLE = os.getenv(
    "SUPABASE_PUBLISHABLE_KEY", "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
)
_ENCOUNTERS_URL = "/v1/encounters"
_PATIENTS_URL = "/v1/patients"
_WORKLIST_URL = "/v1/radiology/worklist"
_EQUIPMENT_URL = "/v1/equipment"

# 1x1 투명 PNG(유효 영상 바이트 — Storage MIME/실파일 검증 통과).
_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da6360000002000154a24f3f0000000049454e44ae426082"
)


def _get_token(email: str, password: str) -> str | None:
    try:
        res = httpx.post(
            f"{_API}/auth/v1/token",
            params={"grant_type": "password"},
            headers={"apikey": _PUBLISHABLE, "Content-Type": "application/json"},
            json={"email": email, "password": password},
            timeout=10.0,
        )
    except httpx.HTTPError:
        return None
    if res.status_code != 200:
        return None
    return res.json().get("access_token")


@pytest.fixture(scope="module")
def admin_token() -> str:
    token = _get_token("admin@pms.local", "Staff1234")
    if not token:
        pytest.skip("로컬 Supabase 스택/부트스트랩 미가용 — supabase start && db reset 후 재실행")
    return token


@pytest.fixture(scope="module")
def radiologist_token() -> str:
    """촬영 골든 패스 — radiologist 는 order.read·examination.perform(5.1 seed grant) 보유."""
    token = _get_token("radiologist@pms.local", "Staff1234")
    if not token:
        pytest.skip("radiologist 부트스트랩 미가용 — 'supabase db reset'(seed 갱신) 후 재실행")
    return token


@pytest.fixture(scope="module")
def doctor_token() -> str:
    """오더 생성 + perform 403(examination.order 有·perform 無). order.read 有 → GET 200."""
    token = _get_token("doctor@pms.local", "Staff1234")
    if not token:
        pytest.skip("doctor 부트스트랩 미가용 — 'supabase db reset'(seed 갱신) 후 재실행")
    return token


@pytest.fixture(scope="module")
def reception_token() -> str:
    """403 baseline — reception 은 임상 오더 권한 0(order.read·examination.perform 미보유)."""
    token = _get_token("reception@pms.local", "Staff1234")
    if not token:
        pytest.skip("reception 부트스트랩 미가용 — 'supabase db reset'(seed 갱신) 후 재실행")
    return token


@pytest.fixture(scope="module")
def storage_ready() -> None:
    """Storage(supabase-py) 미구성 시 업로드 의존 테스트 skip(503 회피)."""
    if not settings.supabase_secret_key:
        pytest.skip("SUPABASE_SECRET_KEY 미설정 — Storage 업로드 불가(env 설정 후 재실행)")


@pytest.fixture(scope="module")
def client(admin_token: str):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def radiologist_id(psql: Psql) -> str:
    """radiologist auth uid — performed_by(수행 방사선사) 단언 기준."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'radiologist' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def dept_id(psql: Psql) -> str:
    """시드 진료과(내과 IM) id."""
    return psql.scalar("select id::text from public.departments where lower(code) = 'im' limit 1")


@pytest.fixture(scope="module")
def imaging_fee_id(psql: Psql) -> str:
    """시드 EDI 영상 행위(흉부 단순촬영 HA201) id — 영상검사 오더 fee_schedule_id."""
    return psql.scalar("select id::text from public.fee_schedules where code = 'HA201' limit 1")


@pytest.fixture(scope="module")
def equipment_id(psql: Psql) -> str:
    """시드 검사장비(제1일반촬영기 XR-01) id — 촬영 배정용."""
    return psql.scalar("select id::text from public.equipment where code = 'XR-01' limit 1")


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


_RRN_BASE = uuid.uuid4().int % 1_000_000
_rrn_seq = itertools.count()


def _unique_rrn() -> str:
    tail = (_RRN_BASE + next(_rrn_seq)) % 1_000_000
    return f"9001011{tail:06d}"


def _create_patient(client: TestClient, token: str) -> str:
    res = client.post(
        _PATIENTS_URL,
        json={
            "resident_no": _unique_rrn(),
            "name": "영상테스트환자",
            "phone": "010-1234-5678",
            "insurance_type": "health_insurance",
        },
        headers=_bearer(token),
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _walk_in(client: TestClient, admin_token: str, dept_id: str) -> str:
    """환자 + walk-in 내원(registered = 촬영 워크리스트 노출 대상) → 내원 id."""
    pid = _create_patient(client, admin_token)
    res = client.post(
        _ENCOUNTERS_URL,
        json={"patient_id": pid, "department_id": dept_id},
        headers=_bearer(admin_token),
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create_exam(
    client: TestClient, doctor_token: str, eid: str, fee_id: str, *, exam_type: str = "imaging"
) -> str:
    """doctor 가 검사·영상 오더 생성(examination.order) → examination id(status='ordered')."""
    res = client.post(
        f"{_ENCOUNTERS_URL}/{eid}/examinations",
        json={"exam_type": exam_type, "fee_schedule_id": fee_id},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _images_url(exam_id: str) -> str:
    return f"/v1/examinations/{exam_id}/images"


def _perform_url(exam_id: str) -> str:
    return f"/v1/examinations/{exam_id}/perform"


def _upload_image(client: TestClient, token: str, exam_id: str):
    return client.post(
        _images_url(exam_id),
        files={"file": ("scan.png", _PNG, "image/png")},
        headers=_bearer(token),
    )


# ── AC1: 촬영 워크리스트 ───────────────────────────────────────────────────────


def test_worklist_radiologist_shows_imaging_order(
    client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id
):
    """radiologist → 200 + 방금 만든 imaging·ordered 오더가 워크리스트에 노출(image_count=0)."""
    eid = _walk_in(client, admin_token, dept_id)
    exam_id = _create_exam(client, doctor_token, eid, imaging_fee_id)
    res = client.get(_WORKLIST_URL, headers=_bearer(radiologist_token))
    assert res.status_code == 200, res.text
    rows = res.json()
    mine = [r for r in rows if r["examination_id"] == exam_id]
    assert len(mine) == 1
    row = mine[0]
    assert row["status"] == "ordered"
    assert row["image_count"] == 0
    assert row["fee_name"]  # 검사 행위명 노출
    assert "resident_no" not in row  # 비-PII 투영


def test_worklist_reception_403(client, reception_token):
    res = client.get(_WORKLIST_URL, headers=_bearer(reception_token))
    assert res.status_code == 403


def test_worklist_doctor_403(client, doctor_token):
    """doctor 는 examination.perform 미보유 → 촬영 워크리스트 진입 403."""
    res = client.get(_WORKLIST_URL, headers=_bearer(doctor_token))
    assert res.status_code == 403


# ── AC3: 장비 목록 ─────────────────────────────────────────────────────────────


def test_equipment_radiologist_lists_seed(client, radiologist_token):
    res = client.get(_EQUIPMENT_URL, headers=_bearer(radiologist_token))
    assert res.status_code == 200, res.text
    codes = {e["code"] for e in res.json()}
    assert {"XR-01", "XR-02", "US-01"}.issubset(codes)
    xr = next(e for e in res.json() if e["code"] == "XR-01")
    assert xr["status"] == "available"
    assert xr["modality"] == "X-ray"


def test_equipment_doctor_200(client, doctor_token):
    """doctor 는 order.read 보유 → 장비 조회 200(판독 컨텍스트)."""
    res = client.get(_EQUIPMENT_URL, headers=_bearer(doctor_token))
    assert res.status_code == 200


def test_equipment_reception_403(client, reception_token):
    res = client.get(_EQUIPMENT_URL, headers=_bearer(reception_token))
    assert res.status_code == 403


# ── AC2: 영상 업로드 ───────────────────────────────────────────────────────────


def test_upload_golden_path(
    client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id, storage_ready
):
    """radiologist 업로드 → 201 + signed_url + examination_id + content_type. image_count↑ 확인."""
    eid = _walk_in(client, admin_token, dept_id)
    exam_id = _create_exam(client, doctor_token, eid, imaging_fee_id)
    res = _upload_image(client, radiologist_token, exam_id)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["examination_id"] == exam_id
    assert body["content_type"] == "image/png"
    assert body["signed_url"].startswith("http")
    assert "storage_path" not in body  # 경로 비노출(서명 URL만)
    # 워크리스트 image_count 반영
    wl = client.get(_WORKLIST_URL, headers=_bearer(radiologist_token)).json()
    row = next(r for r in wl if r["examination_id"] == exam_id)
    assert row["image_count"] == 1


def test_upload_invalid_mime_422(
    client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id, storage_ready
):
    eid = _walk_in(client, admin_token, dept_id)
    exam_id = _create_exam(client, doctor_token, eid, imaging_fee_id)
    res = client.post(
        _images_url(exam_id),
        files={"file": ("note.txt", b"not an image", "text/plain")},
        headers=_bearer(radiologist_token),
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_mime"


def test_upload_to_lab_exam_422(
    client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id, storage_ready
):
    """lab 오더에 업로드 → 422 not_imaging(영상검사 전용)."""
    eid = _walk_in(client, admin_token, dept_id)
    lab_exam = _create_exam(client, doctor_token, eid, imaging_fee_id, exam_type="lab")
    res = _upload_image(client, radiologist_token, lab_exam)
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "not_imaging"


def test_upload_nonexistent_404(client, radiologist_token, storage_ready):
    res = _upload_image(client, radiologist_token, str(uuid.uuid4()))
    assert res.status_code == 404


def test_upload_reception_403(
    client, admin_token, doctor_token, reception_token, dept_id, imaging_fee_id
):
    eid = _walk_in(client, admin_token, dept_id)
    exam_id = _create_exam(client, doctor_token, eid, imaging_fee_id)
    res = _upload_image(client, reception_token, exam_id)
    assert res.status_code == 403


def test_upload_to_performed_exam_409(
    client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id, storage_ready
):
    """이미 수행된 검사에 업로드 → 409 examination_locked(촬영 수행 후 영상 추가 차단)."""
    eid = _walk_in(client, admin_token, dept_id)
    exam_id = _create_exam(client, doctor_token, eid, imaging_fee_id)
    assert _upload_image(client, radiologist_token, exam_id).status_code == 201
    perf = client.post(_perform_url(exam_id), json={}, headers=_bearer(radiologist_token))
    assert perf.status_code == 200, perf.text
    again = _upload_image(client, radiologist_token, exam_id)
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "examination_locked"


# ── AC5: 영상 조회(서명 URL) ───────────────────────────────────────────────────


def test_list_images_returns_signed_urls(
    client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id, storage_ready
):
    eid = _walk_in(client, admin_token, dept_id)
    exam_id = _create_exam(client, doctor_token, eid, imaging_fee_id)
    _upload_image(client, radiologist_token, exam_id)
    _upload_image(client, radiologist_token, exam_id)
    res = client.get(_images_url(exam_id), headers=_bearer(radiologist_token))
    assert res.status_code == 200, res.text
    imgs = res.json()
    assert len(imgs) == 2
    assert all(i["signed_url"].startswith("http") for i in imgs)


def test_list_images_doctor_200(
    client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id, storage_ready
):
    """doctor(order.read·5.9 판독의)도 영상 조회 가능(perform 아닌 order.read 게이트)."""
    eid = _walk_in(client, admin_token, dept_id)
    exam_id = _create_exam(client, doctor_token, eid, imaging_fee_id)
    _upload_image(client, radiologist_token, exam_id)
    res = client.get(_images_url(exam_id), headers=_bearer(doctor_token))
    assert res.status_code == 200
    assert len(res.json()) == 1


# ── AC4: 촬영 수행(영상≥1·장비 배정·재수행 차단) ──────────────────────────────


def test_perform_golden_path(
    client,
    admin_token,
    doctor_token,
    radiologist_token,
    radiologist_id,
    dept_id,
    imaging_fee_id,
    equipment_id,
    storage_ready,
):
    """영상 1장 업로드 후 수행 → 200·status=performed·performed_by=radiologist·equipment_id 배정."""
    eid = _walk_in(client, admin_token, dept_id)
    exam_id = _create_exam(client, doctor_token, eid, imaging_fee_id)
    _upload_image(client, radiologist_token, exam_id)
    res = client.post(
        _perform_url(exam_id),
        json={"equipment_id": equipment_id},
        headers=_bearer(radiologist_token),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "performed"
    assert body["performed_by"] == radiologist_id
    assert body["performed_at"] is not None
    assert body["equipment_id"] == equipment_id


def test_perform_without_image_422(
    client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id, storage_ready
):
    """영상 0장 수행 → 422 image_required(누락 0 디텍터)."""
    eid = _walk_in(client, admin_token, dept_id)
    exam_id = _create_exam(client, doctor_token, eid, imaging_fee_id)
    res = client.post(_perform_url(exam_id), json={}, headers=_bearer(radiologist_token))
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "image_required"


def test_perform_reperform_409(
    client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id, storage_ready
):
    """재수행(이미 performed) → 409 invalid_transition(상태머신 최종선, FR-093)."""
    eid = _walk_in(client, admin_token, dept_id)
    exam_id = _create_exam(client, doctor_token, eid, imaging_fee_id)
    _upload_image(client, radiologist_token, exam_id)
    first = client.post(_perform_url(exam_id), json={}, headers=_bearer(radiologist_token))
    assert first.status_code == 200, first.text
    again = client.post(_perform_url(exam_id), json={}, headers=_bearer(radiologist_token))
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "invalid_transition"


def test_perform_nonexistent_404(client, radiologist_token, storage_ready):
    res = client.post(_perform_url(str(uuid.uuid4())), json={}, headers=_bearer(radiologist_token))
    assert res.status_code == 404


def test_perform_invalid_equipment_422(
    client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id, storage_ready
):
    """미존재 장비 배정 → 422 invalid_equipment(영상≥1 통과 후 장비 검증)."""
    eid = _walk_in(client, admin_token, dept_id)
    exam_id = _create_exam(client, doctor_token, eid, imaging_fee_id)
    _upload_image(client, radiologist_token, exam_id)
    res = client.post(
        _perform_url(exam_id),
        json={"equipment_id": str(uuid.uuid4())},
        headers=_bearer(radiologist_token),
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_equipment"


def test_perform_reception_403(
    client, admin_token, doctor_token, reception_token, dept_id, imaging_fee_id
):
    eid = _walk_in(client, admin_token, dept_id)
    exam_id = _create_exam(client, doctor_token, eid, imaging_fee_id)
    res = client.post(_perform_url(exam_id), json={}, headers=_bearer(reception_token))
    assert res.status_code == 403


def test_perform_doctor_403(client, admin_token, doctor_token, dept_id, imaging_fee_id):
    """doctor 는 examination.perform 미보유 → 촬영 수행 403(order/complete 권한과 분리)."""
    eid = _walk_in(client, admin_token, dept_id)
    exam_id = _create_exam(client, doctor_token, eid, imaging_fee_id)
    res = client.post(_perform_url(exam_id), json={}, headers=_bearer(doctor_token))
    assert res.status_code == 403


# ══════════════════════════════════════════════════════════════════════════════
# 영상 판독 · 검사 오더 완료(Story 5.9 / FR-102) — performed→completed, 의사 판독의 겸임
# ══════════════════════════════════════════════════════════════════════════════
# 검증:
#   · AC1: 판독 워크리스트 — doctor 200(imaging·performed·performed_by_name·image_count·비-PII).
#         radiologist(complete 무) 403·reception 403.
#   · AC3·AC4: 판독 완료 — doctor 200(completed·completed_by·소견/결론 반영·워크리스트 제거).
#         빈 소견 422 findings_required·미수행 409·재완료 409·lab 422 not_imaging·미존재 404·
#         radiologist 403·reception 403.
#   · AC6: 감사 — 판독 완료 후 examinations update 의 findings 가 감사 응답에서 마스킹.

_READING_WORKLIST_URL = "/v1/radiology/reading-worklist"
_AUDIT_URL = "/v1/admin/audit-logs"
_MASK_DISPLAY = "●●●● (마스킹됨)"  # services/audit.py _MASK_DISPLAY 거울


@pytest.fixture(scope="module")
def doctor_id(psql: Psql) -> str:
    """doctor auth uid — completed_by(판독의) 단언 기준."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'doctor' limit 1"
    ).lower()


def _complete_url(exam_id: str) -> str:
    return f"/v1/examinations/{exam_id}/complete"


def _performed_exam(
    client: TestClient,
    admin_token: str,
    doctor_token: str,
    radiologist_token: str,
    dept_id: str,
    fee_id: str,
) -> str:
    """검사 오더 → 영상 업로드 → 촬영 수행(performed) → 판독 대기 검사 id. (storage 필요)"""
    eid = _walk_in(client, admin_token, dept_id)
    exam_id = _create_exam(client, doctor_token, eid, fee_id)
    assert _upload_image(client, radiologist_token, exam_id).status_code == 201
    perf = client.post(_perform_url(exam_id), json={}, headers=_bearer(radiologist_token))
    assert perf.status_code == 200, perf.text
    return exam_id


# ── AC1: 판독 워크리스트(performed 미판독) ─────────────────────────────────────


def test_reading_worklist_doctor_shows_performed(
    client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id, storage_ready
):
    """doctor → 200 + 방금 수행된 imaging 오더가 판독 워크리스트에 노출(수행자명·image_count)."""
    exam_id = _performed_exam(
        client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id
    )
    res = client.get(_READING_WORKLIST_URL, headers=_bearer(doctor_token))
    assert res.status_code == 200, res.text
    mine = [r for r in res.json() if r["examination_id"] == exam_id]
    assert len(mine) == 1
    row = mine[0]
    assert row["status"] == "performed"
    assert row["image_count"] == 1
    assert row["performed_by_name"]  # 수행자(방사선사) 추적 라인
    assert row["fee_name"]
    assert "resident_no" not in row  # 비-PII 투영


def test_reading_worklist_radiologist_403(client, radiologist_token):
    """radiologist 는 examination.complete 미보유 → 판독 워크리스트 진입 403."""
    res = client.get(_READING_WORKLIST_URL, headers=_bearer(radiologist_token))
    assert res.status_code == 403


def test_reading_worklist_reception_403(client, reception_token):
    res = client.get(_READING_WORKLIST_URL, headers=_bearer(reception_token))
    assert res.status_code == 403


# ── AC3·AC4·AC5: 판독 완료 ──────────────────────────────────────────────────


def test_complete_golden_path(
    client,
    admin_token,
    doctor_token,
    radiologist_token,
    doctor_id,
    dept_id,
    imaging_fee_id,
    storage_ready,
):
    """소견+결론 기록 → 200·status=completed·completed_by=doctor·소견/결론 반영·워크리스트 제거."""
    exam_id = _performed_exam(
        client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id
    )
    res = client.post(
        _complete_url(exam_id),
        json={"findings": "양측 폐야 침윤 소견 없음.", "reading_conclusion": "정상 흉부."},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "completed"
    assert body["completed_by"] == doctor_id
    assert body["completed_at"] is not None
    assert body["findings"] == "양측 폐야 침윤 소견 없음."
    assert body["reading_conclusion"] == "정상 흉부."
    # AC5: 완료(completed) → 판독 워크리스트(performed)에서 제거
    wl = client.get(_READING_WORKLIST_URL, headers=_bearer(doctor_token)).json()
    assert all(r["examination_id"] != exam_id for r in wl)


def test_complete_optional_conclusion_null(
    client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id, storage_ready
):
    """결론 생략(또는 공백) → reading_conclusion NULL·완료 성공(소견만 필수)."""
    exam_id = _performed_exam(
        client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id
    )
    res = client.post(
        _complete_url(exam_id),
        json={"findings": "이상 소견 없음.", "reading_conclusion": "   "},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 200, res.text
    assert res.json()["reading_conclusion"] is None


def test_complete_blank_findings_422(
    client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id, storage_ready
):
    """소견 공백-only → 422 findings_required(소견 없는 판독 완료 차단)."""
    exam_id = _performed_exam(
        client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id
    )
    res = client.post(
        _complete_url(exam_id), json={"findings": "   "}, headers=_bearer(doctor_token)
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "findings_required"


def test_complete_not_performed_409(client, admin_token, doctor_token, dept_id, imaging_fee_id):
    """미수행(ordered) 검사 판독 시도 → 409 invalid_transition(수행 전 완료 차단·storage 불요)."""
    eid = _walk_in(client, admin_token, dept_id)
    exam_id = _create_exam(client, doctor_token, eid, imaging_fee_id)  # status='ordered'
    res = client.post(
        _complete_url(exam_id), json={"findings": "성급한 판독"}, headers=_bearer(doctor_token)
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "invalid_transition"


def test_complete_recomplete_409(
    client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id, storage_ready
):
    """재완료(이미 completed) → 409 invalid_transition(종결 상태·FR-093)."""
    exam_id = _performed_exam(
        client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id
    )
    first = client.post(
        _complete_url(exam_id), json={"findings": "정상."}, headers=_bearer(doctor_token)
    )
    assert first.status_code == 200, first.text
    again = client.post(
        _complete_url(exam_id), json={"findings": "재판독 시도."}, headers=_bearer(doctor_token)
    )
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "invalid_transition"


def test_complete_lab_422_not_imaging(client, admin_token, doctor_token, dept_id, imaging_fee_id):
    """lab 오더 판독 시도 → 422 not_imaging(영상검사 전용·storage 불요)."""
    eid = _walk_in(client, admin_token, dept_id)
    lab_exam = _create_exam(client, doctor_token, eid, imaging_fee_id, exam_type="lab")
    res = client.post(
        _complete_url(lab_exam), json={"findings": "판독"}, headers=_bearer(doctor_token)
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "not_imaging"


def test_complete_nonexistent_404(client, doctor_token):
    res = client.post(
        _complete_url(str(uuid.uuid4())), json={"findings": "판독"}, headers=_bearer(doctor_token)
    )
    assert res.status_code == 404


def test_complete_radiologist_403(
    client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id, storage_ready
):
    """radiologist(examination.complete 무) → 판독 완료 403(perform 과 complete 권한 분리)."""
    exam_id = _performed_exam(
        client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id
    )
    res = client.post(
        _complete_url(exam_id), json={"findings": "판독"}, headers=_bearer(radiologist_token)
    )
    assert res.status_code == 403


def test_complete_reception_403(
    client,
    admin_token,
    doctor_token,
    radiologist_token,
    reception_token,
    dept_id,
    imaging_fee_id,
    storage_ready,
):
    """reception(임상 권한 0) → 판독 완료 403."""
    exam_id = _performed_exam(
        client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id
    )
    res = client.post(
        _complete_url(exam_id), json={"findings": "판독"}, headers=_bearer(reception_token)
    )
    assert res.status_code == 403


# ── AC6: 판독 소견 감사 마스킹 ─────────────────────────────────────────────────


def test_complete_findings_masked_in_audit(
    client,
    admin_token,
    doctor_token,
    radiologist_token,
    dept_id,
    imaging_fee_id,
    storage_ready,
):
    """판독 완료 후 examinations update 감사의 findings 가 응답에서 마스킹(평문 누출 0)."""
    secret = "환자 식별 가능 비밀 소견 ZZZ123"
    exam_id = _performed_exam(
        client, admin_token, doctor_token, radiologist_token, dept_id, imaging_fee_id
    )
    done = client.post(
        _complete_url(exam_id),
        json={"findings": secret, "reading_conclusion": "결론 비밀 YYY"},
        headers=_bearer(doctor_token),
    )
    assert done.status_code == 200, done.text
    res = client.get(
        _AUDIT_URL,
        headers=_bearer(admin_token),
        params={"target_table": "examinations", "target_id": exam_id, "action": "update"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    entries = [e for e in body["data"] if e.get("after_data")]
    # findings 를 담은 스냅샷이 ≥1(소견 same-status UPDATE) — 모두 마스킹.
    masked = [e for e in entries if "findings" in e["after_data"]]
    assert masked, "findings 컬럼을 담은 examinations update 감사가 없음"
    for e in masked:
        assert e["after_data"]["findings"] == _MASK_DISPLAY
        if e["after_data"].get("reading_conclusion") is not None:
            assert e["after_data"]["reading_conclusion"] == _MASK_DISPLAY
    # 평문 소견·결론이 응답 어디에도 없어야(마스킹 권위).
    import json as _json

    assert secret not in _json.dumps(body, ensure_ascii=False)
    assert "YYY" not in _json.dumps(body, ensure_ascii=False)
