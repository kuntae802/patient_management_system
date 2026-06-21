"use client";

import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import {
  fetchCurrentlyValidMasters,
  formatKrw,
  isCurrentlyValid,
  type MasterKind,
  type MasterPickerItem,
  masterItemLabel,
} from "@/lib/admin/masters";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// 재사용 마스터 검색 피커(Story 2.3, FR-202). 진단(KCD)·약품·수가를 검색·선택만 가능하게 강제하고
// free-text 입력을 차단한다 — Base UI `Combobox`(목록 강제, Autocomplete 아님) 위 얇은 래퍼.
// 키보드 완전 조작·aria-live(Combobox.Status)·role=combobox/listbox/option·포커스 복원은 Base UI 네이티브.
// "현재 유효" 필터는 isCurrentlyValid 단일 술어 + 서버 주입 today(DB 권위, 2.2 이월 해소).
// Epic 4.7(진단 주/부상병 multiple)·5.2(약품)·5.5/7.x(수가)가 동일 컴포넌트를 소비.

const KIND_NOUN: Record<MasterKind, string> = {
  diagnosis: "진단",
  drug: "약품",
  fee_schedule: "수가",
};

const INPUT_GROUP =
  "relative flex w-full items-center rounded-md border border-border bg-card focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30";
const INPUT =
  "h-9 w-full bg-transparent pl-8 pr-14 text-[13px] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60";
const INPUT_INLINE =
  "h-7 min-w-24 flex-1 bg-transparent px-1 text-[13px] text-foreground outline-none placeholder:text-muted-foreground";
const ICON_BTN =
  "flex h-9 w-7 items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground";
const POPUP =
  "z-50 max-h-[min(20rem,var(--available-height))] w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-y-auto rounded-md border border-border bg-card py-1 text-[13px] shadow-sm outline-none";
const ITEM =
  "grid cursor-default grid-cols-[1.25rem_1fr] items-center gap-1 px-2 py-1.5 outline-none select-none data-highlighted:bg-primary/10 data-selected:font-medium";
const CHIP =
  "group flex items-center gap-1 rounded-[5px] border border-border bg-muted px-1.5 py-0.5 text-[12px] text-foreground";

type BaseProps = {
  /** 마스터 종류 — 테이블·표시 컬럼을 결정. */
  kind: MasterKind;
  /** 서버 주입 ISO YYYY-MM-DD(KST). "현재 유효" 단일 권위 — 브라우저 시계 기본값 없음(필수). */
  today: string;
  /** 사전 로드된 항목 주입(테스트·소비처 캐시). 미주입 시 Supabase 직접조회. */
  items?: MasterPickerItem[];
  id?: string;
  /** 가시 라벨(있으면 네이티브 <label> 렌더). 없으면 ariaLabel 로 접근가능명 제공. */
  label?: string;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** 검증 오류 표시(단일 선택만 — 422 인라인 등 소비처가 제어, UX-DR18). 입력에 aria-invalid 전파. */
  ariaInvalid?: boolean;
  /** 오류 메시지 요소 id(aria-describedby 연결 — AT 낭독, UX-DR18). */
  ariaDescribedby?: string;
};

type SingleProps = BaseProps & {
  multiple?: false;
  value: MasterPickerItem | null;
  onValueChange: (value: MasterPickerItem | null) => void;
};

type MultipleProps = BaseProps & {
  multiple: true;
  value: MasterPickerItem[];
  onValueChange: (value: MasterPickerItem[]) => void;
};

export type MasterSearchPickerProps = SingleProps | MultipleProps;

export function MasterSearchPicker(props: MasterSearchPickerProps) {
  const {
    kind,
    today,
    items: itemsProp,
    id,
    label,
    ariaLabel,
    placeholder,
    disabled,
    required,
    className,
    multiple,
    ariaInvalid,
    ariaDescribedby,
  } = props;

  const reactId = useId();
  const inputId = id ?? reactId;
  const noun = KIND_NOUN[kind];
  const resolvedPlaceholder = placeholder ?? `${noun} 코드·명칭 검색`;
  const accessibleName = ariaLabel ?? label ?? `${noun} 검색`;

  // 항목 로드: 주입(itemsProp) 모드면 그대로 사용(fetch 안 함), 아니면 Supabase 직접조회
  // ("현재 유효"만, 서버 today SQL 필터). itemsProp 를 state 에 동기화하지 않아 set-state-in-effect 회피.
  const [fetched, setFetched] = useState<MasterPickerItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 재시도 트리거(Story 2.6/AC5) — 증가 시 effect 가 재실행돼 재조회한다(페이지 전체 remount 없이 복구).
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (itemsProp) return; // 주입 모드 — 네트워크 조회 불필요
    let active = true;
    const supabase = createClient();
    fetchCurrentlyValidMasters(supabase, kind, today)
      .then((rows) => {
        if (active) {
          setFetched(rows);
          setLoadError(null);
        }
      })
      .catch((err) => {
        if (active) {
          setLoadError(err instanceof Error ? err.message : "코드를 불러오지 못했습니다.");
        }
      });
    return () => {
      active = false;
    };
  }, [kind, today, itemsProp, reloadKey]);

  // 재시도: 로딩 상태로 되돌리고(에러 해제·fetched=null) reloadKey 를 올려 effect 재조회를 유발.
  function retryLoad() {
    setLoadError(null);
    setFetched(null);
    setReloadKey((k) => k + 1);
  }

  // 방어 필터: 어떤 경로로 온 항목이든 동일 술어·동일 today 로 "현재 유효"만(드리프트 제거 = 이월 해소).
  const validItems = useMemo(
    () => (itemsProp ?? fetched ?? []).filter((it) => isCurrentlyValid(it, today)),
    [itemsProp, fetched, today],
  );

  // 데이터 로딩 중(fetch 경로 + 미해결): Empty 의 "없음" 문구와 구분(로딩↔부재 혼동 방지).
  const isLoading = !itemsProp && fetched === null && loadError == null;

  // 외부 필터(code OR name, 한글·영문 부분일치) — Status 의 결과 개수 안내에 사용.
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  // 단일 선택 후 입력값=선택 항목의 라벨("코드 · 명칭")이 되어 onInputValueChange 로 echo 된다.
  // 이건 "검색"이 아니라 선택 표시이므로(Base UI 도 필터를 우회해 전체 노출) 필터·개수 안내에서 제외.
  const isLabelEcho = useMemo(
    () =>
      trimmedQuery !== "" &&
      validItems.some((it) => masterItemLabel(it).toLowerCase() === trimmedQuery.toLowerCase()),
    [validItems, trimmedQuery],
  );
  const filtered = useMemo(() => {
    const q = trimmedQuery.toLowerCase();
    if (!q || isLabelEcho) return validItems;
    return validItems.filter(
      (it) => it.code.toLowerCase().includes(q) || it.name.toLowerCase().includes(q),
    );
  }, [validItems, trimmedQuery, isLabelEcho]);

  // 실제 검색 중일 때만 개수 안내(라벨 echo 시 화면엔 전체가 보이므로 "0개 결과" 오안내 방지).
  const statusText = trimmedQuery && !isLabelEcho ? `${filtered.length}개 결과` : null;

  function handleValueChange(next: MasterPickerItem[] | MasterPickerItem | null) {
    if (multiple) {
      (props.onValueChange as (v: MasterPickerItem[]) => void)(
        Array.isArray(next) ? next : next ? [next] : [],
      );
    } else {
      (props.onValueChange as (v: MasterPickerItem | null) => void)(
        Array.isArray(next) ? (next[0] ?? null) : next,
      );
    }
  }

  return (
    <div className={cn("w-full", className)}>
      {label ? (
        <label htmlFor={inputId} className="mb-1 block text-[12px] font-medium text-foreground">
          {label}
          {required ? <span className="ml-0.5 text-status-cancelled">*</span> : null}
        </label>
      ) : null}

      <Combobox.Root<MasterPickerItem, boolean>
        items={validItems}
        filteredItems={filtered}
        value={props.value}
        onValueChange={handleValueChange}
        multiple={multiple}
        required={required}
        disabled={disabled || loadError != null}
        itemToStringLabel={masterItemLabel}
        isItemEqualToValue={(a, b) => a.id === b.id}
        onInputValueChange={(v) => setQuery(typeof v === "string" ? v : "")}
      >
        <Combobox.InputGroup className={INPUT_GROUP}>
          {multiple ? (
            <Combobox.Chips className="flex w-full flex-wrap items-center gap-1 px-2 py-1">
              <Combobox.Value>
                {(value: MasterPickerItem[]) =>
                  value.map((item) => (
                    <Combobox.Chip key={item.id} className={CHIP} aria-label={item.name}>
                      <span className="tabular-nums">{item.code}</span>
                      <span className="text-muted-foreground">{item.name}</span>
                      <Combobox.ChipRemove
                        className="flex size-4 items-center justify-center text-muted-foreground hover:text-foreground"
                        aria-label={`${item.name} 선택 해제`}
                      >
                        <X className="size-3" aria-hidden />
                      </Combobox.ChipRemove>
                    </Combobox.Chip>
                  ))
                }
              </Combobox.Value>
              <Combobox.Input
                id={inputId}
                placeholder={resolvedPlaceholder}
                aria-label={accessibleName}
                className={INPUT_INLINE}
              />
            </Combobox.Chips>
          ) : (
            <>
              <Search
                className="pointer-events-none absolute left-2 size-4 text-muted-foreground"
                aria-hidden
              />
              <Combobox.Input
                id={inputId}
                placeholder={resolvedPlaceholder}
                aria-label={accessibleName}
                aria-invalid={ariaInvalid || undefined}
                aria-describedby={ariaDescribedby}
                className={INPUT}
              />
              <span className="absolute right-0 flex items-center">
                <Combobox.Clear className={ICON_BTN} aria-label="선택 지우기">
                  <X className="size-4" aria-hidden />
                </Combobox.Clear>
                <Combobox.Trigger className={ICON_BTN} aria-label={`${noun} 목록 열기`}>
                  <ChevronDown className="size-4" aria-hidden />
                </Combobox.Trigger>
              </span>
            </>
          )}
          {multiple ? (
            <Combobox.Trigger className={ICON_BTN} aria-label={`${noun} 목록 열기`}>
              <ChevronDown className="size-4" aria-hidden />
            </Combobox.Trigger>
          ) : null}
        </Combobox.InputGroup>

        <Combobox.Portal>
          <Combobox.Positioner sideOffset={4} className="z-50 outline-none">
            <Combobox.Popup className={POPUP}>
              {/* aria-live polite — 결과 개수 변화 안내(UX-DR20). 루트는 상시 마운트, children 만 갱신. */}
              <Combobox.Status className="px-2 py-1 text-[11px] text-muted-foreground">
                {statusText}
              </Combobox.Status>
              <Combobox.Empty className="px-2 py-2 text-[12px] text-muted-foreground">
                {isLoading
                  ? "코드를 불러오는 중…"
                  : "일치하는 코드가 없습니다. 마스터에 없는 코드는 입력할 수 없습니다."}
              </Combobox.Empty>
              <Combobox.List>
                {(item: MasterPickerItem) => (
                  <Combobox.Item key={item.id} value={item} className={ITEM}>
                    <Combobox.ItemIndicator className="col-start-1 flex justify-center text-primary">
                      <Check className="size-4" aria-hidden />
                    </Combobox.ItemIndicator>
                    <span className="col-start-2 flex items-baseline gap-2">
                      <span className="tabular-nums font-medium text-foreground">{item.code}</span>
                      <span className="text-foreground">{item.name}</span>
                      {item.kind === "fee_schedule" && item.amount_krw != null ? (
                        <span className="ml-auto tabular-nums text-muted-foreground">
                          {formatKrw(item.amount_krw)}원
                        </span>
                      ) : null}
                      {item.kind === "drug" && (item.unit || item.ingredient_code) ? (
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          {[item.unit, item.ingredient_code].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>

      {loadError ? (
        <p role="alert" className="mt-1 flex items-center gap-2 text-[11.5px] text-status-cancelled">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={retryLoad}
            className="rounded border border-status-cancelled/40 px-1.5 py-0.5 text-[11px] font-medium text-status-cancelled hover:bg-status-cancelled/10"
          >
            다시 시도
          </button>
        </p>
      ) : null}
    </div>
  );
}
