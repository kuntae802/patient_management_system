"""내원 접수(Story 4.2 AC1·2·3) 통합 테스트 — walk-in 생성 + register RPC 소비 + SQLSTATE 매핑.

실 Supabase 토큰 + FastAPI TestClient + 0010 상태머신. 로컬 스택/부트스트랩 없으면 skip. 검증:
  · AC1: walk-in 생성 → 201 + encounter_no(8자리) + status='registered' + registered_at·created_by
         충전(4.1 handoff: RPC 미경유 직접 INSERT 라 NULL 로 남던 컬럼) + DB 영속 + 감사(create)
  · AC1: 미존재/비활성 환자·진료과 → 404/422(앱 동일 트랜잭션 검증)
  · AC2: register RPC(scheduled→registered) → 200 / 재호출 409 invalid_transition / 미존재 404
         (PT409→409·PT404→404 SQLSTATE 매핑 = core/db 도입 인프라)
  · AC3: encounter.register 미보유(doctor) → 403 / 보유(reception seed grant) → 201(골든 패스)

⚠️ 생성행은 잔존(db reset 이 초기화). 주민번호는 매 실행 고유값(세션 카운터, patients 테스트 동형).
"""

from __future__ import annotations

import itertools
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
_ENCOUNTERS_URL = "/v1/encounters"
_PATIENTS_URL = "/v1/patients"


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
        pytest.skip("doctor 부트스트랩 미가용 — 'supabase db reset'(seed 갱신) 후 재실행")
    return token


@pytest.fixture(scope="module")
def reception_token() -> str:
    token = _get_token("reception@pms.local", "Staff1234")
    if not token:
        pytest.skip("reception 부트스트랩 미가용 — 'supabase db reset'(seed 갱신) 후 재실행")
    return token


@pytest.fixture(scope="module")
def nurse_token() -> str:
    """무권한 baseline(Story 4.4) — nurse 는 encounter.* 미보유(간호 권한=Epic 5).

    doctor 가 encounter.read/start 를 받은 뒤 "권한 미보유 403" 검증 계정을 대체한다."""
    token = _get_token("nurse@pms.local", "Staff1234")
    if not token:
        pytest.skip("nurse 부트스트랩 미가용 — 'supabase db reset'(seed 갱신) 후 재실행")
    return token


@pytest.fixture(scope="module")
def client(admin_token: str):
    # with-블록 = lifespan 실행(asyncpg 풀 생성). 풀 없이는 권한 평가·쓰기 불가.
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def admin_id(psql: Psql) -> str:
    """관리자 auth uid — created_by(접수자) 단언 기준."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'admin' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def doctor_id(psql: Psql) -> str:
    """doctor auth uid — start_consult 가 세팅하는 doctor_id(=호출자) 단언 기준(Story 4.4)."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'doctor' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def dept_id(psql: Psql) -> str:
    """시드 진료과(내과 IM) id — 접수 대상 진료과(대기열 그룹)."""
    return psql.scalar("select id::text from public.departments where lower(code) = 'im' limit 1")


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# 고유 주민번호(patients 테스트 전략 — 누적 충돌 회피). YYMMDD=900101·성별 1, 꼬리=세션 base+카운터.
_RRN_BASE = uuid.uuid4().int % 1_000_000
_rrn_seq = itertools.count()


def _unique_rrn() -> str:
    tail = (_RRN_BASE + next(_rrn_seq)) % 1_000_000
    return f"9001011{tail:06d}"


def _create_patient(client: TestClient, token: str) -> str:
    """접수 대상 환자 생성(admin — 원무는 patient.create 없음). 활성 환자 id 반환."""
    res = client.post(
        _PATIENTS_URL,
        json={
            "resident_no": _unique_rrn(),
            "name": "접수테스트환자",
            "phone": "010-1234-5678",
            "insurance_type": "health_insurance",
        },
        headers=_bearer(token),
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _insert_scheduled(psql: Psql, pid: str, dept_id: str) -> str:
    """service_role 직접 INSERT 로 scheduled 내원 생성(0010 초기상태 가드 허용 — 예약 도착 모사).

    MVP 에 appointments(Epic 6)가 없어 register RPC 의 scheduled→registered 전이를 검증할 행을
    여기서 만든다(예약 환자 도착 상황 모사). CTE 로 감싸 SELECT 로 반환 — psql -tA 의 INSERT 는
    'INSERT 0 1' 명령 태그도 함께 출력하므로 returning 직접 사용 시 scalar 가 오염된다."""
    return psql.scalar(
        "with new_enc as ("
        "insert into public.encounters(patient_id, department_id, visit_type, status) "
        f"values ('{pid}', '{dept_id}', 'reserved', 'scheduled') returning id"
        ") select id from new_enc;"
    )


# ── AC1: walk-in 생성 + handoff 청산 + 영속·감사 ──────────────────────────────────


def test_create_walk_in_encounter(client, admin_token, admin_id, dept_id):
    """walk-in 접수 → 201 + status='registered'·visit_type='walk_in'·encounter_no(8자리) +
    registered_at·created_by 충전(4.1 handoff)."""
    pid = _create_patient(client, admin_token)
    res = client.post(
        _ENCOUNTERS_URL,
        json={"patient_id": pid, "department_id": dept_id},
        headers=_bearer(admin_token),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "registered"
    assert body["visit_type"] == "walk_in"
    assert body["patient_id"] == pid
    assert body["department_id"] == dept_id
    assert body["encounter_no"].isdigit() and len(body["encounter_no"]) == 8
    # 4.1 handoff 청산: RPC 미경유 직접 INSERT 라 4.1 이 NULL 로 두던 두 컬럼을 충전.
    assert body["registered_at"] is not None
    assert body["created_by"] == admin_id


def test_create_encounter_persists_and_audited(client, admin_token, dept_id, psql):
    """DB 영속(status·visit_type) + INSERT 감사(action='create', 0010 trg_encounters_audit)."""
    pid = _create_patient(client, admin_token)
    res = client.post(
        _ENCOUNTERS_URL,
        json={"patient_id": pid, "department_id": dept_id},
        headers=_bearer(admin_token),
    )
    assert res.status_code == 201, res.text
    eid = res.json()["id"]
    persisted = psql.scalar(
        f"select status || '|' || visit_type from public.encounters where id = '{eid}'"
    )
    assert persisted == "registered|walk_in", persisted
    audited = psql.scalar(
        "select count(*) from public.audit_logs "
        f"where target_table = 'encounters' and target_id = '{eid}' and action = 'create'"
    )
    assert int(audited) >= 1, "walk-in INSERT 가 감사 로그에 기록되지 않음"


# ── AC1: 검증 실패(미존재·비활성·필수누락) ────────────────────────────────────────


def test_create_encounter_missing_patient_422(client, admin_token, dept_id):
    """patient_id 누락 → 422(Pydantic 검증, 권한 평가 후 본문 검증)."""
    res = client.post(
        _ENCOUNTERS_URL, json={"department_id": dept_id}, headers=_bearer(admin_token)
    )
    assert res.status_code == 422, res.text


def test_create_encounter_nonexistent_patient_404(client, admin_token, dept_id):
    """미존재 환자 → 404(db 존재 검증, FK 위반 전 명시)."""
    res = client.post(
        _ENCOUNTERS_URL,
        json={"patient_id": str(uuid.uuid4()), "department_id": dept_id},
        headers=_bearer(admin_token),
    )
    assert res.status_code == 404, res.text


def test_create_encounter_inactive_patient_422(client, admin_token, dept_id, psql):
    """비활성(soft-deleted) 환자 접수 차단 → 422 patient_inactive(is_active 가드, 회고 4.2 체크)."""
    pid = _create_patient(client, admin_token)
    proc = psql.run(f"update public.patients set is_active = false where id = '{pid}';")
    assert proc.returncode == 0, proc.stderr
    res = client.post(
        _ENCOUNTERS_URL,
        json={"patient_id": pid, "department_id": dept_id},
        headers=_bearer(admin_token),
    )
    assert res.status_code == 422, res.text
    assert res.json()["error"]["code"] == "patient_inactive", res.text


def test_create_encounter_nonexistent_department_404(client, admin_token):
    """미존재 진료과 → 404."""
    pid = _create_patient(client, admin_token)
    res = client.post(
        _ENCOUNTERS_URL,
        json={"patient_id": pid, "department_id": str(uuid.uuid4())},
        headers=_bearer(admin_token),
    )
    assert res.status_code == 404, res.text


def test_create_encounter_invalid_room_422(client, admin_token, dept_id):
    """미존재 진료실(room_id) 지정 → 422 invalid_reference(FK 위반 백스톱 — 503 오분류 방지).

    room_id 는 선검사 안 함(미배정 허용·배정은 4.4) → 미존재 시 FK 위반(23503) → 백스톱이 422."""
    pid = _create_patient(client, admin_token)
    res = client.post(
        _ENCOUNTERS_URL,
        json={"patient_id": pid, "department_id": dept_id, "room_id": str(uuid.uuid4())},
        headers=_bearer(admin_token),
    )
    assert res.status_code == 422, res.text
    assert res.json()["error"]["code"] == "invalid_reference", res.text


# ── AC2: register RPC(scheduled→registered) + SQLSTATE 매핑 ────────────────────────


def test_register_scheduled_encounter(client, admin_token, dept_id, psql):
    """예약(scheduled) 내원을 register RPC 로 접수 → 200 + status='registered' + registered_at."""
    pid = _create_patient(client, admin_token)
    eid = _insert_scheduled(psql, pid, dept_id)
    res = client.post(f"{_ENCOUNTERS_URL}/{eid}/register", headers=_bearer(admin_token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "registered"
    assert body["registered_at"] is not None


def test_register_already_registered_conflict_409(client, admin_token, dept_id, psql):
    """이미 registered 인 내원 재-register → 409 invalid_transition(PT409 → ConflictError 매핑)."""
    pid = _create_patient(client, admin_token)
    eid = _insert_scheduled(psql, pid, dept_id)
    first = client.post(f"{_ENCOUNTERS_URL}/{eid}/register", headers=_bearer(admin_token))
    assert first.status_code == 200, first.text
    second = client.post(f"{_ENCOUNTERS_URL}/{eid}/register", headers=_bearer(admin_token))
    assert second.status_code == 409, second.text
    assert second.json()["error"]["code"] == "invalid_transition", second.text


def test_register_nonexistent_encounter_404(client, admin_token):
    """미존재 내원 register → 404(PT404 → NotFoundError 매핑)."""
    res = client.post(f"{_ENCOUNTERS_URL}/{uuid.uuid4()}/register", headers=_bearer(admin_token))
    assert res.status_code == 404, res.text


# ── AC3: 권한 게이트(미보유 403 / reception seed grant 201) ────────────────────────


def test_create_encounter_forbidden_without_register(client, doctor_token, dept_id):
    """encounter.register 미보유(doctor 권한 0) → 403(게이트가 본문 처리 전 차단)."""
    res = client.post(
        _ENCOUNTERS_URL,
        json={"patient_id": str(uuid.uuid4()), "department_id": dept_id},
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 403, res.text
    assert res.json()["error"]["code"] == "forbidden"


def test_reception_can_create_walk_in(client, admin_token, reception_token, admin_id, dept_id):
    """reception(seed grant 로 encounter.register 보유)은 walk-in 접수 가능 → 201(골든 패스 가동).

    환자 생성은 admin(원무는 patient.create 없음) — 원무는 기존 환자를 검색해 접수(3.5→4.2 흐름)."""
    pid = _create_patient(client, admin_token)
    res = client.post(
        _ENCOUNTERS_URL,
        json={"patient_id": pid, "department_id": dept_id},
        headers=_bearer(reception_token),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "registered"
    # 접수자(created_by) = reception uid(admin 아님 — 충전 주체 확인).
    assert body["created_by"] and body["created_by"] != admin_id


def test_register_forbidden_without_permission(client, admin_token, doctor_token, dept_id, psql):
    """register 액션도 encounter.register 게이트 — 미보유(doctor) → 403."""
    pid = _create_patient(client, admin_token)
    eid = _insert_scheduled(psql, pid, dept_id)
    res = client.post(f"{_ENCOUNTERS_URL}/{eid}/register", headers=_bearer(doctor_token))
    assert res.status_code == 403, res.text


# ── GET 단건(접수 결과·상세) ──────────────────────────────────────────────────────


def test_get_encounter(client, admin_token, dept_id):
    """생성한 내원 단건 조회 → 200 + 동일 id·status."""
    pid = _create_patient(client, admin_token)
    created = client.post(
        _ENCOUNTERS_URL,
        json={"patient_id": pid, "department_id": dept_id},
        headers=_bearer(admin_token),
    )
    eid = created.json()["id"]
    res = client.get(f"{_ENCOUNTERS_URL}/{eid}", headers=_bearer(admin_token))
    assert res.status_code == 200, res.text
    assert res.json()["id"] == eid
    assert res.json()["status"] == "registered"


def test_get_encounter_not_found_404(client, admin_token):
    res = client.get(f"{_ENCOUNTERS_URL}/{uuid.uuid4()}", headers=_bearer(admin_token))
    assert res.status_code == 404, res.text


def test_get_encounter_forbidden_without_read(client, admin_token, nurse_token, dept_id):
    """encounter.read 미보유(nurse 무권한 baseline) → 조회 403. (doctor 는 4.4 부터 read 보유.)"""
    pid = _create_patient(client, admin_token)
    created = client.post(
        _ENCOUNTERS_URL,
        json={"patient_id": pid, "department_id": dept_id},
        headers=_bearer(admin_token),
    )
    eid = created.json()["id"]
    res = client.get(f"{_ENCOUNTERS_URL}/{eid}", headers=_bearer(nurse_token))
    assert res.status_code == 403, res.text


# ── Story 4.3: 대기 현황판 목록 GET /encounters ──────────────────────────────────────


def _create_walk_in(client: TestClient, token: str, pid: str, dept_id: str) -> str:
    res = client.post(
        _ENCOUNTERS_URL,
        json={"patient_id": pid, "department_id": dept_id},
        headers=_bearer(token),
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_list_encounters_returns_walk_in_with_denormalized(client, admin_token, dept_id):
    """GET /encounters → 200 {data, meta} + walk-in 행 + 조인 표시 필드(환자명·진료과명 등)."""
    pid = _create_patient(client, admin_token)
    eid = _create_walk_in(client, admin_token, pid, dept_id)
    res = client.get(
        _ENCOUNTERS_URL, params={"department_id": dept_id}, headers=_bearer(admin_token)
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert "data" in body and "meta" in body
    assert body["meta"]["total"] >= 1
    row = next((r for r in body["data"] if r["id"] == eid), None)
    assert row is not None, "생성한 내원이 목록에 없음"
    assert row["patient_name"] == "접수테스트환자"
    assert row["chart_no"] and row["department_name"]  # 조인 표시 필드
    assert row["status"] == "registered"
    assert row["call_count"] == 0 and row["called_at"] is None  # 호출 전


def test_list_encounters_status_filter(client, admin_token, dept_id):
    """status=registered 필터는 walk-in 포함 / status=completed 필터는 미포함."""
    pid = _create_patient(client, admin_token)
    eid = _create_walk_in(client, admin_token, pid, dept_id)
    inc = client.get(
        _ENCOUNTERS_URL,
        params={"department_id": dept_id, "status": ["registered"]},
        headers=_bearer(admin_token),
    )
    assert any(r["id"] == eid for r in inc.json()["data"]), inc.text
    exc = client.get(
        _ENCOUNTERS_URL,
        params={"department_id": dept_id, "status": ["completed"]},
        headers=_bearer(admin_token),
    )
    assert all(r["id"] != eid for r in exc.json()["data"]), exc.text


def test_list_encounters_forbidden_without_read(client, nurse_token, dept_id):
    """encounter.read 미보유(nurse 무권한 baseline) → 목록 403. (doctor 는 4.4 부터 read 보유.)"""
    res = client.get(
        _ENCOUNTERS_URL, params={"department_id": dept_id}, headers=_bearer(nurse_token)
    )
    assert res.status_code == 403, res.text


def test_list_encounters_invalid_status_422(client, admin_token, dept_id):
    """잘못된/빈 status 값 → 422(Literal 검증, 무음 빈 보드 방지). 코드리뷰 patch."""
    bad = client.get(
        _ENCOUNTERS_URL,
        params={"department_id": dept_id, "status": ["bogus"]},
        headers=_bearer(admin_token),
    )
    assert bad.status_code == 422, bad.text
    empty = client.get(
        f"{_ENCOUNTERS_URL}?department_id={dept_id}&status=", headers=_bearer(admin_token)
    )
    assert empty.status_code == 422, empty.text


def test_list_encounters_reception_golden_path(client, admin_token, reception_token, dept_id):
    """reception(seed encounter.read 보유)은 대기 현황판 목록 조회 가능(공유 화면 골든 패스)."""
    pid = _create_patient(client, admin_token)
    _create_walk_in(client, admin_token, pid, dept_id)
    res = client.get(
        _ENCOUNTERS_URL, params={"department_id": dept_id}, headers=_bearer(reception_token)
    )
    assert res.status_code == 200, res.text


# ── Story 4.3: 환자 호출 POST /encounters/{id}/call ──────────────────────────────────


def test_call_encounter_records(client, admin_token, dept_id):
    """호출 → 200 + called_at 세팅·call_count=1·status 불변(registered). 재호출 → call_count=2."""
    pid = _create_patient(client, admin_token)
    eid = _create_walk_in(client, admin_token, pid, dept_id)
    first = client.post(f"{_ENCOUNTERS_URL}/{eid}/call", headers=_bearer(admin_token))
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["called_at"] is not None
    assert body["call_count"] == 1
    assert body["status"] == "registered"  # 호출은 전이 아님
    second = client.post(f"{_ENCOUNTERS_URL}/{eid}/call", headers=_bearer(admin_token))
    assert second.status_code == 200 and second.json()["call_count"] == 2, second.text


def test_call_non_registered_conflict_409(client, admin_token, dept_id, psql):
    """미접수(scheduled) 내원 호출 → 409 invalid_transition(호출 대상은 접수 환자만)."""
    pid = _create_patient(client, admin_token)
    eid = _insert_scheduled(psql, pid, dept_id)
    res = client.post(f"{_ENCOUNTERS_URL}/{eid}/call", headers=_bearer(admin_token))
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "invalid_transition", res.text


def test_call_nonexistent_encounter_404(client, admin_token):
    """미존재 내원 호출 → 404(PT404 → NotFoundError 매핑)."""
    res = client.post(f"{_ENCOUNTERS_URL}/{uuid.uuid4()}/call", headers=_bearer(admin_token))
    assert res.status_code == 404, res.text


def test_call_forbidden_without_call_permission(client, admin_token, doctor_token, dept_id):
    """encounter.call 미보유(doctor 권한 0) → 호출 403(게이트가 본문 처리 전 차단)."""
    pid = _create_patient(client, admin_token)
    eid = _create_walk_in(client, admin_token, pid, dept_id)
    res = client.post(f"{_ENCOUNTERS_URL}/{eid}/call", headers=_bearer(doctor_token))
    assert res.status_code == 403, res.text


def test_reception_can_call(client, admin_token, reception_token, dept_id):
    """reception(seed encounter.call 보유)은 환자 호출 가능 → 200(호출 골든 패스)."""
    pid = _create_patient(client, admin_token)
    eid = _create_walk_in(client, admin_token, pid, dept_id)
    res = client.post(f"{_ENCOUNTERS_URL}/{eid}/call", headers=_bearer(reception_token))
    assert res.status_code == 200, res.text
    assert res.json()["call_count"] == 1


# ── Story 4.4: 진찰 시작 POST /encounters/{id}/start-consult ──────────────────────────


def test_start_consult_transitions_to_in_progress(client, admin_token, admin_id, dept_id):
    """진찰 시작 → 200 + status='in_progress' + consult_started_at + doctor_id=호출자(admin)."""
    pid = _create_patient(client, admin_token)
    eid = _create_walk_in(client, admin_token, pid, dept_id)
    res = client.post(f"{_ENCOUNTERS_URL}/{eid}/start-consult", headers=_bearer(admin_token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "in_progress"
    assert body["consult_started_at"] is not None
    assert body["doctor_id"] == admin_id  # start_consult 가 auth.uid() 로 담당의 세팅


def test_start_consult_doctor_golden_path(client, admin_token, doctor_token, doctor_id, dept_id):
    """doctor(seed encounter.start 보유, 4.4)는 진찰 시작 가능 → 200 + doctor_id=doctor uid."""
    pid = _create_patient(client, admin_token)
    eid = _create_walk_in(client, admin_token, pid, dept_id)
    res = client.post(f"{_ENCOUNTERS_URL}/{eid}/start-consult", headers=_bearer(doctor_token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "in_progress"
    assert body["doctor_id"] == doctor_id


def test_start_consult_already_in_progress_conflict_409(client, admin_token, dept_id):
    """이미 in_progress 인 내원 재-진찰시작 → 409 invalid_transition(재수행·진료 탈취 차단)."""
    pid = _create_patient(client, admin_token)
    eid = _create_walk_in(client, admin_token, pid, dept_id)
    first = client.post(f"{_ENCOUNTERS_URL}/{eid}/start-consult", headers=_bearer(admin_token))
    assert first.status_code == 200, first.text
    second = client.post(f"{_ENCOUNTERS_URL}/{eid}/start-consult", headers=_bearer(admin_token))
    assert second.status_code == 409, second.text
    assert second.json()["error"]["code"] == "invalid_transition", second.text


def test_start_consult_non_registered_conflict_409(client, admin_token, dept_id, psql):
    """미접수(scheduled) 내원 진찰 시작 → 409(접수 환자만 진찰 시작 가능)."""
    pid = _create_patient(client, admin_token)
    eid = _insert_scheduled(psql, pid, dept_id)
    res = client.post(f"{_ENCOUNTERS_URL}/{eid}/start-consult", headers=_bearer(admin_token))
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "invalid_transition", res.text


def test_start_consult_nonexistent_encounter_404(client, admin_token):
    """미존재 내원 진찰 시작 → 404(PT404 → NotFoundError 매핑)."""
    res = client.post(
        f"{_ENCOUNTERS_URL}/{uuid.uuid4()}/start-consult", headers=_bearer(admin_token)
    )
    assert res.status_code == 404, res.text


def test_start_consult_forbidden_without_start_permission(
    client, admin_token, nurse_token, dept_id
):
    """encounter.start 미보유(nurse 무권한 baseline) → 진찰 시작 403(게이트가 본문 처리 전 차단)."""
    pid = _create_patient(client, admin_token)
    eid = _create_walk_in(client, admin_token, pid, dept_id)
    res = client.post(f"{_ENCOUNTERS_URL}/{eid}/start-consult", headers=_bearer(nurse_token))
    assert res.status_code == 403, res.text
