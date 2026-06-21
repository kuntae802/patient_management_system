"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ACTIVE_ENCOUNTER_KEY,
  type ActiveEncounter,
  claimActiveEncounter,
  clearActiveEncounter,
  isActiveEncounter,
  readActiveEncounter,
} from "@/lib/encounters/active-session";

// 세션당 활성 내원 1개 가드 훅(Story 4.4 · UX-DR21⑨). 진료 허브가 마운트되면 이 내원을 활성으로
// 점유한다. 이미 다른 내원이 활성이면 conflict(동시 2개 진료 컨텍스트 경고). 다른 탭이 활성 내원을
// 가져가면 storage 이벤트로 superseded(이 탭 보류). takeOver 로 이 내원을 (재)점유한다.
// ⚠️ 점유(ownership)는 **encounterId 만으로 키잉** — encounter_no 는 표시명일 뿐이므로 마운트 점유
// effect 의존성에 넣지 않는다(코드리뷰 Patch P1: encounter_no 가 ""→실제로 바뀔 때 effect 가 재실행
// 되면 load-race supersede 가 리셋되고 빈 no 가 저장돼 타 탭 배너가 깨지며 클리어→재점유 깜빡임 발생).
// noRef 로 최신 no 를 보관해 재실행 없이 점유에 반영한다. ⚠️ Next 16/React 19.2 — cleanup·deps 정확히.

export type ActiveEncounterGuard = {
  /** 이 내원을 열 때 다른 내원이 이미 활성 — 동시 2개 진료 컨텍스트 경고(점유하지 않음). */
  conflict: boolean;
  /** 다른 탭이 활성 내원을 가져감 → 이 탭은 보류(쓰기 거부 토대). */
  superseded: boolean;
  /** 현재 활성 내원(표시용). */
  active: ActiveEncounter | null;
  /** 이 내원을 활성으로 (재)점유 — 다른 탭은 supersede. */
  takeOver: () => void;
};

type GuardState = { active: ActiveEncounter | null; superseded: boolean };

export function useActiveEncounter(
  encounterId: string,
  encounterNo: string,
): ActiveEncounterGuard {
  // 초기값은 현재 localStorage 점유(첫 렌더부터 conflict 정확). 이후 변경은 아래 effect 들이 반영.
  const [state, setState] = useState<GuardState>(() => ({
    active: readActiveEncounter(),
    superseded: false,
  }));

  // 최신 encounter_no 보관(표시명 — 점유 effect 재실행 유발 금지, Patch P1).
  const noRef = useRef(encounterNo);
  useEffect(() => {
    noRef.current = encounterNo;
  });

  const takeOver = useCallback(() => {
    const rec = claimActiveEncounter({ encounter_id: encounterId, encounter_no: noRef.current });
    setState({ active: rec, superseded: false });
  }, [encounterId]);

  // 마운트(내원별 1회 — encounterId 만 의존): 활성 없거나 이 내원이면 점유, 다른 내원이면 conflict.
  useEffect(() => {
    const current = readActiveEncounter();
    const mine = !current || current.encounter_id === encounterId;
    const next = mine
      ? claimActiveEncounter({ encounter_id: encounterId, encounter_no: noRef.current })
      : current;
    setState({ active: next, superseded: false });
    return () => clearActiveEncounter(encounterId); // 언마운트 시 이 내원 활성이면 해제
  }, [encounterId]);

  // encounter_no 로드(""→실제): 이 내원을 점유 중일 때만 표시명 갱신(conflict/superseded 의미 불변).
  useEffect(() => {
    if (!encounterNo || !isActiveEncounter(encounterId)) return;
    const rec = claimActiveEncounter({ encounter_id: encounterId, encounter_no: encounterNo });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 표시명만 동기화(superseded 보존)
    setState((s) =>
      s.active?.encounter_id === encounterId ? { active: rec, superseded: s.superseded } : s,
    );
  }, [encounterId, encounterNo]);

  // 크로스 탭: 다른 탭이 키를 바꾸면 반영. 비워졌고(다른 탭이 해제) 이 허브가 여전히 열려 있으면
  // 재점유해 claim 손실을 막는다(Patch P2 — 자가복구). subscribe 콜백 setState = 정상 패턴.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== ACTIVE_ENCOUNTER_KEY) return;
      const current = readActiveEncounter();
      if (!current) {
        const rec = claimActiveEncounter({ encounter_id: encounterId, encounter_no: noRef.current });
        setState({ active: rec, superseded: false });
        return;
      }
      setState({ active: current, superseded: current.encounter_id !== encounterId });
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [encounterId]);

  const conflict =
    !state.superseded && !!state.active && state.active.encounter_id !== encounterId;
  return { conflict, superseded: state.superseded, active: state.active, takeOver };
}
