"use client";

import { Check, FilePlus2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api/client";
import { isActiveEncounter } from "@/lib/encounters/active-session";
import {
  createMedicalRecord,
  fetchMedicalRecords,
  type MedicalRecord,
  type SoapPart,
  updateMedicalRecord,
} from "@/lib/encounters/medical-records";
import type { Encounter } from "@/lib/reception/encounters";
import { createClient } from "@/lib/supabase/client";

// 진료 허브 중앙 SOAP ledger(Story 4.6, FR-040·FR-041 / UX-DR11) — S/O/A/P 작성 + 입력 중 autosave.
// full-bleed 1열 표(좌우 테두리 없는 열린 캔버스·가로 hairline). 포커스/입력 중 = 좌측 3px teal 액센트
// + 옅은 teal 틴트(음영 비의존). 빈 파트는 색만 아니라 글리프/"비어 있음"으로도 표시.
// autosave: 디바운스(~1.5s) 후 첫 내용에서 POST 생성·이후 PUT 전체 교체. ⚠️ 매 저장 전
// isActiveEncounter() 확인 — 스테일 탭(다른 탭이 점유)에선 저장 거부(UX-DR21, 오환자 차팅 차단).
// 한 내원 1:N: "새 진료기록"으로 추가, 활성 편집 대상 = 현재 임상의의 최근 기록(타 의사 기록 덮어쓰기 방지).

const AUTOSAVE_MS = 1500;

type SoapValues = Record<SoapPart, string>;
const EMPTY_VALUES: SoapValues = { subjective: "", objective: "", assessment: "", plan: "" };

const SOAP_PARTS: {
  part: SoapPart;
  letter: string;
  ko: string;
  en: string;
  hint: string;
  badgeClass: string;
}[] = [
  {
    part: "subjective",
    letter: "S",
    ko: "주관적",
    en: "Subjective",
    hint: "환자의 호소·증상·병력 등 주관적 정보를 적습니다",
    badgeClass: "border-status-inprogress/40 bg-status-inprogress/12 text-status-inprogress",
  },
  {
    part: "objective",
    letter: "O",
    ko: "객관적",
    en: "Objective",
    hint: "진찰·활력·검사 소견 등 객관적 정보를 적습니다",
    badgeClass: "border-primary/40 bg-primary/12 text-primary",
  },
  {
    part: "assessment",
    letter: "A",
    ko: "평가",
    en: "Assessment",
    hint: "임상 판단·진단 소견을 적습니다 (KCD 진단 부착은 추후)",
    badgeClass: "border-status-received/40 bg-status-received/12 text-status-received-ink",
  },
  {
    part: "plan",
    letter: "P",
    ko: "계획",
    en: "Plan",
    hint: "처방·처치·교육·추적 계획을 적습니다",
    badgeClass: "border-status-done/40 bg-status-done/12 text-status-done-ink",
  },
];

function nowHmKST(): string {
  return new Date().toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

function dateTimeKST(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

function hasContent(v: SoapValues): boolean {
  return SOAP_PARTS.some(({ part }) => v[part].trim().length > 0);
}

function valuesOf(rec: MedicalRecord): SoapValues {
  return {
    subjective: rec.subjective ?? "",
    objective: rec.objective ?? "",
    assessment: rec.assessment ?? "",
    plan: rec.plan ?? "",
  };
}

export function SoapLedger({ encounter }: { encounter: Encounter }) {
  const encounterId = encounter.id;
  const [records, setRecords] = useState<MedicalRecord[] | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [values, setValues] = useState<SoapValues>(EMPTY_VALUES);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // autosave 동시성·무손실 토대(전부 콜백/이펙트 안에서만 접근 — 렌더 중 ref 수정 금지).
  const inFlightRef = useRef(false); // 저장 진행 중 — 중복 저장(이중 POST) 차단
  const pendingRef = useRef(false); // 저장 중 들어온 변경 — 끝나면 즉시 이어 저장(입력 유실 방지)
  const lastSavedRef = useRef<string | null>(null); // 직전 영속 값(직렬화). null=로드 전. 무변경 skip 기준
  const valuesRef = useRef<SoapValues>(EMPTY_VALUES); // 최신 입력값(doSave 가 closure 대신 ref 로 읽음)
  const activeIdRef = useRef<string | null>(null); // 최신 활성 기록 id(POST→PUT 전환 동기 반영)
  const doSaveRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // 최신 상태를 ref 에 동기(렌더 중이 아닌 이펙트에서 — eslint react-hooks/refs).
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);
  useEffect(() => {
    activeIdRef.current = activeRecordId;
  }, [activeRecordId]);

  const load = useCallback(async () => {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      const recs = await fetchMedicalRecords(encounterId);
      setCurrentUserId(uid);
      setRecords(recs);
      // 활성 편집 대상 = 현재 임상의(작성자)의 가장 최근 기록(recs 는 최근순). 없으면 새 초안.
      const mine = uid ? recs.find((r) => r.author_id === uid) : undefined;
      const initial = mine ? valuesOf(mine) : EMPTY_VALUES;
      setActiveRecordId(mine ? mine.id : null);
      activeIdRef.current = mine ? mine.id : null;
      setValues(initial);
      lastSavedRef.current = JSON.stringify(initial); // 로드값 = 저장된 상태(자동 저장 미발화 기준)
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "진료기록을 불러오지 못했습니다.");
    }
  }, [encounterId]);

  useEffect(() => {
    // 외부 시스템(서버) 동기화 로드 — setState 는 await 이후(patient-banner 동형).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // 단일 저장 시도. 최신 상태는 ref 로 읽어 callback 을 안정화([encounterId]) — finally 의 이어-저장이
  // 항상 최신값을 보게 한다. 무손실 보장: ①저장 중 변경은 pendingRef 로 큐잉해 끝나면 이어 저장,
  // ②성공 시 lastSavedRef 만 갱신(저장 중 들어온 입력은 lastSaved 와 달라 다음 디바운스가 저장).
  const doSave = useCallback(async () => {
    // ⚠️ UX-DR21: 이 탭이 활성 내원 락을 잃었으면(다른 탭 점유) 저장 거부 — 오환자 SOAP 오기록 차단.
    if (!isActiveEncounter(encounterId)) return;
    if (inFlightRef.current) {
      pendingRef.current = true; // 진행 중 — 끝나면 이어 저장(입력 유실 방지)
      return;
    }
    const snapshot = valuesRef.current;
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSavedRef.current) return; // 직전 저장과 동일 — 무변경
    if (!hasContent(snapshot)) return; // 빈 내용은 생성·덮어쓰기 안 함(기존 기록 빈값 wipe 방지)
    const activeId = activeIdRef.current;
    inFlightRef.current = true;
    setSaving(true);
    try {
      if (activeId === null) {
        const created = await createMedicalRecord(encounterId, snapshot);
        activeIdRef.current = created.id; // 동기 갱신 → 이어지는 저장이 PUT(이중 POST 방지)
        setActiveRecordId(created.id);
        setRecords((prev) => [created, ...(prev ?? [])]);
      } else {
        const updated = await updateMedicalRecord(encounterId, activeId, snapshot);
        setRecords((prev) => (prev ?? []).map((r) => (r.id === updated.id ? updated : r)));
      }
      lastSavedRef.current = serialized; // 이 스냅샷이 영속됨(저장 중 들어온 입력은 다음 디바운스가 저장)
      setSavedAt(nowHmKST());
    } catch (err) {
      // superseded 면 위에서 early return — 여기 도달은 실제 실패(403/404/네트워크). raw 텍스트 미노출.
      toast.error(err instanceof ApiError ? err.message : "자동 저장에 실패했습니다.");
    } finally {
      inFlightRef.current = false;
      setSaving(false);
      if (pendingRef.current) {
        pendingRef.current = false;
        void doSaveRef.current(); // 저장 중 들어온 변경을 즉시 이어 저장(최신 ref 사용)
      }
    }
  }, [encounterId]);

  useEffect(() => {
    doSaveRef.current = doSave;
  }, [doSave]);

  // autosave 디바운스: values 변경마다 타이머 리셋(입력 멈춤 ~1.5s 후 저장). lastSavedRef 비교로 무변경 skip.
  useEffect(() => {
    if (lastSavedRef.current === null) return; // 로드 전
    if (JSON.stringify(values) === lastSavedRef.current) return; // 변경 없음
    const timer = setTimeout(() => {
      void doSaveRef.current();
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [values]);

  function handleChange(part: SoapPart, text: string) {
    setValues((prev) => ({ ...prev, [part]: text })); // 디바운스 effect 가 lastSavedRef 비교로 저장 결정
  }

  function handleNewRecord() {
    // 현재 기록은 디바운스가 곧/이미 저장. 새 초안으로 전환 — 다음 입력이 새 행 POST.
    setActiveRecordId(null);
    activeIdRef.current = null; // 동기 갱신
    setValues(EMPTY_VALUES);
    lastSavedRef.current = JSON.stringify(EMPTY_VALUES); // 빈 초안 = 저장된 상태(즉시 autosave 미발화)
    setSavedAt(null);
  }

  if (loadError && records === null) {
    return (
      <section className="rounded-xl border border-border bg-card px-4 py-6 text-center">
        <p className="text-[13px] text-muted-foreground">{loadError}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
        >
          다시 시도
        </button>
      </section>
    );
  }

  if (records === null) {
    return (
      <section
        className="space-y-2 rounded-xl border border-border bg-card p-4"
        aria-busy="true"
        aria-label="진료기록 불러오는 중"
      >
        {[0, 1].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-md bg-muted" />
        ))}
      </section>
    );
  }

  // 이력 = 현재 활성 편집 대상 외 기록(읽기전용 — 작성자·시각). 1:N 의 직전·타 의사 기록.
  const history = records.filter((r) => r.id !== activeRecordId);

  return (
    <section aria-label="SOAP 진료기록" className="rounded-xl border border-border bg-card">
      {/* 헤더 — 타이틀 + autosave 인디케이터 + 새 진료기록 */}
      <header className="flex flex-wrap items-center gap-3 px-4 pb-2.5 pt-3.5">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">진료 기록</h2>
        <span className="text-[11.5px] text-muted-foreground">SOAP</span>
        {/* autosave 인디케이터 — polite 라이브 리전(UX-DR11) */}
        <div aria-live="polite" className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          {saving ? (
            <span>저장 중…</span>
          ) : savedAt ? (
            <>
              <span className="inline-flex size-[15px] items-center justify-center rounded-full bg-status-done text-white">
                <Check className="size-3" aria-hidden />
              </span>
              <span className="font-medium text-foreground">자동 저장됨</span>
              <span>· {savedAt}</span>
            </>
          ) : (
            <span>변경 시 자동 저장됩니다</span>
          )}
        </div>
        <button
          type="button"
          onClick={handleNewRecord}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-foreground hover:bg-muted"
        >
          <FilePlus2 className="size-3.5" aria-hidden />새 진료기록
        </button>
      </header>

      {/* full-bleed 1열 ledger — 각 파트 = 헤더 행 + 본문 행(가로 hairline 으로 구분, 좌우 테두리 없음) */}
      <div>
        {SOAP_PARTS.map(({ part, letter, ko, en, hint, badgeClass }) => {
          const empty = values[part].trim().length === 0;
          return (
            <div key={part} className="border-t border-border">
              {/* 헤더 행 — 배지 + 한글 + 영문 + 설명어(+ 빈 파트 표시) */}
              <div className="flex flex-wrap items-center gap-2 bg-muted/40 px-4 py-1.5">
                <span
                  className={`inline-flex size-5 items-center justify-center rounded border text-[11px] font-bold ${badgeClass}`}
                  aria-hidden
                >
                  {letter}
                </span>
                <span className="text-[12.5px] font-semibold text-foreground">{ko}</span>
                <span className="text-[11px] text-muted-foreground">{en}</span>
                {empty && (
                  <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span aria-hidden>○</span>비어 있음
                  </span>
                )}
              </div>
              {/* 본문 행 — textarea(132px), 포커스/입력 중 좌측 3px teal 액센트 + 옅은 틴트(음영 아님) */}
              <div className="border-l-[3px] border-l-transparent transition-colors focus-within:border-l-primary focus-within:bg-primary/[0.04]">
                <textarea
                  value={values[part]}
                  onChange={(e) => handleChange(part, e.target.value)}
                  placeholder={hint}
                  aria-label={`${ko}(${en})`}
                  className="block min-h-[132px] w-full resize-y cursor-text border-0 bg-transparent px-4 py-3 text-[13.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* 이력 — 같은 내원의 이전/타 의사 기록(읽기전용, 작성자·시각). 1:N(FR-041). */}
      {history.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
            이전 진료기록 ({history.length})
          </h3>
          <ul className="mt-2 space-y-1.5">
            {history.map((r) => {
              const mine = r.author_id === currentUserId;
              const filled = SOAP_PARTS.filter((p) => (r[p.part] ?? "").trim().length > 0)
                .map((p) => p.letter)
                .join("·");
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-[12px]"
                >
                  <span className="font-medium text-foreground tabular-nums">
                    {dateTimeKST(r.created_at)}
                  </span>
                  <span className="text-muted-foreground">{mine ? "본인 작성" : "다른 의사 작성"}</span>
                  {filled && <span className="text-muted-foreground">· {filled}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
