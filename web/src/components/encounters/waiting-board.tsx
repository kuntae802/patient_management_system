"use client";

import {
  ChevronLeft,
  ChevronRight,
  Megaphone,
  Phone,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/encounters/status-badge";
import { useEncountersRealtime } from "@/hooks/use-encounters-realtime";
import { fetchDepartments, type Department } from "@/lib/admin/masters";
import { ApiError } from "@/lib/api/client";
import {
  callEncounter,
  ENCOUNTER_STATUS_META,
  type EncounterListItem,
  type EncounterStatus,
  fetchEncounters,
  nextCallCandidate,
  registerEncounter,
  STATUS_GROUP_ORDER,
  TERMINAL_STATUSES,
  waitMinutes,
} from "@/lib/reception/encounters";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// 대기 현황판(Story 4.3, FR-022·023 / UX-DR6·7·8·18·21). 원무·의사 공유 화면. 상태별 그룹 섹션(활성도
// 순)·"다음 호출" 히어로·KPI·행별 다음-액션(호출/접수)·실시간 갱신·신선도 가드. 쓰기=FastAPI(apiFetch),
// 실시간=Supabase postgres_changes(진료과 필터)→refetch. 상태머신·감사·호출기록은 DB 소유(0010·0011).
// 진료 시작(start_consult)=4.4·완료(complete)=Epic7 소유 → 이 보드는 호출·접수만 배선(다음-액션 슬롯).

type SortMode = "activity" | "call" | "wait";

const SORT_LABELS: Record<SortMode, string> = {
  activity: "활성도 순",
  call: "호출 순",
  wait: "대기시간 순",
};

// 시간 기반 신선도 임계 — 마지막 동기화가 이보다 오래되면 stale(채널·폴링 동시 실패 가드). 폴링 간격
// (use-encounters-realtime POLL_MS=30s)보다 넉넉히 커야 정상 보드가 stale 로 깜빡이지 않는다(UX-DR18).
const FRESH_LIMIT_MS = 40_000;

// ── 날짜 유틸(KST) — 보드 "오늘" 은 병원 운영 시간대 기준 ─────────────────────────────
function todayKST(): string {
  // en-CA 로케일 = YYYY-MM-DD 포맷. timeZone 으로 KST 일자 산출(브라우저 로캘 무관).
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function shiftDate(ymd: string, deltaDays: number): string {
  // UTC 정오 기준 가감(일광/타임존 드리프트 회피) 후 YYYY-MM-DD 재포맷.
  const [y, m, d] = ymd.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(base);
}

function timeHmKST(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

// 호출 액션 오류 → 한국어 안내(409=상태 부적합·403=권한·그외 봉투 메시지).
function actionMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.code === "invalid_transition") return "이미 진행되었거나 호출할 수 없는 상태입니다.";
    if (err.code === "forbidden") return "권한이 없습니다.";
    return err.message;
  }
  return fallback;
}

export function WaitingBoard({ role }: { role: "reception" | "doctor" }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [deptError, setDeptError] = useState<string | null>(null);
  const [onDate, setOnDate] = useState<string>(todayKST());
  const [members, setMembers] = useState<EncounterListItem[] | null>(null);
  const [total, setTotal] = useState(0); // meta.total — 절단(total > 로드 건수) 표시용
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("activity");
  const [collapsed, setCollapsed] = useState<Set<EncounterStatus>>(new Set(TERMINAL_STATUSES));
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [nowMs, setNowMs] = useState(() => Date.now());
  // per-id 동기 in-flight 락 — disabled 반영(다음 렌더) 전 더블클릭 이중 호출 차단(4.2 패턴).
  const inFlight = useRef<Set<string>>(new Set());

  // 진료과 목록(활성) — Supabase 직접조회(단순 읽기, 0006). 첫 활성 진료과를 기본 선택.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    fetchDepartments(supabase)
      .then((rows) => {
        if (cancelled) return;
        const active = rows.filter((d) => d.is_active);
        setDepartments(active);
        setDepartmentId((prev) => prev || active[0]?.id || "");
        setDeptError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setDeptError("진료과 목록을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 대기 목록 조회(진료과×일자). 첫 setState 가 await 이후 → effect 동기 setState 아님.
  const load = useCallback(async () => {
    if (!departmentId) return;
    try {
      const page = await fetchEncounters({ department_id: departmentId, on_date: onDate });
      setMembers(page.data);
      setTotal(page.meta.total);
      setLastSyncedAt(Date.now());
      setLoadError(null);
    } catch (err) {
      setMembers([]);
      setLoadError(err instanceof ApiError ? err.message : "대기 현황을 불러오지 못했습니다.");
    }
  }, [departmentId, onDate]);

  // 진료과/일자 변경 시 재조회(load 신원 변화 = departmentId/onDate 변경). 스켈레톤 리셋은 변경
  // 핸들러가 담당(배경 refetch=실시간/폴링 시 깜빡임 없이 교체). load 의 setState 는 await 이후.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // 실시간 구독(진료과 필터) → 변경 시 refetch. 채널 stale + 시간 기반 신선도 둘 다로 가드 판정.
  const { isStale: channelStale, reconnect } = useEncountersRealtime(departmentId || null, load);
  // 수동 재연결 = 채널 재구독 + 즉시 refetch(데이터·lastSyncedAt 갱신 → time-stale 도 해제).
  const onReconnect = useCallback(() => {
    reconnect();
    void load();
  }, [reconnect, load]);

  // 대기시간 라이브 갱신용 틱(30초) — 표시 분 단위라 과한 재렌더 회피. 시간 기반 stale 재평가도 겸함.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // 신선도 가드 = 채널 stale OR 마지막 동기화 경과 초과(채널·폴링 동시 실패). 정상 보드는 30초 폴링이
  // lastSyncedAt 을 갱신해 FRESH_LIMIT_MS(40s) 를 넘지 않으므로 깜빡이지 않는다(UX-DR18/21⑪).
  const isStale =
    channelStale || (lastSyncedAt !== null && nowMs - lastSyncedAt > FRESH_LIMIT_MS);

  const startPending = useCallback((id: string) => setPending((p) => new Set(p).add(id)), []);
  const endPending = useCallback(
    (id: string) =>
      setPending((p) => {
        const next = new Set(p);
        next.delete(id);
        return next;
      }),
    [],
  );

  async function runAction(
    id: string,
    fn: (id: string) => Promise<unknown>,
    okMsg: string,
    failMsg: string,
  ) {
    if (inFlight.current.has(id)) return; // 재진입 차단(렌더 갭 이중 제출)
    if (isStale) {
      toast.error("실시간 연결이 끊겨 동작이 보류되었습니다. 다시 연결 후 시도하세요.");
      return;
    }
    inFlight.current.add(id);
    startPending(id);
    try {
      await fn(id);
      toast.success(okMsg);
      await load(); // 즉시 반영(실시간 수신도 곧 동일 refetch)
    } catch (err) {
      toast.error(actionMessage(err, failMsg));
    } finally {
      inFlight.current.delete(id);
      endPending(id);
    }
  }

  const onCall = (item: EncounterListItem) =>
    runAction(item.id, callEncounter, `${item.patient_name} · ${item.encounter_no}번 호출`, "호출하지 못했습니다.");
  const onRegister = (item: EncounterListItem) =>
    runAction(item.id, registerEncounter, `${item.patient_name} 접수 완료`, "접수하지 못했습니다.");

  // ── 파생 데이터 ──────────────────────────────────────────────────────────────
  const rows = useMemo(() => members ?? [], [members]);
  const heroNext = useMemo(() => nextCallCandidate(rows), [rows]);

  const counts = useMemo(() => {
    const c = {} as Record<EncounterStatus, number>;
    for (const s of STATUS_GROUP_ORDER) c[s] = 0;
    for (const m of rows) c[m.status] += 1;
    return c;
  }, [rows]);

  const avgWait = useMemo(() => {
    const waits = rows
      .filter((m) => m.status === "registered")
      .map((m) => waitMinutes(m.registered_at, nowMs))
      .filter((w): w is number => w !== null);
    if (waits.length === 0) return null;
    return Math.round(waits.reduce((a, b) => a + b, 0) / waits.length);
  }, [rows, nowMs]);

  const groups = useMemo(() => {
    const sorter = (a: EncounterListItem, b: EncounterListItem): number => {
      if (sortMode === "call") {
        // 미호출 우선 → 다음 호출 대상 상단(호출 순).
        const ac = a.called_at ? 1 : 0;
        const bc = b.called_at ? 1 : 0;
        if (ac !== bc) return ac - bc;
      }
      if (sortMode === "wait") {
        // 오래 기다린 순(대기시간) — registered_at asc = wait desc.
        return (a.registered_at ?? "").localeCompare(b.registered_at ?? "");
      }
      // activity(기본): 접수 순번 = 대기 순번.
      return (
        (a.registered_at ?? "").localeCompare(b.registered_at ?? "") ||
        a.encounter_no.localeCompare(b.encounter_no)
      );
    };
    return STATUS_GROUP_ORDER.map((status) => ({
      status,
      rows: rows.filter((m) => m.status === status).sort(sorter),
    })).filter((g) => g.rows.length > 0);
  }, [rows, sortMode]);

  const toggleCollapse = (status: EncounterStatus) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });

  const activeCount = counts.registered + counts.in_progress + counts.scheduled;
  const dateLabel = onDate === todayKST() ? "오늘" : onDate;
  const heroDept = heroNext && departments.find((d) => d.id === heroNext.department_id)?.name;

  // ── 렌더 ─────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* 헤더 — 제목·필터·날짜·다음 호출 */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">진료 대기 현황</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {dateLabel} · 활성 {activeCount}명{members ? ` · 전체 ${members.length}명` : ""}
            {role === "doctor" ? " · 의사" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={departmentId}
            onChange={(e) => {
              setMembers(null); // 진료과 전환 → 스켈레톤(배경 refetch 와 구분)
              setDepartmentId(e.target.value);
            }}
            aria-label="진료과"
            disabled={!!deptError}
            className="h-8 rounded-md border border-border bg-card px-2 text-[12.5px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60"
          >
            {departments.length === 0 && <option value="">진료과</option>}
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {/* 날짜 스테퍼 */}
          <div className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1 text-[12.5px]">
            <button
              type="button"
              aria-label="이전 날짜"
              onClick={() => {
                setMembers(null);
                setOnDate((d) => shiftDate(d, -1));
              }}
              className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <span className="min-w-14 text-center tabular-nums text-foreground">{dateLabel}</span>
            <button
              type="button"
              aria-label="다음 날짜"
              onClick={() => {
                setMembers(null);
                setOnDate((d) => shiftDate(d, 1));
              }}
              className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            새로고침
          </button>
        </div>
      </div>

      {deptError && (
        <p role="status" className="text-[12px] text-status-cancelled">
          {deptError}
        </p>
      )}

      {/* 실시간 stale 배너 — 신선도 초과 시 중요 동작 가드(UX-DR18·21⑪) */}
      {isStale && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-status-received/40 bg-status-received/10 px-4 py-2.5 text-[12.5px] text-status-received-ink">
          <WifiOff className="size-4 shrink-0" aria-hidden />
          <span className="font-medium">연결 지연 · 실시간 갱신 멈춤</span>
          <span className="text-muted-foreground">
            마지막 {lastSyncedAt ? timeHmKST(new Date(lastSyncedAt).toISOString()) : "—"} · 표시된 데이터가 최신이 아닐 수 있습니다(호출 가드됨)
          </span>
          <button
            type="button"
            onClick={onReconnect}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[12px] font-medium text-foreground hover:bg-muted"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            다시 연결
          </button>
        </div>
      )}

      {/* "다음 호출" 히어로 */}
      {heroNext && (
        <div className="flex items-center gap-4 rounded-xl border border-primary/30 bg-primary/[0.06] px-5 py-3.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
            <Megaphone className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">다음 호출</div>
            <div className="text-[14px] text-foreground">
              <b className="tabular-nums">{heroNext.encounter_no}번 {heroNext.patient_name}</b>
              <span className="text-muted-foreground">
                {" · "}
                {heroDept ?? heroNext.department_name}
                {heroNext.room_name ? ` ${heroNext.room_name}` : ""}
                {(() => {
                  const w = waitMinutes(heroNext.registered_at, nowMs);
                  return w !== null ? ` · ${w}분 대기` : "";
                })()}
                {heroNext.called_at ? ` · 호출됨 ${heroNext.call_count}회` : ""}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onCall(heroNext)}
            disabled={pending.has(heroNext.id) || isStale}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-60"
          >
            <Phone className="size-4" aria-hidden />
            호출
          </button>
        </div>
      )}

      {/* KPI 스트립 — 상태별 카운트 + 총원·평균 대기 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-card px-4 py-2.5 text-[12px]">
        {STATUS_GROUP_ORDER.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className={cn("inline-block size-2 rounded-full bg-current", ENCOUNTER_STATUS_META[s].badgeClass)} aria-hidden />
            {ENCOUNTER_STATUS_META[s].label}
            <b className="tabular-nums text-foreground">{counts[s]}</b>
          </span>
        ))}
        <span className="ml-auto text-muted-foreground">
          총 <b className="tabular-nums text-foreground">{total}</b>명
          {members && total > members.length ? (
            <span className="text-status-cancelled"> · 상위 {members.length}건만 표시</span>
          ) : null}
          {avgWait !== null ? <> · 평균 대기 <b className="tabular-nums text-foreground">{avgWait}</b>분</> : null}
        </span>
      </div>

      {/* 정렬 토글 */}
      <div className="inline-flex items-center gap-1 rounded-md border border-border bg-card p-0.5 text-[12px]">
        {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setSortMode(m)}
            aria-pressed={sortMode === m}
            className={cn(
              "rounded px-2.5 py-1 font-medium",
              sortMode === m ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {SORT_LABELS[m]}
          </button>
        ))}
      </div>

      {/* 본문 — 로딩/에러/빈/그룹 테이블 */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        {members === null ? (
          <div className="space-y-2 p-4" aria-busy="true" aria-label="대기 현황 불러오는 중">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-[13px] text-muted-foreground">{loadError}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
            >
              다시 시도
            </button>
          </div>
        ) : members.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <p className="text-[13px] text-muted-foreground">{dateLabel} 접수된 환자가 없습니다.</p>
            {role === "reception" && (
              <a
                href="/reception/intake"
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-white hover:bg-primary-hover"
              >
                ＋ 환자 접수하기
              </a>
            )}
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="border-b border-border px-3 py-2 text-left">대기번호</th>
                  <th scope="col" className="border-b border-border px-3 py-2 text-left">환자</th>
                  <th scope="col" className="border-b border-border px-3 py-2 text-left">상태</th>
                  <th scope="col" className="border-b border-border px-3 py-2 text-left">담당의 · 진료실</th>
                  <th scope="col" className="border-b border-border px-3 py-2 text-left">접수시각</th>
                  <th scope="col" className="border-b border-border px-3 py-2 text-left">대기</th>
                  <th scope="col" className="border-b border-border px-3 py-2 text-right">액션</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const meta = ENCOUNTER_STATUS_META[g.status];
                  const isCollapsed = collapsed.has(g.status);
                  return (
                    <GroupRows
                      key={g.status}
                      status={g.status}
                      label={meta.label}
                      badgeClass={meta.badgeClass}
                      rows={g.rows}
                      collapsed={isCollapsed}
                      onToggle={() => toggleCollapse(g.status)}
                      nowMs={nowMs}
                      pending={pending}
                      isStale={isStale}
                      onCall={onCall}
                      onRegister={onRegister}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 실시간 행 갱신 polite 알림(UX-DR20) */}
      <div role="status" aria-live="polite" className="sr-only">
        {members ? `대기 ${members.length}건 표시됨` : "불러오는 중"}
        {isStale ? " · 실시간 갱신 멈춤" : ""}
      </div>
    </div>
  );
}

// 상태 그룹(섹션 헤더 + 행). 종결(완료/취소/노쇼)은 접힘+muted.
function GroupRows({
  status,
  label,
  badgeClass,
  rows,
  collapsed,
  onToggle,
  nowMs,
  pending,
  isStale,
  onCall,
  onRegister,
}: {
  status: EncounterStatus;
  label: string;
  badgeClass: string;
  rows: EncounterListItem[];
  collapsed: boolean;
  onToggle: () => void;
  nowMs: number;
  pending: Set<string>;
  isStale: boolean;
  onCall: (item: EncounterListItem) => void;
  onRegister: (item: EncounterListItem) => void;
}) {
  const terminal = TERMINAL_STATUSES.has(status);
  return (
    <>
      <tr className={cn("bg-background/60", terminal && "opacity-80")}>
        <th scope="colgroup" colSpan={7} className="border-b border-border px-3 py-1.5 text-left">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-2 text-[12px] font-semibold text-foreground"
            aria-expanded={!collapsed}
          >
            {terminal && <span className="text-[10px] text-muted-foreground">{collapsed ? "▸" : "▾"}</span>}
            <span className={cn("inline-block size-2 rounded-full bg-current", badgeClass)} aria-hidden />
            <span className={cn(terminal && "text-muted-foreground")}>{label}</span>
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-normal tabular-nums text-muted-foreground">
              {rows.length}
            </span>
          </button>
        </th>
      </tr>
      {!collapsed &&
        rows.map((m) => (
          <EncounterRow
            key={m.id}
            item={m}
            nowMs={nowMs}
            busy={pending.has(m.id)}
            isStale={isStale}
            onCall={onCall}
            onRegister={onRegister}
          />
        ))}
    </>
  );
}

function EncounterRow({
  item,
  nowMs,
  busy,
  isStale,
  onCall,
  onRegister,
}: {
  item: EncounterListItem;
  nowMs: number;
  busy: boolean;
  isStale: boolean;
  onCall: (item: EncounterListItem) => void;
  onRegister: (item: EncounterListItem) => void;
}) {
  const wait =
    item.status === "in_progress"
      ? waitMinutes(item.consult_started_at, nowMs)
      : item.status === "registered"
        ? waitMinutes(item.registered_at, nowMs)
        : null;
  const waitText =
    item.status === "in_progress" && wait !== null
      ? `진행 ${wait}분`
      : wait !== null
        ? `${wait}분`
        : "—";
  // 대기 임계 색(soon=인디고 / long=danger) — 데모 임계값(tunable).
  const waitClass =
    wait === null
      ? "text-muted-foreground"
      : wait >= 30
        ? "text-status-cancelled font-semibold"
        : wait >= 15
          ? "text-status-inprogress font-medium"
          : "text-foreground";

  const queueNo = item.status === "scheduled" ? "—" : `${item.encounter_no}번`;
  const disabled = busy || isStale;

  return (
    <tr className="hover:bg-muted/40">
      <td className="border-b border-border px-3 py-2 tabular-nums text-muted-foreground">{queueNo}</td>
      <td className="border-b border-border px-3 py-2">
        <span className="font-medium text-foreground">{item.patient_name}</span>
        <span className="ml-1.5 tabular-nums text-[11px] text-muted-foreground">{item.chart_no}</span>
        {item.called_at && (
          <span className="ml-1.5 text-[11px] text-muted-foreground">
            · 호출됨 {timeHmKST(item.called_at)}
            {item.call_count > 1 ? ` (${item.call_count}회)` : ""}
          </span>
        )}
      </td>
      <td className="border-b border-border px-3 py-2">
        <StatusBadge status={item.status} />
      </td>
      <td className="border-b border-border px-3 py-2 text-muted-foreground">
        {item.doctor_name ?? "미배정"}
        {item.room_name ? <span className="text-foreground"> · {item.room_name}</span> : ""}
      </td>
      <td className="border-b border-border px-3 py-2 tabular-nums text-muted-foreground">
        {timeHmKST(item.registered_at)}
      </td>
      <td className={cn("border-b border-border px-3 py-2 tabular-nums", waitClass)}>{waitText}</td>
      <td className="border-b border-border px-3 py-2 text-right">
        {item.status === "registered" && (
          <button
            type="button"
            onClick={() => onCall(item)}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/[0.07] px-2.5 py-1 text-[12px] font-semibold text-primary hover:bg-primary/15 disabled:opacity-50"
          >
            <Phone className="size-3.5" aria-hidden />
            {item.called_at ? "재호출" : "호출"}
          </button>
        )}
        {item.status === "scheduled" && (
          <button
            type="button"
            onClick={() => onRegister(item)}
            disabled={disabled}
            className="rounded-md border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            접수
          </button>
        )}
      </td>
    </tr>
  );
}
