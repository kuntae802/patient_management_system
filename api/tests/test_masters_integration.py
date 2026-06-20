"""마스터(진료과·진료실) 통합 테스트 (Story 2.1 AC1·2·3·4) — 실 Supabase 토큰 + asyncpg + 0006.

로컬 스택(`supabase start` + `db reset`)/부트스트랩 계정이 없으면 skip. 검증:
  · AC1: admin 토큰으로 진료과·진료실 생성·수정 → 201/200 + 응답 모델
  · AC1: 코드 중복 → 409, 미존재 진료과 배정 → 422
  · AC2: 비활성(is_active=false) 후 행·명칭 보존(soft delete — 물리 삭제 아님)
  · AC3: 생성·수정·비활성이 audit_logs 에 actor=admin 으로 기록 + 감사 뷰어 조회
  · AC3: 비-master.manage(doctor) → 403
  · AC4: users.department_id FK(미존재 진료과 배정 차단) + authenticated 직접 SELECT(RLS 방어심층)

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
_DEPT_URL = "/v1/masters/departments"
_ROOM_URL = "/v1/masters/rooms"
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
    """관리자 auth uid(= 감사 actor). 변경 감사가 '관리자 본인'인지 단정하는 기준(AC3)."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'admin' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def client(admin_token: str):
    # with-블록 = lifespan 실행(asyncpg 풀 생성). 풀 없이는 권한 평가·쓰기 불가.
    with TestClient(app) as test_client:
        yield test_client


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _code(prefix: str) -> str:
    """실행 고유 코드(soft delete 잔존으로 인한 재실행 409 회피)."""
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def test_department_create_update_deactivate_with_audit(
    client: TestClient, admin_token: str, admin_id: str
) -> None:
    """AC1+AC2+AC3: 진료과 생성→수정→비활성, 행 보존, 변경이 actor=admin 으로 감사됨."""
    code = _code("DEPT")
    # 생성(AC1)
    created = client.post(
        _DEPT_URL, headers=_bearer(admin_token), json={"code": code, "name": "정형외과"}
    )
    assert created.status_code == 201, created.text
    dept = created.json()
    dept_id = dept["id"]
    assert dept["code"] == code and dept["is_active"] is True

    # 코드 중복 → 409(AC1)
    dup = client.post(
        _DEPT_URL, headers=_bearer(admin_token), json={"code": code, "name": "중복"}
    )
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "code_taken"

    # 수정(AC1)
    updated = client.patch(
        f"{_DEPT_URL}/{dept_id}",
        headers=_bearer(admin_token),
        json={"name": "정형외과(수정)", "description": "근골격"},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "정형외과(수정)"

    # 비활성(soft delete) → is_active=false, 행·명칭 보존(AC2)
    deactivated = client.patch(
        f"{_DEPT_URL}/{dept_id}/active",
        headers=_bearer(admin_token),
        json={"is_active": False},
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False
    assert deactivated.json()["name"] == "정형외과(수정)"  # 명칭 보존

    # 재활성도 가능(AC2)
    reactivated = client.patch(
        f"{_DEPT_URL}/{dept_id}/active",
        headers=_bearer(admin_token),
        json={"is_active": True},
    )
    assert reactivated.status_code == 200 and reactivated.json()["is_active"] is True

    # 변경이 actor=admin 으로 감사됨(AC3) — create 이벤트를 감사 뷰어로 확인
    audit = client.get(
        _AUDIT_URL,
        headers=_bearer(admin_token),
        params={"target_table": "departments", "action": "create", "page_size": 50},
    )
    assert audit.status_code == 200
    mine = [
        e
        for e in audit.json()["data"]
        if (e["actor_id"] or "").lower() == admin_id
        and (e["after_data"] or {}).get("code") == code
    ]
    assert mine, "진료과 생성이 actor=admin 으로 감사되지 않음(AC3 위반)"
    assert mine[0]["after_data"]["name"] == "정형외과"


def test_doctor_forbidden_on_writes(client: TestClient, doctor_token: str) -> None:
    """AC3: master.manage 미보유(doctor) → 진료과·진료실 쓰기 403."""
    dept = client.post(
        _DEPT_URL, headers=_bearer(doctor_token), json={"code": _code("X"), "name": "거부"}
    )
    assert dept.status_code == 403 and dept.json()["error"]["code"] == "forbidden"

    room = client.post(
        _ROOM_URL, headers=_bearer(doctor_token), json={"code": _code("X"), "name": "거부"}
    )
    assert room.status_code == 403


def test_room_create_and_invalid_department(client: TestClient, admin_token: str) -> None:
    """AC1: 진료실 생성(진료과 소속/무소속) + 미존재 진료과 → 422."""
    # 소속 진료과 준비
    dept = client.post(
        _DEPT_URL, headers=_bearer(admin_token), json={"code": _code("DEPT"), "name": "내과"}
    )
    dept_id = dept.json()["id"]

    # 진료과 소속 진료실 → 201
    room = client.post(
        _ROOM_URL,
        headers=_bearer(admin_token),
        json={"code": _code("R"), "name": "1진료실", "department_id": dept_id},
    )
    assert room.status_code == 201, room.text
    assert room.json()["department_id"] == dept_id

    # 무소속 진료실 → 201
    room2 = client.post(
        _ROOM_URL, headers=_bearer(admin_token), json={"code": _code("R"), "name": "공용실"}
    )
    assert room2.status_code == 201 and room2.json()["department_id"] is None

    # 미존재 진료과 배정 → 422 invalid_department(FK)
    bad = client.post(
        _ROOM_URL,
        headers=_bearer(admin_token),
        json={"code": _code("R"), "name": "오류실", "department_id": str(uuid.uuid4())},
    )
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_department"


def test_authenticated_direct_select_includes_inactive(
    client: TestClient, admin_token: str, psql: Psql
) -> None:
    """AC2 읽기경로: authenticated 직접 SELECT(RLS using(true))가 비활성 행도 노출(관리화면 백킹).

    전역 참조 데이터는 web 이 Supabase 직접조회한다(피커는 소비처가 is_active 필터). 비활성 진료과를
    하나 만들고, authenticated 역할로 select 시 그 행이 보이는지 확인(방어심층 읽기 경로)."""
    code = _code("DEPT")
    created = client.post(
        _DEPT_URL, headers=_bearer(admin_token), json={"code": code, "name": "비활성과"}
    )
    dept_id = created.json()["id"]
    client.patch(
        f"{_DEPT_URL}/{dept_id}/active", headers=_bearer(admin_token), json={"is_active": False}
    )
    # authenticated 역할 + 더미 JWT claims 로 RLS SELECT 평가(using(true) → 비활성도 보임).
    out = psql.scalar(
        "set local role authenticated;"
        "set local request.jwt.claims = '{\"sub\":\"00000000-0000-4000-8000-000000000001\","
        "\"role\":\"authenticated\"}';"
        f"select count(*) from public.departments where code = '{code}' and is_active = false;"
    )
    nums = [ln.strip() for ln in out.splitlines() if ln.strip().isdigit()]
    assert nums and nums[-1] == "1", f"authenticated 가 비활성 진료과를 못 봄(RLS): {out!r}"


def test_users_department_id_fk_enforced(psql: Psql) -> None:
    """AC4: users.department_id → departments FK. 미존재 진료과로 직원 배정 시 FK 위반."""
    err = psql.expect_error(
        "update public.users set department_id = '99999999-9999-4999-8999-999999999999' "
        "where employee_no = 'EMP0001';"
    ).lower()
    assert "foreign key" in err or "users_department_id_fkey" in err, (
        f"users.department_id FK 가 강제되지 않음(AC4): {err}"
    )


# ── Story 2.4: 참조 무결성 심화 ────────────────────────────────────────────────


def test_insert_room_to_inactive_department_blocked(
    client: TestClient, admin_token: str
) -> None:
    """AC3: 비활성 진료과로 진료실 **신규 생성** → 422 inactive_department(API 권위 차단)."""
    dept = client.post(
        _DEPT_URL, headers=_bearer(admin_token), json={"code": _code("DEPT"), "name": "곧비활성과"}
    )
    dept_id = dept.json()["id"]
    client.patch(
        f"{_DEPT_URL}/{dept_id}/active", headers=_bearer(admin_token), json={"is_active": False}
    )
    blocked = client.post(
        _ROOM_URL,
        headers=_bearer(admin_token),
        json={"code": _code("R"), "name": "차단실", "department_id": dept_id},
    )
    assert blocked.status_code == 422, blocked.text
    assert blocked.json()["error"]["code"] == "inactive_department"


def test_update_room_department_reassignment_integrity(
    client: TestClient, admin_token: str
) -> None:
    """AC3: 진료실 소속 변경 — 비활성 진료과로 **새 배정**은 422, **현 비활성 소속 유지**는 허용."""
    dept_a = client.post(
        _DEPT_URL, headers=_bearer(admin_token), json={"code": _code("DEPT"), "name": "A과"}
    ).json()
    dept_b = client.post(
        _DEPT_URL, headers=_bearer(admin_token), json={"code": _code("DEPT"), "name": "B과"}
    ).json()
    room = client.post(
        _ROOM_URL,
        headers=_bearer(admin_token),
        json={"code": _code("R"), "name": "이동실", "department_id": dept_a["id"]},
    ).json()

    # dept_b 비활성 → room 을 b 로 이동(새 배정) 시도 → 422 inactive_department
    client.patch(
        f"{_DEPT_URL}/{dept_b['id']}/active",
        headers=_bearer(admin_token),
        json={"is_active": False},
    )
    moved = client.patch(
        f"{_ROOM_URL}/{room['id']}",
        headers=_bearer(admin_token),
        json={"name": "이동실", "department_id": dept_b["id"]},
    )
    assert moved.status_code == 422, moved.text
    assert moved.json()["error"]["code"] == "inactive_department"

    # dept_a 비활성 → room 의 현 소속(a) 유지하며 이름만 변경 → 200(이탈 강요 금지)
    client.patch(
        f"{_DEPT_URL}/{dept_a['id']}/active",
        headers=_bearer(admin_token),
        json={"is_active": False},
    )
    kept = client.patch(
        f"{_ROOM_URL}/{room['id']}",
        headers=_bearer(admin_token),
        json={"name": "이동실(수정)", "department_id": dept_a["id"]},
    )
    assert kept.status_code == 200, kept.text
    assert kept.json()["name"] == "이동실(수정)"
    assert kept.json()["department_id"] == dept_a["id"]


def test_department_code_case_insensitive_unique(
    client: TestClient, admin_token: str
) -> None:
    """AC6: 코드 대소문자 무관 unique(0008) — 대문자 후 같은 값 소문자 → 409 code_taken."""
    base = _code("CIX").upper()
    first = client.post(
        _DEPT_URL, headers=_bearer(admin_token), json={"code": base, "name": "대문자과"}
    )
    assert first.status_code == 201, first.text
    dup = client.post(
        _DEPT_URL, headers=_bearer(admin_token), json={"code": base.lower(), "name": "소문자과"}
    )
    assert dup.status_code == 409, dup.text
    assert dup.json()["error"]["code"] == "code_taken"


def test_department_dependents_count(
    client: TestClient, admin_token: str, psql: Psql
) -> None:
    """AC4: 진료과 의존성 카운트 — 활성 진료실 수 + 재직 직원 수(service_role 가 users RLS 우회)."""
    dept_id = client.post(
        _DEPT_URL, headers=_bearer(admin_token), json={"code": _code("DEPT"), "name": "의존성과"}
    ).json()["id"]
    # 활성 진료실 2개 배정
    for n in ("r1", "r2"):
        client.post(
            _ROOM_URL,
            headers=_bearer(admin_token),
            json={"code": _code("R"), "name": n, "department_id": dept_id},
        )

    base = client.get(f"{_DEPT_URL}/{dept_id}/dependents", headers=_bearer(admin_token))
    assert base.status_code == 200, base.text
    assert base.json() == {"rooms": 2, "staff": 0}

    # 재직 직원 1명 임시 배정 → staff 1. 휴직도 재직이라 카운트됨을 함께 검증(퇴사만 제외).
    # try/finally 로 department_id·employment_status 원복(시드 오염 방지).
    # ⚠️ admin 제외: 호출 토큰 주체(admin)를 on_leave/terminated 로 바꾸면 자기 접근이 끊겨 403 이 된다.
    emp = psql.scalar(
        "select u.id::text from public.users u join public.roles r on r.id=u.role_id "
        "where u.employment_status='active' and r.code <> 'admin' limit 1"
    )
    if emp and emp not in ("", "\\N"):
        prev_dept = psql.scalar(
            f"select coalesce(department_id::text,'') from public.users where id='{emp}';"
        )
        try:
            psql.run(f"update public.users set department_id='{dept_id}' where id='{emp}';")
            active_staff = client.get(
                f"{_DEPT_URL}/{dept_id}/dependents", headers=_bearer(admin_token)
            )
            assert active_staff.json()["staff"] == 1, active_staff.text
            # 휴직 전환 → 여전히 그 진료과 소속이므로 재직 카운트에 포함(퇴사만 제외).
            psql.run(f"update public.users set employment_status='on_leave' where id='{emp}';")
            on_leave_staff = client.get(
                f"{_DEPT_URL}/{dept_id}/dependents", headers=_bearer(admin_token)
            )
            assert on_leave_staff.json()["staff"] == 1, on_leave_staff.text
            # 퇴사 전환 → 카운트 제외(더는 소속 아님).
            psql.run(f"update public.users set employment_status='terminated' where id='{emp}';")
            terminated_staff = client.get(
                f"{_DEPT_URL}/{dept_id}/dependents", headers=_bearer(admin_token)
            )
            assert terminated_staff.json()["staff"] == 0, terminated_staff.text
        finally:
            restore = f"'{prev_dept}'" if prev_dept and prev_dept not in ("", "\\N") else "null"
            psql.run(
                f"update public.users set department_id={restore}, "
                f"employment_status='active' where id='{emp}';"
            )


def test_department_dependents_forbidden_for_doctor(
    client: TestClient, doctor_token: str
) -> None:
    """AC7: 의존성 카운트도 master.manage 게이트 — doctor → 403(존재 여부 무관, 게이트 선평가)."""
    res = client.get(
        f"{_DEPT_URL}/{uuid.uuid4()}/dependents", headers=_bearer(doctor_token)
    )
    assert res.status_code == 403, res.text
