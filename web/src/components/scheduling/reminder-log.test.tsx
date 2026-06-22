import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReminderLog } from "@/components/scheduling/reminder-log";
import { usePermissions } from "@/hooks/use-permissions";
import {
  fetchNotificationLogs,
  runReminders,
  type NotificationLog,
  type ReminderRunSummary,
} from "@/lib/scheduling/reminders";

vi.mock("@/hooks/use-permissions", () => ({ usePermissions: vi.fn() }));
vi.mock("@/lib/scheduling/reminders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scheduling/reminders")>();
  return { ...actual, fetchNotificationLogs: vi.fn(), runReminders: vi.fn() };
});

const mockLogs = fetchNotificationLogs as unknown as ReturnType<typeof vi.fn>;
const mockRun = runReminders as unknown as ReturnType<typeof vi.fn>;

const SIM_LOG: NotificationLog = {
  id: "11111111-1111-4111-8111-111111111111",
  appointment_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  patient_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  channel: "sms",
  reminder_kind: "d_minus_3",
  recipient_masked: "010-****-5678",
  body: "[한울병원] 예약 3일 전 안내",
  status: "simulated",
  skip_reason: null,
  appointment_start: "2030-06-03T01:00:00Z",
  sent_at: "2030-05-31T02:00:00Z",
  created_at: "2030-05-31T02:00:00Z",
};
const SKIP_LOG: NotificationLog = {
  ...SIM_LOG,
  id: "22222222-2222-4222-8222-222222222222",
  appointment_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  reminder_kind: "d_minus_1",
  recipient_masked: null,
  status: "skipped",
  skip_reason: "no_recipient",
};

const SUMMARY: ReminderRunSummary = {
  as_of: "2030-05-31",
  created: 2,
  duplicate: 0,
  simulated: 1,
  skipped: 1,
  by_kind: { d_minus_3: 1, d_minus_1: 1 },
};

beforeEach(() => {
  vi.mocked(usePermissions).mockReturnValue({ role: "reception", has: () => true });
  mockLogs.mockResolvedValue([SIM_LOG, SKIP_LOG]);
  mockRun.mockResolvedValue(SUMMARY);
});

afterEach(() => vi.clearAllMocks());

describe("ReminderLog — 발송 로그 표 · 디스패치 실행 (Story 6.6)", () => {
  it("로그 표를 렌더한다 — 마스킹 수신처·종류·상태 라벨", async () => {
    render(<ReminderLog />);
    expect(await screen.findByText("010-****-5678")).toBeInTheDocument();
    expect(screen.getByText("3일 전")).toBeInTheDocument();
    expect(screen.getByText("1일 전")).toBeInTheDocument();
    expect(screen.getAllByText("발송").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("스킵")).toBeInTheDocument();
    // 연락처 없는 skipped → "(연락처 없음)" + 사유 라벨
    expect(screen.getByText("(연락처 없음)")).toBeInTheDocument();
    expect(screen.getByText("연락처 없음")).toBeInTheDocument();
  });

  it("원시 전화번호(가운데 4자리)를 노출하지 않는다 (PII 경계)", async () => {
    render(<ReminderLog />);
    await screen.findByText("010-****-5678");
    expect(document.body.textContent).not.toContain("1234");
  });

  it("'리마인더 실행' 클릭 → runReminders 호출 + 요약 표시 + 로그 재조회", async () => {
    const user = userEvent.setup();
    render(<ReminderLog />);
    await screen.findByText("010-****-5678");

    await user.click(screen.getByRole("button", { name: "리마인더 실행" }));

    await waitFor(() => expect(mockRun).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/발송 완료/)).toBeInTheDocument();
    expect(screen.getByText(/신규/)).toBeInTheDocument();
    // 실행 후 로그 재조회(초기 1 + 실행 후 1).
    expect(mockLogs).toHaveBeenCalledTimes(2);
  });

  it("이중 제출 락 — 발송 중 재클릭은 한 번만 실행", async () => {
    const user = userEvent.setup();
    let resolveRun: (v: ReminderRunSummary) => void = () => {};
    mockRun.mockImplementation(
      () =>
        new Promise<ReminderRunSummary>((resolve) => {
          resolveRun = resolve;
        }),
    );
    render(<ReminderLog />);
    await screen.findByText("010-****-5678");

    const btn = screen.getByRole("button", { name: "리마인더 실행" });
    await user.click(btn);
    // 발송 중 → 버튼 비활성("발송 중…")
    expect(await screen.findByRole("button", { name: "발송 중…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "발송 중…" }));

    resolveRun(SUMMARY);
    await waitFor(() => expect(mockRun).toHaveBeenCalledTimes(1));
  });

  it("빈 상태 — 로그 없을 때 안내", async () => {
    mockLogs.mockResolvedValue([]);
    render(<ReminderLog />);
    expect(await screen.findByText(/아직 발송된 리마인더가 없습니다/)).toBeInTheDocument();
  });

  it("notification.send 미보유 → 실행 버튼 잠금(LockedAction·사유 노출)", async () => {
    vi.mocked(usePermissions).mockReturnValue({ role: "reception", has: () => false });
    render(<ReminderLog />);
    await screen.findByText("010-****-5678");
    // 잠금: 클릭 가능한 실행 버튼 대신 aria-disabled + 사유.
    expect(screen.getByText("알림 디스패치 권한이 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "리마인더 실행" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
