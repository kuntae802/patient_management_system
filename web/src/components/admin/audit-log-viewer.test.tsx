import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi, type Mock } from "vitest";

import { AuditLogViewer } from "@/components/admin/audit-log-viewer";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { AuditLogPage } from "@/lib/admin/audit";
import type { StaffMember } from "@/lib/admin/staff";

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

beforeAll(() => {
  // base-ui Dialog 는 matchMedia/ResizeObserver 를 참조 → jsdom 셰임(staff-directory.test 패턴).
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

afterEach(() => vi.clearAllMocks());

const STAFF: StaffMember[] = [
  {
    id: "admin-uuid",
    employee_no: "A0001",
    name: "관리자",
    role_code: "admin",
    employment_status: "active",
    license_no: null,
    license_type: null,
    phone: null,
    hire_date: null,
    department_id: null,
    created_at: "2026-06-20T00:00:00Z",
    updated_at: "2026-06-20T00:00:00Z",
  },
];

const PAGE: AuditLogPage = {
  data: [
    {
      id: "e1",
      actor_id: "admin-uuid",
      actor_name: "관리자",
      actor_employee_no: "A0001",
      action: "create",
      target_table: "role_permissions",
      target_id: "rp1",
      before_data: null,
      after_data: { role_id: "r1", permission_id: "p1" },
      ip_address: null,
      created_at: "2026-06-20T01:00:00Z",
    },
    {
      id: "e2",
      actor_id: "admin-uuid",
      actor_name: "관리자",
      actor_employee_no: "A0001",
      action: "update",
      target_table: "users",
      target_id: "u1",
      before_data: { phone: "010-1111-2222", name: "김간호" },
      after_data: { phone: "010-3333-4444", name: "김간호사" },
      ip_address: null,
      created_at: "2026-06-20T02:00:00Z",
    },
  ],
  meta: { page: 1, page_size: 50, total: 2 },
};

function mockApi(auditPage: AuditLogPage = PAGE) {
  (apiFetch as Mock).mockImplementation((path: string) =>
    path.includes("audit-logs") ? Promise.resolve(auditPage) : Promise.resolve(STAFF),
  );
}

describe("AuditLogViewer", () => {
  it("마운트 시 감사 로그 조회 → 행위자·동작·대상 렌더", async () => {
    mockApi();
    render(<AuditLogViewer />);

    // 목록 테이블 스코프(필터 <option> 라벨과의 충돌 회피).
    const table = await screen.findByRole("table");
    expect(within(table).getByText("역할-권한")).toBeInTheDocument(); // role_permissions 라벨
    expect(within(table).getByText("직원")).toBeInTheDocument(); // users 라벨
    expect(within(table).getByText("생성")).toBeInTheDocument(); // create 배지
    expect(within(table).getByText("수정")).toBeInTheDocument(); // update 배지
    // 행위자 표시(이름+사번) — 셀 2개
    expect(within(table).getAllByText("관리자 (A0001)").length).toBe(2);
    // audit-logs 조회가 page 파라미터로 호출됨
    expect(
      (apiFetch as Mock).mock.calls.some(([p]) => String(p).startsWith("/v1/admin/audit-logs?")),
    ).toBe(true);
  });

  it("동작 필터 적용 → action 파라미터로 재조회", async () => {
    mockApi();
    render(<AuditLogViewer />);
    await screen.findByRole("table");

    await userEvent.selectOptions(screen.getByLabelText("동작 필터"), "create");

    await waitFor(() => {
      const calls = (apiFetch as Mock).mock.calls.filter(([p]) => String(p).includes("audit-logs"));
      expect(calls.some(([p]) => String(p).includes("action=create"))).toBe(true);
    });
  });

  it("상세 보기 → 읽기전용 diff, 민감 필드(phone) 마스킹·raw 미노출", async () => {
    mockApi();
    render(<AuditLogViewer />);
    await screen.findByRole("table");

    const detailButtons = screen.getAllByRole("button", { name: /감사 상세 보기/ });
    await userEvent.click(detailButtons[1]); // 두 번째 행(users update)

    // 모달 고유 텍스트(목록/옵션과 미충돌) — 화면 전역 쿼리로 충분.
    expect(await screen.findByText(/감사 상세/)).toBeInTheDocument();
    // phone 은 마스킹, raw 값 노출 안 됨
    expect(screen.getAllByText("●●●● (마스킹됨)").length).toBeGreaterThan(0);
    expect(screen.queryByText("010-1111-2222")).toBeNull();
    expect(screen.queryByText("010-3333-4444")).toBeNull();
    // name 은 비민감 → 변경 후 값 표시
    expect(screen.getByText("김간호사")).toBeInTheDocument();
    // 읽기전용 — 저장/삭제/편집 버튼 없음, 닫기만
    expect(screen.queryByRole("button", { name: /저장|삭제|편집/ })).toBeNull();
    expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument();
  });

  it("결과 0건 → 빈 상태 문구", async () => {
    mockApi({ data: [], meta: { page: 1, page_size: 50, total: 0 } });
    render(<AuditLogViewer />);

    expect(
      await screen.findByText("조건에 해당하는 감사 로그가 없습니다."),
    ).toBeInTheDocument();
  });

  it("조회 실패 → 오류 메시지 + 다시 시도", async () => {
    (apiFetch as Mock).mockImplementation((path: string) =>
      path.includes("audit-logs")
        ? Promise.reject(
            new ApiError("service_unavailable", "감사 로그를 불러오지 못했습니다.", 503),
          )
        : Promise.resolve(STAFF),
    );
    render(<AuditLogViewer />);

    // 오류 메시지는 본문 + aria-live 상태 두 곳에 노출 → 다중 매치 허용.
    const msgs = await screen.findAllByText("감사 로그를 불러오지 못했습니다.");
    expect(msgs.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});
