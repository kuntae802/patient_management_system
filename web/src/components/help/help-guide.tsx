"use client";

import Image from "next/image";

import { usePermissions } from "@/hooks/use-permissions";
import {
  HELP_GUIDES,
  helpHrefSlug,
  helpImageSrc,
  type HelpMenuGuide,
  type HelpScreen,
} from "@/lib/help/help-content";
import { filterNav, STAFF_NAV, type NavItem } from "@/lib/nav/staff-nav";

// 도움말 본문(Story 9.1 / FR-251·253). 현재 계정에 보이는 메뉴만(filterNav) sticky 인덱스 + 섹션으로 렌더한다.
// 역할별 하드코딩 금지 — 사이드바와 동일한 단일 출처(STAFF_NAV)·동일 필터·동일 섹션 그룹핑을 쓴다.
export function HelpGuide() {
  const { role, has } = usePermissions();
  const menus = filterNav(STAFF_NAV, role, has);

  // 섹션 순서를 보존하며 그룹핑(사이드바 sidebar.tsx 와 같은 방식 → 인덱스 묶음이 메뉴와 일관).
  const sections: { name: string; items: NavItem[] }[] = [];
  for (const it of menus) {
    let group = sections.find((s) => s.name === it.section);
    if (!group) {
      group = { name: it.section, items: [] };
      sections.push(group);
    }
    group.items.push(it);
  }

  if (menus.length === 0) {
    return (
      <p className="rounded-md border border-border bg-card px-4 py-6 text-[13px] text-muted-foreground">
        현재 계정에 표시되는 메뉴가 없습니다.
      </p>
    );
  }

  return (
    <div>
      {/* 메뉴 인덱스 — main(overflow-auto) 기준 sticky top-0. 페이지 px-6 을 -mx-6 으로 상쇄해 가로로 꽉 채운다. */}
      <nav
        aria-label="도움말 메뉴 인덱스"
        className="sticky top-0 z-10 -mx-6 mb-8 border-b border-border bg-background/95 px-6 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {sections.map((section) => (
            <div key={section.name} className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-[0.09em] text-muted-foreground uppercase">
                {section.name}
              </span>
              <div className="flex flex-wrap gap-1">
                {section.items.map((item) => (
                  <a
                    key={item.href}
                    href={`#${helpHrefSlug(item.href)}`}
                    className="rounded-md px-2 py-1 text-[12px] text-foreground transition-colors hover:bg-muted hover:text-primary-hover"
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>

      {/* 메뉴별 안내 섹션 — 화면이 있으면 화면들, 없으면(키 부재 또는 screens 빈배열) '준비 중' 플레이스홀더. */}
      <div className="space-y-12">
        {menus.map((item) => (
          <HelpMenuSection key={item.href} item={item} guide={HELP_GUIDES[item.href]} />
        ))}
      </div>
    </div>
  );
}

function HelpMenuSection({ item, guide }: { item: NavItem; guide?: HelpMenuGuide }) {
  const Icon = item.icon;
  // 화면이 1개 이상 있을 때만 콘텐츠 렌더 — 키는 있으나 screens 가 빈 배열이어도 '준비 중'으로 폴백.
  const hasScreens = !!guide && guide.screens.length > 0;
  return (
    // scroll-mt: 앵커 점프 시 sticky 인덱스(여러 줄로 wrap 가능)에 제목이 가리지 않도록 넉넉히 보정.
    // tabIndex=-1: 프래그먼트 이동 시 브라우저가 섹션에 포커스를 옮기도록(키보드 사용자 위치 동기화).
    <section id={helpHrefSlug(item.href)} tabIndex={-1} className="scroll-mt-28 outline-none">
      <header className="mb-4 border-b border-border pb-2">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold text-foreground">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          {item.label}
        </h2>
        {guide?.intro && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{guide.intro}</p>
        )}
      </header>

      {hasScreens ? (
        <div className="space-y-8">
          {guide.screens.map((screen) => (
            <HelpScreenBlock key={screen.image} screen={screen} />
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-border bg-muted/40 px-4 py-6 text-[13px] text-muted-foreground">
          이 메뉴의 안내는 준비 중입니다.
        </p>
      )}
    </section>
  );
}

function HelpScreenBlock({ screen }: { screen: HelpScreen }) {
  return (
    // 이미지를 위에 크게(원본 1440px 까지) 깔고, 번호 설명을 그 아래 가로로 펼친다 — 스크린샷 내용이 잘 보이도록.
    <figure className="space-y-3">
      <figcaption className="text-[14px] font-medium text-foreground">{screen.title}</figcaption>
      <Image
        src={helpImageSrc(screen.image)}
        alt={screen.alt}
        width={screen.imageWidth}
        height={screen.imageHeight}
        sizes="(min-width: 1536px) 1440px, 100vw"
        className="h-auto w-full max-w-[1440px] rounded-md border border-border bg-card"
      />
      <div className="max-w-[1440px]">
        <ol className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {screen.hotspots.map((h) => (
            <li key={h.num} className="flex gap-2.5">
              <span
                aria-hidden
                className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background"
              >
                {h.num}
              </span>
              <p className="text-[13px] leading-relaxed text-foreground">
                <span className="font-medium">{h.element}</span>
                <span className="text-muted-foreground"> — {h.desc}</span>
              </p>
            </li>
          ))}
        </ol>
        {screen.flow && (
          <p className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground">
            {screen.flow}
          </p>
        )}
      </div>
    </figure>
  );
}
