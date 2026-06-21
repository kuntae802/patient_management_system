import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SoapLedger } from "@/components/encounters/soap-ledger";
import { type MedicalRecord } from "@/lib/encounters/medical-records";
import { type Encounter } from "@/lib/reception/encounters";

// SOAP ledger(Story 4.6) — medical-records lib·active-session·supabase 세션·sonner 모킹.
// 검증: 4 파트 렌더·빈 파트 표시·autosave 인디케이터(polite)·스테일 탭 저장 거부(핵심)·작성자 스코프.
vi.mock("@/lib/encounters/medical-records", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/encounters/medical-records")>();
  return {
    ...actual,
    fetchMedicalRecords: vi.fn(),
    createMedicalRecord: vi.fn(),
    updateMedicalRecord: vi.fn(),
  };
});
vi.mock("@/lib/encounters/active-session", () => ({ isActiveEncounter: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: "doc1" } } } }) },
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { isActiveEncounter } from "@/lib/encounters/active-session";
import {
  createMedicalRecord,
  fetchMedicalRecords,
  updateMedicalRecord,
} from "@/lib/encounters/medical-records";

const mockFetch = vi.mocked(fetchMedicalRecords);
const mockCreate = vi.mocked(createMedicalRecord);
const mockUpdate = vi.mocked(updateMedicalRecord);
const mockIsActive = vi.mocked(isActiveEncounter);

afterEach(() => vi.clearAllMocks());

const ENC: Encounter = {
  id: "e1",
  encounter_no: "00000007",
  patient_id: "p1",
  department_id: "d1",
  room_id: null,
  doctor_id: "doc1",
  visit_type: "walk_in",
  status: "in_progress",
  cancel_reason: null,
  registered_at: "2026-06-21T00:00:00Z",
  consult_started_at: "2026-06-21T00:05:00Z",
  completed_at: null,
  cancelled_at: null,
  no_show_at: null,
  called_at: null,
  call_count: 0,
  last_called_by: null,
  created_by: "r1",
  is_active: true,
  created_at: "2026-06-21T00:00:00Z",
  updated_at: "2026-06-21T00:00:00Z",
};

function makeRecord(over: Partial<MedicalRecord>): MedicalRecord {
  return {
    id: "rec1",
    encounter_id: "e1",
    author_id: "doc1",
    subjective: null,
    objective: null,
    assessment: null,
    plan: null,
    is_active: true,
    created_at: "2026-06-21T00:10:00Z",
    updated_at: "2026-06-21T00:10:00Z",
    ...over,
  };
}

describe("SoapLedger", () => {
  it("4 파트(S/O/A/P) 헤더·배지·placeholder 를 렌더한다", async () => {
    mockIsActive.mockReturnValue(true);
    mockFetch.mockResolvedValueOnce([]);
    render(<SoapLedger encounter={ENC} />);
    expect(await screen.findByText("주관적")).toBeInTheDocument();
    expect(screen.getByText("객관적")).toBeInTheDocument();
    expect(screen.getByText("평가")).toBeInTheDocument();
    expect(screen.getByText("계획")).toBeInTheDocument();
    // 배지 글리프 S/O/A/P + 라벨링된 textarea 4개.
    expect(screen.getByLabelText("주관적(Subjective)")).toBeInTheDocument();
    expect(screen.getByLabelText("계획(Plan)")).toBeInTheDocument();
  });

  it("빈 파트는 색만 아니라 '비어 있음' 라벨로도 표시한다(UX-DR11)", async () => {
    mockIsActive.mockReturnValue(true);
    mockFetch.mockResolvedValueOnce([]);
    render(<SoapLedger encounter={ENC} />);
    await screen.findByText("주관적");
    // 4 파트 모두 비어 있음 → 4개.
    expect(screen.getAllByText("비어 있음")).toHaveLength(4);
  });

  it("autosave 인디케이터는 polite 라이브 리전이며 초기 안내를 보인다", async () => {
    mockIsActive.mockReturnValue(true);
    mockFetch.mockResolvedValueOnce([]);
    const { container } = render(<SoapLedger encounter={ENC} />);
    await screen.findByText("주관적");
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live).toHaveTextContent("변경 시 자동 저장됩니다");
  });

  it("작성자 스코프: 현재 임상의의 최근 기록을 ledger 에 로드한다", async () => {
    mockIsActive.mockReturnValue(true);
    mockFetch.mockResolvedValueOnce([makeRecord({ id: "mine", author_id: "doc1", subjective: "내 기록" })]);
    render(<SoapLedger encounter={ENC} />);
    const s = (await screen.findByLabelText("주관적(Subjective)")) as HTMLTextAreaElement;
    expect(s.value).toBe("내 기록");
  });

  it("작성자 스코프: 타 의사 기록은 ledger 가 아닌 이력으로 표시(덮어쓰기 방지)", async () => {
    mockIsActive.mockReturnValue(true);
    mockFetch.mockResolvedValueOnce([
      makeRecord({ id: "other", author_id: "doc2", subjective: "남의 기록" }),
    ]);
    render(<SoapLedger encounter={ENC} />);
    const s = (await screen.findByLabelText("주관적(Subjective)")) as HTMLTextAreaElement;
    expect(s.value).toBe(""); // 새 초안(타 의사 기록은 활성 편집 대상 아님)
    expect(screen.getByText("다른 의사 작성")).toBeInTheDocument();
  });

  it("⚠️ 스테일 탭(isActiveEncounter=false)에선 autosave 가 저장을 거부한다(UX-DR21)", async () => {
    mockIsActive.mockReturnValue(false); // 다른 탭이 활성 내원 점유 = 이 탭 보류
    mockFetch.mockResolvedValueOnce([]);
    render(<SoapLedger encounter={ENC} />);
    // 로드는 real timer 로 기다린 뒤 디바운스 창에만 fake timer 사용.
    const s = await screen.findByLabelText("주관적(Subjective)");
    vi.useFakeTimers();
    try {
      fireEvent.change(s, { target: { value: "스테일 탭 입력" } });
      await vi.advanceTimersByTimeAsync(2000); // 디바운스(1.5s) 경과
      expect(mockCreate).not.toHaveBeenCalled(); // 저장 거부
    } finally {
      vi.useRealTimers();
    }
  });

  it("활성 탭에선 첫 입력이 디바운스 후 POST 로 생성된다", async () => {
    mockIsActive.mockReturnValue(true);
    mockFetch.mockResolvedValueOnce([]);
    mockCreate.mockResolvedValueOnce(makeRecord({ id: "new", subjective: "두통" }));
    render(<SoapLedger encounter={ENC} />);
    const s = await screen.findByLabelText("주관적(Subjective)");
    vi.useFakeTimers();
    try {
      fireEvent.change(s, { target: { value: "두통" } });
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockCreate).toHaveBeenCalledWith(
        "e1",
        expect.objectContaining({ subjective: "두통" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠️ 저장(POST) 중 들어온 입력은 유실되지 않고 후속 PUT 으로 반영된다(P1 무손실)", async () => {
    mockIsActive.mockReturnValue(true);
    mockFetch.mockResolvedValueOnce([]);
    // create 를 수동 제어 → in-flight 유지(저장 중 추가 입력 시뮬레이션)
    let resolveCreate!: (r: ReturnType<typeof makeRecord>) => void;
    mockCreate.mockReturnValueOnce(
      new Promise((res) => {
        resolveCreate = res;
      }),
    );
    mockUpdate.mockResolvedValueOnce(makeRecord({ id: "new", subjective: "두통 심함" }));
    render(<SoapLedger encounter={ENC} />);
    const s = await screen.findByLabelText("주관적(Subjective)");
    vi.useFakeTimers();
    try {
      // 1차 입력 → 디바운스 → create(in-flight, 미해결)
      fireEvent.change(s, { target: { value: "두통" } });
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      // create 진행 중 추가 입력
      fireEvent.change(s, { target: { value: "두통 심함" } });
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockUpdate).not.toHaveBeenCalled(); // 아직 in-flight → pending 큐잉
      // create 완료 → finally 의 pending 이어-저장이 최신값으로 PUT(이중 POST 아님)
      resolveCreate(makeRecord({ id: "new", subjective: "두통" }));
      await vi.advanceTimersByTimeAsync(50);
      expect(mockCreate).toHaveBeenCalledTimes(1); // 이중 POST 없음
      expect(mockUpdate).toHaveBeenCalledWith(
        "e1",
        "new",
        expect.objectContaining({ subjective: "두통 심함" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
