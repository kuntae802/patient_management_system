import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/shell/empty-state";
import { ToastDemo } from "@/components/shell/toast-demo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// 디자인 시스템 토큰·전역 셸 프리뷰(Story 1.2). 실제 역할 화면·route group은 후속 스토리가 채운다.
// 5상태 = 색 + 도형 중복 인코딩. 잉크 규칙: 접수=앰버 잉크, 완료(작은 라벨)=그린 잉크.
const statusBadges = [
  { label: "예약", glyph: "○", className: "text-status-scheduled" },
  { label: "접수", glyph: "●", className: "text-status-received-ink" },
  { label: "진행중", glyph: "◐", className: "text-status-inprogress" },
  { label: "완료", glyph: "✓", className: "text-status-done-ink" },
  { label: "취소", glyph: "✕", className: "text-status-cancelled line-through" },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-[13px] font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default function Home() {
  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-8 px-6 py-6">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">
            디자인 시스템 · 전역 셸 프리뷰
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            브랜드 토큰 · Pretendard · AppShell 골격 · 공통 상태의 시각 검증 페이지입니다.
          </p>
        </div>

        <Section title="상태 배지 (색 + 도형 중복 인코딩)">
          <div className="flex flex-wrap items-center gap-4">
            {statusBadges.map((s) => (
              <span
                key={s.label}
                className={`inline-flex items-center gap-1.5 text-[13px] ${s.className}`}
              >
                <span aria-hidden>{s.glyph}</span>
                {s.label}
              </span>
            ))}
          </div>
        </Section>

        <Section title="버튼">
          <div className="flex flex-wrap items-center gap-3">
            <Button>주 액션</Button>
            <Button variant="ghost">보조 액션</Button>
            <Button variant="outline">아웃라인</Button>
            <ToastDemo />
          </div>
        </Section>

        <Section title="로딩 — 스켈레톤 (스피너 금지)">
          <div className="space-y-2 rounded-lg border border-border bg-card p-4">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </Section>

        <Section title="빈 상태">
          <EmptyState
            title="오늘 접수된 환자가 없습니다"
            description="새 환자를 접수하면 대기 현황에 표시됩니다."
            action={<Button>＋ 환자 접수하기</Button>}
          />
        </Section>
      </div>
    </AppShell>
  );
}
