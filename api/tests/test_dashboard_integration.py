"""운영 대시보드 집계(Story 8.5 · FR-230) 통합 테스트 — 실 Supabase 토큰 + FastAPI TestClient.

GET /v1/dashboard/operations 를 0010/0045/0031 데이터 위에서 검증. 로컬 스택/부트스트랩 없으면 skip.
검증:
  · 권한: dashboard.read 보유(admin) 통과 / 미보유(reception·doctor·nurse) → 403 / 미인증 → 401
  · 집계 정확성: 당일 스냅샷(내원·대기·진료중·완료·순수납액·노쇼율) + daily_series
  · refunded 차감: 순수납액 = Σ(paid − refunded)
  · KST 경계: 23:30 UTC finalize → 익일 KST 귀속
  · divide-by-zero: 예약 0인 날 노쇼율 0.0(NaN 아님)
  · 빈 환경: 데이터 없는 날 전부 0

⚠️ 셋업은 psql 직접 커밋(고정 UUID 프리픽스 '00085000-%' · 재실행 시 정리). 트리거(전이 가드·감사)는
   session_replication_role=replica 로 우회해 임의 status·과거 시각을 결정 적재(CHECK 는 유지).
"""

from __future__ import annotations

import os

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import Psql

_API = os.getenv("SUPABASE_API_URL", "http://127.0.0.1:54321")
_PUBLISHABLE = os.getenv(
    "SUPABASE_PUBLISHABLE_KEY", "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
)
_DEPT = "(select id from public.departments where lower(code) = 'im' limit 1)"
_DOCTOR = (
    "(select u.id from public.users u join public.roles r on r.id = u.role_id "
    "where r.code = 'doctor' limit 1)"
)

# 결정적 셋업 일자(타 테스트와 충돌 없는 고정 과거/미래일).
MAIN_DATE = "2020-03-15"  # KST — 주 시드(내원·수납·노쇼)
BOUNDARY_KST_DATE = "2020-04-11"  # 23:30 UTC(04-10) finalize → KST 04-11 귀속
EMPTY_DATE = "2099-12-31"  # 데이터 없음 → 전부 0


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
    """dashboard.read 보유(admin = 전체 권한, 0002)."""
    token = _get_token("admin@pms.local", "Staff1234")
    if not token:
        pytest.skip("로컬 Supabase 스택/부트스트랩 미가용 — supabase start && db reset 후 재실행")
    return token


@pytest.fixture(scope="module")
def reception_token() -> str:
    """dashboard.read 미보유 — 403 baseline."""
    token = _get_token("reception@pms.local", "Staff1234")
    if not token:
        pytest.skip("reception 부트스트랩 미가용 — 'supabase db reset' 후 재실행")
    return token


@pytest.fixture(scope="module")
def doctor_token() -> str:
    """dashboard.read 미보유 — 403 baseline."""
    token = _get_token("doctor@pms.local", "Staff1234")
    if not token:
        pytest.skip("doctor 부트스트랩 미가용 — 'supabase db reset' 후 재실행")
    return token


@pytest.fixture(scope="module")
def client(admin_token: str):
    # with-블록 = lifespan 실행(asyncpg 풀 생성). 풀 없이는 권한 평가·집계 불가.
    with TestClient(app) as test_client:
        yield test_client


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _patient_sql(pid: str) -> str:
    return (
        "insert into public.patients(id, name, birth_date, sex, resident_no_enc, "
        "resident_no_hash, resident_no_masked, insurance_type) values "
        f"('{pid}','대시보드TEST','1990-01-01','male','\\x00'::bytea,"
        f"'__enc_{pid}__','900101-1******','health_insurance');"
    )


@pytest.fixture(scope="module", autouse=True)
def _seed(psql: Psql):
    """대시보드 집계 결정적 셋업(트리거 우회 · CHECK 준수 · 재실행 정리)."""
    pid = "00085000-0000-4000-8000-0000000000f1"
    e1, e2, e3, e4, e5 = (f"00085000-0000-4000-8000-0000000000e{i}" for i in range(1, 6))
    cenc = "00085000-0000-4000-8000-0000000000c1"
    cohort = "00085000-0000-4000-8000-0000000000d1"  # 자정 넘김 코호트(등록 05-20·완료 05-21)
    pay1, pay2, pay3 = (f"00085000-0000-4000-8000-0000000000a{i}" for i in range(1, 4))
    a1, a2, a3, a4 = (f"00085000-0000-4000-8000-0000000000b{i}" for i in range(1, 5))

    def enc(eid: str, status: str, reg: str, *, completed: str | None = None) -> str:
        comp = f"'{completed}'" if completed else "null"
        return (
            "insert into public.encounters(id, patient_id, department_id, visit_type, status, "
            "registered_at, completed_at) values "
            f"('{eid}','{pid}',{_DEPT},'walk_in','{status}','{reg}',{comp});"
        )

    def pay(payid: str, eid: str, paid: int, refunded: int, fin_at: str, no: str) -> str:
        return (
            "insert into public.payments(id, encounter_id, status, paid_amount_krw, "
            "refunded_amount_krw, payment_method, payment_no, finalized_at, finalized_by) values "
            f"('{payid}','{eid}','finalized',{paid},{refunded},'card','{no}','{fin_at}',{_DOCTOR});"
        )

    def appt(aid: str, status: str, start: str, *, ns: str | None = None) -> str:
        nsa = f"'{ns}'" if ns else "null"
        return (
            "insert into public.appointments(id, patient_id, doctor_id, department_id, "
            "scheduled_start, scheduled_end, status, created_by, no_show_at) values "
            f"('{aid}','{pid}',{_DOCTOR},{_DEPT},'{start}','{start}'::timestamptz + interval "
            f"'20 min','{status}',{_DOCTOR},{nsa});"
        )

    sql = (
        "set session_replication_role = replica;"  # 전이 가드·감사 트리거 우회(CHECK 는 유지)
        "delete from public.payments where id::text like '00085000-%';"
        "delete from public.appointments where id::text like '00085000-%';"
        "delete from public.encounters where id::text like '00085000-%';"
        "delete from public.patients where id::text like '00085000-%';"
        + _patient_sql(pid)
        # 내원(MAIN_DATE): 완료 2·진찰중 1·접수 1·취소 1(=미내원) → visits 4·wait 1·in_prog 1·done 2
        + enc(e1, "completed", f"{MAIN_DATE} 09:00:00+09", completed=f"{MAIN_DATE} 09:30:00+09")
        + enc(e5, "completed", f"{MAIN_DATE} 13:00:00+09", completed=f"{MAIN_DATE} 13:30:00+09")
        + enc(e2, "in_progress", f"{MAIN_DATE} 10:00:00+09")
        + enc(e3, "registered", f"{MAIN_DATE} 11:00:00+09")
        + enc(e4, "cancelled", f"{MAIN_DATE} 08:00:00+09")
        # 수납(MAIN_DATE finalized): 10000 + (5000−2000 환급) = 순 13000
        + pay(pay1, e1, 10000, 0, f"{MAIN_DATE} 09:35:00+09", "R-20200315-000001")
        + pay(pay2, e5, 5000, 2000, f"{MAIN_DATE} 18:00:00+09", "R-20200315-000002")
        # 예약(MAIN_DATE): no_show 2·completed 1·cancelled 1(분모 제외) → 노쇼율 2/3
        + appt(a1, "no_show", f"{MAIN_DATE} 09:00:00+09", ns=f"{MAIN_DATE} 09:30:00+09")
        + appt(a2, "no_show", f"{MAIN_DATE} 10:00:00+09", ns=f"{MAIN_DATE} 10:30:00+09")
        + appt(a3, "completed", f"{MAIN_DATE} 11:00:00+09")
        + appt(a4, "cancelled", f"{MAIN_DATE} 12:00:00+09")
        # KST 경계: 2020-04-10 23:30 UTC finalize → KST 04-11 귀속(paid 7000)
        + enc(cenc, "completed", "2020-04-10 10:00:00+09", completed="2020-04-10 10:30:00+09")
        + pay(pay3, cenc, 7000, 0, "2020-04-10 23:30:00+00", "R-20200410-000099")
        # 코호트: 등록 05-20·완료 05-21(KST·자정 넘김) → 완료는 registered_at 코호트(내원일) 귀속
        + enc(cohort, "completed", "2020-05-20 22:00:00+09", completed="2020-05-21 09:00:00+09")
        + "set session_replication_role = origin;"
    )
    proc = psql.run(sql)
    assert proc.returncode == 0, proc.stderr
    yield


def _ops(client, token: str, *, date: str, days: int = 1):
    return client.get(
        f"/v1/dashboard/operations?date={date}&days={days}", headers=_bearer(token)
    )


# ── 권한 게이트 ──────────────────────────────────────────────────────────────


def test_unauthenticated_401(client):
    """토큰 없음 → 401(unauthenticated)."""
    res = client.get(f"/v1/dashboard/operations?date={MAIN_DATE}")
    assert res.status_code == 401, res.text
    assert res.json()["error"]["code"] == "unauthenticated"


@pytest.mark.parametrize("role", ["reception", "doctor"])
def test_no_dashboard_permission_403(client, request, role):
    """dashboard.read 미보유(원무·의사) → 403 + required_permission 디테일."""
    token = request.getfixturevalue(f"{role}_token")
    res = _ops(client, token, date=MAIN_DATE)
    assert res.status_code == 403, res.text
    body = res.json()
    assert body["error"]["code"] == "forbidden"
    assert body["error"]["detail"] == {"required_permission": "dashboard.read"}


# ── 집계 정확성 ──────────────────────────────────────────────────────────────


def test_today_snapshot_aggregates(client, admin_token):
    """당일 스냅샷: 내원 4·대기 1·진료중 1·완료 2·순수납액 13000·노쇼율 2/3(refunded 차감 포함)."""
    res = _ops(client, admin_token, date=MAIN_DATE, days=1)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["as_of_date"] == MAIN_DATE
    t = body["today"]
    assert t["visits"] == 4
    assert t["waiting"] == 1
    assert t["in_progress"] == 1
    assert t["completed"] == 2
    assert t["revenue_net_krw"] == 13000  # 10000 + (5000−2000 환급)
    assert t["no_show_count"] == 2
    assert t["appointment_total"] == 3  # no_show 2 + completed 1 (cancelled 제외)
    assert t["no_show_rate"] == round(2 / 3, 4)
    # 스냅샷 내부 정합: 내원 = 대기 + 진료중 + 완료(세 카운트 모두 registered_at 코호트)
    assert t["visits"] == t["waiting"] + t["in_progress"] + t["completed"]


def test_daily_series_single_day(client, admin_token):
    """days=1 → daily_series 1점(당일과 일치)."""
    res = _ops(client, admin_token, date=MAIN_DATE, days=1)
    body = res.json()
    series = body["daily_series"]
    assert len(series) == 1
    p = series[0]
    assert p["date"] == MAIN_DATE
    assert p["visits"] == 4
    assert p["revenue_net_krw"] == 13000
    assert p["no_show_count"] == 2
    assert p["no_show_rate"] == round(2 / 3, 4)


def test_daily_series_window_fills_empty_days(client, admin_token):
    """days=3(13~15일) → 점 3개, 빈 13·14일은 0, 15일만 값."""
    res = _ops(client, admin_token, date=MAIN_DATE, days=3)
    series = res.json()["daily_series"]
    assert [p["date"] for p in series] == ["2020-03-13", "2020-03-14", "2020-03-15"]
    assert series[0]["visits"] == 0 and series[0]["revenue_net_krw"] == 0
    assert series[1]["no_show_rate"] == 0.0
    assert series[2]["visits"] == 4 and series[2]["revenue_net_krw"] == 13000


# ── KST 경계 · divide-by-zero · 빈 환경 ──────────────────────────────────────


def test_kst_boundary_attribution(client, admin_token):
    """2020-04-10 23:30 UTC finalize(7000) → KST 04-11 귀속, 04-10 에는 미포함."""
    res_kst = _ops(client, admin_token, date=BOUNDARY_KST_DATE, days=1)
    assert res_kst.json()["today"]["revenue_net_krw"] == 7000
    res_utc = _ops(client, admin_token, date="2020-04-10", days=1)
    assert res_utc.json()["today"]["revenue_net_krw"] == 0


def test_no_show_rate_divide_by_zero(client, admin_token):
    """예약 0인 날 → 노쇼율 0.0(NaN 아님)·분모 0."""
    res = _ops(client, admin_token, date=EMPTY_DATE, days=1)
    t = res.json()["today"]
    assert t["appointment_total"] == 0
    assert t["no_show_rate"] == 0.0


def test_empty_day_all_zero(client, admin_token):
    """데이터 없는 날 → 모든 KPI 0(빈 화면·크래시 없음)."""
    res = _ops(client, admin_token, date=EMPTY_DATE, days=1)
    assert res.status_code == 200, res.text
    t = res.json()["today"]
    assert t["visits"] == 0
    assert t["waiting"] == 0
    assert t["in_progress"] == 0
    assert t["completed"] == 0
    assert t["revenue_net_krw"] == 0
    assert t["no_show_count"] == 0


def test_completed_follows_registered_cohort(client, admin_token):
    """완료는 registered_at 코호트 기준(completed_at 아님) — 자정 넘김 건 내원일 귀속·완료일 미중복.

    코호트 건: 등록 2020-05-20·완료 2020-05-21(KST). completed_at 기준이면 05-21 에 completed=1·
    visits=0("완료 > 내원" 모순) → registered_at 기준이라 05-20 동시 귀속, 05-21 엔 0.
    """
    reg = _ops(client, admin_token, date="2020-05-20", days=1).json()["today"]
    assert reg["visits"] == 1
    assert reg["completed"] == 1  # registered_at 코호트 → 내원일에 완료로 집계
    assert reg["visits"] == reg["waiting"] + reg["in_progress"] + reg["completed"]  # 불변식
    comp = _ops(client, admin_token, date="2020-05-21", days=1).json()["today"]
    assert comp["visits"] == 0  # 완료일엔 미내원(registered_at != 05-21)
    assert comp["completed"] == 0  # completed_at 기준이면 1 — registered_at 기준이라 0(모순 회피)
