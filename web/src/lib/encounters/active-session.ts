// 세션당 활성 내원 1개 가드(Story 4.4 · UX-DR21⑨) — Zustand 미설치라 바닐라 localStorage.
// 한 브라우저에서 진료 허브가 동시에 "활성" 내원 1개만 점유하도록 한다. 다른 탭이 같은 키를
// 덮어쓰면 storage 이벤트로 전파되어 기존 탭이 자신이 보류(superseded)됐음을 안다. 잘못된 환자의
// 열린 진료 화면에 작업이 새는 것을 막는 임상 안전 토대 — 4.6 SOAP autosave 가 isActiveEncounter()
// 를 소비해 비활성 내원에의 쓰기를 거부한다(이 모듈 API 안정 유지). 전 필드 snake_case.

export const ACTIVE_ENCOUNTER_KEY = "pms.active_encounter";

export type ActiveEncounter = {
  encounter_id: string;
  encounter_no: string;
  opened_at: string; // ISO 8601
};

/** 현재 활성 내원 읽기(없거나 파싱 실패 → null). SSR(window 부재) 안전. */
export function readActiveEncounter(): ActiveEncounter | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_ENCOUNTER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveEncounter;
    if (!parsed || typeof parsed.encounter_id !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 이 내원을 활성으로 점유(다른 탭은 storage 이벤트로 supersede). localStorage 불가 시 비치명적. */
export function claimActiveEncounter(enc: {
  encounter_id: string;
  encounter_no: string;
}): ActiveEncounter {
  const record: ActiveEncounter = {
    encounter_id: enc.encounter_id,
    encounter_no: enc.encounter_no,
    opened_at: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(ACTIVE_ENCOUNTER_KEY, JSON.stringify(record));
    } catch {
      /* 사생활 모드 등 localStorage 불가 — 가드 비치명적, 무시 */
    }
  }
  return record;
}

/** 활성 내원 해제 — 현재 활성이 이 내원일 때만(타 내원 점유 보존). 허브 언마운트 시 호출. */
export function clearActiveEncounter(encounterId: string): void {
  if (typeof window === "undefined") return;
  const current = readActiveEncounter();
  if (current && current.encounter_id === encounterId) {
    try {
      window.localStorage.removeItem(ACTIVE_ENCOUNTER_KEY);
    } catch {
      /* 무시 */
    }
  }
}

/** 이 내원이 현재 활성인가(4.6 autosave 등 쓰기 가드가 소비). */
export function isActiveEncounter(encounterId: string): boolean {
  return readActiveEncounter()?.encounter_id === encounterId;
}
