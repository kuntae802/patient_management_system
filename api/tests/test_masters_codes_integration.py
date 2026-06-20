"""코드 마스터(KCD 진단·EDI 수가·약품) 통합 테스트 (Story 2.2 AC1·2·3·4) — 실 토큰 + asyncpg + 0007.

로컬 스택(`supabase start` + `db reset`)/부트스트랩 계정이 없으면 skip. 검증:
  · AC1: admin 토큰으로 진단·수가·약품 생성·수정 → 201/200 + 응답 모델(유효기간·금액)
  · AC1: 코드 중복 → 409
  · AC3: 비활성(is_active=false) 후 행·명칭 보존(soft delete — 물리 삭제 아님)
  · AC3: 만료(effective_to 과거) 코드도 authenticated 직접 SELECT 에 노출(참조 보존·RLS)
  · AC4: 생성이 audit_logs 에 actor=admin 으로 기록
  · AC4: 비-master.manage(doctor) → 403

⚠️ 생성행은 잔존(soft delete만, db reset 이 초기화)하므로 code 는 매 실행 고유값(uuid)으로 둔다.
"""

from __future__ import annotations

import os
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import Psql

_API = os.getenv("SUPABASE_API_URL", "http://127.0.0.1:54321")
_PUBLISHABLE = os.getenv(
    "SUPABASE_PUBLISHABLE_KEY", "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
)
_DX_URL = "/v1/masters/diagnoses"
_FEE_URL = "/v1/masters/fee-schedules"
_DRUG_URL = "/v1/masters/drugs"
_AUDIT_URL = "/v1/admin/audit-logs"


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
def doctor_token() -> str:
    token = _get_token("doctor@pms.local", "Staff1234")
    if not token:
        pytest.skip("doctor 부트스트랩 계정 미가용 — 'supabase db reset'(seed 갱신) 후 재실행")
    return token


@pytest.fixture(scope="module")
def admin_id(psql: Psql) -> str:
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'admin' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def client(admin_token: str):
    with TestClient(app) as test_client:
        yield test_client


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _code(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def test_diagnosis_create_update_deactivate_with_audit(
    client: TestClient, admin_token: str, admin_id: str
) -> None:
    """AC1+AC3+AC4: KCD 진단 생성→수정→비활성, 행 보존, 변경이 actor=admin 으로 감사됨."""
    code = _code("I10")
    created = client.post(
        _DX_URL,
        headers=_bearer(admin_token),
        json={"code": code, "name": "본태성 고혈압", "effective_from": "2026-01-01"},
    )
    assert created.status_code == 201, created.text
    dx = created.json()
    dx_id = dx["id"]
    assert dx["code"] == code and dx["effective_from"] == "2026-01-01" and dx["is_active"] is True

    # 코드 중복 → 409(AC1)
    dup = client.post(
        _DX_URL,
        headers=_bearer(admin_token),
        json={"code": code, "name": "중복", "effective_from": "2026-01-01"},
    )
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "code_taken"

    # 수정(AC1) — 만료일 설정
    updated = client.patch(
        f"{_DX_URL}/{dx_id}",
        headers=_bearer(admin_token),
        json={
            "name": "본태성 고혈압(수정)",
            "effective_from": "2026-01-01",
            "effective_to": "2027-12-31",
        },
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body["name"] == "본태성 고혈압(수정)" and body["effective_to"] == "2027-12-31"

    # 비활성(soft delete) → is_active=false, 명칭 보존(AC3)
    deactivated = client.patch(
        f"{_DX_URL}/{dx_id}/active", headers=_bearer(admin_token), json={"is_active": False}
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False
    assert deactivated.json()["name"] == "본태성 고혈압(수정)"  # 명칭 보존

    # 재활성(AC3)
    reactivated = client.patch(
        f"{_DX_URL}/{dx_id}/active", headers=_bearer(admin_token), json={"is_active": True}
    )
    assert reactivated.status_code == 200 and reactivated.json()["is_active"] is True

    # 생성이 actor=admin 으로 감사됨(AC4)
    audit = client.get(
        _AUDIT_URL,
        headers=_bearer(admin_token),
        params={"target_table": "diagnoses", "action": "create", "page_size": 50},
    )
    assert audit.status_code == 200
    mine = [
        e
        for e in audit.json()["data"]
        if (e["actor_id"] or "").lower() == admin_id
        and (e["after_data"] or {}).get("code") == code
    ]
    assert mine, "진단 생성이 actor=admin 으로 감사되지 않음(AC4 위반)"


def test_fee_schedule_and_drug_create(client: TestClient, admin_token: str) -> None:
    """AC1: 수가(금액)·약품(주성분·단위) 생성 201 + 응답 필드."""
    fee = client.post(
        _FEE_URL,
        headers=_bearer(admin_token),
        json={
            "code": _code("AA"),
            "name": "재진 진찰료",
            "amount_krw": 12000,
            "category": "진찰료",
            "effective_from": "2026-01-01",
        },
    )
    assert fee.status_code == 201, fee.text
    assert fee.json()["amount_krw"] == 12000 and fee.json()["category"] == "진찰료"

    drug = client.post(
        _DRUG_URL,
        headers=_bearer(admin_token),
        json={
            "code": _code("D"),
            "name": "타이레놀정 500mg",
            "ingredient_code": "120901ATB",
            "unit": "정",
            "effective_from": "2026-01-01",
        },
    )
    assert drug.status_code == 201, drug.text
    assert drug.json()["ingredient_code"] == "120901ATB" and drug.json()["unit"] == "정"


def test_doctor_forbidden_on_code_master_writes(
    client: TestClient, doctor_token: str
) -> None:
    """AC4: master.manage 미보유(doctor) → 코드 마스터 쓰기 403."""
    res = client.post(
        _DX_URL,
        headers=_bearer(doctor_token),
        json={"code": _code("X"), "name": "거부", "effective_from": "2026-01-01"},
    )
    assert res.status_code == 403 and res.json()["error"]["code"] == "forbidden"


def test_expired_code_preserved_in_direct_select(
    client: TestClient, admin_token: str, psql: Psql
) -> None:
    """AC3: 만료(effective_to 과거)·활성 코드도 authenticated 직접 SELECT 에 노출(참조 보존·RLS).

    만료된 코드는 소비처 피커에선 제외되나, 과거 기록 조회를 위해 행·명칭은 보존되고 직접조회로
    읽을 수 있어야 한다(관리화면·참조 해석 백킹)."""
    code = _code("EXP")
    created = client.post(
        _DX_URL,
        headers=_bearer(admin_token),
        json={
            "code": code,
            "name": "만료진단",
            "effective_from": "2020-01-01",
            "effective_to": "2020-12-31",
        },
    )
    assert created.status_code == 201, created.text

    # authenticated 역할 + 더미 JWT claims 로 RLS SELECT 평가(using(true) → 만료 행도 보임).
    out = psql.scalar(
        "set local role authenticated;"
        "set local request.jwt.claims = '{\"sub\":\"00000000-0000-4000-8000-000000000001\","
        "\"role\":\"authenticated\"}';"
        f"select count(*) from public.diagnoses where code = '{code}' "
        "and effective_to < current_date;"
    )
    nums = [ln.strip() for ln in out.splitlines() if ln.strip().isdigit()]
    assert nums and nums[-1] == "1", f"authenticated 가 만료 진단을 못 봄(RLS 참조 보존): {out!r}"
