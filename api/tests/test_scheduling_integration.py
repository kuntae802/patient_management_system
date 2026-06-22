"""근무표·휴진 통합 테스트 (Story 6.1 AC1·2·3·4) — 실 토큰 + asyncpg + 0030.

로컬 스택(`supabase start` + `db reset`)/부트스트랩 계정이 없으면 skip. 검증:
  · AC1: admin 토큰으로 근무표 생성→수정→비활성→재활성 → 201/200 + 응답 모델
  · AC1: 같은 의사·요일 시간 겹침 → 409 schedule_overlap
  · AC2: 휴진·예외 생성→수정→비활성
  · AC3: 비활성(is_active=false) 후 행 보존(soft delete); 미존재/비-의사 배정 → 422 invalid_doctor
  · AC4: 생성이 audit_logs 에 actor=admin 으로 기록; 비-master.manage(doctor) → 403
  · 의사 피커: GET /scheduling/doctors 가 재직 의사(EMP0002) 노출

⚠️ 생성행은 잔존(soft delete만, db reset 이 초기화)하므로 테스트는 생성 근무표를 **종료 시 비활성**
   처리한다(부분 EXCLUDE where(is_active) 가 inactive 를 무시 → 재실행 시 활성 겹침 회피). 테스트별
   weekday 격리: lifecycle=6(토)·overlap=0(일) — 시드 데모(월–금) 와도 비충돌.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import Psql

_API = os.getenv("SUPABASE_API_URL", "http://127.0.0.1:54321")
_PUBLISHABLE = os.getenv(
    "SUPABASE_PUBLISHABLE_KEY", "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
)
_SCHED_URL = "/v1/scheduling/doctor-schedules"
_TIMEOFF_URL = "/v1/scheduling/doctor-time-offs"
_DOCTORS_URL = "/v1/scheduling/doctors"
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
def demo_doctor_id(psql: Psql) -> str:
    return psql.scalar("select id::text from public.users where employee_no = 'EMP0002'").lower()


@pytest.fixture(scope="module")
def demo_dept_id(psql: Psql) -> str:
    return psql.scalar(
        "select id::text from public.departments where lower(code) = lower('IM') limit 1"
    ).lower()


@pytest.fixture(scope="module")
def demo_room_id(psql: Psql) -> str:
    return psql.scalar(
        "select id::text from public.rooms where lower(code) = lower('R101') limit 1"
    ).lower()


@pytest.fixture(scope="module")
def client(admin_token: str):
    with TestClient(app) as test_client:
        yield test_client


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _deactivate(client: TestClient, token: str, schedule_id: str) -> None:
    """재실행 안전성: 생성 근무표를 비활성(부분 EXCLUDE 가 inactive 무시)."""
    client.patch(
        f"{_SCHED_URL}/{schedule_id}/active", headers=_bearer(token), json={"is_active": False}
    )


def test_schedule_lifecycle_with_audit(
    client: TestClient,
    admin_token: str,
    admin_id: str,
    demo_doctor_id: str,
    demo_dept_id: str,
    demo_room_id: str,
) -> None:
    """AC1+AC3+AC4: 근무표 생성→수정(진료실 배정)→비활성→재활성, 행 보존 + actor=admin 감사."""
    created = client.post(
        _SCHED_URL,
        headers=_bearer(admin_token),
        json={
            "doctor_id": demo_doctor_id,
            "department_id": demo_dept_id,
            "weekday": 6,
            "start_time": "09:00:00",
            "end_time": "12:00:00",
        },
    )
    assert created.status_code == 201, created.text
    sched = created.json()
    sid = sched["id"]
    assert sched["weekday"] == 6 and sched["is_active"] is True and sched["room_id"] is None

    # 수정(전 필드 교체) — 진료실 배정 + 시간 변경
    updated = client.patch(
        f"{_SCHED_URL}/{sid}",
        headers=_bearer(admin_token),
        json={
            "doctor_id": demo_doctor_id,
            "department_id": demo_dept_id,
            "room_id": demo_room_id,
            "weekday": 6,
            "start_time": "13:00:00",
            "end_time": "17:30:00",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["room_id"] == demo_room_id and updated.json()["start_time"] == "13:00:00"

    # 비활성(soft delete) → is_active=false, 행 보존
    deact = client.patch(
        f"{_SCHED_URL}/{sid}/active", headers=_bearer(admin_token), json={"is_active": False}
    )
    assert deact.status_code == 200 and deact.json()["is_active"] is False
    assert deact.json()["weekday"] == 6  # 보존

    # 재활성
    react = client.patch(
        f"{_SCHED_URL}/{sid}/active", headers=_bearer(admin_token), json={"is_active": True}
    )
    assert react.status_code == 200 and react.json()["is_active"] is True

    # 생성이 actor=admin 으로 감사됨(AC4)
    audit = client.get(
        _AUDIT_URL,
        headers=_bearer(admin_token),
        params={"target_table": "doctor_schedules", "action": "create", "page_size": 50},
    )
    assert audit.status_code == 200
    mine = [
        e
        for e in audit.json()["data"]
        if (e["actor_id"] or "").lower() == admin_id and (e["after_data"] or {}).get("id") == sid
    ]
    assert mine, "근무표 생성이 actor=admin 으로 감사되지 않음(AC4 위반)"

    _deactivate(client, admin_token, sid)  # 재실행 안전


def test_schedule_overlap_conflict(
    client: TestClient, admin_token: str, demo_doctor_id: str, demo_dept_id: str
) -> None:
    """AC1: 같은 의사·요일의 겹치는 활성 근무표 → 409 schedule_overlap(weekday=0 격리)."""
    first = client.post(
        _SCHED_URL,
        headers=_bearer(admin_token),
        json={
            "doctor_id": demo_doctor_id,
            "department_id": demo_dept_id,
            "weekday": 0,
            "start_time": "09:00:00",
            "end_time": "12:00:00",
        },
    )
    assert first.status_code == 201, first.text
    fid = first.json()["id"]

    overlap = client.post(
        _SCHED_URL,
        headers=_bearer(admin_token),
        json={
            "doctor_id": demo_doctor_id,
            "department_id": demo_dept_id,
            "weekday": 0,
            "start_time": "11:00:00",  # 09–12 와 겹침
            "end_time": "13:00:00",
        },
    )
    assert overlap.status_code == 409, overlap.text
    assert overlap.json()["error"]["code"] == "schedule_overlap"

    _deactivate(client, admin_token, fid)  # 재실행 안전


def test_invalid_doctor_rejected(
    client: TestClient, admin_token: str, demo_dept_id: str, psql: Psql
) -> None:
    """AC3: 미존재 의사 → 422 invalid_doctor; 비-의사(간호) 직원 → 422 invalid_doctor."""
    missing = client.post(
        _SCHED_URL,
        headers=_bearer(admin_token),
        json={
            "doctor_id": str(uuid.uuid4()),
            "department_id": demo_dept_id,
            "weekday": 5,
            "start_time": "09:00:00",
            "end_time": "12:00:00",
        },
    )
    assert missing.status_code == 422 and missing.json()["error"]["code"] == "invalid_doctor"

    nurse_id = psql.scalar(
        "select id::text from public.users where employee_no = 'EMP0004'"
    ).lower()
    not_doctor = client.post(
        _SCHED_URL,
        headers=_bearer(admin_token),
        json={
            "doctor_id": nurse_id,
            "department_id": demo_dept_id,
            "weekday": 5,
            "start_time": "09:00:00",
            "end_time": "12:00:00",
        },
    )
    assert not_doctor.status_code == 422 and not_doctor.json()["error"]["code"] == "invalid_doctor"


def test_time_off_lifecycle(client: TestClient, admin_token: str, demo_doctor_id: str) -> None:
    """AC2: 휴진·예외 생성→수정→비활성(겹침 제약 없음 — 중첩 휴진 무해)."""
    created = client.post(
        _TIMEOFF_URL,
        headers=_bearer(admin_token),
        json={
            "doctor_id": demo_doctor_id,
            "start_at": "2030-03-01T00:00:00+09:00",
            "end_at": "2030-03-03T00:00:00+09:00",
            "reason": "학회",
        },
    )
    assert created.status_code == 201, created.text
    tid = created.json()["id"]
    assert created.json()["reason"] == "학회"

    updated = client.patch(
        f"{_TIMEOFF_URL}/{tid}",
        headers=_bearer(admin_token),
        json={
            "start_at": "2030-03-01T00:00:00+09:00",
            "end_at": "2030-03-04T00:00:00+09:00",
            "reason": "학회(연장)",
        },
    )
    assert updated.status_code == 200 and updated.json()["reason"] == "학회(연장)"

    deact = client.patch(
        f"{_TIMEOFF_URL}/{tid}/active", headers=_bearer(admin_token), json={"is_active": False}
    )
    assert deact.status_code == 200 and deact.json()["is_active"] is False


def test_doctor_forbidden_on_schedule_writes(
    client: TestClient, doctor_token: str, demo_doctor_id: str, demo_dept_id: str
) -> None:
    """AC4: master.manage 미보유(doctor) → 근무표 쓰기 403."""
    res = client.post(
        _SCHED_URL,
        headers=_bearer(doctor_token),
        json={
            "doctor_id": demo_doctor_id,
            "department_id": demo_dept_id,
            "weekday": 4,
            "start_time": "09:00:00",
            "end_time": "12:00:00",
        },
    )
    assert res.status_code == 403 and res.json()["error"]["code"] == "forbidden"


def test_list_scheduling_doctors(client: TestClient, admin_token: str, demo_doctor_id: str) -> None:
    """의사 피커: 재직 의사 목록에 데모 의사(EMP0002) 노출(id·name·department_id)."""
    res = client.get(_DOCTORS_URL, headers=_bearer(admin_token))
    assert res.status_code == 200, res.text
    ids = {d["id"].lower() for d in res.json()}
    assert demo_doctor_id in ids, "재직 의사 목록에 데모 의사가 없음"


def test_doctor_forbidden_on_doctors_list(client: TestClient, doctor_token: str) -> None:
    """AC4: master.manage 미보유(doctor) → 의사 피커 조회도 403."""
    res = client.get(_DOCTORS_URL, headers=_bearer(doctor_token))
    assert res.status_code == 403


# ── 동적 가용 슬롯 계산 (Story 6.2) — 시드 데모 의사(월–금 09:00–12:30·14:00–17:30) ───────────
# reception=appointment.read 보유(seed)·nurse=미보유(403 baseline). 시드 휴진=2030-05-01(수, 종일).
_SLOTS_URL = "/v1/scheduling/slots"
_BOOKABLE_URL = "/v1/scheduling/bookable-doctors"
_FUTURE_WEEKDAY = "2030-06-03"  # 월요일·미래(시드 휴진 2030-05-01 과 무관) → 슬롯 available
_TIMEOFF_DAY = "2030-05-01"  # 수요일·시드 종일 휴진 → 그날 전 슬롯 time_off
_PAST_WEEKDAY = "2020-01-06"  # 월요일·과거 → 전 슬롯 past


@pytest.fixture(scope="module")
def reception_token() -> str:
    token = _get_token("reception@pms.local", "Staff1234")
    if not token:
        pytest.skip("reception 부트스트랩 계정 미가용 — 'supabase db reset'(seed 갱신) 후 재실행")
    return token


@pytest.fixture(scope="module")
def nurse_token() -> str:
    token = _get_token("nurse@pms.local", "Staff1234")
    if not token:
        pytest.skip("nurse 부트스트랩 계정 미가용 — 'supabase db reset'(seed 갱신) 후 재실행")
    return token


def test_slots_available_for_demo_doctor(
    client: TestClient, reception_token: str, demo_doctor_id: str
) -> None:
    """AC1: 미래 평일 → 시드 근무(오전·오후)에서 available 슬롯 산출(휴진·예약 없음)."""
    res = client.get(
        _SLOTS_URL,
        headers=_bearer(reception_token),
        params={"doctor_id": demo_doctor_id, "date": _FUTURE_WEEKDAY},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["slot_minutes"] == 30 and body["date"] == _FUTURE_WEEKDAY
    statuses = {s["status"] for s in body["slots"]}
    assert "available" in statuses and "past" not in statuses
    # 오전 09:00–12:30(7) + 오후 14:00–17:30(7) = 14 슬롯.
    assert len(body["slots"]) == 14, body["slots"]


def test_slots_time_off_day(client: TestClient, reception_token: str, demo_doctor_id: str) -> None:
    """AC2: 시드 종일 휴진일(수) → 그날 근무 슬롯이 전부 time_off(비활성)."""
    res = client.get(
        _SLOTS_URL,
        headers=_bearer(reception_token),
        params={"doctor_id": demo_doctor_id, "date": _TIMEOFF_DAY},
    )
    assert res.status_code == 200, res.text
    slots = res.json()["slots"]
    assert slots and all(s["status"] == "time_off" for s in slots), slots


def test_slots_past_day(client: TestClient, reception_token: str, demo_doctor_id: str) -> None:
    """AC2: 과거 평일 → 근무 슬롯이 전부 past(비활성)."""
    res = client.get(
        _SLOTS_URL,
        headers=_bearer(reception_token),
        params={"doctor_id": demo_doctor_id, "date": _PAST_WEEKDAY},
    )
    assert res.status_code == 200, res.text
    slots = res.json()["slots"]
    assert slots and all(s["status"] == "past" for s in slots), slots


def test_slots_empty_for_non_doctor(client: TestClient, reception_token: str) -> None:
    """AC3: 미존재/비-의사 doctor_id → 빈 슬롯·200(404 아님)."""
    res = client.get(
        _SLOTS_URL,
        headers=_bearer(reception_token),
        params={"doctor_id": str(uuid.uuid4()), "date": _FUTURE_WEEKDAY},
    )
    assert res.status_code == 200, res.text
    assert res.json()["slots"] == []


def test_slots_forbidden_for_nurse(
    client: TestClient, nurse_token: str, demo_doctor_id: str
) -> None:
    """AC4: appointment.read 미보유(nurse) → 슬롯 조회 403."""
    res = client.get(
        _SLOTS_URL,
        headers=_bearer(nurse_token),
        params={"doctor_id": demo_doctor_id, "date": _FUTURE_WEEKDAY},
    )
    assert res.status_code == 403 and res.json()["error"]["code"] == "forbidden"


def test_bookable_doctors_for_reception(
    client: TestClient, reception_token: str, demo_doctor_id: str, demo_dept_id: str
) -> None:
    """예약 피커: reception(appointment.read) → 재직 의사 목록 + 진료과 필터."""
    res = client.get(_BOOKABLE_URL, headers=_bearer(reception_token))
    assert res.status_code == 200, res.text
    assert demo_doctor_id in {d["id"].lower() for d in res.json()}
    # 진료과 필터 — 데모 의사(IM 소속)는 IM 필터에 포함.
    res2 = client.get(
        _BOOKABLE_URL, headers=_bearer(reception_token), params={"department_id": demo_dept_id}
    )
    assert res2.status_code == 200
    assert demo_doctor_id in {d["id"].lower() for d in res2.json()}


def test_bookable_doctors_forbidden_for_nurse(client: TestClient, nurse_token: str) -> None:
    """AC4: appointment.read 미보유(nurse) → 예약 피커 403."""
    res = client.get(_BOOKABLE_URL, headers=_bearer(nurse_token))
    assert res.status_code == 403


# ── 예약 생성 · 캘린더 (Story 6.3) — 실 POST + 더블부킹 409 + 캘린더 overlay ──────────────────
# ⚠️ 두 worktree 가 단일 supabase 스택 공유 → 동시 db reset 시 0032 소실 가능(reset 직후 실행 권장).
_APPOINTMENTS_URL = "/v1/scheduling/appointments"
_CALENDAR_URL = "/v1/scheduling/calendar"
_BOOK_DATE = "2030-06-03"  # 월요일(데모 의사 근무 09:00–12:30·14:00–17:30 KST)
_BOOK_START = "2030-06-03T01:00:00Z"  # 10:00 KST(오전 블록 내)


@pytest.fixture
def booking_patient_id(psql: Psql) -> Iterator[str]:
    """예약 테스트용 환자(인라인 암호화 생성 — 6.2 test_migrations 패턴). 종료 시 예약+환자 정리."""
    pid = "00000000-0000-4000-8000-00000000b001"
    psql.run(
        "insert into public.patients (id, name, birth_date, sex, resident_no_enc, "
        "resident_no_hash, resident_no_masked, insurance_type) values "
        f"('{pid}', '예약테스트', '1990-01-01', 'male', "
        "public.encrypt_sensitive('9001011234567'), public.blind_index('9001011234567'), "
        "'900101-1******', 'health_insurance') on conflict (id) do nothing;"
    )
    yield pid
    psql.run(f"delete from public.appointments where patient_id='{pid}';")
    psql.run(f"delete from public.patients where id='{pid}';")


def _appt_payload(patient_id: str, doctor_id: str, dept_id: str) -> dict[str, object]:
    return {
        "department_id": dept_id,
        "doctor_id": doctor_id,
        "patient_id": patient_id,
        "scheduled_start": _BOOK_START,
        "note": "초진",
        "sms_opt_in": True,
    }


def test_create_appointment_and_double_booking(
    client: TestClient,
    reception_token: str,
    booking_patient_id: str,
    demo_doctor_id: str,
    demo_dept_id: str,
) -> None:
    """AC2+AC3: 예약 생성(201·booked·SMS) → 동일 슬롯 재예약 → 409 double_booking."""
    payload = _appt_payload(booking_patient_id, demo_doctor_id, demo_dept_id)
    res = client.post(_APPOINTMENTS_URL, headers=_bearer(reception_token), json=payload)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "booked" and body["sms_opt_in"] is True
    assert body["note"] == "초진"
    assert body["scheduled_end"] == "2030-06-03T01:30:00Z"  # +30분(서버 계산)

    dup = client.post(_APPOINTMENTS_URL, headers=_bearer(reception_token), json=payload)
    assert dup.status_code == 409, dup.text
    assert dup.json()["error"]["code"] == "double_booking"


def test_create_appointment_forbidden_for_nurse(
    client: TestClient,
    nurse_token: str,
    booking_patient_id: str,
    demo_doctor_id: str,
    demo_dept_id: str,
) -> None:
    """AC4: appointment.create 미보유(nurse) → 예약 생성 403."""
    payload = _appt_payload(booking_patient_id, demo_doctor_id, demo_dept_id)
    res = client.post(_APPOINTMENTS_URL, headers=_bearer(nurse_token), json=payload)
    assert res.status_code == 403 and res.json()["error"]["code"] == "forbidden"


def test_create_appointment_missing_patient_404(
    client: TestClient, reception_token: str, demo_doctor_id: str, demo_dept_id: str
) -> None:
    payload = _appt_payload(str(uuid.uuid4()), demo_doctor_id, demo_dept_id)
    res = client.post(_APPOINTMENTS_URL, headers=_bearer(reception_token), json=payload)
    assert res.status_code == 404 and res.json()["error"]["code"] == "not_found"


def test_calendar_shows_confirmed_booking(
    client: TestClient,
    reception_token: str,
    booking_patient_id: str,
    demo_doctor_id: str,
    demo_dept_id: str,
) -> None:
    """AC1: 예약 생성 후 캘린더에서 해당 슬롯이 confirmed + 환자명으로 overlay."""
    payload = _appt_payload(booking_patient_id, demo_doctor_id, demo_dept_id)
    created = client.post(_APPOINTMENTS_URL, headers=_bearer(reception_token), json=payload)
    assert created.status_code == 201, created.text

    res = client.get(
        _CALENDAR_URL,
        headers=_bearer(reception_token),
        params={"department_id": demo_dept_id, "date": _BOOK_DATE},
    )
    assert res.status_code == 200, res.text
    cols = [c for c in res.json()["doctors"] if c["doctor_id"].lower() == demo_doctor_id]
    assert cols, "캘린더에 데모 의사 열 없음"
    confirmed = [s for s in cols[0]["slots"] if s["status"] == "confirmed"]
    assert confirmed and confirmed[0]["patient_name"] == "예약테스트", confirmed


def test_calendar_forbidden_for_nurse(
    client: TestClient, nurse_token: str, demo_dept_id: str
) -> None:
    """AC4: appointment.read 미보유(nurse) → 캘린더 403."""
    res = client.get(
        _CALENDAR_URL,
        headers=_bearer(nurse_token),
        params={"department_id": demo_dept_id, "date": _BOOK_DATE},
    )
    assert res.status_code == 403
