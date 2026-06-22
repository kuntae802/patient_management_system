// 오더 안전·표시 순수 유틸(Story 5.5) — 알레르기 교차검증(UX-DR21②)·누락 0 디텍터(UX-DR21⑥)·
// 수가 자동 산정 프리뷰(UX-DR13). 전부 순수 함수(네트워크·상태 없음 — 테스트 용이).
// ⚠️ allergyTokens/allergyMatch 는 서버 `_allergy_conflicts`(api/app/core/db.py)의 거울 — 즉시 UX
//    경고용. 서버가 발행 시 재검증·강제(권위). 한쪽만 바꾸면 클라 경고와 서버 차단이 드리프트.

/**
 * 알레르기 자유텍스트를 토큰화 — 구분자(쉼표·중점·슬래시·세미콜론·공백)로 분리, 길이 ≥2, 소문자.
 * 구조화 알레르겐 없음(0009 자유텍스트) → 직접 토큰만(서버 _allergy_conflicts 거울).
 */
export function allergyTokens(
  allergiesText: string | null | undefined,
): string[] {
  if (!allergiesText || !allergiesText.trim()) return [];
  return Array.from(
    new Set(
      allergiesText
        .split(/[,、·/;\s]+/)
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length >= 2),
    ),
  );
}

/**
 * 약품명이 기록 알레르기 토큰과 부분일치하면 매칭 토큰 반환, 아니면 null(휴리스틱).
 * ⚠️ 클래스 매칭 불가(페니실린 ⊄ 아목시실린) — 직접 토큰 일치만(정직한 한계).
 */
export function allergyMatch(
  allergiesText: string | null | undefined,
  drugName: string,
): string | null {
  const nameNorm = (drugName || "").toLowerCase();
  for (const tok of allergyTokens(allergiesText)) {
    if (tok && nameNorm.includes(tok)) return tok;
  }
  return null;
}

/** 누락 0 디텍터 임계치(분) — 지시 상태로 이 시간 초과 미수행 시 '지연' surface(UX-DR21⑥). */
export const OVERDUE_THRESHOLD_MIN = 30;

/** 지시 후 경과 분(now - ordered_at, 음수는 0). 디텍터 라벨("지연 N분")·판정 공용. */
export function elapsedMinutes(orderedAtISO: string, nowMs: number): number {
  const orderedMs = new Date(orderedAtISO).getTime();
  if (Number.isNaN(orderedMs)) return 0;
  return Math.max(0, Math.floor((nowMs - orderedMs) / 60000));
}

/**
 * 미수행 오더가 지연인지(누락 0 디텍터). status='ordered'(지시·미수행)이고 임계치 초과 시 true.
 * ⚠️ 처방(issued)·수행완료(performed/completed)는 비대상(지시→수행 대기 오더만 — 검사·처치).
 */
export function isOverdue(
  orderedAtISO: string,
  status: string,
  nowMs: number,
  thresholdMin: number = OVERDUE_THRESHOLD_MIN,
): boolean {
  if (status !== "ordered") return false;
  return elapsedMinutes(orderedAtISO, nowMs) >= thresholdMin;
}

/** pay-chip·프리뷰 합산 입력(fee_schedule 기반 오더 — 검사·영상·처치). */
export type FeeItem = { amount_krw: number; coverage_type: string };

/** 수가 자동 산정 프리뷰 소계(UX-DR13) — 급여/비급여/합계(KRW 정수). */
export type FeePreview = {
  coveredKrw: number;
  nonCoveredKrw: number;
  totalKrw: number;
};

/**
 * 수가 자동 산정 프리뷰 — fee_schedule 기반 오더(검사·영상·처치)의 amount_krw 를 급여/비급여로 소계.
 * ⚠️ 처방(약품)은 약가 컬럼 없음(0007) → 제외(처방은 pay-chip 분류만·금액 미표시). 진찰료 자동산정·
 *    본인부담 산정·실제 수가 발생은 5.10/Epic7 — 본 프리뷰는 표시 전용 근사.
 */
export function feePreview(items: FeeItem[]): FeePreview {
  let coveredKrw = 0;
  let nonCoveredKrw = 0;
  for (const it of items) {
    if (it.coverage_type === "non_covered") nonCoveredKrw += it.amount_krw;
    else coveredKrw += it.amount_krw;
  }
  return { coveredKrw, nonCoveredKrw, totalKrw: coveredKrw + nonCoveredKrw };
}

/** coverage_type → 한국어 pay-chip 라벨. */
export function coverageLabel(coverageType: string): string {
  return coverageType === "non_covered" ? "비급여" : "급여";
}
