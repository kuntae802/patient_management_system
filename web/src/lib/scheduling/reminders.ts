import { apiFetch } from "@/lib/api/client";

// SMS 리마인더 디스패치·로그(Story 6.6) 공용 타입·조회·표시 헬퍼. FastAPI 응답의 거울(snake_case 유지
// — camelCase 변환 금지, project-context). 발송 = 시뮬/로그(실 SMS 미연동). 시각 = ISO timestamptz(UTC)
// → KST 표시는 Intl(formatKstDateTime). ⚠️ 응답엔 마스킹 수신처·비-식별 body 만(원시 phone·환자명 없음).

/** 리마인더 종류 — 예약 3일 전(d_minus_3)·1일 전(d_minus_1). */
export type ReminderKind = "d_minus_3" | "d_minus_1";

/** 발송 상태 — simulated(연락처 있어 시뮬 발송)·skipped(동의했으나 연락처 없음). */
export type NotificationStatus = "simulated" | "skipped";

/** FastAPI NotificationLogResponse 의 거울. ⚠️ 원시 phone·patient_name 필드 없음(PII 경계). */
export type NotificationLog = {
  id: string;
  appointment_id: string;
  patient_id: string;
  channel: string;
  reminder_kind: ReminderKind;
  recipient_masked: string | null;
  body: string;
  status: NotificationStatus;
  skip_reason: string | null;
  appointment_start: string;
  sent_at: string | null;
  created_at: string;
};

/** FastAPI ReminderRunSummary 의 거울 — 멱등 재실행 시 created/duplicate 구분. */
export type ReminderRunSummary = {
  as_of: string;
  created: number;
  duplicate: number;
  simulated: number;
  skipped: number;
  by_kind: Record<string, number>;
};

/** 리마인더 디스패치 실행(D-3·D-1 시뮬 발송). 게이트 notification.send. as_of 미지정 시 서버 KST 오늘. */
export function runReminders(asOf?: string): Promise<ReminderRunSummary> {
  const query = asOf ? `?${new URLSearchParams({ as_of: asOf })}` : "";
  return apiFetch<ReminderRunSummary>(`/v1/scheduling/reminders/run${query}`, { method: "POST" });
}

/** 알림 발송 이력 조회(최근순). 게이트 notification.read. */
export function fetchNotificationLogs(limit = 100): Promise<NotificationLog[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  return apiFetch<NotificationLog[]>(`/v1/scheduling/reminders?${query.toString()}`);
}

/** 종류 라벨(쉬운 말). */
export const REMINDER_KIND_LABEL: Record<ReminderKind, string> = {
  d_minus_3: "3일 전",
  d_minus_1: "1일 전",
};

/**
 * 발송 상태 표시 메타 — 음영 비의존(UX-DR20): 라벨 + 글리프 + 채움/테두리/잉크 다중 인코딩.
 * 발송=그린✓(status-done)·스킵=회색—(muted). 색만 의존 금지.
 */
export const NOTIFICATION_STATUS_META: Record<
  NotificationStatus,
  { label: string; glyph: string; badgeClass: string }
> = {
  simulated: {
    label: "발송",
    glyph: "✓",
    badgeClass: "border-status-done/45 bg-status-done/12 text-status-done-ink",
  },
  skipped: {
    label: "스킵",
    glyph: "—",
    badgeClass: "border-border bg-muted text-muted-foreground",
  },
};

/** 스킵 사유 한국어 라벨(현재 no_recipient 1종). */
export function skipReasonLabel(reason: string | null): string {
  if (reason === "no_recipient") return "연락처 없음";
  return reason ?? "";
}
