"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { usePermissions } from "@/hooks/use-permissions";
import { searchPatients, sexLabel, type PatientListItem } from "@/lib/reception/patients";
import { cn } from "@/lib/utils";

// 전역 환자 검색 — Ctrl K 커맨드 팔레트(Story 3.5, UX-DR5·DR24). 탑바의 검색 자리 = 트리거.
// 어느 직원 화면에서든 Ctrl K 로 열려 이름·차트번호·연락처로 검색(GET /patients?q=) → 선택 시
// 환자 상세(/patients/{id}, UUID·불투명)로 이동. 결과는 마스킹(_PatientListItem_)·per-row reveal 없음.
// 동명이인 오환자 방지: 행에 생년월일+마스킹 주민번호+연락처를 식별 단서로 함께 표시(임상안전).
// RBAC 노출: patient.read 보유 직원에게만(미보유 → 트리거·단축키 미렌더, 사이드바 게이트 동형).
// 🚫 검색어(이름·연락처 PII)는 로그·toast 에 남기지 않는다. 보안 경계는 API(require_permission 403).

const TRIGGER =
  "ml-2 flex h-[33px] w-full max-w-[380px] items-center gap-2 rounded-md bg-muted px-2.5 text-left text-[13px] text-muted-foreground hover:bg-accent";
const POPUP =
  "fixed left-1/2 top-[12vh] z-50 flex max-h-[70vh] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg outline-none";
const OPTION_BASE =
  "flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px] outline-none";

const DEBOUNCE_MS = 200;
const RESULT_LIMIT = 20; // 팔레트 표시 상한(searchPatients pageSize). 초과 시 "더 정확히 입력" 안내.

export function PatientSearchCommand() {
  const { has } = usePermissions();
  const canSearch = has("patient.read");

  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientListItem[]>([]);
  // 결과를 만든 검색어 — query 와 다르면 "검색 중"(아직 미정착). loading 불리언 대신 파생(플리커 제거).
  const [searchedTerm, setSearchedTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // 전역 Ctrl K(Windows 우선; Mac ⌘K 도 방어 허용 — 표기는 항상 "Ctrl K"). 입력 포커스 중에도 가로챈다.
  useEffect(() => {
    if (!canSearch) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canSearch]);

  // 디바운스 + abort 검색. 공백이면 호출 안 함(전체 목록 노출 방지). 이전 요청은 취소(경쟁 결과 방지).
  // 모든 setState 는 타이머/프로미스 콜백(비동기) 안에서만 — effect 내 동기 setState 회피(프로젝트 선례).
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

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // 닫을 때 상태 초기화(다음 열기 때 잔여 검색어·결과 없음).
      setQuery("");
      setResults([]);
      setSearchedTerm("");
      setError(null);
      setActiveIndex(0);
    }
  }

  function select(patient: PatientListItem) {
    handleOpenChange(false);
    router.push(`/patients/${patient.id}`); // 식별자 = UUID(불투명·PII 아님).
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // 디바운스 정착 전(이전 검색어 결과 잔존) Enter 는 무시 — stale 결과로 오환자 이동 방지.
      if (searchedTerm !== query.trim()) return;
      const patient = results[activeIndex];
      if (patient) select(patient);
    }
    // Escape 는 Base UI Dialog 가 처리(닫기 + 포커스 복원).
  }

  const trimmed = query.trim();
  const settled = searchedTerm === trimmed; // 현재 검색어 결과가 정착했는가(아니면 검색 중).
  // 표시 상한(RESULT_LIMIT) 도달 = 더 많은 환자가 잘렸을 수 있음(동명이인 누락·오환자 방지 안내 필요).
  const truncated = settled && !error && results.length >= RESULT_LIMIT;
  // aria-live 안내 — 개수·상태만(PII 미낭독). 색 비의존(텍스트 자체로 의미 전달).
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

  if (!canSearch) return null;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger className={TRIGGER} aria-label="전역 환자 검색 (Ctrl K)">
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate">환자 이름·차트번호·연락처 검색</span>
        <kbd className="rounded-sm border border-border bg-card px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
          Ctrl K
        </kbd>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/30" />
        <Dialog.Popup initialFocus={inputRef} className={POPUP}>
          <Dialog.Title className="sr-only">전역 환자 검색</Dialog.Title>
          <Dialog.Description className="sr-only">
            이름·차트번호·연락처로 환자를 검색해 상세로 이동합니다.
          </Dialog.Description>

          {/* 검색 입력(combobox 패턴) */}
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
              className="h-11 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <Dialog.Close
              aria-label="검색 닫기"
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </div>

          {/* 결과 목록 */}
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            <ul role="listbox" id={listId} aria-label="검색 결과">
              {results.map((patient, i) => (
                <li
                  key={patient.id}
                  id={`${listId}-opt-${patient.id}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseMove={() => setActiveIndex(i)}
                  onClick={() => select(patient)}
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
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {patient.phone ?? "—"}
                  </span>
                </li>
              ))}
            </ul>

            {/* 상태(빈 입력·로딩·결과없음·에러) — 색 비의존 텍스트 */}
            {statusText && results.length === 0 && (
              <p className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">
                {statusText}
              </p>
            )}

            {/* 잘림 안내(상한 도달) — 동명이인 누락·오환자 방지(색 비의존 텍스트) */}
            {truncated && (
              <p className="border-t border-border px-3 py-2 text-[12px] text-muted-foreground">
                상위 {RESULT_LIMIT}명만 표시됩니다. 이름·차트번호·연락처를 더 정확히 입력하세요.
              </p>
            )}
          </div>

          {/* aria-live polite — 결과 개수/상태 안내(PII 미낭독). 상시 마운트, 텍스트만 갱신. */}
          <div role="status" aria-live="polite" className="sr-only">
            {statusText}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
