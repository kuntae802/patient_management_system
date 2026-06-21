"""환자 등록(Story 3.1 AC1·2·3) 통합 테스트 — 실 Supabase 토큰 + asyncpg + 0009.

로컬 스택(`supabase start` + `db reset`)/부트스트랩 계정이 없으면 skip. 검증:
  · AC1: admin 토큰으로 환자 생성 → 201 + chart_no 부여 + auth_uid NULL + 응답에 _enc/_hash 미포함
  · AC1: DB 영속(resident_no_enc/_hash 실제 저장) + 암호화 라운드트립(decrypt = 정규화 원본)
  · AC2: HARD 실패 → 422 / SOFT(체크섬) → 201 통과
  · AC2: 정규화 멱등 — 하이픈 유/무 동일 주민번호 → 같은 hash → 두 번째 409 patient_exists
  · AC2: 비-patient.create(doctor) → 403
  · AC3: RLS — 직원 전체 행 / 환자 본인행만(타인 NULL-auth 비가시) / _enc·_hash 컬럼 거부

⚠️ 생성행은 잔존(soft delete만, db reset 이 초기화)하므로 주민번호는 매 실행 고유값(세션 카운터).
   psql 로 직접 넣는 RLS 검증 행은 begin/rollback 으로 정리한다.
"""

from __future__ import annotations

import itertools
import os
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.rrn import normalize_rrn
from tests.conftest import Psql

_API = os.getenv("SUPABASE_API_URL", "http://127.0.0.1:54321")
_PUBLISHABLE = os.getenv(
    "SUPABASE_PUBLISHABLE_KEY", "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
)
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
        pytest.skip("doctor 부트스트랩 계정 미가용 — 'supabase db reset'(seed 갱신) 후 재실행")
    return token


@pytest.fixture(scope="module")
def admin_id(psql: Psql) -> str:
    """관리자 auth uid — patient.read 보유(전권) → RLS 직원 정책 통과 기준."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'admin' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def doctor_id(psql: Psql) -> str:
    """의사 auth uid — 권한 0(patient.read 미보유) + auth.users 실재(FK). RLS '본인행만' 검증 기준.

    staff 정책(has_permission)은 false 라 전체 행이 안 보이고, self 정책(auth.uid()=auth_uid)으로
    본인 행만 보이는지 확인(별도 환자 계정 생성은 3.4 — 기존 uid 재사용)."""
    return psql.scalar(
        "select u.id::text from public.users u "
        "join public.roles r on r.id = u.role_id where r.code = 'doctor' limit 1"
    ).lower()


@pytest.fixture(scope="module")
def client(admin_token: str):
    # with-블록 = lifespan 실행(asyncpg 풀 생성). 풀 없이는 권한 평가·쓰기 불가.
    with TestClient(app) as test_client:
        yield test_client


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _as_authenticated(uid: str) -> str:
    """psql 조각 — authenticated 역할 전환 + JWT 주체 GUC 주입(RLS auth.uid() 평가용)."""
    claims = '{"sub":"' + uid + '","role":"authenticated"}'
    return (
        "set local role authenticated;"
        "select set_config('request.jwt.claims', '" + claims + "', true);"
    )


# 꼬리 6자리 = 세션 base(uuid 파생, cross-session 분산) + 단조 카운터(intra-session 충돌 0). DB 행이
# db reset 없이 누적돼도 base 가 세션마다 달라 재실행 충돌이 사실상 없다(결정적 카운터의 누적 충돌
# 회피). YYMMDD=900101·성별 1 고정으로 masked/birth/sex 단언은 안정.
_RRN_BASE = uuid.uuid4().int % 1_000_000
_rrn_seq = itertools.count()


def _unique_rrn() -> str:
    """매 실행 고유한 HARD-통과 주민번호. YYMMDD=900101·성별 1(내국·1900s·male) 고정, 꼬리 6자리는
    세션 base+카운터로 **intra-session 충돌 0** + cross-session 분산. 체크섬(SOFT)은 비보장.
    """
    tail = (_RRN_BASE + next(_rrn_seq)) % 1_000_000
    return f"9001011{tail:06d}"  # 13자리: 900101 + 1 + 6자리


def _create_payload(resident_no: str) -> dict:
    return {
        "resident_no": resident_no,
        "name": "통합테스트환자",
        "phone": "010-1234-5678",
        "insurance_type": "health_insurance",
    }


# ── AC1: 생성 + chart_no + 응답 PII 경계 ──────────────────────────────────────


def test_create_patient_returns_chart_no_and_masks_rrn(client, admin_token):
    rrn = _unique_rrn()
    res = client.post(_PATIENTS_URL, json=_create_payload(rrn), headers=_bearer(admin_token))
    assert res.status_code == 201, res.text
    body = res.json()
    # chart_no 부여 + auth_uid 미설정(응답에 노출 안 함) + 서버 파생 birth/sex.
    assert body["chart_no"] and body["chart_no"].isdigit()
    assert body["birth_date"] == "1990-01-01"
    assert body["sex"] == "male"
    # 마스킹만 노출 — raw·암호문·blind index 절대 미포함(PII 경계).
    assert body["resident_no_masked"] == "900101-1******"
    assert "resident_no" not in body
    assert "resident_no_enc" not in body
    assert "resident_no_hash" not in body
    assert rrn not in res.text  # raw 주민번호가 응답 어디에도 없음


def test_create_patient_persists_and_roundtrips(client, admin_token, psql):
    """DB 영속(응답 echo 아님) + 암호화 라운드트립(decrypt = 정규화 원본)."""
    rrn = _unique_rrn()
    res = client.post(_PATIENTS_URL, json=_create_payload(rrn), headers=_bearer(admin_token))
    assert res.status_code == 201, res.text
    pid = res.json()["id"]

    # _enc 영속 + _hash 64hex 영속(응답엔 없던 컬럼을 DB 에서 직접 확인).
    persisted = psql.scalar(
        f"select (resident_no_enc is not null) and (length(resident_no_hash)=64) "
        f"from public.patients where id='{pid}'"
    )
    assert persisted == "t", "resident_no_enc/_hash 가 DB 에 영속되지 않음"

    # 암호화 라운드트립: decrypt(저장된 암호문) = 정규화 원본(서버는 정규화 13자리를 암호화).
    decrypted = psql.scalar(
        f"select public.decrypt_sensitive(resident_no_enc, 'patients', id::text) "
        f"from public.patients where id='{pid}'"
    )
    assert decrypted == normalize_rrn(rrn)

    # auth_uid 는 NULL(원무 직접 등록).
    auth_uid = psql.scalar(
        f"select coalesce(auth_uid::text,'NULL') from public.patients where id='{pid}'"
    )
    assert auth_uid == "NULL"


# ── AC2: 검증(HARD/SOFT) + 중복 + 권한 ────────────────────────────────────────


@pytest.mark.parametrize(
    "bad_rrn,reason,expected_code",
    [
        # 길이 미달은 Pydantic 경계가 먼저 차단(validation_error) — 3중 검증의 클라/서버 1선.
        ("123", "형식(길이 미달)", "validation_error"),
        # 길이는 통과(≤14)하되 서비스 rrn HARD 가 차단(invalid_rrn).
        ("900101-9234567", "성별·세기 자리(9)", "invalid_rrn"),
        ("901301-1234567", "생년월일(13월)", "invalid_rrn"),
    ],
)
def test_create_patient_hard_invalid_rrn_422(client, admin_token, bad_rrn, reason, expected_code):
    res = client.post(_PATIENTS_URL, json=_create_payload(bad_rrn), headers=_bearer(admin_token))
    assert res.status_code == 422, f"{reason} HARD 미차단: {res.text}"
    assert res.json()["error"]["code"] == expected_code, res.text
    assert bad_rrn not in res.text  # 에러봉투에 원본 미echo


def test_create_patient_soft_checksum_passes(client, admin_token):
    """체크섬 불일치(SOFT)는 차단하지 않는다 — _unique_rrn 은 체크섬 비보장이나 201."""
    # 명시적으로 체크섬이 틀린 값(HARD 는 통과): 900101-1234560(체크섬 자리 임의).
    res = client.post(
        _PATIENTS_URL, json=_create_payload("900101-1234560"), headers=_bearer(admin_token)
    )
    # 이미 존재하면 409(이전 실행 잔존) — SOFT 통과의 증거는 422 가 아님을 확인.
    assert res.status_code in (201, 409), res.text
    if res.status_code == 409:
        assert res.json()["error"]["code"] == "patient_exists"


def test_duplicate_rrn_normalized_conflict(client, admin_token):
    """정규화 멱등(A-1): 하이픈 유/무 동일 주민번호 → 같은 hash → 두 번째 409 + 기존 chart_no."""
    rrn = _unique_rrn()
    first = client.post(_PATIENTS_URL, json=_create_payload(rrn), headers=_bearer(admin_token))
    assert first.status_code == 201, first.text
    existing_chart_no = first.json()["chart_no"]

    # 같은 번호를 하이픈 넣어 재등록 → 정규화하면 동일 → UNIQUE(hash) 위반 → 409.
    hyphenated = f"{rrn[:6]}-{rrn[6:]}"
    second = client.post(
        _PATIENTS_URL, json=_create_payload(hyphenated), headers=_bearer(admin_token)
    )
    assert second.status_code == 409, second.text
    body = second.json()
    assert body["error"]["code"] == "patient_exists"
    assert body["error"]["detail"]["chart_no"] == existing_chart_no  # 기존 환자로 안내


def test_create_patient_invalid_email_422(client, admin_token):
    """이메일 형식 검증(입력 하드닝) — 비어있지 않은 잘못된 이메일 → 422."""
    payload = {**_create_payload(_unique_rrn()), "email": "not-an-email"}
    res = client.post(_PATIENTS_URL, json=payload, headers=_bearer(admin_token))
    assert res.status_code == 422, res.text


def test_create_patient_forbidden_without_permission(client, doctor_token):
    """doctor(권한 0)는 patient.create 미보유 → 403."""
    res = client.post(
        _PATIENTS_URL, json=_create_payload(_unique_rrn()), headers=_bearer(doctor_token)
    )
    assert res.status_code == 403, res.text
    assert res.json()["error"]["code"] == "forbidden"


# ── AC1: 조회(마스킹) + 권한 ──────────────────────────────────────────────────


def test_list_and_get_patient_masked(client, admin_token):
    rrn = _unique_rrn()
    created = client.post(_PATIENTS_URL, json=_create_payload(rrn), headers=_bearer(admin_token))
    assert created.status_code == 201, created.text
    pid = created.json()["id"]

    listed = client.get(_PATIENTS_URL, headers=_bearer(admin_token))
    assert listed.status_code == 200, listed.text
    page = listed.json()
    assert "data" in page and "meta" in page and page["meta"]["total"] >= 1
    assert "resident_no_enc" not in listed.text and "resident_no_hash" not in listed.text

    detail = client.get(f"{_PATIENTS_URL}/{pid}", headers=_bearer(admin_token))
    assert detail.status_code == 200, detail.text
    assert detail.json()["resident_no_masked"] == "900101-1******"


def test_list_patients_forbidden_without_read(client, doctor_token):
    res = client.get(_PATIENTS_URL, headers=_bearer(doctor_token))
    assert res.status_code == 403, res.text


# ── AC3: RLS 경계(psql, 방어심층) ─────────────────────────────────────────────


def test_rls_staff_with_read_sees_patients(client, admin_token, admin_id, psql):
    """직원(patient.read=admin) authenticated 세션은 RLS 직원 정책으로 환자 행을 받는다."""
    # 최소 1행 보장(committed).
    client.post(_PATIENTS_URL, json=_create_payload(_unique_rrn()), headers=_bearer(admin_token))
    count = psql.scalar(
        "begin;"
        + _as_authenticated(admin_id)
        + "select count(*) from public.patients;"
        "rollback;"
    )
    nums = [ln.strip() for ln in count.splitlines() if ln.strip().lstrip("-").isdigit()]
    assert nums and int(nums[-1]) >= 1, f"직원 RLS 가 환자 행을 차단함: {count!r}"


def test_rls_patient_sees_only_own_row(client, admin_token, doctor_id, psql):
    """환자 본인행 격리 — 본인 auth_uid 행만 가시, 타인(NULL-auth) 행 비가시(자기 권한 없음).

    doctor_id(권한 0·auth.users 실재)를 본인 uid 로 가장한다 — staff 정책 false 라 self 정책만 작동.
    """
    # 타인 행(auth_uid NULL) 최소 1개 committed 보장 — 격리되어 안 보여야 함.
    client.post(_PATIENTS_URL, json=_create_payload(_unique_rrn()), headers=_bearer(admin_token))
    # postgres(슈퍼유저)로 본인 행 1개 삽입 → set role authenticated 로 격리 검증 → rollback.
    out = psql.scalar(
        "begin;"
        "insert into public.patients(name, birth_date, sex, resident_no_enc, resident_no_hash, "
        "  resident_no_masked, insurance_type, auth_uid) "
        "values ('RLS본인','1990-01-01','male','\\x00'::bytea,"
        "  '__rls_self__'||gen_random_uuid()::text,"
        "  '900101-1******','health_insurance','" + doctor_id + "');"
        + _as_authenticated(doctor_id)
        # 가시 행이 모두 본인 것인지(타인 행 누출 없음) + 본인 행은 보이는지.
        + "select coalesce(bool_and(auth_uid::text = '" + doctor_id + "'), false)::text "
        "  || '|' || count(*)::text from public.patients;"
        "rollback;"
    )
    verdict = [ln.strip() for ln in out.splitlines() if "|" in ln][-1]
    all_own, visible = verdict.split("|")
    assert all_own == "true", f"환자 세션에 타인 행이 누출됨: {out!r}"
    assert int(visible) >= 1, "환자 본인행이 보이지 않음(self 정책 실패)"


def test_rls_authenticated_cannot_select_ciphertext_columns(client, admin_token, admin_id, psql):
    """컬럼 방어심층: authenticated 는 _enc/_hash 를 SELECT 할 수 없다(컬럼 GRANT 제외)."""
    client.post(_PATIENTS_URL, json=_create_payload(_unique_rrn()), headers=_bearer(admin_token))
    for col in ("resident_no_enc", "resident_no_hash"):
        err = psql.expect_error(
            "begin;"
            + _as_authenticated(admin_id)
            + f"select {col} from public.patients limit 1;"
            "rollback;"
        )
        assert "permission denied" in err.lower(), f"{col} 컬럼 접근이 차단되지 않음: {err}"


# ── Story 3.2: 임상 프로필 입력·조회·권한·감사 (AC1·2·3) ────────────────────────

_CLINICAL_PAYLOAD = {
    "blood_type": "A+",
    "allergies": "페니실린, 아스피린",
    "chronic_diseases": "고혈압",
    "medications": "와파린 5mg",
    "notes": "고령 환자, 보호자 동반",
}


def _create_patient(client, token: str) -> str:
    res = client.post(_PATIENTS_URL, json=_create_payload(_unique_rrn()), headers=_bearer(token))
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_update_clinical_profile_persists_and_returns(client, admin_token, psql):
    """AC1: 갱신 → 200 + 응답 반영 + DB 영속. AC2: GET 상세가 임상필드 반환. PII 경계 유지."""
    pid = _create_patient(client, admin_token)
    res = client.put(
        f"{_PATIENTS_URL}/{pid}/clinical-profile",
        json=_CLINICAL_PAYLOAD,
        headers=_bearer(admin_token),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["blood_type"] == "A+"
    assert body["allergies"] == "페니실린, 아스피린"
    # DB 영속(응답 echo 아님 — 직접 조회).
    persisted = psql.scalar(
        f"select blood_type || '|' || allergies from public.patients where id='{pid}'"
    )
    assert "A+|페니실린" in persisted, persisted
    # AC2: GET 상세가 임상필드 반환.
    got = client.get(f"{_PATIENTS_URL}/{pid}", headers=_bearer(admin_token))
    assert got.status_code == 200, got.text
    assert got.json()["chronic_diseases"] == "고혈압"
    # PII 경계: _enc/_hash 미노출.
    assert "resident_no_enc" not in res.text and "resident_no_hash" not in res.text


def test_update_clinical_profile_full_replace_clears_omitted(client, admin_token):
    """PUT 전체 교체: 미전송 필드는 None 으로 비워진다(부분 PATCH 아님)."""
    pid = _create_patient(client, admin_token)
    first = client.put(
        f"{_PATIENTS_URL}/{pid}/clinical-profile",
        json=_CLINICAL_PAYLOAD,
        headers=_bearer(admin_token),
    )
    assert first.status_code == 200, first.text
    # 두 번째 PUT 은 blood_type 만 — 나머지는 미전송 → null(전체 교체 의미).
    res = client.put(
        f"{_PATIENTS_URL}/{pid}/clinical-profile",
        json={"blood_type": "O-"},
        headers=_bearer(admin_token),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["blood_type"] == "O-"
    assert body["allergies"] is None
    assert body["medications"] is None


def test_update_clinical_profile_invalid_blood_type_422(client, admin_token):
    """blood_type 폐쇄어휘 위반 → 422(검증 서버 tier)."""
    pid = _create_patient(client, admin_token)
    res = client.put(
        f"{_PATIENTS_URL}/{pid}/clinical-profile",
        json={"blood_type": "Z+"},
        headers=_bearer(admin_token),
    )
    assert res.status_code == 422, res.text


def test_update_clinical_profile_not_found_404(client, admin_token):
    """미존재 환자 → 404."""
    res = client.put(
        f"{_PATIENTS_URL}/{uuid.uuid4()}/clinical-profile",
        json=_CLINICAL_PAYLOAD,
        headers=_bearer(admin_token),
    )
    assert res.status_code == 404, res.text


def test_update_clinical_profile_forbidden_without_permission(client, admin_token, doctor_token):
    """AC3: patient.update 미보유(doctor 권한 0) → 403. 환자는 admin 으로 생성."""
    pid = _create_patient(client, admin_token)
    res = client.put(
        f"{_PATIENTS_URL}/{pid}/clinical-profile",
        json=_CLINICAL_PAYLOAD,
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 403, res.text
    assert res.json()["error"]["code"] == "forbidden"


def test_update_clinical_profile_is_audited(client, admin_token, psql):
    """갱신은 0009 감사 트리거가 자동 기록(action='update', target_table='patients')."""
    pid = _create_patient(client, admin_token)
    res = client.put(
        f"{_PATIENTS_URL}/{pid}/clinical-profile",
        json=_CLINICAL_PAYLOAD,
        headers=_bearer(admin_token),
    )
    assert res.status_code == 200, res.text
    count = psql.scalar(
        "select count(*) from public.audit_logs "
        f"where target_table='patients' and target_id='{pid}' and action='update'"
    )
    assert int(count) >= 1, "임상 프로필 갱신이 감사 로그에 기록되지 않음"


# ── 보호자(guardians) CRUD (Story 3.3 AC1·2·3) ──────────────────────────────────

_GUARDIAN_PAYLOAD = {"name": "김보호", "relationship": "배우자", "phone": "010-1234-5678"}


def _create_guardian(client, token: str, pid: str, payload: dict | None = None) -> dict:
    res = client.post(
        f"{_PATIENTS_URL}/{pid}/guardians",
        json=payload or _GUARDIAN_PAYLOAD,
        headers=_bearer(token),
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_create_guardian_persists_and_links(client, admin_token, psql):
    """AC1: 보호자 추가 → 201 + 필드 + patient_id 연결 + DB 영속."""
    pid = _create_patient(client, admin_token)
    body = _create_guardian(client, admin_token, pid)
    assert body["name"] == "김보호"
    assert body["relationship"] == "배우자"
    assert body["phone"] == "010-1234-5678"
    assert body["patient_id"] == pid
    persisted = psql.scalar(
        f"select name || '|' || relationship from public.guardians where id='{body['id']}'"
    )
    assert persisted == "김보호|배우자", persisted


def test_list_guardians_returns_added(client, admin_token):
    """AC1: 추가한 보호자가 목록 GET 에 나타난다(직접 배열)."""
    pid = _create_patient(client, admin_token)
    created = _create_guardian(client, admin_token, pid)
    res = client.get(f"{_PATIENTS_URL}/{pid}/guardians", headers=_bearer(admin_token))
    assert res.status_code == 200, res.text
    ids = [g["id"] for g in res.json()]
    assert created["id"] in ids


def test_update_guardian_full_replace_clears_omitted(client, admin_token, psql):
    """AC1: 수정(전체 교체) → 반영 + DB 영속. 미전송 phone → null."""
    pid = _create_patient(client, admin_token)
    g = _create_guardian(client, admin_token, pid)
    res = client.put(
        f"{_PATIENTS_URL}/{pid}/guardians/{g['id']}",
        json={"name": "이보호", "relationship": "자녀"},  # phone 미전송 → null
        headers=_bearer(admin_token),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["name"] == "이보호"
    assert body["relationship"] == "자녀"
    assert body["phone"] is None
    persisted = psql.scalar(
        f"select coalesce(phone, 'NULL') from public.guardians where id='{g['id']}'"
    )
    assert persisted == "NULL", persisted


def test_delete_guardian_removes_row(client, admin_token, psql):
    """AC1: 삭제 → 204 + DB 행 소멸(hard delete)."""
    pid = _create_patient(client, admin_token)
    g = _create_guardian(client, admin_token, pid)
    res = client.delete(f"{_PATIENTS_URL}/{pid}/guardians/{g['id']}", headers=_bearer(admin_token))
    assert res.status_code == 204, res.text
    count = psql.scalar(f"select count(*) from public.guardians where id='{g['id']}'")
    assert int(count) == 0, "보호자 행이 삭제되지 않음"


def test_create_guardian_patient_not_found_404(client, admin_token):
    """AC2: 미존재 환자에 보호자 추가 → 404(FK 위반 매핑)."""
    res = client.post(
        f"{_PATIENTS_URL}/{uuid.uuid4()}/guardians",
        json=_GUARDIAN_PAYLOAD,
        headers=_bearer(admin_token),
    )
    assert res.status_code == 404, res.text


def test_update_guardian_not_found_404(client, admin_token):
    """AC2: 미존재 보호자 수정 → 404."""
    pid = _create_patient(client, admin_token)
    res = client.put(
        f"{_PATIENTS_URL}/{pid}/guardians/{uuid.uuid4()}",
        json=_GUARDIAN_PAYLOAD,
        headers=_bearer(admin_token),
    )
    assert res.status_code == 404, res.text


def test_update_guardian_missing_required_field_422(client, admin_token):
    """AC1/AC2: PUT 전체 교체에서 필수필드(name) 누락 → 422(Pydantic 검증, 권한 평가 전 차단)."""
    pid = _create_patient(client, admin_token)
    g = _create_guardian(client, admin_token, pid)
    res = client.put(
        f"{_PATIENTS_URL}/{pid}/guardians/{g['id']}",
        json={"relationship": "자녀"},  # name 누락
        headers=_bearer(admin_token),
    )
    assert res.status_code == 422, res.text


def test_guardian_wrong_patient_scope_404(client, admin_token):
    """AC2: 타 환자(B)의 경로로 환자 A 보호자 수정·삭제 시도 → 404(IDOR 차단, patient_id 스코프)."""
    pid_a = _create_patient(client, admin_token)
    pid_b = _create_patient(client, admin_token)
    g = _create_guardian(client, admin_token, pid_a)
    # 환자 B 경로 + 환자 A 보호자 id → 0행 매칭 → 404.
    upd = client.put(
        f"{_PATIENTS_URL}/{pid_b}/guardians/{g['id']}",
        json=_GUARDIAN_PAYLOAD,
        headers=_bearer(admin_token),
    )
    assert upd.status_code == 404, upd.text
    dele = client.delete(
        f"{_PATIENTS_URL}/{pid_b}/guardians/{g['id']}", headers=_bearer(admin_token)
    )
    assert dele.status_code == 404, dele.text


def test_guardian_write_forbidden_without_permission(client, admin_token, doctor_token):
    """AC2: patient.update 미보유(doctor 권한 0) → 쓰기 403. 환자·보호자는 admin 으로 생성."""
    pid = _create_patient(client, admin_token)
    res = client.post(
        f"{_PATIENTS_URL}/{pid}/guardians",
        json=_GUARDIAN_PAYLOAD,
        headers=_bearer(doctor_token),
    )
    assert res.status_code == 403, res.text
    assert res.json()["error"]["code"] == "forbidden"


def test_guardian_read_forbidden_without_permission(client, admin_token, doctor_token):
    """AC2: patient.read 미보유(doctor 권한 0) → 목록 조회 403."""
    pid = _create_patient(client, admin_token)
    res = client.get(f"{_PATIENTS_URL}/{pid}/guardians", headers=_bearer(doctor_token))
    assert res.status_code == 403, res.text


def test_guardian_mutations_are_audited(client, admin_token, psql):
    """AC1: 추가·수정·삭제가 0009 trg_guardians_audit 로 자동 기록(target_table='guardians')."""
    pid = _create_patient(client, admin_token)
    g = _create_guardian(client, admin_token, pid)
    gid = g["id"]
    client.put(
        f"{_PATIENTS_URL}/{pid}/guardians/{gid}",
        json={"name": "박보호", "relationship": "부모"},
        headers=_bearer(admin_token),
    )
    client.delete(f"{_PATIENTS_URL}/{pid}/guardians/{gid}", headers=_bearer(admin_token))
    # 0004 트리거 매핑: INSERT→'create', UPDATE→'update', DELETE→'delete'.
    for action in ("create", "update", "delete"):
        count = psql.scalar(
            "select count(*) from public.audit_logs "
            f"where target_table='guardians' and target_id='{gid}' and action='{action}'"
        )
        assert int(count) >= 1, f"보호자 {action} 가 감사 로그에 기록되지 않음"
