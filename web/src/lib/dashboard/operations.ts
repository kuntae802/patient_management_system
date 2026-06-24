import { apiFetch } from "@/lib/api/client";

// 운영 대시보드(Story 8.5 / FR-230) — FastAPI DashboardOperationsResponse 의 거울(전 필드 snake_case).
// 복잡 집계는 서버(FastAPI)가 담당 → web 은 조회·표시만(read-only). 금액=KRW 정수, 비율=0~1, 날짜=plain
// "YYYY-MM-DD". 게이트 dashboard.read(서버 가드 + nav 필터). apiFetch 가 Bearer·에러봉투 처리.

/** 추세의 하루 점(일별 내원·순수납액·노쇼). daily_series 는 오래된→최신 정렬(서버 보장). */
export type DashboardDailyPoint = {
  date: string;
  visits: number;
  revenue_net_krw: number;
  no_show_count: number;
  no_show_rate: number;
};

/** 당일 운영 KPI 스냅샷. revenue_net_krw = Σ(paid − refunded). no_show_rate = no_show / 슬롯도래분. */
export type DashboardTodaySnapshot = {
  visits: number;
  waiting: number;
  in_progress: number;
  completed: number;
  revenue_net_krw: number;
  no_show_count: number;
  appointment_total: number;
  no_show_rate: number;
};

export type DashboardOperationsResponse = {
  as_of_date: string;
  today: DashboardTodaySnapshot;
  daily_series: DashboardDailyPoint[];
};

/**
 * 운영 대시보드 통계(GET). 게이트 dashboard.read. 일자 미지정 → 서버가 KST 오늘로 결정(클라 신뢰 X).
 * days = 추세 윈도우(1~90·기본 14).
 */
export async function fetchDashboardOperations(
  date?: string,
  days?: number,
): Promise<DashboardOperationsResponse> {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (days) params.set("days", String(days));
  const query = params.toString();
  return apiFetch<DashboardOperationsResponse>(
    `/v1/dashboard/operations${query ? `?${query}` : ""}`,
  );
}

/** 노쇼율(0~1) → 퍼센트 라벨(소수 1자리). 0 → "0.0%". */
export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/** KRW 압축 표기(추세 막대 라벨용·ko-KR notation=compact, 예: 13000 → "1.3만"). 0 → "". */
export function compactKrw(amount: number): string {
  if (!amount) return "";
  return new Intl.NumberFormat("ko-KR", { notation: "compact" }).format(amount);
}

/**
 * plain 날짜("YYYY-MM-DD")의 월·일 라벨("MM.DD"). 문자열을 직접 파싱한다(Date+timeZone 변환 시
 * 일자가 밀릴 수 있어 회피 — 서버가 이미 KST 일자를 plain 으로 보냄).
 */
export function monthDayLabel(date: string): string {
  const parts = date.split("-");
  if (parts.length !== 3) return date;
  return `${parts[1]}.${parts[2]}`;
}
