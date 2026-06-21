"use client";

import { Search, UserRound, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api/client";
import { fetchDepartments, type Department } from "@/lib/admin/masters";
import {
  createWalkInEncounter,
  ENCOUNTER_STATUS_META,
  walkInIntakeSchema,
  type Encounter,
} from "@/lib/reception/encounters";
import { searchPatients, sexLabel, type PatientListItem } from "@/lib/reception/patients";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// 환자 접수(원무 walk-in, FR-021). 환자 검색(Story 3.5 searchPatients 재사용)→선택→진료과 지정→접수.
// 쓰기 = FastAPI(apiFetch, encounter.register). 상태머신·감사·대기열은 DB 소유(0010) — INSERT 자체가
// 진료과 대기열 진입(4.3 현황판 소비). 🚫 검색어(이름·연락처 PII)는 로그·toast 에 남기지 않는다.
// 예약 환자 접수(register RPC)·대기 현황판은 4.3/Epic 6 — 본 화면은 walk-in 즉석 접수 데모.

const FIELD =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";
const LABEL = "block text-[12px] font-medium text-foreground";
const OPTION_BASE = "flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px] outline-none";

const DEBOUNCE_MS = 200;
const RESULT_LIMIT = 20; // searchPatients pageSize. 초과 시 "더 정확히 입력" 안내(오환자 방지).

export function PatientIntake() {
  const [patient, setPatient] = useState<PatientListItem | null>(null);
  const [departmentId, setDepartmentId] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptError, setDeptError] = useState<string | null>(null);
  const [created, setCreated] = useState<Encounter | null>(null);
  const [createdDeptName, setCreatedDeptName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // 동기 in-flight 락 — disabled 상태 반영(다음 렌더) 전 더블클릭/Enter 연타로 이중 제출되는 갭을
  // 막는다(중복 접수 1차선; 서버 중복 가드는 Open Q4 이월). ref 는 렌더 갭 없이 즉시 반영.
  const inFlight = useRef(false);

  // 진료과 목록 — Supabase 직접조회(단순 읽기 = RLS, 0006). 활성만 노출(폐과는 접수 대상 아님).
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    fetchDepartments(supabase)
      .then((rows) => {
        if (cancelled) return;
        setDepartments(rows.filter((d) => d.is_active));
        setDeptError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setDeptError("진료과 목록을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit() {
    if (inFlight.current) return; // 진행 중이면 재진입 차단(렌더 갭 이중 제출 1차선).
    setFormError(null);
    const parsed = walkInIntakeSchema.safeParse({
      patient_id: patient?.id ?? "",
      department_id: departmentId,
    });
    if (!parsed.success) {
      // 색 비의존 텍스트로 첫 위반 안내(환자·진료과 미선택).
      setFormError(parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요.");
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    try {
      const encounter = await createWalkInEncounter(parsed.data);
      setCreated(encounter);
      setCreatedDeptName(departments.find((d) => d.id === departmentId)?.name ?? "");
      toast.success(`${patient?.name ?? "환자"} 접수 완료 · 내원번호 ${encounter.encounter_no}`);
    } catch (err) {
      // 봉투 코드별 한국어 안내(비활성=422·권한=403·대상없음=404). 검색어/PII 미노출.
      const message =
        err instanceof ApiError
          ? err.code === "patient_inactive"
            ? "비활성 환자는 접수할 수 없습니다."
            : err.code === "department_inactive"
              ? "비활성 진료과로는 접수할 수 없습니다."
              : err.message
          : "접수하지 못했습니다. 다시 시도해 주세요.";
      toast.error(message);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function resetForm() {
    setCreated(null);
    setCreatedDeptName("");
    setPatient(null);
    setDepartmentId("");
    setFormError(null);
  }

  // ── 접수 완료 ──
  if (created) {
    const meta = ENCOUNTER_STATUS_META[created.status];
    return (
      <section className="space-y-5">
        <header>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">접수 완료</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            내원이 생성되어 진료과 대기열에 등록되었습니다.
          </p>
        </header>

        <dl className="grid grid-cols-[120px_1fr] gap-y-2.5 rounded-xl border border-border bg-card p-5 text-[13px]">
          <dt className="text-muted-foreground">내원번호</dt>
          <dd className="font-semibold tabular-nums text-foreground">{created.encounter_no}</dd>
          <dt className="text-muted-foreground">상태</dt>
          <dd>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px] font-medium",
                meta.badgeClass,
              )}
            >
              {meta.label}
            </span>
          </dd>
          <dt className="text-muted-foreground">진료과</dt>
          <dd className="text-foreground">{createdDeptName || "—"}</dd>
          <dt className="text-muted-foreground">접수경로</dt>
          <dd className="text-foreground">방문 접수(walk-in)</dd>
        </dl>

        <button
          type="button"
          onClick={resetForm}
          className="rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-white hover:bg-primary-hover"
        >
          새 환자 접수
        </button>
      </section>
    );
  }

  // ── 접수 입력 ──
  const canSubmit = !!patient && !!departmentId && !submitting;

  return (
    <section className="space-y-5">
      <header>
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">환자 접수</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          방문 환자를 검색·선택하고 진료과를 지정해 접수합니다. 내원이 생성되어 대기열에 등록됩니다.
        </p>
      </header>

      {/* 1. 환자 검색·선택 */}
      <div className="space-y-1">
        <span className={LABEL}>환자</span>
        {patient ? (
          <SelectedPatient patient={patient} onChange={() => setPatient(null)} />
        ) : (
          <PatientPicker onSelect={setPatient} />
        )}
      </div>

      {/* 2. 진료과 */}
      <label className="block space-y-1">
        <span className={LABEL}>진료과</span>
        <select
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          className={FIELD}
          aria-label="진료과"
          disabled={submitting || !!deptError}
        >
          <option value="" disabled>
            선택하세요
          </option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {deptError && (
          <span role="status" className="block text-[11.5px] text-status-cancelled">
            {deptError}
          </span>
        )}
      </label>

      {/* 접수 버튼 + 폼 에러(미선택) */}
      <div className="flex items-center justify-end gap-3">
        {formError && (
          <span role="status" className="text-[11.5px] text-status-cancelled">
            {formError}
          </span>
        )}
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {submitting ? "접수 중…" : "접수"}
        </button>
      </div>
    </section>
  );
}

/** 선택된 환자 요약 — 차트번호·생년월일·마스킹 주민번호·연락처(오환자 방지 식별 단서). */
function SelectedPatient({
  patient,
  onChange,
}: {
  patient: PatientListItem;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5 text-[13px]">
      <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="font-medium text-foreground">{patient.name}</span>
      <span className="tabular-nums text-muted-foreground">{patient.chart_no}</span>
      <span className="tabular-nums text-muted-foreground">
        {patient.birth_date} · {sexLabel(patient.sex)}
      </span>
      <span className="tabular-nums text-muted-foreground">{patient.resident_no_masked}</span>
      <span className="ml-auto shrink-0">
        <button
          type="button"
          onClick={onChange}
          className="rounded-md border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-foreground hover:bg-muted"
        >
          변경
        </button>
      </span>
    </div>
  );
}

/** 환자 검색 피커(Story 3.5 searchPatients 재사용). 선택 시 onSelect 로 폼 바인딩(전역 팔레트는 이동). */
function PatientPicker({ onSelect }: { onSelect: (patient: PatientListItem) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientListItem[]>([]);
  const [searchedTerm, setSearchedTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // 디바운스 + abort 검색(patient-search-command 동형). 공백이면 호출 안 함(전체 노출 방지).
  useEffect(() => {
    const term = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (!term) {
        setResults([]);
        setSearchedTerm("");
        setError(null);
        return;
      }
      searchPatients(term, controller.signal, RESULT_LIMIT)
        .then((rows) => {
          setResults(rows);
          setActiveIndex(0);
          setError(null);
          setSearchedTerm(term);
        })
        .catch(() => {
          if (controller.signal.aborted) return; // 다음 입력에 의한 취소 — 무시.
          setResults([]);
          setError("검색에 실패했습니다. 잠시 후 다시 시도해 주세요.");
          setSearchedTerm(term);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // 디바운스 정착 전(이전 검색어 결과 잔존) Enter 는 무시 — stale 결과로 오환자 선택 방지.
      if (searchedTerm !== query.trim()) return;
      const patient = results[activeIndex];
      if (patient) onSelect(patient);
    }
  }

  const trimmed = query.trim();
  const settled = searchedTerm === trimmed;
  const truncated = settled && !error && results.length >= RESULT_LIMIT;
  const statusText = !trimmed
    ? ""
    : !settled
      ? "검색 중…"
      : error
        ? error
        : results.length === 0
          ? "검색 결과 없음"
          : truncated
            ? `상위 ${RESULT_LIMIT}명 표시 — 더 정확히 입력하세요`
            : `${results.length}명 검색됨`;

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="환자 검색"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            results[activeIndex] ? `${listId}-opt-${results[activeIndex].id}` : undefined
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="환자 이름·차트번호·연락처 검색"
          className="h-10 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button
            type="button"
            aria-label="검색어 지우기"
            onClick={() => setQuery("")}
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      {trimmed && (
        <div className="max-h-[40vh] overflow-y-auto py-1">
          <ul role="listbox" id={listId} aria-label="검색 결과">
            {results.map((patient, i) => (
              <li
                key={patient.id}
                id={`${listId}-opt-${patient.id}`}
                role="option"
                aria-selected={i === activeIndex}
                onMouseMove={() => setActiveIndex(i)}
                onClick={() => onSelect(patient)}
                className={cn(OPTION_BASE, i === activeIndex && "bg-primary/10")}
              >
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {patient.name}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {patient.chart_no}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {patient.birth_date} · {sexLabel(patient.sex)}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {patient.resident_no_masked}
                </span>
              </li>
            ))}
          </ul>

          {statusText && results.length === 0 && (
            <p className="px-3 py-5 text-center text-[12.5px] text-muted-foreground">{statusText}</p>
          )}
          {truncated && (
            <p className="border-t border-border px-3 py-2 text-[12px] text-muted-foreground">
              상위 {RESULT_LIMIT}명만 표시됩니다. 이름·차트번호·연락처를 더 정확히 입력하세요.
            </p>
          )}
        </div>
      )}

      {/* aria-live polite — 결과 개수/상태 안내(PII 미낭독). */}
      <div role="status" aria-live="polite" className="sr-only">
        {statusText}
      </div>
    </div>
  );
}
