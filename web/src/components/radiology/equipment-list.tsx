"use client";

import { useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { type Equipment, fetchEquipment } from "@/lib/radiology/imaging";

// 장비 목록·상태(Story 5.8 AC3 / FR-103). 읽기 전용 표시 — 상태 변경 없음(5.8 범위 밖). 촬영 배정·
// 가용성 확인용. available=가용 / in_use=사용 중 / maintenance=점검 중. useState 단일 로드.

const STATUS_LABEL: Record<string, string> = {
  available: "가용",
  in_use: "사용 중",
  maintenance: "점검 중",
};

function StatusChip({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status;
  const tone =
    status === "available"
      ? "border-status-done/40 bg-status-done/12 text-status-done-ink"
      : status === "in_use"
        ? "border-status-received/40 bg-status-received/12 text-status-received-ink"
        : "border-status-cancelled/45 bg-status-cancelled/12 text-status-cancelled";
  return (
    <span
      className={
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10.5px] font-semibold " + tone
      }
    >
      {label}
    </span>
  );
}

export function EquipmentList() {
  const [equipment, setEquipment] = useState<Equipment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchEquipment()
      .then((rows) => {
        setEquipment(rows);
        setError(null);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "장비를 불러오지 못했습니다."),
      );
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-[13px] text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (equipment === null) {
    return (
      <div className="space-y-2 rounded-xl border border-border bg-card p-4" aria-busy="true">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-9 animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }

  if (equipment.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <p className="text-[12.5px] text-muted-foreground">등록된 장비가 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full text-left text-[12.5px]">
        <thead className="border-b border-border bg-muted/40 text-[11px] text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">코드</th>
            <th className="px-4 py-2 font-medium">장비명</th>
            <th className="px-4 py-2 font-medium">양식</th>
            <th className="px-4 py-2 font-medium">상태</th>
          </tr>
        </thead>
        <tbody>
          {equipment.map((eq) => (
            <tr key={eq.id} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-2 font-medium text-foreground tabular-nums">{eq.code}</td>
              <td className="px-4 py-2 text-foreground">{eq.name}</td>
              <td className="px-4 py-2 text-muted-foreground">{eq.modality ?? "—"}</td>
              <td className="px-4 py-2">
                <StatusChip status={eq.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
