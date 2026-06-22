"use client";

import { FileText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api/client";
import { completeExamination } from "@/lib/doctor/reading";
import { type ExaminationImage, fetchExaminationImages } from "@/lib/radiology/imaging";

// 판독 패널(Story 5.9 AC2·AC3·AC4). 선택한 영상검사(performed)에 대해: 영상 썸네일(서명 URL·5.8 재사용)·
// 판독 소견(필수)·결론(선택) 입력·판독 완료(performed→completed). 소견 비었으면 완료 버튼 비활성(서버
// 422 findings_required 최종선). 완료 성공 시 워크리스트에서 제거(performed 아님). useState 단일 로드.

export function ReadingPanel({
  examinationId,
  onCompleted,
}: {
  examinationId: string;
  onCompleted: () => void;
}) {
  const [images, setImages] = useState<ExaminationImage[] | null>(null);
  const [findings, setFindings] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  const loadImages = useCallback(async () => {
    try {
      const rows = await fetchExaminationImages(examinationId);
      setImages(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "영상을 불러오지 못했습니다.");
    }
  }, [examinationId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImages(null);
    setFindings("");
    setConclusion("");
    void loadImages();
  }, [loadImages]);

  async function complete() {
    if (completing || findings.trim() === "") return; // 이중 제출·빈 소견 1차선
    setCompleting(true);
    try {
      await completeExamination(examinationId, {
        findings,
        reading_conclusion: conclusion.trim() === "" ? null : conclusion,
      });
      toast.success("판독을 완료했습니다.");
      onCompleted(); // 완료 → performed 아님 → 워크리스트에서 제거
    } catch (err) {
      // 409(재완료·stale)·404(레이스) = stale → 재동기화. 그 외 메시지만.
      toast.error(err instanceof ApiError ? err.message : "판독 완료에 실패했습니다.");
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) onCompleted();
    } finally {
      setCompleting(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="text-[12.5px] text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={() => void loadImages()}
          className="mt-2 rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium hover:bg-muted"
        >
          다시 시도
        </button>
      </div>
    );
  }

  const imageCount = images?.length ?? 0;
  const canComplete = findings.trim() !== "" && !completing;

  return (
    <div className="space-y-4">
      {/* 판독 영상 썸네일(서명 URL) */}
      {images === null ? (
        <div className="grid grid-cols-3 gap-2" aria-busy="true" aria-label="불러오는 중">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : imageCount === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-background px-4 py-6 text-[12.5px] text-muted-foreground">
          <FileText className="size-4" aria-hidden />
          업로드된 영상이 없습니다.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2" aria-label="판독 영상">
          {images.map((img) => (
            <li
              key={img.id}
              className="overflow-hidden rounded-md border border-border bg-background"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.signed_url}
                alt="판독 영상"
                className="aspect-square w-full object-cover"
              />
            </li>
          ))}
        </ul>
      )}

      {/* 판독 소견(필수) */}
      <div>
        <label
          htmlFor="reading-findings"
          className="mb-1 block text-[12px] font-medium text-foreground"
        >
          판독 소견 <span className="text-status-cancelled">*</span>
        </label>
        <textarea
          id="reading-findings"
          value={findings}
          onChange={(e) => setFindings(e.target.value)}
          rows={4}
          placeholder="영상 판독 소견을 입력하세요."
          className="w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ring/40"
        />
      </div>

      {/* 판독 결론(선택) */}
      <div>
        <label
          htmlFor="reading-conclusion"
          className="mb-1 block text-[12px] font-medium text-foreground"
        >
          판독 결론 <span className="text-muted-foreground">(선택)</span>
        </label>
        <textarea
          id="reading-conclusion"
          value={conclusion}
          onChange={(e) => setConclusion(e.target.value)}
          rows={2}
          placeholder="결론·임프레션(선택)."
          className="w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ring/40"
        />
      </div>

      <div className="flex justify-end border-t border-border pt-3">
        <button
          type="button"
          onClick={() => void complete()}
          disabled={!canComplete}
          title={findings.trim() === "" ? "판독 소견을 입력해야 완료할 수 있습니다." : undefined}
          className="rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {completing ? "완료 중…" : "판독 완료"}
        </button>
      </div>
    </div>
  );
}
