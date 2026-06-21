"""Story 2.5 — 마스터 시드(seed.sql) 적재·유효성 검증.

검증 대상: `supabase db reset`(마이그레이션 0001~0008 적용 후 seed.sql 실행)이 5개 마스터
테이블에 데모 데이터를 적재했고, 그 코드 행이 소비처 피커 술어("현재 유효")를 통과하는지.

실제 적용된 로컬 DB 를 단언한다(conftest psql fixture — 로컬 스택 없으면 skip).
잔존 통합테스트 데이터(랜덤 uuid 코드)에 흔들리지 않도록 **카운트 하한 + 특정 시드 코드 존재**로
단언한다(시드 코드 IM·R101·I10·AA154·645100250 는 결정적).

전제: `supabase db reset` 선행(seed.sql 이 적재돼 있어야 한다).
"""

from __future__ import annotations

# 테이블별 기대 최소 시드 행 수(seed.sql 과 동기 — 잔존 데이터가 있어도 하한은 보장).
_MIN_ROWS = {
    "departments": 7,
    "rooms": 8,
    "diagnoses": 22,
    "fee_schedules": 18,
    "drugs": 17,
}

# 테이블별 결정적 대표 시드 코드(존재·현재유효 단언용).
_SAMPLE_CODE = {
    "departments": "IM",
    "rooms": "R101",
    "diagnoses": "I10",
    "fee_schedules": "AA154",
    "drugs": "645100250",
}

# 유효기간 컬럼을 가진 코드 마스터(현재 유효 술어 적용 대상).
_DATED_TABLES = ("diagnoses", "fee_schedules", "drugs")


# ── AC1: 5개 테이블에 시드 적재(카운트 하한) ─────────────────────────────────


def test_seed_loads_all_master_tables(psql):
    """db reset 후 5개 마스터 테이블에 기대 최소 행 수 이상 적재됐다(AC1)."""
    for table, minimum in _MIN_ROWS.items():
        cnt = int(psql.scalar(f"select count(*) from public.{table};"))
        assert cnt >= minimum, f"{table} 시드 행 {cnt} < 기대 최소 {minimum} (seed.sql 미적재?)"


def test_seed_sample_codes_present(psql):
    """테이블별 결정적 대표 시드 코드가 존재한다(AC1·AC2 — 잔존 무관 결정적 단언)."""
    for table, code in _SAMPLE_CODE.items():
        cnt = int(
            psql.scalar(
                f"select count(*) from public.{table} where lower(code) = lower('{code}');"
            )
        )
        assert cnt == 1, f"{table} 시드 대표코드 '{code}' 부재/중복 (count={cnt})"


# ── AC2: 코드 마스터가 "현재 유효"(소비처 피커 노출 조건) ──────────────────────


def test_seed_code_masters_currently_valid(psql):
    """diagnoses·fee_schedules·drugs 대표 코드가 현재 유효 — is_active AND
    effective_from<=오늘 AND (effective_to IS NULL OR effective_to>=오늘) (AC2).
    이 술어를 통과해야 검색 피커(fetchCurrentlyValidMasters)에 노출된다.
    """
    for table in _DATED_TABLES:
        code = _SAMPLE_CODE[table]
        cnt = int(
            psql.scalar(
                f"select count(*) from public.{table} "
                f"where lower(code) = lower('{code}') and is_active "
                "and effective_from <= current_date "
                "and (effective_to is null or effective_to >= current_date);"
            )
        )
        assert cnt == 1, f"{table} '{code}' 가 현재 유효하지 않음(피커 미노출 — AC2 실패)"


def test_seed_no_future_or_inactive_code_rows(psql):
    """시드된 코드 마스터에 미래 발효/비활성 행이 없다 — 전부 즉시 유효(AC2 회귀 가드).
    (잔존 통합테스트 데이터는 미래/비활성일 수 있으나, 그것은 'X_<uuid>' 코드 — 시드 코드만 검사.)
    """
    # 시드 코드는 영숫자 짧은 토큰(잔존 통합테스트 데이터는 '_'+uuid 접미). '_' 없는(=시드 형태)
    # 행 중 미래 발효(effective_from > 오늘)거나 비활성이면 AC2 위반. 잔존('_' 코드)은 제외.
    for table in _DATED_TABLES:
        bad = int(
            psql.scalar(
                f"select count(*) from public.{table} "
                "where (effective_from > current_date or not is_active) and code !~ '_';"
            )
        )
        assert bad == 0, f"{table} 시드에 미래 발효/비활성 코드 {bad}건(AC2 — 즉시 유효여야 함)"


# ── AC1: departments·rooms FK 무결성(시드) ────────────────────────────────────


def test_seed_rooms_reference_departments(psql):
    """소속이 지정된 시드 진료실(R101~R106)이 실제 진료과를 참조한다(FK 해소 — AC1)."""
    # R101 은 IM(내과)에 소속돼야 한다.
    dept_code = psql.scalar(
        "select d.code from public.rooms r "
        "join public.departments d on d.id = r.department_id "
        "where lower(r.code) = lower('R101');"
    )
    assert dept_code == "IM", f"R101 소속 진료과가 IM 이 아님: {dept_code!r}"
    # 매핑된 진료실 R101~R106 은 전부 진료과를 참조해야 한다 — 서브셀렉트 미해소 시 무음 NULL 차단.
    orphan = int(
        psql.scalar(
            "select count(*) from public.rooms "
            "where lower(code) in ('r101','r102','r103','r104','r105','r106') "
            "and department_id is null;"
        )
    )
    assert orphan == 0, f"매핑된 시드 진료실 중 소속 NULL {orphan}건(서브셀렉트 미해소 — FK 누출)"
    # 공용 공간(처치실 TRT1)은 소속 없음(NULL) — 스키마상 허용.
    trt = psql.scalar(
        "select coalesce(department_id::text, 'NULL') from public.rooms "
        "where lower(code) = lower('TRT1');"
    )
    assert trt == "NULL", f"TRT1(처치실) 은 department_id NULL 이어야 함: {trt!r}"


# ── AC4: 수가 단가 무결성(KRW 정수·비음수) ────────────────────────────────────


def test_seed_fee_amounts_are_nonneg_integers(psql):
    """시드된 모든 수가 단가가 0 이상 정수다(KRW 정수 규약·CHECK 회귀 가드 — AC4)."""
    bad = int(psql.scalar("select count(*) from public.fee_schedules where amount_krw < 0;"))
    assert bad == 0, f"음수 단가 수가 {bad}건"
    # 대표 진찰료 단가가 양수로 적재됐는지(데모 신뢰성).
    amt = int(
        psql.scalar("select amount_krw from public.fee_schedules where lower(code)=lower('AA154');")
    )
    assert amt > 0, f"초진진찰료(AA154) 단가가 양수가 아님: {amt}"


# ── AC5: 멱등 — ON CONFLICT (lower(code)) 가 중복을 막는다 ─────────────────────


def test_seed_insert_is_idempotent_on_lower_code(psql):
    """ON CONFLICT (lower(code)) DO NOTHING 이 대소문자 무관 중복을 막는다(AC5).
    (a) **신규 throwaway 코드**를 대소문자로 2회 삽입 → 1행(충돌절이 실제로 dedup 함을 직접 증명 —
        비-vacuous: 코드가 사전 존재하지 않으므로 두 번째 삽입의 ON CONFLICT 가 발화해야만 1행).
    (b) 이미 시드된 'IM' 에 'im' 재삽입 → 여전히 1행(시드 위 멱등). 트랜잭션 내 검증 후 ROLLBACK.
    """
    out = psql.scalar(
        "begin;"
        # (a) 신규 코드를 대소문자로 2회 — 두 번째가 lower(code) 충돌로 무시돼야 1행.
        "insert into public.departments (code, name) values ('ZZTMPCI', 'dedup1') "
        "  on conflict (lower(code)) do nothing;"
        "insert into public.departments (code, name) values ('zztmpci', 'dedup2') "
        "  on conflict (lower(code)) do nothing;"
        # (b) 시드된 'IM' 위에 'im' 재삽입 — 무시돼야 1행.
        "insert into public.departments (code, name) values ('im', '중복내과') "
        "  on conflict (lower(code)) do nothing;"
        "select count(*) filter (where lower(code) = lower('ZZTMPCI'))"
        "     || ',' || count(*) filter (where lower(code) = lower('IM')) "
        "  from public.departments;"
        "rollback;"
    )
    rows = [
        ln.strip()
        for ln in out.splitlines()
        if ln.strip() and all(c.isdigit() or c == "," for c in ln.strip())
    ]
    assert rows and rows[-1] == "1,1", f"멱등 재삽입 후 (ZZTMPCI,IM) 행수가 (1,1) 아님: {out!r}"
