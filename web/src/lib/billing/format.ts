// 수납 법정 문서(영수증 7.5·세부산정내역서 7.6) 공용 포맷 헬퍼 — KST 날짜·결제수단 한글.
// receipt-document.tsx / statement-document.tsx 가 공유(중복 제거·금액/날짜 포맷 단일 출처).

/** KST 날짜(YYYY년 MM월 DD일) — finalized_at(ISO) / 진료기간·진료일(YYYY-MM-DD) 공용. null/무효 → "—". */
export function formatKstDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** 결제 수단 한글 라벨 맵(DB CHECK·Pydantic Literal 거울). */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  card: "카드",
  cash: "현금",
  transfer: "계좌이체",
};
