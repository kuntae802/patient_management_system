"use client";

import { useSyncExternalStore } from "react";

// 직원 화면 = KST · 24시간 표기(환자 앱만 12시간). tabular-nums로 폭 흔들림 방지.
const dateFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  weekday: "short",
});
const timeFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

// 시계 = 외부 시스템(시간)이므로 useSyncExternalStore로 구독(effect 내 동기 setState 회피).
function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 1000);
  return () => clearInterval(id);
}
// 초 단위 버킷 — 같은 초엔 동일 스냅샷.
function getSnapshot() {
  return Math.floor(Date.now() / 1000);
}
// 서버/하이드레이션 스냅샷 = null → SSR·CSR 시각 불일치(hydration mismatch) 회피.
function getServerSnapshot(): number | null {
  return null;
}

export function Clock() {
  const seconds = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const now = seconds == null ? null : new Date(seconds * 1000);

  return (
    <div className="hidden items-center gap-2 tabular-nums whitespace-nowrap text-[12px] text-muted-foreground sm:flex">
      {now ? (
        <>
          <span>{dateFmt.format(now)}</span>
          <span className="font-semibold text-foreground">{timeFmt.format(now)}</span>
        </>
      ) : (
        <span aria-hidden>—</span>
      )}
    </div>
  );
}
