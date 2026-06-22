"use client";

import { BellRing } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { PermissionGate } from "@/components/auth/permission-gate";
import { ApiError } from "@/lib/api/client";
import { formatKstDateTime } from "@/lib/admin/schedule";
import {
  fetchNotificationLogs,
  runReminders,
  NOTIFICATION_STATUS_META,
  REMINDER_KIND_LABEL,
  skipReasonLabel,
  type NotificationLog,
  type ReminderRunSummary,
} from "@/lib/scheduling/reminders";

const FIELD =
  "h-9 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";

// SMS 리마인더 디스패치·로그(원무, Story 6.6·FR-014). 발송 = 시뮬/로그(실 SMS 미연동). "리마인더 실행"
// 으로 booked∩동의∩{D-3,D-1} 예약에 시뮬 발송 후 멱등 로그. as_of(선택)로 "오늘로 가정할 날짜" 지정 →
// 데모/검증. 실행=notification.send(PermissionGate)·조회=notification.read(서버 가드). ⚠️ 마스킹 수신처·
// 비-식별 메시지만 표시(원시 phone·환자명 없음·PII 경계).
export function ReminderLog() {
  const [logs, setLogs] = useState<NotificationLog[] | null>(null);
  const [asOf, setAsOf] = useState("");
  const [summary, setSummary] = useState<ReminderRunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const [running, setRunning] = useState(false);

  const loadLogs = useCallback(async () => {
    try {
      const rows = await fetchNotificationLogs(200);
      setLogs(rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "리마인더 로그를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLogs();
  }, [loadLogs]);

  async function onRun() {
    if (runningRef.current) return; // 이중 제출 락(mutation 중 재클릭 차단)
    runningRef.current = true;
    setRunning(true);
    setError(null);
    try {
      const result = await runReminders(asOf || undefined);
      setSummary(result);
      await loadLogs();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "리마인더 실행에 실패했습니다.");
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-2">
        <BellRing className="size-5 text-primary" aria-hidden />
        <div>
          <h1 className="text-[17px] font-semibold text-foreground">리마인더</h1>
          <p className="text-[12.5px] text-muted-foreground">
            예약 3일 전·1일 전 SMS 리마인더를 발송하고 발송 이력을 확인합니다. (발송은 시뮬/로그)
          </p>
        </div>
      </header>

      {/* 실행 패널 — as_of("오늘로 가정할 날짜", 미입력 시 오늘) + 디스패치 버튼(notification.send) */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card/40 p-4">
        <label className="space-y-1">
          <span className="block text-[12px] font-medium text-foreground">기준일 (선택)</span>
          <input
            type="date"
            className={FIELD}
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            aria-describedby="asof-hint"
          />
        </label>
        <PermissionGate
          permission="notification.send"
          lockedLabel="리마인더 실행"
          reason="알림 디스패치 권한이 없습니다."
        >
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {running ? "발송 중…" : "리마인더 실행"}
          </button>
        </PermissionGate>
        <span id="asof-hint" className="text-[12px] text-muted-foreground">
          기준일의 3일 후·1일 후 예약에 발송합니다. 미입력 시 오늘 기준.
        </span>
      </div>

      {summary && (
        <p role="status" aria-live="polite" className="text-[13px] text-foreground">
          발송 완료 — 신규 <b>{summary.created}</b>건 (발송 {summary.simulated} · 스킵{" "}
          {summary.skipped}) · 3일 전 {summary.by_kind.d_minus_3 ?? 0} · 1일 전{" "}
          {summary.by_kind.d_minus_1 ?? 0}
          {summary.duplicate > 0 ? ` · 중복 ${summary.duplicate}` : ""}
        </p>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-status-cancelled">
          {error}
        </p>
      )}

      {/* 로그 표 — 발송시각·종류·예약시각·수신처(마스킹)·상태·사유 */}
      {logs === null ? (
        <p className="text-[13px] text-muted-foreground" aria-live="polite">
          불러오는 중…
        </p>
      ) : logs.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          아직 발송된 리마인더가 없습니다. 기준일을 정하고 “리마인더 실행”을 눌러 보세요.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">발송 시각</th>
                <th className="px-3 py-2 font-medium">종류</th>
                <th className="px-3 py-2 font-medium">예약 시각</th>
                <th className="px-3 py-2 font-medium">수신처</th>
                <th className="px-3 py-2 font-medium">상태</th>
                <th className="px-3 py-2 font-medium">사유</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const meta = NOTIFICATION_STATUS_META[log.status];
                return (
                  <tr key={log.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 tabular-nums text-foreground">
                      {formatKstDateTime(log.created_at)}
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      {REMINDER_KIND_LABEL[log.reminder_kind]}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {formatKstDateTime(log.appointment_start)}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-foreground">
                      {log.recipient_masked ?? (
                        <span className="text-muted-foreground">(연락처 없음)</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[12px] ${meta.badgeClass}`}
                      >
                        <span aria-hidden>{meta.glyph}</span>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {skipReasonLabel(log.skip_reason)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
