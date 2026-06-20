"""직원 계정·재직상태 단위 테스트 (AC1·2·3·4) — 실 DB/Auth 없이 게이트·오케스트레이션 격리.

두 층위:
  · 엔드포인트(TestClient): get_current_user override + db.fetch_has_permission(게이트) +
    users_service.* monkeypatch → 강제·직렬화·상태코드·에러봉투만 검증.
  · 서비스 오케스트레이션(async): supabase_admin.* + db.* monkeypatch → Auth↔DB 순서·보상·ban 검증.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from supabase_auth.errors import AuthApiError, AuthWeakPasswordError

from app.api.v1 import admin
from app.core import db, supabase_admin
from app.core.errors import (
    AppError,
    ConflictError,
    NotFoundError,
    ServiceUnavailableError,
    init_error_handlers,
)
from app.core.security import CurrentUser, get_current_user
from app.schemas.users import EmploymentStatusUpdate, StaffCreate, StaffResponse
from app.services import users as users_service

_ADMIN_SUB = uuid.uuid4()
_FAKE_ADMIN = CurrentUser(sub=_ADMIN_SUB, aud="authenticated", role="authenticated", exp=9999999999)
_CREATE_BODY = {
    "employee_no": "EMP9001",
    "name": "간호사1",
    "email": "nurse1@pms.local",
    "password": "Staff1234",
    "role_code": "nurse",
}


def _staff(**over) -> dict:
    """StaffResponse 구성용 표준 직원 dict(=DB RETURNING 셰이프)."""
    base = {
        "id": uuid.uuid4(),
        "employee_no": "EMP9001",
        "name": "간호사1",
        "role_code": "nurse",
        "employment_status": "active",
        "license_no": None,
        "license_type": None,
        "phone": None,
        "hire_date": None,
        "department_id": None,
        "created_at": datetime(2026, 6, 20, tzinfo=UTC),
        "updated_at": datetime(2026, 6, 20, tzinfo=UTC),
    }
    base.update(over)
    return base


# ── 엔드포인트 층 ────────────────────────────────────────────────────────────────


def _build(monkeypatch: pytest.MonkeyPatch, *, allowed: bool = True, **service_fakes) -> TestClient:
    app = FastAPI()
    init_error_handlers(app)
    app.include_router(admin.router, prefix="/v1")
    app.dependency_overrides[get_current_user] = lambda: _FAKE_ADMIN

    async def _fake_has_permission(sub: uuid.UUID, code: str) -> bool:
        assert code == "user.manage"
        return allowed

    monkeypatch.setattr(db, "fetch_has_permission", _fake_has_permission)
    for name, fn in service_fakes.items():
        monkeypatch.setattr(users_service, name, fn)
    return TestClient(app)


def test_list_users_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _list(sub: uuid.UUID) -> list[StaffResponse]:
        return [
            StaffResponse.model_validate(_staff()),
            StaffResponse.model_validate(_staff(employee_no="EMP9002")),
        ]

    res = _build(monkeypatch, list_staff=_list).get("/v1/admin/users")
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 2
    assert body[0]["employee_no"] == "EMP9001"
    assert "email" not in body[0] and "password" not in body[0]  # PII 비노출


def test_create_user_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _create(sub: uuid.UUID, payload: StaffCreate) -> StaffResponse:
        assert payload.role_code == "nurse"
        return StaffResponse.model_validate(_staff())

    res = _build(monkeypatch, create_staff=_create).post("/v1/admin/users", json=_CREATE_BODY)
    assert res.status_code == 201
    assert res.json()["employment_status"] == "active"
    assert "email" not in res.json()


def test_create_user_forbidden(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _create(sub, payload):  # 도달하면 안 됨(게이트가 먼저 차단)
        raise AssertionError("게이트 통과 안 돼야 함")

    res = _build(monkeypatch, allowed=False, create_staff=_create).post(
        "/v1/admin/users", json=_CREATE_BODY
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


def test_create_user_email_taken(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _create(sub, payload):
        raise ConflictError("이미 사용 중인 이메일입니다.", code="email_taken")

    res = _build(monkeypatch, create_staff=_create).post("/v1/admin/users", json=_CREATE_BODY)
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "email_taken"


def test_create_user_employee_no_taken(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _create(sub, payload):
        raise ConflictError("이미 사용 중인 사번입니다.", code="employee_no_taken")

    res = _build(monkeypatch, create_staff=_create).post("/v1/admin/users", json=_CREATE_BODY)
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "employee_no_taken"


def test_create_user_password_too_short(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _create(sub, payload):
        raise AssertionError("검증 실패라 서비스 도달 안 됨")

    body = {**_CREATE_BODY, "password": "short"}  # < 8자
    res = _build(monkeypatch, create_staff=_create).post("/v1/admin/users", json=body)
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "validation_error"


def test_create_user_bad_email(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _create(sub, payload):
        raise AssertionError("검증 실패라 서비스 도달 안 됨")

    body = {**_CREATE_BODY, "email": "not-an-email"}
    res = _build(monkeypatch, create_staff=_create).post("/v1/admin/users", json=body)
    assert res.status_code == 422


def test_update_status_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _change(sub, user_id, payload: EmploymentStatusUpdate) -> StaffResponse:
        return StaffResponse.model_validate(_staff(employment_status=payload.employment_status))

    uid = uuid.uuid4()
    res = _build(monkeypatch, change_employment_status=_change).patch(
        f"/v1/admin/users/{uid}/employment-status", json={"employment_status": "on_leave"}
    )
    assert res.status_code == 200
    assert res.json()["employment_status"] == "on_leave"


def test_update_status_self_lockout(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _change(sub, user_id, payload):
        raise ConflictError("본인 계정은 비활성으로 변경할 수 없습니다.", code="self_lockout")

    uid = uuid.uuid4()
    res = _build(monkeypatch, change_employment_status=_change).patch(
        f"/v1/admin/users/{uid}/employment-status", json={"employment_status": "terminated"}
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "self_lockout"


def test_update_status_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _change(sub, user_id, payload):
        raise NotFoundError(detail={"user_id": str(user_id)})

    uid = uuid.uuid4()
    res = _build(monkeypatch, change_employment_status=_change).patch(
        f"/v1/admin/users/{uid}/employment-status", json={"employment_status": "active"}
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "not_found"


def test_update_status_invalid_value(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _change(sub, user_id, payload):
        raise AssertionError("검증 실패라 서비스 도달 안 됨")

    uid = uuid.uuid4()
    res = _build(monkeypatch, change_employment_status=_change).patch(
        f"/v1/admin/users/{uid}/employment-status", json={"employment_status": "fired"}
    )
    assert res.status_code == 422


# ── 서비스 오케스트레이션 층(async) ─────────────────────────────────────────────


async def test_create_staff_orchestration_success(monkeypatch: pytest.MonkeyPatch) -> None:
    new_uid = uuid.uuid4()
    deleted: list[uuid.UUID] = []

    async def _admin_create(email: str, password: str) -> uuid.UUID:
        assert email == "nurse1@pms.local"
        return new_uid

    async def _insert(sub, *, uid, **kw):
        assert uid == new_uid
        return _staff(id=uid, employee_no=kw["employee_no"])

    async def _del(uid):
        deleted.append(uid)

    monkeypatch.setattr(supabase_admin, "admin_create_user", _admin_create)
    monkeypatch.setattr(db, "insert_staff_profile", _insert)
    monkeypatch.setattr(supabase_admin, "admin_delete_user", _del)

    resp = await users_service.create_staff(_ADMIN_SUB, StaffCreate.model_validate(_CREATE_BODY))
    assert isinstance(resp, StaffResponse)
    assert resp.id == new_uid
    assert deleted == []  # 성공이면 보상 없음


async def test_create_staff_compensates_on_db_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    new_uid = uuid.uuid4()
    deleted: list[uuid.UUID] = []

    async def _admin_create(email, password):
        return new_uid

    async def _insert(sub, *, uid, **kw):
        raise ConflictError("이미 사용 중인 사번입니다.", code="employee_no_taken")

    async def _del(uid):
        deleted.append(uid)

    monkeypatch.setattr(supabase_admin, "admin_create_user", _admin_create)
    monkeypatch.setattr(db, "insert_staff_profile", _insert)
    monkeypatch.setattr(supabase_admin, "admin_delete_user", _del)

    with pytest.raises(ConflictError) as exc:
        await users_service.create_staff(_ADMIN_SUB, StaffCreate.model_validate(_CREATE_BODY))
    assert exc.value.code == "employee_no_taken"
    assert deleted == [new_uid]  # 보상으로 고아 Auth 사용자 삭제됨


async def test_change_status_bans_on_leave(monkeypatch: pytest.MonkeyPatch) -> None:
    uid = uuid.uuid4()
    bans: list[tuple[uuid.UUID, bool]] = []

    async def _update(sub, *, user_id, status):
        return _staff(id=user_id, employment_status=status)

    async def _ban(user_id, *, banned):
        bans.append((user_id, banned))

    monkeypatch.setattr(db, "update_employment_status", _update)
    monkeypatch.setattr(supabase_admin, "admin_set_ban", _ban)

    resp = await users_service.change_employment_status(
        _ADMIN_SUB, uid, EmploymentStatusUpdate(employment_status="on_leave")
    )
    assert resp.employment_status == "on_leave"
    assert bans == [(uid, True)]  # 휴직 → ban


async def test_change_status_unbans_on_active(monkeypatch: pytest.MonkeyPatch) -> None:
    uid = uuid.uuid4()
    bans: list[tuple[uuid.UUID, bool]] = []

    async def _update(sub, *, user_id, status):
        return _staff(id=user_id, employment_status=status)

    async def _ban(user_id, *, banned):
        bans.append((user_id, banned))

    monkeypatch.setattr(db, "update_employment_status", _update)
    monkeypatch.setattr(supabase_admin, "admin_set_ban", _ban)

    await users_service.change_employment_status(
        _ADMIN_SUB, uid, EmploymentStatusUpdate(employment_status="active")
    )
    assert bans == [(uid, False)]  # 복귀 → unban


async def test_change_status_ban_failure_is_soft(monkeypatch: pytest.MonkeyPatch) -> None:
    uid = uuid.uuid4()

    async def _update(sub, *, user_id, status):
        return _staff(id=user_id, employment_status=status)

    async def _ban(user_id, *, banned):
        raise ServiceUnavailableError()

    monkeypatch.setattr(db, "update_employment_status", _update)
    monkeypatch.setattr(supabase_admin, "admin_set_ban", _ban)

    # ban 실패해도 DB(접근 권위)는 갱신됐으므로 응답은 정상 반환(소프트 처리).
    resp = await users_service.change_employment_status(
        _ADMIN_SUB, uid, EmploymentStatusUpdate(employment_status="terminated")
    )
    assert resp.employment_status == "terminated"


# ── supabase_admin GoTrue 에러 매핑 층(async) ───────────────────────────────────
# 동기 admin 클라(`client.auth.admin.*`)를 가짜로 주입해 GoTrue 예외 → 봉투 매핑만 격리 검증.


class _FakeAdmin:
    def __init__(self, *, create_exc=None, create_result=None, ban_exc=None) -> None:
        self._create_exc = create_exc
        self._create_result = create_result
        self._ban_exc = ban_exc
        self.deleted: list[str] = []

    def create_user(self, attrs):  # noqa: ANN001
        if self._create_exc is not None:
            raise self._create_exc
        return self._create_result

    def delete_user(self, uid, should_soft_delete=False):  # noqa: ANN001
        self.deleted.append(uid)

    def update_user_by_id(self, uid, attrs):  # noqa: ANN001
        if self._ban_exc is not None:
            raise self._ban_exc
        return None


class _FakeClient:
    def __init__(self, admin_api: _FakeAdmin) -> None:
        self.auth = type("_Auth", (), {"admin": admin_api})()


def _patch_admin(monkeypatch: pytest.MonkeyPatch, fake: _FakeAdmin) -> None:
    monkeypatch.setattr(supabase_admin, "_get_admin_client", lambda: _FakeClient(fake))


async def test_admin_create_user_weak_password_maps_422(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_admin(monkeypatch, _FakeAdmin(create_exc=AuthWeakPasswordError("약함", 422, ["짧음"])))
    with pytest.raises(AppError) as exc:
        await supabase_admin.admin_create_user("a@b.local", "short")
    assert exc.value.status_code == 422
    assert exc.value.code == "weak_password"


async def test_admin_create_user_email_exists_maps_409(monkeypatch: pytest.MonkeyPatch) -> None:
    err = AuthApiError("User already registered", 422, "email_exists")
    _patch_admin(monkeypatch, _FakeAdmin(create_exc=err))
    with pytest.raises(ConflictError) as exc:
        await supabase_admin.admin_create_user("a@b.local", "Staff1234")
    assert exc.value.code == "email_taken"


async def test_admin_create_user_other_422_maps_auth_invalid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    err = AuthApiError("bad input", 422, "validation_failed")
    _patch_admin(monkeypatch, _FakeAdmin(create_exc=err))
    with pytest.raises(AppError) as exc:
        await supabase_admin.admin_create_user("a@b.local", "Staff1234")
    assert exc.value.status_code == 422
    assert exc.value.code == "auth_invalid"


async def test_admin_create_user_server_error_maps_503(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_admin(monkeypatch, _FakeAdmin(create_exc=AuthApiError("boom", 500, "internal")))
    with pytest.raises(ServiceUnavailableError):
        await supabase_admin.admin_create_user("a@b.local", "Staff1234")


async def test_admin_set_ban_failure_maps_503(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_admin(monkeypatch, _FakeAdmin(ban_exc=AuthApiError("nope", 500, "internal")))
    with pytest.raises(ServiceUnavailableError):
        await supabase_admin.admin_set_ban(uuid.uuid4(), banned=True)
