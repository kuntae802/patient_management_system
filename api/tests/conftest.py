"""DB 마이그레이션 검증용 공통 헬퍼.

새 Python DB 드라이버를 추가하지 않기 위해(스키마 단일 소유 · db.py 배선은 Story 1.5),
실행 중인 Supabase 로컬 db 컨테이너에 `docker exec`로 psql을 실행해 실제 적용된
스키마를 단언한다. 로컬 스택이 없으면 해당 테스트는 skip 한다(CI는 관대 posture).

전제: `supabase start` + 마이그레이션 적용(`supabase db reset`)이 선행되어 있어야 한다.
"""

from __future__ import annotations

import shutil
import subprocess

import pytest

DB_CONTAINER = "supabase_db_patient_management_system"
DB_CONTAINER_PREFIX = "supabase_db_"


def _find_db_container() -> str | None:
    """실행 중인 이 프로젝트의 supabase db 컨테이너를 찾는다.

    동일 호스트에 여러 Supabase 프로젝트가 떠 있을 수 있으므로 프로젝트 전체 이름을
    우선 매칭하고, 없을 때만 prefix 로 폴백한다(타 프로젝트 DB 오선택 방지).
    """
    if shutil.which("docker") is None:
        return None
    try:
        out = subprocess.run(
            ["docker", "ps", "--format", "{{.Names}}"],
            capture_output=True,
            text=True,
            timeout=15,
            check=True,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    names = [n.strip() for n in out.stdout.splitlines() if n.strip()]
    if DB_CONTAINER in names:
        return DB_CONTAINER
    for name in names:
        if name.startswith(DB_CONTAINER_PREFIX):
            return name
    return None


class Psql:
    """db 컨테이너 안에서 psql을 실행하는 얇은 래퍼."""

    def __init__(self, container: str) -> None:
        self.container = container

    def run(self, sql: str, *, dbname: str = "postgres") -> subprocess.CompletedProcess[str]:
        """SQL을 stdin으로 전달(다중 문장·따옴표 안전). ON_ERROR_STOP=1로 첫 오류에 실패."""
        return subprocess.run(
            [
                "docker",
                "exec",
                "-i",
                self.container,
                "psql",
                "-U",
                "postgres",
                "-d",
                dbname,
                "-tA",
                "-v",
                "ON_ERROR_STOP=1",
            ],
            input=sql,
            capture_output=True,
            text=True,
            timeout=30,
        )

    def scalar(self, sql: str, *, dbname: str = "postgres") -> str:
        """단일 스칼라 결과 문자열을 반환(앞뒤 공백 제거). 오류 시 AssertionError."""
        proc = self.run(sql, dbname=dbname)
        assert proc.returncode == 0, f"psql 실패: {sql!r}\nstderr: {proc.stderr.strip()}"
        return proc.stdout.strip()

    def expect_error(self, sql: str, *, dbname: str = "postgres") -> str:
        """SQL이 반드시 실패해야 하는 경우. stderr를 반환."""
        proc = self.run(sql, dbname=dbname)
        assert proc.returncode != 0, f"실패를 기대했으나 성공함: {sql!r}\n{proc.stdout.strip()}"
        return proc.stderr.strip()


@pytest.fixture(scope="session")
def psql() -> Psql:
    container = _find_db_container()
    if container is None:
        pytest.skip("Supabase 로컬 db 컨테이너 미실행 — 'supabase start' 후 재실행")
    return Psql(container)
