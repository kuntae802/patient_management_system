import { FlaskConical, Pill } from "lucide-react";

import { ExamResultBadge } from "@/components/portal/exam-result-badge";
import {
  formatDosage,
  type PatientEncounterDetail,
  type PatientExaminationItem,
} from "@/lib/patient/encounter-detail";

// 내원 카드 펼침 상세(Story 8.2·FR-121·UX-DR23): 처방(복약 안내 쉬운 말) + 검사 결과 요약(정상/주의
// 플래그). 쉬운 말·색 비의존·환자 톤. 처방/검사 0건 섹션 생략, 둘 다 없으면 안내. 하단 안내 노트(목업).
// 표시 전용(데이터는 부모 VisitCard 가 지연 로드) — 임상 서사(findings)는 서버가 미투영.
export function EncounterDetail({ detail }: { detail: PatientEncounterDetail }) {
  const hasRx = detail.prescriptions.length > 0;
  const hasExam = detail.examinations.length > 0;

  if (!hasRx && !hasExam) {
    return (
      <p className="mt-3 border-t border-dashed border-border pt-3 text-[13px] text-muted-foreground">
        이 진료에는 처방·검사 내역이 없어요.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-4 border-t border-dashed border-border pt-3">
      {hasRx && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
            <Pill className="size-4 text-primary" aria-hidden />
            처방받은 약
          </h3>
          <ul className="space-y-2">
            {detail.prescriptions.map((rx, i) => {
              const dosage = formatDosage(rx);
              return (
                <li
                  key={i}
                  className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3 py-2.5"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[14px] font-semibold text-foreground">
                      {rx.drug_name}
                      {rx.coverage_type === "non_covered" && (
                        <span className="ml-1.5 align-middle text-[11px] font-normal text-muted-foreground">
                          비급여
                        </span>
                      )}
                    </span>
                    {dosage && (
                      <span className="text-[12.5px] text-muted-foreground">{dosage}</span>
                    )}
                  </span>
                  {rx.duration_days != null && (
                    <span className="shrink-0 rounded-lg border border-primary/20 bg-primary/10 px-2 py-0.5 text-[12px] font-semibold text-primary">
                      {rx.duration_days}일분
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {hasExam && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
            <FlaskConical className="size-4 text-primary" aria-hidden />
            검사 결과 요약
          </h3>
          <ul className="space-y-2">
            {detail.examinations.map((ex, i) => (
              <ExamRow key={i} exam={ex} />
            ))}
          </ul>
        </section>
      )}

      <p className="text-[12px] leading-relaxed text-muted-foreground">
        자세한 검사 수치와 진료 기록은 진료받으신 의원에 보관되어 있어요.
      </p>
    </div>
  );
}

/** 검사 1줄 — 완료면 결과 요약(있으면) + 정상/주의 배지, 완료 전이면 "결과 준비 중" 폴백(색 비의존). */
function ExamRow({ exam }: { exam: PatientExaminationItem }) {
  const done = exam.status === "completed";
  const summary = done
    ? (exam.patient_result_summary ??
      "결과가 확인되었어요. 자세한 내용은 진료받으신 의원에 문의해 주세요.")
    : "아직 결과가 나오지 않았어요.";
  return (
    <li className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px] font-semibold text-foreground">{exam.exam_name}</span>
        <span className="text-[12.5px] text-muted-foreground">{summary}</span>
      </span>
      {done && exam.patient_result_flag && <ExamResultBadge flag={exam.patient_result_flag} />}
    </li>
  );
}
