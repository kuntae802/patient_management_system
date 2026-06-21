import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi, type Mock } from "vitest";

import { MasterSearchPicker } from "@/components/ui/master-search-picker";
import {
  fetchCurrentlyValidMasters,
  masterItemLabel,
  type MasterPickerItem,
} from "@/lib/admin/masters";
import { createClient } from "@/lib/supabase/client";

// Supabase 브라우저 클라이언트는 직접 호출되지 않도록 모킹(대부분 테스트는 items 주입으로 fetch 경로 우회).
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn(() => ({})) }));

// Base UI Combobox(floating-ui) 가 jsdom 에서 요구하는 브라우저 API 스텁(masters-manager.test 패턴).
beforeAll(() => {
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

const TODAY = "2026-06-20";

const DX_HTN: MasterPickerItem = {
  id: "dx1",
  code: "I10",
  name: "본태성 고혈압",
  kind: "diagnosis",
  is_active: true,
  effective_from: "2020-01-01",
  effective_to: null,
};
const DX_DM: MasterPickerItem = {
  id: "dx2",
  code: "E11.9",
  name: "제2형 당뇨병",
  kind: "diagnosis",
  is_active: true,
  effective_from: "2020-01-01",
  effective_to: null,
};
const DX_EXPIRED: MasterPickerItem = {
  id: "dx3",
  code: "OLD1",
  name: "만료상병",
  kind: "diagnosis",
  is_active: true,
  effective_from: "2019-01-01",
  effective_to: "2021-12-31",
};
const DX_PENDING: MasterPickerItem = {
  id: "dx4",
  code: "FUT1",
  name: "발효전상병",
  kind: "diagnosis",
  is_active: true,
  effective_from: "2099-01-01",
  effective_to: null,
};
const DX_INACTIVE: MasterPickerItem = {
  id: "dx5",
  code: "INA1",
  name: "비활성상병",
  kind: "diagnosis",
  is_active: false,
  effective_from: "2020-01-01",
  effective_to: null,
};
const DRUG: MasterPickerItem = {
  id: "drg1",
  code: "D-AML5",
  name: "암로디핀 5mg",
  kind: "drug",
  is_active: true,
  effective_from: "2020-01-01",
  effective_to: null,
  ingredient_code: "100801ATB",
  unit: "정",
};
const FEE: MasterPickerItem = {
  id: "fee1",
  code: "AA157",
  name: "재진진찰료",
  kind: "fee_schedule",
  is_active: true,
  effective_from: "2020-01-01",
  effective_to: null,
  category: "진찰",
  amount_krw: 12000,
};

// 단일 선택 제어형 하니스(선택 시 화면 반영 확인용).
function SingleHarness({ items }: { items: MasterPickerItem[] }) {
  const [value, setValue] = useState<MasterPickerItem | null>(null);
  return (
    <MasterSearchPicker
      kind="diagnosis"
      today={TODAY}
      items={items}
      value={value}
      onValueChange={setValue}
      ariaLabel="진단 검색"
    />
  );
}

describe("MasterSearchPicker — AC1 free-text 차단 · 마스터 검색·선택", () => {
  it("코드/명칭 검색 후 항목을 선택하면 onValueChange 가 해당 item 으로 호출된다", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MasterSearchPicker
        kind="diagnosis"
        today={TODAY}
        items={[DX_HTN, DX_DM]}
        value={null}
        onValueChange={onChange}
        ariaLabel="진단 검색"
      />,
    );

    const input = screen.getByRole("combobox", { name: "진단 검색" });
    await user.click(input);
    await user.type(input, "고혈압");

    const option = await screen.findByRole("option", { name: /본태성 고혈압/ });
    await user.click(option);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(DX_HTN);
  });

  it("마스터에 없는 임의 텍스트는 값으로 커밋되지 않는다(Empty 표시, onValueChange 미호출)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MasterSearchPicker
        kind="diagnosis"
        today={TODAY}
        items={[DX_HTN, DX_DM]}
        value={null}
        onValueChange={onChange}
        ariaLabel="진단 검색"
      />,
    );

    const input = screen.getByRole("combobox", { name: "진단 검색" });
    await user.click(input);
    await user.type(input, "존재하지않는코드ZZZ");

    expect(
      await screen.findByText(/마스터에 없는 코드는 입력할 수 없습니다/),
    ).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("만료·발효 전·비활성 코드는 '현재 유효' 필터로 후보에서 제외된다", async () => {
    const user = userEvent.setup();
    render(<SingleHarness items={[DX_HTN, DX_EXPIRED, DX_PENDING, DX_INACTIVE]} />);

    const input = screen.getByRole("combobox", { name: "진단 검색" });
    await user.click(input);

    expect(await screen.findByRole("option", { name: /본태성 고혈압/ })).toBeInTheDocument();
    expect(screen.queryByText("만료상병")).not.toBeInTheDocument();
    expect(screen.queryByText("발효전상병")).not.toBeInTheDocument();
    expect(screen.queryByText("비활성상병")).not.toBeInTheDocument();
  });
});

describe("MasterSearchPicker — AC2 키보드 완전 조작 · aria-live", () => {
  it("타이핑→화살표→Enter 로 마우스 없이 선택되고 role 시맨틱이 노출된다", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MasterSearchPicker
        kind="diagnosis"
        today={TODAY}
        items={[DX_HTN, DX_DM]}
        value={null}
        onValueChange={onChange}
        ariaLabel="진단 검색"
      />,
    );

    const input = screen.getByRole("combobox", { name: "진단 검색" });
    expect(input).toHaveAttribute("role", "combobox");

    await user.click(input);
    await user.type(input, "병"); // '제2형 당뇨병'만 매칭
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /당뇨병/ })).toBeInTheDocument();

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith(DX_DM);
  });

  it("검색 결과 개수가 aria-live(Combobox.Status)로 안내된다", async () => {
    const user = userEvent.setup();
    render(<SingleHarness items={[DX_HTN, DX_DM]} />);

    const input = screen.getByRole("combobox", { name: "진단 검색" });
    await user.click(input);
    await user.type(input, "병");

    expect(await screen.findByText("1개 결과")).toBeInTheDocument();
  });

  it("Esc 로 목록이 닫힌다", async () => {
    const user = userEvent.setup();
    render(<SingleHarness items={[DX_HTN, DX_DM]} />);

    const input = screen.getByRole("combobox", { name: "진단 검색" });
    await user.click(input);
    expect(await screen.findByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });
});

describe("MasterSearchPicker — AC3 재사용(kind·multiple)", () => {
  it("수가 피커는 금액을 천단위로 표시한다", async () => {
    const user = userEvent.setup();
    render(
      <MasterSearchPicker
        kind="fee_schedule"
        today={TODAY}
        items={[FEE]}
        value={null}
        onValueChange={vi.fn()}
        ariaLabel="수가 검색"
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "수가 검색" }));
    expect(await screen.findByRole("option", { name: /재진진찰료/ })).toBeInTheDocument();
    expect(screen.getByText("12,000원")).toBeInTheDocument();
  });

  it("약품 피커는 단위·주성분코드 보조정보를 표시한다", async () => {
    const user = userEvent.setup();
    render(
      <MasterSearchPicker
        kind="drug"
        today={TODAY}
        items={[DRUG]}
        value={null}
        onValueChange={vi.fn()}
        ariaLabel="약품 검색"
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "약품 검색" }));
    expect(await screen.findByRole("option", { name: /암로디핀 5mg/ })).toBeInTheDocument();
    expect(screen.getByText(/100801ATB/)).toBeInTheDocument();
  });

  it("multiple 모드에서 복수 선택 시 칩이 렌더된다(진단 주/부상병 — Epic 4.7)", async () => {
    const user = userEvent.setup();
    function MultiHarness() {
      const [value, setValue] = useState<MasterPickerItem[]>([]);
      return (
        <MasterSearchPicker
          kind="diagnosis"
          today={TODAY}
          items={[DX_HTN, DX_DM]}
          multiple
          value={value}
          onValueChange={setValue}
          ariaLabel="진단 검색"
        />
      );
    }
    render(<MultiHarness />);

    const input = screen.getByRole("combobox", { name: "진단 검색" });
    await user.click(input);
    await user.click(await screen.findByRole("option", { name: /본태성 고혈압/ }));
    await user.click(await screen.findByRole("option", { name: /당뇨병/ }));

    expect(await screen.findByRole("button", { name: "본태성 고혈압 선택 해제" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "제2형 당뇨병 선택 해제" })).toBeInTheDocument();
  });
});

describe("MasterSearchPicker — 코드리뷰 후속(patch)", () => {
  it("fetch 로딩 중에는 '없음' 대신 로딩 문구를 표시한다(로딩↔부재 혼동 방지)", async () => {
    const user = userEvent.setup();
    // .order() 가 영원히 resolve 되지 않는 빌더 → fetched 가 null 로 유지(로딩 상태).
    const never = new Promise<never>(() => {});
    const chain = {
      select: () => chain,
      eq: () => chain,
      lte: () => chain,
      or: () => chain,
      order: () => never,
    };
    vi.mocked(createClient).mockReturnValueOnce({ from: () => chain } as never);

    render(
      <MasterSearchPicker
        kind="diagnosis"
        today={TODAY}
        value={null}
        onValueChange={vi.fn()}
        ariaLabel="진단 검색"
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "진단 검색" }));
    expect(await screen.findByText("코드를 불러오는 중…")).toBeInTheDocument();
    expect(screen.queryByText(/마스터에 없는 코드는 입력할 수 없습니다/)).not.toBeInTheDocument();
  });

  it("선택 항목 라벨 echo 시 '0개 결과'를 안내하지 않고 목록을 유지한다(aria-live desync 방지)", async () => {
    const user = userEvent.setup();
    render(<SingleHarness items={[DX_HTN, DX_DM]} />);

    const input = screen.getByRole("combobox", { name: "진단 검색" });
    await user.click(input);
    // 선택 후 입력창에 echo 되는 전체 라벨("코드 · 명칭")을 직접 입력해 echo 상황 재현.
    await user.type(input, masterItemLabel(DX_HTN)); // "I10 · 본태성 고혈압"

    expect(screen.queryByText("0개 결과")).not.toBeInTheDocument();
    // 라벨 echo 는 검색이 아니므로 목록은 전체 유지(필터 우회와 일관).
    expect(await screen.findByRole("option", { name: /본태성 고혈압/ })).toBeInTheDocument();
  });
});

describe("순수 헬퍼", () => {
  it("masterItemLabel 은 '코드 · 명칭' 을 반환한다", () => {
    expect(masterItemLabel(DX_HTN)).toBe("I10 · 본태성 고혈압");
  });

  it("fetchCurrentlyValidMasters 는 '현재 유효' SQL 필터(is_active·effective)를 적용하고 item 으로 매핑한다", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          id: "fee1",
          code: "AA157",
          name: "재진진찰료",
          category: "진찰",
          amount_krw: 12000,
          effective_from: "2020-01-01",
          effective_to: null,
          is_active: true,
        },
      ],
      error: null,
    });
    const or = vi.fn(() => ({ order }));
    const lte = vi.fn(() => ({ or }));
    const eq = vi.fn(() => ({ lte }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const supabase = { from } as never;

    const result = await fetchCurrentlyValidMasters(supabase, "fee_schedule", TODAY);

    expect(from).toHaveBeenCalledWith("fee_schedules");
    expect(eq).toHaveBeenCalledWith("is_active", true);
    expect(lte).toHaveBeenCalledWith("effective_from", TODAY);
    expect(or).toHaveBeenCalledWith(`effective_to.is.null,effective_to.gte.${TODAY}`);
    expect(result).toEqual([
      {
        id: "fee1",
        code: "AA157",
        name: "재진진찰료",
        kind: "fee_schedule",
        is_active: true,
        effective_from: "2020-01-01",
        effective_to: null,
        category: "진찰",
        amount_krw: 12000,
      },
    ]);
  });
});

describe("MasterSearchPicker — AC5 로드 실패 재시도(Story 2.6)", () => {
  it("로드 실패 → 에러+다시 시도, 재시도 클릭 시 재조회 성공으로 복구", async () => {
    const user = userEvent.setup();
    // 실제 fetchCurrentlyValidMasters 가 가짜 supabase 체인으로 실행되게 한다(다른 fetch-경로 테스트 패턴).
    // .order() 가 1회차 error → 2회차 success 로 resolve.
    const order = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "네트워크 오류" } })
      .mockResolvedValueOnce({
        data: [
          {
            id: "dx1",
            code: "I10",
            name: "본태성 고혈압",
            effective_from: "2020-01-01",
            effective_to: null,
            is_active: true,
          },
        ],
        error: null,
      });
    const or = vi.fn(() => ({ order }));
    const lte = vi.fn(() => ({ or }));
    const eq = vi.fn(() => ({ lte }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    (createClient as Mock).mockReturnValue({ from });

    render(
      <MasterSearchPicker
        kind="diagnosis"
        today={TODAY}
        value={null}
        onValueChange={vi.fn()}
        ariaLabel="진단 검색"
      />,
    );

    // 첫 조회 실패 → 에러 메시지 + 다시 시도 버튼(페이지 remount 없이 복구 경로 제공).
    expect(await screen.findByText(/코드 마스터 조회 실패/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));

    // 재조회(2회차) 성공 → 에러 사라짐.
    await waitFor(() => expect(order).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText(/코드 마스터 조회 실패/)).not.toBeInTheDocument(),
    );
  });
});
