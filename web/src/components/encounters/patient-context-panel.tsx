"use client";

import { useCallback, useEffect, useState } from "react";

import { StatusBadge } from "@/components/encounters/status-badge";
import { ApiError } from "@/lib/api/client";
import { type EncounterListItem } from "@/lib/reception/encounters";
import {
  bloodTypeLabel,
  fetchPatient,
  fetchPatientEncounters,
  type Patient,
} from "@/lib/reception/patients";

// 진료 허브 좌 컨텍스트 패널(Story 4.5, FR-031·FR-032, 읽기전용) — 활력·임상 프로필·과거 내원 이력.
// ⚠️ 데이터 현실: 간호 활력 테이블(5.6)·과거 진단/처방/검사(4.7/Epic5)는 미구축 → 명시 빈-상태로
// 렌더(가짜 데이터·테이블 선행생성 금지). 실데이터 = 임상 프로필(0009/3.2)·과거 내원(0010).

// API `fetch_patient_encounters` 의 안전 상한(db.py limit 100)과 일치 — 도달 시 절단을 명시(no-silent-cap).
const HISTORY_LIMIT = 100;

function dateKST(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Seoul",
  });
}

export function PatientContextPanel({
  patientId,
  currentEncounterId,
}: {
  patientId: string;
  currentEncounterId: string;
}) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [history, setHistory] = useState<EncounterListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, h] = await Promise.all([
        fetchPatient(patientId),
        fetchPatientEncounters(patientId),
      ]);
      setPatient(p);
      setHistory(h);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "환자 컨텍스트를 불러오지 못했습니다.");
    }
  }, [patientId]);

  useEffect(() => {
    // setState 는 await 이후(patient-detail 동형 — 외부 시스템 동기화의 정당한 예외).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error) {
    return (
      <Card title="환자 컨텍스트">
        <p className="text-[12px] text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 rounded-md border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-foreground hover:bg-muted"
        >
          다시 시도
        </button>
      </Card>
    );
  }

  // 과거 이력 = 현재 진행중 내원 제외(현재는 배너·중앙이 다룸).
  const pastHistory = (history ?? []).filter((e) => e.id !== currentEncounterId);

  return (
    <div className="space-y-3">
      {/* 활력징후 — 명시 빈-상태(간호 활력 기록은 Epic 5 / 5.6). */}
      <Card title="활력징후">
        <p className="text-[12px] text-muted-foreground">
          측정된 활력징후가 없습니다.
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground/80">
          간호 활력징후 기록은 Epic 5(간호)에서 입력됩니다.
        </p>
      </Card>

      {/* 임상 프로필(0009/3.2) — 읽기전용. */}
      <Card title="임상 프로필">
        {patient === null ? (
          <PanelSkeleton />
        ) : (
          <dl className="space-y-2 text-[12.5px]">
            <ProfileItem label="혈액형" value={bloodTypeLabel(patient.blood_type)} present />
            <ProfileItem label="알레르기" value={patient.allergies} />
            <ProfileItem label="기저질환" value={patient.chronic_diseases} />
            <ProfileItem label="복용약" value={patient.medications} />
            <ProfileItem label="특이사항" value={patient.notes} />
          </dl>
        )}
      </Card>

      {/* 과거 내원 이력(0010) — 최근순 타임라인. 진단/처방 per-visit 부착은 4.7/Epic5. */}
      <Card title="과거 내원 이력">
        {history === null ? (
          <PanelSkeleton />
        ) : pastHistory.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">과거 내원 이력이 없습니다(첫 내원).</p>
        ) : (
          <ul>
            {pastHistory.map((e) => (
              <li
                key={e.id}
                className="flex gap-2.5 border-b border-border/60 py-2 last:border-0"
              >
                <span
                  className="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-foreground tabular-nums">
                      {dateKST(e.registered_at ?? e.created_at)}
                    </span>
                    <StatusBadge status={e.status} />
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {e.department_name}
                    {e.doctor_name ? ` · ${e.doctor_name}` : ""}
                  </p>
                </div>
              </li>
            ))}
            {(history?.length ?? 0) >= HISTORY_LIMIT && (
              <li className="pt-2 text-[11px] text-status-received-ink">
                최근 {HISTORY_LIMIT}건만 표시됩니다(이전 이력은 생략).
              </li>
            )}
            <li className="pt-2 text-[11px] text-muted-foreground/80">
              진단·처방 이력은 향후 표시됩니다(Story 4.7 · Epic 5).
            </li>
          </ul>
        )}
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <h3 className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

// 프로필 항목 — present(혈액형 등 항상 값 있음) 외에는 빈 값이면 "기록 없음"(muted). 전체 텍스트 무-truncate.
function ProfileItem({
  label,
  value,
  present = false,
}: {
  label: string;
  value: string | null;
  present?: boolean;
}) {
  const hasValue = present || !!value;
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd
        className={
          hasValue
            ? "whitespace-pre-wrap break-words text-foreground"
            : "text-muted-foreground/70"
        }
      >
        {value || "기록 없음"}
      </dd>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="불러오는 중">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-muted" />
      ))}
    </div>
  );
}
