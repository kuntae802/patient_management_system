"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

// 대기 현황판 실시간(Story 4.3, 코드베이스 최초 realtime). encounters 의 postgres_changes(진료과 필터)
// 를 구독해 다른 단말의 변경(접수·전이·호출)을 ≤5초 내 반영한다(NFR-002). architecture.md:204 패턴:
// "postgres_changes 구독 → 캐시 무효화/패치" → 이 프로젝트는 TanStack Query 미사용이므로 onChange(보드
// refetch)로 매핑한다. payload 자체는 비-PII(encounters 행: patient_id FK·status·called_at — 환자명
// 없음, UX-DR22) → 보드 표시 데이터(조인 PII)와 분리. 신선도(채널): 채널이 ERROR/TIMED_OUT/CLOSED 면
// stale 로 보고(INIT·SUBSCRIBED 는 정상 — 초기 연결을 stale 로 오판 않도록) → 보드가 호출 등 중요
// 동작을 가드(UX-DR18·UX-DR21⑪ — "권장" 아닌 강제). **시간 기반 신선도(마지막 동기화 경과)는 보드가
// lastSyncedAt + nowMs 로 합산**(채널은 살아 있지만 폴링까지 실패해 데이터가 정체된 케이스 가드).
// 백스톱 폴링으로 누락 이벤트도 reconcile. ⚠️ Next 16/React 19.2 — cleanup 에서 removeChannel, deps 정확히.

const DEBOUNCE_MS = 300; // 이벤트 폭주 흡수(연속 변경 → 한 번 refetch)
const POLL_MS = 30_000; // 백스톱 폴링 — 누락 이벤트/degraded 채널 reconcile
const STALE_STATUSES = new Set(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);

export type EncountersRealtime = {
  /** 채널이 끊겼거나 오류 — 신선도 보장 불가 → 보드가 중요 동작 가드. */
  isStale: boolean;
  /** 채널 구독 상태(SUBSCRIBED/CHANNEL_ERROR/TIMED_OUT/CLOSED/INIT). */
  channelStatus: string;
  /** 수동 재연결(채널 제거 후 재구독). */
  reconnect: () => void;
};

/**
 * 진료과별 encounters 실시간 구독. departmentId 가 바뀌면 채널을 재구독한다. onChange 는 변경 수신 시
 * (디바운스) + 주기 폴링 시 호출된다 — 보드의 refetch(load)를 넘긴다.
 */
export function useEncountersRealtime(
  departmentId: string | null,
  onChange: () => void,
): EncountersRealtime {
  const [channelStatus, setChannelStatus] = useState<string>("INIT");
  const [nonce, setNonce] = useState(0); // reconnect 트리거(effect 재실행)
  // onChange 를 ref 로 보관 — 콜백 신원 변화로 채널을 재구독하지 않게(진료과/nonce 만 재구독).
  // ref 갱신은 렌더 후(effect)에서 — 렌더 중 ref.current 변경 금지(react-hooks/refs).
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!departmentId) return;
    const supabase = createClient();
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => onChangeRef.current(), DEBOUNCE_MS);
    };

    // "all" = 전체 진료과 구독(진료과 필터 없음·원무 병원 단위). 그 외엔 진료과 필터.
    const base = { event: "*" as const, schema: "public", table: "encounters" };
    const channel = supabase
      .channel(`encounters-dept-${departmentId}-${nonce}`)
      .on(
        "postgres_changes",
        departmentId === "all" ? base : { ...base, filter: `department_id=eq.${departmentId}` },
        () => trigger(),
      )
      .subscribe((status) => setChannelStatus(status));

    const poll = setInterval(() => onChangeRef.current(), POLL_MS);

    return () => {
      if (debounce) clearTimeout(debounce);
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [departmentId, nonce]);

  const reconnect = useCallback(() => {
    // 낙관적 — 재구독 round-trip 동안 채널 stale 배너/가드를 즉시 해제(INIT∉STALE_STATUSES).
    setChannelStatus("INIT");
    setNonce((n) => n + 1);
  }, []);
  const isStale = STALE_STATUSES.has(channelStatus);

  return { isStale, channelStatus, reconnect };
}
