"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useEffect, useState } from "react";

import { searchPatients, sexLabel, type PatientListItem } from "@/lib/reception/patients";

// 환자 검색 페이지 본문(사이드바 "환자 검색" 진입) — 이름·차트번호·연락처로 GET /patients?q=.
// 전역 Ctrl K 팔레트(patient-search-command)와 동일 검색 API·마스킹·식별 단서, 페이지 인라인 형태.
// 선택 시 환자 상세(/patients/{id}·UUID 불투명)로 이동. RBAC: 서버 page 가 patient.read 가드.
// 🚫 검색어(이름·연락처 PII)는 로그·toast 에 남기지 않는다(서버 라우트도 불투명·응답은 마스킹).

const DEBOUNCE_MS = 200;
const RESULT_LIMIT = 50; // 페이지 표시 상한(팔레트 20보다 큼). 초과 시 "더 정확히 입력" 안내.

export function PatientSearchList() {
  const router = useRouter();
  const listId = useId();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientListItem[]>([]);
  // 결과를 만든 검색어 — query 와 다르면 "검색 중"(미정착). loading 불리언 대신 파생(플리커 제거).
  const [searchedTerm, setSearchedTerm] = useState("");
  const [error, setError] = useState<string | null>(null);

  // 디바운스 + abort 검색. 공백이면 호출 안 함(전체 목록 노출 방지). 이전 요청 취소(경쟁 결과 방지).
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

  const trimmed = query.trim();
  const settled = searchedTerm === trimmed; // 현재 검색어 결과가 정착했는가(아니면 검색 중).
  const truncated = settled && !error && results.length >= RESULT_LIMIT;
  // aria-live 안내 — 개수·상태만(PII 미낭독). 색 비의존(텍스트 자체로 의미 전달).
  const statusText = !trimmed
    ? "이름·차트번호·연락처로 검색하세요."
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
    <div className="space-y-4">
      {/* 검색 입력 */}
      <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="text"
          role="searchbox"
          aria-label="환자 검색"
          aria-controls={listId}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          placeholder="환자 이름·차트번호·연락처 검색"
          className="h-11 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      {/* 상태 안내(빈 입력·검색 중·결과없음·에러·잘림) — aria-live polite, 색 비의존 */}
      <p role="status" aria-live="polite" className="text-[12.5px] text-muted-foreground">
        {statusText}
      </p>

      {/* 결과 목록 — 동명이인 오환자 방지: 생년월일+성별+마스킹 주민번호+연락처 식별 단서 동반 */}
      {results.length > 0 && (
        <ul id={listId} className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {results.map((patient) => (
            <li key={patient.id}>
              <button
                type="button"
                onClick={() => router.push(`/patients/${patient.id}`)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-[13px] outline-none hover:bg-accent focus-visible:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {patient.name}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{patient.chart_no}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {patient.birth_date} · {sexLabel(patient.sex)}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {patient.resident_no_masked}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {patient.phone ?? "—"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
