"use client";

import { ImagePlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api/client";
import {
  type Equipment,
  type ExaminationImage,
  fetchEquipment,
  fetchExaminationImages,
  performExamination,
  uploadExaminationImage,
} from "@/lib/radiology/imaging";

// 촬영 캡처 패널(Story 5.8 AC2·AC4). 선택한 영상검사 오더에 대해: 영상 업로드(멀티파트)·업로드된
// 영상 썸네일(서명 URL)·장비 배정(select)·촬영 수행(영상≥1 강제). 영상 0장이면 수행 버튼 비활성
// (서버 422 image_required 최종선). 수행 성공 시 워크리스트에서 제거(ordered 아님). useState 단일 로드.

export function CapturePanel({
  examinationId,
  onPerformed,
}: {
  examinationId: string;
  onPerformed: () => void;
}) {
  const [images, setImages] = useState<ExaminationImage[] | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [performing, setPerforming] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setSelectedEquipmentId("");
    void loadImages();
  }, [loadImages]);

  useEffect(() => {
    // 장비 목록은 검사 전환과 무관하게 1회 로드(촬영 배정 select). 실패는 무음(배정은 선택).
    void fetchEquipment()
      .then(setEquipment)
      .catch(() => {});
  }, []);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || uploading) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadExaminationImage(examinationId, file);
      }
      toast.success("영상을 업로드했습니다.");
      await loadImages();
      onPerformed(); // 워크리스트 image_count 갱신
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "영상 업로드에 실패했습니다.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function perform() {
    if (performing) return; // 이중 제출 방지 1차선
    setPerforming(true);
    try {
      await performExamination(examinationId, {
        equipment_id: selectedEquipmentId === "" ? null : selectedEquipmentId,
      });
      toast.success("촬영을 수행 처리했습니다.");
      onPerformed(); // 수행 → ordered 아님 → 워크리스트에서 제거
    } catch (err) {
      // 409(재수행·stale)·404(레이스) = stale → 재동기화. 그 외 메시지만.
      toast.error(err instanceof ApiError ? err.message : "촬영 수행에 실패했습니다.");
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) onPerformed();
    } finally {
      setPerforming(false);
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
  const canPerform = imageCount > 0 && !performing && !uploading;

  return (
    <div className="space-y-4">
      {/* 업로드 영역 */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          disabled={uploading}
          aria-label="영상 파일 선택"
          onChange={(e) => void handleFiles(e.target.files)}
          className="block w-full text-[12.5px] text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-[12.5px] file:font-medium hover:file:bg-muted disabled:opacity-60"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          PNG·JPEG·WEBP, 최대 50MiB. 파일명에 주민번호 등 민감정보 금지.
        </p>
      </div>

      {/* 업로드된 영상 썸네일 */}
      {images === null ? (
        <div className="grid grid-cols-3 gap-2" aria-busy="true" aria-label="불러오는 중">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : imageCount === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-background px-4 py-6 text-[12.5px] text-muted-foreground">
          <ImagePlus className="size-4" aria-hidden />
          업로드된 영상이 없습니다. 촬영 수행 전 영상을 1장 이상 올리세요.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2" aria-label="업로드된 영상">
          {images.map((img) => (
            <li key={img.id} className="overflow-hidden rounded-md border border-border bg-background">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.signed_url}
                alt="촬영 영상"
                className="aspect-square w-full object-cover"
              />
            </li>
          ))}
        </ul>
      )}

      {/* 장비 배정 + 수행 */}
      <div className="flex items-center gap-2 border-t border-border pt-3">
        <label className="sr-only" htmlFor="equipment-select">
          촬영 장비
        </label>
        <select
          id="equipment-select"
          value={selectedEquipmentId}
          onChange={(e) => setSelectedEquipmentId(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-ring/40"
        >
          <option value="">장비 미배정</option>
          {equipment.map((eq) => (
            <option key={eq.id} value={eq.id} disabled={eq.status !== "available"}>
              {eq.code} · {eq.name}
              {eq.status !== "available" ? ` (${eq.status})` : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void perform()}
          disabled={!canPerform}
          title={imageCount === 0 ? "영상을 1장 이상 업로드해야 수행할 수 있습니다." : undefined}
          className="shrink-0 rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {performing ? "수행 중…" : "촬영 수행"}
        </button>
      </div>
    </div>
  );
}
