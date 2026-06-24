"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { formatKrw } from "@/lib/admin/masters";
import { formatKstDate } from "@/lib/billing/format";
import {
  compactKrw,
  fetchDashboardOperations,
  formatPercent,
  monthDayLabel,
  type DashboardDailyPoint,
  type DashboardOperationsResponse,
} from "@/lib/dashboard/operations";

// 운영 대시보드(Story 8.5 / FR-230) — 당일 KPI 스냅샷 + 최근 14일 추세(내원·순수납액·노쇼율). 집계는
// 서버(FastAPI)가 담당 → 여기선 조회·표시만(read-only·쓰기 액션 0). useState 단일 로드(billing-worklist
// 패턴·TanStack 미사용). 차트 = 신규 의존성 없이 인라인 막대(값·일자 라벨 병기 → 색/음영 비의존·A3).

const TREND_DAYS = 14;

export function OperationsDashboard() {
  const [data, setData] = useState<DashboardOperationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchDashboardOperations(undefined, TREND_DAYS);
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "운영 통계를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load 의 setState 는 await 이후
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-[13px] text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 rounded-md border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium hover:bg-muted"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (data === null) {
    return <DashboardSkeleton />;
  }

  const t = data.today;
  return (
    <div className="space-y-6">
      <p className="text-[12px] text-muted-foreground">
        <span className="tabular-nums">{formatKstDate(data.as_of_date)}</span> 기준
      </p>

      {/* 당일 KPI 스냅샷 */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="내원" value={`${t.visits}`} unit="명" />
        <StatCard label="대기" value={`${t.waiting}`} unit="명" />
        <StatCard label="진료중" value={`${t.in_progress}`} unit="명" />
        <StatCard label="완료" value={`${t.completed}`} unit="명" />
        <StatCard label="순수납액" value={formatKrw(t.revenue_net_krw)} unit="원" />
        <StatCard
          label="노쇼율"
          value={formatPercent(t.no_show_rate)}
          detail={`${t.no_show_count} / ${t.appointment_total}건`}
        />
      </section>

      {/* 최근 추세(인라인 막대 — 값·일자 라벨 병기) */}
      <section className="grid gap-4 lg:grid-cols-3">
        <TrendCard
          title="일별 내원"
          points={data.daily_series}
          value={(p) => p.visits}
          format={(v) => `${v}명`}
        />
        <TrendCard
          title="일별 순수납액"
          points={data.daily_series}
          value={(p) => p.revenue_net_krw}
          format={(v) => `${formatKrw(v)}원`}
          barLabel={(v) => compactKrw(v)}
        />
        <TrendCard
          title="일별 노쇼율"
          points={data.daily_series}
          value={(p) => p.no_show_rate}
          format={(v) => formatPercent(v)}
          barLabel={(v) => (v > 0 ? formatPercent(v) : "")}
        />
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  detail,
}: {
  label: string;
  value: string;
  unit?: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-3">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-[20px] font-semibold text-foreground tabular-nums">
        {value}
        {unit ? <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">{unit}</span> : null}
      </p>
      {detail ? <p className="mt-0.5 text-[10.5px] text-muted-foreground tabular-nums">{detail}</p> : null}
    </div>
  );
}

function TrendCard({
  title,
  points,
  value,
  format,
  barLabel,
}: {
  title: string;
  points: DashboardDailyPoint[];
  value: (p: DashboardDailyPoint) => number;
  format: (v: number) => string;
  barLabel?: (v: number) => string;
}) {
  const max = Math.max(1, ...points.map(value));
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
      {points.length === 0 ? (
        <p className="mt-3 text-[12px] text-muted-foreground">표시할 데이터가 없습니다.</p>
      ) : (
        <div className="mt-3 flex h-28 items-end gap-[3px]" role="img" aria-label={title}>
          {points.map((p) => {
            const v = value(p);
            // 비-0 막대는 최소 4% 높이로 가시화(0 은 0 높이 — 색 외 높이로도 구분, A3).
            const pct = v > 0 ? Math.max(Math.round((v / max) * 100), 4) : 0;
            const label = barLabel ? barLabel(v) : v > 0 ? `${v}` : "";
            return (
              <div
                key={p.date}
                className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
                title={`${monthDayLabel(p.date)} · ${format(v)}`}
              >
                <span className="h-3 text-[8px] leading-none text-muted-foreground tabular-nums">
                  {label}
                </span>
                <div
                  className="w-full rounded-t bg-primary/70"
                  style={{ height: `${pct}%` }}
                  aria-hidden
                />
              </div>
            );
          })}
        </div>
      )}
      {points.length > 0 ? (
        <div className="mt-1 flex gap-[3px]">
          {points.map((p) => (
            <span
              key={p.date}
              className="min-w-0 flex-1 text-center text-[8px] text-muted-foreground tabular-nums"
            >
              {monthDayLabel(p.date)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="불러오는 중">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[68px] animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-[180px] animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
