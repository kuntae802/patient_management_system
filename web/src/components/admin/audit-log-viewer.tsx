"use client";

import { RefreshCw, ScrollText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AuditLogDetail } from "@/components/admin/audit-log-detail";
import { apiFetch, ApiError } from "@/lib/api/client";
import {
  ACTION_META,
  ACTION_ORDER,
  actorLabel,
  formatAuditTime,
  KNOWN_TARGET_TABLES,
  targetTableLabel,
  type AuditLogEntry,
  type AuditLogPage,
} from "@/lib/admin/audit";
import type { StaffMember } from "@/lib/admin/staff";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

const FIELD =
  "h-8 rounded-md border border-border bg-card px-2 text-[12.5px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

type Filters = {
  action: string;
  target_table: string;
  actor_id: string;
  date_from: string;
  date_to: string;
};

const EMPTY_FILTERS: Filters = {
  action: "",
  target_table: "",
  actor_id: "",
  date_from: "",
  date_to: "",
};

function buildQuery(filters: Filters, page: number): string {
  const p = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
  if (filters.action) p.set("action", filters.action);
  if (filters.target_table) p.set("target_table", filters.target_table);
  if (filters.actor_id) p.set("actor_id", filters.actor_id);
  // KST 날짜 입력을 ISO 경계로 변환(서버는 timestamptz UTC 비교, 표시는 Intl KST).
  if (filters.date_from) p.set("date_from", `${filters.date_from}T00:00:00+09:00`);
  if (filters.date_to) p.set("date_to", `${filters.date_to}T23:59:59+09:00`);
  return p.toString();
}

// 감사 로그 뷰어(관리자, FR-243). 조회 = FastAPI(apiFetch) 경유(actor 이름 users 조인 필요). 읽기전용 —
// 편집·삭제 어포던스 없음, append-only 는 DB(0004)가 강제. 리스트는 기본 마스킹·per-row reveal 없음.
export function AuditLogViewer() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [pageNum, setPageNum] = useState(1);
  const [page, setPage] = useState<AuditLogPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);
  const [actors, setActors] = useState<StaffMember[]>([]);

  // 행위자 필터 옵션 — 직원 목록 재사용. user.manage 없으면 403 → 옵션 비움(필터는 '전체'만, 디그레이드).
  useEffect(() => {
    void (async () => {
      try {
        const list = await apiFetch<StaffMember[]>("/v1/admin/users");
        setActors(list); // setState 는 await 이후(effect 내 동기 setState 아님).
      } catch {
        // 권한 없으면 actor 드롭다운 없이 동작.
      }
    })();
  }, []);

  // 조회 — setState 는 await 이후. 로딩 스켈레톤은 이벤트 핸들러가 setPage(null) 로 띄운다(effect 밖).
  const load = useCallback(async () => {
    try {
      const data = await apiFetch<AuditLogPage>(
        `/v1/admin/audit-logs?${buildQuery(filters, pageNum)}`,
      );
      setPage(data);
      setLoadError(null);
    } catch (err) {
      setPage({ data: [], meta: { page: pageNum, page_size: PAGE_SIZE, total: 0 } });
      setLoadError(err instanceof ApiError ? err.message : "감사 로그를 불러오지 못했습니다.");
    }
  }, [filters, pageNum]);

  useEffect(() => {
    // 마운트·필터·페이지 변경 시 재조회. load 의 setState 는 await 이후라 정적 추적만 비활성.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function applyFilter(patch: Partial<Filters>) {
    setPage(null); // 스켈레톤(이벤트 핸들러 — effect 밖이라 안전). 필터 변경 시 1페이지로.
    setFilters((prev) => ({ ...prev, ...patch }));
    setPageNum(1);
  }

  function resetFilters() {
    setPage(null);
    setFilters(EMPTY_FILTERS);
    setPageNum(1);
  }

  function goPage(next: number) {
    setPage(null);
    setPageNum(next);
  }

  const total = page?.meta.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (pageNum - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(pageNum * PAGE_SIZE, total);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">감사 로그</h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          행위자·기간·대상별 조회 · 읽기 전용(편집·삭제 불가, append-only)
        </p>
      </div>

      {/* 필터 바 */}
      <section
        aria-label="감사 로그 필터"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3"
      >
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">동작</span>
          <select
            aria-label="동작 필터"
            value={filters.action}
            onChange={(e) => applyFilter({ action: e.target.value })}
            className={FIELD}
          >
            <option value="">전체</option>
            {ACTION_ORDER.map((a) => (
              <option key={a} value={a}>
                {ACTION_META[a].label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">대상</span>
          <select
            aria-label="대상 필터"
            value={filters.target_table}
            onChange={(e) => applyFilter({ target_table: e.target.value })}
            className={FIELD}
          >
            <option value="">전체</option>
            {KNOWN_TARGET_TABLES.map((t) => (
              <option key={t} value={t}>
                {targetTableLabel(t)}
              </option>
            ))}
          </select>
        </label>

        {actors.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">행위자</span>
            <select
              aria-label="행위자 필터"
              value={filters.actor_id}
              onChange={(e) => applyFilter({ actor_id: e.target.value })}
              className={FIELD}
            >
              <option value="">전체</option>
              {actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.employee_no})
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">시작일</span>
          <input
            type="date"
            aria-label="시작일 필터"
            value={filters.date_from}
            onChange={(e) => applyFilter({ date_from: e.target.value })}
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">종료일</span>
          <input
            type="date"
            aria-label="종료일 필터"
            value={filters.date_to}
            onChange={(e) => applyFilter({ date_to: e.target.value })}
            className={FIELD}
          />
        </label>

        <button
          type="button"
          onClick={resetFilters}
          className="h-8 rounded-md border border-border bg-card px-3 text-[12.5px] text-muted-foreground hover:bg-muted"
        >
          초기화
        </button>
      </section>

      {/* 목록 */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-foreground">
            <ScrollText className="size-4 text-muted-foreground" aria-hidden />
            감사 로그
            {page && (
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-normal tabular-nums text-muted-foreground">
                {total}건
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => goPage(pageNum)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            새로고침
          </button>
        </div>

        <p role="status" aria-live="polite" className="sr-only">
          {page === null
            ? "감사 로그 불러오는 중"
            : loadError
              ? loadError
              : `${total}건 조회됨`}
        </p>

        {page === null ? (
          <div className="space-y-2 p-4" aria-busy="true" aria-label="감사 로그 불러오는 중">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-[13px] text-muted-foreground">{loadError}</p>
            <button
              type="button"
              onClick={() => goPage(pageNum)}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
            >
              다시 시도
            </button>
          </div>
        ) : page.data.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
            조건에 해당하는 감사 로그가 없습니다.
          </p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="border-b border-border px-4 py-2.5 text-left">시각</th>
                  <th scope="col" className="border-b border-border px-4 py-2.5 text-left">행위자</th>
                  <th scope="col" className="border-b border-border px-4 py-2.5 text-left">동작</th>
                  <th scope="col" className="border-b border-border px-4 py-2.5 text-left">대상</th>
                  <th scope="col" className="border-b border-border px-4 py-2.5 text-left">상세</th>
                </tr>
              </thead>
              <tbody>
                {page.data.map((entry) => {
                  const meta = ACTION_META[entry.action];
                  return (
                    <tr key={entry.id} className="hover:bg-muted/50">
                      <th
                        scope="row"
                        className="border-b border-border px-4 py-2.5 text-left font-normal tabular-nums text-muted-foreground"
                      >
                        {formatAuditTime(entry.created_at)}
                      </th>
                      <td className="border-b border-border px-4 py-2.5 text-foreground">
                        {actorLabel(entry)}
                      </td>
                      <td className="border-b border-border px-4 py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[11px] font-bold",
                            meta.badgeClass,
                          )}
                        >
                          <span aria-hidden>{meta.glyph}</span>
                          {meta.label}
                        </span>
                      </td>
                      <td className="border-b border-border px-4 py-2.5 text-muted-foreground">
                        {targetTableLabel(entry.target_table)}
                        {entry.target_id ? (
                          <span className="ml-1 tabular-nums text-muted-foreground/70">
                            #{entry.target_id}
                          </span>
                        ) : null}
                      </td>
                      <td className="border-b border-border px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => setSelected(entry)}
                          aria-label={`${formatAuditTime(entry.created_at)} 감사 상세 보기`}
                          className="rounded-md border border-border bg-card px-2 py-1 text-[12px] text-foreground hover:bg-muted"
                        >
                          보기
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* 페이지네이션 */}
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[12px] text-muted-foreground">
              <span className="tabular-nums">
                {total === 0 ? "결과 없음" : `총 ${total}건 중 ${rangeStart}–${rangeEnd}`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => goPage(pageNum - 1)}
                  disabled={pageNum <= 1}
                  aria-label="이전 페이지"
                  className="rounded-md border border-border bg-card px-2 py-1 text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  이전
                </button>
                <span className="tabular-nums">
                  {pageNum} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => goPage(pageNum + 1)}
                  disabled={pageNum >= totalPages}
                  aria-label="다음 페이지"
                  className="rounded-md border border-border bg-card px-2 py-1 text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  다음
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <AuditLogDetail entry={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
