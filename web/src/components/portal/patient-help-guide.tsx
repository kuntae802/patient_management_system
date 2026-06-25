import Image from "next/image";

import { helpImageSrc, type HelpScreen } from "@/lib/help/help-content";
import { PATIENT_HELP_GUIDES, type PatientHelpGuide } from "@/lib/help/patient-help-content";

// 환자 포털 도움말 본문(Story 9.8 / FR-252·253). 직원 HelpGuide 와 달리 권한 필터(filterNav)가 없고
// 고정 4메뉴를 순서대로 렌더한다. 모바일 셸(max-w-md)이라 직원의 2컬럼 그리드 대신 단일 컬럼
// (스크린샷 위 + 번호 설명 아래)으로 그린다. 정적 콘텐츠라 클라 훅 불필요(서버 컴포넌트).
export function PatientHelpGuide() {
  return (
    <div className="space-y-10">
      {PATIENT_HELP_GUIDES.map((guide) => (
        <PatientHelpSection key={guide.key} guide={guide} />
      ))}
    </div>
  );
}

function PatientHelpSection({ guide }: { guide: PatientHelpGuide }) {
  return (
    <section id={`help-${guide.key}`} className="scroll-mt-4">
      <header className="mb-3 border-b border-border pb-2">
        <h2 className="text-[18px] font-bold text-foreground">{guide.label}</h2>
        {guide.intro && (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{guide.intro}</p>
        )}
      </header>
      <div className="space-y-6">
        {guide.screens.map((screen) => (
          <PatientHelpScreen key={screen.image} screen={screen} />
        ))}
      </div>
    </section>
  );
}

function PatientHelpScreen({ screen }: { screen: HelpScreen }) {
  return (
    <div className="space-y-2.5">
      {/* 화면이 2장 이상인 메뉴(수납·영수증)에서 제목으로 구분. */}
      <p className="text-[14px] font-medium text-foreground">{screen.title}</p>
      {/* 모바일 단일 컬럼: 폰 스크린샷(세로) 위 + 번호 설명 아래. 번호는 이미지에 구워져 있다. */}
      <figure className="overflow-hidden rounded-xl border border-border bg-card">
        <Image
          src={helpImageSrc(screen.image)}
          alt={screen.alt}
          width={screen.imageWidth}
          height={screen.imageHeight}
          sizes="(min-width: 768px) 320px, 80vw"
          className="mx-auto h-auto w-full max-w-[300px]"
        />
      </figure>
      <ol className="space-y-2">
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
        <p className="rounded-md bg-muted/50 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground">
          {screen.flow}
        </p>
      )}
    </div>
  );
}
